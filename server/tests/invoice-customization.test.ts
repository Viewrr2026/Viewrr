import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {setRetainerTestDatabase} from '../retainer-v1-db';
import {issueProjectInvoice,proposeEstimate,reviewEstimate} from '../project-estimates';
import {invoiceBrandingSchema,invoiceDetailsSchema,normalizeInvoiceBranding,resolveInvoicePresentation} from '../../shared/invoice-presentation';
const db=new PGlite();
const migration=()=>readFile(new URL('../../migrations/0020_invoice_customization.sql',import.meta.url),'utf8');
const terms={lineItems:[{description:'Film production',quantity:1,unitPricePence:80000}],vatPercent:0};
const branding=invoiceBrandingSchema.parse({businessName:'Example Studio',businessAddress:'Studio address',businessEmail:'studio@example.com',businessPhone:'01234 567890',logoUrl:'/api/media/12/asset-token/original.jpg',vatNumber:'GB123',accentColor:'#1F6255',paymentTerms:'Due in 14 days',footerNote:'Thank you',customization:{layout:'band',font:'serif',logoPosition:'right',heading:'Project invoice',companyNumber:'12345678',invoicePrefix:'STUDIO',dueDays:21,defaultNotes:'Saved notes',showViewrrBranding:false}});
before(async()=>{
  process.env.NODE_ENV='test';
  await db.exec(await readFile(new URL('./fixtures/retainer-base.sql',import.meta.url),'utf8'));
  await db.exec(`ALTER TABLE projects ADD COLUMN agreed_amount_pence INTEGER;
    CREATE TABLE project_invitations(id SERIAL PRIMARY KEY);
    INSERT INTO users(id,name,email,role) VALUES(1,'Client','client@example.com','client'),(2,'Creator','creator@example.com','freelancer'),(3,'Other freelancer','other@example.com','freelancer');
    INSERT INTO projects(id,client_id,freelancer_id,title,created_at) SELECT n,1,2,'Project '||n,'2026-10-29' FROM generate_series(100,110) n;
    INSERT INTO projects(id,client_id,freelancer_id,title,created_at) VALUES(120,1,3,'Other project','2026-10-29');
    INSERT INTO invoice_templates(user_id,business_name,business_email) VALUES(2,'Old studio','old@example.com');
    INSERT INTO invoices(invoice_number,project_id,freelancer_id,client_id,project_title,issued_at,created_at) VALUES('OLD-1',99,2,1,'Old project','2026-10-01','2026-10-01');`);
  await db.exec(await readFile(new URL('../../migrations/0015_project_estimates.sql',import.meta.url),'utf8'));
  await db.exec(await migration());
  setRetainerTestDatabase({query:async(sql,params)=>await db.query(sql,params) as any,transaction:fn=>db.transaction(tx=>fn({query:async(sql,params)=>await tx.query(sql,params) as any}))});
});
after(async()=>{setRetainerTestDatabase(undefined);await db.close();});
test('migration freezes legacy branding and can be safely rerun',async()=>{
  await db.exec("UPDATE invoice_templates SET business_name='New studio' WHERE user_id=2");
  await db.exec(await migration());
  const old=(await db.query<any>('SELECT presentation FROM invoices WHERE project_id=99')).rows[0].presentation;
  assert.equal(old.branding.businessName,'Old studio');
  const resolved=resolveInvoicePresentation({presentation:old},{businessName:'Today'});
  assert.equal(resolved.branding.businessName,'Old studio');
});
test('freelancer choices are snapshotted while identities, totals and payment status stay server-owned',async()=>{
  const invoice:any=await issueProjectInvoice(100,2,{...terms,branding,details:{invoiceNumber:'MY-0042',invoiceTitle:'Autumn brand film',invoiceDate:'2026-10-29',dueDate:'2026-11-12',clientAddress:'Client billing address',purchaseOrder:'PO-104'},clientName:'Client company',clientEmail:'billing@example.com',notes:'Invoice-specific notes',status:'paid',clientId:3,freelancerId:3,totalPence:1});
  assert.equal(invoice.status,'sent');assert.equal(invoice.totalPence,80000);assert.equal(invoice.clientId,1);assert.equal(invoice.freelancerId,2);
  assert.deepEqual(invoice.presentation.branding,branding);assert.equal(invoice.presentation.details.purchaseOrder,'PO-104');assert.equal(invoice.presentation.details.dueDate,'2026-11-12');
  assert.equal(invoice.clientEmail,'billing@example.com');assert.equal(invoice.notes,'Invoice-specific notes');
  await db.exec("UPDATE invoice_templates SET business_name='Changed defaults' WHERE user_id=2");
  assert.equal(resolveInvoicePresentation(invoice,{businessName:'Changed defaults'}).branding.businessName,'Example Studio');
  await assert.rejects(issueProjectInvoice(100,2,{...terms,branding:{businessName:'Overwrite'}}),/already has an invoice/);
});
test('saved defaults apply to future invoices; numbering rejects duplicates only for the same freelancer',async()=>{
  await db.query('UPDATE invoice_templates SET business_name=$1,customization=$2 WHERE user_id=2',[branding.businessName,JSON.stringify(branding.customization)]);
  await assert.rejects(issueProjectInvoice(101,2,{...terms,details:{invoiceNumber:'my-0042'}}),/already in use/);
  const other:any=await issueProjectInvoice(120,3,{...terms,details:{invoiceNumber:'MY-0042'}});assert.equal(other.invoiceNumber,'MY-0042');
  const next:any=await issueProjectInvoice(101,2,terms);assert.match(next.invoiceNumber,/^STUDIO-/);assert.equal(next.notes,'Saved notes');
  const d=next.presentation.details;assert.equal((Date.parse(d.dueDate)-Date.parse(d.invoiceDate))/86400000,21);
  assert.equal(next.presentation.branding.customization.font,'serif');assert.equal(next.presentation.branding.customization.showViewrrBranding,false);
});
test('customisation cannot bypass membership or accepted financial terms',async()=>{
  await assert.rejects(issueProjectInvoice(102,3,terms),/Not authorised/);
  await assert.rejects(issueProjectInvoice(102,1,terms),/Only the freelancer/);
  await proposeEstimate(102,2,0,terms);await reviewEstimate(102,1,1,'accept','');
  await assert.rejects(issueProjectInvoice(102,2,{...terms,lineItems:[{description:'More',quantity:1,unitPricePence:90000}],branding}),/differs/);
  await assert.rejects(issueProjectInvoice(102,2,{lineItems:[{description:'Different VAT',quantity:1,unitPricePence:64000}],vatPercent:25}),/differs/);
  const invoice:any=await issueProjectInvoice(102,2,{lineItems:[{description:'Filming',quantity:1,unitPricePence:60000},{description:'Editing',quantity:2,unitPricePence:10000}],branding});assert.equal(invoice.totalPence,80000);
});
test('legacy budget cap remains enforced on the server',async()=>{
  await db.exec('UPDATE projects SET agreed_amount_pence=80000 WHERE id=103');
  await assert.rejects(issueProjectInvoice(103,2,{lineItems:[{description:'Over budget',quantity:1,unitPricePence:90000}]}),/exceeds the agreed budget/);
  const invoice:any=await issueProjectInvoice(103,2,terms);assert.equal(invoice.subtotalPence,80000);
});
test('invalid presentation values are rejected and unknown identity fields stripped',()=>{
  for(const bad of [{logoUrl:'javascript:alert(1)'},{accentColor:'url(evil)'},{businessName:'x'.repeat(201)},{customization:{font:'evil'}},{customization:{invoicePrefix:'x\nDROP TABLE'}}]) assert.equal(invoiceBrandingSchema.safeParse(bad).success,false);
  for(const details of [{invoiceDate:'2026-02-30'},{invoiceDate:'2026-10-29',dueDate:'2026-10-01'},{invoiceNumber:'<script>'}]) assert.equal(invoiceDetailsSchema.safeParse(details).success,false);
  const parsed=invoiceBrandingSchema.parse({...branding,userId:3,id:99,updatedAt:'fake'});assert.equal('userId' in parsed,false);assert.equal('id' in parsed,false);
  const recovered=normalizeInvoiceBranding({businessName:'Retained',logoUrl:'javascript:evil',accentColor:'bad'});assert.equal(recovered.businessName,'Retained');assert.equal(recovered.logoUrl,'');assert.equal(recovered.accentColor,'#1F6255');
});
