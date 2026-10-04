import React,{useState} from 'react';
import {Button} from './components/ui/button';
import type {Tab,Workspace} from './workspace';

// Observation only: opening this panel never starts inference or compaction.
export function RequestContext({tab,workspace}:{tab:Tab;workspace:Workspace}){
    const [status,setStatus]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    async function read(){
        setBusy(true);setError('');
        try{
            const run=tab.snapshot?.run?.run_id;
            const reply=await workspace.read(tab.key,'controls',{run_id:run||null,section:'context'});
            if(reply?.section!=='context'||run&&reply.run_id!==run)throw new Error('Request context identity changed; refresh before relying on it.');
            setStatus(reply.value);
        }catch(reason){setStatus(null);setError(reason instanceof Error?reason.message:'Request accounting unavailable.');}
        finally{setBusy(false);}
    }
    const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?value.toLocaleString():'Unknown';
    return <details className="rounded-md border p-2 text-xs"><summary>Request context capacity</summary>
        <p>Runtime request accounting, not cumulative billing or byte size. Unknown values remain unknown. Reading does not compact or start a run.</p>
        <Button type="button" disabled={busy||tab.stale} onClick={()=>void read()}>{busy?'Reading…':'Refresh accounting'}</Button>
        {status&&<dl><dt>Scope</dt><dd>{status.scope||'Unknown'}</dd><dt>Model</dt><dd>{status.model||'Unknown'}</dd><dt>Enabled capacity</dt><dd>{count(status.enabled_capacity)}</dd><dt>Input tokens</dt><dd>{count(status.input_tokens)}</dd><dt>Output/reasoning reserve</dt><dd>{count(status.reserve_tokens)}</dd><dt>Remaining tokens (count method applies)</dt><dd>{count(status.remaining_tokens)}</dd><dt>Method / uncertainty</dt><dd>{status.method||'Unknown'}</dd></dl>}
        {error&&<p role="alert">{error}</p>}
    </details>;
}
