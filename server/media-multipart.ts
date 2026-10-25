import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { RetainerDb } from './retainer-v1-db';
import { MEDIA_PART_BYTES, MEDIA_UPLOAD_MIMES, mediaUploadLimit, mediaUploadLimitLabel, partByteLength } from '../shared/media-upload';
import type { multipartObjectStorage } from './object-storage';

const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const scopes = new Set(['feed', 'portfolio', 'profile', 'delivery', 'cycle', 'custom']);
type Dependencies = {
  transaction: <T>(fn: (db: RetainerDb) => Promise<T>) => Promise<T>;
  storage: typeof multipartObjectStorage;
  authorize: (db: RetainerDb, scope: string, context: any, userId: number) => Promise<number | null>;
  publishCustom: (db: RetainerDb, row: any) => Promise<void>;
};

export function createMultipartMediaService({ transaction, storage, authorize, publishCustom }: Dependencies) {
  async function owned(db: RetainerDb, id: number, userId: number) {
    if (!Number.isSafeInteger(id) || id < 1) fail(400, 'Invalid upload.');
    const row = (await db.query('SELECT * FROM upload_objects WHERE id=$1 AND owner_user_id=$2 AND upload_context IS NOT NULL FOR UPDATE', [id, userId])).rows[0];
    if (!row) fail(404, 'Upload not found.');
    return row;
  }
  async function writable(db: RetainerDb, row: any) {
    if (row.status !== 'media_uploading' || !row.multipart_upload_id || new Date(row.upload_intent_expires_at).getTime() <= Date.now()) fail(409, 'This upload has expired or is already complete. Please choose the file again.');
    if (!(await db.query("SELECT id FROM users WHERE id=$1 AND account_status='active'", [row.owner_user_id])).rows.length) fail(403, 'This account is no longer active.');
  }
  const result = (row: any) => ({ id: row.resource_type === 'media_custom' ? row.upload_context.mediaId : row.id, status: row.resource_type === 'media_custom' ? 'queued' : 'media_queued' });
  return {
    async start(userId: number, scope: string, input: any) {
      if (!scopes.has(scope)) fail(400, 'Invalid upload purpose.');
      const size = input?.size, mime = input?.mime;
      if (!Number.isSafeInteger(size) || size <= 0 || size > mediaUploadLimit(scope)) fail(413, `Maximum file size is ${mediaUploadLimitLabel(scope)}.`);
      if (!MEDIA_UPLOAD_MIMES.has(mime) || (scope === 'profile' && !mime.startsWith('image/'))) fail(400, 'Choose a JPEG, PNG, WebP, MP4, MOV or WebM file.');
      const filename = String(input?.filename ?? 'upload').replace(/[\x00-\x1f]/g, '').slice(0, 180);
      const context = { projectId: Number(input?.projectId), retainerId: String(input?.retainerId ?? ''), taskId: String(input?.taskId ?? ''), mediaId: randomUUID() };
      return transaction(async db => {
        // Serialize reservations per account, including across server instances.
        if (!(await db.query("SELECT id FROM users WHERE id=$1 AND account_status='active' FOR UPDATE", [userId])).rows.length) fail(403, 'This account is no longer active.');
        const resourceId = await authorize(db, scope, context, userId);
        const active = (await db.query("SELECT COUNT(*) AS count FROM upload_objects WHERE owner_user_id=$1 AND multipart_upload_id IS NOT NULL AND status='media_uploading' AND upload_intent_expires_at::timestamptz > NOW()", [userId])).rows[0];
        if (Number(active.count) >= 3) fail(429, 'Finish or cancel an existing upload before starting another.');
        const key = scope === 'custom' ? `retainer-private/${context.mediaId}/original` : `media/${randomUUID()}`;
        const uploadId = await storage.create(key, mime);
        try {
          const row = (await db.query(`INSERT INTO upload_objects(owner_user_id,object_key,resource_type,resource_id,mime_type,size_bytes,original_filename,status,upload_intent_expires_at,created_at,multipart_upload_id,upload_context)
            VALUES($1,$2,$3,$4,$5,$6,$7,'media_uploading',$8,$9,$10,$11) RETURNING id`,
          [userId, key, `media_${scope}`, resourceId, mime, size, filename, new Date(Date.now() + 24 * 60 * 60_000).toISOString(), new Date().toISOString(), uploadId, JSON.stringify(context)])).rows[0];
          return { id: row.id, partSize: MEDIA_PART_BYTES };
        } catch (e) { await storage.abort(key, uploadId).catch(() => {}); throw e; }
      });
    },
    async part(userId: number, id: number, part: number, file: { path: string; size: number }) {
      // This lock covers the storage write: completion/abort cannot race a late part.
      return transaction(async db => {
        const row = await owned(db, id, userId);
        await writable(db, row);
        const expected = partByteLength(Number(row.size_bytes), part);
        if (!expected || file.size !== expected) fail(400, 'The upload chunk has an unexpected size. Please retry.');
        await storage.part(row.object_key, row.multipart_upload_id, part, createReadStream(file.path), file.size);
        return { ok: true };
      });
    },
    async complete(userId: number, id: number) {
      return transaction(async db => {
        const row = await owned(db, id, userId);
        if (['media_queued', 'media_processing', 'media_failed', 'ready', 'media_attached'].includes(row.status)) return result(row);
        await writable(db, row);
        await authorize(db, row.resource_type.slice(6), row.upload_context, userId);
        let object = await storage.head(row.object_key);
        if (!object.exists) {
          const parts = (await storage.list(row.object_key, row.multipart_upload_id)).sort((a, b) => a.PartNumber - b.PartNumber);
          if (parts.length !== Math.ceil(Number(row.size_bytes) / MEDIA_PART_BYTES) || parts.some((p, i) => p.PartNumber !== i + 1 || p.Size !== partByteLength(Number(row.size_bytes), p.PartNumber) || !p.ETag)) fail(409, 'Some upload chunks are missing. Please retry the upload.');
          await storage.complete(row.object_key, row.multipart_upload_id, parts);
          object = await storage.head(row.object_key);
        }
        // Recover a completed R2 write whose response or DB commit was lost.
        if (!object.exists || object.size !== Number(row.size_bytes) || object.contentType !== row.mime_type) fail(409, 'Stored file does not match the upload. Please choose the file again.');
        if (row.resource_type === 'media_custom') await publishCustom(db, row);
        const updated = await db.query(`UPDATE upload_objects SET status=$2,multipart_upload_id=NULL,confirmed_at=$3 WHERE id=$1
          AND EXISTS (SELECT 1 FROM users WHERE users.id=owner_user_id AND account_status='active') RETURNING id`,
        [row.id, row.resource_type === 'media_custom' ? 'media_attached' : 'media_queued', new Date().toISOString()]);
        if (!updated.rows.length) fail(403, 'This account is no longer active.');
        return result(row);
      });
    },
    async abort(userId: number, id: number) {
      return transaction(async db => {
        const row = await owned(db, id, userId);
        if (!row.multipart_upload_id || row.status !== 'media_uploading') return;
        await storage.abort(row.object_key, row.multipart_upload_id);
        await storage.remove(row.object_key);
        await db.query("UPDATE upload_objects SET status='media_aborted',multipart_upload_id=NULL,original_filename=NULL WHERE id=$1", [id]);
      });
    },
    async cleanup() {
      return transaction(async db => {
        const row = (await db.query(`SELECT * FROM upload_objects WHERE multipart_upload_id IS NOT NULL
          AND (upload_intent_expires_at::timestamptz < NOW() OR status IN ('delete_pending','delete_processing','purged'))
          ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`)).rows[0];
        if (!row) return;
        await storage.abort(row.object_key, row.multipart_upload_id);
        await storage.remove(row.object_key);
        await db.query("UPDATE upload_objects SET multipart_upload_id=NULL,original_filename=NULL,status=CASE WHEN status='media_uploading' THEN 'media_aborted' ELSE status END WHERE id=$1", [row.id]);
      });
    },
  };
}
