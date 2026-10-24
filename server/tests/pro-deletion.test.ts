import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { recordConfirmedDeletion } from '../services/deletion-state';
import { getProDeletionOptions, mayGrantProEntitlement, parseProDeletionTiming,
  processConfirmedDeletion, type DeletionStripe, type ProDeletionTiming } from '../services/pro-deletion';
import type { RetainerDb } from '../retainer-v1-db';

const now = Date.parse('2026-10-24T12:00:00Z');
const end = Date.parse('2026-11-03T15:30:00Z');
const noBlockers = { state: 'none' as const, scheduledFor: null, blockers: [] };
const project = { code:'active_project', label:'Open project',detail:'Complete the project.',clearsAutomatically:false };
// Reuse the WASM engine while resetting data between sequential tests.
let database: PGlite | undefined;
after(async () => { await database?.close(); });

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  await run(f);
}
async function setup() {
  const db = database ??= new PGlite();
  await db.exec(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    CREATE TABLE users(id int primary key,account_status text);
    INSERT INTO users VALUES(7,'active');
    CREATE TABLE profiles(user_id int,is_pro int); INSERT INTO profiles VALUES(7,1);
    CREATE TABLE pro_subscriptions(id int,user_id int,membership_type text,status text,stripe_subscription_id text,
      current_period_end text,cancel_at_period_end int,updated_at text);
    INSERT INTO pro_subscriptions VALUES(2,7,'paid','active','sub_test','2026-11-01T00:00:00Z',0,NULL);
    CREATE TABLE account_deletion_requests(id serial primary key,user_id int,status text,state text,
      requested_at text,scheduled_for timestamptz,deferred_reason text);`);
  const migration = readFileSync(new URL('../../migrations/0017_pro_account_deletion.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // repeat deploy is safe
  const calls: string[] = [];
  let live = { id:'sub_test',status:'active',current_period_end:end/1000,cancel_at_period_end:false };
  let fail: string | null = null;
  let erased = 0;
  let obligations = false;
  const stripe: DeletionStripe = { subscriptions: {
    retrieve: async id => { assert.equal(id,'sub_test'); if(fail==='retrieve') throw Error('Stripe unavailable'); return {...live}; },
    update: async (_id, options) => {
      calls.push('schedule'); assert.equal(options.cancel_at_period_end,true);
      if(fail==='update') throw Error('Stripe unavailable');
      live.cancel_at_period_end=true; return {...live};
    },
    cancel: async (_id, options) => {
      calls.push('cancel'); assert.deepEqual(options,{invoice_now:false,prorate:false});
      const saved = (await db.query<any>("SELECT * FROM account_deletion_requests WHERE pro_deletion_timing IS NOT NULL AND state IN ('processing','scheduled')")).rows;
      assert.ok(saved.length, 'consent is durable before billing changes');
      if(fail==='cancel') throw Error('Stripe unavailable');
      live.status='canceled'; return {...live};
    },
  } };
  const deps = {
    stripe, now,
    assess: async (_id: number, options: {skipPro:boolean}) => {
      const blockers = obligations ? [project] : [];
      if(!options.skipPro && live.status==='active') blockers.push({code:'active_pro_subscription',label:'Pro',detail:'Choose a timing.',clearsAutomatically:false});
      return blockers.length ? {state:'scheduled' as const,scheduledFor:'2027-01-22T12:00:00.000Z',blockers} : noBlockers;
    },
    anonymise: async () => {
      assert.ok(live.status==='canceled' || (await db.query<any>('SELECT COUNT(*) AS n FROM pro_subscriptions')).rows[0].n===0,
        'billing must be stopped before access is removed');
      calls.push('erase'); erased++;
      await db.exec("UPDATE users SET account_status='anonymised'; UPDATE account_deletion_requests SET state='anonymised',status='anonymised' WHERE state IN ('processing','scheduled')");
    },
  };
  return { db,calls,deps, confirm:async(timing:ProDeletionTiming|null) => recordConfirmedDeletion(db,7,await deps.assess(7,{skipPro:false}),timing),
    setFail:(value:string|null)=>{fail=value;}, setLive:(patch:Partial<typeof live>)=>{Object.assign(live,patch);},
    setObligations:(value:boolean)=>{obligations=value;}, erased:()=>erased };
}

test('only explicit valid choices are accepted; omitted timing remains legacy behavior', () => {
  for(const value of [undefined,null]) assert.equal(parseProDeletionTiming(value),null);
  for(const value of ['immediate','pro_period_end']) assert.equal(parseProDeletionTiming(value),value);
  for(const value of ['now','',{},false]) assert.throws(()=>parseProDeletionTiming(value),{status:400});
});

test('immediate choice stops Stripe billing before erasing the account, without a new invoice/refund', () => fixture(async f => {
  const id=await f.confirm('immediate');
  assert.equal((await processConfirmedDeletion(f.db,7,id,f.deps)).state,'anonymised');
  assert.deepEqual(f.calls,['cancel','erase']);
  assert.equal((await f.db.query<any>('SELECT status FROM pro_subscriptions')).rows[0].status,'cancelled');
  assert.equal((await f.db.query<any>('SELECT is_pro FROM profiles')).rows[0].is_pro,0);
  await processConfirmedDeletion(f.db,7,id,f.deps); assert.equal(f.erased(),1);
}));

test('period-end choice uses Stripe date, preserves access before it, then deletes even if the expiry webhook is late', () => fixture(async f => {
  const id=await f.confirm('pro_period_end');
  const result=await processConfirmedDeletion(f.db,7,id,f.deps);
  assert.equal(result.state,'scheduled'); assert.equal(result.scheduledFor,new Date(end).toISOString());
  assert.deepEqual(f.calls,['schedule']); assert.equal(f.erased(),0);
  assert.equal((await f.db.query<any>('SELECT account_status FROM users')).rows[0].account_status,'active');
  assert.equal((await f.db.query<any>('SELECT is_pro FROM profiles')).rows[0].is_pro,1);
  const before=await processConfirmedDeletion(f.db,7,id,{...f.deps,now:end-1});
  assert.equal(before.state,'scheduled'); assert.equal(f.erased(),0);
  assert.equal((await processConfirmedDeletion(f.db,7,id,{...f.deps,now:end})).state,'anonymised');
  assert.deepEqual(f.calls.slice(-2),['cancel','erase']);
}));

test('an early cancellation webhook cannot shorten the chosen account lifetime', () => fixture(async f => {
  const id=await f.confirm('pro_period_end');
  await processConfirmedDeletion(f.db,7,id,f.deps);
  f.setLive({status:'canceled'});
  await f.db.exec("UPDATE pro_subscriptions SET status='expired'");
  assert.equal((await processConfirmedDeletion(f.db,7,id,{...f.deps,now:end-1})).state,'scheduled');
  assert.equal(f.erased(),0);
  assert.equal((await processConfirmedDeletion(f.db,7,id,{...f.deps,now:end})).state,'anonymised');
}));

test('period-end choice retains the paid-through date if Pro was already cancelled before confirmation', () => fixture(async f => {
  f.setLive({status:'canceled'});
  const id=await f.confirm('pro_period_end');
  const result=await processConfirmedDeletion(f.db,7,id,f.deps);
  assert.equal(result.state,'scheduled'); assert.equal(result.proDeleteAfter,new Date(end).toISOString());
  assert.deepEqual(f.calls,[]); assert.equal(f.erased(),0);
}));

test('switching from period end to immediate supersedes old jobs', () => fixture(async f => {
  const old=await f.confirm('pro_period_end'); await processConfirmedDeletion(f.db,7,old,f.deps);
  const immediate=await f.confirm('immediate');
  assert.equal((await processConfirmedDeletion(f.db,7,old,f.deps)).state,'ignored');
  assert.equal((await processConfirmedDeletion(f.db,7,immediate,f.deps)).state,'anonymised');
  assert.equal(f.erased(),1);
}));

test('a pending replacement is not consent and does not supersede a confirmed request', () => fixture(async f => {
  const id=await f.confirm('pro_period_end');
  const pending=(await f.db.query<any>("INSERT INTO account_deletion_requests(user_id,state,status,pro_deletion_timing) VALUES(7,'pending','pending','immediate') RETURNING id")).rows[0].id;
  assert.equal((await processConfirmedDeletion(f.db,7,pending,f.deps)).state,'ignored');
  assert.equal((await processConfirmedDeletion(f.db,7,id,f.deps)).state,'scheduled');
  assert.equal(f.erased(),0);
}));

test('Stripe failure keeps account and durable intent; a retry completes cancellation and deletion', () => fixture(async f => {
  const id=await f.confirm('immediate'); f.setFail('cancel');
  await assert.rejects(processConfirmedDeletion(f.db,7,id,f.deps),/Stripe unavailable/);
  assert.equal(f.erased(),0); assert.equal((await f.db.query<any>('SELECT account_status FROM users')).rows[0].account_status,'active');
  assert.equal((await f.db.query<any>('SELECT state FROM account_deletion_requests WHERE id=$1',[id])).rows[0].state,'scheduled');
  f.setFail(null); assert.equal((await processConfirmedDeletion(f.db,7,id,f.deps)).state,'anonymised');
}));

test('a failed period-end cancellation preserves the first verified date across retries', () => fixture(async f => {
  const id=await f.confirm('pro_period_end'); f.setFail('update');
  await assert.rejects(processConfirmedDeletion(f.db,7,id,f.deps));
  f.setFail(null); f.setLive({current_period_end:(end+30*86400000)/1000});
  assert.equal((await processConfirmedDeletion(f.db,7,id,f.deps)).proDeleteAfter,new Date(end).toISOString());
  assert.equal((await processConfirmedDeletion(f.db,7,id,{...f.deps,now:end})).state,'anonymised');
}));

test('a database failure after Stripe cancellation is recoverable without cancelling twice', () => fixture(async f => {
  const id=await f.confirm('immediate'); let fail=true;
  const db:RetainerDb={query:async(text,args)=>{
    if(fail && text.startsWith('UPDATE pro_subscriptions')) { fail=false; throw Error('database unavailable'); }
    return f.db.query(text,args);
  }};
  await assert.rejects(processConfirmedDeletion(db,7,id,f.deps),/database unavailable/);
  assert.equal(f.erased(),0);
  await processConfirmedDeletion(db,7,id,f.deps);
  assert.deepEqual(f.calls,['cancel','erase']);
}));

test('immediate Pro termination retains separate project obligations and rejects late entitlement restoration', () => fixture(async f => {
  f.setObligations(true); const id=await f.confirm('immediate');
  const result=await processConfirmedDeletion(f.db,7,id,f.deps);
  assert.equal(result.state,'scheduled'); assert.deepEqual(result.blockers,[project]); assert.equal(f.erased(),0);
  assert.equal(await mayGrantProEntitlement(7,f.db),false);
  f.setObligations(false); await processConfirmedDeletion(f.db,7,id,f.deps); assert.equal(f.erased(),1);
}));

test('an admin hold cannot be superseded and prevents a worker from changing billing', () => fixture(async f => {
  const id=await f.confirm('immediate');
  await f.db.exec("INSERT INTO account_deletion_requests(user_id,state,status) VALUES(7,'blocked','blocked')");
  await assert.rejects(f.confirm('immediate'),{status:409});
  assert.equal((await processConfirmedDeletion(f.db,7,id,f.deps)).state,'ignored'); assert.deepEqual(f.calls,[]);
}));

test('legacy callers do not implicitly cancel Pro, and non-Pro accounts can still delete', () => fixture(async f => {
  const old=await f.confirm(null); assert.equal((await processConfirmedDeletion(f.db,7,old,f.deps)).state,'scheduled');
  assert.deepEqual(f.calls,[]);
  await f.db.exec('DELETE FROM pro_subscriptions'); f.setLive({status:'canceled'});
  assert.equal(await getProDeletionOptions(7,f.db),null);
  const id=await f.confirm(null); assert.equal((await processConfirmedDeletion(f.db,7,id,f.deps)).state,'anonymised');
}));

test('missing Stripe identity or invalid expiry never turns a delayed choice into immediate erasure', () => fixture(async f => {
  const id=await f.confirm('pro_period_end'); f.setLive({current_period_end:NaN});
  await assert.rejects(processConfirmedDeletion(f.db,7,id,f.deps),/expiry date/); assert.equal(f.erased(),0);
  await f.db.exec('UPDATE pro_subscriptions SET stripe_subscription_id=NULL');
  await assert.rejects(processConfirmedDeletion(f.db,7,id,f.deps),/without its Stripe subscription/); assert.equal(f.erased(),0);
}));

test('partial personal-data cleanup retains a retry after account access has been removed', () => fixture(async f => {
  const id=await f.confirm('immediate');
  await assert.rejects(processConfirmedDeletion(f.db,7,id,{...f.deps,anonymise:async()=>{
    await f.db.exec("UPDATE users SET account_status='anonymised'");
    throw Object.assign(new Error('storage cleanup failed'),{partial:true});
  }}),{partial:true});
  assert.equal((await f.db.query<any>('SELECT state FROM account_deletion_requests WHERE id=$1',[id])).rows[0].state,'scheduled');
  assert.equal((await processConfirmedDeletion(f.db,7,id,f.deps)).state,'anonymised');
  assert.deepEqual(f.calls,['cancel','erase']);
}));
