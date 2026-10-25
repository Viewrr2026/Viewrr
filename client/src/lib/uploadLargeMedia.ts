import { MEDIA_UPLOAD_MIMES, mediaUploadLimit, mediaUploadLimitLabel, type MediaUploadScope } from '@shared/media-upload';

async function send(path: string, init: RequestInit, signal?: AbortSignal, retries = 0): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(cancel, init.method === 'DELETE' ? 10_000 : 180_000);
    try {
      const response = await fetch(path, { ...init, credentials: 'include', signal: controller.signal });
      if (response.status === 204) return;
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(result.error || 'Upload failed. Please retry.'), { status: response.status });
      return result;
    } catch (e: any) {
      if (signal?.aborted) throw new Error('Upload cancelled.');
      if (attempt >= retries || (e.status && e.status < 500 && ![408, 429].includes(e.status))) throw e;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
  }
}
export async function uploadLargeMedia(file: File, scope: MediaUploadScope, context: { projectId?: number; retainerId?: string; taskId?: string }, onProgress: (percent: number) => void, signal?: AbortSignal): Promise<{ id: number | string }> {
  if (!file.size || file.size > mediaUploadLimit(scope)) throw new Error(`Maximum file size is ${mediaUploadLimitLabel(scope)}.`);
  if (!MEDIA_UPLOAD_MIMES.has(file.type) || (scope === 'profile' && !file.type.startsWith('image/'))) throw new Error('Choose a JPEG, PNG, WebP, MP4, MOV or WebM file.');
  const upload = await send(`/api/media/uploads/${scope}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...context, filename: file.name, mime: file.type, size: file.size }) }, signal);
  try {
    if (!Number.isSafeInteger(upload.partSize) || upload.partSize <= 0 || upload.partSize > 8 * 1024 * 1024) throw new Error('Invalid upload configuration.');
    onProgress(0);
    for (let offset = 0, part = 1; offset < file.size; offset += upload.partSize, part++) {
      const end = Math.min(file.size, offset + upload.partSize);
      const body = new FormData(); body.append('file', file.slice(offset, end), 'chunk');
      await send(`/api/media/uploads/${upload.id}/parts/${part}`, { method: 'PUT', body }, signal, 2);
      onProgress(Math.floor(end / file.size * 100));
    }
    return await send(`/api/media/uploads/${upload.id}/complete`, { method: 'POST' }, signal, 2);
  } catch (e) {
    // Aborting is idempotent and cannot remove an already completed upload.
    await send(`/api/media/uploads/${upload.id}`, { method: 'DELETE' }).catch(() => {});
    throw e;
  }
}
