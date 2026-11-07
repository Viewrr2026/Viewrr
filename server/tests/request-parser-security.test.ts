import { test } from "node:test";
import { execFileSync } from "node:child_process";

// Keep malformed requests in a child process with a deadline, so a dependency
// regression fails this test instead of crashing or hanging the whole runner.
function isolated(source: string) {
  execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    cwd: process.cwd(), timeout: 10000, stdio: "pipe",
  });
}

test("compressed request errors stay contained and JSON raw bytes remain intact", () => {
  isolated(`
    import assert from 'node:assert/strict';
    import express from 'express';
    import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
    import { once } from 'node:events';
    const app = express();
    app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
    app.use(express.urlencoded({ extended: false, limit: '10mb' }));
    app.post('/', (req, res) => res.json({ body: req.body, raw: req.rawBody?.toString() }));
    app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: true }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port;
    try {
      for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]]) {
        const raw = '{"event": "payment_intent.succeeded", "label":"Café"}';
        const response = await fetch(url, { method: 'POST', headers: {
          'content-type': 'application/json', 'content-encoding': encoding,
        }, body: compress(Buffer.from(raw)) });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { body: JSON.parse(raw), raw });
        for (const [type, value] of [['application/json', raw], ['application/x-www-form-urlencoded', 'name=Matt+Burroughs']]) {
          const malformed = Buffer.concat([compress(Buffer.from(value)), Buffer.from('invalid trailing data')]);
          const result = await fetch(url, { method: 'POST', headers: {
            'content-type': type, 'content-encoding': encoding,
          }, body: malformed });
          assert.ok([200, 400].includes(result.status));
          await result.arrayBuffer();
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      const healthy = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ok":true}' });
      assert.equal(healthy.status, 200);
      assert.deepEqual((await healthy.json()).body, { ok: true });
      const form = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Matt+Burroughs' });
      assert.equal((await form.json()).body.name, 'Matt Burroughs');
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  `);
});

test("multipart parser handles crafted field names, file limits and interrupted uploads", () => {
  isolated(`
    import assert from 'node:assert/strict';
    import express from 'express';
    import multer from 'multer';
    import { once } from 'node:events';
    import { request } from 'node:http';
    const app = express();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024, files: 1 },
      fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'image/png') });
    let onAborted;
    app.use((req, _res, next) => { req.on('aborted', () => onAborted?.()); next(); });
    app.post('/', upload.single('file'), (req, res) => res.json({ size: req.file?.size ?? 0 }));
    app.use((err, _req, res, _next) => res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: true }));
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = 'http://127.0.0.1:' + server.address().port;
    try {
      const fields = new FormData(); fields.append('items[0]', 'first'); fields.append('items[length]', 'invalid');
      const crafted = await fetch(url, { method: 'POST', body: fields });
      assert.ok([200, 400].includes(crafted.status)); await crafted.arrayBuffer();
      for (const [size, mime, status, accepted] of [[20, 'image/png', 200, 20], [20, 'text/plain', 200, 0], [1025, 'image/png', 413, undefined]]) {
        const body = new FormData(); body.append('file', new Blob([new Uint8Array(size)], { type: mime }), 'file');
        const response = await fetch(url, { method: 'POST', body });
        assert.equal(response.status, status);
        const data = await response.json();
        if (accepted !== undefined) assert.equal(data.size, accepted);
      }
      const aborted = new Promise(resolve => { onAborted = resolve; });
      const req = request(url, { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=fixture' } });
      req.on('error', () => {});
      req.write('--fixture\\r\\nContent-Disposition: form-data; name="file"; filename="image.png"\\r\\nContent-Type: image/png\\r\\n\\r\\n');
      req.write(Buffer.alloc(100));
      await new Promise(resolve => setTimeout(resolve, 50)); req.destroy(); await aborted;
      const response = await fetch(url, { method: 'POST', body: new FormData() });
      assert.equal(response.status, 200); assert.equal((await response.json()).size, 0);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  `);
});
