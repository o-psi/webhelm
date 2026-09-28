import React,{useEffect,useRef} from 'react';
import {Button} from './components/ui/button';
import {Card} from './components/ui/card';
import {Input} from './components/ui/input';
import {NativeSelect} from './components/ui/native-select';
import {accountEnrollment} from '../js/account-enrollment.js';

// The adapter retains private device codes and receipts; React owns the controls.
export function Enrollment({connection,workspace,tenant,onRefreshed,autoOpen=false}:{connection:any;workspace:string;tenant:string;onRefreshed:()=>void;autoOpen?:boolean}){
    const host=useRef<HTMLDivElement>(null),adapter=useRef<ReturnType<typeof accountEnrollment>|null>(null);
    const current=useRef({connection,workspace,onRefreshed});current.current={connection,workspace,onRefreshed};
    useEffect(()=>{
        const root=host.current!;
        adapter.current=accountEnrollment(root,{context:()=>({connection:current.current.connection,workspace:current.current.workspace}),refreshed:()=>current.current.onRefreshed()});
        if(autoOpen)void adapter.current.open();
        return()=>{adapter.current?.dispose();adapter.current=null;};
    },[connection.id,workspace,autoOpen]);
    return <div ref={host} data-tenant-id={tenant} className="enrollment">
        <Button variant="outline" type="button" data-open hidden={autoOpen} onClick={()=>void adapter.current?.open()}>Add ChatGPT account</Button>
        <Card id="enrollment-panel" hidden aria-label="Add ChatGPT account">
            <header hidden={autoOpen}><strong id="enrollment-title"/><Button variant="ghost" id="enrollment-close" type="button" aria-label="Close account sign-in">×</Button></header>
            <p>Your sign-in stays on your Vessel.</p>
            <div id="enrollment-setup"><div id="enrollment-provider-field" hidden><label>ChatGPT connection<NativeSelect id="enrollment-provider"/></label></div><label>Account name<Input id="enrollment-label" maxLength={128} autoComplete="off" placeholder="Personal or Work"/></label></div>
            <div id="enrollment-private" hidden><p>Enter this code on the ChatGPT sign-in page.</p><p id="enrollment-code" aria-label="Private sign-in code"/><a id="enrollment-link" target="_blank" rel="noopener noreferrer">Open ChatGPT sign-in ↗</a></div>
            <p id="enrollment-status" role="status"/>
            <Button variant="outline" id="enrollment-cancel" type="button" hidden>Cancel sign-in</Button>
            <Button variant="outline" id="enrollment-check" type="button" hidden>Check sign-in</Button>
            <Button id="enrollment-start" type="button" disabled>Continue with ChatGPT</Button>
        </Card>
    </div>;
}
