import React,{useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {SelectCombobox} from './components/ui/select-combobox';
import type {Tab,Workspace} from './workspace';
import type {InspectionScope} from './inspection-command';

const scopes:{value:InspectionScope;label:string}[]=[
    {value:'status',label:'Changed paths'},
    {value:'unstaged',label:'Unstaged diff'},
    {value:'staged',label:'Staged diff'},
    {value:'untracked',label:'Untracked paths'},
    {value:'directory',label:'Browse directory'},
    {value:'file',label:'Read file'},
];

export function LiveInspection({tab,workspace}:{tab:Tab;workspace:Workspace}){
    const [scope,setScope]=useState<InspectionScope>('status'),[path,setPath]=useState('.');
    const [requesting,setRequesting]=useState(false),[runId,setRunId]=useState<string|null>(null),[result,setResult]=useState(''),[error,setError]=useState('');
    const reading=useRef(false),started=useRef(0);
    const active=['accepted','running','awaiting_decision','cancel_requested','starting','cancelling'].includes(tab.snapshot?.run?.state);
    const canInspect=!requesting&&!runId&&!active&&workspace.actionable(tab)&&workspace.permitted(tab,'operator_tool');
    async function inspect(){
        if(!canInspect)return;
        setRequesting(true);setError('');setResult('');
        try{const admitted=await workspace.inspect(tab.key,scope,path);started.current=Date.now();setRunId(admitted);}
        catch(reason){setError(reason instanceof Error?reason.message:'Inspection request unavailable.');}
        finally{setRequesting(false);}
    }
    useEffect(()=>{
        if(!runId)return;
        const timer=window.setInterval(()=>void workspace.refresh(tab.key),2500);
        return()=>window.clearInterval(timer);
    },[runId,tab.key,workspace]);
    useEffect(()=>{
        if(!runId||reading.current)return;
        if(Date.now()-started.current>120000){setError('Result observation timed out. The command may continue; check its receipt and conversation before another request.');setRunId(null);return;}
        const snapshot=tab.snapshot,run=snapshot?.run;
        const turn=snapshot?.turns?.find((item:any)=>item.run_id===runId);
        if(tab.stale||!turn||!turn.finished_at||run?.run_id===runId&&['accepted','running','awaiting_decision','cancel_requested','starting','cancelling'].includes(run.state)||snapshot?.pending_cleanup_run||snapshot?.cleanup?.pending?.length)return;
        const index=turn?.message_end>turn?.message_start?turn.message_end-1:null;
        if(index===null||!Number.isSafeInteger(index)){setError('The inspection finished without a canonical result. Check the conversation before another request.');setRunId(null);return;}
        reading.current=true;
        void workspace.canonicalMessage(tab.key,index,snapshot.revision).then(text=>{setResult(text);setRunId(null);}).catch(reason=>{setError(reason instanceof Error?reason.message:'Canonical inspection result unavailable.');setRunId(null);}).finally(()=>{reading.current=false;});
    },[runId,tab.freshAt,tab.stale,tab.snapshot?.revision,tab.snapshot?.run?.state,tab.snapshot?.run?.run_id,tab.snapshot?.pending_cleanup_run]);
    return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" aria-label="Executing-host inspection">
        <p className="m-0 text-xs text-muted-foreground">Read the executing Voyage’s workspace through its advertised tools. Git output may include changes outside this voyage. Missing output never means a clean tree.</p>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><label className="grid gap-1 text-xs">View<SelectCombobox value={scope} disabled={requesting||Boolean(runId)} onChange={event=>setScope(event.target.value as InspectionScope)}>{scopes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</SelectCombobox></label><label className="grid gap-1 text-xs">Relative path<Input value={path} disabled={requesting||Boolean(runId)} onChange={event=>setPath(event.target.value)} placeholder="."/></label><Button type="button" className="self-end" disabled={!canInspect} onClick={()=>void inspect()}>{requesting?'Checking…':runId?'Observing…':'Inspect'}</Button></div>
        {runId&&<p className="text-xs text-muted-foreground" role="status">Waiting for the exact admitted run and canonical result. Closing this view does not cancel the run.</p>}
        {error&&<p className="text-sm text-destructive" role="alert">{error}</p>}
        {result&&<pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap break-all" aria-label="Inspection result">{result}</pre>}
    </div>;
}
