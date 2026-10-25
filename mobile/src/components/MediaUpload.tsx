import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import { request } from '@/api/client';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';
import { uploadLargeMedia, mediaUploadLimitLabel } from '@/lib/uploadLargeMedia';
import { ApiError } from '@/api/errors';
export function MediaUpload({scope='portfolio',projectId,retainerId,taskId,onBusyChange,onUploaded,imagesOnly=false,videosOnly=false}: {scope?:'portfolio'|'profile'|'feed'|'delivery'|'cycle'|'custom';projectId?:number;retainerId?:string;taskId?:string;onBusyChange?:(busy:boolean)=>void;imagesOnly?:boolean;videosOnly?:boolean;onUploaded:(url:string,mime:string)=>void}) {
  const {colors}=useTheme();const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [failed,setFailed]=useState<string|number|null>(null);
  const protectedWork=["delivery","cycle","custom"].includes(scope);
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
  const mounted=useRef(true);
  const uploadController=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;uploadController.current?.abort();};},[]);
  async function wait(id:string|number) {
    for(let i=0;i<240;i++) {
      if(!mounted.current)return;
      const state=scope==='custom'
        ? await request<{media:Array<{id:string;status:string;mime_type:string}>}>(`/api/custom-retainers/${retainerId}`).then(data=>{const media=data.media.find(m=>m.id===id);return {status:media?.status??'queued',url:String(id),mime:media?.mime_type??''};})
        : await request<{status:string;url:string;mime:string}>(`/api/media/status/${id}`);
      if(state.status==='ready'){onUploaded(state.url,state.mime);setMessage('File ready.');setFailed(null);return;}
      if((state.status==='media_failed'||state.status==='failed')){setFailed(id);throw new Error('Preview processing failed. The original remains private.');}
      setMessage('Processing media… Keep this form open.');await new Promise(r=>setTimeout(r,5000));
    }
    throw new Error('Processing is taking longer than expected. Please check again shortly.');
  }
  async function pick(source: "photos" | "files") {
    setBusy(true);setMessage('');setFailed(null);
    try {
      let file: {uri:string;name:string;mimeType?:string;size?:number};
      if(source === "photos") {
        const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:imagesOnly?["images"]:videosOnly?["videos"]:["images","videos"],allowsMultipleSelection:false,quality:1});
        if(result.canceled || !result.assets[0])return;
        const asset=result.assets[0];
        if(asset.type === "image" && !["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType ?? "")) {
          const converted=await ImageManipulator.manipulateAsync(asset.uri,[],{compress:0.9,format:ImageManipulator.SaveFormat.JPEG,base64:true});
          file={uri:converted.uri,name:"photo.jpg",mimeType:"image/jpeg",size:Math.floor((converted.base64?.length??0)*3/4)};
        } else file={uri:asset.uri,name:asset.fileName??(asset.type === "image" ? "photo.jpg" : "video.mov"),mimeType:asset.mimeType??(asset.type === "image" ? "image/jpeg" : "video/quicktime"),size:asset.fileSize};
      } else {
        const result=await DocumentPicker.getDocumentAsync({type:imagesOnly?['image/jpeg','image/png','image/webp']:videosOnly?['video/mp4','video/quicktime','video/webm']:['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'],copyToCacheDirectory:true,multiple:false});
        if(result.canceled || !result.assets[0])return;
        file=result.assets[0];
      }
      uploadController.current=new AbortController();
      setMessage('Uploading…');
      const uploaded=await uploadLargeMedia(file,scope,{projectId,retainerId,taskId},percent=>{if(mounted.current)setMessage(`Uploading… ${percent}%. Keep Viewrr open.`);},uploadController.current.signal);
      uploadController.current=null;
      await wait(uploaded.id);
    }catch(e){if(mounted.current)setMessage(e instanceof ApiError?(e.serverMessage??e.userMessage):e instanceof Error?e.message:'Upload failed. Please retry.');}finally{uploadController.current=null;if(mounted.current)setBusy(false);}
  }
  return <View style={{gap:8}}><Button label={busy?'Uploading / processing…':imagesOnly?'Choose photo':videosOnly?'Choose video':'Choose photo or video'} loading={busy} disabled={busy} onPress={()=>void pick("photos")} />
    <Button label="Choose from Files" disabled={busy} onPress={()=>void pick("files")} />
    <Text style={{color:colors.mutedForeground}}>Up to {mediaUploadLimitLabel(scope)} per file.</Text>
    <Text style={{color:colors.mutedForeground}}>{protectedWork?'Watermarked preview for review; original released after verified payment.':'Public media for your profile or post.'}</Text>
    {!!message&&<Text accessibilityLiveRegion="polite" style={{color:colors.foreground}}>{message}</Text>}
    {busy&&uploadController.current&&<Button label="Cancel upload" onPress={()=>uploadController.current?.abort()} />}
    {failed&&!busy&&<Button label="Retry processing" onPress={async()=>{setBusy(true);try{await request(scope==='custom'?`/api/custom-retainers/${retainerId}/media/${failed}/retry`:`/api/media/retry/${failed}`,{method:'POST',body:{}});await wait(failed);}catch(e){setMessage(String(e));}finally{setBusy(false);}}} />}
  </View>;
}
