import type { RetainerDb } from './retainer-v1-db';

// Shared contractual deliveries and historical 'deleted' records are excluded.
export const PERSONAL_UPLOAD_TYPES = ['media_feed', 'media_profile', 'media_portfolio', 'profile', 'portfolio', 'message'];

/** Compare-and-set prevents a preview/upload finishing after account deletion
 * from publishing the file again. A late writer schedules another purge. */
export async function finishMediaWrite(db: RetainerDb, id: number, from: string, to: string): Promise<boolean> {
  const result = await db.query(`UPDATE upload_objects SET status=$3 WHERE id=$1 AND status=$2
    AND EXISTS (SELECT 1 FROM users WHERE users.id=owner_user_id AND account_status='active') RETURNING id`, [id,from,to]);
  if (result.rows.length) return true;
  await db.query(`UPDATE upload_objects SET status='delete_pending', confirmed_at=$2
    WHERE id=$1 AND resource_type=ANY($3::text[])
      AND (status IN ('delete_pending','delete_processing','purged') OR
        EXISTS (SELECT 1 FROM users WHERE users.id=owner_user_id AND account_status='anonymised'))`,
    [id,new Date().toISOString(),PERSONAL_UPLOAD_TYPES]);
  return false;
}

/** One retryable pair of deletes. Leases recover after a worker crash. Recheck
 * tombstones daily to remove bytes from a late, interrupted writer as well. */
export async function purgeNextPersonalUpload(db: RetainerDb, remove: (key: string) => Promise<void>): Promise<boolean> {
  const now = new Date().toISOString();
  const row = (await db.query(`UPDATE upload_objects SET status='delete_processing', confirmed_at=$1
    WHERE id=(SELECT id FROM upload_objects WHERE resource_type=ANY($2::text[])
      AND upload_intent_expires_at::timestamptz < NOW()
      AND (
        (status IN ('delete_pending','delete_processing') AND COALESCE(confirmed_at,created_at)::timestamptz < NOW()-INTERVAL '20 minutes')
        OR (status='purged' AND confirmed_at::timestamptz < NOW()-INTERVAL '1 day')
        OR (status='media_uploading' AND created_at::timestamptz < NOW()-INTERVAL '1 day')
      ) ORDER BY CASE WHEN status='purged' THEN 1 ELSE 0 END, id
      FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [now,PERSONAL_UPLOAD_TYPES])).rows[0];
  if (!row) return false;
  // DeleteObject is idempotent, including if only one of the pair succeeded.
  // On failure leave the lease intact; a later worker retries both keys.
  await remove(row.object_key);
  if (row.resource_type.startsWith('media_')) await remove(`${row.object_key}.preview`);
  await db.query(`UPDATE upload_objects SET status='purged', original_filename=NULL
    WHERE id=$1 AND status='delete_processing' AND confirmed_at=$2`, [row.id,now]);
  return true;
}
