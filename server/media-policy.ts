export const PUBLIC_MEDIA_SCOPES = new Set(['feed', 'portfolio', 'profile']);
export const MEDIA_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']);
export function canReadMedia(scope: string, owner: boolean, party: boolean, preview: boolean, paid: boolean) {
  return PUBLIC_MEDIA_SCOPES.has(scope) || (["delivery", "cycle"].includes(scope) && party && (owner || preview || paid));
}
export function mediaPath(row: any, preview = false) {
  const token = row.object_key.split('/').pop();
  const ext = row.mime_type.startsWith('video/') ? 'mp4' : 'jpg';
  return `/api/media/${row.id}/${token}/${preview ? 'preview' : 'original'}.${ext}`;
}
