import {CommandNotSentError,VesselSocket} from '../resources/js/vessel-client.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Creation,accountChoices,vesselRead} from '../resources/react/settings.ts';
class Storage {data=new Map<string,string>();get length(){return this.data.size;}key(i:number){return [...this.data.keys()][i]??null;}getItem(key:string){return this.data.get(key)??null;}setItem(key:string,value:string){this.data.set(key,value);}removeItem(key:string){this.data.delete(key);}clear(){this.data.clear();}}
test('creation uncertainty uses original identity and never submits a prompt',async()=>{
 const storage=new Storage(),creation=new Creation(storage as any,'tenant'),commands:any[]=[];
 const c:any={id:'connection',vessel_id:'vessel',voyages:[],client:{async exchange({command}:any){commands.push(command);if(command.op==='start_account')throw new Error('lost reply');return {protocol:1,outcome_unknown:false,error:null,result:{command_id:command.command_id,session_id:command.session_id,status:'created',process:{session_id:command.session_id,workspace:command.workspace,incarnation:'incarnation'}}};}}};
 await assert.rejects(()=>creation.start(c,'/workspace',{model:'model',account:{account_id:'account'}}));
 await assert.rejects(()=>creation.start(c,'/workspace',{model:'model'}),/unconfirmed/);
 assert.equal(commands.length,1);const record=creation.pending()[0];const process=await creation.reconcile(c,record);
 assert.equal(process.session_id,commands[0].session_id);assert.equal(commands[1].command_id,commands[0].command_id);assert.equal(commands[1].op,'resolve_start_account');assert.equal(storage.length,0);assert.equal(commands.some(c=>c.op==='submit'),false);
});
test('account choices retain full versioned bindings and disable unavailable accounts',()=>{
 const choices=accountChoices({accounts:[{id:'a',connection_id:'c',identity_generation:4,label:'Work',state:'ready',availability:'available'},{id:'b',connection_id:'c',identity_generation:5,label:'Unavailable',state:'expired',availability:'unavailable'}],connections:[{id:'c',revision:7,label:'Provider',transports:['chatgpt_oauth']}]});
 assert.deepEqual(choices[0].binding,{account_id:'a',connection_id:'c',identity_generation:4,connection_revision:7,transport:'chatgpt_oauth'});assert.doesNotMatch(choices[0].label,/experimental/i);assert.equal(choices[0].ready,true);assert.equal(choices[1].ready,false);
});
test('creation accepts server canonical workspace with exact session identity',async()=>{
 const storage=new Storage(),creation=new Creation(storage as any,'t');const connection:any={id:'c',vessel_id:'v',voyages:[],client:{async exchange({command}:any){return {protocol:1,outcome_unknown:false,result:{session_id:command.session_id,workspace:'/canonical/work',incarnation:'i'}};}}};
 const process=await creation.start(connection,'/symlink/work/',{model:'m'});assert.equal(process.workspace,'/canonical/work');assert.equal(storage.length,0);
});

test('model access denial stays distinct and secret-free without retry or billing fallback',async()=>{
 let calls=0;const connection={client:{async exchange(){calls++;return {protocol:1,outcome_unknown:false,error:'PRIVATE [model_catalog:access_denied] UPSTREAM_BODY'};}}};
 await assert.rejects(()=>vesselRead(connection,'account_models'),error=>error instanceof Error&&error.message==='The provider denied model discovery for this account. Review provider permissions and model access.');
 assert.equal(calls,1);
 await assert.rejects(()=>vesselRead(connection,'profiles'),/Vessel could not confirm/);
});

test('closed socket proves creation was not sent and does not leave a blocking journal',async()=>{
 const storage=new Storage(),creation=new Creation(storage as any,'t');
 const socket:any={readyState:3,addEventListener(){},send(){assert.fail('closed socket must not send');}};
 const c:any={id:'c',vessel_id:'v',voyages:[],client:new VesselSocket(socket,()=>{})};
 await assert.rejects(()=>creation.start(c,'/work',{model:'m'}),/Creation was not sent/);
 assert.equal(storage.length,0);
 await assert.rejects(()=>c.client.exchange({protocol:1,command:{op:'start_account'}}),CommandNotSentError);
});

test('unclassified exchange failure retains the exact creation even when it resembles a pre-send refusal',async()=>{
 const storage=new Storage(),creation=new Creation(storage as any,'t');
 const c:any={id:'c',vessel_id:'v',voyages:[],client:{exchange(){throw new Error('Connection unavailable.');}}};
 await assert.rejects(()=>creation.start(c,'/work',{model:'m'}),/can’t confirm/);
 assert.equal(creation.pending().length,1);
});

test('capacity and synchronous send failures release only proven undispatched creation',async()=>{
 for(const failure of ['capacity','send_failed']){
  const storage=new Storage(),creation=new Creation(storage as any,'t');let sends=0;
  const socket:any={readyState:1,addEventListener(){},send(){sends++;throw Error('private socket detail');}};
  const client=new VesselSocket(socket,()=>{});
  if(failure==='capacity')for(let i=0;i<16;i++)client.pending.set(String(i),{});
  const c:any={id:'c',vessel_id:'v',voyages:[],client};
  await assert.rejects(()=>creation.start(c,'/work',{model:'m'}),/Creation was not sent/);
  assert.equal(storage.length,0);assert.equal(sends,failure==='capacity'?0:1);
  assert.equal(client.pending.size,failure==='capacity'?16:0);
 }
});

test('a mismatched recovery receipt cannot clear an uncertain creation',async()=>{
 const storage=new Storage(),creation=new Creation(storage as any,'t');
 const c:any={id:'c',vessel_id:'v',voyages:[],client:{async exchange({command}:any){return command.op==='start_account'?{protocol:1,outcome_unknown:true}:{protocol:1,outcome_unknown:false,result:{status:'created',command_id:'other',session_id:command.session_id}};}}};
 await assert.rejects(()=>creation.start(c,'/work',{model:'m'}));
 await assert.rejects(()=>creation.reconcile(c,creation.pending()[0]),/identity changed/);
 assert.equal(storage.length,1);assert.equal(c.voyages.length,0);
});

test('a connection lost before creation admission leaves no uncertain record',async()=>{
 const storage=new Storage(),creation=new Creation(storage as any,'t');
 await assert.rejects(()=>creation.start({id:'c',vessel_id:'v',client:null},'/work',{model:'m'}),/Creation was not sent/);
 assert.equal(storage.length,0);
});
