import { apiRequest } from './queryClient';
/** Server upload keeps bucket credentials and R2 signing out of the browser. */
export async function uploadPublicImage(file: File): Promise<string> {
  const form=new FormData();form.append('file',file);
  const response=await fetch('/api/media/upload/profile',{method:'POST',credentials:'include',body:form});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error || 'Upload failed');
  for(let attempt=0;attempt<120;attempt++){
    const state=await(await apiRequest('GET',`/api/media/status/${result.id}`)).json();
    if(state.status==='ready')return state.url;
    if(state.status==='media_failed')throw new Error('Image processing failed. Please retry.');
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error('Processing is taking longer than expected. Please retry shortly.');
}
