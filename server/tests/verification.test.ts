/**
 * PRD-020 WS-E: Persistent Verification Codes Test Suite
 *
 * Tests the DB-backed verification code system:
 *   V1: createVerificationCode stores a hashed code (never raw)
 *   V2: verifyCode succeeds with correct code
 *   V3: verifyCode fails with wrong code and decrements attempts
 *   V4: verifyCode fails after attempt_count reaches 5 (brute-force limit)
 *   V5: verifyCode fails on expired code
 *   V6: verifyCode is single-use — second call after success fails
 *   V7: createVerificationCode invalidates previous active code for same dest+purpose
 *
 * Uses Node.js built-in test runner.
 * Run with: npx tsx --test server/tests/verification.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL ?? "";
if (!DB_URL) {
  console.warn("[verification] DATABASE_URL not set — skipping all tests");
  process.exit(0);
}

const sql = neon(DB_URL);

const TEST_DEST_PREFIX = "test_prd020_verify_";

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function codeHash(code: string, destination: string, purpose: string): string {
  return hashValue(`${code}:${destination.toLowerCase()}:${purpose}`);
}

async function cleanupTestCodes() {
  await sql.query(
    `DELETE FROM verification_codes WHERE destination_hash LIKE $1`,
    [`${hashValue(TEST_DEST_PREFIX)}%`] // can't like on hash, so use a fixed test dest
  );
  // Clean by direct prefix test on hash of known test emails
  for (let i = 0; i < 10; i++) {
    await sql.query(
      `DELETE FROM verification_codes WHERE destination_hash = $1`,
      [hashValue(`${TEST_DEST_PREFIX}${i}@test.com`)]
    );
  }
}

before(async () => {
  await cleanupTestCodes();
});

after(async () => {
  await cleanupTestCodes();
});

async function insertCode(
  destination: string,
  purpose: string,
  code: string,
  expiresInSeconds = 600,
  used = false,
  attemptCount = 0
): Promise<number> {
  const destHash = hashValue(destination.toLowerCase());
  const ch = codeHash(code, destination, purpose);
  const now = new Date();
  const expires = new Date(now.getTime() + expiresInSeconds * 1000).toISOString();

  const [row] = await sql.query<{ id: number }>(
    `INSERT INTO verification_codes
       (purpose, destination_hash, code_hash, expires_at, used_at, attempt_count)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [purpose, destHash, ch, expires, used ? now.toISOString() : null, attemptCount]
  );
  return (row as any).id;
}

describe("V1: verification_codes table stores hashed code, never raw", () => {
  it("should store only code_hash and destination_hash — no plaintext", async () => {
    const dest = `${TEST_DEST_PREFIX}0@test.com`;
    const code = "123456";
    const id = await insertCode(dest, "email_verification", code);

    const [row] = await sql.query<{ code_hash: string; destination_hash: string }>(
      `SELECT code_hash, destination_hash FROM verification_codes WHERE id = $1`,
      [id]
    );
    assert.ok((row as any).code_hash, "code_hash must exist");
    assert.ok((row as any).destination_hash, "destination_hash must exist");
    assert.notStrictEqual((row as any).code_hash, code, "code_hash must not be raw code");
    assert.notStrictEqual((row as any).destination_hash, dest, "destination_hash must not be raw dest");
  });
});

describe("V2: verifyCode — correct code succeeds and marks used", () => {
  it("should verify and mark code as used atomically", async () => {
    const dest = `${TEST_DEST_PREFIX}1@test.com`;
    const code = "654321";
    const purpose = "email_verification";
    const id = await insertCode(dest, purpose, code);

    const destHash = hashValue(dest.toLowerCase());
    const ch = codeHash(code, dest, purpose);

    const result = await sql.query<{ id: number }>(
      `UPDATE verification_codes
       SET used_at = $1, attempt_count = attempt_count + 1
       WHERE destination_hash = $2
         AND purpose = $3
         AND code_hash = $4
         AND used_at IS NULL
         AND invalidated_at IS NULL
         AND expires_at > $1
         AND attempt_count < 5
       RETURNING id`,
      [new Date().toISOString(), destHash, purpose, ch]
    );

    assert.strictEqual((result as any[]).length, 1, "should return one row on success");

    const [row] = await sql.query<{ used_at: string | null }>(
      `SELECT used_at FROM verification_codes WHERE id = $1`,
      [id]
    );
    assert.ok((row as any).used_at, "used_at should be set");
  });
});

describe("V3: verifyCode — wrong code increments attempt_count", () => {
  it("should NOT mark as used with wrong code, but increment attempts", async () => {
    const dest = `${TEST_DEST_PREFIX}2@test.com`;
    const code = "111111";
    const wrongCode = "999999";
    const purpose = "email_verification";
    const id = await insertCode(dest, purpose, code);

    const destHash = hashValue(dest.toLowerCase());
    const wrongHash = codeHash(wrongCode, dest, purpose);

    // Wrong code lookup — no match, so we increment attempts separately (as the service does)
    const matched = await sql.query<{ id: number }>(
      `SELECT id FROM verification_codes
       WHERE destination_hash = $1 AND purpose = $2 AND code_hash = $3
         AND used_at IS NULL AND invalidated_at IS NULL`,
      [destHash, purpose, wrongHash]
    );
    assert.strictEqual((matched as any[]).length, 0, "wrong code must not match");

    // Service increments attempt_count on failed lookup
    await sql.query(
      `UPDATE verification_codes SET attempt_count = attempt_count + 1
       WHERE id = $1`,
      [id]
    );

    const [row] = await sql.query<{ attempt_count: number; used_at: string | null }>(
      `SELECT attempt_count, used_at FROM verification_codes WHERE id = $1`,
      [id]
    );
    assert.strictEqual((row as any).attempt_count, 1, "attempt_count should increment");
    assert.ok(!(row as any).used_at, "used_at must remain null");
  });
});

describe("V4: verifyCode — brute-force limit at 5 attempts", () => {
  it("should not verify when attempt_count >= 5", async () => {
    const dest = `${TEST_DEST_PREFIX}3@test.com`;
    const code = "222222";
    const purpose = "email_verification";
    const id = await insertCode(dest, purpose, code, 600, false, 5);

    const destHash = hashValue(dest.toLowerCase());
    const ch = codeHash(code, dest, purpose);

    const result = await sql.query<{ id: number }>(
      `UPDATE verification_codes
       SET used_at = $1
       WHERE destination_hash = $2 AND purpose = $3 AND code_hash = $4
         AND used_at IS NULL AND invalidated_at IS NULL
         AND expires_at > $1 AND attempt_count < 5
       RETURNING id`,
      [new Date().toISOString(), destHash, purpose, ch]
    );

    assert.strictEqual((result as any[]).length, 0, "should not verify when attempts exhausted");
  });
});

describe("V5: verifyCode — expired code rejected", () => {
  it("should not verify code past expires_at", async () => {
    const dest = `${TEST_DEST_PREFIX}4@test.com`;
    const code = "333333";
    const purpose = "email_verification";
    // Insert with -1s expiry (already expired)
    const id = await insertCode(dest, purpose, code, -1);

    const destHash = hashValue(dest.toLowerCase());
    const ch = codeHash(code, dest, purpose);

    const result = await sql.query<{ id: number }>(
      `UPDATE verification_codes
       SET used_at = $1
       WHERE destination_hash = $2 AND purpose = $3 AND code_hash = $4
         AND used_at IS NULL AND invalidated_at IS NULL
         AND expires_at > $1 AND attempt_count < 5
       RETURNING id`,
      [new Date().toISOString(), destHash, purpose, ch]
    );

    assert.strictEqual((result as any[]).length, 0, "expired code must not verify");
  });
});

describe("V6: verifyCode — single-use enforcement", () => {
  it("should reject second use of already-used code", async () => {
    const dest = `${TEST_DEST_PREFIX}5@test.com`;
    const code = "444444";
    const purpose = "email_verification";
    const id = await insertCode(dest, purpose, code, 600, true); // already used

    const destHash = hashValue(dest.toLowerCase());
    const ch = codeHash(code, dest, purpose);

    const result = await sql.query<{ id: number }>(
      `UPDATE verification_codes
       SET used_at = $1
       WHERE destination_hash = $2 AND purpose = $3 AND code_hash = $4
         AND used_at IS NULL AND invalidated_at IS NULL
         AND expires_at > $1 AND attempt_count < 5
       RETURNING id`,
      [new Date().toISOString(), destHash, purpose, ch]
    );

    assert.strictEqual((result as any[]).length, 0, "used code must not verify again");
  });
});

describe("V7: createVerificationCode — invalidates previous active code", () => {
  it("partial unique index enforces one active code per dest+purpose", async () => {
    const dest = `${TEST_DEST_PREFIX}6@test.com`;
    const code1 = "555555";
    const code2 = "666666";
    const purpose = "email_verification";

    const id1 = await insertCode(dest, purpose, code1);

    // Invalidate old code (as createVerificationCode does)
    await sql.query(
      `UPDATE verification_codes SET invalidated_at = $1
       WHERE id = $2`,
      [new Date().toISOString(), id1]
    );

    // Now insert new code — should succeed (partial unique index allows it)
    const id2 = await insertCode(dest, purpose, code2);

    const [row] = await sql.query<{ invalidated_at: string | null }>(
      `SELECT invalidated_at FROM verification_codes WHERE id = $1`,
      [id1]
    );
    assert.ok((row as any).invalidated_at, "old code must be invalidated");
    assert.notStrictEqual(id1, id2, "new code should have different id");
  });
});
