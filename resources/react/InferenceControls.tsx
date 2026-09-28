import React,{useEffect,useState} from 'react';
import {ChevronDownIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from './components/ui/dropdown-menu';
import {sameAccount} from '../js/execution-profiles.js';
import {vesselRead} from './settings';
import type {Workspace,Tab} from './workspace';

type Choice='model'|'reasoning';
export function proposedInference(current:any,models:any[],choice:Choice,value:string){
    const model=models.find(item=>item.id===(choice==='model'?value:current.model));
    if(!current?.account||!model)throw new Error('Model choices changed. Review them before applying.');
    if(choice==='reasoning'&&value&&!model.reasoning_efforts?.includes(value))throw new Error('Reasoning choices changed. Review them before applying.');
    return {account:structuredClone(current.account),model:model.id,reasoning_effort:choice==='model'?null:value||null,service_tier:choice==='model'?null:current.service_tier||null};
}

export function InferenceControls({tab,workspace,connection}:{tab:Tab;workspace:Workspace;connection:any}){
    const [open,setOpen]=useState<Choice|null>(null),[busy,setBusy]=useState(false);
    const [catalogue,setCatalogue]=useState<{key:string;client:any;models:any[];error:string}|null>(null);
    const inference=tab.snapshot?.inference, account=inference?.account;
    const accountKey=JSON.stringify([tab.key,tab.incarnation,tab.snapshot?.workspace,account]);
    const ready=Boolean(catalogue?.key===accountKey&&catalogue.client===connection?.client);
    const active=['running','starting','accepted','awaiting_decision','cancel_requested','cancelling'].includes(tab.snapshot?.run?.state);
    const canChange=Boolean(!busy&&!active&&account&&workspace.actionable(tab)&&workspace.permitted(tab,'set_account_inference'));
    useEffect(()=>{
        if(!open||!account||!connection?.client||ready)return;
        let live=true;const client=connection.client,observedAccount=structuredClone(account);
        setCatalogue(null);
        void vesselRead(connection,'account_models',{workspace:tab.snapshot.workspace,account:observedAccount}).then(result=>{
            if(!live||connection.client!==client||!sameAccount(result.account,observedAccount))return;
            const now=JSON.stringify([tab.key,tab.incarnation,tab.snapshot?.workspace,tab.snapshot?.inference?.account]);
            if(now===accountKey)setCatalogue({key:accountKey,client,models:result.models||[],error:''});
        }).catch(error=>{if(live)setCatalogue({key:accountKey,client,models:[],error:error instanceof Error?error.message:'Models unavailable.'});});
        return()=>{live=false;};
    },[open,accountKey,connection?.client,ready]);
    async function apply(choice:Choice,value:string){
        if(!canChange||!ready||catalogue?.error)return;
        setBusy(true);
        try{
            const current=tab.snapshot?.inference;
            if(JSON.stringify([tab.key,tab.incarnation,tab.snapshot?.workspace,current?.account])!==accountKey)throw new Error('Voyage settings changed. Review the current model before applying.');
            const latest=await vesselRead(connection,'account_models',{workspace:tab.snapshot.workspace,account:current.account});
            if(!sameAccount(latest.account,current.account))throw new Error('Account identity changed. Review the model choice.');
            const settings=proposedInference(current,latest.models||[],choice,value);
            if(settings.model===current.model&&settings.reasoning_effort===(current.reasoning_effort||null)&&settings.service_tier===(current.service_tier||null))return;
            const previousNotice=tab.notice;
            const applied=await workspace.act(tab.key,'set_account_inference',settings);
            if(!applied&&tab.notice===previousNotice)throw new Error('The voyage changed before the model choice was applied. Refresh and review it again.');
        }catch(error){tab.notice=error instanceof Error?error.message:'Model choice unavailable.';workspace.changed();}
        finally{setBusy(false);setOpen(null);}
    }
    const menus:Choice[]=['model','reasoning'];
    return <div className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Model and reasoning">{menus.map(choice=>{
        const model=catalogue?.models.find(item=>item.id===inference?.model);
        const values=choice==='model'?catalogue?.models||[]:[{id:'',display_name:'Provider default'},...(model?.reasoning_efforts||[]).map((id:string)=>({id,display_name:id}))];
        return <DropdownMenu key={choice} open={open===choice} onOpenChange={next=>{if(next&&catalogue?.error)setCatalogue(null);setOpen(next?choice:null);}}><DropdownMenuTrigger asChild><Button variant="ghost" type="button" size="sm" disabled={!canChange} aria-label={choice==='model'?'Choose model':'Choose reasoning'} className="max-w-44 gap-1 px-2 text-xs font-normal"><span className="truncate">{choice==='model'?inference?.model||'Model':inference?.reasoning_effort||'Default thinking'}</span><ChevronDownIcon aria-hidden="true"/></Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-72 min-w-48 overflow-y-auto">{!ready?<DropdownMenuItem disabled>{catalogue?.error||'Loading choices…'}</DropdownMenuItem>:values.length?values.map((item:any)=><DropdownMenuItem key={item.id} disabled={busy} onSelect={()=>void apply(choice,item.id)}>{item.display_name||item.id}</DropdownMenuItem>):<DropdownMenuItem disabled>No choices available</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>;
    })}</div>;
}
