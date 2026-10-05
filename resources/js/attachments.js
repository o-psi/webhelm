import {validateImageMetadata,bindImageReceipt,encodedDimensions} from './image-metadata.js';
import {request,voyageResult} from './vessel-client.js';
export const imageTypes=['image/png','image/jpeg','image/webp'];
export async function imageBytes(client, attachment, {session_id,now=Date.now,schedule=setTimeout,cancel=clearTimeout,assertCurrent=()=>{}}={}) {
    assertCurrent();validateImageMetadata(attachment);
    const chunks=[]; let offset=0,requests=0;const deadline=now()+30000;
    while(offset<attachment.byte_size) {
        assertCurrent();if(++requests>64||now()>deadline)throw Error('Image history read budget exceeded.');
        let timer;let response;
        try{response=await Promise.race([client.exchange(request('read_artifact',{session_id,artifact_id:attachment.id,offset,limit:65536})),new Promise((_,reject)=>{timer=schedule(()=>reject(Error('Image read timed out.')),Math.max(1,deadline-now()));})]);}finally{cancel(timer);}
        assertCurrent();const value=voyageResult(response,session_id).result;
        bindImageReceipt(value.metadata,attachment);
        if(typeof value.data_base64!=='string'||value.data_base64.length>87384)throw Error('Invalid bounded image chunk.');
        const bytes=Uint8Array.from(atob(value.data_base64),c=>c.charCodeAt(0));
        if(value.offset!==offset || bytes.length!==Math.min(65536,attachment.byte_size-offset) || offset+bytes.length>attachment.byte_size) throw new Error('Invalid image chunk.');
        if(value.next_offset!==offset+bytes.length||value.eof!==(offset+bytes.length===attachment.byte_size))throw Error('Invalid image continuation.');
        offset+=bytes.length; chunks.push(bytes);
    }
    const blob=new Blob(chunks,{type:attachment.media_type});
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),v=>v.toString(16).padStart(2,'0')).join('');
    assertCurrent();if(hash!==attachment.sha256) throw new Error('Image integrity check failed.');
    const dimensions=encodedDimensions(new Uint8Array(await blob.arrayBuffer()),attachment.media_type);
    if(dimensions.width!==attachment.width||dimensions.height!==attachment.height)throw Error('Image dimensions do not match authorized metadata.');
    assertCurrent();return blob;
}
