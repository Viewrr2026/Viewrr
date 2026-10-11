import { calculateEstimate } from '../shared/project-estimate';
import { retainerPool,retainerTransaction,retainerError,type RetainerDb } from './retainer-v1-db';
async function project(db:RetainerDb,id:number,userId:number) {
  const {rows:[p]}=await db.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE',[id]);
  if(!p) retainerError('Project not found',404);
  if(![p.client_id,p.freelancer_id].includes(userId)) retainerError('Not authorised',403);
  if(p.is_retainer===1) retainerError('Retainers use their agreed cycle estimate',409);
  return p;
}
export async function projectEstimates(id:number,userId:number) {
  return retainerTransaction(async db=>{
    await project(db,id,userId);
    const {rows}=await db.query('SELECT * FROM project_estimate_versions WHERE project_id=$1 ORDER BY version DESC',[id]);
    const {rows:invoices}=await db.query('SELECT id,status FROM invoices WHERE project_id=$1 LIMIT 1',[id]);
    return {versions:rows,invoiced:!!invoices.length};
  });
}
export async function proposeEstimate(id:number,userId:number,expectedVersion:number,raw:unknown) {
  const snapshot=calculateEstimate(raw);
  return retainerTransaction(async db=>{
    await project(db,id,userId);
    if((await db.query('SELECT id FROM invoices WHERE project_id=$1 LIMIT 1',[id])).rows.length) retainerError('An invoice has already been issued. Contact support for an adjustment.');
    const {rows:[latest]}=await db.query('SELECT * FROM project_estimate_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[id]);
    if((latest?.version??0)!==expectedVersion) retainerError('Estimate changed. Refresh before sending.');
    await db.query("UPDATE project_estimate_versions SET status='superseded' WHERE project_id=$1 AND status='pending'",[id]);
    const {rows:[version]}=await db.query(`INSERT INTO project_estimate_versions(project_id,version,proposed_by,snapshot)
      VALUES($1,$2,$3,$4) RETURNING *`,[id,expectedVersion+1,userId,JSON.stringify(snapshot)]);
    return version;
  });
}
export async function reviewEstimate(id:number,userId:number,version:number,action:string,feedback:string) {
  if(!['accept','decline','request_changes'].includes(action)) retainerError('Invalid review action',400);
  if(action==='request_changes'&&!feedback.trim()) retainerError('Describe the requested changes',400);
  if(feedback.length>4000) retainerError('Feedback is too long',400);
  return retainerTransaction(async db=>{
    await project(db,id,userId);
    const {rows:[latest]}=await db.query('SELECT * FROM project_estimate_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[id]);
    if(!latest||latest.version!==version||latest.status!=='pending') retainerError('This estimate is no longer awaiting review');
    if(latest.proposed_by===userId) retainerError('Your partner must review this version',403);
    const {rows:[result]}=await db.query(`UPDATE project_estimate_versions SET status=$2,reviewed_by=$3,reviewed_at=NOW(),feedback=$4 WHERE id=$1 RETURNING *`,
      [latest.id,action==='accept'?'accepted':action==='decline'?'declined':'changes_requested',userId,feedback]);
    return result;
  });
}
export async function issueProjectInvoice(id:number,freelancerId:number,raw:any) {
  const requested=calculateEstimate(raw);
  return retainerTransaction(async db=>{
    const p=await project(db,id,freelancerId);
    if(p.freelancer_id!==freelancerId) retainerError('Only the freelancer can issue the invoice',403);
    const {rows:[existing]}=await db.query('SELECT * FROM invoices WHERE project_id=$1 ORDER BY id LIMIT 1',[id]);
    if(existing) retainerError('This project already has an invoice. Open the existing invoice.');
    const {rows:[latest]}=await db.query('SELECT * FROM project_estimate_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[id]);
    if(latest&&latest.status!=='accepted') retainerError('Both parties must agree the latest estimate before invoicing.');
    const agreed=latest ? calculateEstimate(latest.snapshot) : null;
    if(agreed && (requested.totalPence!==agreed.totalPence || requested.vatPercent!==agreed.vatPercent || requested.vatPence!==agreed.vatPence))
      retainerError('Invoice total or VAT differs from the agreed estimate. Send an amended estimate for approval first.');
    // The final invoice may describe and itemise the completed work differently.
    // Keep the accepted estimate unchanged and calculate invoice amounts on the server.
    const final=requested;
    // Lock freelancer as well to serialize numbering across their projects.
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[freelancerId]);
    const {rows:[count]}=await db.query('SELECT COUNT(*)::int AS count FROM invoices WHERE freelancer_id=$1',[freelancerId]);
    const now=new Date().toISOString();
    const {rows:[invoice]}=await db.query(`INSERT INTO invoices
      (invoice_number,project_id,freelancer_id,client_id,client_name,client_email,project_title,line_items,subtotal_pence,vat_pence,total_pence,notes,status,issued_at,created_at,estimate_version_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'sent',$13,$13,$14) RETURNING *`,
      [`INV-${String(count.count+1).padStart(5,'0')}`,id,freelancerId,p.client_id,String(raw.clientName??'').slice(0,300),String(raw.clientEmail??'').slice(0,300),p.title,
      JSON.stringify(final.lineItems),final.subtotalPence,final.vatPence,final.totalPence,String(raw.notes??final.notes??'').slice(0,4000),now,latest?.id??null]);
    return Object.fromEntries(Object.entries(invoice).map(([key,value])=>[key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]));
  });
}
/** For projects using estimates, stop work on unresolved terms and require the invoice before final submission. */
export async function requireProjectEstimate(id:number,finalSubmission=false) {
  const db=retainerPool();
  const {rows:[latest]}=await db.query('SELECT status FROM project_estimate_versions WHERE project_id=$1 ORDER BY version DESC LIMIT 1',[id]);
  if(latest&&latest.status!=='accepted') retainerError('Agree the latest estimate before progressing work.');
  if(finalSubmission&&latest&&!(await db.query('SELECT id FROM invoices WHERE project_id=$1 LIMIT 1',[id])).rows.length)
    retainerError('Send the agreed final invoice before submitting final delivery.');
}

/** Invitation acceptance, project and its agreed provisional invoice are one transaction. */
export async function acceptEstimatedInvitation(invitationId:number,userId:number) {
  const { invitationEstimate }=await import('../shared/project-estimate');
  const camel=(row:any)=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]));
  return retainerTransaction(async db=>{
    const {rows:[inv]}=await db.query('SELECT * FROM project_invitations WHERE id=$1 FOR UPDATE',[invitationId]);
    if(!inv)retainerError('Invitation not found',404);
    if(inv.recipient_id!==userId)retainerError('Not authorised',403);
    if(inv.is_retainer===1)retainerError('Use the retainer acceptance flow');
    if(inv.accepted_project_id){
      const {rows:[p]}=await db.query('SELECT * FROM projects WHERE id=$1',[inv.accepted_project_id]);
      return {invitation:camel(inv),project:camel(p),replayed:true};
    }
    if(inv.status!=='pending')retainerError('This invitation is no longer pending');
    const {rows:people}=await db.query('SELECT id,name,role FROM users WHERE id IN ($1,$2)',[inv.sender_id,inv.recipient_id]);
    const sender=people.find(p=>p.id===inv.sender_id),recipient=people.find(p=>p.id===inv.recipient_id);
    if(!sender||!recipient||sender.id===recipient.id)retainerError('Two participants are required',400);
    const client=sender.role==='client'?sender:recipient,freelancer=sender.role==='client'?recipient:sender;
    let estimate:any=null;
    // Older invitations may have free-text budget ranges, requiring explicit workspace agreement.
    try{estimate=invitationEstimate(inv.title,inv.budget);}catch{}
    const now=new Date().toISOString();
    const {rows:[p]}=await db.query(`INSERT INTO projects(client_id,freelancer_id,title,description,status,current_stage,client_name,freelancer_name,brief_category,is_retainer,planning_status,agreed_amount_pence,created_at)
      VALUES($1,$2,$3,$4,'active',0,$5,$6,$7,0,'planning_required',$8,$9) RETURNING *`,
      [client.id,freelancer.id,inv.title,inv.description??'',client.name,freelancer.name,inv.category??'',estimate?.totalPence??null,now]);
    if(estimate)await db.query(`INSERT INTO project_estimate_versions(project_id,version,proposed_by,snapshot,status,reviewed_by,reviewed_at)
      VALUES($1,1,$2,$3,'accepted',$4,NOW())`,[p.id,inv.sender_id,JSON.stringify(estimate),inv.recipient_id]);
    await db.query("UPDATE project_invitations SET status='accepted',accepted_project_id=$2 WHERE id=$1",[inv.id,p.id]);
    return {invitation:camel({...inv,status:'accepted',accepted_project_id:p.id}),project:camel(p),replayed:false};
  });
}
