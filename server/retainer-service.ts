/**
 * PRD-008 — Server-authoritative retainer payment service.
 * Eliminates amountPence from client. Amount always derived from retainer_cycles.
 */

import { neon } from "@neondatabase/serverless";
import { VIEWRR_FEE_PERCENT, auditLog, claimStripeEvent, markEventProcessed } from "./payment-service";
import { enqueueJob } from "./job-queue";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

function getStripe() {
  const Stripe = require("stripe");
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" as any });
}

function makePublicId(prefix = "rc_pay"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface RetainerPaymentResult {
  clientSecret: string;
  paymentPublicId: string;
  paymentIntentId: string;
  amountPence: number;
  freelancerOnboarded: boolean;
  publishableKey: string;
}

/**
 * Create or reuse a server-authoritative payment for a retainer cycle.
 * The client submits ONLY cyclePublicId + clientUserId (for ownership check).
 * Amount, freelancer, and currency are derived exclusively from DB.
 */
export async function createRetainerPayment(
  cyclePublicId: string,
  clientUserId: number
): Promise<RetainerPaymentResult> {
  const db = getDb();
  const stripe = getStripe();

  // 1. Load cycle + project
  const cycleRows = await db`
    SELECT rc.*, p.client_id, p.freelancer_id, p.title AS project_title,
           ra.agreed_cycle_amount_pence, ra.title AS retainer_title,
           ra.billing_frequency, ra.currency
    FROM retainer_cycles rc
    LEFT JOIN retainer_agreements ra ON ra.id = rc.retainer_agreement_id
    JOIN projects p ON p.id = rc.project_id
    WHERE rc.public_id = ${cyclePublicId}
    LIMIT 1
  `;
  if (!cycleRows.length) throw Object.assign(new Error("Retainer cycle not found"), { status: 404 });
  const cycle = cycleRows[0];

  // 2. Ownership check — client must own this project
  if (cycle.client_id !== clientUserId) {
    throw Object.assign(new Error("You do not have permission to pay this cycle"), { status: 403 });
  }

  // 3. Verify cycle is payable
  const payableStatuses = ["due", "scheduled", "active", "awaiting_payment"];
  if (!payableStatuses.includes(cycle.status)) {
    if (cycle.status === "payment_processing" || cycle.payment_id) {
      throw Object.assign(new Error("Your payment is already being processed. You do not need to pay again."), { status: 409 });
    }
    if (cycle.status === "paid") {
      throw Object.assign(new Error("This retainer cycle has already been paid."), { status: 409 });
    }
    throw Object.assign(new Error(`Cycle cannot be paid in status: ${cycle.status}`), { status: 422 });
  }

  // 4. Derive amount from cycle (server-authoritative)
  // Use amount_pence from cycle if set, else fall back to agreement agreed_cycle_amount_pence
  const amountPence = cycle.amount_pence ?? cycle.agreed_cycle_amount_pence;
  if (!amountPence || amountPence < 50) {
    throw Object.assign(new Error("Retainer cycle amount not configured"), { status: 422 });
  }
  const currency = (cycle.currency ?? "gbp").toLowerCase();
  if (currency !== "gbp") {
    throw Object.assign(new Error("Only GBP retainer payments are supported"), { status: 422 });
  }

  // 5. Check for existing open payment (idempotency)
  const existingRows = await db`
    SELECT p.*, pm.stripe_payment_intent_id, pm.status AS pm_status
    FROM retainer_cycles rc
    JOIN payments pm ON pm.id = rc.payment_id
    JOIN retainer_cycles p ON p.id = rc.id
    WHERE rc.public_id = ${cyclePublicId} AND pm.status NOT IN ('failed','cancelled')
    LIMIT 1
  `;
  // Simpler: check payments table directly
  const existingPayment = await db`
    SELECT * FROM payments
    WHERE retainer_cycle_id = ${cycle.id}
      AND status NOT IN ('failed', 'cancelled')
    LIMIT 1
  `;
  if (existingPayment.length > 0) {
    const ep = existingPayment[0];
    if (ep.stripe_payment_intent_id) {
      // Retrieve existing intent to get fresh client_secret
      try {
        const intent = await stripe.paymentIntents.retrieve(ep.stripe_payment_intent_id);
        if (intent.status !== "canceled" && intent.status !== "succeeded") {
          return {
            clientSecret: intent.client_secret!,
            paymentPublicId: ep.public_id,
            paymentIntentId: intent.id,
            amountPence,
            freelancerOnboarded: ep.transfer_strategy === "direct_transfer",
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
          };
        }
      } catch {}
    }
  }

  // 6. Load freelancer
  const freelancerRows = await db`SELECT * FROM users WHERE id = ${cycle.freelancer_id} LIMIT 1`;
  if (!freelancerRows.length) throw new Error("Freelancer not found");
  const freelancer = freelancerRows[0];

  const clientRows = await db`SELECT * FROM users WHERE id = ${clientUserId} LIMIT 1`;
  const client = clientRows[0];

  // 7. Determine transfer strategy
  let stripeAccountId: string | null = freelancer.stripe_account_id ?? null;
  let transferStrategy: "direct_transfer" | "platform_held" = "platform_held";

  if (stripeAccountId) {
    try {
      const acct = await stripe.accounts.retrieve(stripeAccountId);
      if (acct.charges_enabled && acct.capabilities?.transfers === "active") {
        transferStrategy = "direct_transfer";
      }
    } catch {}
  }

  // 8. Calculate fees
  const platformFeePence = Math.round(amountPence * (VIEWRR_FEE_PERCENT / 100));
  const freelancerPence = amountPence - platformFeePence;

  // 9. Create internal payment record first
  const paymentPublicId = makePublicId("rc_pay");
  const idempotencyKey = `retainer_payment:${cyclePublicId}:v1`;

  const paymentRows = await db`
    INSERT INTO payments (
      public_id, project_id, retainer_cycle_id, client_id, freelancer_id,
      payment_kind, currency, gross_pence, platform_fee_pence, freelancer_pence,
      status, transfer_strategy, idempotency_key
    ) VALUES (
      ${paymentPublicId}, ${cycle.project_id}, ${cycle.id}, ${clientUserId}, ${cycle.freelancer_id},
      'retainer_cycle', 'gbp', ${amountPence}, ${platformFeePence}, ${freelancerPence},
      'pending', ${transferStrategy}, ${idempotencyKey}
    )
    ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()::TEXT
    RETURNING *
  `;
  // Handle case where column updated_at doesn't exist yet — just get the row
  const paymentRow = paymentRows[0] ?? (await db`SELECT * FROM payments WHERE idempotency_key = ${idempotencyKey} LIMIT 1`)[0];

  // 10. Create Stripe PaymentIntent
  const intentParams: any = {
    amount: amountPence,
    currency: "gbp",
    automatic_payment_methods: { enabled: true },
    receipt_email: client?.email,
    description: `${cycle.project_title ?? "Retainer"} — ${cycle.retainer_title ?? "Retainer"} Cycle ${cycle.cycle_number ?? cycle.sequence_number ?? ""}`,
    metadata: {
      viewrr_payment_id: paymentPublicId,
      projectId: String(cycle.project_id),
      cyclePublicId,
      cycleId: String(cycle.id),
      freelancerId: String(cycle.freelancer_id),
      clientUserId: String(clientUserId),
      payment_type: transferStrategy,
      viewrr_fee_pence: String(platformFeePence),
      freelancer_pence: String(freelancerPence),
      payment_kind: "retainer_cycle",
    },
  };

  if (transferStrategy === "direct_transfer" && stripeAccountId) {
    intentParams.application_fee_amount = platformFeePence;
    intentParams.transfer_data = { destination: stripeAccountId };
  }

  const intent = await stripe.paymentIntents.create(intentParams, {
    idempotencyKey: `stripe_intent:${idempotencyKey}`,
  });

  // 11. Update payment record with intent ID
  await db`
    UPDATE payments
    SET stripe_payment_intent_id = ${intent.id}, status = 'pending'
    WHERE public_id = ${paymentPublicId}
  `;

  // 12. Mark cycle as payment_processing
  await db`
    UPDATE retainer_cycles
    SET status = 'payment_processing', payment_id = ${paymentRow.id}
    WHERE public_id = ${cyclePublicId}
  `;

  await auditLog({
    paymentId: paymentRow.id,
    actorType: "user",
    actorId: clientUserId,
    action: "retainer_payment_intent_created",
    afterState: JSON.stringify({ intentId: intent.id, amountPence, cyclePublicId }),
  });

  // 13. Add timeline event
  try {
    await db`
      INSERT INTO payment_timeline_events (payment_id, event_type, visibility, title, description, amount_pence)
      VALUES (
        ${paymentRow.id}, 'payment_processing', 'both',
        'Payment initiated',
        'The client has initiated payment for this retainer cycle.',
        ${amountPence}
      )
    `;
  } catch {}

  return {
    clientSecret: intent.client_secret!,
    paymentPublicId,
    paymentIntentId: intent.id,
    amountPence,
    freelancerOnboarded: transferStrategy === "direct_transfer",
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  };
}

/**
 * Fulfil a retainer cycle payment after webhook confirms success.
 * Called by the webhook handler (handlePaymentIntentSucceeded) or job worker.
 */
export async function fulfilRetainerCyclePayment(
  paymentId: number,
  stripePaymentIntentId: string
): Promise<void> {
  const db = getDb();

  // Update cycle status to paid
  const now = new Date().toISOString();
  await db`
    UPDATE retainer_cycles
    SET status = 'paid', payment_status = 'paid', paid_at = ${now}
    WHERE payment_id = ${paymentId}
  `;

  // Add timeline event
  try {
    const payment = await db`SELECT * FROM payments WHERE id = ${paymentId} LIMIT 1`;
    if (payment.length) {
      const p = payment[0];
      await db`
        INSERT INTO payment_timeline_events (payment_id, event_type, visibility, title, description, amount_pence, source_type, source_id)
        VALUES (
          ${paymentId}, 'payment_confirmed', 'client',
          'Retainer payment confirmed',
          'Your retainer cycle payment has been confirmed by Stripe.',
          ${p.gross_pence}, 'webhook', ${stripePaymentIntentId}
        )
      `;
      await db`
        INSERT INTO payment_timeline_events (payment_id, event_type, visibility, title, description, amount_pence, source_type, source_id)
        VALUES (
          ${paymentId}, 'earnings_allocated', 'freelancer',
          'Earnings allocated',
          ${'£' + (p.freelancer_pence / 100).toFixed(2) + ' has been allocated to your Stripe balance for this retainer cycle.'},
          ${p.freelancer_pence}, 'webhook', ${stripePaymentIntentId}
        )
      `;
    }
  } catch {}
}
