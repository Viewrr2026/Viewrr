import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import {
  retainerTransaction,
  retainerPool,
  retainerError,
} from "./retainer-v1-db";
import { lockAgreement, event, notice } from "./retainer-v1-service";
import { VIEWRR_FEE_PERCENT } from "./payment-service";

let testStripe: Stripe | undefined;
export function setRetainerStripeForTesting(client: Stripe | undefined) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Test Stripe injection requires NODE_ENV=test");
  testStripe = client;
}
function stripeClient() {
  if (testStripe) return testStripe;
  if (!process.env.STRIPE_SECRET_KEY)
    retainerError("Payments are not configured", 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}
export function validateCycleIntent(
  payment: any,
  cycle: any,
  intent: Stripe.PaymentIntent,
) {
  if (
    intent.status !== "succeeded" ||
    intent.id !== payment.stripe_payment_intent_id ||
    intent.amount !== payment.gross_pence ||
    intent.amount_received !== payment.gross_pence ||
    intent.currency !== "gbp" ||
    payment.currency !== "gbp" ||
    cycle.amount_pence !== payment.gross_pence ||
    payment.invoice_id !== cycle.invoice_id ||
    payment.retainer_cycle_id !== cycle.id ||
    payment.id !== cycle.payment_id ||
    intent.metadata.viewrr_payment_id !== payment.public_id ||
    intent.metadata.cyclePublicId !== cycle.public_id ||
    intent.metadata.clientUserId !== String(payment.client_id)
  )
    throw new Error("Cycle payment verification failed");
}
export async function createCustomCyclePayment(
  cyclePublicId: string,
  userId: number,
) {
  const stripe = stripeClient();
  const existing = (
    await retainerPool().query(
      `SELECT pm.* FROM payments pm JOIN retainer_cycles c ON c.id=pm.retainer_cycle_id JOIN retainer_agreements a ON a.id=c.retainer_agreement_id WHERE c.public_id=$1 AND a.client_id=$2 ORDER BY pm.id DESC LIMIT 1`,
      [cyclePublicId, userId],
    )
  ).rows[0];
  if (existing?.stripe_payment_intent_id) {
    const intent = await stripe.paymentIntents.retrieve(
      existing.stripe_payment_intent_id,
    );
    if (intent.status === "succeeded")
      retainerError("Payment received. Waiting for verified confirmation.");
    if (intent.status === "canceled")
      await retainerPool().query(
        "UPDATE payments SET status='cancelled' WHERE id=$1 AND status NOT IN ('succeeded','refunded','partially_refunded')",
        [existing.id],
      );
  }
  const record = await retainerTransaction(async (db) => {
    const match = (
      await db.query(
        `SELECT a.public_id FROM retainer_cycles c JOIN retainer_agreements a ON a.id=c.retainer_agreement_id WHERE c.public_id=$1`,
        [cyclePublicId],
      )
    ).rows[0];
    if (!match) retainerError("Cycle not found", 404);
    const a = await lockAgreement(db, match.public_id, userId);
    if (userId !== a.client_id) retainerError("Only the client can pay", 403);
    const c = (
      await db.query("SELECT * FROM retainer_cycles WHERE public_id=$1", [
        cyclePublicId,
      ])
    ).rows[0];
    if (!c.accepted_at || !c.invoice_id || c.paid_at)
      retainerError("This cycle is not awaiting payment");
    const previous = (
      await db.query(
        "SELECT * FROM payments WHERE retainer_cycle_id=$1 ORDER BY id DESC LIMIT 1",
        [c.id],
      )
    ).rows[0];
    if (previous && previous.status !== "cancelled") return previous;
    const freelancer = (
      await db.query("SELECT stripe_account_id FROM users WHERE id=$1", [
        a.freelancer_id,
      ])
    ).rows[0];
    if (!freelancer?.stripe_account_id)
      retainerError(
        "The freelancer needs to finish payout setup before payment",
        422,
      );
    const account = await stripe.accounts.retrieve(
      freelancer.stripe_account_id,
    );
    if (
      !account.charges_enabled ||
      account.capabilities?.transfers !== "active"
    )
      retainerError(
        "The freelancer needs to finish payout setup before payment",
        422,
      );
    const publicId = `rc_pay_${randomUUID()}`,
      key = `custom-cycle:${c.public_id}:${randomUUID()}`;
    const fee = Math.round((c.amount_pence * VIEWRR_FEE_PERCENT) / 100);
    const params = {
      amount: c.amount_pence,
      currency: "gbp",
      automatic_payment_methods: { enabled: true },
      application_fee_amount: fee,
      transfer_data: { destination: freelancer.stripe_account_id },
      description: `${a.title} — ${c.cycle_name}`,
      metadata: {
        viewrr_payment_id: publicId,
        cyclePublicId: c.public_id,
        cycleId: String(c.id),
        clientUserId: String(a.client_id),
        freelancerId: String(a.freelancer_id),
        projectId: String(a.project_id),
        payment_kind: "retainer_cycle",
      },
    };
    const p = (
      await db.query(
        `INSERT INTO payments(public_id,project_id,invoice_id,retainer_cycle_id,client_id,freelancer_id,payment_kind,currency,gross_pence,platform_fee_pence,freelancer_pence,status,transfer_strategy,idempotency_key,retainer_intent_params) VALUES($1,$2,$3,$4,$5,$6,'retainer_cycle','gbp',$7,$8,$9,'pending','direct_transfer',$10,$11) RETURNING *`,
        [
          publicId,
          a.project_id,
          c.invoice_id,
          c.id,
          a.client_id,
          a.freelancer_id,
          c.amount_pence,
          fee,
          c.amount_pence - fee,
          key,
          JSON.stringify(params),
        ],
      )
    ).rows[0];
    await db.query("UPDATE retainer_cycles SET payment_id=$2 WHERE id=$1", [
      c.id,
      p.id,
    ]);
    return p;
  });
  if (
    !record.stripe_payment_intent_id &&
    Date.now() - new Date(record.created_at).getTime() > 23 * 60 * 60 * 1000
  )
    retainerError(
      "This payment attempt needs reconciliation before retrying. Contact support.",
    );
  const intent = record.stripe_payment_intent_id
    ? await stripe.paymentIntents.retrieve(record.stripe_payment_intent_id)
    : await stripe.paymentIntents.create(record.retainer_intent_params, {
        idempotencyKey: record.idempotency_key,
      });
  await retainerPool().query(
    "UPDATE payments SET stripe_payment_intent_id=$2 WHERE id=$1 AND (stripe_payment_intent_id IS NULL OR stripe_payment_intent_id=$2)",
    [record.id, intent.id],
  );
  if (intent.status === "processing")
    retainerError("Payment is still processing. You do not need to pay again.");
  if (["succeeded", "canceled"].includes(intent.status))
    retainerError(
      "This payment attempt is no longer payable. Refresh its status.",
    );
  return {
    clientSecret: intent.client_secret,
    paymentPublicId: record.public_id,
    paymentIntentId: intent.id,
    amountPence: record.gross_pence,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  };
}
// Called only from the existing signature-verified Stripe event processor.
export async function fulfilCustomCyclePayment(
  intent: Stripe.PaymentIntent,
): Promise<boolean> {
  const rows = await retainerPool().query(
    `SELECT a.public_id FROM payments p JOIN retainer_cycles c ON c.id=p.retainer_cycle_id JOIN retainer_agreements a ON a.id=c.retainer_agreement_id WHERE p.public_id=$1 AND a.workflow_version=1`,
    [intent.metadata?.viewrr_payment_id ?? ""],
  );
  if (!rows.rows.length) return false;
  return retainerTransaction(async (db) => {
    const a = await lockAgreement(db, rows.rows[0].public_id);
    const p = (
      await db.query("SELECT * FROM payments WHERE public_id=$1 FOR UPDATE", [
        intent.metadata.viewrr_payment_id,
      ])
    ).rows[0];
    const c = (
      await db.query("SELECT * FROM retainer_cycles WHERE id=$1", [
        p.retainer_cycle_id,
      ])
    ).rows[0];
    validateCycleIntent(p, c, intent);
    if (c.paid_at) return true;
    if (
      !c.accepted_at ||
      p.client_id !== a.client_id ||
      p.freelancer_id !== a.freelancer_id ||
      p.project_id !== a.project_id
    )
      throw new Error("Cycle agreement does not match payment");
    // A late success event must not overwrite refund state.
    if (["refunded", "partially_refunded"].includes(p.status)) return true;
    const now = new Date().toISOString(),
      charge =
        typeof intent.latest_charge === "string"
          ? intent.latest_charge
          : (intent.latest_charge?.id ?? null);
    await db.query(
      "UPDATE payments SET status='succeeded',succeeded_at=$2,stripe_charge_id=$3,version=version+1 WHERE id=$1",
      [p.id, now, charge],
    );
    await db.query("UPDATE invoices SET status='paid',paid_at=$2 WHERE id=$1", [
      c.invoice_id,
      now,
    ]);
    await db.query(
      "UPDATE retainer_cycles SET status='paid',payment_status='paid',paid_at=$2 WHERE id=$1",
      [c.id, now],
    );
    await db.query(
      "INSERT INTO payment_audit_log(payment_id,actor_type,action,after_state,correlation_id) VALUES($1,'webhook','retainer_payment_verified',$2,$3)",
      [p.id, JSON.stringify({ status: "succeeded", cycleId: c.id }), intent.id],
    );
    await db.query(
      `INSERT INTO payment_timeline_events(payment_id,event_type,visibility,title,description,amount_pence,source_type,source_id)
       VALUES($1,'payment_confirmed','both','Cycle payment confirmed','Payment verified. Clean files for this cycle are available. Bank payout timing is separate.',$2,'webhook',$3)`,
      [p.id, p.gross_pence, intent.id],
    );
    await event(db, a, null, `payment:${p.id}`, "cycle_payment_verified", {
      cycleId: c.id,
      paymentId: p.id,
    });
    await notice(
      db,
      a,
      `payment:${p.id}`,
      `${c.cycle_name}: payment confirmed; this cycle is complete.${c.freeze_notified_at ? " The overdue-payment restriction has been lifted. Other schedule or agreement restrictions still apply." : ""}`,
    );
    return true;
  });
}
