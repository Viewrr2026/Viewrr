// server/services/trust-service.ts
// PRD-021 WS-F: Reports, suspension, blocking

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../../shared/schema";
import { recordModerationAudit } from "./moderation-service";

function getSql() { return neon(process.env.DATABASE_URL!); }
function getDb() { return drizzle(getSql(), { schema }); }

// ─── Suspension ───────────────────────────────────────────────────────────────

export async function suspendUser(
  targetUserId: number,
  adminUserId: number,
  reason: string,
): Promise<void> {
  const sql = getSql();
  const now = new Date().toISOString();

  // 1. Update account_status
  await sql`
    UPDATE users
    SET account_status = 'suspended',
        suspended_at = ${now},
        suspended_reason = ${reason},
        suspended_by = ${adminUserId}
    WHERE id = ${targetUserId} AND account_status = 'active'
  `;

  // 2. Revoke all active sessions
  await sql`
    UPDATE auth_sessions
    SET revoked_at = ${now}, revoked_reason = 'account_suspended'
    WHERE user_id = ${targetUserId} AND revoked_at IS NULL
  `;

  // 3. Audit log entry.
  // PRD 1: this used to INSERT into payment_audit_log with payment_id = NULL,
  // which polluted the financial audit trail (a reconciliation source that must
  // stay payment-only) and made moderation history unqueryable. Moderation
  // actions now go to moderation_audit_log (migration 0006).
  await recordModerationAudit({
    actorType: "admin",
    actorId: adminUserId,
    action: "user_suspended",
    subjectType: "user",
    subjectId: targetUserId,
    reason,
  });
}

export async function unsuspendUser(
  targetUserId: number,
  adminUserId: number,
  note: string,
): Promise<void> {
  const sql = getSql();
  const now = new Date().toISOString();

  await sql`
    UPDATE users
    SET account_status = 'active',
        suspended_at = NULL,
        suspended_reason = NULL,
        suspended_by = NULL
    WHERE id = ${targetUserId} AND account_status = 'suspended'
  `;

  // PRD 1: moved off payment_audit_log — see suspendUser above.
  await recordModerationAudit({
    actorType: "admin",
    actorId: adminUserId,
    action: "user_unsuspended",
    subjectType: "user",
    subjectId: targetUserId,
    reason: note,
  });
}

// ─── Blocking ─────────────────────────────────────────────────────────────────

export async function blockUser(blockerId: number, blockedId: number): Promise<void> {
  if (blockerId === blockedId) throw new Error("Cannot block yourself");
  const sql = getSql();
  await sql`
    INSERT INTO user_blocks (blocker_user_id, blocked_user_id, created_at)
    VALUES (${blockerId}, ${blockedId}, ${new Date().toISOString()})
    ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
  `;
}

export async function unblockUser(blockerId: number, blockedId: number): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM user_blocks
    WHERE blocker_user_id = ${blockerId} AND blocked_user_id = ${blockedId}
  `;
}

export async function isUserBlocked(blockerId: number, blockedId: number): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    SELECT 1 FROM user_blocks
    WHERE blocker_user_id = ${blockerId} AND blocked_user_id = ${blockedId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getBlockList(userId: number): Promise<number[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT blocked_user_id FROM user_blocks WHERE blocker_user_id = ${userId}
  `;
  return rows.map((r) => r.blocked_user_id as number);
}

// ─── PRD 1 / contract §F: symmetric block enforcement ────────────────────────
//
// A block is SYMMETRIC for discovery and social interaction: neither party sees
// or can interact with the other, regardless of who pressed the button. Only
// checking one direction lets the blocked party keep poking the blocker, which
// is the whole thing a block is supposed to stop.

/**
 * True when EITHER user has blocked the other.
 * Use this everywhere a social/discovery surface is being rendered or written.
 *
 * Fails CLOSED on the caller's side is not possible here (it returns a boolean),
 * so on a DB error it throws — callers on non-critical paths (e.g. notify())
 * must wrap it and decide. See `isBlockedEitherWaySafe`.
 */
export async function isBlockedEitherWay(a: number, b: number): Promise<boolean> {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return false;
  const sql = getSql();
  const rows = await sql`
    SELECT 1 FROM user_blocks
    WHERE (blocker_user_id = ${a} AND blocked_user_id = ${b})
       OR (blocker_user_id = ${b} AND blocked_user_id = ${a})
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Non-throwing variant for fire-and-forget paths (notify()).
 * On error it returns `false` (do not suppress) — suppressing every
 * notification because the DB hiccuped would be worse than a leaked one, and
 * the row itself is still written by the caller.
 */
export async function isBlockedEitherWaySafe(a: number, b: number): Promise<boolean> {
  try {
    return await isBlockedEitherWay(a, b);
  } catch (e: any) {
    console.warn("[trust] block check failed, allowing through:", e?.message);
    return false;
  }
}

/**
 * Union of both directions: everyone this user cannot see and who cannot see
 * them. Use for list filtering (feed, profiles, conversations, saved).
 */
export async function getBlockedUserIds(userId: number): Promise<number[]> {
  if (!Number.isFinite(userId)) return [];
  const sql = getSql();
  const rows = await sql`
    SELECT blocked_user_id AS other FROM user_blocks WHERE blocker_user_id = ${userId}
    UNION
    SELECT blocker_user_id AS other FROM user_blocks WHERE blocked_user_id = ${userId}
  `;
  return rows.map((r) => Number(r.other)).filter((n) => Number.isFinite(n));
}

/**
 * CONTRACT EXEMPTION — Decision 3.
 *
 * A block must NEVER break an in-flight project. When two users share a live
 * (non-deleted, non-cancelled) project, the Work surface and the messages that
 * belong to that engagement keep working; only the social/discovery surfaces
 * hide the counterparty.
 *
 * True when a non-deleted project exists with {clientId, freelancerId} == {a, b}
 * in either direction. `projects.deleted_at IS NULL` is the soft-delete marker.
 *
 * Deliberately NOT narrowed to status='active': a COMPLETED project still has
 * reviews to leave, invoices to settle and a dispute window. Narrowing this
 * would let a block break contract fulfilment, which Decision 3 forbids.
 */
export async function sharesActiveEngagement(a: number, b: number): Promise<boolean> {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return false;
  const sql = getSql();
  const rows = await sql`
    SELECT 1 FROM projects
    WHERE ((client_id = ${a} AND freelancer_id = ${b})
        OR (client_id = ${b} AND freelancer_id = ${a}))
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * The single decision helper for messaging surfaces.
 * Returns true when the messaging interaction must be blocked:
 * blocked either way AND no active engagement to protect.
 */
export async function blocksMessaging(a: number, b: number): Promise<boolean> {
  if (!(await isBlockedEitherWay(a, b))) return false;
  return !(await sharesActiveEngagement(a, b));
}

// ─── Reports ─────────────────────────────────────────────────────────────────

const VALID_SUBJECT_TYPES = ["user", "profile", "post", "message", "brief", "project"] as const;
const VALID_REASONS = ["spam", "harassment", "fake", "inappropriate", "other"] as const;

type ValidSubjectType = typeof VALID_SUBJECT_TYPES[number];
type ValidReason = typeof VALID_REASONS[number];

export async function createReport(opts: {
  reporterUserId: number;
  subjectType: string;
  subjectId: number;
  reason: string;
  description?: string;
}): Promise<number> {
  if (!VALID_SUBJECT_TYPES.includes(opts.subjectType as ValidSubjectType)) {
    throw new Error(`Invalid subject_type. Must be one of: ${VALID_SUBJECT_TYPES.join(", ")}`);
  }
  if (!VALID_REASONS.includes(opts.reason as ValidReason)) {
    throw new Error(`Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}`);
  }
  const sql = getSql();
  const rows = await sql`
    INSERT INTO user_reports (reporter_user_id, subject_type, subject_id, reason, description, created_at)
    VALUES (${opts.reporterUserId}, ${opts.subjectType}, ${opts.subjectId}, ${opts.reason}, ${opts.description ?? null}, ${new Date().toISOString()})
    RETURNING id
  `;
  return rows[0].id as number;
}

export async function resolveReport(opts: {
  reportId: number;
  adminUserId: number;
  resolution: "dismissed" | "warned" | "suspended" | "no_action";
  note?: string;
}): Promise<void> {
  const sql = getSql();
  const now = new Date().toISOString();
  await sql`
    UPDATE user_reports
    SET status = 'resolved',
        reviewed_at = ${now},
        reviewed_by = ${opts.adminUserId},
        resolution_note = ${opts.note ?? null},
        moderator_action = ${opts.resolution}
    WHERE id = ${opts.reportId} AND status IN ('open', 'under_review')
  `;
}

// ─── Suspension check (used by requireAuth middleware integration) ─────────────

export async function isUserSuspended(userId: number): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`
    SELECT account_status FROM users WHERE id = ${userId} LIMIT 1
  `;
  return rows[0]?.account_status === 'suspended';
}
