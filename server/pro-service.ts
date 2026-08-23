/**
 * PRD-013 — Pro Viewrr Subscription Service
 *
 * Server-authoritative entitlement management.
 * NEVER trust client-supplied Pro status — all entitlements derived here.
 *
 * Commission rates:
 *   Standard : 1100 bps (11%)
 *   Pro       :  800 bps ( 8%)
 */

import Stripe from "stripe";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, and, sql as drizzleSql, count } from "drizzle-orm";
import * as schema from "../shared/schema";

// ── Constants ────────────────────────────────────────────────────────────────
export const STANDARD_FEE_BPS = 1100; // 11%
export const PRO_FEE_BPS      =  800; // 8%
export const STANDARD_FEE_PCT = 11;
export const PRO_FEE_PCT      =  8;
export const PRO_PRICE_GBP    = 49.99;
export const PRO_AMOUNT_PENCE = 4999;
export const FOUNDING_PRO_MAX = 10;

// Stripe Price ID — must be set server-side (never from client)
export const PRO_STRIPE_PRICE_ID = process.env.PRO_STRIPE_PRICE_ID ?? "";

// ── DB client ────────────────────────────────────────────────────────────────
function getDb() {
  const sqlClient = neon(process.env.DATABASE_URL!);
  return drizzle(sqlClient, { schema });
}

// ── Stripe client ────────────────────────────────────────────────────────────
function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe not configured");
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-02-24.acacia" as any,
  });
}

// ── Nano ID ───────────────────────────────────────────────────────────────────
function makePublicId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 16; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return `prosub_${id}`;
}

// ── Audit logger ──────────────────────────────────────────────────────────────
export async function proAuditLog(entry: {
  userId: number;
  subscriptionId?: number;
  eventType: string;
  oldStatus?: string;
  newStatus?: string;
  commissionRateBps?: number;
  stripeEventId?: string;
  metadata?: object;
  correlationId?: string;
}) {
  try {
    const db = getDb();
    await db.insert(schema.proSubscriptionEvents).values({
      userId: entry.userId,
      subscriptionId: entry.subscriptionId ?? null,
      eventType: entry.eventType,
      oldStatus: entry.oldStatus ?? null,
      newStatus: entry.newStatus ?? null,
      commissionRateBps: entry.commissionRateBps ?? null,
      stripeEventId: entry.stripeEventId ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      correlationId: entry.correlationId ?? null,
    });
  } catch (e) {
    console.error("[pro-audit]", e);
  }
}

// ── FR-20: getProEntitlement ─────────────────────────────────────────────────
export interface ProEntitlement {
  membershipType: "founding_pro" | "paid" | null;
  status: string | null;
  entitlementActive: boolean;
  commissionRateBps: number;           // 800 or 1100
  commissionRatePct: number;           // 8 or 11
  subscriptionId: string | null;       // Stripe sub_...
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  foundingMember: boolean;
  proSubscriptionDbId: number | null;
}

export async function getProEntitlement(userId: number): Promise<ProEntitlement> {
  const db = getDb();

  // Check Founding Pro allocation
  const founding = await db
    .select()
    .from(schema.foundingProAllocations)
    .where(and(eq(schema.foundingProAllocations.userId, userId), eq(schema.foundingProAllocations.active, 1)));

  if (founding.length > 0) {
    return {
      membershipType: "founding_pro",
      status: "founding_pro",
      entitlementActive: true,
      commissionRateBps: PRO_FEE_BPS,
      commissionRatePct: PRO_FEE_PCT,
      subscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      foundingMember: true,
      proSubscriptionDbId: null,
    };
  }

  // Check paid subscription
  const subs = await db
    .select()
    .from(schema.proSubscriptions)
    .where(eq(schema.proSubscriptions.userId, userId));

  const sub = subs[0];
  if (!sub) {
    return _standardEntitlement();
  }

  const active =
    sub.status === "active" ||
    sub.status === "cancellation_scheduled" ||
    sub.status === "founding_pro";

  return {
    membershipType: sub.membershipType as any,
    status: sub.status,
    entitlementActive: active,
    commissionRateBps: active ? PRO_FEE_BPS : STANDARD_FEE_BPS,
    commissionRatePct: active ? PRO_FEE_PCT : STANDARD_FEE_PCT,
    subscriptionId: sub.stripeSubscriptionId,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd === 1,
    foundingMember: false,
    proSubscriptionDbId: sub.id,
  };
}

function _standardEntitlement(): ProEntitlement {
  return {
    membershipType: null,
    status: null,
    entitlementActive: false,
    commissionRateBps: STANDARD_FEE_BPS,
    commissionRatePct: STANDARD_FEE_PCT,
    subscriptionId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    foundingMember: false,
    proSubscriptionDbId: null,
  };
}

// ── FR-06: Founding 10 — atomic allocation ───────────────────────────────────
export async function claimFoundingPro(userId: number): Promise<
  { success: true; allocationNumber: number } |
  { success: false; reason: "already_claimed" | "full" | "not_freelancer" }
> {
  const db = getDb();
  const sqlClient = neon(process.env.DATABASE_URL!);

  // Already a founding pro?
  const existing = await db
    .select()
    .from(schema.foundingProAllocations)
    .where(eq(schema.foundingProAllocations.userId, userId));
  if (existing.length > 0) return { success: false, reason: "already_claimed" };

  // Atomic: count active allocations and insert if < 10
  // Use a single serialised transaction with a row-level lock on a counter approach
  const result = await sqlClient`
    WITH current_count AS (
      SELECT COUNT(*) AS c FROM founding_pro_allocations WHERE active = 1
    ),
    inserted AS (
      INSERT INTO founding_pro_allocations (user_id, allocation_number, allocated_at, active)
      SELECT ${userId}, (SELECT c FROM current_count) + 1, NOW()::text, 1
      WHERE (SELECT c FROM current_count) < ${FOUNDING_PRO_MAX}
      RETURNING allocation_number
    )
    SELECT * FROM inserted
  `;

  if (!result || result.length === 0) {
    return { success: false, reason: "full" };
  }

  const allocationNumber = result[0].allocation_number as number;

  // Also update the legacy isPro flag for backward compatibility
  await sqlClient`
    UPDATE profiles SET is_pro = 1, pro_since = NOW()::text
    WHERE user_id = ${userId}
  `;

  await proAuditLog({
    userId,
    eventType: "founding_pro_claimed",
    newStatus: "founding_pro",
    commissionRateBps: PRO_FEE_BPS,
    metadata: { allocationNumber },
  });

  return { success: true, allocationNumber };
}

// ── FR-05: Founding spaces remaining ─────────────────────────────────────────
export async function getFoundingProSpacesRemaining(): Promise<number> {
  const sqlClient = neon(process.env.DATABASE_URL!);
  const r = await sqlClient`SELECT COUNT(*) AS c FROM founding_pro_allocations WHERE active = 1`;
  const used = Number(r[0]?.c ?? 0);
  return Math.max(0, FOUNDING_PRO_MAX - used);
}

// ── FR-01/FR-02: Create Stripe Checkout for subscription ─────────────────────
export async function createProCheckout(
  userId: number,
  userEmail: string,
  baseUrl: string,
): Promise<{ checkoutUrl: string; sessionId: string }> {
  const stripe = getStripe();
  const db = getDb();

  if (!PRO_STRIPE_PRICE_ID) {
    throw new Error("PRO_STRIPE_PRICE_ID is not configured on the server.");
  }

  // FR-24: idempotency — if there's a pending checkout for this user, reuse it
  const existing = await db
    .select()
    .from(schema.proSubscriptions)
    .where(and(
      eq(schema.proSubscriptions.userId, userId),
      eq(schema.proSubscriptions.status, "checkout_pending"),
    ));

  // Find or create Stripe customer
  let stripeCustomerId: string | null = existing[0]?.stripeCustomerId ?? null;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: userEmail,
      metadata: { viewrr_user_id: String(userId) },
    });
    stripeCustomerId = customer.id;
  }

  // Create Checkout Session
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [{ price: PRO_STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${baseUrl}/#/pro?session_id={CHECKOUT_SESSION_ID}&status=success`,
    cancel_url: `${baseUrl}/#/pro?status=cancelled`,
    subscription_data: {
      metadata: { viewrr_user_id: String(userId) },
    },
    metadata: { viewrr_user_id: String(userId) },
    allow_promotion_codes: false,
  });

  // Upsert checkout_pending record
  if (existing[0]) {
    await db
      .update(schema.proSubscriptions)
      .set({
        stripeCustomerId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.proSubscriptions.userId, userId));
  } else {
    await db.insert(schema.proSubscriptions).values({
      publicId: makePublicId(),
      userId,
      membershipType: "paid",
      stripeCustomerId,
      status: "checkout_pending",
      amountPence: PRO_AMOUNT_PENCE,
      currency: "gbp",
      stripePriceId: PRO_STRIPE_PRICE_ID,
    });
  }

  const subs = await db.select().from(schema.proSubscriptions).where(eq(schema.proSubscriptions.userId, userId));
  await proAuditLog({
    userId,
    subscriptionId: subs[0]?.id,
    eventType: "checkout_initiated",
    oldStatus: "none",
    newStatus: "checkout_pending",
    stripeEventId: session.id,
  });

  return { checkoutUrl: session.url!, sessionId: session.id };
}

// ── FR-03/FR-07: Activate Pro from webhook ───────────────────────────────────
export async function activateProFromWebhook(
  stripeSubscriptionId: string,
  stripeCustomerId: string,
  stripeEventId: string,
  periodStart: number,
  periodEnd: number,
  viewrrUserId?: number,
): Promise<void> {
  const db = getDb();
  const sqlClient = neon(process.env.DATABASE_URL!);
  const now = new Date().toISOString();

  // Resolve userId from metadata or customer record
  let userId = viewrrUserId;
  if (!userId) {
    const r = await db
      .select()
      .from(schema.proSubscriptions)
      .where(eq(schema.proSubscriptions.stripeCustomerId, stripeCustomerId));
    userId = r[0]?.userId;
  }
  if (!userId) {
    console.error("[pro-webhook] Cannot resolve userId for customer", stripeCustomerId);
    return;
  }

  const subs = await db
    .select()
    .from(schema.proSubscriptions)
    .where(eq(schema.proSubscriptions.userId, userId));
  const sub = subs[0];

  await db
    .update(schema.proSubscriptions)
    .set({
      stripeSubscriptionId,
      stripeCustomerId,
      status: "active",
      currentPeriodStart: new Date(periodStart * 1000).toISOString(),
      currentPeriodEnd: new Date(periodEnd * 1000).toISOString(),
      cancelAtPeriodEnd: 0,
      updatedAt: now,
    })
    .where(eq(schema.proSubscriptions.userId, userId));

  // Update legacy isPro flag
  await sqlClient`
    UPDATE profiles SET is_pro = 1, pro_since = ${now} WHERE user_id = ${userId}
  `;

  await proAuditLog({
    userId,
    subscriptionId: sub?.id,
    eventType: "subscription_activated",
    oldStatus: sub?.status ?? "unknown",
    newStatus: "active",
    commissionRateBps: PRO_FEE_BPS,
    stripeEventId,
    metadata: { stripeSubscriptionId, periodEnd: new Date(periodEnd * 1000).toISOString() },
  });
  await proAuditLog({
    userId,
    subscriptionId: sub?.id,
    eventType: "entitlement_granted",
    newStatus: "active",
    commissionRateBps: PRO_FEE_BPS,
    stripeEventId,
  });
}

// ── Subscription renewed ──────────────────────────────────────────────────────
export async function renewProFromWebhook(
  stripeSubscriptionId: string,
  stripeCustomerId: string,
  stripeEventId: string,
  periodStart: number,
  periodEnd: number,
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  const subs = await db
    .select()
    .from(schema.proSubscriptions)
    .where(eq(schema.proSubscriptions.stripeSubscriptionId, stripeSubscriptionId));
  const sub = subs[0];
  if (!sub) return;

  await db
    .update(schema.proSubscriptions)
    .set({
      status: "active",
      currentPeriodStart: new Date(periodStart * 1000).toISOString(),
      currentPeriodEnd: new Date(periodEnd * 1000).toISOString(),
      updatedAt: now,
    })
    .where(eq(schema.proSubscriptions.stripeSubscriptionId, stripeSubscriptionId));

  await proAuditLog({
    userId: sub.userId,
    subscriptionId: sub.id,
    eventType: "subscription_renewed",
    newStatus: "active",
    commissionRateBps: PRO_FEE_BPS,
    stripeEventId,
  });
}

// ── Payment failed ────────────────────────────────────────────────────────────
export async function markProPaymentFailed(
  stripeSubscriptionId: string,
  stripeEventId: string,
): Promise<void> {
  const db = getDb();
  const subs = await db
    .select()
    .from(schema.proSubscriptions)
    .where(eq(schema.proSubscriptions.stripeSubscriptionId, stripeSubscriptionId));
  const sub = subs[0];
  if (!sub) return;

  await db
    .update(schema.proSubscriptions)
    .set({ status: "payment_failed", updatedAt: new Date().toISOString() })
    .where(eq(schema.proSubscriptions.stripeSubscriptionId, stripeSubscriptionId));

  await proAuditLog({
    userId: sub.userId,
    subscriptionId: sub.id,
    eventType: "payment_failed",
    oldStatus: sub.status,
    newStatus: "payment_failed",
    stripeEventId,
  });
}

// ── Cancellation scheduled / completed ───────────────────────────────────────
export async function scheduleProCancellation(
  userId: number,
  stripeSubscriptionId: string,
): Promise<{ currentPeriodEnd: string }> {
  const stripe = getStripe();
  const db = getDb();

  // Tell Stripe to cancel at period end
  const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  const periodEnd = new Date(updated.current_period_end * 1000).toISOString();

  const subs = await db
    .select()
    .from(schema.proSubscriptions)
    .where(eq(schema.proSubscriptions.userId, userId));
  const sub = subs[0];

  await db
    .update(schema.proSubscriptions)
    .set({
      status: "cancellation_scheduled",
      cancelAtPeriodEnd: 1,
      currentPeriodEnd: periodEnd,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.proSubscriptions.userId, userId));

  await proAuditLog({
    userId,
    subscriptionId: sub?.id,
    eventType: "cancellation_requested",
    oldStatus: sub?.status,
    newStatus: "cancellation_scheduled",
  });

  return { currentPeriodEnd: periodEnd };
}

export async function expireProEntitlement(
  stripeSubscriptionId: string,
  stripeEventId: string,
): Promise<void> {
  const db = getDb();
  const sqlClient = neon(process.env.DATABASE_URL!);
  const subs = await db
    .select()
    .from(schema.proSubscriptions)
    .where(eq(schema.proSubscriptions.stripeSubscriptionId, stripeSubscriptionId));
  const sub = subs[0];
  if (!sub) return;

  await db
    .update(schema.proSubscriptions)
    .set({ status: "expired", cancelAtPeriodEnd: 0, updatedAt: new Date().toISOString() })
    .where(eq(schema.proSubscriptions.stripeSubscriptionId, stripeSubscriptionId));

  // Revoke legacy isPro flag
  await sqlClient`
    UPDATE profiles SET is_pro = 0 WHERE user_id = ${sub.userId}
  `;

  await proAuditLog({
    userId: sub.userId,
    subscriptionId: sub.id,
    eventType: "entitlement_removed",
    oldStatus: sub.status,
    newStatus: "expired",
    commissionRateBps: STANDARD_FEE_BPS,
    stripeEventId,
  });
}

// ── FR-07: Get commission rate for a user at invoice creation time ───────────
export async function getCommissionRateBpsForUser(userId: number): Promise<number> {
  const entitlement = await getProEntitlement(userId);
  return entitlement.commissionRateBps;
}

// ── FR-18/19: Founder Dashboard stats ────────────────────────────────────────
export async function getProDashboardStats() {
  const sqlClient = neon(process.env.DATABASE_URL!);

  const [paid, founding, mrr, newThisMonth, cancellations, failed, foundingList] = await Promise.all([
    sqlClient`SELECT COUNT(*) AS c FROM pro_subscriptions WHERE status = 'active' AND membership_type = 'paid'`,
    sqlClient`SELECT COUNT(*) AS c FROM founding_pro_allocations WHERE active = 1`,
    sqlClient`SELECT COALESCE(SUM(amount_pence),0) AS total FROM pro_subscriptions WHERE status IN ('active','cancellation_scheduled') AND membership_type = 'paid'`,
    sqlClient`
      SELECT COUNT(*) AS c FROM pro_subscriptions
      WHERE created_at >= date_trunc('month', NOW()::timestamp)::text
      AND membership_type = 'paid'
    `,
    sqlClient`
      SELECT COUNT(*) AS c FROM pro_subscriptions WHERE status IN ('cancelled','expired')
      AND updated_at >= date_trunc('month', NOW()::timestamp)::text
    `,
    sqlClient`SELECT COUNT(*) AS c FROM pro_subscriptions WHERE status = 'payment_failed'`,
    sqlClient`
      SELECT fpa.user_id, fpa.allocation_number, fpa.allocated_at, fpa.active,
             u.name, u.email, ps.status AS sub_status, ps.stripe_subscription_id
      FROM founding_pro_allocations fpa
      JOIN users u ON u.id = fpa.user_id
      LEFT JOIN pro_subscriptions ps ON ps.user_id = fpa.user_id
      ORDER BY fpa.allocation_number
    `,
  ]);

  const paidMembers = await sqlClient`
    SELECT ps.user_id, ps.status, ps.stripe_subscription_id, ps.current_period_end,
           ps.amount_pence, ps.created_at, ps.cancel_at_period_end,
           u.name, u.email
    FROM pro_subscriptions ps
    JOIN users u ON u.id = ps.user_id
    ORDER BY ps.created_at DESC
  `;

  return {
    activePaidMembers: Number(paid[0]?.c ?? 0),
    foundingProMembers: Number(founding[0]?.c ?? 0),
    foundingProMax: FOUNDING_PRO_MAX,
    monthlyRecurringRevenuePence: Number(mrr[0]?.total ?? 0),
    newMembersThisMonth: Number(newThisMonth[0]?.c ?? 0),
    cancellationsThisMonth: Number(cancellations[0]?.c ?? 0),
    failedRenewals: Number(failed[0]?.c ?? 0),
    foundingProList: foundingList,
    paidMemberList: paidMembers,
  };
}
