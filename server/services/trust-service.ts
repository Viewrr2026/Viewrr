// server/services/trust-service.ts
// PRD-021 WS-F: Reports, suspension, blocking

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../../shared/schema";

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

  // 3. Audit log entry
  await sql`
    INSERT INTO payment_audit_log (payment_id, actor_type, actor_id, action, reason, created_at)
    VALUES (NULL, 'admin', ${adminUserId}, 'user_suspended', ${reason}, ${now})
  `;
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

  await sql`
    INSERT INTO payment_audit_log (payment_id, actor_type, actor_id, action, reason, created_at)
    VALUES (NULL, 'admin', ${adminUserId}, 'user_unsuspended', ${note}, ${now})
  `;
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
