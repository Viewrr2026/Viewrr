import { useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { calculateEstimate } from '@shared/project-estimate';
const money=(n:number)=>`£${(n/100).toFixed(2)}`;
export default function ProjectEstimate({projectId,userId}:{projectId:number;userId:number}) {
  const qc=useQueryClient(),key=['project-estimates',projectId];
  const {data,error:loadError}=useQuery<any>({queryKey:key,queryFn:async()=>(await apiRequest('GET',`/api/projects/${projectId}/estimates`)).json()});
  const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[feedback,setFeedback]=useState('');
  const [items,setItems]=useState([{description:'',quantity:1,unitPricePence:0}]),[vat,setVat]=useState(0),[notes,setNotes]=useState('');
  const latest=data?.versions?.[0];
  async function save(action?:string) {
    setBusy(true);setError('');
    try {
      await apiRequest('POST',`/api/projects/${projectId}/estimates${action?'/review':''}`,action?{version:latest.version,action,feedback}:{...calculateEstimate({lineItems:items,vatPercent:vat,notes}),expectedVersion:latest?.version??0});
      setEditing(false);qc.invalidateQueries({queryKey:key});
    }catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  if(loadError) return <p role="alert" className="text-sm p-3">Unable to load the project estimate. Refresh before changing invoice terms.</p>;
  if(!data)return null;
  return <section className="border rounded-xl p-4 mb-5 space-y-3" aria-label="Project estimate">
    <div className="flex justify-between gap-3"><h3 className="font-semibold">Provisional invoice / estimate</h3>{latest&&<strong>{money(latest.snapshot.totalPence)}</strong>}</div>
    <p className="text-xs text-muted-foreground">Agree the amount before work starts. This estimate is not payable. Any extra work needs an agreed revision before the freelancer issues the final invoice.</p>
    {latest&&<><p className="text-sm">Version {latest.version} · {latest.status.replaceAll('_',' ')}</p><ul className="text-sm space-y-1">{latest.snapshot.lineItems.map((i:any,n:number)=><li key={n} className="flex justify-between gap-3"><span>{i.quantity} × {i.description}</span><span>{money(i.totalPence)}</span></li>)}</ul>{latest.snapshot.vatPence>0&&<p className="text-sm">VAT: {money(latest.snapshot.vatPence)}</p>}{latest.feedback&&<p className="text-sm whitespace-pre-wrap">Feedback: {latest.feedback}</p>}</>}
    {!latest&&<p className="text-sm">No estimate has been shared yet.</p>}
    {editing?<form className="space-y-3" onSubmit={e=>{e.preventDefault();save();}}>
      {items.map((i,n)=><div key={n} className="grid grid-cols-6 gap-2">
        <input required aria-label="Item description" placeholder="Work / deliverable" className="col-span-3 border rounded p-2 min-w-0 bg-background" value={i.description} onChange={e=>setItems(items.map((v,j)=>j===n?{...v,description:e.target.value}:v))}/>
        <input required aria-label="Quantity" type="number" min="0.01" step="0.01" className="col-span-1 border rounded p-2 min-w-0 bg-background" value={i.quantity} onChange={e=>setItems(items.map((v,j)=>j===n?{...v,quantity:Number(e.target.value)}:v))}/>
        <input required aria-label="Unit price GBP" type="number" min="0" step="0.01" className="col-span-2 border rounded p-2 min-w-0 bg-background" value={i.unitPricePence/100} onChange={e=>setItems(items.map((v,j)=>j===n?{...v,unitPricePence:Math.round(Number(e.target.value)*100)}:v))}/>
        {items.length>1&&<button type="button" className="text-xs underline col-span-6 text-left" onClick={()=>setItems(items.filter((_,j)=>j!==n))}>Remove item</button>}
      </div>)}
      <button type="button" className="text-sm underline" onClick={()=>setItems([...items,{description:'',quantity:1,unitPricePence:0}])}>Add item</button>
      <label className="block text-sm">VAT % <input type="number" min="0" max="100" step="0.01" className="border rounded p-2 w-24 bg-background" value={vat} onChange={e=>setVat(Number(e.target.value))}/></label>
      <textarea aria-label="Estimate notes" placeholder="Scope, payment terms or reason for this revision" className="w-full border rounded p-2 bg-background" value={notes} onChange={e=>setNotes(e.target.value)}/>
      <div className="flex gap-3"><button disabled={busy} className="bg-orange-600 text-white rounded px-3 py-2">Send estimate for agreement</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>Cancel</button></div>
    </form>:!data.invoiced&&<button className="text-sm underline" onClick={()=>{setItems(latest?.snapshot.lineItems??[{description:'',quantity:1,unitPricePence:0}]);setVat(latest?.snapshot.vatPercent??0);setNotes(latest?.snapshot.notes??'');setEditing(true);}}>{latest?'Propose revised estimate':'Create estimate'}</button>}
    {latest?.status==='pending'&&latest.proposed_by!==userId&&!editing&&<div className="space-y-2">
      <textarea aria-label="Estimate feedback" placeholder="Requested changes" className="w-full border rounded p-2 bg-background" value={feedback} onChange={e=>setFeedback(e.target.value)}/>
      <div className="flex flex-wrap gap-3 text-sm"><button className="bg-orange-600 text-white rounded px-3 py-2" disabled={busy} onClick={()=>save('accept')}>Accept estimate</button><button disabled={busy||!feedback.trim()} onClick={()=>save('request_changes')}>Request changes</button><button disabled={busy} onClick={()=>save('decline')}>Decline</button></div>
    </div>}
    {data.invoiced&&<a className="block text-sm underline" href={`#/invoice/${projectId}`}>View final invoice and refund history</a>}
    {data.versions.length>1&&<details><summary className="cursor-pointer text-sm">Estimate history</summary>{data.versions.slice(1).map((v:any)=><div key={v.id} className="border-t py-2 text-sm"><p>Version {v.version} · {v.status} · {money(v.snapshot.totalPence)}</p><p className="whitespace-pre-wrap">{v.snapshot.notes}</p>{v.snapshot.lineItems.map((i:any,n:number)=><p key={n}>{i.quantity} × {i.description} · {money(i.totalPence)}</p>)}</div>)}</details>}
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>;
}
