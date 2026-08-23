/**
 * P0-04: Server-issued session token — shared module
 * Used by routes.ts and permission-service.ts so both can authenticate callers
 * from the same HttpOnly cookie without duplicating crypto logic.
 *
 * Phase 1: Move to a DB-backed token store for revocation support.
 */
import crypto from "crypto";

export const SESSION_COOKIE_NAME = "vr_sess";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export function getSessionSecret(): string {
  const s = process.env.SESSION_SECRET ?? "";
  if (!s || s.length < 32) throw new Error("SESSION_SECRET env var missing or too short (min 32 chars)");
  return s;
}

export function issueSessionToken(userId: number): string {
  const secret = getSessionSecret();
  const issuedAt = Date.now();
  const payload = `${userId}.${issuedAt}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export function verifySessionToken(token: string): { userId: number; issuedAt: number } | null {
  try {
    const secret = getSessionSecret();
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const dotIndex1 = decoded.indexOf(".");
    const dotIndex2 = decoded.lastIndexOf(".");
    if (dotIndex1 === -1 || dotIndex2 === dotIndex1) return null;
    const userIdStr = decoded.slice(0, dotIndex1);
    const issuedAtStr = decoded.slice(dotIndex1 + 1, dotIndex2);
    const sig = decoded.slice(dotIndex2 + 1);
    const payload = `${userIdStr}.${issuedAtStr}`;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const issuedAt = Number(issuedAtStr);
    if (!Number.isFinite(issuedAt)) return null;
    if (Date.now() - issuedAt > SESSION_TTL_MS) return null;
    return { userId: Number(userIdStr), issuedAt };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: any, userId: number): void {
  const token = issueSessionToken(userId);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: any): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}
