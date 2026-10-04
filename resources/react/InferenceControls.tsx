import {ComposerOptionTrigger} from './ComposerOptions';
import {modelLabel} from './ModelLabel';
import React,{useEffect,useState} from 'react';
import {Button} from './components/ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuRadioGroup,DropdownMenuRadioItem,DropdownMenuTrigger} from './components/ui/dropdown-menu';
import {ModelPicker} from './ModelPicker';
import {sameAccount} from '../js/execution-profiles.js';
import {vesselRead} from './settings';
import type {Workspace,Tab} from './workspace';

type Choice='model'|'reasoning'|'service';
export function proposedInference(current:any,models:any[],choice:Choice,value:string){
    const model=models.find(item=>item.id===(choice==='model'?value:current.model));
    if(!current?.account||!model)throw new Error('Model choices changed. Review them before applying.');
    if(choice==='reasoning'&&value&&!model.reasoning_efforts?.includes(value))throw new Error('Reasoning choices changed. Review them before applying.');
    if(choice==='service'&&value&&!model.service_tiers?.includes(value))throw new Error('Service choices changed. Review them before applying.');
    return {account:structuredClone(current.account),model:model.id,reasoning_effort:choice==='model'?null:choice==='reasoning'?value||null:current.reasoning_effort||null,service_tier:choice==='model'?null:choice==='service'?value||null:current.service_tier||null};
}

export function InferenceControls({tab,workspace,connection}:{tab:Tab;workspace:Workspace;connection:any}){
    const [open,setOpen]=useState<Choice|null>(null),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
    const [catalogue,setCatalogue]=useState<{key:string;client:any;models:any[];error:string;refresh:number}|null>(null);
    const inference=tab.snapshot?.inference, account=inference?.account;
    const accountKey=JSON.stringify([tab.key,tab.incarnation,tab.snapshot?.workspace,account]);
    const ready=Boolean(catalogue?.key===accountKey&&catalogue.client===connection?.client&&catalogue.refresh===refresh);
    const active=['running','starting','accepted','awaiting_decision','cancel_requested','cancelling'].includes(tab.snapshot?.run?.state);
    const canChange=Boolean(!busy&&!active&&account&&workspace.actionable(tab)&&workspace.permitted(tab,'set_account_inference'));
    useEffect(()=>{
        if(!open||!account||!connection?.client||ready)return;
        let live=true;const client=connection.client,observedAccount=structuredClone(account);
        setCatalogue(previous=>previous?.key===accountKey?previous:null);
        void vesselRead(connection,'account_models',{workspace:tab.snapshot.workspace,account:observedAccount}).then(result=>{
            if(!live||connection.client!==client)return;
            if(!sameAccount(result.account,observedAccount))throw new Error('Account identity changed. Refresh model choices.');
            if(!Array.isArray(result.models)||result.models.some((model:any)=>!model||typeof model.id!=='string'||!model.id))throw new Error('Model choices could not be read. Retry.');
            const now=JSON.stringify([tab.key,tab.incarnation,tab.snapshot?.workspace,tab.snapshot?.inference?.account]);
            if(now===accountKey)setCatalogue({key:accountKey,client,models:result.models||[],error:'',refresh});
        }).catch(error=>{if(live)setCatalogue({key:accountKey,client,models:[],error:error instanceof Error?error.message:'Models unavailable.',refresh});});
        return()=>{live=false;};
    },[open,accountKey,connection?.client,ready,refresh]);
    async function apply(choice:Choice,value:string){
        if(!canChange||!ready||catalogue?.error)return;
        setBusy(true);
        const reviewedClient=connection.client,reviewedIncarnation=tab.incarnation;
        try{
            const current=structuredClone(tab.snapshot?.inference);
            if(JSON.stringify([tab.key,tab.incarnation,tab.snapshot?.workspace,current?.account])!==accountKey)throw new Error('Voyage settings changed. Review the current model before applying.');
            if(choice==='model'&&value===current.model)return;
            const latest=await vesselRead(connection,'account_models',{workspace:tab.snapshot.workspace,account:current.account});
            if(connection.client!==reviewedClient||tab.incarnation!==reviewedIncarnation||!workspace.actionable(tab)||!workspace.permitted(tab,'set_account_inference')||JSON.stringify(tab.snapshot?.inference)!==JSON.stringify(current)||['running','starting','accepted','awaiting_decision','cancel_requested','cancelling'].includes(tab.snapshot?.run?.state))throw new Error('Voyage settings or connection changed. Review the current choice before applying.');
            if(!sameAccount(latest.account,current.account))throw new Error('Account identity changed. Review the model choice.');
            const settings=proposedInference(current,latest.models||[],choice,value);
            if(settings.model===current.model&&settings.reasoning_effort===(current.reasoning_effort||null)&&settings.service_tier===(current.service_tier||null))return;
            const previousNotice=tab.notice;
            const applied=await workspace.act(tab.key,'set_account_inference',settings);
            if(!applied&&tab.notice===previousNotice)throw new Error('The voyage changed before the model choice was applied. Refresh and review it again.');
        }catch(error){tab.notice=error instanceof Error?error.message:'Model choice unavailable.';workspace.changed();}
        finally{setBusy(false);setOpen(null);}
    }
    const models=catalogue?.key===accountKey?catalogue.models:[];
    const provider=({chatgpt_oauth:'ChatGPT',openai_responses:'OpenAI Responses',openai_chat_completions:'OpenAI Chat Completions',anthropic:'Anthropic'} as Record<string,string>)[account?.transport]||'Account models';
    const menus:Choice[]=['reasoning','service'];
    return <div className="composer-inference" aria-label="Model and reasoning"><ModelPicker trigger={<ComposerOptionTrigger name="Model" label={modelLabel(catalogue?.models.find(item=>item.id===inference?.model),inference?.model||'Model')} disabled={!canChange}/>} open={open==='model'} onOpenChange={next=>setOpen(next?'model':null)} models={models} current={inference?.model||''} provider={provider} loading={!ready} error={ready?catalogue?.error||'':''} disabled={!canChange} onChoose={value=>void apply('model',value)} onRefresh={()=>setRefresh(value=>value+1)}/>{menus.map(choice=>{
        const model=catalogue?.models.find(item=>item.id===inference?.model);
        const values=choice==='model'?catalogue?.models||[]:[{id:'',display_name:'Provider default'},...(choice==='service'?model?.service_tiers||[]:model?.reasoning_efforts||[]).map((id:string)=>({id,display_name:id}))];
        return <DropdownMenu key={choice} open={open===choice} onOpenChange={next=>{if(next&&catalogue?.error)setCatalogue(null);setOpen(next?choice:null);}}><DropdownMenuTrigger asChild><ComposerOptionTrigger name={choice==='service'?'Service tier':'Reasoning'} label={(choice==='service'?inference?.service_tier:inference?.reasoning_effort)||'Provider default'} disabled={!canChange}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">{!ready?<DropdownMenuItem disabled>Loading choices…</DropdownMenuItem>:catalogue?.error?<><DropdownMenuItem disabled>{catalogue.error}</DropdownMenuItem><DropdownMenuItem onSelect={event=>{event.preventDefault();setRefresh(value=>value+1);}}>Retry choices</DropdownMenuItem></>:values.length?<DropdownMenuRadioGroup value={(choice==='service'?inference?.service_tier:inference?.reasoning_effort)||''} onValueChange={value=>void apply(choice,value)}>{values.map((item:any)=><DropdownMenuRadioItem key={item.id} value={item.id} disabled={busy}>{item.display_name||item.id}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>:<DropdownMenuItem disabled>No choices available</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>;
    })}</div>;
}
