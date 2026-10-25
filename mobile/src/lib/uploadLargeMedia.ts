import { File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { request } from '@/api/client';
import { ApiError } from '@/api/errors';

// Mobile is a standalone EAS package; shared/ is excluded from its archive.
export const MEDIA_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const mediaUploadLimitLabel = (scope: string) => scope === 'profile' ? '5 MB' : '5 GB';
export const mediaUploadLimit = (scope: string) => scope === 'profile' ? 5 * 1024 * 1024 : MEDIA_UPLOAD_MAX_BYTES;
const mimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']);
async function retry<T>(fn: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new Error('Upload cancelled.');
    try { return await fn(); }
    catch (e) {
      if (signal.aborted) throw new Error('Upload cancelled.');
      if (attempt >= 2 || !(e instanceof ApiError) || !['network', 'timeout', 'server', 'rate_limited', 'parse'].includes(e.kind)) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}
export async function uploadLargeMedia(file: { uri: string; name: string; mimeType?: string }, scope: string, context: { projectId?: number; retainerId?: string; taskId?: string }, onProgress: (percent: number) => void, signal: AbortSignal) {
  const source = new File(file.uri), size = source.size;
  if (!size || size > mediaUploadLimit(scope)) throw new Error(`Maximum file size is ${mediaUploadLimitLabel(scope)}.`);
  if (!file.mimeType || !mimes.has(file.mimeType) || (scope === 'profile' && !file.mimeType.startsWith('image/'))) throw new Error('Choose a JPEG, PNG, WebP, MP4, MOV or WebM file.');
  const upload = await request<{id: number; partSize: number}>(`/api/media/uploads/${scope}`, { method: 'POST', body: { ...context, size, mime: file.mimeType, filename: file.name }, signal });
  let handle: FileHandle | undefined;
  const chunk = new File(Paths.cache, `viewrr-upload-${upload.id}-${Date.now()}.part`);
  try {
    if (!Number.isSafeInteger(upload.partSize) || upload.partSize <= 0 || upload.partSize > 8 * 1024 * 1024) throw new Error('Invalid upload configuration.');
    handle = source.open(FileMode.ReadOnly);
    onProgress(0);
    for (let offset = 0, part = 1; offset < size; offset += upload.partSize, part++) {
      if (signal.aborted) throw new Error('Upload cancelled.');
      const length = Math.min(upload.partSize, size - offset);
      // Expo File.slice() reads the entire file. FileHandle keeps memory bounded.
      const bytes = handle.readBytes(length);
      if (bytes.length !== length) throw new Error('Unable to read the complete file. Please choose it again.');
      chunk.create({ overwrite: true }); chunk.write(bytes);
      await retry(() => {
        const body = new FormData(); body.append('file', { uri: chunk.uri, name: 'chunk', type: 'application/octet-stream' } as any);
        return request(`/api/media/uploads/${upload.id}/parts/${part}`, { method: 'PUT', body, signal, timeoutMs: 180_000 });
      }, signal);
      onProgress(Math.floor((offset + length) / size * 100));
    }
    return await retry(() => request<{id: number | string}>(`/api/media/uploads/${upload.id}/complete`, { method: 'POST', signal, timeoutMs: 180_000 }), signal);
  } catch (e) {
    await request(`/api/media/uploads/${upload.id}`, { method: 'DELETE', timeoutMs: 10_000 }).catch(() => {});
    throw e;
  } finally { handle?.close(); if (chunk.exists) chunk.delete(); }
}
