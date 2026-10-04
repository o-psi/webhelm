import React,{useState} from 'react';
import {Button} from './components/ui/button';
import type {Tab,Workspace} from './workspace';

// Observation only: opening this panel never starts inference or compaction.
export function RequestContext({tab,workspace}:{tab:Tab;workspace:Workspace}){
    const [status,setStatus]=useState<{binding:string;value:Record<string,unknown>}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    const binding=`${tab.session}:${tab.incarnation}:${tab.snapshot?.run?.run_id||'idle'}`;
    const visible=status?.binding===binding?status.value:null;
    async function read(){
        setBusy(true);setError('');
        try{
            const run=tab.snapshot?.run?.run_id;
            const reply=await workspace.read(tab.key,'controls',{run_id:run||null,section:'context'});
            if(reply?.section!=='context'||run&&reply.run_id!==run)throw new Error('Request context identity changed; refresh before relying on it.');
            setStatus({binding,value:reply.value as Record<string,unknown>});
        }catch(reason){setStatus(null);setError(reason instanceof Error?reason.message:'Request accounting unavailable.');}
        finally{setBusy(false);}
    }
    const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)?value.toLocaleString():'Unknown';
    return <details className="rounded-md border p-2 text-xs"><summary>Request context capacity</summary>
        <p>Runtime request accounting, not cumulative billing or byte size. Unknown values remain unknown. Reading does not compact or start a run.</p>
        <Button type="button" disabled={busy||tab.stale} onClick={()=>void read()}>{busy?'Reading…':'Refresh accounting'}</Button>
        {visible&&<dl><dt>Scope</dt><dd>{String(visible.scope||'Unknown')||'Unknown'}</dd><dt>Model</dt><dd>{String(visible.model||'Unknown')||'Unknown'}</dd><dt>Enabled capacity</dt><dd>{count(visible.enabled_capacity)}</dd><dt>Input tokens</dt><dd>{count(visible.input_tokens)}</dd><dt>Output/reasoning reserve</dt><dd>{count(visible.reserve_tokens)}</dd><dt>Remaining tokens (count method applies)</dt><dd>{count(visible.remaining_tokens)}</dd><dt>Method / uncertainty</dt><dd>{String(visible.method||'Unknown')||'Unknown'}</dd></dl>}
        {error&&<p role="alert">{error}</p>}
    </details>;
}
