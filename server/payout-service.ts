/**
 * PRD-008 — Automatic daily payout configuration service.
 * Configures Stripe Connect Express accounts for automatic daily payouts.
 */

import { neon } from "@neondatabase/serverless";

function getDb() {
  return neon(process.env.DATABASE_URL!);
}

function getStripe() {
  const Stripe = require("stripe");
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" as any });
}

const DAILY_PAYOUT_SCHEDULE = {
  interval: "daily" as const,
  delay_days: 2, // T+2 standard for UK bank transfers
};

export interface PayoutConfigResult {
  stripeAccountId: string;
  userId: number;
  success: boolean;
  previousSchedule?: string;
  newSchedule?: string;
  error?: string;
  requiresReview?: boolean;
}

/**
 * Configure automatic daily payouts for a single connected account.
 */
export async function configureAutoDailyPayout(
  userId: number,
  stripeAccountId: string
): Promise<PayoutConfigResult> {
  const stripe = getStripe();
  const db = getDb();

  try {
    // Retrieve current settings
    const acct = await stripe.accounts.retrieve(stripeAccountId);
    const currentSchedule = acct.settings?.payouts?.schedule;
    const previousSchedule = JSON.stringify(currentSchedule);

    // Check if account is eligible for payout configuration
    if (!acct.payouts_enabled) {
      await db`
        UPDATE stripe_connect_accounts
        SET payout_schedule = ${JSON.stringify({ status: "payouts_disabled" })},
            last_synced_at = ${new Date().toISOString()}
        WHERE stripe_account_id = ${stripeAccountId}
      `;
      return {
        stripeAccountId, userId, success: false,
        error: "Payouts not enabled on this account",
        requiresReview: true,
      };
    }

    // Don't override if account holder controls their own payout schedule
    // (Express accounts — Viewrr controls the schedule as platform)
    if (acct.type !== "express" && acct.type !== "custom") {
      return {
        stripeAccountId, userId, success: false,
        error: `Account type ${acct.type} — payout schedule not controlled by platform`,
        requiresReview: true,
      };
    }

    // Update to daily schedule
    const updated = await stripe.accounts.update(stripeAccountId, {
      settings: {
        payouts: {
          schedule: DAILY_PAYOUT_SCHEDULE,
          debit_negative_balances: false,
        },
      },
    });

    const newSchedule = JSON.stringify(updated.settings?.payouts?.schedule);

    // Persist to stripe_connect_accounts
    await db`
      UPDATE stripe_connect_accounts
      SET payout_schedule = ${newSchedule},
          last_synced_at = ${new Date().toISOString()}
      WHERE stripe_account_id = ${stripeAccountId}
    `;

    return { stripeAccountId, userId, success: true, previousSchedule, newSchedule };
  } catch (e: any) {
    return {
      stripeAccountId, userId, success: false,
      error: e.message?.slice(0, 200),
    };
  }
}

/**
 * One-time migration: iterate all connected accounts and set daily payouts.
 * Returns a summary of results.
 */
export async function migrateAllAccountsToAutoDailyPayout(): Promise<{
  total: number;
  updated: number;
  alreadyDaily: number;
  failed: number;
  requiresReview: number;
  results: PayoutConfigResult[];
}> {
  const db = getDb();
  const stripe = getStripe();

  // Get all connected accounts from our DB
  const accounts = await db`
    SELECT sca.user_id, sca.stripe_account_id, sca.payouts_enabled
    FROM stripe_connect_accounts sca
    WHERE sca.stripe_account_id IS NOT NULL
  `;

  const results: PayoutConfigResult[] = [];
  let updated = 0;
  let alreadyDaily = 0;
  let failed = 0;
  let requiresReview = 0;

  for (const acct of accounts) {
    // Check current schedule
    try {
      const stripeAcct = await stripe.accounts.retrieve(acct.stripe_account_id);
      const schedule = stripeAcct.settings?.payouts?.schedule;

      if (schedule?.interval === "daily") {
        alreadyDaily++;
        results.push({ stripeAccountId: acct.stripe_account_id, userId: acct.user_id, success: true, newSchedule: "already_daily" });
        continue;
      }
    } catch {}

    const result = await configureAutoDailyPayout(acct.user_id, acct.stripe_account_id);
    results.push(result);

    if (result.success) updated++;
    else if (result.requiresReview) requiresReview++;
    else failed++;

    // Rate limit — avoid hammering Stripe API
    await new Promise(r => setTimeout(r, 200));
  }

  return { total: accounts.length, updated, alreadyDaily, failed, requiresReview, results };
}

/**
 * Configure daily payouts when creating a new Connect account.
 * Called from the connect-account onboarding flow.
 */
export async function configureNewAccountDailyPayout(stripeAccountId: string): Promise<void> {
  const stripe = getStripe();
  try {
    await stripe.accounts.update(stripeAccountId, {
      settings: {
        payouts: {
          schedule: DAILY_PAYOUT_SCHEDULE,
          debit_negative_balances: false,
        },
      },
    });
  } catch (e: any) {
    // Non-fatal — account may not be ready yet. Will be set on next sync.
    console.warn("[payout-service] Could not set daily payout schedule on new account:", e.message);
  }
}

/**
 * Get payout timeline for a freelancer — recent and upcoming payouts.
 */
export async function getFreelancerPayoutTimeline(userId: number): Promise<{
  payouts: Array<{
    id: string;
    amount: number;
    currency: string;
    status: string;
    arrivalDate?: string;
    created: number;
    description?: string;
  }>;
  nextPayout?: { estimatedArrival: string | null; scheduledAmount: number };
}> {
  const db = getDb();

  const connectRow = await db`
    SELECT stripe_account_id FROM stripe_connect_accounts WHERE user_id = ${userId} LIMIT 1
  `;
  if (!connectRow.length) return { payouts: [] };

  const stripe = getStripe();
  try {
    const payoutList = await stripe.payouts.list(
      { limit: 20 },
      { stripeAccount: connectRow[0].stripe_account_id }
    );

    const payouts = payoutList.data.map(p => ({
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      arrivalDate: p.arrival_date ? new Date(p.arrival_date * 1000).toISOString().slice(0, 10) : undefined,
      created: p.created,
      description: p.description ?? undefined,
    }));

    // Check for scheduled balance
    const balance = await stripe.balance.retrieve(
      {},
      { stripeAccount: connectRow[0].stripe_account_id }
    );
    const pendingGBP = balance.pending.find(b => b.currency === "gbp");

    return { payouts, nextPayout: pendingGBP ? { estimatedArrival: null, scheduledAmount: pendingGBP.amount } : undefined };
  } catch {
    return { payouts: [] };
  }
}
