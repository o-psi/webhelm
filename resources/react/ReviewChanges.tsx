import React,{useState} from 'react';
import {Button} from './components/ui/button';
import {actionStatus} from '../js/tool-presentation.js';
import {LiveInspection} from './LiveInspection';
import {WorkspaceChanges} from './WorkspaceChanges';
import type {Tab,Workspace} from './workspace';

type Change={key:string;path:string;kind:string;status:string;preview:string;truncated:boolean};
export function PatchPreview({source}:{source:string}){
    const lines=source.split('\n');
    if(lines.length>2000)return <pre className="overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre" aria-label="Recorded patch request">{source}</pre>;
    return <pre className="overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre" aria-label="Recorded patch request">{lines.map((line,index)=>{
        const kind=/^(?:\+\+\+|---|@@|\*\*\*)/.test(line)?'heading':line.startsWith('+')?'added':line.startsWith('-')?'removed':'';
        return <span key={index} className={kind?`diff-${kind}`:undefined}>{line}{index<lines.length-1?'\n':''}</span>;
    })}</pre>;
}
export function recordedChanges(messages:any[]):Change[]{
    const results=new Map(messages.filter(message=>['tool','function'].includes(message.role)&&message.tool_call_id).map(message=>[message.tool_call_id,message]));
    const changes:Change[]=[];
    for(const message of messages){
        for(const call of message.tool_calls||[]){
            const name=call.function?.name||call.name;
            if(!['apply_patch','write_file'].includes(name))continue;
            let args=call.function?.arguments??call.arguments??{};
            if(typeof args==='string'){try{args=JSON.parse(args);}catch{args={};}}
            const source=name==='apply_patch'?String(args.patch||''):String(args.content||'');
            const file=source.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m)?.[1]||source.match(/^\+\+\+ b\/(.+)$/m)?.[1];
            const path=typeof args.path==='string'&&args.path?args.path:file||'Path not recorded';
            changes.push({key:String(call.id||`${message.message_index}:${changes.length}`),path,kind:name==='apply_patch'?'Patch':'File write',status:actionStatus(call,results.get(call.id),false,false),preview:source.slice(0,65536),truncated:source.length>65536});
            if(changes.length>=128)return changes;
        }
    }
    return changes;
}

export function ReviewChanges({tab,workspace}:{tab:Tab;workspace:Workspace}){
    const [view,setView]=useState<'workspace'|'recorded'>('workspace');
    const [selected,setSelected]=useState<string|null>(null),[loading,setLoading]=useState(false);
    const changes=recordedChanges(tab.snapshot?.messages||[]);
    const current=changes.find(change=>change.key===selected)||changes.at(-1);
    return <div className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Recorded changes">
        <div className="flex gap-1 border-b px-3 py-2"><Button variant={view==='workspace'?'secondary':'ghost'} size="sm" type="button" aria-pressed={view==='workspace'} onClick={()=>setView('workspace')}>Workspace</Button><Button variant={view==='recorded'?'secondary':'ghost'} size="sm" type="button" aria-pressed={view==='recorded'} onClick={()=>setView('recorded')}>Recorded edits</Button></div>
        {view==='workspace'?<><WorkspaceChanges tab={tab} workspace={workspace}/><details className="border-t p-3 text-sm"><summary>Inspect workspace explicitly</summary><LiveInspection tab={tab} workspace={workspace}/></details></>:<><p className="m-0 border-b px-4 py-3 text-xs text-muted-foreground">Recorded file tool requests in loaded history. Files may have changed since; this is not a live diff.</p>
        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(130px,35%)_minmax(0,1fr)]">
            <div className="max-h-44 min-h-0 overflow-auto border-b p-2 lg:max-h-none lg:border-r lg:border-b-0" aria-label="Recorded file edits">{changes.length?changes.map(change=><Button key={change.key} variant={current?.key===change.key?'secondary':'ghost'} type="button" className="mb-1 h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-2 py-2 text-left" aria-pressed={current?.key===change.key} onClick={()=>setSelected(change.key)}><span className="w-full truncate font-medium" title={change.path}>{change.path}</span><small className="text-muted-foreground">{change.kind} · {change.status}</small></Button>):<p className="p-2 text-sm text-muted-foreground">No file edit requests appear in the loaded conversation.</p>}
                {Boolean(tab.snapshot?.message_offset)&&<Button variant="outline" size="sm" type="button" className="mt-2 w-full" disabled={loading||tab.busy} onClick={()=>{setLoading(true);void workspace.earlier(tab.key).finally(()=>setLoading(false));}}>{loading?'Loading…':'Load earlier history'}</Button>}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">{current?<><h3 className="mb-1 break-all text-sm font-medium">{current.path}</h3><p className="text-xs text-muted-foreground">{current.kind} request · {current.status}</p>{current.preview?<PatchPreview source={current.preview}/>:<p className="text-sm text-muted-foreground">Content was not included in this projection.</p>}{current.truncated&&<p className="text-xs text-muted-foreground">Preview limited to 64 KiB.</p>}</>:<p className="text-sm text-muted-foreground">Choose an edit to review its recorded request.</p>}</div>
        </div></>}
    </div>;
}
