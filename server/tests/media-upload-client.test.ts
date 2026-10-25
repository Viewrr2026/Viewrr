import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadLargeMedia } from '../../client/src/lib/uploadLargeMedia';
import { MEDIA_PART_BYTES, MEDIA_UPLOAD_MAX_BYTES } from '../../shared/media-upload';
test('browser sends bounded chunks, retries only a failed part, and reports completion', async () => {
  const originalFetch = globalThis.fetch;
  const file = new File([new Uint8Array(MEDIA_PART_BYTES * 2 + 23).fill(9)], 'film.mov', { type: 'video/quicktime' });
  const attempts = new Map<number, number>(), parts = new Map<number, Uint8Array>(), progress: number[] = [];
  globalThis.fetch = async (path, init) => {
    assert.equal(init?.credentials, 'include'); assert.ok(String(path).startsWith('/api/media/uploads/'));
    if (String(path) === '/api/media/uploads/portfolio') {
      const input = JSON.parse(String(init?.body)); assert.equal(input.size, file.size); assert.equal(input.mime, file.type);
      return Response.json({ id: 42, partSize: MEDIA_PART_BYTES }, { status: 201 });
    }
    const part = Number(String(path).split('/parts/')[1]);
    if (part) {
      const count = (attempts.get(part) ?? 0) + 1; attempts.set(part, count);
      if (part === 2 && count === 1) return Response.json({ error: 'Temporary storage error' }, { status: 503 });
      const chunk = (init?.body as FormData).get('file') as Blob; assert.ok(chunk.size <= MEDIA_PART_BYTES);
      parts.set(part, new Uint8Array(await chunk.arrayBuffer())); return Response.json({ ok: true });
    }
    assert.equal(String(path), '/api/media/uploads/42/complete'); return Response.json({ id: 42, status: 'media_queued' }, { status: 202 });
  };
  try {
    assert.deepEqual(await uploadLargeMedia(file, 'portfolio', {}, p => progress.push(p)), { id: 42, status: 'media_queued' });
    assert.deepEqual([...attempts], [[1, 1], [2, 2], [3, 1]]);
    assert.deepEqual([...parts.values()].map(p => p.length), [MEDIA_PART_BYTES, MEDIA_PART_BYTES, 23]);
    for (const part of parts.values()) assert.ok(part.every(byte => byte === 9));
    assert.equal(progress[0], 0); assert.equal(progress.at(-1), 100);
  } finally { globalThis.fetch = originalFetch; }
});
test('oversize files are rejected without making a network request', async () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
  try { await assert.rejects(uploadLargeMedia({ size: MEDIA_UPLOAD_MAX_BYTES + 1, type: 'video/mp4' } as File, 'feed', {}, () => {}), /Maximum file size is 5 GB/); }
  finally { globalThis.fetch = originalFetch; }
});
test('permission failures are not retried and cancel the unfinished upload', async () => {
  const originalFetch = globalThis.fetch; let writes = 0, aborted = false;
  globalThis.fetch = async (path, init) => {
    if (init?.method === 'DELETE') { aborted = true; return new Response(null, { status: 204 }); }
    if (String(path).includes('/parts/')) { writes++; return Response.json({ error: 'Upload no longer available' }, { status: 403 }); }
    return Response.json({ id: 42, partSize: MEDIA_PART_BYTES }, { status: 201 });
  };
  try {
    await assert.rejects(uploadLargeMedia(new File(['video'], 'film.mp4', { type: 'video/mp4' }), 'delivery', { projectId: 1 }, () => {}), /Upload no longer available/);
    assert.equal(writes, 1); assert.equal(aborted, true);
  } finally { globalThis.fetch = originalFetch; }
});
