import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { calculateEstimate } from '@shared/project-estimate';
import { createInvoicePresentation, invoiceBrandingSchema, invoiceDetailsSchema, invoiceError, invoiceIssueDetailsSchema, normalizeInvoiceBranding } from '@shared/invoice-presentation';
import { InvoiceBrandingFields } from './InvoiceBrandingFields';
import { InvoiceDocument, money } from './InvoiceDocument';

type Props={open:boolean;onClose:()=>void;onSent:()=>void;projectId:number;projectTitle:string;clientName?:string;clientEmail?:string;agreedAmountPence?:number};
type Item={description:string;quantity:string;price:string};
export function InvoiceComposer(props:Props) {
  return <Dialog open={props.open} onOpenChange={v=>!v&&props.onClose()}><DialogContent className="invoice-editor-content"><div className="invoice-editor-header"><DialogTitle>Create invoice</DialogTitle><DialogDescription>Make this invoice your own. Changes here apply to this invoice; your saved defaults stay available for next time.</DialogDescription></div>{props.open&&<LoadComposer {...props}/>}</DialogContent></Dialog>;
}
function LoadComposer(props:Props) {
  const {user}=useAuth();
  const template=useQuery({queryKey:['/api/invoice-template',user?.id],queryFn:async()=> (await apiRequest('GET','/api/invoice-template')).json(),retry:false,refetchOnWindowFocus:false});
  const estimate=useQuery({queryKey:['project-estimates',props.projectId],queryFn:async()=> (await apiRequest('GET',`/api/projects/${props.projectId}/estimates`)).json(),retry:false,refetchOnWindowFocus:false});
  if(template.isPending||estimate.isPending) return <p className="p-6" role="status">Loading your branding and agreed estimate…</p>;
  if(template.isError||estimate.isError) return <div className="p-6"><p role="alert">Your invoice details could not be loaded.</p><Button onClick={()=>{void template.refetch();void estimate.refetch();}}>Retry</Button></div>;
  return <ComposerForm {...props} template={template.data} latest={estimate.data?.versions?.[0]} name={user?.name||''}/>;
}
function ComposerForm(props:Props&{template:any;latest:any;name:string}) {
  const [branding,setBranding]=useState(()=>normalizeInvoiceBranding(props.template,props.name));
  const [editableDetails,setDetails]=useState(()=>createInvoicePresentation(branding,props.projectTitle).details);
  const details={...editableDetails,invoiceTitle:props.projectTitle};
  const [clientName,setClientName]=useState(props.clientName||''),[clientEmail,setClientEmail]=useState(props.clientEmail||'');
  const [notes,setNotes]=useState(branding.customization.defaultNotes);
  const accepted=props.latest?.status==='accepted' ? props.latest.snapshot : null;
  const [items,setItems]=useState<Item[]>(()=> accepted ? accepted.lineItems.map((i:any)=>({description:i.description,quantity:String(i.quantity),price:(i.unitPricePence/100).toFixed(2)})) : [{description:props.projectTitle,quantity:'1',price:props.agreedAmountPence?(props.agreedAmountPence/100).toFixed(2):''}]);
  const [vat,setVat]=useState(String(accepted?.vatPercent||0));
  const [tab,setTab]=useState<'details'|'items'|'branding'>('details');
  const [sending,setSending]=useState(false),[error,setError]=useState('');
  const [uploadBusy,setUploadBusy]=useState(false);
  const queryClient=useQueryClient();
  const raw={lineItems:items.map(i=>({description:i.description,quantity:Number(i.quantity),unitPricePence:Math.round(Number(i.price)*100)})),vatPercent:Number(vat),notes};
  let calculated:ReturnType<typeof calculateEstimate>|null=null,validation='';
  try {
    if(items.some(i=>!i.quantity.trim()||!i.price.trim())||!vat.trim()) throw new Error('Enter a quantity, price and VAT rate.');
    calculated=calculateEstimate(raw);
    if(props.latest && !accepted) throw new Error('Both parties must agree the latest estimate before sending an invoice.');
    if(accepted && (calculated.totalPence!==accepted.totalPence||calculated.vatPence!==accepted.vatPence||calculated.vatPercent!==accepted.vatPercent)) throw new Error('Keep the agreed total and VAT, or agree an amended estimate before sending.');
    if(!props.latest&&props.agreedAmountPence&&calculated.subtotalPence>props.agreedAmountPence) throw new Error('The subtotal exceeds the agreed budget. Agree an amended estimate first.');
    invoiceIssueDetailsSchema.parse({branding,details,clientName,clientEmail});
  } catch(e) {validation=invoiceError(e);}
  // Render incomplete drafts safely without changing what the freelancer typed.
  const presentation={version:1 as const,branding:normalizeInvoiceBranding(branding,props.name),details:{...details,invoiceDate:/^\d{4}-\d{2}-\d{2}$/.test(details.invoiceDate)?details.invoiceDate:'',dueDate:/^\d{4}-\d{2}-\d{2}$/.test(details.dueDate)?details.dueDate:''}};
  const preview={...calculated,lineItems:calculated?.lineItems||raw.lineItems,clientName,clientEmail,projectTitle:props.projectTitle,notes};
  const update=(i:number,patch:Partial<Item>)=>setItems(items.map((item,j)=>i===j?{...item,...patch}:item));
  const move=(i:number,delta:number)=>setItems(current=>{const result=[...current];[result[i],result[i+delta]]=[result[i+delta],result[i]];return result;});
  const field=(label:string,key:Exclude<keyof typeof details,'invoiceTitle'>,type='text',multi=false)=><label>{label}{multi?<Textarea rows={3} value={details[key]} onChange={e=>setDetails({...details,[key]:e.target.value})}/>:<Input type={type} value={details[key]} onChange={e=>setDetails({...details,[key]:e.target.value})}/>}</label>;
  async function send() {
    if(validation||!calculated||uploadBusy)return;setSending(true);setError('');
    try {
      await apiRequest('POST',`/api/projects/${props.projectId}/invoice`,{...raw,clientName,clientEmail,branding:invoiceBrandingSchema.parse(branding),details:invoiceDetailsSchema.parse(details)});
      await queryClient.invalidateQueries({queryKey:['/api/projects',props.projectId,'invoice']});
      await queryClient.invalidateQueries({queryKey:['project-estimates',props.projectId]});props.onSent();
    } catch(e){setError(invoiceError(e));} finally {setSending(false);}
  }
  return <><div className="invoice-editor-body"><div className="invoice-editor-form"><div className="invoice-tab-row" aria-label="Invoice sections">{(['details','items','branding'] as const).map(t=><Button key={t} size="sm" variant={tab===t?'default':'outline'} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t==='items'?'Line items':t==='branding'?'Branding':'Details'}</Button>)}</div>
    {tab==='details'&&<div className="invoice-fields"><div><label>Project title *<Input value={details.invoiceTitle} readOnly aria-describedby="invoice-project-title-note" /></label><p id="invoice-project-title-note" className="text-xs text-muted-foreground mt-2">* Automatically uses this project's title.</p></div>{field('Invoice number (blank for automatic)','invoiceNumber')}
      <div className="invoice-two-fields">{field('Invoice date','invoiceDate','date')}{field('Due date','dueDate','date')}</div>{field('Reference / purchase order','purchaseOrder')}
      <label>Client name<Input value={clientName} onChange={e=>setClientName(e.target.value)}/></label><label>Client billing email<Input type="email" value={clientEmail} onChange={e=>setClientEmail(e.target.value)}/></label>
      {field('Client address','clientAddress','text',true)}<label>Notes<Textarea value={notes} rows={4} onChange={e=>setNotes(e.target.value)}/></label></div>}
    {tab==='items'&&<div className="invoice-fields">{accepted&&<p className="text-sm">Agreed total: <strong>{money(accepted.totalPence)}</strong>. You can adjust descriptions and itemisation within the agreed price and VAT.</p>}
      {items.map((item,i)=><fieldset key={i} className="border rounded-lg p-3 space-y-3"><legend className="px-1 text-sm font-semibold">Item {i+1}</legend><label>Description<Textarea value={item.description} onChange={e=>update(i,{description:e.target.value})}/></label><div className="invoice-two-fields"><label>Quantity<Input type="number" min="0.01" step="any" value={item.quantity} onChange={e=>update(i,{quantity:e.target.value})}/></label><label>Unit price (£)<Input type="number" min="0" step="0.01" value={item.price} onChange={e=>update(i,{price:e.target.value})}/></label></div>
        <div className="flex gap-2"><Button variant="outline" size="sm" aria-label={`Move item ${i+1} up`} disabled={i===0} onClick={()=>move(i,-1)}>↑</Button><Button variant="outline" size="sm" aria-label={`Move item ${i+1} down`} disabled={i===items.length-1} onClick={()=>move(i,1)}>↓</Button><Button variant="outline" size="sm" aria-label={`Remove item ${i+1}`} disabled={items.length===1} onClick={()=>setItems(items.filter((_,j)=>i!==j))}>Remove</Button></div></fieldset>)}
      <Button variant="outline" disabled={items.length>=100} onClick={()=>setItems([...items,{description:'',quantity:'1',price:''}])}>Add line item</Button><label>VAT (%)<Input type="number" min="0" max="100" step="any" value={vat} onChange={e=>setVat(e.target.value)}/></label></div>}
    {tab==='branding'&&<InvoiceBrandingFields value={branding} onChange={setBranding} onUploadBusy={setUploadBusy}/>}
    {validation&&<p className="text-sm text-muted-foreground mt-4" role="status">{validation}</p>}{error&&<p role="alert" className="invoice-editor-error">{error}</p>}
    </div><div className="invoice-editor-preview"><h3>Live preview</h3><InvoiceDocument invoice={preview} presentation={presentation} preview/></div></div>
    <div className="invoice-editor-footer"><Button variant="outline" onClick={props.onClose} disabled={sending}>Cancel</Button><Button onClick={send} disabled={sending||uploadBusy||!!validation}>{sending?'Sending…':'Send invoice'}</Button></div></>;
}
