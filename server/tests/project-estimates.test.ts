import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { setRetainerTestDatabase } from '../retainer-v1-db';
import { proposeEstimate,reviewEstimate,issueProjectInvoice,projectEstimates,requireProjectEstimate,acceptEstimatedInvitation } from '../project-estimates';
const db=new PGlite();
process.env.NODE_ENV='test';
before(async()=>{
  await db.exec(await readFile(new URL('./fixtures/retainer-base.sql',import.meta.url),'utf8'));
  await db.exec(`CREATE TABLE project_invitations(id SERIAL PRIMARY KEY,sender_id INTEGER,recipient_id INTEGER,title TEXT,description TEXT,category TEXT,budget TEXT,status TEXT DEFAULT 'pending',is_retainer INTEGER DEFAULT 0);
    ALTER TABLE projects ADD COLUMN brief_category TEXT,ADD COLUMN planning_status TEXT,ADD COLUMN agreed_amount_pence INTEGER;`);
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
test('invoice uses agreed financial terms, serializes retries and cannot be overwritten or revised after issuance',async()=>{
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

test('accepting an invitation records the initial estimate atomically and replay creates no extra project',async()=>{
  await db.exec(`SELECT setval('projects_id_seq',10); INSERT INTO project_invitations(id,sender_id,recipient_id,title,budget) VALUES(1,2,1,'Launch content','£1,500.00')`);
  await assert.rejects(acceptEstimatedInvitation(1,3),/Not authorised/);
  const result=await acceptEstimatedInvitation(1,1);
  const again=await acceptEstimatedInvitation(1,1);
  assert.equal(again.project.id,result.project.id);assert.equal(again.replayed,true);
  const estimate=(await projectEstimates(Number(result.project.id),1)).versions[0];
  assert.equal(estimate.status,'accepted');assert.equal(estimate.snapshot.totalPence,150000);
});

 test('final invoice permits new wording and itemisation at the agreed total, without changing the estimate',async()=>{
  await db.exec("INSERT INTO projects(id,client_id,freelancer_id,title,created_at) VALUES(30,1,2,'Same price','2026-10-01')");
  const original={lineItems:[{description:'Readiness check',quantity:1,unitPricePence:1000}],vatPercent:0};
  await proposeEstimate(30,2,0,original);
  await reviewEstimate(30,1,1,'accept','');
  await assert.rejects(issueProjectInvoice(30,2,{lineItems:[{description:'final',quantity:1,unitPricePence:1100}]}),/total or VAT differs/);
  // The same total must not hide a changed VAT treatment.
  await assert.rejects(issueProjectInvoice(30,2,{lineItems:[{description:'final',quantity:1,unitPricePence:800}],vatPercent:25}),/total or VAT differs/);
  const finalItems=[{description:'Final editing',quantity:1,unitPricePence:600},{description:'Final delivery',quantity:2,unitPricePence:200}];
  const invoice:any=await issueProjectInvoice(30,2,{lineItems:finalItems,totalPence:1});
  assert.equal(invoice.totalPence,1000);
  assert.deepEqual(JSON.parse(invoice.lineItems),finalItems.map(i=>({...i,totalPence:i.quantity*i.unitPricePence})));
  const estimate=(await projectEstimates(30,1)).versions[0];
  assert.equal(estimate.snapshot.lineItems[0].description,'Readiness check');
  assert.equal(Number(invoice.estimateVersionId),Number(estimate.id));
 });
