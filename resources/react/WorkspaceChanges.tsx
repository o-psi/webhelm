import React,{useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import type {Tab,Workspace} from './workspace';

type Entry={path:string;mark:string;staged:boolean;unstaged:boolean;untracked:boolean};
type Observation={scope:'status'|'unstaged'|'staged';path:string;text:string;truncated:boolean;observed_at_ms:number};

export function changeEntries(text:string):Entry[]{
    const records=text.split('\0');
    if(records.at(-1)!=='')records.pop();
    return records.filter(Boolean).flatMap(record=>{
        if(record.length<4||record[2]!==' ')return [];
        const mark=record.slice(0,2),path=record.slice(3);
        if(!path)return [];
        return [{path,mark,staged:mark[0]!==' '&&mark[0]!=='?',unstaged:mark[1]!==' '&&mark[1]!=='?',untracked:mark==='??'}];
    });
}

export function WorkspaceChanges({tab,workspace}:{tab:Tab;workspace:Workspace}){
    const [status,setStatus]=useState<Observation|null>(null),[selected,setSelected]=useState<string|null>(null);
    const [scope,setScope]=useState<'unstaged'|'staged'>('unstaged'),[diff,setDiff]=useState<Observation|null>(null);
    const [loading,setLoading]=useState(false),[diffLoading,setDiffLoading]=useState(false);
    const [error,setError]=useState(''),[diffError,setDiffError]=useState('');
    const manualRefresh=useRef<()=>void>(()=>{});
    const supported=tab.capabilities?.includes('workspace_changes')&& (tab.scope==='owner'||tab.rights?.includes('workspace_read'));
    const available=supported&&!tab.stale&&Date.now()-tab.freshAt<35000;
    const allEntries=status?changeEntries(status.text):[];
    const entries=allEntries.slice(0,512);
    const current=entries.find(entry=>entry.path===selected)||entries[0];
    const currentScope=current?.unstaged?'unstaged':current?.staged?'staged':null;
    const chosenScope=current?.[scope]?scope:currentScope;

    useEffect(()=>{
        let active=true,reading=false;
        const refresh=async()=>{
            if(reading||document.visibilityState==='hidden'||tab.stale)return;
            reading=true;setLoading(true);setError('');
            try{const value=await workspace.changes(tab.key,'status');if(active)setStatus(value);}
            catch(reason){if(active)setError(reason instanceof Error?reason.message:'Changes unavailable.');}
            finally{reading=false;if(active)setLoading(false);}
        };
        manualRefresh.current=()=>void refresh();
        if(available)void refresh();
        const timer=window.setInterval(()=>{if(available)void refresh();},15000);
        const visible=()=>{if(available&&document.visibilityState==='visible')void refresh();};
        document.addEventListener('visibilitychange',visible);
        return()=>{active=false;manualRefresh.current=()=>{};window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
    },[workspace,tab.key,tab.incarnation,tab.stale,Boolean(available)]);

    useEffect(()=>{
        if(!current||!chosenScope||!available){setDiff(null);return;}
        let active=true;setDiff(null);setDiffError('');setDiffLoading(true);
        void workspace.changes(tab.key,chosenScope,current.path).then(value=>{if(active)setDiff(value);}).catch(reason=>{if(active)setDiffError(reason instanceof Error?reason.message:'Diff unavailable.');}).finally(()=>{if(active)setDiffLoading(false);});
        return()=>{active=false;};
    },[workspace,tab.key,tab.incarnation,tab.stale,current?.path,chosenScope,status,Boolean(available)]);

    return <div className="flex min-h-0 flex-1 flex-col" aria-label="Workspace changes">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2"><p className="m-0 text-xs text-muted-foreground">Current Git changes in this Voyage workspace</p><Button variant="outline" size="sm" type="button" disabled={!available||loading} onClick={()=>manualRefresh.current()}>Refresh</Button></div>
        {!supported&&<p className="m-4 text-sm text-muted-foreground" role="status">This Vessel does not offer scoped Changes review for this connection. Use Inspect for an explicit workspace request.</p>}
        {supported&&!available&&<p className="m-4 text-sm text-muted-foreground" role="status">Changes are unavailable until this Voyage reconnects. The last observation may be stale.</p>}
        {loading&&!status&&<p className="m-4 text-sm text-muted-foreground" role="status">Loading workspace changes…</p>}
        {error&&<p className="m-4 text-sm text-destructive" role="alert">{error} Existing results may be stale.</p>}
        {status&&<><p className="m-0 border-b px-4 py-2 text-xs text-muted-foreground" role="status">{allEntries.length} observed changed {allEntries.length===1?'path':'paths'} · {allEntries.filter(item=>item.staged).length} staged · {allEntries.filter(item=>item.unstaged).length} unstaged · {allEntries.filter(item=>item.untracked).length} untracked{status.truncated?' · List truncated; more paths may exist.':''}{allEntries.length>entries.length?' · Showing first 512 paths.':''}{loading?' · Refreshing…':''}</p>
            <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(150px,35%)_minmax(0,1fr)]">
                <div className="max-h-48 min-h-0 overflow-auto border-b p-2 lg:max-h-none lg:border-r lg:border-b-0" aria-label="Changed files">{entries.length?entries.map(entry=><Button key={entry.path} variant={current?.path===entry.path?'secondary':'ghost'} type="button" aria-pressed={current?.path===entry.path} className="mb-1 h-auto w-full justify-start gap-2 whitespace-normal px-2 py-2 text-left" onClick={()=>{setSelected(entry.path);setScope(entry.unstaged?'unstaged':'staged');}}><span className="shrink-0 font-mono text-xs">{entry.mark}</span><span className="min-w-0 break-all">{entry.path}</span></Button>):<p className="p-2 text-sm text-muted-foreground">No changed paths observed.</p>}</div>
                <div className="min-h-0 flex-1 overflow-auto p-3">{current?<><h3 className="mb-2 break-all text-sm font-medium">{current.path}</h3><div className="mb-2 flex gap-2">{current.unstaged&&<Button variant={chosenScope==='unstaged'?'secondary':'outline'} size="sm" type="button" aria-pressed={chosenScope==='unstaged'} onClick={()=>setScope('unstaged')}>Unstaged</Button>}{current.staged&&<Button variant={chosenScope==='staged'?'secondary':'outline'} size="sm" type="button" aria-pressed={chosenScope==='staged'} onClick={()=>setScope('staged')}>Staged</Button>}</div>{current.untracked?<p className="text-sm text-muted-foreground">Untracked file. Stage it to review a diff, or use explicit Inspect to read it.</p>:diffLoading?<p className="text-sm text-muted-foreground" role="status">Loading diff…</p>:diffError?<p className="text-sm text-destructive" role="alert">{diffError}</p>:diff?<><pre className="overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap break-all" aria-label="Current Git diff">{diff.text||'No diff in the selected view.'}</pre>{diff.truncated&&<p className="text-xs text-muted-foreground">Diff limited to 64 KiB; more content exists.</p>}</>:null}</>:<p className="text-sm text-muted-foreground">Choose a changed file to review its diff.</p>}</div>
            </div></>}
    </div>;
}
