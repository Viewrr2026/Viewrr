import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMultipartMediaService } from '../media-multipart';
import { MEDIA_PART_BYTES, MEDIA_UPLOAD_MAX_BYTES, partByteLength } from '../../shared/media-upload';
const db = new PGlite();
let folder: string;
type Upload = { mime: string; parts: Map<number, { Size: number; ETag: string }>; size?: number; aborted?: boolean };
const objects = new Map<string, Upload>();
let completeCalls = 0, loseCompleteResponse = false, denyScope = '', published = 0;
const storage = {
  async create(key: string, mime: string) { objects.set(key, { mime, parts: new Map() }); return `upload-${key}`; },
  async part(key: string, _id: string, part: number, body: AsyncIterable<Buffer>, size: number) {
    let read = 0; for await (const bytes of body) read += bytes.length;
    assert.equal(read, size);
    objects.get(key)!.parts.set(part, { Size: size, ETag: `etag-${part}-${size}` });
  },
  async list(key: string) { return [...objects.get(key)!.parts].map(([PartNumber, p]) => ({ PartNumber, ...p })); },
  async complete(key: string) {
    completeCalls++;
    const object = objects.get(key)!;
    object.size = [...object.parts.values()].reduce((total, p) => total + p.Size, 0);
    if (loseCompleteResponse) { loseCompleteResponse = false; throw new Error('Connection lost after R2 completion'); }
  },
  async abort(key: string) { if (objects.has(key)) objects.get(key)!.aborted = true; },
  async head(key: string) { const o = objects.get(key); return { exists: o?.size !== undefined, size: o?.size, contentType: o?.mime }; },
  async remove(key: string) { objects.delete(key); },
};
const service = createMultipartMediaService({
  transaction: fn => db.transaction(tx => fn({ query: async (sql, values) => await tx.query(sql, values) as any })),
  storage,
  authorize: async (_db, scope) => { if (scope === denyScope) throw Object.assign(new Error('Not allowed'), { status: 403 }); return null; },
  publishCustom: async () => { published++; },
});
const input = (size: number) => ({ size, mime: 'video/mp4', filename: 'video.mp4' });
const row = async (id: number) => (await db.query<any>('SELECT * FROM upload_objects WHERE id=$1', [id])).rows[0];
async function seedParts(id: number) {
  const r = await row(id), o = objects.get(r.object_key)!;
  for (let part = 1; part <= Math.ceil(Number(r.size_bytes) / MEDIA_PART_BYTES); part++) o.parts.set(part, { Size: partByteLength(Number(r.size_bytes), part), ETag: `etag-${part}` });
}
before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'viewrr-chunk-test-'));
  await db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,account_status TEXT); INSERT INTO users VALUES(1,'active'),(2,'active');
    CREATE TABLE upload_objects(id SERIAL PRIMARY KEY,owner_user_id INTEGER,object_key TEXT UNIQUE,resource_type TEXT,resource_id INTEGER,mime_type TEXT,size_bytes INTEGER,original_filename TEXT,status TEXT,upload_intent_expires_at TEXT,confirmed_at TEXT,created_at TEXT);
    CREATE TABLE retainer_media(id SERIAL PRIMARY KEY,size_bytes INTEGER); INSERT INTO retainer_media(size_bytes) VALUES(123);`);
  const migration = await readFile(new URL('../../migrations/0018_large_media_uploads.sql', import.meta.url), 'utf8');
  await db.exec(migration); await db.exec(migration);
});
after(async () => { await db.close(); await rm(folder, { recursive: true, force: true }); });
test('migration preserves existing sizes and stores 5 GB in both tables', async () => {
  assert.equal(Number((await db.query<any>('SELECT size_bytes FROM retainer_media WHERE id=1')).rows[0].size_bytes), 123);
  await db.query('INSERT INTO retainer_media(size_bytes) VALUES($1)', [MEDIA_UPLOAD_MAX_BYTES]);
  const u = await service.start(1, 'portfolio', input(MEDIA_UPLOAD_MAX_BYTES));
  assert.equal(Number((await row(u.id)).size_bytes), MEDIA_UPLOAD_MAX_BYTES);
  // Metadata boundary test; no 5 GB payload is sent to live storage.
  await seedParts(u.id);
  assert.equal(objects.get((await row(u.id)).object_key)!.parts.size, 640);
  await service.complete(1, u.id); assert.equal((await row(u.id)).status, 'media_queued');
});
test('rejects oversized, fractional, empty and unsupported files before storage writes', async () => {
  const count = objects.size;
  for (const size of [MEDIA_UPLOAD_MAX_BYTES + 1, 0, -1, 1.5, NaN, '500']) await assert.rejects(service.start(1, 'feed', input(size as number)), { status: 413 });
  await assert.rejects(service.start(1, 'profile', input(100)), { status: 400 });
  await assert.rejects(service.start(1, 'profile', { ...input(6 * 1024 * 1024), mime: 'image/jpeg' }), { status: 413 });
  await assert.rejects(service.start(1, 'feed', { ...input(100), mime: 'application/zip' }), { status: 400 });
  await assert.rejects(service.start(1, 'invalid', input(100)), { status: 400 });
  assert.equal(objects.size, count);
});
test('chunks enforce ownership, exact size and numbering; retries replace unfinished parts', async () => {
  const u = await service.start(1, 'feed', input(MEDIA_PART_BYTES + 17));
  const path = join(folder, 'part'); await writeFile(path, Buffer.alloc(MEDIA_PART_BYTES, 7));
  const file = { path, size: MEDIA_PART_BYTES };
  await assert.rejects(service.part(2, u.id, 1, file), { status: 404 });
  await assert.rejects(service.complete(2, u.id), { status: 404 });
  await assert.rejects(service.abort(2, u.id), { status: 404 });
  for (const part of [0, -1, 1.5, 3]) await assert.rejects(service.part(1, u.id, part, file), { status: 400 });
  await assert.rejects(service.part(1, u.id, 2, file), { status: 400 });
  await service.part(1, u.id, 1, file); await service.part(1, u.id, 1, file);
  await assert.rejects(service.complete(1, u.id), { status: 409 });
  await writeFile(path, Buffer.alloc(17, 8)); await service.part(1, u.id, 2, { path, size: 17 });
  await service.complete(1, u.id);
  await assert.rejects(service.part(1, u.id, 2, { path, size: 17 }), { status: 409 });
  await service.abort(1, u.id); assert.equal(objects.has((await row(u.id)).object_key), true);
});
test('completion verifies storage metadata and rechecks private-work permissions', async () => {
  const u = await service.start(1, 'delivery', input(100)); await seedParts(u.id);
  denyScope = 'delivery'; await assert.rejects(service.complete(1, u.id), { status: 403 }); denyScope = '';
  const o = objects.get((await row(u.id)).object_key)!;
  o.parts.set(1, { Size: 99, ETag: 'wrong' }); await assert.rejects(service.complete(1, u.id), { status: 409 });
  o.size = 99; await assert.rejects(service.complete(1, u.id), { status: 409 });
  o.size = 100; o.mime = 'image/jpeg'; await assert.rejects(service.complete(1, u.id), { status: 409 });
  o.mime = 'video/mp4'; await service.complete(1, u.id);
});
test('lost completion response recovers via HEAD without duplicate publication', async () => {
  const u = await service.start(1, 'custom', input(100)); await seedParts(u.id);
  const calls = completeCalls; loseCompleteResponse = true;
  await assert.rejects(service.complete(1, u.id), /Connection lost/);
  assert.equal((await row(u.id)).status, 'media_uploading');
  const first = await service.complete(1, u.id), second = await service.complete(1, u.id);
  assert.deepEqual(first, second); assert.equal(typeof first.id, 'string');
  assert.equal(completeCalls, calls + 1); assert.equal(published, 1);
});
test('cancellation, expiry and account deletion clean up unfinished multipart data', async () => {
  const cancelled = await service.start(1, 'feed', input(100));
  const cancelledKey = (await row(cancelled.id)).object_key;
  await service.abort(1, cancelled.id); await service.abort(1, cancelled.id); assert.equal(objects.has(cancelledKey), false);
  const expired = await service.start(1, 'delivery', input(100));
  await db.query("UPDATE upload_objects SET upload_intent_expires_at='2020-01-01' WHERE id=$1", [expired.id]);
  await assert.rejects(service.complete(1, expired.id), { status: 409 }); await service.cleanup();
  assert.equal((await row(expired.id)).status, 'media_aborted');
  const deleted = await service.start(1, 'portfolio', input(100)); await seedParts(deleted.id);
  await db.exec("UPDATE users SET account_status='anonymised' WHERE id=1");
  await assert.rejects(service.complete(1, deleted.id), { status: 403 });
  await db.query("UPDATE upload_objects SET status='delete_pending' WHERE id=$1", [deleted.id]); await service.cleanup();
  assert.equal((await row(deleted.id)).multipart_upload_id, null); assert.equal(objects.has((await row(deleted.id)).object_key), false);
  await db.exec("UPDATE users SET account_status='active' WHERE id=1");
});
