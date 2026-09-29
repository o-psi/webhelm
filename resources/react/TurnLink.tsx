import React,{useState} from 'react';
import {LinkIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {voyagePath} from './voyage-url';
import type {Tab} from './workspace';

// Message indices may change on clear/compaction. Pin links to the reviewed revision.
export function turnHash(vessel:string,session:string,index:number,revision:number){
    if(!Number.isSafeInteger(index)||index<0||!Number.isSafeInteger(revision)||revision<0)throw new Error('Message identity unavailable.');
    return `#turn-${vessel}-${session}-${index}-r${revision}`;
}
export function linkedTurn(hash:string,vessel:string,session:string):{index:number;revision:number}|null{
    const match=/^#turn-([0-9a-f-]{36})-([0-9a-f-]{36})-(\d+)-r(\d+)$/i.exec(hash);
    if(!match||match[1].toLowerCase()!==vessel?.toLowerCase()||match[2].toLowerCase()!==session?.toLowerCase())return null;
    const index=Number(match[3]),revision=Number(match[4]);
    return Number.isSafeInteger(index)&&Number.isSafeInteger(revision)?{index,revision}:null;
}
export function TurnLink({tab,message}:{tab:Tab;message:any}){
    const [notice,setNotice]=useState('');
    if(!Number.isSafeInteger(message.message_index)||!Number.isSafeInteger(tab.snapshot?.revision))return null;
    return <span><Button variant="ghost" size="sm" type="button" aria-label="Copy message link" title="Link to this message at the observed conversation revision" onClick={async()=>{
        try{
            const url=new URL(voyagePath(tab.vessel,tab.session),window.location.origin);
            url.hash=turnHash(tab.vessel,tab.session,message.message_index,tab.snapshot.revision);
            await navigator.clipboard.writeText(url.href);setNotice('Message link copied.');
        }catch{setNotice('Message link could not be copied.');}
    }}><LinkIcon aria-hidden="true"/><span>Link</span></Button><span className="sr-only" role="status">{notice}</span></span>;
}
