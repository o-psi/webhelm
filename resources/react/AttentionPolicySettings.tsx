import React,{useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {PolicyClient,type PolicyView} from './attention-policy-client';
import {PolicyIntents,isUuid,type Policy} from './attention-policy-intents';

export function AttentionPolicySettings({tenantId}:{tenantId?:string}){
    const [view,setView]=useState<PolicyView|null>(null),[choice,setChoice]=useState<Policy>('three_days');
    const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(true);
    const context=useRef<{client:PolicyClient;journal:PolicyIntents;active:boolean}|null>(null);
    async function reconcile(){
        const current=context.current;if(!current?.active)return;
        setBusy(true);
        try{
            const intents=current.journal.read();
            for(const intent of intents){
                const receipt=await current.client.receipt(intent);
                if(!current.active)return;
                if(!receipt){setPending(true);setNotice('Outcome unknown. Keep the original operation; check its receipt later.');return;}
                current.journal.settle(intent);
                if(receipt.status!==200)setNotice(receipt.status===409?'Another client changed this policy. Review the current value before saving again.':'The original policy request was rejected. Review before a new change.');
            }
            const fresh=await current.client.read();if(!current.active)return;
            setView(fresh);setChoice(fresh.stale_policy);setPending(current.journal.read().length>0);
        }catch{if(current.active){setView(null);setPending(true);setNotice('Policy state unconfirmed. Sign in if needed; retained operations are not resent.');}}
        finally{if(current.active)setBusy(false);}
    }
    useEffect(()=>{
        setView(null);setPending(true);setNotice('');
        if(!isUuid(tenantId)){setNotice('Account unavailable. Policy changes are disabled.');return;}
        let current:{client:PolicyClient;journal:PolicyIntents;active:boolean};
        try{current={client:new PolicyClient(tenantId),journal:new PolicyIntents(localStorage,tenantId),active:true};}catch{setNotice('Policy intent storage unavailable. Nothing will be sent.');return;}
        context.current=current;void reconcile();
        const changed=()=>{current.client.close();void reconcile();};
        window.addEventListener('storage',changed);
        return()=>{current.active=false;current.client.close();if(context.current===current)context.current=null;window.removeEventListener('storage',changed);};
    },[tenantId]);
    async function save(){
        const current=context.current;if(!current?.active||!view||busy||pending)return;
        setBusy(true);
        try{
            const intent={tenant:tenantId!,operation_id:crypto.randomUUID(),expected_revision:view.revision,stale_policy:choice,state:'prepared' as const};
            current.journal.prepare(intent);setPending(true);
            // An identity is durable before the only PATCH. Closing/aborting never replays it.
            await current.client.save(intent);
            if(current.active)await reconcile();
        }catch{if(current.active){setPending(true);setNotice('Save unconfirmed. Check the original receipt; do not retry with a new operation.');}}
        finally{if(current.active)setBusy(false);}
    }
    return <section aria-label="Inbox policy" className="space-y-4"><h3 className="text-lg font-semibold">Inbox</h3>
        <p className="text-sm text-muted-foreground">Choose the tenant-wide stale-work preference. This does not execute, approve, archive or settle any voyage.</p>
        <fieldset disabled={!view||busy||pending}><legend>Stale-work policy</legend>{([['three_days','Three days (default)'],['seven_days','Seven days'],['off','Off']] as const).map(([value,label])=><label key={value} className="flex items-center gap-2 py-2"><input type="radio" name="attention-policy" value={value} checked={choice===value} onChange={()=>setChoice(value)}/>{label}</label>)}</fieldset>
        <p>{view?.eligibility.effect==='disabled'?'Automatic settlement is disabled.':'Automatic settlement is unavailable until authoritative work and obligation facts are available.'}</p>
        <div className="flex gap-2"><Button type="button" disabled={!view||busy||pending||choice===view.stale_policy} onClick={()=>void save()}>Save preference</Button><Button type="button" variant="outline" disabled={busy||!isUuid(tenantId)} onClick={()=>void reconcile()}>Check current policy and receipts</Button></div>
        <p role="status" aria-live="polite">{busy?'Checking policy…':notice}</p>
    </section>;
}
