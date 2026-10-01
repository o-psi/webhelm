import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {vesselUpdate} from '../resources/js/vessel-update.js';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {VesselUpdateMarkup} from '../resources/react/VesselUpdate.tsx';

const latest={stable:{phase:'published',version:'v1.0.3'},nightly:{phase:'published',version:'1.0.4-nightly.20260928.1.1'}};
const releaseInfo=(channel:string)=>latest[channel as keyof typeof latest];
const settle=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setTimeout(r,2));};
const reply=(result:any)=>({protocol:1,error:null,outcome_unknown:false,result});
const id='10000000-0000-4000-8000-000000000001';
const hash='a'.repeat(64);
function fixture(t:any, installed='1.0.2') {
 const dom=new JSDOM('<div id="helm-client" data-tenant-id="update-test">'+renderToStaticMarkup(React.createElement(VesselUpdateMarkup,{installed}))+'</div>',{url:'https://helm.example'});
 t.after(()=>dom.window.close());
 for(const key of ['window','document','localStorage','Event'])globalThis[key]=dom.window[key];
 const root=document.querySelector('#helm-client')!;
 return {root,$:(id:string)=>root.querySelector(`#${id}`) as HTMLElement};
}
const controls=(t:any, root:any, resume=()=>{})=>{
 const controller=vesselUpdate(root,{show:()=>{},resume,releaseInfo});
 t.after(()=>controller.dispose());
 return controller;
};
const vessel=(exchange:any)=>({id:'v',vessel_id:'identity',name:'HelmWeb',client:{exchange}});
const capabilities=(version='1.0.2')=>({remote_updates:true,scope:'owner',version,features:['verified_user_updates']});

test('channel starts on the installed channel and displays its latest version',async t=>{
 const {root,$}=fixture(t,'1.0.4-nightly.20260927.1.1');
 const update=controls(t,root);
 update.bind(vessel(async()=>reply({phase:'idle'})),capabilities('1.0.4-nightly.20260927.1.1'));
 assert.equal(($('update-channel') as HTMLSelectElement).value,'nightly');
 assert.match($('update-selected-version').textContent!,/1\.0\.4-nightly\.20260928/);
 assert.equal(($('update-check') as HTMLButtonElement).disabled,false);
});

test('one click prepares and applies only the exact selected version',async t=>{
 const {root,$}=fixture(t),seen:any[]=[];
 let record:any={phase:'idle'};
 const c=vessel(async({command}:any)=>{
   seen.push(command);
   if(command.op==='update_prepare')record={operation_id:command.operation_id,channel:command.channel,phase:'ready',version:'1.0.3',release_id:hash,expires_at:Math.floor(Date.now()/1000)+1800,description:'Verified build'};
   if(command.op==='update_apply')record={...record,phase:'complete'};
   if(command.op==='capabilities')return reply({...capabilities('1.0.3'),vessel_id:'identity',running_release:hash,features:['execution_profiles','verified_user_updates']});
   return reply(structuredClone(record));
 });
 let resumed=0;const update=controls(t,root,()=>{resumed++;});
 update.bind(c,capabilities());
 assert.match($('update-selected-version').textContent!,/v1\.0\.3/);
 $('update-check').click();await settle();
 assert.equal(seen.filter(x=>x.op==='update_prepare').length,1);
 assert.equal(seen.filter(x=>x.op==='update_apply').length,1);
 assert.equal(seen.find(x=>x.op==='update_apply').release_id,hash);
 assert.equal($('update-continue').hidden,false);
 assert.match($('update-status').textContent!,/Reconnected to the verified Vessel version/);
 update.bind(c,capabilities('1.0.3'));await settle();
 assert.equal(seen.filter(x=>x.op==='update_apply').length,1,'reopening never repeats approval');
 $('update-continue').click();assert.equal(resumed,1);
});

test('a changed prepared version stops before installation',async t=>{
 const {root,$}=fixture(t),seen:any[]=[];
 let record:any={phase:'idle'};
 const c=vessel(async({command}:any)=>{
   seen.push(command);
   if(command.op==='update_prepare')record={operation_id:command.operation_id,channel:'stable',phase:'ready',version:'1.0.4',release_id:hash,expires_at:Math.floor(Date.now()/1000)+1800};
   return reply(structuredClone(record));
 });
 const update=controls(t,root);update.bind(c,capabilities());$('update-check').click();await settle();
 assert.equal(seen.filter(x=>x.op==='update_apply').length,0);
 assert.match($('update-status').textContent!,/different build/);
 assert.equal($('update-review').hidden,false);
});

test('a lost apply reply is observed and never retried automatically',async t=>{
 const {root,$}=fixture(t),seen:any[]=[];
 let record:any={phase:'idle'};
 const c=vessel(async({command}:any)=>{
   seen.push(command);
   if(command.op==='update_prepare')record={operation_id:command.operation_id,channel:'stable',phase:'ready',version:'v1.0.3',release_id:hash,expires_at:Math.floor(Date.now()/1000)+1800};
   if(command.op==='update_apply')throw Error('Disconnected');
   return reply(structuredClone(record));
 });
 const update=controls(t,root);update.bind(c,capabilities());$('update-check').click();await settle();
 assert.equal(seen.filter(x=>x.op==='update_apply').length,1);
 assert.match($('update-status').textContent!,/approval was not repeated/i);
 $('update-refresh').click();await settle();
 assert.equal(seen.filter(x=>x.op==='update_apply').length,1);
});

test('one click replaces an expired prepared build and continues',async t=>{
 const {root,$}=fixture(t),seen:any[]=[];
 let record:any={operation_id:id,phase:'ready',channel:'stable',version:'v1.0.2',release_id:hash,expires_at:Math.floor(Date.now()/1000)-1};
 localStorage.setItem('helm-web:update:update-test:v:identity',JSON.stringify({operation_id:id}));
 const c=vessel(async({command}:any)=>{
   seen.push(command);
   if(command.op==='update_discard')record={...record,phase:'discarded'};
   if(command.op==='update_prepare')record={operation_id:command.operation_id,channel:'stable',phase:'ready',version:'v1.0.3',release_id:hash,expires_at:Math.floor(Date.now()/1000)+1800};
   if(command.op==='update_apply')record={...record,phase:'applying'};
   return reply(structuredClone(record));
 });
 const update=controls(t,root);update.bind(c,capabilities());await settle();
 assert.match($('update-status').textContent!,/no longer valid/);
 $('update-check').click();await settle();
 assert.deepEqual(seen.filter(x=>x.op!=='update_status').map(x=>x.op),['update_discard','update_prepare','update_apply']);
 assert.equal(seen.find(x=>x.op==='update_apply').release_id,hash);
});

test('reload observes a saved ready build without reusing a previous click',async t=>{
 const {root,$}=fixture(t),seen:any[]=[];
 const record={operation_id:id,phase:'ready',channel:'stable',version:'v1.0.3',release_id:hash,expires_at:Math.floor(Date.now()/1000)+1800};
 localStorage.setItem('helm-web:update:update-test:v:identity',JSON.stringify({operation_id:id}));
 const c=vessel(async({command}:any)=>{seen.push(command);return reply(record);});
 const update=controls(t,root);update.bind(c,capabilities());await settle();
 assert.equal(seen.filter(x=>x.op==='update_apply').length,0);
 assert.equal($('update-review').hidden,false);
 $('update-check').click();await settle();
 assert.equal(seen.filter(x=>x.op==='update_apply').length,1);
});

test('an installed current channel version disables Update',t=>{
 const {root,$}=fixture(t,'1.0.3');
 const update=controls(t,root);update.bind(vessel(async()=>reply({phase:'idle'})),capabilities('1.0.3'));
 assert.equal(($('update-check') as HTMLButtonElement).disabled,true);
 assert.match($('update-check').textContent!,/Already up to date/);
});

test('legacy stable and nightly advertisements refuse all new update effects',async t=>{
 for(const version of ['1.0.2','1.0.3-nightly.20260928.1.1']){
  const {root,$}=fixture(t,version),seen:any[]=[];
  const c=vessel(async({command}:any)=>{seen.push(command);return reply({phase:'idle'});});
  const update=controls(t,root);update.bind(c,{remote_updates:true,scope:'owner',version,features:['execution_profiles']});
  assert.equal($('update-source').hidden,true);
  assert.equal(($('update-check') as HTMLButtonElement).disabled,true);
  assert.equal($('update-review').hidden,true);
  assert.match($('update-status').textContent!,/current verified installer/);
  assert.match($('update-status').textContent!,/approved host installer route/);
  // Callback gates apply even to a synthetic event on a disabled button.
  for(const name of ['update-check','update-discard','update-refresh','setup-update-open'])$(name).dispatchEvent(new Event('click',{bubbles:true}));
  update.releasesChanged();await settle();
  assert.deepEqual(seen,[],'no nil status or preparation is sent to a legacy controller without a saved operation');
  assert.ok(c.client,'normal connection is retained');
 }
});

test('verified feature alone cannot broaden owner or remote-update authority',async t=>{
 for(const caps of [{...capabilities(),scope:'workspaces'}, {...capabilities(),remote_updates:false},
                    {...capabilities(),features:'verified_user_updates'}, {...capabilities(),features:['future_verified_user_updates']}]){
  const {root,$}=fixture(t),seen:any[]=[];
  const update=controls(t,root);update.bind(vessel(async({command}:any)=>{seen.push(command);return reply({phase:'idle'});}),caps);
  $('update-check').dispatchEvent(new Event('click',{bubbles:true}));await settle();
  assert.equal($('update-source').hidden,true);assert.deepEqual(seen,[]);
 }
});

test('legacy pending ready and unconfirmed operations retain exact status without apply or discard',async t=>{
 for(const phase of ['ready','unconfirmed']){
  const {root,$}=fixture(t),seen:any[]=[];
  const key='helm-web:update:update-test:v:identity';localStorage.setItem(key,JSON.stringify({operation_id:id}));
  const record={operation_id:id,phase,channel:'stable',version:'1.0.3',release_id:hash,
   expires_at:Math.floor(Date.now()/1000)+1800,message:phase==='unconfirmed'?'Original update remains unconfirmed.':null};
  const c=vessel(async({command}:any)=>{seen.push(command);return reply(record);});
  const update=controls(t,root);update.bind(c,{remote_updates:true,scope:'owner',version:'1.0.2',features:[]});await settle();
  assert.equal($('update-refresh').hidden,false);
  assert.equal($('update-review').hidden,true);
  assert.match($('update-status').textContent!,/current verified installer/);
  assert.match($('update-status').textContent!,phase==='unconfirmed'?/Original update remains unconfirmed/:/saved preparation remains available/);
  for(const name of ['update-check','update-discard'])$(name).dispatchEvent(new Event('click',{bubbles:true}));
  $('update-refresh').click();await settle();
  assert.ok(seen.length>=2);assert.ok(seen.every(command=>command.op==='update_status'&&command.operation_id===id));
  assert.deepEqual(JSON.parse(localStorage.getItem(key)!),{operation_id:id});
 }
});

test('legacy status refusal preserves the saved identity and installer guidance',async t=>{
 const {root,$}=fixture(t),seen:any[]=[];const key='helm-web:update:update-test:v:identity';
 localStorage.setItem(key,JSON.stringify({operation_id:id}));
 const update=controls(t,root);update.bind(vessel(async({command}:any)=>{
  seen.push(command);return {protocol:1,error:'not available',outcome_unknown:false,result:null};
 }),{remote_updates:true,scope:'owner',version:'1.0.2',features:[]});await settle();
 assert.match($('update-status').textContent!,/current verified installer/);
 assert.match($('update-status').textContent!,/could not confirm/);
 assert.deepEqual(JSON.parse(localStorage.getItem(key)!),{operation_id:id});
 assert.deepEqual(seen.map(c=>[c.op,c.operation_id]),[['update_status',id]]);
 const blocked=fixture(t),denied:any[]=[];
 localStorage.setItem(key,JSON.stringify({operation_id:id}));
 const noStatus=controls(t,blocked.root);noStatus.bind(vessel(async({command}:any)=>{denied.push(command);return reply({phase:'idle'});}),
  {remote_updates:false,scope:'owner',version:'1.0.0',features:[]});await settle();
 assert.match(blocked.$('update-status').textContent!,/cannot check its status/);
 assert.equal(blocked.$('update-refresh').hidden,true);assert.deepEqual(denied,[]);
 assert.deepEqual(JSON.parse(localStorage.getItem(key)!),{operation_id:id});
});

test('capability loss during prepare blocks delayed apply and restoring it needs a new click',async t=>{
 const {root,$}=fixture(t),seen:any[]=[];let resolve:any;
 let record:any={phase:'idle'};
 const c=vessel(async({command}:any)=>{
  seen.push(command);
  if(command.op==='update_prepare'){record={operation_id:command.operation_id,phase:'preparing'};return new Promise(r=>{resolve=r;});}
  if(command.op==='update_apply')record={...record,phase:'applying'};
  return reply(structuredClone(record));
 });
 const update=controls(t,root);update.bind(c,capabilities());$('update-check').click();
 const operation=seen.find(command=>command.op==='update_prepare').operation_id;
 update.bind(c,{remote_updates:true,scope:'owner',version:'1.0.2',features:[]});await settle();
 record={operation_id:operation,phase:'ready',channel:'stable',version:'1.0.3',release_id:hash,expires_at:Math.floor(Date.now()/1000)+1800};
 resolve(reply(record));await settle();
 assert.equal(seen.filter(command=>command.op==='update_apply').length,0);
 assert.match($('update-status').textContent!,/current verified installer/);
 assert.doesNotMatch($('update-status').textContent!,/Installation follows automatically/);
 update.bind(c,capabilities());await settle();
 assert.equal(seen.filter(command=>command.op==='update_apply').length,0,'capability recovery does not revive old in-memory approval');
 $('update-check').click();await settle();
 assert.equal(seen.filter(command=>command.op==='update_prepare').length,1,'the saved exact preparation is retained');
 assert.deepEqual(seen.filter(command=>command.op==='update_apply').map(command=>[command.operation_id,command.release_id]),[[operation,hash]]);
});

test('a verified completed legacy operation permits normal review while new effects stay gated',async t=>{
 const {root,$}=fixture(t),seen:any[]=[];let resumed=0;
 localStorage.setItem('helm-web:update:update-test:v:identity',JSON.stringify({operation_id:id}));
 const c=vessel(async({command}:any)=>{
  seen.push(command);
  if(command.op==='capabilities')return reply({vessel_id:'identity',version:'1.0.3',scope:'owner',remote_updates:true,
   running_release:hash,features:['execution_profiles']});
  return reply({operation_id:id,phase:'complete',release_id:hash});
 });
 const update=controls(t,root,()=>{resumed++;});update.bind(c,{remote_updates:true,scope:'owner',version:'1.0.2',features:[]});await settle();
 assert.equal($('update-continue').hidden,false);assert.equal($('update-source').hidden,true);
 assert.match($('update-status').textContent!,/current verified installer/);
 assert.match($('update-status').textContent!,/Reconnected to the verified Vessel version/);
 $('update-continue').click();assert.equal(resumed,1);
 assert.ok(seen.every(command=>['update_status','capabilities'].includes(command.op)));
});

test('switching Vessel drops stale replies and owner-only controls stay unavailable',async t=>{
 const {root,$}=fixture(t);let resolve:any;
 const c={id:'a',vessel_id:'a',name:'A',client:{exchange:()=>new Promise(r=>{resolve=r;})}};
 const update=controls(t,root);update.bind(c,capabilities());$('update-check').click();
 update.bind({id:'b',vessel_id:'b',name:'B'},{remote_updates:false,scope:'workspaces'});
 resolve(reply({phase:'ready',release_id:hash,version:'wrong Vessel'}));await settle();
 assert.equal($('update-review').hidden,true);
 assert.match($('update-status').textContent!,/account owner/);
 assert.match($('update-vessel-name').textContent!,/B/);
});

test('update transport accepts only fixed typed requests and owner capability',async()=>{
 const {validCommand,restrictCapabilities}=await import('../gateway/protocol.js');
 const frame=(command:any)=>({type:'command',request_id:id,request:{protocol:1,command}});
 for(const command of [{op:'update_prepare',operation_id:id,channel:'nightly'},{op:'update_status',operation_id:id},{op:'update_apply',operation_id:id,release_id:hash},{op:'update_discard',operation_id:id}]) {
   assert.equal(validCommand(frame(command)),true);
   assert.equal(validCommand(frame({...command,url:'https://untrusted.example/program'})),false);
   assert.equal(validCommand(frame({...command,command:'anything'})),false);
 }
 assert.equal(validCommand(frame({op:'update_prepare',operation_id:id,channel:'arbitrary'})),false);
 assert.equal(validCommand(frame({op:'update_apply',operation_id:id,release_id:'changed'})),false);
 const caps={protocol:1,vessel_id:id,scope:'workspaces',features:[],remote_updates:true,running_release:hash};
 assert.equal(restrictCapabilities(caps,id).remote_updates,false);
 assert.equal(restrictCapabilities({...caps,scope:'owner'},id).remote_updates,true);
 const explicit={...caps,scope:'owner',features:['verified_user_updates','execution_profiles','unknown_future_execution']};
 assert.deepEqual(restrictCapabilities(explicit,id).features,['verified_user_updates','execution_profiles']);
 assert.equal(restrictCapabilities({...explicit,scope:'workspaces'},id).remote_updates,false);
});

test('disposed controls ignore late replies and dispatch nothing else',async t=>{
 const {root,$}=fixture(t);let resolve:any;const seen:string[]=[];
 const c=vessel(({command}:any)=>{seen.push(command.op);return new Promise(r=>{resolve=r;});});
 const update=controls(t,root);update.bind(c,capabilities());$('update-check').click();update.dispose();
 resolve(reply({phase:'ready',channel:'stable',version:'v1.0.3',release_id:hash}));await settle();
 $('update-check').click();$('update-refresh').click();assert.deepEqual(seen,['update_prepare']);
});
