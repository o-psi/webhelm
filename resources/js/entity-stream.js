// Staged event-only entity content. Integrity is not authority or a bootstrap barrier.
// Domain adapters must validate typed content before installing it in client state.
export const MAX_ENTITY_BYTES=8*1024*1024;
export const MAX_CHUNK_BYTES=4096;
export const ENTITY_KINDS=Object.freeze(['session_settings','run','message','turn','decision','account','profile','model','goal','context','artifact','browser','terminal','update','notification','participant','assignment','execution_review','transfer','workspace','command_outcome']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL='00000000-0000-0000-0000-000000000000';
const encoder=new TextEncoder();
export class EntityStreamError extends Error {
    constructor(code){super(code);this.name='EntityStreamError';this.code=code;}
}
const fail=code=>{throw new EntityStreamError(code);};
function keys(value,allowed,required=allowed){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(value,key)))fail('invalid_frame');
}
function uuid(value){if(typeof value!=='string'||!UUID.test(value)||value.toLowerCase()===NIL)fail('invalid_identity');return value.toLowerCase();}
function scope(value){
    keys(value,['vessel_id','session_id','incarnation'],['vessel_id']);
    const vessel_id=uuid(value.vessel_id),session_id=value.session_id??null,incarnation=value.incarnation??null;
    if((session_id===null)!==(incarnation===null))fail('wrong_scope');
    return Object.freeze({vessel_id,session_id:session_id===null?null:uuid(session_id),incarnation:incarnation===null?null:uuid(incarnation)});
}
const equalScope=(a,b)=>a.vessel_id===b.vessel_id&&a.session_id===b.session_id&&a.incarnation===b.incarnation;
const equalManifest=(a,b)=>a.stream_id===b.stream_id&&equalScope(a.scope,b.scope)&&a.kind===b.kind&&a.key===b.key&&a.byte_size===b.byte_size&&a.sha256===b.sha256;
function manifest(value){
    keys(value,['stream_id','scope','kind','key','byte_size','sha256']);
    if(!ENTITY_KINDS.includes(value.kind)||typeof value.key!=='string'||!/^[A-Za-z0-9_:.-]{1,128}$/.test(value.key)||!Number.isSafeInteger(value.byte_size)||value.byte_size<0||value.byte_size>MAX_ENTITY_BYTES||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))fail('invalid_manifest');
    return Object.freeze({...value,stream_id:uuid(value.stream_id),scope:scope(value.scope)});
}
function utf8(text){
    if(typeof text!=='string')fail('invalid_chunk');
    for(let i=0;i<text.length;i++){
        const code=text.charCodeAt(i);
        if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))fail('invalid_chunk');}
        else if(code>=0xdc00&&code<=0xdfff)fail('invalid_chunk');
    }
    const bytes=encoder.encode(text);
    if(!bytes.length||bytes.length>MAX_CHUNK_BYTES)fail('invalid_chunk');
    return bytes;
}
function frame(value){
    if(value?.type==='entity_start'){keys(value,['type','manifest']);return {type:value.type,manifest:manifest(value.manifest)};}
    if(value?.type==='entity_chunk'){
        keys(value,['type','stream_id','offset','text']);
        if(!Number.isSafeInteger(value.offset)||value.offset<0||value.offset>0xffffffff)fail('invalid_chunk');
        return {type:value.type,stream_id:uuid(value.stream_id),offset:value.offset,bytes:utf8(value.text)};
    }
    if(['entity_end','entity_abort'].includes(value?.type)){keys(value,['type','stream_id']);return {type:value.type,stream_id:uuid(value.stream_id)};}
    fail('invalid_frame');
}
function equalBytes(existing,offset,bytes){return offset+bytes.length<=existing.length&&bytes.every((value,index)=>existing[offset+index]===value);}

export class EntityReceiver {
    #scope;#streamId;#invalidated=false;#pending=null;#completed=null;#tail=Promise.resolve();#queued=0;#epoch=0;
    constructor(expectedScope,expectedStreamId){this.#scope=scope(expectedScope);this.#streamId=uuid(expectedStreamId);}
    invalidate(){this.#pending=null;this.#completed=null;this.#epoch++;this.#invalidated=true;}
    // A bounded serialized queue prevents asynchronous digest work from crossing streams.
    accept(value){
        if(this.#invalidated)return Promise.reject(new EntityStreamError('stream_invalidated'));
        let event;
        try{event=frame(value);}catch(error){this.invalidate();return Promise.reject(error);}
        if((event.type==='entity_start'?event.manifest.stream_id:event.stream_id)!==this.#streamId){this.invalidate();return Promise.reject(new EntityStreamError('unknown_stream'));}
        if(this.#queued>=32){this.invalidate();return Promise.reject(new EntityStreamError('stream_overloaded'));}
        const epoch=this.#epoch;this.#queued++;
        const result=this.#tail.then(async()=>{
            if(epoch!==this.#epoch)fail('stream_invalidated');
            try{return await this.#apply(event,epoch);}catch(error){this.invalidate();throw error;}
        });
        this.#tail=result.catch(()=>{});
        return result.finally(()=>{this.#queued--;});
    }
    async #apply(event,epoch){
        if(event.type==='entity_start'){
            const start=event.manifest;
            if(!equalScope(start.scope,this.#scope))fail('wrong_scope');
            if(this.#pending){if(!equalManifest(this.#pending.manifest,start))fail('conflicting_start');return null;}
            if(this.#completed?.manifest.stream_id===start.stream_id){if(!equalManifest(this.#completed.manifest,start))fail('conflicting_start');return null;}
            this.#pending={manifest:start,bytes:new Uint8Array(start.byte_size),received:0};return null;
        }
        if(event.type==='entity_chunk'){
            const {stream_id,offset,bytes}=event;
            if(this.#pending){
                const pending=this.#pending;
                if(pending.manifest.stream_id!==stream_id)fail('unknown_stream');
                if(offset>pending.received||offset+bytes.length>pending.bytes.length)fail('invalid_chunk');
                if(offset<pending.received){if(!equalBytes(pending.bytes.subarray(0,pending.received),offset,bytes))fail('conflicting_chunk');return null;}
                pending.bytes.set(bytes,offset);pending.received+=bytes.length;return null;
            }
            if(this.#completed?.manifest.stream_id===stream_id){if(!equalBytes(this.#completed.bytes,offset,bytes))fail('conflicting_chunk');return null;}
            fail('unknown_stream');
        }
        if(event.type==='entity_abort'){
            if(this.#pending?.manifest.stream_id!==event.stream_id&&this.#completed?.manifest.stream_id!==event.stream_id)fail('unknown_stream');
            this.invalidate();return null;
        }
        if(this.#completed?.manifest.stream_id===event.stream_id)return null;
        const pending=this.#pending;
        if(!pending||pending.manifest.stream_id!==event.stream_id)fail('unknown_stream');
        if(pending.received!==pending.bytes.length)fail('incomplete');
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',pending.bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
        if(epoch!==this.#epoch)fail('stream_invalidated');
        if(digest!==pending.manifest.sha256)fail('digest_mismatch');
        const text=new TextDecoder('utf-8',{fatal:true}).decode(pending.bytes);
        this.#completed={manifest:pending.manifest,bytes:pending.bytes};this.#pending=null;
        return Object.freeze({manifest:pending.manifest,text});
    }
}
