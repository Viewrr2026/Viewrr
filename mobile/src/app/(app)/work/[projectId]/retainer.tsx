import { canUploadRetainer } from "@/components/work/retainerUploadPolicy";
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import { request } from '@/api/client';
import { ApiError } from '@/api/errors';
import { AppHeader } from '@/components/AppHeader';
import { Screen } from '@/components/Screen';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { MediaUpload } from '@/components/MediaUpload';
import { useSession } from '@/session/SessionProvider';
import { useTheme } from '@/theme';

const message=(error:unknown)=>error instanceof ApiError?error.userMessage:'Unable to complete this action. Please retry.';
type Snapshot={publicId:string;custom:boolean;data:any;submissions:any[];updates:any[]};
export default function RetainerDeliveries() {
  const {projectId}=useLocalSearchParams<{projectId:string}>();
  const {user}=useSession();const {colors}=useTheme();
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState('');
  const load=useCallback(async()=>{
    const agreement=await request<{publicId:string}>(`/api/projects/${projectId}/retainer-agreement`);
    if(!agreement?.publicId)throw new Error('No agreement');
    const workspace=await request<any>(`/api/retainer/${agreement.publicId}/workspace`);
    const custom=workspace.agreement.workflow_version===1;
    const data=custom?await request<any>(`/api/custom-retainers/${agreement.publicId}`):workspace;
    const submissions=custom?data.submissions:await request<any[]>(`/api/retainer/${agreement.publicId}/submissions`);
    const updates=custom?[]:await request<any[]>(`/api/retainer/${agreement.publicId}/stage-updates`);
    return {publicId:agreement.publicId,custom,data,submissions,updates};
  },[projectId]);
  useFocusEffect(useCallback(()=>{
    let active=true,running=false;
    setSnapshot(null);setError('');
    const refresh=async()=>{if(running)return;running=true;try{const data=await load();if(active){setSnapshot(data);setError('');}}catch(e){if(active)setError(message(e));}finally{running=false;}};
    void refresh();const timer=setInterval(()=>void refresh(),5000);
    return()=>{active=false;clearInterval(timer);};
  },[load]));
  const refresh=async()=>{try{setSnapshot(await load());setError('');}catch(e){setError(message(e));}};
  const cycles=snapshot?.data.cycles??[];
  return <Screen scroll><AppHeader title="Retainer deliveries" back />
    {!!error&&<Text accessibilityRole="alert" style={{color:colors.destructive}}>{error}</Text>}
    {!snapshot?<Button label="Reload deliveries" onPress={()=>void refresh()} />: <View style={{gap:16,padding:16}}>
      <Text style={{color:colors.mutedForeground}}>Upload work for each cycle. Clients receive a watermarked preview; original access follows the cycle’s approval and payment rules.</Text>
      {cycles.map((cycle:any)=>{
        const tasks=snapshot.data.tasks.filter((t:any)=>(t.retainer_cycle_id??t.retainerCycleId)===cycle.id);
        return <View key={cycle.id} style={{gap:12}}><Text style={{color:colors.foreground,fontSize:20,fontWeight:'700'}}>Cycle {cycle.cycle_number??cycle.cycleNumber}: {cycle.cycle_name??cycle.status}</Text>
          {tasks.map((task:any)=><WorkItem key={task.id} snapshot={snapshot} cycle={cycle} task={task} userId={user?.id} refresh={refresh} />)}
          {!tasks.length&&<Text style={{color:colors.mutedForeground}}>No work items in this cycle.</Text>}
        </View>;
      })}
      {!cycles.length&&<Text style={{color:colors.mutedForeground}}>No cycles yet. Accept the agreement on the website to begin.</Text>}
    </View>}
  </Screen>;
}
function WorkItem({snapshot,cycle,task,userId,refresh}:{snapshot:Snapshot;cycle:any;task:any;userId?:number;refresh:()=>Promise<void>}) {
  const {colors}=useTheme();const {custom,data,publicId}=snapshot;
  const [note,setNote]=useState(''),[file,setFile]=useState(''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[error,setError]=useState('');
  const taskId=task.public_id??task.publicId;
  const freelancer=userId===(custom?data.freelancerId:data.agreement.freelancerUserId);
  const subs=snapshot.submissions.filter((s:any)=>custom?s.retainer_cycle_task_id===task.id:s.taskPublicId===taskId).sort((a:any,b:any)=>Number(b.version)-Number(a.version));
  const latest=subs[0];
  const canWork=custom?cycle.canWork:['active','due','awaiting_payment'].includes(cycle.status);
  const editable=canUploadRetainer(freelancer,Boolean(canWork),task.status,latest?.status);
  const final=Number(task.stageIndex??task.stage_index??0)>=Math.max(0,(task.stages?.length??1)-1);
  const media=custom?(data.media??[]).filter((m:any)=>m.task_id===task.id):[];
  async function run(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError(message(e));}finally{setBusy(false);}}
  async function open(reference:string,original=false){
    if(custom){const result=await request<{url:string}>(`/api/custom-retainers/${publicId}/media/${reference}`,{query:{original:original?'true':'false'}});await Linking.openURL(result.url);}
    else if(reference.startsWith('/api/media/')){const path=original?reference:reference.replace('/original.','/preview.');const result=await request<{url:string}>(path,{query:{resolve:1}});await Linking.openURL(result.url);}
    else if(/^https?:\/\//i.test(reference))await Linking.openURL(reference);
  }
  return <Card><View style={{gap:12}}>
    <Text style={{color:colors.foreground,fontWeight:'700'}}>{task.title??task.name??`Work item ${task.item_number??task.id}`}</Text>
    {!custom&&<Text style={{color:colors.mutedForeground}}>Stage: {task.stages?.[Number(task.stageIndex??task.stage_index??0)]??"Not configured"}</Text>}
    <Text style={{color:colors.mutedForeground}}>{task.status.replaceAll('_',' ')}</Text>
    {!!error&&<Text accessibilityRole="alert" style={{color:colors.destructive}}>{error}</Text>}
    {editable&&<>
      {(!custom||data.protectedUploadsEnabled)?<MediaUpload scope={custom?'custom':'cycle'} retainerId={publicId} taskId={taskId} onBusyChange={setUploading} onUploaded={value=>{setFile(value);void refresh();}} />:<Text style={{color:colors.mutedForeground}}>Protected uploads are not enabled for this retainer.</Text>}
      {media.map((m:any)=><View key={m.id} style={{gap:6}}><Text style={{color:colors.foreground}}>{m.filename} — {m.status}</Text>
        {m.status==='ready'?<Button label={file===m.id?'File selected':'Select file'} disabled={busy||uploading} onPress={()=>setFile(m.id)} />:m.status==='failed'?<Button label="Retry preview" disabled={busy||uploading} onPress={()=>void run(()=>request(`/api/custom-retainers/${publicId}/media/${m.id}/retry`,{method:'POST',body:{}}))}/>:null}
      </View>)}
      <TextInput accessibilityLabel="Submission note" placeholder="Describe the work you are sharing" placeholderTextColor={colors.mutedForeground} value={note} onChangeText={setNote} maxLength={5000} multiline style={{color:colors.foreground,borderColor:colors.border,borderWidth:1,borderRadius:10,padding:12,minHeight:80}} />
      <Button label={!custom&&!final?'Share progress and advance stage':'Submit for client review'} disabled={busy||uploading||!file||!note.trim()} onPress={()=>void run(async()=>{
        await request(custom?`/api/custom-retainers/${publicId}/tasks/${taskId}/submit`:`/api/retainer/${publicId}/tasks/${taskId}/${final?'submit':'progress'}`,{method:'POST',body:custom?{mediaId:file,note}:{deliverableUrl:file,note}});
        setFile('');setNote('');
      })}/>
    </>}
    {!editable&&<Text style={{color:colors.mutedForeground}}>{latest?.status==='submitted'?'Submitted for client review.':cycle.reason??'Uploads are available to the freelancer when this work item is open.'}</Text>}
    {subs.map((s:any)=>{
      const reference=custom?s.media_id:s.deliverableUrl;
      return <View key={s.id} style={{gap:8,borderTopWidth:1,borderColor:colors.border,paddingTop:12}}><Text style={{color:colors.foreground}}>Version {s.version} · {s.status}</Text><Text style={{color:colors.mutedForeground}}>{s.note}</Text>
        {!!reference&&<><Button label="Open preview" disabled={busy} onPress={()=>void run(()=>open(reference))}/><Button label="Download original" disabled={busy} onPress={()=>void run(()=>open(reference,true))}/></>}
      </View>;
    })}
    {!custom&&snapshot.updates.filter((u:any)=>u.taskPublicId===taskId).map((u:any)=><View key={u.id} style={{gap:6}}><Text style={{color:colors.foreground}}>{u.stageName}: {u.note}</Text>{!!u.deliverableUrl&&<Button label="Open progress preview" onPress={()=>void run(()=>open(u.deliverableUrl))}/>}</View>)}
  </View></Card>;
}
