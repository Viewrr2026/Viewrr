import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifySignupEmail } from '../signup-verification';

test('registration consumes email proof for the normalized account address', async () => {
  const result = await verifySignupEmail(' Owner@Example.com ', ' 123456 ', async (email, purpose, code) => {
    assert.equal(email, 'owner@example.com');
    assert.equal(purpose, 'email_verification');
    assert.equal(code, '123456');
    return { ok: true };
  });
  assert.equal(result.emailVerified, true);
  assert.ok(result.emailVerifiedAt instanceof Date);
});
test('missing codes and browser verification flags cannot grant verified status', async () => {
  for (const code of [undefined, null, true, { emailVerified: true }, '', '123', 'abcdef']) {
    await assert.rejects(verifySignupEmail('owner@example.com', code, async () => {
      assert.fail('invalid input must not reach code consumption');
    }), /six-digit/);
  }
});
test('expired, reused and incorrect codes fail closed', async () => {
  for (const error of ['Code expired', 'Code already used', 'Incorrect code']) {
    await assert.rejects(verifySignupEmail('owner@example.com', '123456', async () => ({ ok: false, error })), { message: error });
  }
});
test('verification infrastructure failure cannot produce a verified account', async () => {
  await assert.rejects(verifySignupEmail('owner@example.com', '123456', async () => { throw new Error('database unavailable'); }), /database unavailable/);
});
