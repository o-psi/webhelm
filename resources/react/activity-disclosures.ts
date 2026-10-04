import {useState} from 'react';

export type DisclosureScope={tenant:string;vessel:string;session:string};
const storageKey='helmweb.activity-disclosures.v1';
export const maxDisclosures=512;
const maxBytes=512*2048;
type RecordEntry=[string,boolean];
function identity(scope:DisclosureScope|undefined,key:string):string|undefined {
    const values=[scope?.tenant,scope?.vessel,scope?.session,key];
    if(values.some(value=>typeof value!=='string'||!value||value.length>256))return;
    return JSON.stringify(values);
}
function read():RecordEntry[] {
    try {
        const raw=window.localStorage.getItem(storageKey);
        if(!raw||raw.length>maxBytes)return [];
        const parsed:unknown=JSON.parse(raw);
        if(!Array.isArray(parsed)||parsed.length>maxDisclosures)return [];
        return parsed.filter((entry):entry is RecordEntry=>Array.isArray(entry)&&entry.length===2&&typeof entry[0]==='string'&&entry[0].length<=2048&&typeof entry[1]==='boolean');
    } catch {return [];}
}
export function disclosureOpen(scope:DisclosureScope|undefined,key:string):boolean {
    const id=identity(scope,key);
    return id?read().find(entry=>entry[0]===id)?.[1]===true:false;
}
export function saveDisclosure(scope:DisclosureScope|undefined,key:string,open:boolean):void {
    const id=identity(scope,key);
    if(!id)return;
    try {
        const entries=read().filter(entry=>entry[0]!==id);
        entries.push([id,open]);
        window.localStorage.setItem(storageKey,JSON.stringify(entries.slice(-maxDisclosures)));
    } catch {/* Storage is optional; disclosure remains usable in memory. */}
}
export function useDisclosure(scope:DisclosureScope|undefined,key:string):[boolean,(open:boolean)=>void] {
    const id=identity(scope,key);
    const [state,setState]=useState(()=>({id,open:disclosureOpen(scope,key)}));
    const open=state.id===id?state.open:disclosureOpen(scope,key);
    return [open,value=>{setState({id,open:value});saveDisclosure(scope,key,value);}];
}
