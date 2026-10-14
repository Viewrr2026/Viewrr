import { useEffect, useRef, useState } from 'react';
import { UploadCloud, FileCheck2, Loader2, ShieldCheck } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
export function MediaUpload({scope='portfolio', projectId, retainerId, taskId, onUploaded, imagesOnly=false}: {scope?: 'feed'|'portfolio'|'profile'|'delivery'|'cycle'; projectId?:number; retainerId?:string; taskId?:string; imagesOnly?:boolean; onUploaded:(url:string,mime:string)=>void}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState<number|null>(null);
  const [fileName,setFileName]=useState(''),[fileSize,setFileSize]=useState(''),[dragging,setDragging]=useState(false);
  const inputRef=useRef<HTMLInputElement>(null);
  const privateWork=scope==='delivery'||scope==='cycle';
  const max=privateWork?200:scope==='profile'?5:50;
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;};},[]);
  async function wait(id:number) {
    for(let i=0;i<240;i++) {
      if(!mounted.current)return;
      const r=await (await apiRequest('GET',`/api/media/status/${id}`)).json();
      if(r.status==='ready'){onUploaded(r.url,r.mime);setMessage('File uploaded and ready.');setFailed(null);return;}
      if(r.status==='media_failed'){setFailed(id);throw new Error('Preview processing failed. Your original remains private. Retry below.');}
      setMessage('Processing media… Keep this form open until it is ready.');
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
    throw new Error('Processing is taking longer than expected. Please check again shortly.');
  }
  async function select(file:File) {
    setBusy(true);setFailed(null);setMessage('Uploading…');setFileName(file.name);setFileSize(`${(file.size/1024/1024).toFixed(1)} MB`);
    try {
      const max=(scope==='delivery'||scope==='cycle')?200:scope==='profile'?5:50;
      if(file.size>max*1024*1024)throw new Error(`Maximum file size is ${max} MB.`);
      const form=new FormData();form.append('file',file);
      const response=await fetch(`/api/media/upload/${scope}${scope==='cycle' ? `?retainerId=${encodeURIComponent(retainerId!)}&taskId=${encodeURIComponent(taskId!)}` : projectId ? `?projectId=${projectId}` : ''}`,{method:'POST',credentials:'include',body:form});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Upload failed. Please retry.');
      await wait(result.id);
    }catch(e:any){setMessage(e.message);}finally{if(mounted.current)setBusy(false);}
  }
  return <div className="space-y-3 text-xs">
    <div onDragOver={e=>{e.preventDefault();if(!busy)setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!busy&&e.dataTransfer.files[0])void select(e.dataTransfer.files[0]);}}
      className={`relative rounded-xl border-2 border-dashed p-5 text-center transition-colors ${dragging?'border-primary bg-primary/10':'border-primary/25 bg-primary/[0.03]'}`}>
      <input ref={inputRef} aria-label="Upload file" type="file" disabled={busy} accept={imagesOnly?'image/jpeg,image/png,image/webp':'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm'} className="sr-only" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void select(f);}} />
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {busy?<Loader2 size={20} className="animate-spin" />:fileName?<FileCheck2 size={20}/>:<UploadCloud size={20}/>}
      </div>
      <p className="font-semibold text-sm text-foreground break-all">{fileName||`Drop your ${imagesOnly?'image':'image or video'} here`}</p>
      <p className="mt-1 text-muted-foreground">{fileName?fileSize:`${imagesOnly?'JPG, PNG, WebP':'JPG, PNG, WebP, MP4, MOV, WebM'} · Up to ${max} MB`}</p>
      <button type="button" disabled={busy} onClick={()=>inputRef.current?.click()} className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50">
        <UploadCloud size={14}/>{busy?'Processing file…':fileName?'Choose another file':'Choose file'}
      </button>
    </div>
    <p className="flex items-start gap-2 text-muted-foreground leading-relaxed"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-primary"/>{privateWork?'Your client sees a watermarked preview. The original unlocks after verified payment.':'This upload will be public on your profile or post.'}</p>
    {message&&<p role="status" className="rounded-lg bg-secondary/60 px-3 py-2 text-muted-foreground">{message}</p>}
    {failed&&!busy&&<button type="button" className="font-medium text-primary underline" onClick={async()=>{setBusy(true);try{await apiRequest('POST',`/api/media/retry/${failed}`,{});await wait(failed);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Retry processing</button>}
  </div>;
}
