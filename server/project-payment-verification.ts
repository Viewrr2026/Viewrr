import type Stripe from 'stripe';
import { retainerPool, retainerTransaction, type RetainerDb } from './retainer-v1-db';

// These helpers use the shared PostgreSQL connection/transaction adapter.
export async function hasVerifiedProjectPayment(projectId: number, db: RetainerDb = retainerPool()): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM payments p
    JOIN projects j ON j.id=p.project_id
    JOIN invoices i ON i.id=p.invoice_id AND i.project_id=j.id
    WHERE j.id=$1 AND p.payment_kind='one_off'
      AND p.client_id=j.client_id AND p.freelancer_id=j.freelancer_id
      AND i.client_id=p.client_id AND i.freelancer_id=p.freelancer_id
      AND p.status IN ('succeeded','partially_refunded') AND p.succeeded_at IS NOT NULL
      AND p.stripe_payment_intent_id IS NOT NULL AND p.currency='gbp'
      AND p.gross_pence>0 AND p.gross_pence=i.total_pence AND i.status='paid'
      AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.payment_id=p.id
        AND r.status='succeeded' GROUP BY r.payment_id HAVING SUM(r.amount_pence)>=p.gross_pence)
    LIMIT 1`, [projectId]);
  return result.rows.length > 0;
}

export function rejectClientPaymentConfirmation(_req: unknown, res: any) {
  return res.status(409).json({ error: 'Payment is confirmed automatically after Stripe verification.', code: 'payment_verification_required' });
}

export async function fulfilVerifiedProjectPayment(intent: Stripe.PaymentIntent, details: {
  chargeId: string | null; balanceTxId: string | null; stripeFeePence: number | null; applicationFeeId: string | null;
}): Promise<boolean> {
  return retainerTransaction(async db => {
    const { rows: [p] } = await db.query('SELECT * FROM payments WHERE public_id=$1 FOR UPDATE', [intent.metadata?.viewrr_payment_id]);
    if (!p || p.payment_kind !== 'one_off') throw new Error('One-off payment record missing');
    const { rows: [j] } = await db.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [p.project_id]);
    const { rows: [i] } = await db.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [p.invoice_id]);
    if (intent.status !== 'succeeded' || intent.id !== p.stripe_payment_intent_id ||
        intent.amount !== p.gross_pence || intent.amount_received !== p.gross_pence ||
        intent.currency !== 'gbp' || p.currency !== 'gbp' || p.gross_pence <= 0)
      throw new Error('Stripe payment does not match the ledger');
    if (!j || !i || i.project_id !== j.id || i.total_pence !== p.gross_pence ||
        i.client_id !== p.client_id || j.client_id !== p.client_id ||
        i.freelancer_id !== p.freelancer_id || j.freelancer_id !== p.freelancer_id || i.status === 'cancelled')
      throw new Error('Invoice or project does not match the payment');
    for (const [key, value] of Object.entries({ project_id: p.project_id, invoice_id: p.invoice_id, client_id: p.client_id, freelancer_id: p.freelancer_id })) {
      if (intent.metadata?.[key] !== String(value)) throw new Error('Stripe payment ownership mismatch');
    }
    // Never allow a delayed success event to reverse a refund/cancellation.
    if (['refunded', 'partially_refunded', 'cancelled'].includes(p.status)) return false;
    const firstSuccess = p.status !== 'succeeded';
    const now = new Date().toISOString();
    if (firstSuccess) await db.query(`UPDATE payments SET status='succeeded', succeeded_at=$2,
      stripe_charge_id=$3, stripe_balance_transaction_id=$4, stripe_fee_pence=$5,
      stripe_application_fee_id=$6, net_platform_revenue_pence=$7, version=version+1 WHERE id=$1`,
      [p.id, now, details.chargeId, details.balanceTxId, details.stripeFeePence, details.applicationFeeId,
        details.stripeFeePence === null ? null : p.platform_fee_pence-details.stripeFeePence]);
    // Replays also repair incomplete fulfilment left by older deployments.
    await db.query("UPDATE invoices SET status='paid', paid_at=COALESCE(paid_at,$2) WHERE id=$1", [i.id, p.succeeded_at || now]);
    await db.query("UPDATE projects SET payment_status='paid' WHERE id=$1", [j.id]);
    return firstSuccess;
  });
}
