import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { syncChargeRefunds, adjustedEarnings } from '../payment-refund-sync';
const db = new PGlite();
before(async () => {
  await db.exec(await readFile(new URL('./fixtures/retainer-base.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../../migrations/0003_prd007_payment_ledger.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../../migrations/0014_payment_adjustments.sql',import.meta.url),'utf8'));
  await db.exec(`INSERT INTO payments(public_id,project_id,invoice_id,client_id,freelancer_id,gross_pence,platform_fee_pence,freelancer_pence,status,stripe_payment_intent_id,stripe_charge_id)
    VALUES('pay_test',1,1,1,2,1000,110,890,'succeeded','pi_test','ch_test')`);
});
after(() => db.close());
const refunds: any[] = [];
let reversed = 0, feeRefunded = 0;
const stripe: any = {
  charges: { retrieve: async () => ({id:'ch_test',payment_intent:'pi_test',amount:1000,currency:'gbp',application_fee:'fee_test',transfer:'tr_test'}) },
  refunds: { list: async function* () { yield* refunds; } },
  applicationFees: { retrieve: async () => ({ amount_refunded:feeRefunded }) },
  transfers: { retrieve: async () => ({amount:1000,amount_reversed:reversed}) },
};
const transaction: any = (fn:any) => db.transaction(tx => fn({query:(sql:string,values:any[])=>tx.query(sql,values)}));
async function payment() { return (await db.query<any>('SELECT * FROM payments')).rows[0]; }
test('Dashboard refunds without metadata reconcile once, preserve original amounts and use actual fee/reversal amounts',async () => {
  refunds.push({id:'re_test',amount:400,status:'succeeded',created:1790770000,metadata:{},transfer_reversal:'trr_test'});
  reversed=400;feeRefunded=44;
  await syncChargeRefunds(stripe,'ch_test',transaction);
  await syncChargeRefunds(stripe,'ch_test',transaction);
  const p=await payment();
  assert.equal(p.refunded_pence,400);assert.equal(p.gross_pence,1000);assert.equal(p.freelancer_pence,890);
  assert.equal(p.status,'partially_refunded');assert.equal(adjustedEarnings(p),534);
  assert.equal((await db.query('SELECT * FROM payment_refunds')).rows.length,1);
  feeRefunded=0;await syncChargeRefunds(stripe,'ch_test',transaction);
  assert.equal(adjustedEarnings(await payment()),490,'Do not assume the platform fee was refunded');
});
test('pending and failed refunds do not count as returned money; later full refund converges',async () => {
  refunds.push({id:'re_second',amount:600,status:'pending',created:1790770100,metadata:{}});
  await syncChargeRefunds(stripe,'ch_test',transaction);assert.equal((await payment()).refunded_pence,400);
  refunds[1].status='failed';await syncChargeRefunds(stripe,'ch_test',transaction);
  assert.equal((await payment()).refunded_pence,400);
  refunds[1].status='succeeded';reversed=1000;feeRefunded=110;
  await syncChargeRefunds(stripe,'ch_test',transaction);
  assert.equal((await payment()).status,'refunded');assert.equal(adjustedEarnings(await payment()),0);
  await syncChargeRefunds(stripe,'ch_test',transaction);
  assert.equal((await db.query('SELECT * FROM payment_refunds')).rows.length,2);
});
test('mismatched Stripe currency rolls back without altering financial state',async () => {
  const bad={...stripe,charges:{retrieve:async()=>({...await stripe.charges.retrieve(),currency:'usd'})}};
  await assert.rejects(syncChargeRefunds(bad as any,'ch_test',transaction),/does not match/);
  assert.equal((await payment()).refunded_pence,1000);
});
test('cancelled, failed and unconfirmed attempts never contribute earned income', () => {
  for (const status of ['cancelled','canceled','failed','pending','processing','requires_payment_method','authorised']) {
    assert.equal(adjustedEarnings({status,freelancer_pence:89}),0,status);
  }
  assert.equal(adjustedEarnings({status:'succeeded',freelancer_pence:89}),89);
});
