import React,{useEffect,useState} from 'react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {parseFileDiscovery,type FileCatalogue} from './composer-discovery';
import type {Tab,Workspace} from './workspace';

export function filePreviewAvailable(tab:Tab){
    return !tab.stale&&Date.now()-tab.freshAt<=35000&&Boolean(tab.capabilities?.includes('workspace_file'))&&(tab.scope==='owner'||Boolean(tab.rights?.includes('workspace_read')));
}

export function FilePreview({tab,workspace,path}:{tab:Tab;workspace:Workspace;path:string}){
    const [value,setValue]=useState<(Awaited<ReturnType<Workspace['file']>>&{context:string;owner:Tab})|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0),[notice,setNotice]=useState('');
    const available=filePreviewAvailable(tab);
    const context=JSON.stringify([tab.key,tab.incarnation,tab.scope,tab.rights,tab.capabilities]);
    const observed=value?.context===context&&value.owner===tab&&value.path===path?value:null;
    useEffect(()=>{
        let current=true;setValue(null);setError('');setNotice('');
        if(!available){setLoading(false);return;}
        setLoading(true);
        void workspace.file(tab.key,path).then(reply=>{if(current)setValue({...reply,context,owner:tab});}).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:'File preview unavailable.');}).finally(()=>{if(current)setLoading(false);});
        return()=>{current=false;};
    },[workspace,tab,tab.key,tab.incarnation,path,available,context,refresh]);
    if(!available)return <p role="status" className="text-sm text-muted-foreground">Reconnect with workspace read access to preview this file.</p>;
    return <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 min-w-0 flex-1 break-all text-sm font-medium">{path}</h3><Button variant="outline" size="sm" type="button" disabled={loading} onClick={()=>setRefresh(value=>value+1)}>Refresh file</Button><Button variant="outline" size="sm" type="button" disabled={tab.draftLoading} onClick={()=>{const request=`Read the workspace file ${JSON.stringify(path)} for this task.`;workspace.draft(tab.key,tab.draft?`${tab.draft}\n${request}`:request);setNotice('File reference added to the unsent draft.');}}>Add reference to draft</Button></div>
        {notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}
        {loading&&<p role="status" className="text-sm text-muted-foreground">Reading current file…</p>}
        {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
        {observed&&<><p className="m-0 text-xs text-muted-foreground">Read-only observation · {observed.observed_bytes} of {observed.file_bytes} bytes · {new Date(observed.observed_at_ms).toLocaleTimeString()}{observed.truncated?' · Preview limited to 64 KiB; more content exists.':''}</p><pre className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap break-all" aria-label="Current file preview">{observed.text||'Empty text file.'}</pre></>}
    </div>;
}

export function WorkspaceFiles({tab,workspace}:{tab:Tab;workspace:Workspace}){
    const [catalogue,setCatalogue]=useState<FileCatalogue|null>(null),[catalogueContext,setCatalogueContext]=useState(''),[catalogueOwner,setCatalogueOwner]=useState<Tab|null>(null),[query,setQuery]=useState(''),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
    const available=filePreviewAvailable(tab)&&Boolean(tab.capabilities?.includes('workspace_file_catalog'));
    const runId=tab.snapshot?.run?.run_id||null;
    const context=JSON.stringify([tab.key,tab.incarnation,tab.scope,tab.rights,tab.capabilities]);
    const visibleCatalogue=catalogueContext===context&&catalogueOwner===tab?catalogue:null;
    useEffect(()=>{
        let current=true;setCatalogue(null);setError('');setSelected(null);
        if(!available){setLoading(false);return;}
        setLoading(true);
        void workspace.read(tab.key,'controls',{run_id:runId,section:'files'}).then(reply=>{if(current){setCatalogue(parseFileDiscovery(reply));setCatalogueContext(context);setCatalogueOwner(tab);}}).catch(reason=>{if(current)setError(reason instanceof Error?reason.message:'File catalogue unavailable.');}).finally(()=>{if(current)setLoading(false);});
        return()=>{current=false;};
    },[workspace,tab,tab.key,tab.incarnation,available,context,runId,refresh]);
    const paths=visibleCatalogue?.paths.filter(path=>path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))||[];
    return <div className="flex min-h-0 flex-1 flex-col" aria-label="Workspace files">
        <div className="flex flex-wrap items-center gap-2 border-b p-3"><label className="min-w-0 flex-1 text-xs">Find a workspace file<Input aria-label="Find workspace file" value={query} onChange={event=>setQuery(event.target.value)} disabled={!available}/></label><Button variant="outline" size="sm" type="button" disabled={!available||loading} onClick={()=>setRefresh(value=>value+1)}>Refresh files</Button></div>
        {!available?<p className="m-4 text-sm text-muted-foreground" role="status">This connection needs a current Vessel with Files preview and workspace read access.</p>:<>
            <p className="m-0 border-b px-3 py-2 text-xs text-muted-foreground">Current workspace filenames. Text previews only. Generated and dependency directories are omitted.{visibleCatalogue?.truncated?' The file list is incomplete.':''}</p>
            {loading&&<p className="m-3 text-sm text-muted-foreground" role="status">Loading workspace filenames…</p>}{error&&<p className="m-3 text-sm text-destructive" role="alert">{error}</p>}
            <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(130px,35%)_minmax(0,1fr)]"><div className="max-h-48 overflow-auto border-b p-2 lg:max-h-none lg:border-r lg:border-b-0" aria-label="Workspace filename list">{paths.slice(0,512).map(path=><Button key={path} variant={selected===path?'secondary':'ghost'} className="mb-1 h-auto w-full justify-start whitespace-normal break-all text-left" type="button" aria-pressed={selected===path} onClick={()=>setSelected(path)}>{path}</Button>)}{visibleCatalogue&&!loading&&!paths.length&&<p className="p-2 text-sm text-muted-foreground">No matching paths in the bounded file list.</p>}{paths.length>512&&<p className="p-2 text-xs text-muted-foreground">Showing first 512 matches. Narrow the search.</p>}</div><div className="flex min-h-0 flex-1 flex-col overflow-auto p-3">{selected&&catalogueContext===context&&catalogueOwner===tab?<FilePreview key={selected} tab={tab} workspace={workspace} path={selected}/>:<p className="text-sm text-muted-foreground">Choose a file to read its current text.</p>}</div></div>
        </>}
    </div>;
}
