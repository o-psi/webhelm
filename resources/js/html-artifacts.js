import {request,voyageResult} from './vessel-client.js';
// Authoritative metadata, byte continuation, digest and current authorization
// are checked independently of the untrusted HTML before mounting any frame.
export async function htmlArtifactBytes(client,a,{session_id,assertCurrent,now=Date.now,schedule=setTimeout,cancel=clearTimeout}){
    if(!a||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.id)||a.mime_type!=='text/html'||a.name!=='visual-reply.html'||!Number.isSafeInteger(a.byte_size)||a.byte_size<1||a.byte_size>131072||! /^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid visual artifact.');
    const bytes=new Uint8Array(a.byte_size),deadline=now()+10000;
    let offset=0;
    while(offset<bytes.length){
        assertCurrent();if(now()>=deadline)throw Error('Visual artifact read timed out.');
        let timer;
        const response=await Promise.race([client.exchange(request('read_artifact',{session_id,artifact_id:a.id,offset,limit:65536})),new Promise((_,reject)=>{timer=schedule(()=>reject(Error('Visual artifact read timed out.')),deadline-now());})]).finally(()=>cancel(timer));
        assertCurrent();const value=voyageResult(response,session_id).result;
        if(['id','sha256','name','mime_type','byte_size'].some(key=>value.metadata?.[key]!==a[key])||typeof value.data_base64!=='string'||value.data_base64.length>87384)throw Error('Visual artifact identity changed.');
        const chunk=Uint8Array.from(atob(value.data_base64),c=>c.charCodeAt(0));
        if(value.offset!==offset||chunk.length!==Math.min(65536,bytes.length-offset)||value.next_offset!==offset+chunk.length||value.eof!==(offset+chunk.length===bytes.length))throw Error('Invalid visual artifact continuation.');
        bytes.set(chunk,offset);offset+=chunk.length;
    }
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    assertCurrent();if(digest!==a.sha256)throw Error('Visual artifact integrity check failed.');
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
