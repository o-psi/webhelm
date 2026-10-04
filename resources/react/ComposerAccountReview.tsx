import React,{useEffect,useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {SelectCombobox} from './components/ui/select-combobox';
import {sameAccount} from '../js/execution-profiles.js';
import {vesselRead} from './settings';

export function ComposerAccountReview({connection,workspace,accounts,selection,onApply,onClose}:any){
    const [account,setAccount]=useState(JSON.stringify(selection.account)),[model,setModel]=useState(selection.model);
    const [models,setModels]=useState<any[]>([]),[ready,setReady]=useState(false),[notice,setNotice]=useState('');
    const generation=useRef(0);
    const selected=accounts.find((item:any)=>sameAccount(item.binding,JSON.parse(account)));
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
        <label>Account<SelectCombobox aria-label="Review account" value={account} onChange={event=>{setAccount(event.target.value);setModel('');}}>{accounts.map((item:any)=><option key={JSON.stringify(item.binding)} value={JSON.stringify(item.binding)} disabled={!item.ready}>{item.label}{item.ready?'':' · unavailable'}</option>)}</SelectCombobox></label>
        <label>Model<SelectCombobox aria-label="Review model" value={model} disabled={!ready} onChange={event=>setModel(event.target.value)}><option value="">{ready?'Choose model':'Loading models…'}</option>{models.map(item=><option key={item.id} value={item.id}>{item.display_name||item.id}</option>)}</SelectCombobox></label>
        {notice&&<p role="alert">{notice}</p>}<div className="flex gap-2"><Button type="button" disabled={!valid} onClick={()=>{if(valid)onApply({account:selected.binding,model});}}>Use account and model</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel account review</Button></div>
    </section>;
}
