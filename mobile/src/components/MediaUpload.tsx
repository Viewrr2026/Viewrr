import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import { request } from '@/api/client';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';
export function MediaUpload({scope='portfolio',projectId,onUploaded,imagesOnly=false,videosOnly=false}: {scope?:'portfolio'|'profile'|'feed'|'delivery';projectId?:number;imagesOnly?:boolean;videosOnly?:boolean;onUploaded:(url:string,mime:string)=>void}) {
  const {colors}=useTheme();const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [failed,setFailed]=useState<number|null>(null);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function wait(id:number) {
    for(let i=0;i<240;i++) {
      if(!mounted.current)return;
      const state=await request<{status:string;url:string;mime:string}>(`/api/media/status/${id}`);
      if(state.status==='ready'){onUploaded(state.url,state.mime);setMessage('File ready.');setFailed(null);return;}
      if(state.status==='media_failed'){setFailed(id);throw new Error('Preview processing failed. The original remains private.');}
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
      const max=scope==='delivery'?200:scope==='profile'?5:50;
      if(!file.mimeType)throw new Error('This file type could not be identified. Choose a JPEG, PNG, WebP, MP4, MOV or WebM.');
      if(!file.size || file.size>max*1024*1024)throw new Error(`Choose a file under ${max} MB.`);
      setMessage('Uploading…');const body=new FormData();body.append('file',{uri:file.uri,name:file.name,type:file.mimeType} as any);
      const uploaded=await request<{id:number}>(`/api/media/upload/${scope}`,{method:'POST',body,query:{projectId},timeoutMs:180000});
      await wait(uploaded.id);
    }catch(e){setMessage(e instanceof Error?e.message:'Upload failed. Please retry.');}finally{setBusy(false);}
  }
  return <View style={{gap:8}}><Button label={busy?'Uploading / processing…':imagesOnly?'Choose photo':videosOnly?'Choose video':'Choose photo or video'} loading={busy} disabled={busy} onPress={()=>void pick("photos")} />
    <Button label="Choose from Files" disabled={busy} onPress={()=>void pick("files")} />
    <Text style={{color:colors.mutedForeground}}>{scope==='delivery'?'Watermarked preview for review; original released after verified payment.':'Public media for your profile or post.'}</Text>
    {!!message&&<Text accessibilityLiveRegion="polite" style={{color:colors.foreground}}>{message}</Text>}
    {failed&&!busy&&<Button label="Retry processing" onPress={async()=>{setBusy(true);try{await request(`/api/media/retry/${failed}`,{method:'POST',body:{}});await wait(failed);}catch(e){setMessage(String(e));}finally{setBusy(false);}}} />}
  </View>;
}
