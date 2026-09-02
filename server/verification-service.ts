// server/verification-service.ts
// PRD-020 WS-E: DB-backed verification codes (replaces in-memory Map)

import crypto from "crypto";
import { neon } from "@neondatabase/serverless";

const MAX_ATTEMPTS = 5;
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getDb() { return neon(process.env.DATABASE_URL!); }

export type VerificationPurpose = "email_verification" | "sms_verification";

function hashDestination(destination: string): string {
  return crypto.createHash("sha256").update(destination.toLowerCase().trim()).digest("hex");
}

function hashCode(code: string, destination: string, purpose: string): string {
  return crypto.createHash("sha256")
    .update(`${code}:${destination.toLowerCase().trim()}:${purpose}`)
    .digest("hex");
}

// FR-31: Invalidate existing active codes before creating a new one
export async function createVerificationCode(
  destination: string,
  purpose: VerificationPurpose
): Promise<string> {
  const db = getDb();
  const code = String(crypto.randomInt(100000, 1000000)); // 6-digit CSPRNG
  const destHash = hashDestination(destination);
  const codeHash = hashCode(code, destination, purpose);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

  // FR-31: Invalidate all existing active codes for this destination+purpose
  await db`
    UPDATE verification_codes
    SET invalidated_at = ${now}
    WHERE destination_hash = ${destHash}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND invalidated_at IS NULL
  `;

  // FR-29: Store only code_hash — never raw code
  await db`
    INSERT INTO verification_codes (purpose, destination_hash, code_hash, created_at, expires_at)
    VALUES (${purpose}, ${destHash}, ${codeHash}, ${now}, ${expiresAt})
  `;

  return code; // returned only to caller (for sending via email/SMS) — never stored raw
}

// FR-30: Atomic single-use verification
export async function verifyCode(
  destination: string,
  purpose: VerificationPurpose,
  submittedCode: string
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const destHash = hashDestination(destination);
  const now = new Date().toISOString();

  // Find active code for this destination+purpose
  const rows = await db`
    SELECT id, code_hash, expires_at, attempt_count
    FROM verification_codes
    WHERE destination_hash = ${destHash}
      AND purpose = ${purpose}
      AND used_at IS NULL
      AND invalidated_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!rows.length) return { ok: false, error: "No code found — please request a new one" };
  const record = rows[0];

  // FR-32: Check expiry
  if (new Date(record.expires_at) < new Date()) {
    return { ok: false, error: "Code expired — please request a new one" };
  }

  // FR-33: Check attempt count
  if (record.attempt_count >= MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts — please request a new code" };
  }

  // Check code hash
  const expectedHash = hashCode(submittedCode.trim(), destination, purpose);
  if (expectedHash !== record.code_hash) {
    // Increment attempt count (persist)
    await db`UPDATE verification_codes SET attempt_count = attempt_count + 1 WHERE id = ${record.id}`;
    const remaining = MAX_ATTEMPTS - (record.attempt_count + 1);
    return { ok: false, error: `Incorrect code${remaining > 0 ? ` (${remaining} attempts remaining)` : ""}` };
  }

  // FR-30: Atomic mark as used (prevents double-use)
  const updated = await db`
    UPDATE verification_codes SET used_at = ${now}
    WHERE id = ${record.id} AND used_at IS NULL
    RETURNING id
  `;
  if (!updated.length) return { ok: false, error: "Code already used" };

  return { ok: true };
}
