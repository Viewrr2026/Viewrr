/**
 * PRD-008 — Automated reconciliation scheduler + exception management.
 * Compares internal records against Stripe and raises finance_exceptions.
 */

import { neon } from "@neondatabase/serverless";
import { enqueueJob } from "./job-queue";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

function getStripe() {
  const Stripe = require("stripe");
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" as any });
}

type ExceptionType =
  | "payment_succeeded_internal_pending"
  | "internal_paid_stripe_not_succeeded"
  | "amount_mismatch"
  | "currency_mismatch"
  | "missing_charge"
  | "missing_balance_transaction"
  | "missing_transfer"
  | "duplicate_transfer"
  | "refund_without_reversal"
  | "reversal_without_refund"
  | "unexpected_application_fee"
  | "payout_failed"
  | "connected_account_restricted"
  | "negative_platform_balance"
  | "negative_connected_balance"
  | "webhook_failed"
  | "orphan_stripe_object";

type ExceptionSeverity = "critical" | "action_required" | "monitor" | "informational";

function makePublicId() {
  return `exc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function raiseException(
  type: ExceptionType,
  severity: ExceptionSeverity,
  summary: string,
  technicalDetails: Record<string, unknown>,
  opts: { paymentId?: number; connectedAccountId?: number; amountPence?: number } = {}
): Promise<void> {
  const db = getDb();
  try {
    // Don't duplicate open exceptions of the same type for the same payment
    if (opts.paymentId) {
      const existing = await db`
        SELECT id FROM finance_exceptions
        WHERE type = ${type} AND payment_id = ${opts.paymentId} AND status IN ('open','investigating','action_required')
        LIMIT 1
      `;
      if (existing.length > 0) return;
    }

    await db`
      INSERT INTO finance_exceptions (public_id, payment_id, connected_account_id, type, severity, status, amount_pence, summary, technical_details)
      VALUES (
        ${makePublicId()}, ${opts.paymentId ?? null}, ${opts.connectedAccountId ?? null},
        ${type}, ${severity}, 'open', ${opts.amountPence ?? null},
        ${summary}, ${JSON.stringify(technicalDetails)}
      )
    `;
  } catch (e: any) {
    console.error("[reconciliation] Failed to raise exception:", e.message);
  }
}

/**
 * Reconcile a single payment against Stripe.
 * Safe repairs only — no money movement.
 */
export async function reconcilePaymentFull(paymentId: number): Promise<{ issues: string[] }> {
  const db = getDb();
  const issues: string[] = [];

  const rows = await db`SELECT * FROM payments WHERE id = ${paymentId} LIMIT 1`;
  if (!rows.length) return { issues: ["Payment not found"] };
  const payment = rows[0];

  if (!payment.stripe_payment_intent_id) return { issues: ["No Stripe intent ID"] };

  const stripe = getStripe();
  try {
    const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id, {
      expand: ["latest_charge", "latest_charge.balance_transaction"],
    });

    // Check: Stripe says succeeded but internal says pending
    if (intent.status === "succeeded" && payment.status === "pending") {
      issues.push("payment_succeeded_internal_pending");
      await raiseException(
        "payment_succeeded_internal_pending", "action_required",
        `Stripe payment succeeded but internal record is still pending (payment #${payment.public_id})`,
        { stripeStatus: intent.status, internalStatus: payment.status, intentId: intent.id },
        { paymentId, amountPence: payment.gross_pence }
      );
      // Safe repair: update internal status
      await db`UPDATE payments SET status = 'succeeded', succeeded_at = ${new Date().toISOString()} WHERE id = ${paymentId}`;
    }

    // Check: internal says paid but Stripe disagrees
    if (payment.status === "succeeded" && intent.status !== "succeeded") {
      issues.push("internal_paid_stripe_not_succeeded");
      await raiseException(
        "internal_paid_stripe_not_succeeded", "critical",
        `Internal payment marked succeeded but Stripe says: ${intent.status}`,
        { stripeStatus: intent.status, internalStatus: payment.status },
        { paymentId, amountPence: payment.gross_pence }
      );
    }

    // Check: amount mismatch
    if (intent.amount !== payment.gross_pence) {
      issues.push("amount_mismatch");
      await raiseException(
        "amount_mismatch", "critical",
        `Payment amount mismatch: internal £${(payment.gross_pence / 100).toFixed(2)} vs Stripe £${(intent.amount / 100).toFixed(2)}`,
        { internalPence: payment.gross_pence, stripePence: intent.amount },
        { paymentId }
      );
    }

    // Check: currency mismatch
    if (intent.currency !== "gbp") {
      issues.push("currency_mismatch");
      await raiseException(
        "currency_mismatch", "critical",
        `Payment currency is ${intent.currency.toUpperCase()} — expected GBP`,
        { stripeCurrency: intent.currency },
        { paymentId }
      );
    }

    // Check: missing charge
    const charge = (intent as any).latest_charge;
    if (intent.status === "succeeded" && !charge) {
      issues.push("missing_charge");
      await raiseException("missing_charge", "action_required",
        `Succeeded payment has no charge record`, { intentId: intent.id }, { paymentId });
    }

    // Check: balance transaction and Stripe fee
    if (charge) {
      const bt = charge.balance_transaction;
      if (!bt) {
        issues.push("missing_balance_transaction");
        await raiseException("missing_balance_transaction", "monitor",
          `No balance transaction on charge ${charge.id}`, { chargeId: charge.id }, { paymentId });
      } else if (typeof bt === "object") {
        // Safe repair: update Stripe fee if missing
        if (!payment.stripe_fee_pence && bt.fee) {
          await db`
            UPDATE payments
            SET stripe_fee_pence = ${bt.fee},
                net_platform_revenue_pence = ${payment.platform_fee_pence - bt.fee}
            WHERE id = ${paymentId}
          `;
        }
      }

      // Check: missing charge ID
      if (!payment.stripe_charge_id && charge.id) {
        await db`UPDATE payments SET stripe_charge_id = ${charge.id} WHERE id = ${paymentId}`;
      }
    }

    // Check: transfer status for succeeded payments
    if (payment.status === "succeeded" && payment.transfer_strategy === "direct_transfer") {
      const transfers = await db`SELECT * FROM payment_transfers WHERE payment_id = ${paymentId} LIMIT 5`;
      if (transfers.length === 0) {
        issues.push("missing_transfer");
        await raiseException("missing_transfer", "action_required",
          `Succeeded payment has no transfer record`,
          { paymentPublicId: payment.public_id, strategy: payment.transfer_strategy },
          { paymentId, amountPence: payment.freelancer_pence }
        );
        // Safe repair: enqueue transfer creation
        await enqueueJob("create_transfer", { paymentId }, `create_transfer:${payment.public_id}:repair`);
      }
      if (transfers.length > 1) {
        issues.push("duplicate_transfer");
        await raiseException("duplicate_transfer", "critical",
          `Payment has ${transfers.length} transfer records — possible duplicate`, {}, { paymentId });
      }
    }

  } catch (e: any) {
    issues.push(`stripe_api_error: ${e.message}`);
  }

  return { issues };
}

/**
 * Scan for active exceptions — run every 30 minutes.
 */
export async function runExceptionScan(): Promise<{ scanned: number; newExceptions: number }> {
  const db = getDb();
  let scanned = 0;
  let newExceptions = 0;
  const beforeCount = (await db`SELECT COUNT(*) AS c FROM finance_exceptions WHERE status = 'open'`)[0]?.c ?? 0;

  // 1. Payments stuck in processing > 15 minutes
  const stuckPayments = await db`
    SELECT id FROM payments
    WHERE status = 'pending'
      AND created_at < ${new Date(Date.now() - 15 * 60_000).toISOString()}
    LIMIT 50
  `;
  for (const p of stuckPayments) {
    scanned++;
    await enqueueJob("reconcile_payment", { paymentId: p.id }, `reconcile:stuck:${p.id}:${new Date().toISOString().slice(0, 13)}`);
  }

  // 2. Failed payouts
  const failedPayouts = await db`
    SELECT pp.*, p.public_id AS payment_public_id FROM payment_payouts pp
    LEFT JOIN payments p ON p.id = pp.payment_id
    WHERE pp.status = 'failed'
      AND pp.created_at > ${new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()}
    LIMIT 20
  `;
  for (const payout of failedPayouts) {
    scanned++;
    await raiseException("payout_failed", "action_required",
      `Payout failed for payment ${payout.payment_public_id ?? payout.payment_id}`,
      { stripePayoutId: payout.stripe_payout_id, failureCode: payout.failure_code },
      { paymentId: payout.payment_id }
    );
  }

  // 3. Connected accounts with restrictions
  const restrictedAccounts = await db`
    SELECT * FROM stripe_connect_accounts
    WHERE readiness_state IN ('restricted', 'verification_pending')
    LIMIT 20
  `;
  for (const acct of restrictedAccounts) {
    scanned++;
    await raiseException("connected_account_restricted", "action_required",
      `Freelancer account is ${acct.readiness_state} — earnings may be blocked`,
      { userId: acct.user_id, stripeAccountId: acct.stripe_account_id, disabledReason: acct.disabled_reason },
      { connectedAccountId: acct.id }
    );
  }

  // 4. Failed webhook jobs
  const deadLetterJobs = await db`
    SELECT * FROM background_jobs WHERE status = 'dead_letter' AND completed_at IS NULL LIMIT 20
  `;
  for (const job of deadLetterJobs) {
    scanned++;
    await raiseException("webhook_failed", "action_required",
      `Background job ${job.job_type} has failed ${job.attempt_count} times and is in dead letter queue`,
      { jobId: job.id, jobType: job.job_type, lastError: job.last_error?.slice(0, 200) },
      {}
    );
  }

  const afterCount = (await db`SELECT COUNT(*) AS c FROM finance_exceptions WHERE status = 'open'`)[0]?.c ?? 0;
  newExceptions = Math.max(0, Number(afterCount) - Number(beforeCount));

  return { scanned, newExceptions };
}

/**
 * Generate a daily finance summary row.
 */
export async function generateDailySummary(date: string = new Date().toISOString().slice(0, 10)): Promise<void> {
  const db = getDb();
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const [volumeRow] = await db`
    SELECT
      COALESCE(SUM(gross_pence), 0) AS gross_volume,
      COALESCE(SUM(platform_fee_pence), 0) AS platform_fee,
      COALESCE(SUM(COALESCE(stripe_fee_pence, 0)), 0) AS stripe_fee,
      COALESCE(SUM(COALESCE(net_platform_revenue_pence, platform_fee_pence)), 0) AS net_revenue,
      COALESCE(SUM(freelancer_pence), 0) AS freelancer_earnings,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
    FROM payments
    WHERE succeeded_at >= ${dayStart} AND succeeded_at <= ${dayEnd}
  `;

  const [refundRow] = await db`
    SELECT COALESCE(SUM(amount_pence), 0) AS refunds
    FROM payment_refunds
    WHERE created_at >= ${dayStart} AND created_at <= ${dayEnd}
      AND status = 'succeeded'
  `;

  const [payoutRow] = await db`
    SELECT COALESCE(SUM(amount_pence), 0) AS payouts
    FROM payment_payouts
    WHERE created_at >= ${dayStart} AND created_at <= ${dayEnd}
      AND status = 'paid'
  `;

  const [disputeRow] = await db`
    SELECT COUNT(*) AS disputes FROM finance_exceptions
    WHERE type LIKE '%dispute%' AND detected_at >= ${dayStart} AND detected_at <= ${dayEnd}
  `;

  const [exceptionRow] = await db`
    SELECT COUNT(*) AS exceptions FROM finance_exceptions
    WHERE detected_at >= ${dayStart} AND detected_at <= ${dayEnd}
  `;

  await db`
    INSERT INTO finance_daily_summaries (
      date, currency, gross_volume_pence, platform_fee_pence, stripe_fee_pence,
      net_revenue_pence, freelancer_earnings_pence, refunds_pence, payouts_pence,
      failed_payment_count, dispute_count, exception_count, calculated_at
    ) VALUES (
      ${date}, 'gbp',
      ${volumeRow.gross_volume}, ${volumeRow.platform_fee}, ${volumeRow.stripe_fee},
      ${volumeRow.net_revenue}, ${volumeRow.freelancer_earnings},
      ${refundRow.refunds}, ${payoutRow.payouts},
      ${volumeRow.failed_count}, ${disputeRow.disputes}, ${exceptionRow.exceptions},
      ${new Date().toISOString()}
    )
    ON CONFLICT (date, currency) DO UPDATE SET
      gross_volume_pence = EXCLUDED.gross_volume_pence,
      platform_fee_pence = EXCLUDED.platform_fee_pence,
      stripe_fee_pence = EXCLUDED.stripe_fee_pence,
      net_revenue_pence = EXCLUDED.net_revenue_pence,
      freelancer_earnings_pence = EXCLUDED.freelancer_earnings_pence,
      refunds_pence = EXCLUDED.refunds_pence,
      payouts_pence = EXCLUDED.payouts_pence,
      failed_payment_count = EXCLUDED.failed_payment_count,
      dispute_count = EXCLUDED.dispute_count,
      exception_count = EXCLUDED.exception_count,
      calculated_at = EXCLUDED.calculated_at
  `;
}
