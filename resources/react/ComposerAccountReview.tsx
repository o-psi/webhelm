import {ComposerChoice} from './ComposerOptions';
import {modelLabel} from './ModelLabel';
import React,{useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {sameAccount} from '../js/execution-profiles.js';
import {vesselRead} from './settings';

// Resolve presentation against the observed option, never stringify an arbitrary
// binding into the label or relax exact identity matching for display purposes.
export function reviewedAccountOption(accounts:any[],binding:any){
    const selected=accounts.find(item=>sameAccount(item.binding,binding));
    return {selected,value:selected?JSON.stringify(selected.binding):''};
}

export function ComposerAccountReview({connection,workspace,accounts,selection,onApply,onClose}:any){
    const [account,setAccount]=useState(JSON.stringify(selection.account)),[model,setModel]=useState(selection.model);
    const [models,setModels]=useState<any[]>([]),[ready,setReady]=useState(false),[notice,setNotice]=useState('');
    const generation=useRef(0);
    const {selected,value:accountValue}=reviewedAccountOption(accounts,JSON.parse(account));
    useEffect(()=>{
        const epoch=++generation.current;setReady(false);setModels([]);setNotice('');
        if(!selected?.ready||!connection?.client)return;
        const client=connection.client;
        void vesselRead(connection,'account_models',{workspace,account:selected.binding}).then(value=>{
            if(epoch!==generation.current||connection.client!==client)return;
            if(!sameAccount(value.account,selected.binding))throw Error('Account identity changed. Reopen account review.');
            setModels(value.models||[]);setReady(true);
        }).catch(error=>{if(epoch===generation.current)setNotice(error.message||'Models unavailable.');});
        return()=>{generation.current++;};
    },[account,workspace,connection?.client,accounts]);
    const valid=selected?.ready&&ready&&models.some(item=>item.id===model);
    return <section aria-label="Review composer account" className="mx-auto mb-4 flex max-w-2xl flex-col gap-3 rounded-lg border p-4">
        <h2>Account for this voyage</h2><p>Review an account and model without changing your saved profile.</p>
        <ComposerChoice name="Account" value={accountValue} disabled={false} options={accounts.map((item:any)=>({value:JSON.stringify(item.binding),label:item.label+(item.ready?'':' · unavailable'),disabled:!item.ready}))} onChange={value=>{setAccount(value);setModel('');}}/>
        <ComposerChoice name="Model" value={model} disabled={!ready} options={models.map(item=>({value:item.id,label:modelLabel(item,item.id)}))} onChange={setModel}/>
        {notice&&<p role="alert">{notice}</p>}<div className="flex gap-2"><Button type="button" disabled={!valid} onClick={()=>{if(valid)onApply({account:selected.binding,model});}}>Use account and model</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel account review</Button></div>
    </section>;
}
