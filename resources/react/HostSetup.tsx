import React,{useRef,useState,useEffect} from 'react';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Card} from './components/ui/card';
import {Enrollment} from './Enrollment';
import {vesselRead,accountChoices} from './settings';

type Phase='unknown'|'checking'|'verified'|'blocked';
type Fact={phase:Phase;detail:string};
const checks=['Installation and services','Execution permissions','HTTPS gateway','Browser HTTPS/WSS','Ownership approval','Workspace access','AI account','Ordinary task result','Administrator task result'] as const;

/** Presentation only: no connection flag is promoted to execution or administrator readiness. */
export function HostSetup({connection,tenant,onFirstTask}:{connection:any;tenant:string;onFirstTask?:()=>void}) {
    const [workspace,setWorkspace]=useState('');
    const [facts,setFacts]=useState<Record<string,Fact>>({});
    const [checking,setChecking]=useState(false);
    const epoch=useRef(0);
    useEffect(()=>{epoch.current++;setFacts({});setChecking(false);return()=>{epoch.current++;};},[connection?.id,connection?.vessel_id,connection?.client]);
    function changeWorkspace(value:string){epoch.current++;setWorkspace(value);setFacts({});setChecking(false);}
    async function inspect(){
        const version=++epoch.current;
        const client=connection?.client;
        setChecking(true);
        setFacts({});
        const next:Record<string,Fact>={};
        try {
            // Both are read-only probes. Do not start a voyage or incur inference here.
            const catalogue=await vesselRead(connection,'accounts',{workspace:workspace.trim(),transport:null});
            if(version!==epoch.current||connection.client!==client)return;
            const ready=accountChoices(catalogue).some((account:any)=>account.ready);
            next['AI account']={phase:ready?'verified':'blocked',detail:ready?'An available account is registered on this computer. No model request was made.':'Connect an available account privately on this computer.'};
        } catch {
            next['AI account']={phase:'blocked',detail:'Account readiness could not be confirmed. Reconnect and inspect again.'};
        }
        if(version!==epoch.current||connection?.client!==client)return;
        next['Workspace access']={phase:'unknown',detail:'A typed path is not proof of read or write access. Verify it through an authorized voyage task.'};
        setFacts(next);setChecking(false);
    }
    return <Card className="grid gap-4 p-4" aria-label="Guided computer readiness">
        <div><h3 className="font-semibold">Prepare this computer for useful work</h3><p className="text-sm text-muted-foreground">A connected computer is not necessarily ready to run tasks. Review each result separately. These checks do not install services, change permissions or use your model budget.</p></div>
        <label className="grid gap-2">Workspace on this computer<Input value={workspace} onChange={event=>changeWorkspace(event.target.value)} placeholder="/home/you/work" autoComplete="off"/></label>
        <Button variant="outline" disabled={checking||!workspace.trim()||!connection?.client} onClick={()=>void inspect()}>{checking?'Inspecting…':'Inspect AI account'}</Button>
        <ol className="grid gap-3" aria-live="polite">{checks.map(check=><li key={check}><strong>{check}: </strong><span>{facts[check]?.phase==='verified'?'Observed':facts[check]?.phase==='blocked'?'Needs attention':'Not verified'}</span><p className="text-sm text-muted-foreground">{facts[check]?.detail||'This check has no verified setup result. Do not infer it from connectivity.'}</p></li>)}</ol>
        {connection?.client&&workspace.trim()&&<Enrollment connection={connection} workspace={workspace.trim()} tenant={tenant} onRefreshed={()=>{epoch.current++;setFacts({});setChecking(false);}}/>}
        <p className="text-sm text-muted-foreground">For a first task, choose an ordinary file task in this workspace, review the proposed access and model usage, then inspect the resulting file. Administrator work requires separate local authorization and separate execution evidence.</p>
        {onFirstTask&&<Button variant="outline" onClick={onFirstTask}>Choose a first task</Button>}
    </Card>;
}
