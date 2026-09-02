/**
 * PRD-019: DB-backed session service
 *
 * All session tokens are 32 random bytes encoded as base64url (43 chars).
 * Only SHA-256(rawToken) is stored in the DB — the raw token is NEVER persisted.
 * Raw tokens are NEVER logged.
 *
 * Session TTLs:
 *   Web:    absolute expiry = 8 hours from creation. No idle expiry.
 *   Mobile: absolute expiry = 90 days from creation. Idle expiry = 30 days rolling.
 *
 * Touch throttle: last_used_at / idle_expires_at updated at most once per 5 minutes.
 */

import crypto from "crypto";
import { db } from "./storage";
import { authSessions, type AuthSession } from "../shared/schema";
import { eq, and, isNull } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────
export const WEB_SESSION_TTL_MS    = 8  * 60 * 60 * 1000;          //  8 hours
export const MOBILE_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;   // 90 days
export const MOBILE_IDLE_TTL_MS     = 30 * 24 * 60 * 60 * 1000;   // 30 days
export const TOUCH_THROTTLE_MS     = 5  * 60 * 1000;               //  5 minutes

// ─── Token helpers ────────────────────────────────────────────────────────────

/** Generate a 32-byte CSPRNG opaque token (base64url, 43 chars). NEVER store this directly. */
export function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Hash a raw token for DB storage. Deterministic, fast (lookup-grade, not password-grade). */
export function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Structural discriminator: is this cookie value structurally a legacy HMAC token?
 *
 * Opaque DB tokens are always exactly 43 base64url chars (32 random bytes).
 * HMAC tokens are always ≥107 chars (base64url of "<userId>.<issuedAt>.<64-hex-sig>").
 * The ranges do not overlap. A threshold of 64 is safe (well above 43, well below 107).
 *
 * This is ONLY used to decide whether to attempt the HMAC fallback path.
 * A DB-found-but-invalid token NEVER reaches this check.
 */
export function isStructurallyHmacToken(cookieValue: string): boolean {
  return cookieValue.length >= 64;
}

// ─── Session creation ─────────────────────────────────────────────────────────

export interface CreateSessionResult {
  rawToken: string;      // return to caller (set as cookie OR return in body); NEVER log
  sessionId: string;     // public UUID; safe to log
}

export async function createWebSession(userId: number): Promise<CreateSessionResult> {
  const rawToken  = generateRawToken();
  const sessionId = crypto.randomUUID();
  const tokenHash = hashToken(rawToken);
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + WEB_SESSION_TTL_MS);

  await db.insert(authSessions).values({
    sessionId,
    userId,
    tokenHash,
    clientType: "web",
    createdAt:  now,
    lastUsedAt: now,
    expiresAt,
    idleExpiresAt: null,
  });

  return { rawToken, sessionId };
}

export async function createMobileSession(userId: number): Promise<CreateSessionResult> {
  const rawToken  = generateRawToken();
  const sessionId = crypto.randomUUID();
  const tokenHash = hashToken(rawToken);
  const now       = new Date();
  const expiresAt    = new Date(now.getTime() + MOBILE_ABSOLUTE_TTL_MS);
  const idleExpiresAt = new Date(now.getTime() + MOBILE_IDLE_TTL_MS);

  await db.insert(authSessions).values({
    sessionId,
    userId,
    tokenHash,
    clientType: "mobile",
    createdAt:  now,
    lastUsedAt: now,
    expiresAt,
    idleExpiresAt,
  });

  return { rawToken, sessionId };
}

// ─── Session lookup ───────────────────────────────────────────────────────────

/**
 * Look up a session by raw token. Returns the row if found (even if expired/revoked).
 * Callers MUST check validity (revoked, expired, idle) after receiving the row.
 * Returns null if no row exists (token unknown to DB — may be legacy HMAC).
 */
export async function findSessionByToken(rawToken: string): Promise<AuthSession | null> {
  const tokenHash = hashToken(rawToken);
  const rows = await db
    .select()
    .from(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

/** Validate a found session row: not revoked, not absolute-expired, not idle-expired. */
export function isSessionValid(session: AuthSession): boolean {
  const now = new Date();
  if (session.revokedAt !== null) return false;
  if (session.expiresAt <= now)   return false;
  if (session.idleExpiresAt !== null && session.idleExpiresAt <= now) return false;
  return true;
}

// ─── Touch throttle ───────────────────────────────────────────────────────────

/**
 * Update last_used_at and idle_expires_at for mobile sessions,
 * but only if the throttle window has elapsed.
 * Web sessions are not touched (short 8h TTL; no idle extension needed).
 */
export async function touchSessionIfDue(session: AuthSession): Promise<void> {
  if (session.clientType !== "mobile") return;
  const now = new Date();
  const msSinceTouch = now.getTime() - session.lastUsedAt.getTime();
  if (msSinceTouch < TOUCH_THROTTLE_MS) return;

  const newIdleExpiry = new Date(now.getTime() + MOBILE_IDLE_TTL_MS);
  await db
    .update(authSessions)
    .set({ lastUsedAt: now, idleExpiresAt: newIdleExpiry })
    .where(and(
      eq(authSessions.sessionId, session.sessionId),
      isNull(authSessions.revokedAt),
    ));
}

// ─── Session revocation ───────────────────────────────────────────────────────

export type RevokeReason = "logout" | "password_reset" | "user_deleted";

/** Revoke a single session by its public sessionId. */
export async function revokeSession(sessionId: string, reason: RevokeReason): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(
      eq(authSessions.sessionId, sessionId),
      isNull(authSessions.revokedAt),
    ));
}

/** Revoke ALL active DB-backed sessions for a user (used by password reset). */
export async function revokeAllUserSessions(userId: number, reason: RevokeReason): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(
      eq(authSessions.userId, userId),
      isNull(authSessions.revokedAt),
    ));
}
