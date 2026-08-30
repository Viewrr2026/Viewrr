/**
 * PRD-018: Shared authentication middleware for routes.ts and
 * retainer-builder-routes.ts.
 *
 * Exported so that route files that do NOT have access to the locally-defined
 * copies inside routes.ts can import them directly.
 *
 * Architecture:
 *  - No server-side sessions — req.user is always undefined.
 *  - requireAuth verifies the vr_sess HMAC cookie and sets req.auth = { userId }.
 *  - requireAdminGuard additionally checks isAdmin in the DB.
 */

import type { Request, Response, NextFunction } from "express";
import { neon } from "@neondatabase/serverless";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  clearSessionCookie,
} from "./session";

// ─── requireAuth ─────────────────────────────────────────────────────────────
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (!rawCookie) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const session = verifySessionToken(rawCookie);
  if (!session) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }
  req.auth = { userId: session.userId };
  next();
}

// ─── requireAdminGuard ───────────────────────────────────────────────────────
export async function requireAdminGuard(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (!rawCookie) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const session = verifySessionToken(rawCookie);
  if (!session) {
    clearSessionCookie(res);
    res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }
  // DB lookup — verify the user exists and is an admin
  try {
    const db = neon(process.env.DATABASE_URL!);
    const rows = await db`SELECT id, is_admin FROM users WHERE id = ${session.userId} LIMIT 1`;
    if (!rows.length) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!rows[0].is_admin) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
  } catch {
    res.status(503).json({ error: "Admin routes unavailable — server misconfigured." });
    return;
  }
  req.auth = { userId: session.userId };
  next();
}
