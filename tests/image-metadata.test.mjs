import test from 'node:test';
import assert from 'node:assert/strict';
import {bindImageReceipt,validateImageMetadata,encodedDimensions} from '../resources/js/image-metadata.js';
const expected={id:'11111111-1111-4111-8111-111111111111',name:'image.png',sha256:'a'.repeat(64),byte_size:100,media_type:'image/png',width:1,height:1};
test('receipt binds every immutable field and rejects malformed bounds',()=>{
 assert.equal(bindImageReceipt({...expected},expected).id,expected.id);
 for(const field of Object.keys(expected)){const changed={...expected,[field]:typeof expected[field]==='number'?expected[field]+1:'changed'};assert.throws(()=>bindImageReceipt(changed,expected));}
 for(const number of [NaN,Infinity,-1,0,4194305])assert.throws(()=>validateImageMetadata({...expected,byte_size:number}));
 for(const number of [NaN,Infinity,-1,0,8193])assert.throws(()=>validateImageMetadata({...expected,width:number}));
 assert.throws(()=>validateImageMetadata({...expected,sha256:'A'.repeat(64)}));assert.throws(()=>validateImageMetadata({...expected,media_type:'image/svg+xml'}));
});
test('encoded dimensions are container dimensions not decoded orientation',()=>{
 const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10],0);bytes.set([73,72,68,82],12);const view=new DataView(bytes.buffer);view.setUint32(16,3);view.setUint32(20,7);assert.deepEqual(encodedDimensions(bytes,'image/png'),{width:3,height:7});assert.throws(()=>encodedDimensions(bytes,'image/webp'));
});

test('metadata does not coerce object IDs/hashes or accept unsafe UTF-8 labels',()=>{
 for(const field of ['id','sha256'])assert.throws(()=>validateImageMetadata({...expected,[field]:{toString:()=>expected[field]}}));
 for(const name of ['界'.repeat(86),'../path','hidden\u202e',''])assert.throws(()=>validateImageMetadata({...expected,name}));
});

test('history rejects tiny fragment responses before a second read',async()=>{
 const {imageBytes}=await import('../resources/js/attachments.js');let calls=0;
 const client={exchange:async()=>{calls++;return {protocol:1,outcome_unknown:false,result:{session_id:'s',incarnation:'i',result:{metadata:expected,offset:0,data_base64:'YQ=='}}};}};
 await assert.rejects(imageBytes(client,expected,{session_id:'s'}),/chunk/);assert.equal(calls,1);
});

test('prepared metadata rejects allocation before reading invalid input',async()=>{
 const {preparedMetadata}=await import('../resources/js/image-metadata.js');
 for(const [blob,name,id] of [[new Blob([new Uint8Array(4194305)],{type:'image/png'}),'p.png',expected.id],[new Blob(['x'],{type:'image/svg+xml'}),'p.png',expected.id],[new Blob(['x'],{type:'image/png'}),'../bad',expected.id],[new Blob(['x'],{type:'image/png'}),'p.png','bad']]){
  let reads=0;blob.arrayBuffer=async()=>{reads++;throw Error('must not allocate');};await assert.rejects(preparedMetadata(blob,name,id));assert.equal(reads,0);
 }
});
test('history timeout uses controllable clock and clears its timer',async()=>{
 const {imageBytes}=await import('../resources/js/attachments.js');let cancelled=0;
 await assert.rejects(imageBytes({exchange:()=>new Promise(()=>{})},expected,{session_id:'s',now:()=>0,schedule:(callback)=>{queueMicrotask(callback);return 1;},cancel:()=>cancelled++}),/timed out/);assert.equal(cancelled,1);
});
