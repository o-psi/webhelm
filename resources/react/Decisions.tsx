import {Input} from './components/ui/input';
import {Button} from './components/ui/button';
import {Alert,AlertTitle,AlertDescription} from './components/ui/alert';
import React, {useState} from 'react';
import type {Tab, Workspace} from './workspace';
export function Decisions({tab,workspace}: {tab:Tab;workspace:Workspace}) {
    return <section className="decisions" aria-label="Pending decisions">{tab.decisions.map(decision=><Decision key={decision.decision_id} decision={decision} tab={tab} workspace={workspace}/>)}</section>;
}
function Decision({decision,tab,workspace}: {decision:any;tab:Tab;workspace:Workspace}) {
    const [answer,setAnswer]=useState('');
    const valid=decision.expires_at_ms>Date.now()&&decision.incarnation===tab.incarnation&&decision.run_id===tab.snapshot?.run?.run_id;
    if(!valid)return null;
    const enabled=workspace.actionable(tab)&&workspace.permitted(tab,'respond'),request=decision.request;
    const respond=(response:unknown)=>workspace.respond(tab.key,decision,response);
    if(request?.kind==='approval')return <Alert className="notice"><AlertTitle>Approval requested</AlertTitle><AlertDescription><pre>{JSON.stringify(request.approval,null,2)}</pre><Button variant="ghost" disabled={!enabled} onClick={()=>void respond('approved')}>Approve</Button><Button variant="ghost" disabled={!enabled} onClick={()=>void respond('denied')}>Deny</Button></AlertDescription></Alert>;
    if(request?.kind==='question')return <Alert className="notice"><AlertTitle>{request.question.question}</AlertTitle><AlertDescription><p>Your answer becomes conversation history. Never enter a password or secret.</p><div className="decision-actions">{request.question.options.map((option:string,index:number)=><Button variant="ghost" key={index} disabled={!enabled} onClick={()=>void respond({status:'selected',index,answer:option})}>{option}</Button>)}</div><label>Custom answer<Input value={answer} onChange={event=>setAnswer(event.target.value)}/></label><Button variant="ghost" disabled={!enabled||!answer.trim()} onClick={()=>void respond({status:'custom',answer})}>Send custom answer</Button><Button variant="ghost" disabled={!enabled} onClick={()=>void respond({status:'cancelled'})}>Skip question</Button></AlertDescription></Alert>;
    if(request?.kind==='root_grant'){
        const grant=request.root_grant;
        const supported=grant&&typeof grant.path==='string'&&grant.path.startsWith('/')&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(grant.path)&&['read','write'].includes(grant.permission)&&grant.lifetime==='current_run'&&typeof grant.reason==='string'&&grant.reason.trim();
        return <Alert className="notice"><AlertTitle>Filesystem access requested</AlertTitle><AlertDescription>{supported?<><dl><dt>Executing Vessel</dt><dd>{tab.vessel}</dd><dt>Directory</dt><dd>{grant.path}</dd><dt>Permission</dt><dd>{grant.permission==='write'?'Read and write':'Read only'}</dd><dt>Lifetime</dt><dd>Current run only</dd><dt>Reason</dt><dd>{grant.reason}</dd></dl><p>Not inherited by children or already-running processes.</p><Button variant="ghost" disabled={!enabled} onClick={()=>void respond({root_grant:'approved'})}>Grant access for this run</Button><Button variant="ghost" disabled={!enabled} onClick={()=>void respond({root_grant:'denied'})}>Deny access</Button></>:<p>Unsupported filesystem request. No access granted. Use an updated native Helm client.</p>}</AlertDescription></Alert>;
    }
    return <Alert className="notice"><AlertDescription>This decision requires a native Helm client. No response sent.</AlertDescription></Alert>;
}
