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
const ALLOWED_WEB_ORIGINS: string[] = [
  "https://www.viewrr.co.uk",
  ...(process.env.NODE_ENV !== "production" ? ["http://localhost:5000"] : []),
];

// ─── requireAuth ──────────────────────────────────────────────────────────────
/**
 * Authenticate the request via Bearer token (mobile) or vr_sess cookie (web).
 * Sets req.auth = { userId, sessionId, clientType } on success.
 * Legacy HMAC drain sessions set req.auth = { userId } (no sessionId/clientType).
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // ── Step 1: Bearer (mobile) ──────────────────────────────────────────────
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    const rawToken = authHeader.slice(7);
    const session = await findSessionByToken(rawToken);

    if (!session) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    // Found in DB — check validity; NEVER fall through to HMAC
    if (!isSessionValid(session)) {
      res.status(401).json({ error: "Session expired or revoked." });
      return;
    }
    // Validate user still exists
    const user = await storage.getUser(session.userId);
    if (!user) {
      await revokeSession(session.sessionId, "user_deleted");
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    await touchSessionIfDue(session);
    req.auth = { userId: session.userId, sessionId: session.sessionId, clientType: "mobile" };
    next();
    return;
  }

  // ── Step 2: Cookie ───────────────────────────────────────────────────────
  const cookieValue = req.cookies?.[SESSION_COOKIE_NAME];
  if (!cookieValue) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  // ── Step 2a: DB-backed cookie ────────────────────────────────────────────
  const session = await findSessionByToken(cookieValue);
  if (session) {
    // Found in DB — never fall through to HMAC regardless of outcome
    if (!isSessionValid(session)) {
      clearSessionCookie(res);
      res.status(401).json({ error: "Session expired or revoked. Please sign in again." });
      return;
    }
    const user = await storage.getUser(session.userId);
    if (!user) {
      await revokeSession(session.sessionId, "user_deleted");
      clearSessionCookie(res);
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    await touchSessionIfDue(session);
    req.auth = { userId: session.userId, sessionId: session.sessionId, clientType: "web" };
    next();
    return;
  }

  // ── Step 2b: Legacy HMAC drain fallback ──────────────────────────────────
  // Only attempted if token NOT found in DB AND is structurally a legacy HMAC token.
  if (!isStructurallyHmacToken(cookieValue)) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const legacy = verifySessionToken(cookieValue);
  if (!legacy) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }
  const legacyUser = await storage.getUser(legacy.userId);
  if (!legacyUser) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  // Legacy session: no sessionId or clientType (drain-period only)
  // R2: HMAC drain telemetry — distinguishes legacy auth from DB-backed auth.
  // Never logs credentials, cookies, tokens, or hashes.
  console.warn(`[auth] legacy-hmac-drain userId=${legacy.userId}`);
  req.auth = { userId: legacy.userId };
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
