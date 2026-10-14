import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/queryClient';
export function MediaUpload({scope='portfolio', projectId, retainerId, taskId, onUploaded, imagesOnly=false}: {scope?: 'feed'|'portfolio'|'profile'|'delivery'|'cycle'; projectId?:number; retainerId?:string; taskId?:string; imagesOnly?:boolean; onUploaded:(url:string,mime:string)=>void}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState<number|null>(null);
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
    setBusy(true);setFailed(null);setMessage('Uploading…');
    try {
      const max=(scope==='delivery'||scope==='cycle')?200:scope==='profile'?5:50;
      if(file.size>max*1024*1024)throw new Error(`Maximum file size is ${max} MB.`);
      const form=new FormData();form.append('file',file);
      const response=await fetch(`/api/media/upload/${scope}${scope==='cycle' ? `?retainerId=${encodeURIComponent(retainerId!)}&taskId=${encodeURIComponent(taskId!)}` : projectId ? `?projectId=${projectId}` : ''}`,{method:'POST',credentials:'include',body:form});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Upload failed. Please retry.');
      await wait(result.id);
    }catch(e:any){setMessage(e.message);}finally{if(mounted.current)setBusy(false);}
  }
  return <div className="space-y-2 text-xs">
    <label className="block font-medium">Upload {imagesOnly?'image':'image or video'}
      <input aria-label="Upload file" type="file" disabled={busy} accept={imagesOnly?'image/jpeg,image/png,image/webp':'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm'} className="block w-full mt-2" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void select(f);}} />
    </label>
    <p className="text-muted-foreground">{(scope==='delivery'||scope==='cycle')?'The client can review a watermarked preview; the original requires verified payment.':'Uploads here are public media for your profile or posts.'}</p>
    {message&&<p role="status">{message}</p>}
    {failed&&!busy&&<button type="button" className="underline" onClick={async()=>{setBusy(true);try{await apiRequest('POST',`/api/media/retry/${failed}`,{});await wait(failed);}catch(e:any){setMessage(e.message);}finally{setBusy(false);}}}>Retry processing</button>}
  </div>;
}
