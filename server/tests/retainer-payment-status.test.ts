import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readRetainerPaymentStatus } from "../retainer-payment-status";

const db = new PGlite();
before(async () => {
  await db.exec(`CREATE TABLE projects(id int,client_id int,freelancer_id int);
    CREATE TABLE retainer_cycles(public_id text,project_id int,payment_id int,paid_at text);
    CREATE TABLE payments(id int,status text,public_id text,gross_pence int,succeeded_at text,stripe_payment_intent_id text);`);
});
beforeEach(async () => {
  await db.exec(`TRUNCATE projects,retainer_cycles,payments;
    INSERT INTO projects VALUES(1,10,20);
    INSERT INTO retainer_cycles VALUES('cycle-one',1,5,null);
    INSERT INTO payments VALUES(5,'pending','pay_one',10000,null,'pi_one');`);
});
after(() => db.close());

test("only project parties can check a cycle; unrelated callers never reach Stripe", async () => {
  for (const userId of [0, 30]) {
    await assert.rejects(readRetainerPaymentStatus(db as any, async () => { assert.fail("Stripe called for unrelated user"); }, "cycle-one", userId), /Cycle not found/);
  }
  for (const userId of [10,20]) {
    const result = await readRetainerPaymentStatus(db as any, async id => {
      assert.equal(id, "pi_one"); return { status: "requires_payment_method" } as any;
    }, "cycle-one", userId);
    assert.equal(result.status, "requires_payment_method");
    assert.equal(result.verified, false);
  }
});

test("processor success waits for verified fulfilment of both payment and cycle", async () => {
  const retrieve = async () => ({ status: "succeeded" }) as any;
  assert.equal((await readRetainerPaymentStatus(db as any,retrieve,"cycle-one",10)).status,"processing");
  await db.exec("UPDATE payments SET status='succeeded',succeeded_at='now'");
  assert.equal((await readRetainerPaymentStatus(db as any,retrieve,"cycle-one",10)).verified,false);
  await db.exec("UPDATE retainer_cycles SET paid_at='now'");
  const result=await readRetainerPaymentStatus(db as any,async()=>assert.fail("Already fulfilled"),"cycle-one",10);
  assert.equal(result.verified,true); assert.equal(result.status,"succeeded");
});

test("refunds and disputes never become paid receipts",async()=>{
  for(const status of ["refunded","partially_refunded","disputed"]){
    await db.query("UPDATE payments SET status=$1,succeeded_at='now'",[status]);
    await db.exec("UPDATE retainer_cycles SET paid_at='now'");
    const result=await readRetainerPaymentStatus(db as any,async()=>assert.fail("Terminal ledger status"),"cycle-one",10);
    assert.equal(result.status,status);assert.equal(result.verified,false);
  }
});

test("Stripe outages fail closed and checkout status never creates or fulfils payments",async()=>{
  await assert.rejects(readRetainerPaymentStatus(db as any,async()=>{throw new Error("offline");},"cycle-one",10),/offline/);
  const row=(await db.query<any>("SELECT status,succeeded_at FROM payments")).rows[0];
  assert.deepEqual(row,{status:"pending",succeeded_at:null});
  await db.exec("UPDATE payments SET stripe_payment_intent_id=null");
  assert.equal((await readRetainerPaymentStatus(db as any,async()=>assert.fail("No stored intent"),"cycle-one",10)).status,"processing");
  await db.exec("UPDATE retainer_cycles SET payment_id=null");
  assert.equal((await readRetainerPaymentStatus(db as any,async()=>assert.fail("No payment"),"cycle-one",10)).status,"not_started");
});
