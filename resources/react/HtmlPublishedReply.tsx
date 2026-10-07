import React,{useEffect,useState} from 'react';
import {HtmlPreview} from './HtmlPreview';
import type {ToolEntry} from './ToolGroup';
import type {Tab,Workspace} from './workspace';
export type HtmlPublication={artifact:any;title:string;height:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function htmlPublication(entry:ToolEntry):HtmlPublication|null{
    const result=entry.result,call=entry.call;
    if(entry.ambiguous||!Number.isSafeInteger(entry.request?.message_index)||!Number.isSafeInteger(result?.message_index)||result.message_index<=entry.request.message_index||result?.role!=='tool'||entry.request?.role!=='assistant'||(call?.function?.name??call?.name)!=='html_render'||!call?.id||result?.tool_call_id!==call.id||(entry.request?.projection_truncated&&!(call.summary_only===true&&entry.request?.tool_call_summaries_complete===true))||result?.projection_truncated||result?.tool_success!==true||result?.tool_outcome?.execution!=='succeeded'||result?.tool_outcome?.incomplete||result?.tool_output?.is_error!==false)return null;
    const value=result.tool_output.structured_content?.htmlRender,a=value?.artifact;
    if(value?.version!==1||typeof value.title!=='string'||!value.title.trim()||Array.from(value.title).length>100||/[\u0000-\u001f\u007f]/.test(value.title)||!Number.isInteger(value.height)||value.height<180||value.height>640||!uuid.test(a?.id)||! /^[a-f0-9]{64}$/.test(a?.sha256)||a?.mime_type!=='text/html'||a?.name!=='visual-reply.html'||!Number.isSafeInteger(a?.byte_size)||a.byte_size<1||a.byte_size>131072)return null;
    const resource=result.tool_output.content?.find((part:any)=>part.type==='resource'&&part.uri==='artifact:'+a.id&&part.mime_type==='text/html'&&part.text==null&&part.artifact);
    if(!resource||['id','sha256','mime_type','name','byte_size'].some(key=>resource.artifact[key]!==a[key]))return null;
    return value;
}
export function htmlPublications(entries:ToolEntry[]):Map<string,HtmlPublication>{
    const result=new Map<string,HtmlPublication>();let bytes=0;
    for(const entry of entries){const publication=htmlPublication(entry);if(!publication)continue;if(result.size>=6||bytes+publication.artifact.byte_size>262144)continue;bytes+=publication.artifact.byte_size;result.set(entry.key,publication);}
    return result;
}
export function HtmlPublishedReply({publication,identity,allowed,tab,workspace}:{publication:HtmlPublication;identity:string;allowed:boolean;tab:Tab;workspace:Workspace}){
    const [loaded,setLoaded]=useState<{identity:string;source:string}|null>(null),[notice,setNotice]=useState('');
    const a=publication.artifact,loadIdentity=[identity,a.id,a.sha256,a.byte_size].join(':');
    useEffect(()=>{
        let current=true;setLoaded(null);setNotice('');
        if(allowed)workspace.htmlArtifact(tab.key,a).then(html=>{if(current)setLoaded({identity:loadIdentity,source:html});}).catch(error=>{if(current)setNotice(error instanceof Error?error.message:'Visual reply unavailable.');});
        return()=>{current=false;};
    },[allowed,identity,a.id,a.sha256,a.byte_size]);
    if(!allowed)return null;
    return loaded?.identity===loadIdentity?<HtmlPreview source={loaded.source} identity={identity} title={publication.title} height={publication.height}/>:<p role="status" className="text-sm text-muted-foreground">{notice||'Loading visual reply…'}</p>;
}
