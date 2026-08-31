/**
 * PRD-020 WS-D: Object Storage Test Suite
 *
 * Tests the upload_objects table and presigned-URL flow:
 *   O1: upload_objects table exists with required columns
 *   O2: object_key column has UNIQUE constraint
 *   O3: idx_upload_objects_owner, idx_upload_objects_resource, idx_upload_objects_status indexes exist
 *   O4: isAllowedMime — rejects disallowed MIME types
 *   O5: isAllowedMime — accepts allowed MIME types per resource type
 *   O6: generateObjectKey — produces UUID-based path, never raw filename
 *   O7: upload_objects insert → confirm status transition pending → ready
 *
 * Uses Node.js built-in test runner.
 * Run with: npx tsx --test server/tests/object-storage.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";
import { isAllowedMime, generateObjectKey, MAX_UPLOAD_BYTES } from "../object-storage.js";

const DB_URL = process.env.DATABASE_URL ?? "";
if (!DB_URL) {
  console.warn("[object-storage] DATABASE_URL not set — skipping DB tests");
}

const sql = DB_URL ? neon(DB_URL) : null;

const TEST_USER_ID = 9999999;

async function cleanupTestObjects() {
  if (!sql) return;
  await sql.query(
    `DELETE FROM upload_objects WHERE owner_user_id = $1`,
    [TEST_USER_ID]
  );
}

before(async () => { await cleanupTestObjects(); });
after(async () => { await cleanupTestObjects(); });

describe("O1: upload_objects table — required columns", () => {
  it("should have all required columns", async () => {
    if (!sql) return;
    const rows = await sql.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'upload_objects'
       ORDER BY column_name`
    );
    const names = (rows as any[]).map((r: any) => r.column_name);
    const required = [
      "id", "owner_user_id", "object_key", "resource_type",
      "mime_type", "status", "upload_intent_expires_at", "created_at"
    ];
    for (const col of required) {
      assert.ok(names.includes(col), `missing column: ${col}`);
    }
  });
});

describe("O2: upload_objects — object_key UNIQUE constraint", () => {
  it("should reject duplicate object_key", async () => {
    if (!sql) return;
    const key = `test/prd020-unique-${Date.now()}.jpg`;
    const expires = new Date(Date.now() + 300_000).toISOString();

    await sql.query(
      `INSERT INTO upload_objects
         (owner_user_id, object_key, resource_type, mime_type, status, upload_intent_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [TEST_USER_ID, key, "portfolio", "image/jpeg", "pending", expires]
    );

    let threw = false;
    try {
      await sql.query(
        `INSERT INTO upload_objects
           (owner_user_id, object_key, resource_type, mime_type, status, upload_intent_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [TEST_USER_ID, key, "portfolio", "image/jpeg", "pending", expires]
      );
    } catch (e: any) {
      threw = true;
      assert.ok(
        e.message?.includes("unique") || e.message?.includes("duplicate") || e.code === "23505",
        `Expected unique violation, got: ${e.message}`
      );
    }
    assert.ok(threw, "duplicate object_key should throw");
  });
});

describe("O3: upload_objects — required indexes exist", () => {
  it("should have idx_upload_objects_owner, _resource, _status", async () => {
    if (!sql) return;
    const rows = await sql.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'upload_objects'
         AND indexname = ANY($1)`,
      [["idx_upload_objects_owner", "idx_upload_objects_resource", "idx_upload_objects_status"]]
    );
    const names = (rows as any[]).map((r: any) => r.indexname);
    assert.ok(names.includes("idx_upload_objects_owner"), "missing idx_upload_objects_owner");
    assert.ok(names.includes("idx_upload_objects_resource"), "missing idx_upload_objects_resource");
    assert.ok(names.includes("idx_upload_objects_status"), "missing idx_upload_objects_status");
  });
});

describe("O4: isAllowedMime — rejects disallowed types", () => {
  it("should reject application/x-executable for portfolio", () => {
    assert.strictEqual(isAllowedMime("portfolio", "application/x-executable"), false);
  });

  it("should reject text/html for any resource type", () => {
    for (const rt of ["portfolio", "profile", "deliverable"]) {
      assert.strictEqual(isAllowedMime(rt, "text/html"), false, `html should be rejected for ${rt}`);
    }
  });

  it("should reject unknown resource types", () => {
    assert.strictEqual(isAllowedMime("unknown_type", "image/jpeg"), false);
  });
});

describe("O5: isAllowedMime — accepts allowed types per resource", () => {
  it("should accept image/jpeg and image/png for portfolio", () => {
    assert.strictEqual(isAllowedMime("portfolio", "image/jpeg"), true);
    assert.strictEqual(isAllowedMime("portfolio", "image/png"), true);
  });

  it("should accept application/pdf for deliverable", () => {
    assert.strictEqual(isAllowedMime("deliverable", "application/pdf"), true);
  });
});

describe("O6: generateObjectKey — UUID-based, no raw filename", () => {
  it("should return a path with UUID segment, not a user filename", () => {
    const key = generateObjectKey("portfolio", 42, "jpg");
    // Must contain UUID-like segment (hex chars and dashes)
    assert.match(key, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      "key must contain UUID");
    // Must NOT be the raw filename
    assert.ok(!key.includes("my photo.jpg"), "key must not contain raw filename");
    // Must start with resource type prefix
    assert.ok(key.startsWith("portfolio/"), "key must be prefixed with resource type");
    // Must include user id
    assert.ok(key.includes("/42/"), "key must include userId segment");
  });

  it("should produce unique keys on each call", () => {
    const k1 = generateObjectKey("portfolio", 1, "jpg");
    const k2 = generateObjectKey("portfolio", 1, "jpg");
    assert.notStrictEqual(k1, k2, "each key must be unique");
  });
});

describe("O7: upload_objects status transition pending → ready", () => {
  it("should update status to ready on confirm", async () => {
    if (!sql) return;
    const key = `portfolio/prd020-status-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
    const expires = new Date(Date.now() + 300_000).toISOString();

    const [row] = await sql.query<{ id: number }>(
      `INSERT INTO upload_objects
         (owner_user_id, object_key, resource_type, mime_type, status, upload_intent_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [TEST_USER_ID, key, "portfolio", "image/jpeg", "pending", expires]
    );
    const id = (row as any).id;

    // Confirm
    await sql.query(
      `UPDATE upload_objects SET status = 'ready', confirmed_at = $1, size_bytes = $2
       WHERE id = $3`,
      [new Date().toISOString(), 102400, id]
    );

    const [updated] = await sql.query<{ status: string; size_bytes: number }>(
      `SELECT status, size_bytes FROM upload_objects WHERE id = $1`,
      [id]
    );
    assert.strictEqual((updated as any).status, "ready");
    assert.strictEqual((updated as any).size_bytes, 102400);
  });
});

describe("O8: MAX_UPLOAD_BYTES — defined and reasonable", () => {
  it("should define MAX_UPLOAD_BYTES", () => {
    assert.ok(typeof MAX_UPLOAD_BYTES === "object", "MAX_UPLOAD_BYTES should be an object map");
    // Each value should be a positive number <= 500MB
    for (const [rt, max] of Object.entries(MAX_UPLOAD_BYTES)) {
      assert.ok(typeof max === "number" && (max as number) > 0, `${rt}: max must be positive`);
      assert.ok((max as number) <= 500 * 1024 * 1024, `${rt}: max must be <= 500MB`);
    }
  });
});
