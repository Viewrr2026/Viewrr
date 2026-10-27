import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { attachDeliveryPreview, deliveryPreviewRows, projectDeliverableDto, validateDeliveryUpload } from '../delivery-previews';
const pg = new PGlite();
const db = { query: async (sql: string, args?: any[]) => await pg.query(sql, args) as { rows: any[] } };
const original = '/api/media/1/1234-abcd/original.mp4';
const delivery = { id: 1, projectId: 10, createdBy: 2, label: 'Film', platform: 'Vimeo', url: 'https://vimeo.com/123456789/private', embedUrl: 'https://player.vimeo.com/video/123456789?h=private', createdAt: '2026-10-26' };
before(async () => {
  await pg.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY, freelancer_id INTEGER, is_retainer INTEGER, status TEXT);
    INSERT INTO projects VALUES(10,2,0,'awaiting_payment'),(11,3,0,'active');
    CREATE TABLE deliverables(id INTEGER PRIMARY KEY, project_id INTEGER, created_by INTEGER, url TEXT);
    INSERT INTO deliverables VALUES(1,10,2,'https://vimeo.com/123456789'),(2,11,3,'https://vimeo.com/234567890');
    CREATE TABLE upload_objects(id INTEGER PRIMARY KEY,object_key TEXT,owner_user_id INTEGER,resource_id INTEGER,resource_type TEXT,status TEXT,mime_type TEXT);
    INSERT INTO upload_objects VALUES(1,'media/1234-abcd',2,10,'media_delivery','ready','video/mp4'),
      (2,'media/2345-abcd',3,11,'media_delivery','ready','image/png'),
      (3,'media/3456-abcd',2,10,'media_delivery','media_queued','video/mp4'),
      (4,'media/4567-abcd',2,10,'media_feed','ready','video/mp4');`);
  const migration = await readFile(new URL('../../migrations/0019_delivery_previews.sql', import.meta.url), 'utf8');
  await pg.exec(migration); await pg.exec(migration);
});
after(async () => pg.close());

test('migration preserves deliveries; attaching a ready owned preview leaves the final link unchanged', async () => {
  assert.equal((await db.query('SELECT preview_media_id FROM deliverables WHERE id=1')).rows[0].preview_media_id, null);
  await attachDeliveryPreview(db, 10, 1, 2, original);
  assert.deepEqual((await db.query('SELECT preview_media_id,url FROM deliverables WHERE id=1')).rows[0], { preview_media_id: 1, url: 'https://vimeo.com/123456789' });
});

test('preview attachment rejects wrong owners, projects, file states, variants and MIME extensions', async () => {
  for (const [project, owner, path] of [
    [11, 2, original], [10, 3, original], [10, 2, original.replace('original', 'preview')],
    [10, 2, original.replace('.mp4', '.jpg')], [10, 2, '/api/media/3/3456-abcd/original.mp4'],
    [10, 2, '/api/media/4/4567-abcd/original.mp4'], [10, 2, 'https://elsewhere.test' + original],
  ] as const) await assert.rejects(validateDeliveryUpload(db, project, owner, path), { status: 403 });
  await assert.rejects(attachDeliveryPreview(db, 10, 2, 2, original), { status: 403 });
  await pg.query("UPDATE projects SET status='completed' WHERE id=10");
  await assert.rejects(attachDeliveryPreview(db, 10, 1, 2, original), { status: 403 });
  await pg.query("UPDATE projects SET status='awaiting_payment' WHERE id=10");
});

test('unpaid clients receive only the separately watermarked preview; paid clients get final links', async () => {
  const uploads = await deliveryPreviewRows(db, 10);
  const d = { ...delivery, previewMediaId: 1 };
  const locked = projectDeliverableDto(d, true, uploads);
  assert.equal(locked.previewUrl, original.replace('original', 'preview'));
  assert.equal('url' in locked, false); assert.equal('embedUrl' in locked, false);
  assert.equal(JSON.stringify(locked).includes('vimeo.com'), false);
  assert.equal(projectDeliverableDto(d, false, uploads).url, delivery.url);
});

test('legacy uploaded deliveries keep previews while unavailable or unrelated previews never fall back to originals', async () => {
  const uploads = await deliveryPreviewRows(db, 10);
  const legacy = { ...delivery, url: original, platform: 'Viewrr upload' };
  assert.equal(projectDeliverableDto(legacy, true, uploads).previewUrl, original.replace('original', 'preview'));
  for (const d of [{ ...legacy, previewMediaId: 999 }, { ...legacy, createdBy: 3 }, { ...legacy, projectId: 11 }]) {
    const result = projectDeliverableDto(d, true, uploads);
    assert.equal('previewUrl' in result, false); assert.equal('url' in result, false);
  }
  assert.equal('previewUrl' in projectDeliverableDto(delivery, true, uploads), false);
  assert.equal('previewUrl' in projectDeliverableDto(legacy, true, []), false);
});
