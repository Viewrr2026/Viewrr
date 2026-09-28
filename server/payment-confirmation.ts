import type Stripe from 'stripe';
import type { RetainerDb } from './retainer-v1-db';
import { hasVerifiedProjectPayment } from './project-payment-verification';

export async function confirmStoredPayment(
  db: RetainerDb, retrieve: (id: string) => Promise<Stripe.PaymentIntent>,
  fulfil: (intent: Stripe.PaymentIntent) => Promise<void>,
  projectId: number, userId: number, reference: string,
) {
  // Resolve either API reference format locally; never send an arbitrary browser ID to Stripe.
  const { rows: [p] } = await db.query(`SELECT p.* FROM payments p JOIN projects j ON j.id=p.project_id
    WHERE p.project_id=$1 AND (p.public_id=$3 OR p.stripe_payment_intent_id=$3)
      AND p.payment_kind='one_off' AND p.client_id=j.client_id AND p.freelancer_id=j.freelancer_id
      AND (j.client_id=$2 OR j.freelancer_id=$2)`, [projectId,userId,reference]);
  if (!p?.stripe_payment_intent_id) throw Object.assign(new Error('Payment not found for this project'),{ status:404 });
  const intent = await retrieve(p.stripe_payment_intent_id);
  if (intent.status !== 'succeeded') return { ok:false, status:intent.status };
  await fulfil(intent);
  const paid = await hasVerifiedProjectPayment(projectId,db);
  return { ok:paid, status:paid ? 'succeeded' : 'processing' };
}
