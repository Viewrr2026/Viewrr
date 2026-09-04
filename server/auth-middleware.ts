/**
 * PRD-019: Consolidated authentication middleware.
 *
 * Replaces the local copies in routes.ts and the previous version of this file.
 * Imported by routes.ts, retainer-builder-routes.ts, and any future route files.
 *
 * Session verification priority:
 *  1. Authorization: Bearer <token>   → DB-backed mobile session
 *  2. Cookie: vr_sess=<opaque token>  → DB-backed web session
 *  3. Cookie: vr_sess=<HMAC token>    → legacy HMAC drain fallback (structural guard required)
 *
 * Safety rules:
 *  - A DB-found token that is revoked or expired → 401 immediately; NEVER falls through to HMAC.
 *  - HMAC fallback is only attempted for tokens structurally identifiable as legacy.
 *  - Raw tokens are NEVER logged.
 *
 * Origin validation (requireBrowserOrigin):
 *  - Applied to unsafe methods (POST/PUT/PATCH/DELETE) on cookie-authenticated routes.
 *  - Skipped for Bearer-authenticated requests (native mobile — not browser CORS).
 *  - Allowed origins are controlled by the ALLOWED_WEB_ORIGINS array.
 *
 * PRD-1 (Decision 1) additions:
 *  - optionalAuth: populates req.auth when valid credentials are present and
 *    otherwise continues anonymously. It NEVER returns 401. Used on publicly
 *    readable surfaces (GET /api/feed, GET /api/feed/:id/comments) so the feed
 *    stays public while the viewer is derived from the session, never from a
 *    client-supplied query string.
 *  - Suspension enforcement (contract section F): requireAuth returns
 *    403 ACCOUNT_SUSPENDED when users.account_status is 'suspended'.
 */

import type { Request, Response, NextFunction } from "express";
import { neon } from "@neondatabase/serverless";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  clearSessionCookie,
} from "./session";
import {
  findSessionByToken,
  isSessionValid,
  touchSessionIfDue,
  isStructurallyHmacToken,
  revokeSession,
} from "./auth-sessions";
import { storage } from "./storage";

// ─── CSRF Origin allowlist ─────────────────────────────────────────────────────
const configuredAppOrigin = (() => {
  const value = process.env.APP_BASE_URL;
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    console.warn("[auth] Ignoring invalid APP_BASE_URL while building CSRF origin allowlist.");
    return null;
  }
})();

const ALLOWED_WEB_ORIGINS: string[] = [
  "https://www.viewrr.co.uk",
  ...(configuredAppOrigin ? [configuredAppOrigin] : []),
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:5000"] : []),
];

// ─── Shared session resolution ────────────────────────────────────────────────
/** Authentication context attached to req.auth. */
type AuthContext = {
  userId: number;
  sessionId?: string;
  clientType?: "web" | "mobile";
};

type AuthResolution =
  /** Valid credentials presented. */
  | { kind: "authenticated"; auth: AuthContext; accountStatus: string }
  /** No credentials at all — legitimate anonymous visitor. */
  | { kind: "anonymous" }
  /** Credentials presented but invalid/expired/revoked. */
  | { kind: "rejected"; message: string; clearCookie: boolean };

/**
 * Single source of truth for session verification, shared by requireAuth and
 * optionalAuth. Performs no response writes except cookie clearing, which is
 * signalled back to the caller via `clearCookie` instead.
 */
async function resolveAuth(req: Request): Promise<AuthResolution> {
  // ── Step 1: Bearer (mobile) ──────────────────────────────────────────────
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    const rawToken = authHeader.slice(7);
    const session = await findSessionByToken(rawToken);

    if (!session) {
      return { kind: "rejected", message: "Authentication required.", clearCookie: false };
    }
    // Found in DB — check validity; NEVER fall through to HMAC
    if (!isSessionValid(session)) {
      return { kind: "rejected", message: "Session expired or revoked.", clearCookie: false };
    }
    // Validate user still exists
    const user = await storage.getUser(session.userId);
    if (!user) {
      await revokeSession(session.sessionId, "user_deleted");
      return { kind: "rejected", message: "Authentication required.", clearCookie: false };
    }
    await touchSessionIfDue(session);
    return {
      kind: "authenticated",
      auth: { userId: session.userId, sessionId: session.sessionId, clientType: "mobile" },
      accountStatus: (user as any).accountStatus ?? "active",
    };
  }

  // ── Step 2: Cookie ───────────────────────────────────────────────────────
  const cookieValue = req.cookies?.[SESSION_COOKIE_NAME];
  if (!cookieValue) {
    return { kind: "anonymous" };
  }

  // ── Step 2a: DB-backed cookie ────────────────────────────────────────────
  const session = await findSessionByToken(cookieValue);
  if (session) {
    // Found in DB — never fall through to HMAC regardless of outcome
    if (!isSessionValid(session)) {
      return {
        kind: "rejected",
        message: "Session expired or revoked. Please sign in again.",
        clearCookie: true,
      };
    }
    const user = await storage.getUser(session.userId);
    if (!user) {
      await revokeSession(session.sessionId, "user_deleted");
      return { kind: "rejected", message: "Authentication required.", clearCookie: true };
    }
    await touchSessionIfDue(session);
    return {
      kind: "authenticated",
      auth: { userId: session.userId, sessionId: session.sessionId, clientType: "web" },
      accountStatus: (user as any).accountStatus ?? "active",
    };
  }

  // ── Step 2b: Legacy HMAC drain fallback ──────────────────────────────────
  // Only attempted if token NOT found in DB AND is structurally a legacy HMAC token.
  if (!isStructurallyHmacToken(cookieValue)) {
    return { kind: "rejected", message: "Authentication required.", clearCookie: false };
  }
  const legacy = verifySessionToken(cookieValue);
  if (!legacy) {
    return {
      kind: "rejected",
      message: "Session expired or invalid. Please sign in again.",
      clearCookie: true,
    };
  }
  const legacyUser = await storage.getUser(legacy.userId);
  if (!legacyUser) {
    return { kind: "rejected", message: "Authentication required.", clearCookie: true };
  }
  // Legacy session: no sessionId or clientType (drain-period only)
  // R2: HMAC drain telemetry — distinguishes legacy auth from DB-backed auth.
  // Never logs credentials, cookies, tokens, or hashes.
  console.warn(`[auth] legacy-hmac-drain userId=${legacy.userId}`);
  return {
    kind: "authenticated",
    auth: { userId: legacy.userId },
    accountStatus: (legacyUser as any).accountStatus ?? "active",
  };
}

// ─── requireAuth ──────────────────────────────────────────────────────────────
/**
 * Authenticate the request via Bearer token (mobile) or vr_sess cookie (web).
 * Sets req.auth = { userId, sessionId, clientType } on success.
 * Legacy HMAC drain sessions set req.auth = { userId } (no sessionId/clientType).
 *
 * PRD-1 contract section F: a suspended account is rejected with
 * 403 { error, code: "ACCOUNT_SUSPENDED" } on every authenticated route.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const resolved = await resolveAuth(req);

  if (resolved.kind === "anonymous") {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (resolved.kind === "rejected") {
    if (resolved.clearCookie) clearSessionCookie(res);
    res.status(401).json({ error: resolved.message });
    return;
  }

  // ── Suspension enforcement (PRD-1 contract section F) ────────────────────
  if (resolved.accountStatus === "suspended") {
    res.status(403).json({
      error: "Your account has been suspended. Contact support if you believe this is a mistake.",
      code: "ACCOUNT_SUSPENDED",
    });
    return;
  }

  req.auth = resolved.auth;
  next();
}

// ─── optionalAuth ─────────────────────────────────────────────────────────────
/**
 * PRD-1 Decision 1: populate req.auth when valid credentials are present, and
 * otherwise continue anonymously. NEVER returns 401 and never returns 403 —
 * routes using it must be safe for anonymous visitors.
 *
 * Invalid/expired credentials are treated as anonymous rather than an error so
 * a stale cookie can never break a public page. A suspended account is also
 * treated as anonymous (it simply gets the public view; every interaction route
 * still runs requireAuth and returns 403 ACCOUNT_SUSPENDED).
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resolved = await resolveAuth(req);
    if (resolved.kind === "authenticated" && resolved.accountStatus !== "suspended") {
      req.auth = resolved.auth;
    }
  } catch (e: any) {
    // Never let an auth lookup failure break a public read path.
    console.warn("[auth] optionalAuth resolution failed:", e?.message ?? "unknown error");
  }
  next();
}

// ─── requireAdminGuard ────────────────────────────────────────────────────────
/**
 * requireAuth + DB check for isAdmin.
 * Sets req.auth = { userId, sessionId?, clientType?, adminUser }.
 */
export async function requireAdminGuard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Wrap requireAuth inline, then check admin
  await requireAuth(req, res, async () => {
    const userId = req.auth!.userId;
    try {
      const db = neon(process.env.DATABASE_URL!);
      const rows = await db`SELECT id, is_admin FROM users WHERE id = ${userId} LIMIT 1`;
      if (!rows.length) {
        res.status(401).json({ error: "Authentication required." });
        return;
      }
      if (!rows[0].is_admin) {
        res.status(403).json({ error: "Forbidden." });
        return;
      }
      // Attach full user to req.auth for admin routes that need it
      const user = await storage.getUser(userId);
      if (!user) { res.status(401).json({ error: "Authentication required." }); return; }
      req.auth = { ...req.auth!, adminUser: user };
    } catch {
      res.status(503).json({ error: "Admin routes unavailable — server misconfigured." });
      return;
    }
    next();
  });
}

// ─── requireBrowserOrigin ─────────────────────────────────────────────────────
/**
 * Defence-in-depth CSRF mitigation for cookie-authenticated browser requests.
 *
 * Applied to unsafe methods (POST/PUT/PATCH/DELETE).
 * Skipped entirely for Bearer-authenticated requests (native mobile, not browser).
 * Skipped for requests with no Origin header (same-origin browser POSTs always include Origin;
 * non-browser clients such as Postman do not — we accept those).
 *
 * SameSite=Strict is the primary CSRF defence; this is defence-in-depth only.
 */
export function requireBrowserOrigin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];
  if (SAFE_METHODS.includes(req.method)) { next(); return; }

  // Bearer-authenticated requests are not browser cookie requests — skip
  if (req.headers["authorization"]?.startsWith("Bearer ")) { next(); return; }

  const origin = req.headers["origin"];
  if (!origin) { next(); return; } // no Origin = non-browser client = not subject to this check

  if (!ALLOWED_WEB_ORIGINS.includes(origin)) {
    res.status(403).json({ error: "Origin not permitted.", code: "CSRF_ORIGIN" });
    return;
  }
  next();
}
