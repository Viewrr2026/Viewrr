import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerAccountEmailVerification } from '../account-email-verification';

async function fixture(run: (f: any) => Promise<void>) {
  const accounts = new Map([
    [1, { id: 1, email: 'client@example.test', emailVerified: false }],
    [2, { id: 2, email: 'freelancer@example.test', emailVerified: false }],
  ]);
  const state = { sent: [] as string[], consumed: [] as string[], writes: 0, sendOk: true, failConsume: false, changedEmail: false };
  const app = express(); app.use(express.json());
  registerAccountEmailVerification(app, {
    requireAuth: (req, res, next) => {
      const id = Number(req.headers['x-test-user']);
      if (!id) { res.status(401).end(); return; }
      req.auth = { userId: id }; next();
    },
    resendLimiter: (_req, _res, next) => next(),
    verifyLimiter: (_req, _res, next) => next(),
    getUser: async id => accounts.get(id),
    sendEmail: async email => { state.sent.push(email); return { ok: state.sendOk }; },
    consumeCode: async (email, purpose, code) => {
      assert.equal(purpose, 'email_verification');
      if (state.failConsume) throw new Error('database unavailable');
      if (code !== '123456' || state.consumed.includes(email)) return { ok: false, error: 'Invalid or expired code' };
      state.consumed.push(email); return { ok: true };
    },
    markVerified: async (id, email, at) => {
      const account = accounts.get(id)!;
      assert.equal(email, account.email); assert.ok(at instanceof Date);
      if (state.changedEmail) return false;
      state.writes++; account.emailVerified = true; return true;
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const post = async (path: string, body = {}, id: number | null = 1) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(id ? { 'x-test-user': String(id) } : {}) }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try { await run({ post, state, accounts }); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('web verification sends to and verifies only the signed-in account, ignoring spoofed identities', async () => {
  await fixture(async ({ post, state, accounts }) => {
    const spoof = { userId: 2, email: 'freelancer@example.test', emailVerified: true };
    assert.equal((await post('/api/auth/resend-verification', spoof)).status, 200);
    assert.deepEqual(state.sent, ['client@example.test']);
    assert.equal((await post('/api/auth/verify-email', { ...spoof, code: ' 123456 ' })).data.verified, true);
    assert.equal(accounts.get(1).emailVerified, true); assert.equal(accounts.get(2).emailVerified, false);
    assert.deepEqual(state.consumed, ['client@example.test']);
  });
});
test('mobile endpoints stay compatible and verification is idempotent across both aliases', async () => {
  await fixture(async ({ post, state }) => {
    assert.equal((await post('/api/auth/mobile/resend-verification', {}, 2)).status, 200);
    assert.equal((await post('/api/auth/mobile/verify-email', { code: '123456' }, 2)).data.emailVerified, true);
    assert.equal((await post('/api/auth/verify-email', {}, 2)).data.alreadyVerified, true);
    assert.equal((await post('/api/auth/resend-verification', {}, 2)).data.alreadyVerified, true);
    assert.equal(state.writes, 1); assert.equal(state.sent.length, 1);
  });
});
test('signed-out users cannot send codes or verify either client endpoint', async () => {
  await fixture(async ({ post, state }) => {
    for (const prefix of ['/api/auth', '/api/auth/mobile']) {
      assert.equal((await post(`${prefix}/resend-verification`, {}, null)).status, 401);
      assert.equal((await post(`${prefix}/verify-email`, { code: '123456' }, null)).status, 401);
    }
    assert.equal(state.sent.length, 0); assert.equal(state.writes, 0);
  });
});
test('wrong or malformed codes cannot mark an account verified; a valid retry succeeds', async () => {
  await fixture(async ({ post, state }) => {
    for (const code of [undefined, true, 123456, '', '123', 'abcdef', '654321']) {
      assert.equal((await post('/api/auth/verify-email', { code, emailVerified: true })).status, 400);
      assert.equal(state.writes, 0);
    }
    assert.equal((await post('/api/auth/verify-email', { code: '123456' })).status, 200);
  });
});
test('email changes and infrastructure failures never report a verified account', async () => {
  await fixture(async ({ post, state, accounts }) => {
    state.sendOk = false;
    assert.equal((await post('/api/auth/resend-verification')).status, 503);
    state.failConsume = true;
    assert.equal((await post('/api/auth/verify-email', { code: '123456' })).status, 500);
    state.failConsume = false; state.changedEmail = true;
    assert.equal((await post('/api/auth/verify-email', { code: '123456' })).status, 409);
    assert.equal(state.writes, 0); assert.equal(accounts.get(1).emailVerified, false);
    assert.equal((await post('/api/auth/verify-email', { code: '123456' })).status, 400);
  });
});
