import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { setRetainerTestDatabase } from '../retainer-v1-db';
import { fulfilVerifiedProjectPayment, hasVerifiedProjectPayment, rejectClientPaymentConfirmation } from '../project-payment-verification';
process.env.NODE_ENV = 'test';
const db = new PGlite();
const details = { chargeId: 'ch_test', balanceTxId: null, stripeFeePence: 25, applicationFeeId: null };
const intent = { id: 'pi_test', status: 'succeeded', amount: 100, amount_received: 100, currency: 'gbp',
  metadata: { viewrr_payment_id: 'pay_test', project_id: '1', invoice_id: '1', client_id: '1', freelancer_id: '2' } } as any;
before(async () => {
  await db.exec(await readFile(new URL('./fixtures/retainer-base.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../../migrations/0003_prd007_payment_ledger.sql', import.meta.url), 'utf8'));
  await db.exec("ALTER TABLE projects ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'");
  setRetainerTestDatabase({ query: (q, v) => db.query(q,v) as any, transaction: fn => db.transaction(tx => fn({ query: (q,v) => tx.query(q,v) as any })) });
});
after(async () => { setRetainerTestDatabase(undefined); await db.close(); });
async function reset() {
  await db.exec(`TRUNCATE payments, invoices, projects, payment_refunds RESTART IDENTITY;
    INSERT INTO projects(id,client_id,freelancer_id,title,created_at) VALUES(1,1,2,'Test','now');
    INSERT INTO invoices(id,invoice_number,project_id,client_id,freelancer_id,total_pence,issued_at,created_at) VALUES(1,'TEST',1,1,2,100,'now','now');
    INSERT INTO payments(id,public_id,project_id,invoice_id,client_id,freelancer_id,gross_pence,platform_fee_pence,freelancer_pence,stripe_payment_intent_id) VALUES(1,'pay_test',1,1,1,2,100,11,89,'pi_test');`);
}
test('browser confirmation rejects fabricated payment without writing state', () => {
  let status = 0; let body: any;
  rejectClientPaymentConfirmation({ body: { paid: true } }, { status: (n: number) => { status=n; return { json: (x:any) => body=x }; } });
  assert.equal(status,409); assert.equal(body.code,'payment_verification_required');
});
test('paid flags alone cannot release originals; verified matching payment can', async () => {
  await reset();
  await db.exec("UPDATE projects SET payment_status='paid'; UPDATE invoices SET status='paid'");
  assert.equal(await hasVerifiedProjectPayment(1),false);
  assert.equal(await fulfilVerifiedProjectPayment(intent,details),true);
  assert.equal(await hasVerifiedProjectPayment(1),true);
  assert.equal(await hasVerifiedProjectPayment(2),false);
  assert.equal(await fulfilVerifiedProjectPayment(intent,details),false);
  assert.equal((await db.query<any>('SELECT version FROM payments')).rows[0].version,2);
});
test('rejects wrong status, amount, received amount, currency, intent and ownership', async () => {
  for (const patch of [{ status:'processing' }, { amount:1 }, { amount_received:1 }, { currency:'usd' }, { id:'pi_other' }, { metadata: { ...intent.metadata, client_id:'3' } }]) {
    await reset();
    await assert.rejects(fulfilVerifiedProjectPayment({ ...intent, ...patch },details));
    assert.equal(await hasVerifiedProjectPayment(1),false);
    assert.equal((await db.query<any>('SELECT status FROM payments')).rows[0].status,'pending');
  }
  await reset(); await db.exec('UPDATE invoices SET freelancer_id=3');
  await assert.rejects(fulfilVerifiedProjectPayment(intent,details));
});
test('failure rolls back payment, invoice and project; retry succeeds', async () => {
  await reset();
  await db.exec("ALTER TABLE projects ADD CONSTRAINT fail_paid CHECK(payment_status <> 'paid')");
  await assert.rejects(fulfilVerifiedProjectPayment(intent,details));
  assert.equal((await db.query<any>('SELECT status FROM payments')).rows[0].status,'pending');
  assert.equal((await db.query<any>('SELECT status FROM invoices')).rows[0].status,'sent');
  await db.exec('ALTER TABLE projects DROP CONSTRAINT fail_paid');
  assert.equal(await fulfilVerifiedProjectPayment(intent,details),true);
});
test('replay repairs historic partial fulfilment without a second credit; refunded payment stays locked', async () => {
  await reset();
  await db.exec("UPDATE payments SET status='succeeded', succeeded_at='2026-09-28'");
  assert.equal(await fulfilVerifiedProjectPayment(intent,details),false);
  assert.equal(await hasVerifiedProjectPayment(1),true);
  await db.exec("UPDATE payments SET status='refunded'");
  assert.equal(await fulfilVerifiedProjectPayment(intent,details),false);
  assert.equal(await hasVerifiedProjectPayment(1),false);
});
test('ledger ownership mismatch cannot unlock a paid project', async () => {
  await reset(); await fulfilVerifiedProjectPayment(intent,details);
  await db.exec('UPDATE payments SET client_id=3');
  assert.equal(await hasVerifiedProjectPayment(1),false);
});
