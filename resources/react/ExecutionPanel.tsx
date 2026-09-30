import React,{useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter,DialogTrigger} from './components/ui/dialog';
import {Alert,AlertDescription} from './components/ui/alert';
import {request,uuid} from '../js/vessel-client.js';
import {voyagePath} from './voyage-url';
import type {Tab} from './workspace';

// Retain operation identity only. Reconnection observes, never repeats approval.
export function ExecutionPanel({tab,connection}:{tab:Tab;connection:any}){
    const [open,setOpen]=useState(false),[inventory,setInventory]=useState<any>(null),[status,setStatus]=useState<any>(null),[review,setReview]=useState<any>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[acknowledged,setAcknowledged]=useState(false);
    const [transitionTarget,setTransitionTarget]=useState(''),[stopSource,setStopSource]=useState(false);
    const generation=useRef(0);
    const key=`helm:execution-review:${connection.id}:${tab.session}`;
    const pending=useRef<{review_id:string;command_id:string;session_id:string}|null>(null);
    const client=connection.client;
    const exchange=async(operation:any)=>{
        if(!client||connection.client!==client||tab.stale)throw new Error('Reconnect the Vessel before reviewing execution.');
        const epoch=generation.current;
        const reply=await client.exchange(request('execution',{operation}));
        if(generation.current!==epoch||connection.client!==client)throw new Error('The connection changed. Check the retained review.');
        if(reply.error||reply.outcome_unknown)throw new Error(reply.error?.message||'The outcome is unconfirmed. Check the retained review before another action.');
        return reply.result;
    };
    const observe=async()=>{
        if(!pending.current)return;
        const saved=await exchange({action:'review',review_id:pending.current.review_id});
        if(saved?.preparation?.review_id===pending.current.review_id&&saved.preparation.command_id===pending.current.command_id){setNotice(saved.message||'Source retirement remains unconfirmed.');setUncertain(true);return;}
        if(saved?.review?.review_id!==pending.current.review_id||saved?.review?.command_id!==pending.current.command_id||saved?.review?.facts?.session_id!==pending.current.session_id)throw new Error('Execution review identity changed.');
        setReview(saved);setUncertain(false);setAcknowledged(false);
    };
    useEffect(()=>{
        generation.current++;setReview(null);setInventory(null);setStatus(null);setAcknowledged(false);pending.current=null;
        if(!open)return;
        try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&['review_id','command_id','session_id'].every(field=>typeof saved[field]==='string'&&/^[0-9a-f-]{36}$/i.test(saved[field])))pending.current=saved;}catch{setNotice('Saved execution review unavailable. Keep this panel open.');}
        setBusy(true);setNotice('');let current=true;
        Promise.allSettled([exchange({action:'inventory'}),exchange({action:'status',session_id:tab.session}),observe()]).then(([choices,observed,resumed])=>{
            if(!current)return;
            if(choices.status==='fulfilled')setInventory(choices.value);
            else setNotice(choices.reason.message);
            if(observed.status==='fulfilled')setStatus(observed.value);
            if(resumed.status==='rejected')setNotice(resumed.reason.message);
        }).finally(()=>current&&setBusy(false));
        return()=>{current=false;generation.current++;};
    },[open,client,tab.key,tab.incarnation]);
    if(!tab.capabilities?.includes('execution_identity'))return null;
    const prepare=async(transition=false)=>{
        if(busy||pending.current||inventory?.status!=='available')return;
        const identity=inventory.identities?.find((choice:any)=>choice.available&&(transition?choice.identity.id===transitionTarget:choice.authority==='administrator'));
        if(transition&&(!stopSource||!inventory.can_transition))return;
        if(!identity||!tab.snapshot?.workspace)return;
        setBusy(true);setNotice('');
        try{
            const retained={review_id:uuid(),command_id:uuid(),session_id:transition?tab.session:uuid()};
            localStorage.setItem(key,JSON.stringify(retained));pending.current=retained;
            const saved=await exchange(transition?{action:'prepare_transition',...retained,source_incarnation:tab.incarnation,identity:identity.identity,stop_source:true}:{action:'prepare',...retained,workspace:tab.snapshot.workspace,identity:identity.identity});
            if(saved?.review?.review_id!==retained.review_id||saved?.review?.command_id!==retained.command_id)throw new Error('Prepared review identity changed.');
            setReview(saved);setUncertain(false);setAcknowledged(false);
        }catch(error){setNotice(error instanceof Error?error.message:'Execution review unavailable.');}finally{setBusy(false);}
    };
    const act=async(action:'approve'|'cancel'|'revoke')=>{
        if(busy||!review||!pending.current)return;
        setBusy(true);setNotice('');setAcknowledged(false);
        try{
            const approval={review_id:review.review.review_id,command_id:review.review.command_id,digest:review.review.digest};
            const operation=action==='approve'?{action:'approve',approval}:{action:'control',control:{review_id:approval.review_id,command_id:uuid(),digest:approval.digest,action}};
            const saved=await exchange(operation);
            if(saved?.review?.review_id!==approval.review_id||saved?.receipt?.review_digest!==approval.digest)throw new Error('Execution receipt identity changed.');
            setReview(saved);
            if(saved.receipt.outcome?.state==='cancelled'){localStorage.removeItem(key);pending.current=null;setReview(null);}
        }catch(error){setUncertain(true);setNotice(error instanceof Error?error.message:'Outcome unconfirmed. Check the retained review.');}finally{setBusy(false);}
    };
    const outcome=review?.receipt?.outcome?.state,expired=review&&Date.now()>=review.review.expires_at_ms;
    return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="ghost" type="button" aria-label="Execution identity">Execution</Button></DialogTrigger><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>Execution identity</DialogTitle><DialogDescription>The executing Vessel selects the OS identity. Access mode and administrator authorization are separate.</DialogDescription></DialogHeader>
        {status&&<dl className="grid grid-cols-[auto_1fr] gap-2 text-sm"><dt>Execution user</dt><dd>{status.identity?.label}</dd><dt>Authority</dt><dd>{status.identity?.authority}</dd><dt>Process</dt><dd>{status.process_state}</dd><dt>Launch observation</dt><dd>{status.observed?`UID ${status.observed.uid} · GID ${status.observed.gid}`:'Not observed'}</dd><dt>Owned process cleanup</dt><dd>{status.cleanup_observed?'Observed':'Not established'}</dd></dl>}
        {!review&&!pending.current&&inventory?.can_transition&&<div className="space-y-2"><label className="block text-sm">Transition this voyage to<select className="block w-full rounded border bg-background p-2" value={transitionTarget} onChange={event=>setTransitionTarget(event.target.value)}><option value="">Choose configured identity</option>{inventory.identities?.filter((choice:any)=>choice.available).map((choice:any)=><option key={choice.identity.id} value={choice.identity.id}>{choice.label} · {choice.authority}</option>)}</select></label><label className="flex gap-2 text-sm"><input type="checkbox" checked={stopSource} onChange={event=>setStopSource(event.target.checked)}/>Stop the current process to prepare an exact review. Preserve conversation and interrupt pending work without replay. The target identity will be able to read this history.</label><Button disabled={busy||!transitionTarget||!stopSource||tab.stale} onClick={()=>void prepare(true)}>Stop and prepare identity transition</Button></div>}
        {!review&&<Alert><AlertDescription>{inventory?.status==='available'?'You may prepare a separate administrator voyage using the explicitly provisioned account and workspace. Your current voyage and unsent draft remain separate.':'Administrator execution is unavailable. An authorized host operator must provision its account/context and enroll this fresh connection separately.'}</AlertDescription></Alert>}
        {review&&<><dl className="grid grid-cols-[auto_1fr] gap-2 text-sm"><dt>State</dt><dd>{outcome?.replaceAll('_',' ')}</dd><dt>Workspace</dt><dd className="break-all">{review.review.facts.workspace}</dd><dt>Account</dt><dd className="break-all">{review.review.facts.account.account_id}</dd><dt>Voyage</dt><dd className="break-all">{review.review.facts.session_id}</dd><dt>Review expires</dt><dd>{new Date(review.review.expires_at_ms).toLocaleString()}</dd></dl><Alert><AlertDescription>Administrator tools can alter host files, processes and credentials, including Vessel itself. Host namespaces and mounts still limit actual authority. Local receipts cannot protect against an unrestricted host administrator.</AlertDescription></Alert>
            {outcome==='awaiting_approval'&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/>I authorize this exact reviewed execution identity, voyage, account and workspace.</label>}
            {outcome==='ready'&&<Button asChild><a href={voyagePath(connection.id,review.review.facts.session_id)}>Open reviewed voyage</a></Button>}
            {['launching','unconfirmed','revocation_requested'].includes(outcome)&&<p>Check the exact receipt and process status. Approval will not be repeated; revocation requested does not establish cleanup.</p>}
        </>}
        <p role="status">{notice|| (busy?'Reading execution state…':'')}</p><DialogFooter><Button variant="outline" onClick={()=>setOpen(false)}>Close</Button>{pending.current&&<Button variant="outline" disabled={busy} onClick={()=>{setBusy(true);observe().catch(error=>setNotice(error.message)).finally(()=>setBusy(false));}}>Check retained review</Button>}{!pending.current&&inventory?.can_review_administrator&&<Button disabled={busy} onClick={()=>void prepare()}>Prepare administrator voyage</Button>}{outcome==='awaiting_approval'&&<><Button variant="outline" disabled={busy} onClick={()=>void act('cancel')}>Cancel review</Button><Button disabled={busy||uncertain||expired||!acknowledged||tab.stale} onClick={()=>void act('approve')}>Approve reviewed execution</Button></>}{['approved','launching','ready','unconfirmed'].includes(outcome)&&review?.administrator_grant_id&&<Button variant="destructive" disabled={busy} onClick={()=>void act('revoke')}>Revoke administrator authorization</Button>}</DialogFooter>
    </DialogContent></Dialog>;
}
