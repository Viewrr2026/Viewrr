import type Stripe from 'stripe';
import { retainerTransaction, type RetainerDb } from './retainer-v1-db';

const objectId = (value: any): string | null => typeof value === 'string' ? value : value?.id ?? null;
export function adjustedEarnings(payment: any): number {
  return Number(payment.freelancer_pence ?? 0) - Number(payment.transfer_reversed_pence ?? 0) + Number(payment.fee_refunded_pence ?? 0);
}

/** Read Stripe's current state under a payment lock, so older events cannot undo a refund.
 * Invoices retain their original paid record; refunds are separate accounting entries.
 * No charge, refund, transfer or payout is created by this reconciliation.
 */
export async function syncChargeRefunds(stripe: Stripe, chargeId: string,
  transaction = retainerTransaction): Promise<void> {
  const lookup = await stripe.charges.retrieve(chargeId);
  const intentId = objectId(lookup.payment_intent);
  await transaction(async (db: RetainerDb) => {
    const { rows: [payment] } = await db.query(`SELECT * FROM payments
      WHERE stripe_charge_id=$1 OR stripe_payment_intent_id=$2 FOR UPDATE`, [chargeId, intentId]);
    if (!payment) return;
    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.currency !== payment.currency || charge.amount !== payment.gross_pence ||
        objectId(charge.payment_intent) !== payment.stripe_payment_intent_id)
      throw new Error('Refund charge does not match the payment ledger');
    let refundedPence = 0;
    for await (const refund of stripe.refunds.list({ charge: chargeId, limit: 100 })) {
      const status = refund.status === 'succeeded' ? 'succeeded' :
        refund.status === 'failed' ? 'failed' : refund.status === 'canceled' ? 'cancelled' : 'processing';
      if (status === 'succeeded') refundedPence += refund.amount;
      // Link an in-flight internal request first; Dashboard refunds need no Viewrr metadata.
      if (refund.metadata?.viewrr_refund_id) await db.query(`UPDATE payment_refunds SET stripe_refund_id=$1
        WHERE public_id=$2 AND payment_id=$3 AND (stripe_refund_id IS NULL OR stripe_refund_id=$1)`,
        [refund.id, refund.metadata.viewrr_refund_id, payment.id]);
      await db.query(`INSERT INTO payment_refunds
        (public_id,payment_id,stripe_refund_id,amount_pence,reason_code,status,requested_by,reverse_transfer,refund_application_fee,created_at,succeeded_at,failure_code,internal_note)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,'Reconciled from Stripe; actor may be outside Viewrr')
        ON CONFLICT (stripe_refund_id) DO UPDATE SET amount_pence=EXCLUDED.amount_pence,
          status=EXCLUDED.status,succeeded_at=EXCLUDED.succeeded_at,failure_code=EXCLUDED.failure_code`,
        [`refund_stripe_${refund.id}`,payment.id,refund.id,refund.amount,refund.reason ?? 'stripe_dashboard',status,
          payment.client_id,refund.transfer_reversal ? 1 : 0,new Date(refund.created*1000).toISOString(),
          status === 'succeeded' ? new Date(refund.created*1000).toISOString() : null,refund.failure_reason ?? null]);
    }
    const feeId = objectId(charge.application_fee);
    const feeRefunded = feeId ? (await stripe.applicationFees.retrieve(feeId)).amount_refunded : 0;
    const { rows: transfers } = await db.query('SELECT stripe_transfer_id FROM payment_transfers WHERE payment_id=$1',[payment.id]);
    const ids = new Set<string>(transfers.map(t => t.stripe_transfer_id));
    const directTransfer = objectId(charge.transfer);
    if (directTransfer) ids.add(directTransfer);
    let reversedPence = 0;
    for (const id of Array.from(ids)) {
      const transfer = await stripe.transfers.retrieve(id);
      reversedPence += transfer.amount_reversed;
      await db.query(`UPDATE payment_transfers SET reversed_pence=$2,status=$3,last_reconciled_at=$4
        WHERE payment_id=$1 AND stripe_transfer_id=$5`,[payment.id,transfer.amount_reversed,
        transfer.amount_reversed === transfer.amount ? 'reversed' : transfer.amount_reversed ? 'partially_reversed' : 'transferred',
        new Date().toISOString(), id]);
    }
    // A refund can arrive before the success webhook. It must never grant access or
    // mark an invoice paid; the existing verified-success handler owns fulfilment.
    await db.query(`UPDATE payments SET refunded_pence=$2,fee_refunded_pence=$3,transfer_reversed_pence=$4,
      status=CASE WHEN $2>=gross_pence THEN 'refunded' WHEN $2>0 THEN 'partially_refunded' ELSE status END,
      stripe_charge_id=$5,version=version+1 WHERE id=$1`,[payment.id,refundedPence,feeRefunded,reversedPence,chargeId]);
  });
}
