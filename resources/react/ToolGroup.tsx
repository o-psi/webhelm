import {Button} from './components/ui/button';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from './components/ui/collapsible';
import React,{useState} from 'react';
import {ChevronRightIcon} from 'lucide-react';
import {actionDescription,actionDuration,actionStatus} from '../js/tool-presentation.js';
// Disclosure rows read as transcript text, not centered buttons; utilities override Button geometry.
export const toolTrigger='tool-trigger h-auto min-h-6 w-full items-start justify-start gap-1.5 whitespace-normal rounded-md px-1 py-0.5 text-left text-xs font-normal text-inherit';
export type ToolEntry={key:string;call?:any;request?:any;result?:any};
export type ThreadRow={key:string;message?:any;entries?:ToolEntry[]};
export function threadRows(messages:any[]):ThreadRow[]{
    const calls=new Set(messages.flatMap(message=>(message.tool_calls||[]).map((call:any)=>call.id)).filter(Boolean));
    const results=new Map(messages.filter(message=>['tool','function'].includes(message.role)&&message.tool_call_id).map(message=>[message.tool_call_id,message]));
    const rows:ThreadRow[]=[];let group:ThreadRow|undefined;
    messages.forEach((message,index)=>{
        if(message.role==='system')return;
        const key=String(message.message_index??index),result=['tool','function'].includes(message.role);
        if(result&&calls.has(message.tool_call_id))return;
        const text=message.parts?.some((part:any)=>part.type==='image'||(part.type==='text'&&part.text?.trim()))||String(message.content||'').trim();
        if(!result&&(!message.tool_calls?.length||text)){rows.push({key:`message:${key}`,message});group=undefined;}
        if(!result&&!message.tool_calls?.length)return;
        if(!group){group={key:`tools:${key}`,entries:[]};rows.push(group);}
        if(message.tool_calls?.length)message.tool_calls.forEach((call:any,i:number)=>group!.entries!.push({key:call.id||`${key}:${i}`,call,request:message,result:results.get(call.id)}));
        else group.entries!.push({key:`result:${key}`,result:message});
    });
    return rows;
}
function Entry({entry,running,messageStart,decisions,renderMessage}:{entry:ToolEntry;running:boolean;messageStart:number;decisions:boolean;renderMessage:(message:any)=>React.ReactNode}){
    const [open,setOpen]=useState(false);
    const active=running&&Number.isSafeInteger(messageStart)&&entry.request?.message_index>=messageStart;
    const status=actionStatus(entry.call||{},entry.result,active,decisions);
    const label=[status,actionDuration(entry.result),entry.call?actionDescription(entry.call):entry.result?.name||'Tool result'].filter(Boolean).join(' · ');
    const args=entry.call?.function?.arguments??entry.call?.arguments;
    return <Collapsible className="tool-entry" open={open} onOpenChange={setOpen} data-tool-id={entry.key}><CollapsibleTrigger asChild><Button variant="ghost" className={toolTrigger} type="button"><ChevronRightIcon className="tool-chevron" aria-hidden="true"/><span className="tool-summary-text">{label}</span></Button></CollapsibleTrigger><CollapsibleContent><div className="tool-body">{args!=null&&<pre>{typeof args==='string'?args:JSON.stringify(args,null,2)}</pre>}{entry.request?.projection_truncated&&renderMessage({...entry.request,content:'',parts:[],tool_calls:[]})}{entry.result&&renderMessage(entry.result)}</div></CollapsibleContent></Collapsible>;
}
export function ToolGroup({entries,running,messageStart,decisions,renderMessage}:{entries:ToolEntry[];running:boolean;messageStart:number;decisions:boolean;renderMessage:(message:any)=>React.ReactNode}){
    const [open,setOpen]=useState(false);
    const category=(entry:ToolEntry)=>{
        const name=entry.call?.function?.name||entry.call?.name;
        return name==='shell'?'command':['write_file','apply_patch'].includes(name)?'edit':name==='read_file'?'read':name==='search_files'?'search':name==='host_browser'?'browser action':'other action';
    };
    const counts=new Map<string,number>();for(const entry of entries)counts.set(category(entry),(counts.get(category(entry))||0)+1);
    const kinds=[...counts].map(([name,count])=>`${count} ${name}${count===1?'':'s'}`).join(' · ');
    const failed=entries.filter(entry=>/^(Failed|Refused|Approval denied|Approval expired|Approval invalidated|Approval unavailable|Cancelled|Command failed|Execution error)/.test(actionStatus(entry.call||{},entry.result,false,decisions))).length;
    const pending=entries.filter(entry=>!entry.result).length;
    const outcome=failed?`${failed} failed`:pending?`${pending} ${running?'working':'unconfirmed'}`:`${entries.length} recorded`;
    return <section className="tool-group" aria-label="Tool actions"><Button variant="ghost" type="button" className="tool-group-heading h-auto min-h-7 w-full justify-start gap-2 px-1 text-left text-xs text-muted-foreground" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><ChevronRightIcon className={`size-3.5 ${open?'rotate-90':''}`} aria-hidden="true"/><span className="min-w-0 flex-1 truncate">{kinds}</span><span className={failed?'text-destructive':''}>{outcome}</span></Button>{open&&<div className="grid gap-1 border-l pl-2">{entries.map(entry=><Entry key={entry.key} entry={entry} running={running} messageStart={messageStart} decisions={decisions} renderMessage={renderMessage}/>)}</div>}</section>;
}
