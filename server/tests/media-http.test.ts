import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import { chunkUpload } from '../media-chunk-upload';
import { securityHeaders } from '../security-headers';
import { MEDIA_PART_BYTES } from '../../shared/media-upload';
import { uploadLargeMedia } from '../../client/src/lib/uploadLargeMedia';
import { parseVideoUrl } from '../../client/src/lib/videoEmbed';

test('real browser multipart requests accept full 8 MiB parts and reject the first excess byte', async () => {
  const app = express(); app.use(express.json());
  const parts: number[] = [];
  app.post('/api/media/uploads/feed', (_req, res) => res.json({ id: 1, partSize: MEDIA_PART_BYTES }));
  app.put('/api/media/uploads/1/parts/:part', (req, res) => {
    chunkUpload.single('file')(req, res, async error => {
      if (error) { res.status(413).json({ error: 'Upload chunk exceeds 8 MB.' }); return; }
      const file = req.file!;
      try {
        const bytes = await readFile(file.path); assert.ok(bytes.every(byte => byte === 7));
        parts.push(bytes.length); res.json({ ok: true });
      } finally { await rm(file.path, { force: true }); }
    });
  });
  app.post('/api/media/uploads/1/complete', (_req, res) => res.json({ id: 1, status: 'media_queued' }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => realFetch(new URL(String(input), base), init);
  try {
    const result = await uploadLargeMedia(new File([new Uint8Array(MEDIA_PART_BYTES * 2 + 17).fill(7)], 'film.mp4', { type: 'video/mp4' }), 'feed', {}, () => {});
    assert.equal(result.id, 1); assert.deepEqual(parts, [MEDIA_PART_BYTES, MEDIA_PART_BYTES, 17]);
    const body = new FormData(); body.append('file', new Blob([new Uint8Array(MEDIA_PART_BYTES + 1)]), 'chunk');
    assert.equal((await realFetch(`${base}/api/media/uploads/1/parts/1`, { method: 'PUT', body })).status, 413);
  } finally { globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('HTML responses allow supported players and supply their origin referrer while keeping object blocking', async () => {
  const app = express(); app.use(securityHeaders); app.get('/', (_req, res) => res.send('<html></html>'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}`);
    const csp = response.headers.get('content-security-policy')!;
    const frames = csp.split(';').find(value => value.startsWith('frame-src '))!;
    for (const host of ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://js.stripe.com']) assert.ok(frames.split(' ').includes(host));
    assert.ok(!frames.includes('*')); assert.ok(csp.includes("object-src 'none'"));
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('hosted media accepts supported links, preserves Vimeo hashes and rejects lookalike providers', () => {
  for (const url of ['https://vimeo.com/123456789/privatehash', 'https://player.vimeo.com/video/123456789?h=privatehash']) {
    const embed = new URL(parseVideoUrl(url)!.embedUrl);
    assert.equal(embed.hostname, 'player.vimeo.com'); assert.equal(embed.searchParams.get('h'), 'privatehash');
  }
  for (const url of ['https://youtu.be/abcdefghijk', 'https://m.youtube.com/watch?v=abcdefghijk', 'https://www.youtube.com/shorts/abcdefghijk', 'https://www.youtube.com/live/abcdefghijk']) assert.equal(parseVideoUrl(url)?.id, 'abcdefghijk');
  for (const url of ['https://vimeo.com.evil.test/123456789', 'https://evil.test/vimeo.com/123456789', 'javascript:alert(1)', 'https://user@vimeo.com/123456789']) assert.equal(parseVideoUrl(url), null);
});
