import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { setRetainerTestDatabase } from '../retainer-v1-db';
import { proposeEstimate,reviewEstimate,issueProjectInvoice,projectEstimates,requireProjectEstimate } from '../project-estimates';
const db=new PGlite();
process.env.NODE_ENV='test';
before(async()=>{
  await db.exec(await readFile(new URL('./fixtures/retainer-base.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../../migrations/0015_project_estimates.sql',import.meta.url),'utf8'));
  await db.exec(`INSERT INTO users(id,name,email,role) VALUES(1,'Client','client@example.test','client'),(2,'Freelancer','freelancer@example.test','freelancer'),(3,'Stranger','stranger@example.test','client');
    INSERT INTO projects(id,client_id,freelancer_id,title,created_at) VALUES(1,1,2,'Estimate test','2026-09-30'),(2,1,2,'Legacy project','2026-09-30')`);
  setRetainerTestDatabase({query:async(sql,params)=>await db.query(sql,params) as any,transaction:fn=>db.transaction(tx=>fn({query:async(sql,params)=>await tx.query(sql,params) as any}))});
});
after(async()=>{setRetainerTestDatabase(undefined);await db.close();});
const terms={lineItems:[{description:'Video',quantity:2,unitPricePence:500,totalPence:1}],vatPercent:20,notes:'Two rounds of revisions'};
test('estimate requires partner agreement, rejects strangers and stale versions, preserves old agreed terms',async()=>{
  await assert.rejects(proposeEstimate(1,3,0,terms),/Not authorised/);
  const v1=await proposeEstimate(1,2,0,terms);
  assert.equal(v1.snapshot.totalPence,1200,'Ignore caller-supplied line totals');
  await assert.rejects(reviewEstimate(1,2,1,'accept',''),/partner/);
  await assert.rejects(requireProjectEstimate(1),/Agree/);
  await reviewEstimate(1,1,1,'accept','');
  await assert.rejects(proposeEstimate(1,2,0,terms),/changed/);
  const v2=await proposeEstimate(1,2,1,{...terms,lineItems:[{description:'Video',quantity:3,unitPricePence:500}]});
  await assert.rejects(issueProjectInvoice(1,2,v2.snapshot),/latest estimate/);
  const history=await projectEstimates(1,1);assert.equal(history.versions[1].status,'accepted');
  await reviewEstimate(1,1,2,'accept','');
  await assert.rejects(requireProjectEstimate(1,true),/final invoice/);
});
test('invoice uses agreed items, serializes retries and cannot be overwritten or revised after issuance',async()=>{
  await assert.rejects(issueProjectInvoice(1,1,terms),/freelancer/);
  await assert.rejects(issueProjectInvoice(1,2,terms),/differ/);
  const accepted=(await projectEstimates(1,2)).versions[0].snapshot;
  const results=await Promise.allSettled([issueProjectInvoice(1,2,accepted),issueProjectInvoice(1,2,accepted)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const invoice=(await db.query<any>('SELECT * FROM invoices WHERE project_id=1')).rows[0];assert.equal(invoice.total_pence,1800);
  await assert.rejects(proposeEstimate(1,2,2,terms),/already been issued/);
  await requireProjectEstimate(1,true);
  assert.equal((await db.query('SELECT * FROM invoices WHERE project_id=1')).rows.length,1);
});
test('legacy project may issue its first invoice with server-calculated amounts',async()=>{
  const invoice:any=await issueProjectInvoice(2,2,terms);assert.equal(invoice.totalPence,1200);
  await assert.rejects(issueProjectInvoice(2,2,terms),/already has/);
});
