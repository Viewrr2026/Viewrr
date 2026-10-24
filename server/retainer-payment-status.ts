import type Stripe from "stripe";
import type { RetainerDb } from "./retainer-v1-db";

/** Reconcile checkout display without creating charges or trusting a device's success callback. */
export async function readRetainerPaymentStatus(db: RetainerDb, retrieve: (id: string) => Promise<Stripe.PaymentIntent>, cycleId: string, userId: number) {
  const { rows: [row] } = await db.query(`SELECT c.payment_id,c.paid_at,p.status,p.public_id,p.gross_pence,
      p.succeeded_at,p.stripe_payment_intent_id FROM retainer_cycles c
      JOIN projects j ON j.id=c.project_id LEFT JOIN payments p ON p.id=c.payment_id
      WHERE c.public_id=$1 AND (j.client_id=$2 OR j.freelancer_id=$2)`, [cycleId, userId]);
  if (!row) throw Object.assign(new Error("Cycle not found"), { status: 404 });
  if (!row.payment_id) return { status: "not_started", verified: false };
  const summary = { paymentPublicId: row.public_id, amountPence: row.gross_pence };
  if (["refunded", "partially_refunded", "disputed"].includes(row.status))
    return { ...summary, status: row.status, verified: false };
  if (row.status === "succeeded" && row.succeeded_at && row.paid_at)
    return { ...summary, status: "succeeded", verified: true };
  if (!row.stripe_payment_intent_id) return { ...summary, status: "processing", verified: false };
  const intent = await retrieve(row.stripe_payment_intent_id);
  return { ...summary, status: intent.status === "succeeded" ? "processing" : intent.status, verified: false };
}
