import { mediaPath } from './media-policy';

type QueryDb = { query: (sql: string, args?: any[]) => Promise<{ rows: any[] }> };
const invalid = (): never => { throw Object.assign(new Error('Choose a ready file uploaded for this project.'), { status: 403 }); };

export async function validateDeliveryUpload(db: QueryDb, projectId: number, userId: number, reference: unknown) {
  if (typeof reference !== 'string') return invalid();
  const match = reference.match(/^\/api\/media\/(\d+)\/([a-f0-9-]+)\/original\.(jpg|mp4)$/);
  if (!match) return invalid();
  const row = (await db.query(`SELECT * FROM upload_objects WHERE id=$1 AND object_key=$2 AND owner_user_id=$3
    AND resource_id=$4 AND resource_type='media_delivery' AND status='ready'`,
  [Number(match[1]), `media/${match[2]}`, userId, projectId])).rows[0];
  if (!row || mediaPath(row) !== reference) return invalid();
  return row;
}

export async function deliveryPreviewRows(db: QueryDb, projectId: number) {
  return (await db.query("SELECT * FROM upload_objects WHERE resource_id=$1 AND resource_type='media_delivery' AND status='ready'", [projectId])).rows;
}

export async function attachDeliveryPreview(db: QueryDb, projectId: number, deliveryId: number, userId: number, reference: unknown) {
  const upload = await validateDeliveryUpload(db, projectId, userId, reference);
  const row = (await db.query(`UPDATE deliverables SET preview_media_id=$1 WHERE id=$2 AND project_id=$3 AND created_by=$4
    AND EXISTS (SELECT 1 FROM projects WHERE projects.id=$3 AND freelancer_id=$4 AND is_retainer=0 AND status NOT IN ('completed','cancelled')) RETURNING id`,
  [upload.id, deliveryId, projectId, userId])).rows[0];
  if (!row) return invalid();
  return row;
}

/** Locked DTOs expose only a separately encoded review copy, never final URLs. */
export function projectDeliverableDto(d: any, locked: boolean, uploads: any[]) {
  const upload = uploads.find(row => row.resource_id === d.projectId && row.resource_type === 'media_delivery' && row.status === 'ready'
    && row.owner_user_id === d.createdBy && (d.previewMediaId != null ? row.id === d.previewMediaId : mediaPath(row) === d.url));
  return {
    id: d.id, label: d.label, platform: d.platform, locked, createdBy: d.createdBy, createdAt: d.createdAt,
    ...(upload ? { previewUrl: mediaPath(upload, true) } : {}),
    ...(locked ? { lockReason: 'awaiting_payment' as const } : { url: d.url, embedUrl: d.embedUrl }),
  };
}
