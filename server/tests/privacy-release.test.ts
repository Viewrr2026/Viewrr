import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { filterBlockedAuthors, requireOwnUserParam } from '../privacy-guards';
import { recordConfirmedDeletion, runDeletionCleanup, DELETE_AUTHORED_REVIEWS } from '../services/deletion-state';
import { finishMediaWrite, purgeNextPersonalUpload } from '../media-erasure';

test('private collection guard rejects guessed user IDs and permits the authenticated owner', () => {
  for (const [auth,clientId,expected] of [[undefined,'7',401],[{userId:8},'7',403],[{userId:7},'7',200]] as const) {
    let status=200, reached=false, cache='';
    const res:any={ status(code:number){status=code;return this;},json(){},set(_name:string,value:string){cache=value;return this;} };
    requireOwnUserParam('clientId')({auth,params:{clientId}} as any,res,()=>{reached=true;});
    assert.equal(status,expected);assert.equal(reached,expected===200);
    if(reached) assert.equal(cache,'private, no-store');
  }
});

test('block filtering removes both supplied directions and never falls back to unfiltered content on failure', async () => {
  const rows=[{id:1},{id:2},{id:3}];
  assert.deepEqual(await filterBlockedAuthors(4,rows,r=>r.id,async()=>[1,3]),[{id:2}]);
  await assert.rejects(filterBlockedAuthors(4,rows,r=>r.id,async()=>{throw Error('database unavailable');}));
  assert.equal(rows.length,3); // shared anonymous cache was not mutated
});

test('a failed optional-table lookup leaves deletion incomplete, attempts other cleanup, and recovers on retry', async () => {
  let completed=false, otherCleaned=false;
  const report=()=>({completedSteps:[],skippedSteps:[],failedSteps:[]});
  const steps=[{name:'tokens',optional:'tokens',run:async()=>{}},{name:'messages',run:async()=>{otherCleaned=true;}}];
  const failed=report();
  await assert.rejects(runDeletionCleanup(steps,failed,async()=>{throw Error('connection lost');},async()=>{completed=true;}),{partial:true});
  assert.equal(completed,false);assert.equal(otherCleaned,true);
  assert.deepEqual(failed.failedSteps,[{step:'tokens',error:'connection lost'}]);
  await runDeletionCleanup(steps,report(),async()=>true,async()=>{completed=true;});
  assert.equal(completed,true);
});

test('confirmed deletion is durable before cleanup, works without a prior request, and cannot override an admin hold', async () => {
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE users(id int primary key,account_status text);
      INSERT INTO users VALUES(1,'active'),(2,'anonymised'),(3,'active');
      CREATE TABLE account_deletion_requests(id serial primary key,user_id int,status text,state text,requested_at text,scheduled_for timestamp,deferred_reason text,pro_deletion_timing text);
      INSERT INTO account_deletion_requests(user_id,state,status) VALUES(3,'blocked','blocked');`);
    const id=await recordConfirmedDeletion(db,1,{state:'none',scheduledFor:null,blockers:[]});
    const row:any=(await db.query('SELECT * FROM account_deletion_requests WHERE id=$1',[id])).rows[0];
    assert.equal(row.state,'processing');assert.equal(row.status,'processing');
    assert.ok(row.scheduled_for);
    for(const user of [2,3,4]) await assert.rejects(recordConfirmedDeletion(db,user,{state:'none',scheduledFor:null,blockers:[]}));
    const delayed=await recordConfirmedDeletion(db,1,{state:'scheduled',scheduledFor:'2026-11-01T00:00:00Z',blockers:[{code:'active_project'}]});
    assert.equal((await db.query<any>('SELECT deferred_reason FROM account_deletion_requests WHERE id=$1',[delayed])).rows[0].deferred_reason,'active_project');
  } finally { await db.close(); }
});

test('personal erasure retries both objects after failure, excludes shared and historical files, and prevents resurrection', async () => {
  const db=new PGlite();const bytes=new Set(['media/personal','media/personal.preview','media/shared','media/old']);
  try {
    await db.exec(`CREATE TABLE users(id int primary key,account_status text); INSERT INTO users VALUES(1,'anonymised'),(2,'active');
      CREATE TABLE upload_objects(id serial primary key, owner_user_id int,resource_type text,object_key text,status text,original_filename text,confirmed_at text,created_at text,upload_intent_expires_at text);
      INSERT INTO upload_objects(owner_user_id,resource_type,object_key,status,created_at,confirmed_at,upload_intent_expires_at) VALUES
      (1,'media_profile','media/personal','delete_pending','2020-01-01','2020-01-01','2020-01-01'),
      (1,'media_delivery','media/shared','delete_pending','2020-01-01','2020-01-01','2020-01-01'),
      (1,'media_profile','media/old','deleted','2020-01-01','2020-01-01','2020-01-01');`);
    await assert.rejects(purgeNextPersonalUpload(db,async key=>{if(key.endsWith('.preview'))throw Error('R2 unavailable');bytes.delete(key);}));
    assert.equal((await db.query<any>('SELECT status FROM upload_objects WHERE id=1')).rows[0].status,'delete_processing');
    assert.equal(await purgeNextPersonalUpload(db,async key=>{bytes.delete(key);}),false); // lease has not expired
    await db.exec("UPDATE upload_objects SET confirmed_at='2020-01-01' WHERE id=1");
    assert.equal(await purgeNextPersonalUpload(db,async key=>{bytes.delete(key);}),true);
    assert.deepEqual([...bytes].sort(),['media/old','media/shared']);
    assert.equal(await finishMediaWrite(db,1,'media_processing','ready'),false);
    assert.equal((await db.query<any>('SELECT status FROM upload_objects WHERE id=1')).rows[0].status,'delete_pending');
    // A late preview write after deletion is re-queued, never made readable.
    bytes.add('media/personal.preview');
    await db.exec("UPDATE upload_objects SET confirmed_at='2020-01-01' WHERE id=1");
    await purgeNextPersonalUpload(db,async key=>{bytes.delete(key);});
    assert.equal(bytes.has('media/personal.preview'),false);
    // A crashed writer is covered by the daily tombstone recheck too.
    bytes.add('media/personal');
    await db.exec("UPDATE upload_objects SET confirmed_at='2020-01-01' WHERE id=1");
    await purgeNextPersonalUpload(db,async key=>{bytes.delete(key);});
    assert.equal(bytes.has('media/personal'),false);
  } finally { await db.close(); }
});

test('deleting authored reviews removes text and recalculates other profiles without stale snapshot scores', async () => {
  const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE profiles(id int primary key,rating real,review_count int);
      CREATE TABLE reviews(id serial primary key,profile_id int,client_id int,rating int,comment text);
      INSERT INTO profiles VALUES(1,3,2),(2,5,1);
      INSERT INTO reviews(profile_id,client_id,rating,comment) VALUES(1,7,1,'erase me'),(1,8,5,'keep me'),(2,7,5,'erase me too');`);
    await db.query(DELETE_AUTHORED_REVIEWS,[7]);
    assert.deepEqual((await db.query('SELECT id,rating,review_count FROM profiles ORDER BY id')).rows,[{id:1,rating:5,review_count:1},{id:2,rating:0,review_count:0}]);
    assert.deepEqual((await db.query('SELECT comment FROM reviews')).rows,[{comment:'keep me'}]);
    await db.query(DELETE_AUTHORED_REVIEWS,[7]); // safe to retry after later cleanup fails
    assert.equal((await db.query<any>('SELECT review_count FROM profiles WHERE id=1')).rows[0].review_count,1);
  } finally { await db.close(); }
});
