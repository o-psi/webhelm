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
const capabilities=(version='1.0.2')=>({remote_updates:true,scope:'owner',version});

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
   if(command.op==='capabilities')return reply({vessel_id:'identity',version:'1.0.3',running_release:hash,features:['execution_profiles']});
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
});

test('disposed controls ignore late replies and dispatch nothing else',async t=>{
 const {root,$}=fixture(t);let resolve:any;const seen:string[]=[];
 const c=vessel(({command}:any)=>{seen.push(command.op);return new Promise(r=>{resolve=r;});});
 const update=controls(t,root);update.bind(c,capabilities());$('update-check').click();update.dispose();
 resolve(reply({phase:'ready',channel:'stable',version:'v1.0.3',release_id:hash}));await settle();
 $('update-check').click();$('update-refresh').click();assert.deepEqual(seen,['update_prepare']);
});
