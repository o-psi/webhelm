import test from 'node:test';
import assert from 'node:assert/strict';
import {requireImageModel} from '../resources/react/image-preflight';
const account={account_id:'a',connection_id:'c',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'};
test('selected image metadata is account-bound and unknown models fail closed without name fallback',()=>{
 requireImageModel({account,models:[{id:'selected',input_modalities:['text','image']}]},account,'selected');
 for(const models of [[],[{id:'gpt-4o'}],[{id:'selected',input_modalities:['text']}],[{id:'other',input_modalities:['image']}],[{id:'selected',input_modalities:'image'}]])assert.throws(()=>requireImageModel({account,models},account,'selected'),/confirmed/);
 assert.throws(()=>requireImageModel({account:{...account,identity_generation:2},models:[{id:'selected',input_modalities:['image']}]},account,'selected'),/account changed/);
});

test('actual Workspace preflight blocks upload on missing metadata and client replacement',async()=>{
 const {Workspace}=await import('../resources/react/workspace');
 const {IntentJournal}=await import('../resources/js/vessel-client.js');
 const {preparedMetadata}=await import('../resources/js/image-metadata.js');
 const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ0AAAAASUVORK5CYII='),c=>c.charCodeAt(0));
 for(const mode of ['missing','replacement','unknown','valid','tampered']){
  const data=new Map<string,string>(),storage:any={get length(){return data.size;},key:(i:number)=>[...data.keys()][i],getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)};
  const calls:string[]=[];let connection:any;const inference={account,model:'selected'};
  const client={exchange:async({command}:any)=>{calls.push(command.op);const reply=(result:any)=>({protocol:1,outcome_unknown:false,result:{session_id:'s',incarnation:'i',result}});
   if(command.op==='capabilities')return {protocol:1,outcome_unknown:false,result:{scope:'owner'}};
   if(command.op==='snapshot')return reply({session_id:'s',workspace:'/work',revision:1,inference,run:{state:'idle'},messages:[]});
   if(command.op==='decisions')return reply([]);
   if(command.op==='account_models'){if(mode==='replacement')connection.client={};return {protocol:1,outcome_unknown:false,result:{account,models:[{id:'selected',input_modalities:mode==='missing'?[]:['image']}]}};}
   if(command.op==='upload_image'){if(mode==='unknown')throw Error('lost');const expected=await preparedMetadata(new Blob([png],{type:'image/png'}),command.name,command.upload_id);return reply({...expected,byte_size:mode==='tampered'?expected.byte_size+1:expected.byte_size});}
   return reply({command_id:command.command_id,status:'accepted'});
  },subscribe:()=>()=>{}};
  connection={id:'v',client,journal:new IntentJournal(storage,'image-test'),voyages:[]};const workspace=new Workspace(()=>new Map([['v',connection]]));const key=workspace.open('v','s','S');await workspace.refresh(key);workspace.draft(key,'Keep');assert.equal(await workspace.attach(key,[new File([png],'photo.png',{type:'image/png'})]),true);
  await workspace.act(key,'submit');
  if(mode==='valid')assert.equal(workspace.tabs.get(key)!.draft,'');else assert.equal(workspace.tabs.get(key)!.draft,'Keep');
  if(['missing','replacement'].includes(mode))assert.equal(calls.includes('upload_image'),false);
  if(['unknown','tampered'].includes(mode)){assert.equal(workspace.tabs.get(key)!.pictures[0].state,'uncertain');await workspace.act(key,'submit');assert.equal(calls.filter(op=>op==='upload_image').length,1);}
  workspace.close();
 }
});

test('preflight rejects absent and explicitly non-image metadata without fallback',()=>{
 for(const model of [undefined,null,{id:'selected',input_modalities:[]},{id:'selected',input_modalities:[null]}])assert.throws(()=>requireImageModel({account,models:model?[model]:[]},account,'selected'));
});
