import {Button} from './components/ui/button';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from './components/ui/collapsible';
import React from 'react';
import {useDisclosure,type DisclosureScope} from './activity-disclosures';
import {ChevronRightIcon} from 'lucide-react';
import {actionDescription,actionDuration,actionStatus} from '../js/tool-presentation.js';
// Disclosure rows read as transcript text, not centered buttons; utilities override Button geometry.
export const toolTrigger='tool-trigger h-auto min-h-6 w-full items-start justify-start gap-1.5 whitespace-normal rounded-md px-1 py-0.5 text-left text-xs font-normal text-inherit';
// Saved run lifecycle states, plus legacy presentation aliases; not actionability authority.
export function toolRunActive(state:unknown):boolean {
    return typeof state==='string'&&['accepted','running','awaiting_decision','cancel_requested','starting','cancelling'].includes(state);
}
export type ToolEntry={key:string;call?:any;request?:any;result?:any;ambiguous?:boolean};
export type ThreadRow={key:string;message?:any;entries?:ToolEntry[]};
function presentedCalls(message:any):any[]{
    if(message.tool_calls?.length)return message.tool_calls;
    const calls=message.tool_call_summaries;
    if(message.role!=='assistant'||message.projection_truncated!==true||message.tool_call_summaries_complete!==true||!Array.isArray(calls)||calls.length>64)return [];
    if(calls.some(call=>typeof call.id!=='string'||!call.id||call.id.length>128||typeof call.name!=='string'||!call.name||call.name.length>128)||new Set(calls.map(call=>call.id)).size!==calls.length)return [];
    return calls.map(call=>({id:call.id,name:call.name,summary_only:true}));
}
export function threadRows(messages:any[]):ThreadRow[]{
    const calls=new Set(messages.flatMap(message=>presentedCalls(message).map((call:any)=>call.id)).filter(Boolean));
    const identities=messages.flatMap(message=>presentedCalls(message).map((call:any)=>call.id));
    const duplicated=new Set(identities.filter((id,index)=>identities.indexOf(id)!==index));
    const resultIds=messages.filter(message=>['tool','function'].includes(message.role)).map(message=>message.tool_call_id);
    resultIds.forEach((id,index)=>{if(resultIds.indexOf(id)!==index)duplicated.add(id);});
    const results=new Map(messages.filter(message=>['tool','function'].includes(message.role)&&message.tool_call_id).map(message=>[message.tool_call_id,message]));
    const rows:ThreadRow[]=[];let group:ThreadRow|undefined;
    messages.forEach((message,index)=>{
        if(message.role==='system')return;
        const key=String(message.message_index??index),result=['tool','function'].includes(message.role);
        if(result&&calls.has(message.tool_call_id))return;
        const text=message.parts?.some((part:any)=>part.type==='image'||(part.type==='text'&&part.text?.trim()))||String(message.content||'').trim();
        if(!result&&(!presentedCalls(message).length||text)){rows.push({key:`message:${key}`,message});group=undefined;}
        if(!result&&!presentedCalls(message).length)return;
        if(!group){group={key:`tools:${key}`,entries:[]};rows.push(group);}
        if(presentedCalls(message).length)presentedCalls(message).forEach((call:any,i:number)=>group!.entries!.push({key:call.id||`${key}:${i}`,call,request:message,result:results.get(call.id),...(duplicated.has(call.id)?{ambiguous:true}:{})}));
        else group.entries!.push({key:`result:${key}`,result:message});
    });
    return rows;
}
function Entry({entry,running,messageStart,decisions,renderMessage,scope}:{scope?:DisclosureScope;entry:ToolEntry;running:boolean;messageStart:number;decisions:boolean;renderMessage:(message:any)=>React.ReactNode}){
    const [open,setOpen]=useDisclosure(scope,`entry:${entry.key}`);
    const active=running&&Number.isSafeInteger(messageStart)&&entry.request?.message_index>=messageStart;
    const status=actionStatus(entry.call||{},entry.result,active,decisions);
    const label=[status,actionDuration(entry.result),entry.call?actionDescription(entry.call):entry.result?.name||'Tool result'].filter(Boolean).join(' · ');
    const args=entry.call?.function?.arguments??entry.call?.arguments;
    return <Collapsible className="tool-entry" open={open} onOpenChange={setOpen} data-tool-id={entry.key}><CollapsibleTrigger asChild><Button variant="ghost" className={toolTrigger} type="button"><ChevronRightIcon className="tool-chevron" aria-hidden="true"/><span className="tool-summary-text">{label}</span></Button></CollapsibleTrigger><CollapsibleContent><div className="tool-body">{args!=null&&<pre>{typeof args==='string'?args:JSON.stringify(args,null,2)}</pre>}{entry.request?.projection_truncated&&renderMessage({...entry.request,content:'',parts:[],tool_calls:[]})}{entry.result&&renderMessage(entry.result)}</div></CollapsibleContent></Collapsible>;
}
export function activitySummary(entries:ToolEntry[],running:boolean,messageStart:number,decisions:boolean){
    const counts=new Map<string,number>();
    const categories:Record<string,string>={shell:'command',write_file:'file edit',apply_patch:'file edit',read_file:'file read',search_files:'search',list_directory:'directory listing',host_browser:'browser action',process:'process'};
    let failed=0,pending=0,completed=0,totalMs=0,timed=0;
    for(const entry of entries){
        const name=entry.call?.function?.name||entry.call?.name||entry.result?.name||'tool action';
        const category=categories[name]||name.replaceAll('_',' ');
        counts.set(category,(counts.get(category)||0)+1);
        const active=running&&Number.isSafeInteger(messageStart)&&entry.request?.message_index>=messageStart;
        const status=actionStatus(entry.call||{},entry.result,active,decisions);
        if(/^(Failed|Refused|Approval denied|Approval expired|Approval invalidated|Approval unavailable|Cancelled|Command failed|Command signalled|Execution error)/.test(status))failed++;
        else if(['Unconfirmed','Working','Awaiting approval'].includes(status))pending++;
        else completed++;
        const elapsed=entry.result?.tool_outcome?.elapsed_ms;
        if(Number.isFinite(elapsed)&&elapsed>=0){totalMs+=elapsed;timed++;}
    }
    const kinds=[...counts].map(([name,count])=>`${count} ${name}${count===1?'':name==='process'?'es':'s'}`).join(' · ');
    const outcomes=[completed&&`${completed} returned`,failed&&`${failed} unsuccessful action${failed===1?'':'s'}`,pending&&`${pending} ${running?'pending':'unconfirmed'}`].filter(Boolean).join(' · ');
    const timing=timed?`${actionDuration({tool_outcome:{elapsed_ms:totalMs}})} tool time${timed<entries.length?' (partial)':''}`:'';
    return {kinds,outcomes,timing,failed,pending,completed};
}
export function ToolGroup({entries,running,messageStart,decisions,renderMessage,scope,groupKey}:{scope?:DisclosureScope;groupKey?:string;entries:ToolEntry[];running:boolean;messageStart:number;decisions:boolean;renderMessage:(message:any)=>React.ReactNode}){
    const [open,setOpen]=useDisclosure(scope,groupKey||`group:${entries[0]?.key}`);
    const {kinds,timing,failed,pending,completed}=activitySummary(entries,running,messageStart,decisions);
    return <section className="tool-group" aria-label="Tool actions" title="Tool time sums recorded action durations and may overlap. Unsuccessful actions do not mean the run failed."><Button variant="ghost" type="button" className="tool-group-heading h-auto min-h-7 w-full items-start justify-start gap-2 whitespace-normal px-1 text-left text-xs text-muted-foreground" aria-expanded={open} onClick={()=>setOpen(!open)}><ChevronRightIcon className={`size-3.5 shrink-0 ${open?'rotate-90':''}`}  aria-hidden="true"/><span className="min-w-0 flex-1 break-words">{kinds}{timing&&` · ${timing}`}</span><span className="flex min-w-0 max-w-[45%] flex-wrap justify-end gap-x-2 gap-y-1 text-right">{completed>0&&<span>{completed} returned</span>}{failed>0&&<span className="text-destructive">{failed} unsuccessful action{failed===1?'':'s'}</span>}{pending>0&&<span>{pending} {running?'pending':'unconfirmed'}</span>}</span></Button>{open&&<div className="grid gap-1 border-l pl-2">{entries.map(entry=><Entry key={entry.key} scope={scope} entry={entry} running={running} messageStart={messageStart} decisions={decisions} renderMessage={renderMessage}/>)}</div>}</section>;
}
