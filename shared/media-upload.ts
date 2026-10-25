export const MEDIA_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const PROFILE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const MEDIA_PART_BYTES = 8 * 1024 * 1024;
export const MEDIA_UPLOAD_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']);
export type MediaUploadScope = 'feed' | 'portfolio' | 'profile' | 'delivery' | 'cycle' | 'custom';
export function mediaUploadLimit(scope: string) { return scope === 'profile' ? PROFILE_UPLOAD_MAX_BYTES : MEDIA_UPLOAD_MAX_BYTES; }
export function mediaUploadLimitLabel(scope: string) { return scope === 'profile' ? '5 MB' : '5 GB'; }
export function partByteLength(size: number, part: number) {
  if (!Number.isSafeInteger(part) || part < 1 || part > Math.ceil(size / MEDIA_PART_BYTES)) return 0;
  return Math.min(MEDIA_PART_BYTES, size - (part - 1) * MEDIA_PART_BYTES);
}
