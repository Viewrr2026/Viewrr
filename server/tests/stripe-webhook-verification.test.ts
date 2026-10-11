import test from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { verifyStripeWebhook } from "../stripe-webhook-verification";

const stripe = new Stripe("sk_test_fixture");
const secrets = { platform: "whsec_platform_fixture", connect: "whsec_connect_fixture" };
function fixture(type: string, secret: string, account?: string, timestamp?: number) {
  const payload = JSON.stringify({ id: "evt_fixture", object: "event", type, account, data: { object: {} } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
  return { payload: Buffer.from(payload), signature };
}
test("existing platform signatures still verify with or without Connect configured", () => {
  const f = fixture("payment_intent.succeeded", secrets.platform);
  for (const config of [secrets, { platform: secrets.platform }]) {
    assert.equal(verifyStripeWebhook(stripe, f.payload, f.signature, config).type, "payment_intent.succeeded");
  }
});
test("separate Connect signatures verify all configured account and payout events", () => {
  for (const type of ["account.updated", "balance.available", "payout.created", "payout.updated", "payout.paid", "payout.failed"]) {
    const f = fixture(type, secrets.connect, "acct_fixture");
    assert.equal(verifyStripeWebhook(stripe, f.payload, f.signature, secrets).account, "acct_fixture");
  }
});
test("reject unknown secrets, tampered payloads, stale signatures and missing configuration", () => {
  const f = fixture("payout.paid", secrets.connect, "acct_fixture");
  const unknown = fixture("payout.paid", "whsec_unknown", "acct_fixture");
  const stale = fixture("payout.paid", secrets.connect, "acct_fixture", 1);
  for (const item of [unknown, stale, { ...f, payload: Buffer.from(f.payload.toString().replace("acct_fixture", "acct_other")) }]) {
    assert.throws(() => verifyStripeWebhook(stripe, item.payload, item.signature, secrets));
  }
  assert.throws(() => verifyStripeWebhook(stripe, f.payload, f.signature, {}));
});
test("Connect secret cannot authorize platform payments or events without account context", () => {
  for (const f of [fixture("payment_intent.succeeded", secrets.connect, "acct_fixture"), fixture("payout.paid", secrets.connect)]) {
    assert.throws(() => verifyStripeWebhook(stripe, f.payload, f.signature, secrets));
  }
});
