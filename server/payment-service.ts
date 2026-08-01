/**
 * PRD-007 — Viewrr Payment Domain Services
 *
 * Server-authoritative, webhook-driven, idempotent payment processing.
 * All financial amounts derived from DB records — never from client input.
 *
 * Auth note: Viewrr uses stateless auth (no server sessions).
 * userId must be supplied by callers but is always validated against
 * DB project ownership before any financial action proceeds.
 * FR-02 policies are enforced by explicit ownership checks in each method.
 */

import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import * as schema from "@shared/schema";

// ── Constants ──────────────────────────────────────────────────────────────
export const VIEWRR_FEE_PERCENT = 11;
const DB_URL = process.env.DATABASE_URL!;

// ── Stripe client (lazy — only if key present) ─────────────────────────────
function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" as any });
}

// ── DB client ──────────────────────────────────────────────────────────────
function getDb() {
  const sqlClient = neon(DB_URL);
  return drizzle(sqlClient, { schema });
}

// ── Nano ID generator (deterministic-safe, no Date.now()) ─────────────────
function makePublicId(prefix = "pay_vrr"): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}_${id}`;
}

// ── Audit logger ───────────────────────────────────────────────────────────
export async function auditLog(entry: {
  paymentId?: number;
  actorType: "system" | "user" | "admin" | "webhook";
  actorId?: number;
  action: string;
  beforeState?: object;
  afterState?: object;
  reason?: string;
  correlationId?: string;
}) {
  try {
    const db = getDb();
    await db.insert(schema.paymentAuditLog).values({
      paymentId: entry.paymentId ?? null,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      beforeState: entry.beforeState ? JSON.stringify(entry.beforeState) : null,
      afterState: entry.afterState ? JSON.stringify(entry.afterState) : null,
      reason: entry.reason ?? null,
      correlationId: entry.correlationId ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (e: any) {
    // Audit log failure must never break payment flow
    console.error("[audit] Failed to write log:", e.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FR-13: Connect Readiness Model
// ────────────────────────────────────────────────────────────────────────────

export type ConnectReadinessState =
  | "not_created"
  | "onboarding_required"
  | "verification_pending"
  | "transfers_ready"
  | "payouts_ready"
  | "restricted"
  | "disabled";

function deriveReadinessState(acct: Stripe.Account): ConnectReadinessState {
  if (!acct.details_submitted) return "onboarding_required";
  if (acct.requirements?.disabled_reason) return "disabled";
  if ((acct.requirements?.past_due ?? []).length > 0) return "restricted";
  const chargesOk = acct.charges_enabled === true;
  const transfersOk = (acct.capabilities as any)?.transfers === "active";
  const payoutsOk = acct.payouts_enabled === true;
  if (chargesOk && transfersOk && payoutsOk) return "payouts_ready";
  if (chargesOk && transfersOk) return "transfers_ready";
  if (acct.details_submitted) return "verification_pending";
  return "onboarding_required";
}

export async function syncConnectAccount(
  userId: number,
  stripeAccountId: string
): Promise<schema.StripeConnectAccount> {
  const stripe = getStripe();
  const db = getDb();
  const acct = await stripe.accounts.retrieve(stripeAccountId);
  const readinessState = deriveReadinessState(acct);

  const values = {
    userId,
    stripeAccountId,
    readinessState,
    detailsSubmitted: acct.details_submitted ? 1 : 0,
    chargesEnabled: acct.charges_enabled ? 1 : 0,
    payoutsEnabled: acct.payouts_enabled ? 1 : 0,
    transfersCapability: (acct.capabilities as any)?.transfers ?? "inactive",
    currentlyDue: JSON.stringify(acct.requirements?.currently_due ?? []),
    eventuallyDue: JSON.stringify(acct.requirements?.eventually_due ?? []),
    pastDue: JSON.stringify(acct.requirements?.past_due ?? []),
    pendingVerification: JSON.stringify(acct.requirements?.pending_verification ?? []),
    disabledReason: acct.requirements?.disabled_reason ?? null,
    payoutSchedule: acct.settings?.payouts?.schedule
      ? JSON.stringify(acct.settings.payouts.schedule)
      : null,
    lastSyncedAt: new Date().toISOString(),
  };

  // Upsert
  const existing = await db
    .select()
    .from(schema.stripeConnectAccounts)
    .where(eq(schema.stripeConnectAccounts.userId, userId));

  if (existing.length > 0) {
    const r = await db
      .update(schema.stripeConnectAccounts)
      .set({ ...values, lastSyncedAt: new Date().toISOString() })
      .where(eq(schema.stripeConnectAccounts.userId, userId))
      .returning();
    return r[0];
  }

  const r = await db
    .insert(schema.stripeConnectAccounts)
    .values({ ...values, createdAt: new Date().toISOString() })
    .returning();
  return r[0];
}

// ────────────────────────────────────────────────────────────────────────────
// FR-01, FR-02, FR-04, FR-07, FR-14: Payment Creation Service
// ────────────────────────────────────────────────────────────────────────────

export interface CreatePaymentResult {
  paymentId: number;
  publicId: string;
  clientSecret: string;
  amountPence: number;
  currency: "gbp";
  status: string;
  publishableKey: string;
}

/**
 * Server-authoritative payment creation.
 * Amount, currency, parties and fee all derived from DB — never from client.
 *
 * @param projectId  - the project being paid for
 * @param invoiceId  - the invoice to pay
 * @param actingUserId - the authenticated user making the request (validated as project client)
 */
export async function createPayment(
  projectId: number,
  invoiceId: number,
  actingUserId: number
): Promise<CreatePaymentResult> {
  const stripe = getStripe();
  const db = getDb();

  // 1. Load and validate project (FR-02: ownership check)
  const projectRows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  if (!projectRows.length) throw Object.assign(new Error("Project not found"), { status: 404 });

  const project = projectRows[0];

  // FR-02: acting user must be the project's client
  if (project.clientId !== actingUserId)
    throw Object.assign(new Error("You are not authorised to pay this project"), { status: 403 });

  // 2. Load and validate invoice (FR-01: amount from DB)
  const invoiceRows = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId));
  if (!invoiceRows.length) throw Object.assign(new Error("Invoice not found"), { status: 404 });

  const invoice = invoiceRows[0];

  // Validate invoice belongs to this project and is payable
  if (invoice.projectId !== projectId)
    throw Object.assign(new Error("Invoice does not belong to this project"), { status: 400 });
  if (invoice.clientId !== actingUserId)
    throw Object.assign(new Error("Invoice not addressed to you"), { status: 403 });
  if (invoice.status === "paid")
    throw Object.assign(new Error("Invoice is already paid"), { status: 409 });
  if (invoice.status === "cancelled")
    throw Object.assign(new Error("Invoice has been cancelled"), { status: 409 });
  if (invoice.totalPence <= 0)
    throw Object.assign(new Error("Invoice amount must be greater than zero"), { status: 400 });

  // 3. Check for existing pending payment for this invoice (idempotency)
  const existingPayment = await db
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.invoiceId, invoiceId),
        eq(schema.payments.status, "pending")
      )
    );

  // Return existing pending payment's client secret if one exists
  if (existingPayment.length > 0) {
    const ep = existingPayment[0];
    if (ep.stripePaymentIntentId) {
      try {
        const existingIntent = await stripe.paymentIntents.retrieve(ep.stripePaymentIntentId);
        if (
          existingIntent.status === "requires_payment_method" ||
          existingIntent.status === "requires_confirmation"
        ) {
          return {
            paymentId: ep.id,
            publicId: ep.publicId,
            clientSecret: existingIntent.client_secret!,
            amountPence: ep.grossPence,
            currency: "gbp",
            status: existingIntent.status,
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
          };
        }
      } catch { /* intent may be expired — fall through to create new */ }
    }
  }

  // 4. Server-derived amounts (FR-01)
  const grossPence = invoice.totalPence;
  const platformFeePence = Math.round(grossPence * (VIEWRR_FEE_PERCENT / 100));
  const freelancerPence = grossPence - platformFeePence;

  // 5. Load freelancer and check Connect readiness (FR-14: no silent account creation)
  const freelancerRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, project.freelancerId));
  if (!freelancerRows.length) throw Object.assign(new Error("Freelancer not found"), { status: 404 });

  const freelancer = freelancerRows[0];
  const clientRows = await db.select().from(schema.users).where(eq(schema.users.id, actingUserId));
  const client = clientRows[0];

  // FR-02 (PRD-010): platform_held removed — destination charges only.
  // FR-03 (PRD-010): Freelancer MUST be Stripe-ready before any payment proceeds.
  // Readiness gate is enforced at invoice issuance; this is the final check.
  const stripeAccountId = freelancer.stripeAccountId;
  const transferStrategy: "direct_transfer" = "direct_transfer";

  if (!stripeAccountId) {
    throw Object.assign(
      new Error("Freelancer has not connected Stripe. Payment cannot proceed."),
      { status: 402 }
    );
  }

  // Verify readiness
  try {
    const connectAcct = await stripe.accounts.retrieve(stripeAccountId);
    const isReady =
      connectAcct.charges_enabled === true &&
      (connectAcct.capabilities as any)?.transfers === "active";
    if (!isReady) {
      throw Object.assign(
        new Error("Freelancer Stripe account is not ready to receive payments."),
        { status: 402 }
      );
    }
  } catch (e: any) {
    if (e.status === 402) throw e;
    throw Object.assign(
      new Error("Could not verify freelancer Stripe readiness."),
      { status: 502 }
    );
  }

  // 6. Create internal payment record BEFORE Stripe call (FR-04)
  const publicId = makePublicId("pay_vrr");
  const idempotencyKey = `payment_intent:${publicId}:v1`;

  const paymentInsert = await db.insert(schema.payments).values({
    publicId,
    projectId,
    invoiceId,
    clientId: actingUserId,
    freelancerId: project.freelancerId,
    paymentKind: "one_off",
    currency: "gbp",
    grossPence,
    platformFeePence,
    freelancerPence,
    status: "pending",
    transferStrategy,
    idempotencyKey,
    createdAt: new Date().toISOString(),
    version: 1,
  }).returning();

  const paymentRecord = paymentInsert[0];

  await auditLog({
    paymentId: paymentRecord.id,
    actorType: "user",
    actorId: actingUserId,
    action: "payment_created",
    afterState: { publicId, grossPence, transferStrategy },
  });

  // 7. Create Stripe PaymentIntent (FR-07: deterministic idempotency key)
  const intentParams: Stripe.PaymentIntentCreateParams = {
    amount: grossPence,
    currency: "gbp",
    automatic_payment_methods: { enabled: true },
    receipt_email: client?.email,
    description: `Viewrr: ${project.title}`,
    // Minimal metadata — only non-sensitive correlation values (FR-04)
    metadata: {
      viewrr_payment_id: publicId,
      project_id: String(projectId),
      invoice_id: String(invoiceId),
      client_id: String(actingUserId),
      freelancer_id: String(project.freelancerId),
      payment_kind: "one_off",
      transfer_strategy: transferStrategy,
    },
    // FR-04 (PRD-010): on_behalf_of for clear merchant attribution
    application_fee_amount: platformFeePence,
    transfer_data: { destination: stripeAccountId },
    on_behalf_of: stripeAccountId,
  };

  const intent = await stripe.paymentIntents.create(intentParams, {
    idempotencyKey,
  });

  // 8. Bind Stripe intent ID to internal payment record
  await db
    .update(schema.payments)
    .set({
      stripePaymentIntentId: intent.id,
      status: "requires_payment_method",
      authorisedAt: new Date().toISOString(),
    })
    .where(eq(schema.payments.id, paymentRecord.id));

  await auditLog({
    paymentId: paymentRecord.id,
    actorType: "system",
    action: "stripe_intent_created",
    afterState: { stripePaymentIntentId: intent.id, status: "requires_payment_method" },
  });

  return {
    paymentId: paymentRecord.id,
    publicId,
    clientSecret: intent.client_secret!,
    amountPence: grossPence,
    currency: "gbp",
    status: intent.status,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// FR-03, FR-09, FR-10: Webhook Fulfilment Service
// ────────────────────────────────────────────────────────────────────────────

/**
 * Claim a Stripe event idempotently.
 * Returns true if the event was newly claimed and should be processed.
 * Returns false if already processed (duplicate delivery — return 200 silently).
 */
export async function claimStripeEvent(
  eventId: string,
  eventType: string,
  livemode: boolean,
  apiVersion: string
): Promise<boolean> {
  const db = getDb();

  try {
    await db.insert(schema.stripeEvents).values({
      stripeEventId: eventId,
      eventType,
      livemode: livemode ? 1 : 0,
      apiVersion,
      processingStatus: "received",
      attemptCount: 1,
      receivedAt: new Date().toISOString(),
    });
    return true; // newly claimed
  } catch (e: any) {
    // Unique constraint violation = already received
    if (e.message?.includes("unique") || e.code === "23505") {
      const existing = await db
        .select()
        .from(schema.stripeEvents)
        .where(eq(schema.stripeEvents.stripeEventId, eventId));
      if (existing[0]?.processingStatus === "processed") return false;
      // Failed events can be retried — return true
      return true;
    }
    throw e;
  }
}

export async function markEventProcessed(eventId: string, error?: string) {
  const db = getDb();
  await db
    .update(schema.stripeEvents)
    .set({
      processingStatus: error ? "failed" : "processed",
      processedAt: new Date().toISOString(),
      errorCode: error ? "processing_error" : null,
      errorSummary: error ?? null,
    })
    .where(eq(schema.stripeEvents.stripeEventId, eventId));
}

/**
 * Handle payment_intent.succeeded — the authoritative fulfilment handler (FR-03).
 * Browser confirmation is non-authoritative; this webhook is the source of truth.
 */
export async function handlePaymentIntentSucceeded(
  intent: Stripe.PaymentIntent,
  correlationId: string
): Promise<void> {
  const db = getDb();
  const stripe = getStripe();

  const viewrrPaymentId = intent.metadata?.viewrr_payment_id;
  if (!viewrrPaymentId) {
    console.warn("[webhook] payment_intent.succeeded without viewrr_payment_id — skipping");
    return;
  }

  // Load internal payment record
  const paymentRows = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.publicId, viewrrPaymentId));

  if (!paymentRows.length) {
    console.error("[webhook] No internal payment record for:", viewrrPaymentId);
    throw new Error(`Internal payment record not found: ${viewrrPaymentId}`);
  }

  const payment = paymentRows[0];

  // Idempotency: if already succeeded, skip
  if (payment.status === "succeeded") {
    console.log("[webhook] payment_intent.succeeded already processed:", viewrrPaymentId);
    return;
  }

  // FR-04: Validate intent matches internal record
  if (payment.stripePaymentIntentId !== intent.id)
    throw new Error(`Intent ID mismatch: ${intent.id} vs ${payment.stripePaymentIntentId}`);
  if (intent.amount !== payment.grossPence)
    throw new Error(`Amount mismatch: ${intent.amount} vs ${payment.grossPence}`);
  if (intent.currency !== "gbp")
    throw new Error(`Currency mismatch: ${intent.currency}`);

  // Get charge details for fee recording (FR-18)
  let chargeId: string | null = null;
  let balanceTxId: string | null = null;
  let stripeFeePence: number | null = null;
  let applicationFeeId: string | null = null;

  try {
    const chargeIdRaw = typeof intent.latest_charge === "string"
      ? intent.latest_charge
      : (intent.latest_charge as any)?.id;

    if (chargeIdRaw) {
      chargeId = chargeIdRaw;
      const charge = await stripe.charges.retrieve(chargeId, {
        expand: ["balance_transaction", "application_fee"],
      });

      const bt = charge.balance_transaction as Stripe.BalanceTransaction | null;
      if (bt) {
        balanceTxId = bt.id;
        stripeFeePence = bt.fee;
      }

      const appFee = charge.application_fee as Stripe.ApplicationFee | null;
      if (appFee) applicationFeeId = appFee.id;
    }
  } catch (e: any) {
    console.warn("[webhook] Could not retrieve charge details (non-fatal):", e.message);
  }

  const netPlatformRevenuePence =
    stripeFeePence !== null
      ? payment.platformFeePence - stripeFeePence
      : null;

  // Update payment to succeeded
  await db
    .update(schema.payments)
    .set({
      status: "succeeded",
      stripeChargeId: chargeId,
      stripeBalanceTransactionId: balanceTxId,
      stripeFeePence,
      netPlatformRevenuePence,
      stripeApplicationFeeId: applicationFeeId,
      succeededAt: new Date().toISOString(),
      version: payment.version + 1,
    })
    .where(
      and(
        eq(schema.payments.id, payment.id),
        eq(schema.payments.version, payment.version) // optimistic lock
      )
    );

  await auditLog({
    paymentId: payment.id,
    actorType: "webhook",
    action: "payment_intent_succeeded",
    beforeState: { status: payment.status },
    afterState: { status: "succeeded", stripeChargeId: chargeId },
    correlationId,
  });

  // Mark invoice paid (FR-15: update financial state only)
  if (payment.invoiceId) {
    try {
      await db
        .update(schema.invoices)
        .set({ status: "paid", paidAt: new Date().toISOString() })
        .where(eq(schema.invoices.id, payment.invoiceId));
    } catch (e: any) {
      console.error("[webhook] Invoice update failed:", e.message);
    }
  }

  // Update project payment status (financial state only — FR-15)
  // Project status itself (completed) must follow separate domain rules
  await db
    .update(schema.projects)
    .set({ paymentStatus: "paid" })
    .where(eq(schema.projects.id, payment.projectId));

  // FR-02 (PRD-010): Destination charge — Stripe handles transfer automatically via transfer_data.
  // Log confirmation; no manual transfer needed.
  await auditLog({
    paymentId: payment.id,
    actorType: "webhook",
    action: "destination_transfer_confirmed",
    afterState: { transferStrategy: "direct_transfer", stripeChargeId: chargeId },
    correlationId,
  });

  // Send accurate notifications (FR-16)
  await sendPaymentNotifications(payment, "succeeded");
}

// ────────────────────────────────────────────────────────────────────────────
// FR-04, FR-08: Transfer Service
// ────────────────────────────────────────────────────────────────────────────

async function handleTransfer(
  payment: schema.Payment,
  chargeId: string | null,
  correlationId: string
): Promise<void> {
  const db = getDb();
  const stripe = getStripe();

  const freelancerRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, payment.freelancerId));
  const freelancer = freelancerRows[0];

  if (!freelancer?.stripeAccountId) {
    // No Stripe account — record obligation in ledger (not stripePendingPence)
    await auditLog({
      paymentId: payment.id,
      actorType: "system",
      action: "transfer_deferred_no_account",
      reason: "Freelancer has no Stripe account — holding in ledger",
      afterState: { freelancerPence: payment.freelancerPence },
      correlationId,
    });
    return;
  }

  // Check Connect readiness
  let isReady = false;
  try {
    const acct = await stripe.accounts.retrieve(freelancer.stripeAccountId);
    isReady =
      acct.charges_enabled === true &&
      (acct.capabilities as any)?.transfers === "active";
  } catch { /* assume not ready */ }

  if (!isReady) {
    // Record as pending in ledger
    await auditLog({
      paymentId: payment.id,
      actorType: "system",
      action: "transfer_deferred_not_ready",
      reason: "Freelancer not yet fully onboarded",
      afterState: { freelancerPence: payment.freelancerPence },
      correlationId,
    });
    return;
  }

  // FR-07: Deterministic idempotency key (no Date.now())
  const transferIdempotencyKey = `transfer:${payment.publicId}:v1`;

  try {
    const transfer = await stripe.transfers.create(
      {
        amount: payment.freelancerPence,
        currency: "gbp",
        destination: freelancer.stripeAccountId,
        source_transaction: chargeId ?? undefined,
        description: `Viewrr earnings for payment ${payment.publicId}`,
        metadata: {
          viewrr_payment_id: payment.publicId,
          project_id: String(payment.projectId),
          freelancer_id: String(payment.freelancerId),
        },
      },
      { idempotencyKey: transferIdempotencyKey }
    );

    // Record transfer in ledger
    await db.insert(schema.paymentTransfers).values({
      paymentId: payment.id,
      stripeTransferId: transfer.id,
      destinationAccountId: freelancer.stripeAccountId,
      amountPence: payment.freelancerPence,
      status: "transferred",
      createdAt: new Date().toISOString(),
      reversedPence: 0,
    });

    await auditLog({
      paymentId: payment.id,
      actorType: "system",
      action: "transfer_created",
      afterState: { stripeTransferId: transfer.id, amountPence: payment.freelancerPence },
      correlationId,
    });
  } catch (e: any) {
    // Record failure — do NOT update stripePendingPence aggregate (FR-08)
    await db.insert(schema.paymentTransfers).values({
      paymentId: payment.id,
      stripeTransferId: `failed_${payment.publicId}`,
      destinationAccountId: freelancer.stripeAccountId,
      amountPence: payment.freelancerPence,
      status: "failed",
      failureCode: e.code ?? "unknown",
      createdAt: new Date().toISOString(),
      reversedPence: 0,
    }).catch(() => {});

    await auditLog({
      paymentId: payment.id,
      actorType: "system",
      action: "transfer_failed",
      reason: e.message,
      afterState: { failureCode: e.code },
      correlationId,
    });

    console.error("[transfer] Failed:", e.message);
  }
}

/**
 * @deprecated PRD-010 FR-02: platform_held removed. This function is a no-op kept for
 * backward compatibility with existing webhook handlers until the next cleanup sprint.
 */
export async function releaseHeldEarnings(
  userId: number,
  stripeAccountId: string,
  correlationId: string
): Promise<void> {
  const db = getDb();
  const stripe = getStripe();

  // Derive held earnings from ledger (FR-08) — NOT stripePendingPence
  const pendingPayments = await db
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.freelancerId, userId),
        eq(schema.payments.status, "succeeded"),
        eq(schema.payments.transferStrategy, "platform_held")
      )
    );

  // Find payments with no successful transfer yet
  const pendingTransfers = [];
  for (const p of pendingPayments) {
    const transfers = await db
      .select()
      .from(schema.paymentTransfers)
      .where(
        and(
          eq(schema.paymentTransfers.paymentId, p.id),
          eq(schema.paymentTransfers.status, "transferred")
        )
      );
    if (!transfers.length) pendingTransfers.push(p);
  }

  for (const payment of pendingTransfers) {
    const transferIdempotencyKey = `transfer:${payment.publicId}:v1`;

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: payment.freelancerPence,
          currency: "gbp",
          destination: stripeAccountId,
          description: `Viewrr held earnings release for payment ${payment.publicId}`,
          metadata: {
            viewrr_payment_id: payment.publicId,
            type: "held_earnings_release",
          },
        },
        { idempotencyKey: transferIdempotencyKey }
      );

      await db.insert(schema.paymentTransfers).values({
        paymentId: payment.id,
        stripeTransferId: transfer.id,
        destinationAccountId: stripeAccountId,
        amountPence: payment.freelancerPence,
        status: "transferred",
        createdAt: new Date().toISOString(),
        reversedPence: 0,
      });

      await auditLog({
        paymentId: payment.id,
        actorType: "webhook",
        action: "held_earnings_released",
        afterState: { stripeTransferId: transfer.id, amountPence: payment.freelancerPence },
        correlationId,
      });
    } catch (e: any) {
      console.error("[release] Transfer failed for payment", payment.publicId, e.message);
      await auditLog({
        paymentId: payment.id,
        actorType: "webhook",
        action: "held_earnings_release_failed",
        reason: e.message,
        correlationId,
      });
    }
  }

  // Sync Connect account state
  await syncConnectAccount(userId, stripeAccountId);

  // Update legacy stripeOnboarded flag for backward compat
  await db
    .update(schema.users)
    .set({ stripeOnboarded: 1 })
    .where(eq(schema.users.id, userId));
}

// ────────────────────────────────────────────────────────────────────────────
// FR-05: Refund Service
// ────────────────────────────────────────────────────────────────────────────

export interface RefundRequest {
  paymentPublicId: string;
  amountPence: number;
  reasonCode: string;
  internalNote?: string;
  requestedBy: number;  // admin user ID
  notifyParties?: boolean;
}

const VALID_REASON_CODES = [
  "client_cancellation",
  "defective_work",
  "duplicate",
  "fraud",
  "admin_goodwill",
  "statutory_right",
];

export async function initiateRefund(req: RefundRequest): Promise<schema.PaymentRefund> {
  const db = getDb();
  const stripe = getStripe();

  if (!VALID_REASON_CODES.includes(req.reasonCode))
    throw Object.assign(new Error(`Invalid reason code: ${req.reasonCode}`), { status: 400 });

  // Load payment
  const paymentRows = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.publicId, req.paymentPublicId));
  if (!paymentRows.length)
    throw Object.assign(new Error("Payment not found"), { status: 404 });

  const payment = paymentRows[0];

  if (payment.status !== "succeeded")
    throw Object.assign(new Error("Can only refund a succeeded payment"), { status: 409 });

  // Calculate maximum refundable (gross minus already refunded)
  const existingRefunds = await db
    .select()
    .from(schema.paymentRefunds)
    .where(
      and(
        eq(schema.paymentRefunds.paymentId, payment.id),
        eq(schema.paymentRefunds.status, "succeeded")
      )
    );
  const alreadyRefundedPence = existingRefunds.reduce((sum, r) => sum + r.amountPence, 0);
  const maxRefundable = payment.grossPence - alreadyRefundedPence;

  if (req.amountPence > maxRefundable)
    throw Object.assign(
      new Error(`Maximum refundable is £${(maxRefundable / 100).toFixed(2)}`),
      { status: 400 }
    );
  if (req.amountPence <= 0)
    throw Object.assign(new Error("Refund amount must be greater than zero"), { status: 400 });

  const isFullRefund = req.amountPence === payment.grossPence;
  const refundPublicId = makePublicId("ref_vrr");
  const refundIdempotencyKey = `refund:${refundPublicId}:v1`;

  // Create refund record in DB
  const refundInsert = await db.insert(schema.paymentRefunds).values({
    publicId: refundPublicId,
    paymentId: payment.id,
    amountPence: req.amountPence,
    reasonCode: req.reasonCode,
    status: "approved",
    reverseTransfer: 1,          // Always reverse transfer for now
    refundApplicationFee: isFullRefund ? 0 : 0, // Stripe fee not refunded by default
    requestedBy: req.requestedBy,
    approvedBy: req.requestedBy, // Admin self-approves (can be separated)
    internalNote: req.internalNote ?? null,
    idempotencyKey: refundIdempotencyKey,
    createdAt: new Date().toISOString(),
  }).returning();

  const refundRecord = refundInsert[0];

  await auditLog({
    paymentId: payment.id,
    actorType: "admin",
    actorId: req.requestedBy,
    action: "refund_approved",
    afterState: { refundPublicId, amountPence: req.amountPence, reasonCode: req.reasonCode },
    reason: req.internalNote,
  });

  // Submit to Stripe
  if (!payment.stripeChargeId) {
    // Update status and bail — manual recovery required
    await db
      .update(schema.paymentRefunds)
      .set({ status: "manual_recovery_required", failureCode: "no_charge_id" })
      .where(eq(schema.paymentRefunds.id, refundRecord.id));
    throw new Error("No charge ID — manual refund required");
  }

  try {
    await db
      .update(schema.paymentRefunds)
      .set({ status: "submitted_to_stripe" })
      .where(eq(schema.paymentRefunds.id, refundRecord.id));

    const refundParams: Stripe.RefundCreateParams = {
      charge: payment.stripeChargeId,
      amount: req.amountPence,
      reason: mapReasonCode(req.reasonCode),
      metadata: {
        viewrr_refund_id: refundPublicId,
        viewrr_payment_id: payment.publicId,
        reason_code: req.reasonCode,
      },
      // FR-05: reverse_transfer for destination charges
      reverse_transfer: true,
    };

    const stripeRefund = await stripe.refunds.create(refundParams, {
      idempotencyKey: refundIdempotencyKey,
    });

    // Update refund record with Stripe data
    const newStatus =
      stripeRefund.status === "succeeded"
        ? "succeeded"
        : stripeRefund.status === "failed"
        ? "failed"
        : "processing";

    await db
      .update(schema.paymentRefunds)
      .set({
        stripeRefundId: stripeRefund.id,
        status: newStatus,
        succeededAt: newStatus === "succeeded" ? new Date().toISOString() : null,
        failureCode: newStatus === "failed" ? (stripeRefund.failure_reason ?? null) : null,
      })
      .where(eq(schema.paymentRefunds.id, refundRecord.id));

    // Update payment status
    const newPaymentStatus =
      req.amountPence === payment.grossPence ? "refunded" : "partially_refunded";
    await db
      .update(schema.payments)
      .set({ status: newPaymentStatus, version: payment.version + 1 })
      .where(eq(schema.payments.id, payment.id));

    await auditLog({
      paymentId: payment.id,
      actorType: "system",
      action: "refund_submitted",
      afterState: { stripeRefundId: stripeRefund.id, status: newStatus },
    });

    // Notify parties (FR-16: accurate messaging)
    if (req.notifyParties) {
      await sendRefundNotifications(payment, req.amountPence);
    }

    const finalRows = await db
      .select()
      .from(schema.paymentRefunds)
      .where(eq(schema.paymentRefunds.id, refundRecord.id));
    return finalRows[0];
  } catch (e: any) {
    await db
      .update(schema.paymentRefunds)
      .set({ status: "failed", failureCode: e.code ?? "stripe_error" })
      .where(eq(schema.paymentRefunds.id, refundRecord.id));

    await auditLog({
      paymentId: payment.id,
      actorType: "system",
      action: "refund_failed",
      reason: e.message,
    });

    throw e;
  }
}

function mapReasonCode(code: string): Stripe.RefundCreateParams["reason"] {
  const map: Record<string, Stripe.RefundCreateParams["reason"]> = {
    duplicate: "duplicate",
    fraud: "fraudulent",
    client_cancellation: "requested_by_customer",
    defective_work: "requested_by_customer",
    admin_goodwill: "requested_by_customer",
    statutory_right: "requested_by_customer",
  };
  return map[code] ?? "requested_by_customer";
}

// ────────────────────────────────────────────────────────────────────────────
// FR-16: Accurate Notification Messaging
// ────────────────────────────────────────────────────────────────────────────

async function sendPaymentNotifications(
  payment: schema.Payment,
  event: "succeeded" | "failed"
): Promise<void> {
  try {
    const { storage } = await import("./storage");

    if (event === "succeeded") {
      // Client: accurate confirmation (FR-16)
      await (storage as any).createNotification({
        recipientId: payment.clientId,
        actorId: payment.freelancerId,
        actorName: "Viewrr",
        actorAvatar: null,
        type: "payment_received",
        // FR-16: Do NOT say "paid to bank" or "work released" here
        message: `Stripe confirmed your payment of £${(payment.grossPence / 100).toFixed(2)}.`,
        link: `/invoice/${payment.projectId}`,
        read: 0,
      });

      // Freelancer: allocation to balance (not bank payout — FR-16)
      const freelancerMsg =
        payment.transferStrategy === "direct_transfer"
          ? `£${(payment.freelancerPence / 100).toFixed(2)} has been allocated to your Stripe balance.`
          : `The client's payment of £${(payment.grossPence / 100).toFixed(2)} has been confirmed. Your earnings will be transferred once your Stripe account is verified.`;

      await (storage as any).createNotification({
        recipientId: payment.freelancerId,
        actorId: payment.clientId,
        actorName: "Viewrr",
        actorAvatar: null,
        type: "payment_received",
        message: freelancerMsg,
        link: "/your-work",
        read: 0,
      });
    }
  } catch (e: any) {
    console.error("[notifications] Failed to send payment notification:", e.message);
  }
}

async function sendRefundNotifications(
  payment: schema.Payment,
  amountPence: number
): Promise<void> {
  try {
    const { storage } = await import("./storage");

    await (storage as any).createNotification({
      recipientId: payment.clientId,
      actorId: null,
      actorName: "Viewrr",
      actorAvatar: null,
      type: "payment_received",
      message: `Your refund of £${(amountPence / 100).toFixed(2)} has been submitted to Stripe.`,
      link: `/invoice/${payment.projectId}`,
      read: 0,
    });

    const reversedPence = Math.round(amountPence * ((100 - VIEWRR_FEE_PERCENT) / 100));
    await (storage as any).createNotification({
      recipientId: payment.freelancerId,
      actorId: null,
      actorName: "Viewrr",
      actorAvatar: null,
      type: "payment_received",
      message: `A refund was processed and £${(reversedPence / 100).toFixed(2)} of the related transfer has been reversed.`,
      link: "/your-work",
      read: 0,
    });
  } catch (e: any) {
    console.error("[notifications] Failed to send refund notification:", e.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// FR-08 (PRD-010): Friendly payment statuses
// ────────────────────────────────────────────────────────────────────────────

export function friendlyPaymentStatus(status: string): string {
  const map: Record<string, string> = {
    pending:                   "Awaiting payment",
    requires_payment_method:   "Awaiting card details",
    requires_confirmation:     "Confirming payment",
    requires_action:           "Action required",
    processing:                "Processing",
    succeeded:                 "Payment confirmed",
    failed:                    "Payment failed",
    cancelled:                 "Cancelled",
    refunded:                  "Refunded",
    partially_refunded:        "Partially refunded",
    disputed:                  "Under dispute",
  };
  return map[status] ?? status;
}

export function friendlyTransferStatus(status: string): string {
  const map: Record<string, string> = {
    transferred:  "Funds allocated to Stripe balance",
    pending:      "Transfer pending",
    failed:       "Transfer failed — under review",
  };
  return map[status] ?? status;
}

export function friendlyPayoutStatus(status: string): string {
  const map: Record<string, string> = {
    paid:        "Paid to bank",
    pending:     "Payout in transit",
    in_transit:  "Payout in transit",
    canceled:    "Payout cancelled",
    failed:      "Payout failed",
  };
  return map[status] ?? status;
}

// ────────────────────────────────────────────────────────────────────────────
// FR-18: Reconciliation Service
// ────────────────────────────────────────────────────────────────────────────

export async function reconcilePayment(paymentId: number): Promise<{
  status: "ok" | "exception";
  exceptions: string[];
}> {
  const db = getDb();
  const stripe = getStripe();
  const exceptions: string[] = [];

  const paymentRows = await db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.id, paymentId));
  if (!paymentRows.length) return { status: "exception", exceptions: ["payment_not_found"] };

  const payment = paymentRows[0];
  if (!payment.stripePaymentIntentId)
    return { status: "exception", exceptions: ["no_stripe_intent"] };

  try {
    const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);

    // Amount check
    if (intent.amount !== payment.grossPence)
      exceptions.push("amount_mismatch");
    if (intent.currency !== "gbp")
      exceptions.push("currency_mismatch");

    // Status alignment
    if (intent.status === "succeeded" && payment.status !== "succeeded" && payment.status !== "refunded")
      exceptions.push("payment_succeeded_internal_pending");
    if (intent.status !== "succeeded" && payment.status === "succeeded")
      exceptions.push("internal_paid_stripe_not_succeeded");

    // Transfer check for direct_transfer
    if (payment.transferStrategy === "direct_transfer" && intent.status === "succeeded") {
      const transfers = await db
        .select()
        .from(schema.paymentTransfers)
        .where(eq(schema.paymentTransfers.paymentId, payment.id));
      if (!transfers.length) {
        // Check Stripe for the transfer
        const intentFull = await stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId,
          { expand: ["transfer"] }
        );
        if (!(intentFull as any).transfer) exceptions.push("missing_transfer");
      }
    }
  } catch (e: any) {
    exceptions.push("stripe_api_error");
  }

  if (exceptions.length > 0) {
    await auditLog({
      paymentId: payment.id,
      actorType: "system",
      action: "reconciliation_exception",
      afterState: { exceptions },
    });
  }

  return { status: exceptions.length === 0 ? "ok" : "exception", exceptions };
}
