import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

// Run the actual switch cases with database/storage adapters, without Stripe network calls.
const source = readFileSync(new URL('../payment-service.ts', import.meta.url), 'utf8');
const cases = source.slice(source.indexOf('    case "payout.created":'), source.indexOf('    case "charge.dispute.created":'));
const js = transformSync(`async function handle(event, sqlClient, storage, getStripe = () => ({payouts:{retrieve:async()=>event.data.object},balance:{retrieve:async()=>event.data.object}})) { switch(event.type) { ${cases} } }`, { loader: 'ts', target: 'es2022' }).code;
const handle = new Function(`${js}; return handle;`)();
function setup(failFirst = false) {
  const payouts = new Map();
  const notifications: any[] = [];
  const sqlClient = { query: async (sql: string, params: any[]) => {
    if (sql.startsWith('SELECT id FROM users')) return params[0] === 'acct_known' ? [{ id: 61 }] : [];
    if (sql.includes('INSERT INTO payment_payouts')) { payouts.set(params[1], params); return []; }
    throw new Error('Unexpected query');
  } };
  const storage = { createNotification: async (data: any) => {
    assert.equal(data.recipientId, 61);
    assert.equal(data.actorId, 61, 'actor must satisfy the non-null user reference');
    assert.equal(data.actorName, 'Viewrr');
    if (failFirst) { failFirst = false; throw new Error('temporary storage failure'); }
    notifications.push(data);
  } };
  return { payouts, notifications, sqlClient, storage };
}
function event(type: string, status = 'paid') {
  return { type, account: 'acct_known', data: { object: { id: 'po_test', status, amount: 890, currency: 'gbp', arrival_date: 1790726400, available: [{ currency: 'gbp', amount: 890 }] } } };
}
test('paid, in-transit, failed and balance notifications have a valid actor', async () => {
  for (const [type, status] of [['payout.paid','paid'],['payout.updated','in_transit'],['payout.created','in_transit'],['payout.failed','failed'],['balance.available','']]) {
    const s = setup(); await handle(event(type,status), s.sqlClient,s.storage);
    assert.equal(s.notifications.length,1);
  }
});
test('failed notification can retry without duplicating payout ledger row', async () => {
  const s=setup(true); const e=event('payout.paid');
  await assert.rejects(handle(e,s.sqlClient,s.storage), /temporary storage failure/);
  await handle(e,s.sqlClient,s.storage);
  assert.equal(s.payouts.size,1); assert.equal(s.notifications.length,1);
});
test('unknown connected accounts and zero available balance do not notify', async () => {
  const s=setup(); const unknown=event('payout.paid'); unknown.account='acct_unknown';
  await handle(unknown,s.sqlClient,s.storage);
  const zero=event('balance.available'); zero.data.object.available[0].amount=0;
  await handle(zero,s.sqlClient,s.storage);
  assert.equal(s.notifications.length,0); assert.equal(s.payouts.size,0);
});

test('an older payout event uses current Stripe status; an old available event cannot announce spent funds', async () => {
  const s=setup();
  const stripe = () => ({payouts:{retrieve:async()=>({...event('payout.failed','failed').data.object,failure_code:'account_closed'})},balance:{retrieve:async()=>({available:[{currency:'gbp',amount:0}]})}});
  await handle(event('payout.paid','paid'),s.sqlClient,s.storage,stripe);
  assert.equal(s.payouts.get('po_test')[4],'failed');
  assert.match(s.notifications[0].message,/failed/);
  await handle(event('balance.available'),s.sqlClient,s.storage,stripe);
  assert.equal(s.notifications.length,1);
});
