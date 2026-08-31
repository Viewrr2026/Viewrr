/**
 * PRD-019: Password service — Argon2id hashing + opportunistic legacy migration.
 *
 * Legacy (PRD-016A Phase 0): SHA-256(password + "viewrr_salt_2026") → 64-char hex
 * Modern (PRD-019+):         Argon2id, OWASP recommended params (m=64MiB, t=3, p=1)
 *
 * Discrimination: modern hashes start with "$argon2id$"; legacy are 64-char hex.
 * The password_algo column ('sha256_v1' | 'argon2id') also serves as a discriminator.
 *
 * Migration is OPPORTUNISTIC:
 *   - Only on SUCCESSFUL legacy-password login
 *   - UPDATE ... WHERE password_algo = 'sha256_v1' (idempotent under concurrency)
 *   - Wrong-password attempts NEVER modify the stored hash
 */

import crypto from "crypto";
import argon2 from "argon2";
import type { HashOptions } from "argon2";
import { db } from "./storage";
import { users } from "../shared/schema";
import { eq, and } from "drizzle-orm";

// ─── Constants ─────────────────────────────────────────────────────────────────
const LEGACY_SALT = "viewrr_salt_2026";

const ARGON2_OPTIONS: HashOptions = {
  type:         argon2.argon2id,  // 2 = argon2id constant
  memoryCost:   65536,            // 64 MiB
  timeCost:     3,
  parallelism:  1,
  hashLength:   32,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Compute the legacy SHA-256 hash. Used for verification of existing hashes only. */
function legacyHash(password: string): string {
  return crypto.createHash("sha256").update(password + LEGACY_SALT).digest("hex");
}

/** Hash a password with Argon2id for new storage. Returns a string hash. */
export async function hashPasswordArgon2id(password: string): Promise<string> {
  // raw: false (default) returns a string; we type-assert to help TS.
  const result = await argon2.hash(password, { ...ARGON2_OPTIONS, raw: false });
  return result as unknown as string;
}

/** True if the stored hash is a legacy SHA-256 hex hash. */
export function isLegacyHash(storedHash: string): boolean {
  return !storedHash.startsWith("$argon2id$");
}

// ─── Verification ──────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean;
  wasLegacy: boolean; // true if the stored hash was legacy SHA-256
}

/**
 * Verify a password against a stored hash (legacy or modern).
 * NEVER modifies the DB — that is handled by migratePasswordIfLegacy below.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<VerifyResult> {
  if (isLegacyHash(storedHash)) {
    // Legacy: string equality of SHA-256 hashes
    // Both are hex strings of the same fixed length — constant-time compare
    const candidate = legacyHash(password);
    const a = Buffer.from(candidate, "hex");
    const b = Buffer.from(storedHash, "hex");
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid, wasLegacy: true };
  } else {
    // Modern: Argon2id verify
    try {
      const valid = await argon2.verify(storedHash, password, ARGON2_OPTIONS);
      return { valid, wasLegacy: false };
    } catch {
      return { valid: false, wasLegacy: false };
    }
  }
}

/**
 * After a SUCCESSFUL legacy-password login, opportunistically migrate to Argon2id.
 * Uses WHERE password_algo = 'sha256_v1' to be idempotent under concurrent logins.
 * Called ONLY when verifyResult.valid === true && verifyResult.wasLegacy === true.
 */
export async function migratePasswordIfLegacy(
  userId: number,
  password: string,
): Promise<void> {
  const newHash = await hashPasswordArgon2id(password);
  await db
    .update(users)
    .set({ passwordHash: newHash, passwordAlgo: "argon2id" })
    .where(and(
      eq(users.id, userId),
      eq(users.passwordAlgo, "sha256_v1"), // idempotent guard
    ));
}
