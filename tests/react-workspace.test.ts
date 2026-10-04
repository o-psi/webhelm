import test from 'node:test';
import assert from 'node:assert/strict';
import {Workspace} from '../resources/react/workspace.ts';
import {IntentJournal} from '../resources/js/vessel-client.js';

class Storage {
    data = new Map<string, string>();
    get length() { return this.data.size; }
    key(index: number) { return [...this.data.keys()][index] ?? null; }
    getItem(key: string) { return this.data.get(key) ?? null; }
    setItem(key: string, value: string) { this.data.set(key, value); }
    removeItem(key: string) { this.data.delete(key); }
}
function entityReply(command:any, state:any, incarnation='incarnation') {
 const fence={generation:command.generation,session_id:state.session_id,incarnation};
 const entities=[['session','session',{...state,messages:undefined,run:undefined}],['run','run',state.run||null],...((state.messages||[]).map((message:any,index:number)=>['message',`message:${index}`,{...message,message_index:index}]))];
 return {protocol:1,outcome_unknown:false,result:{session_id:state.session_id,incarnation,result:{version:3,revision:state.revision,cursor:state.observation_cursor||3,next_offset:entities.length,has_more:false,events:[{kind:'begin',fence,cursor:state.observation_cursor||3},...entities.map(([entity_kind,entity_id,value],sequence)=>({kind:'entity',fence,sequence,entity_kind,entity_id,value})),{kind:'complete',fence,sequence:entities.length,cursor:state.observation_cursor||3}]}}};
}
function fixture(drafts?:import('../resources/react/drafts').DraftRepository) {
    const storage = new Storage(), commands: any[] = [];
    let mode = 'accepted', subscriptions = 0, revision = 1, cursor = 3, eventListener: ((event: any) => void) | null = null;
    const projections: Array<string | null | undefined> = [];
    const response = (session: string, result: unknown) => ({protocol: 1, outcome_unknown: false, result: {session_id: session, incarnation: 'incarnation', result}});
    const client = {
        async exchange({command}: any) {
            commands.push(command);
            if (command.op === 'capabilities') return {protocol:1,outcome_unknown:false,result:{scope:'owner'}};
            if (command.op === 'initialize_entities') {
                const fence={generation:command.generation,session_id:command.session_id,incarnation:'incarnation'};
                return response(command.session_id,{version:3,revision,cursor,next_offset:2,has_more:false,events:[{kind:'begin',fence,cursor},{kind:'entity',fence,sequence:0,entity_kind:'session',entity_id:'session',value:{session_id:command.session_id,revision,model:'fixture',total_messages:0}},{kind:'entity',fence,sequence:1,entity_kind:'run',entity_id:'run',value:{state:'idle'}},{kind:'complete',fence,sequence:2,cursor}]});
            }
            if (command.op === 'decisions') return response(command.session_id, []);
            if (command.op === 'receipt') return response(command.session_id, {command_id: command.command_id, status: mode});
            if (mode === 'unknown') throw new Error('Disconnected after dispatch');
            return response(command.session_id, {command_id: command.command_id, status: mode});
        },
        subscribe(_session: string, _incarnation: string, _after: number, listener: (event: any) => void, projection?: string | null) { subscriptions++; projections.push(projection); eventListener = listener; return () => { subscriptions--; if (eventListener === listener) eventListener = null; }; },
    };
    const connection = {id: 'vessel', name: 'Vessel', client, journal: new IntentJournal(storage, 'tenant:vessel'), voyages: ['a','b'].map(session_id=>({session_id,incarnation:'incarnation'})), status: 'Connected'};
    const workspace = new Workspace(() => new Map([['vessel', connection]]),drafts);
    return {workspace, connection, commands, storage, mode: (value: string) => { mode = value; }, subscriptions: () => subscriptions, projections, emit: (event: any) => eventListener?.(event), advanceSnapshot: () => { revision++; cursor++; }};
}
test('tabs retain isolated drafts and subscriptions while selection changes', async () => {
    const f = fixture();
    const a = f.workspace.open('vessel', 'a', 'A'); await f.workspace.refresh(a);
    f.workspace.draft(a, 'Private draft A');
    const b = f.workspace.open('vessel', 'b', 'B'); await f.workspace.refresh(b);
    f.workspace.draft(b, 'Private draft B');
    assert.equal(f.workspace.open('vessel', 'a', 'A'), a); await f.workspace.refresh(a);
    assert.equal(f.workspace.tabs.get(a)?.draft, 'Private draft A');
    assert.equal(f.workspace.tabs.get(b)?.draft, 'Private draft B');
    assert.equal(f.subscriptions(), 2);
    assert.equal(f.storage.length, 0, 'draft text is not persisted');
    f.workspace.close(); assert.equal(f.subscriptions(), 0);
});
test('recovered status clears a transient read warning while retaining uncertain command notice', async () => {
    const f=fixture(), key=f.workspace.open('vessel','a','A'); await f.workspace.refresh(key);
    await new Promise(resolve=>setTimeout(resolve,0));
    const tab=f.workspace.tabs.get(key)!;
    const exchange=f.connection.client.exchange.bind(f.connection.client);
    let failSnapshot=true;
    f.connection.client.exchange=async(payload:any)=>{
        if(payload.command.op==='initialize_entities'&&failSnapshot)throw new Error('Connection lost; command outcome may be unknown.');
        return exchange(payload);
    };
    await f.workspace.refresh(key);
    assert.equal(tab.stale,true);
    assert.equal(tab.notice,'Voyage status unavailable. Check the Vessel connection.');
    failSnapshot=false;await f.workspace.refresh(key);
    assert.equal(tab.stale,false);
    assert.equal(tab.notice,'','a successful read clears only its own warning');
    f.workspace.draft(key,'Retain the receipt');f.mode('unknown');await f.workspace.act(key,'submit');
    assert.equal(f.storage.length,1);
    const uncertain=tab.notice;
    failSnapshot=true;await f.workspace.refresh(key);
    assert.equal(tab.notice,uncertain,'a read failure cannot erase the unresolved command');
    failSnapshot=false;await f.workspace.refresh(key);
    assert.equal(tab.notice,uncertain,'recovery cannot imply that the command was applied');
    assert.equal(f.commands.filter(command=>command.op==='submit').length,1,'recovery never resends the command');
    f.workspace.close();
});
test('uncertain command is journaled once and reconciled without replay', async () => {
    const f = fixture(), key = f.workspace.open('vessel', 'a', 'A'); await f.workspace.refresh(key);
    f.workspace.draft(key, 'Retain me'); f.mode('unknown'); await f.workspace.act(key, 'submit');
    assert.equal(f.commands.filter(c => c.op === 'submit').length, 1);
    assert.match(f.workspace.tabs.get(key)?.notice||'', /can’t confirm whether your message went through/);
    assert.equal(f.workspace.tabs.get(key)?.draft, 'Retain me');
    await f.workspace.refresh(key);
    assert.equal(f.workspace.actionable(f.workspace.tabs.get(key)!), false, 'other controls remain fenced');
    assert.equal(f.workspace.actionable(f.workspace.tabs.get(key)!, 'submit'), true, 'a fresh voyage can accept a new message');
    assert.equal([...f.storage.data.values()].some(value => value.includes('Retain me')), false);
    assert.equal(f.commands.filter(c => c.op === 'submit').length, 1, 'no automatic retry');
    f.workspace.draft(key, 'Next request');
    await f.workspace.act(key, 'submit'); assert.equal(f.commands.filter(c => c.op === 'submit').length, 2, 'a user initiated a distinct new command');
    f.mode('accepted'); await f.workspace.reconcile(key);
    assert.equal(f.storage.length, 0);
    const receipt = f.commands.find(c => c.op === 'receipt');
    assert.equal(receipt.command_id, f.commands.find(c => c.op === 'submit').command_id);
    assert.match(f.workspace.tabs.get(key)?.notice||'', /message was accepted/);
    assert.doesNotMatch(f.workspace.tabs.get(key)?.notice||'', new RegExp(receipt.command_id));
    assert.equal(f.commands.filter(c => c.op === 'submit').length, 2);
    f.workspace.close();
});
test('confirmed admission clears only the submitted draft', async () => {
    const f = fixture(), key = f.workspace.open('vessel', 'a', 'A'); await f.workspace.refresh(key);
    f.workspace.draft(key, 'Hello'); await f.workspace.act(key, 'submit');
    assert.equal(f.workspace.tabs.get(key)?.draft, ''); assert.equal(f.storage.length, 0);
    assert.equal(f.workspace.tabs.get(key)?.notice, '', 'successful admission uses the in-thread run status rather than a receipt banner');
    const command = f.commands.find(c => c.op === 'submit');
    assert.equal(command.expected_revision, 1); assert.equal(command.prompt, 'Hello'); assert.ok(command.command_id);
    f.workspace.close();
});
test('unknown-after-restart receipt fences other controls but permits fresh messages', async () => {
    const f = fixture(), key = f.workspace.open('vessel', 'a', 'A'); await f.workspace.refresh(key);
    f.workspace.draft(key, 'Hello'); f.mode('unknown'); await f.workspace.act(key, 'submit');
    f.mode('unknown_after_restart'); await f.workspace.reconcile(key);
    assert.equal(f.storage.length, 1); assert.equal(f.workspace.actionable(f.workspace.tabs.get(key)!), false);
    await f.workspace.refresh(key);assert.equal(f.workspace.actionable(f.workspace.tabs.get(key)!,'submit'),true);
    assert.match(f.workspace.tabs.get(key)?.notice||'', /cannot confirm whether your message was applied after a restart/);
    assert.equal(f.workspace.tabs.get(key)?.receiptStates[f.commands.find(c=>c.op==='submit').command_id],'unknown_after_restart');
    assert.doesNotMatch(f.workspace.tabs.get(key)?.notice||'', /Receipt [a-f0-9-]+/);
    f.workspace.close();
});
test('automatic receipt observation stops after three exact reads without replay', async () => {
    const f = fixture(), key = f.workspace.open('vessel', 'a', 'A'); await f.workspace.refresh(key);
    f.workspace.draft(key, 'Keep this draft'); f.mode('unknown'); await f.workspace.act(key, 'submit');
    f.mode('unknown_after_restart');
    for (let attempt = 0; attempt < 4; attempt++) await f.workspace.observePending(key);
    assert.equal(f.commands.filter(command => command.op === 'receipt').length, 3);
    assert.equal(f.commands.filter(command => command.op === 'submit').length, 1);
    assert.equal(f.workspace.tabs.get(key)?.draft, 'Keep this draft');
    assert.equal(f.storage.length, 1);
    f.mode('accepted'); await f.workspace.reconcile(key);
    assert.equal(f.storage.length, 0);
    f.workspace.close();
});
test('stale snapshot cannot authorize commands', async () => {
    const f = fixture(), key = f.workspace.open('vessel', 'a', 'A'); await f.workspace.refresh(key);
    const tab = f.workspace.tabs.get(key)!; tab.freshAt = Date.now() - 36000; f.workspace.draft(key, 'Hello');
    await f.workspace.act(key, 'submit'); assert.equal(f.commands.filter(c => c.op === 'submit').length, 0);
    f.workspace.close();
});

test('expired and mismatched decisions never dispatch responses', async () => {
    const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
    await f.workspace.respond(key,{decision_id:'decision',expires_at_ms:Date.now()-1,incarnation:'incarnation'},'approved');
    await f.workspace.respond(key,{decision_id:'decision',expires_at_ms:Date.now()+60000,incarnation:'other'},'approved');
    assert.equal(f.commands.filter(c=>c.op==='respond').length,0);f.workspace.close();
});
test('root consent remains a typed response fenced to exact run and expiry', async () => {
    const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
    f.workspace.tabs.get(key)!.snapshot.run.run_id='run';
    const expiry=Date.now()+20000;
    await f.workspace.respond(key,{decision_id:'decision',expires_at_ms:expiry,incarnation:'incarnation',run_id:'run'},{root_grant:'approved'});
    const command=f.commands.find(c=>c.op==='respond');
    assert.deepEqual(command.response,{root_grant:'approved'});assert.equal(command.run_id,'run');assert.equal(command.incarnation,'incarnation');assert.equal(command.expires_at_ms,expiry);f.workspace.close();
});
test('pictures are bounded, private, and blocked as steering', async () => {
    const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
    await f.workspace.attach(key,[new File(['picture'],'example.png',{type:'image/png'})]);
    assert.equal(f.workspace.tabs.get(key)!.pictures.length,1);assert.equal(f.storage.length,0);
    await f.workspace.act(key,'steer');assert.equal(f.commands.filter(c=>c.op==='steer').length,0);
    await f.workspace.attach(key,[new File(['unsafe'],'example.svg',{type:'image/svg+xml'})]);
    assert.equal(f.workspace.tabs.get(key)!.pictures.length,1);f.workspace.close();
});

test('history paging and expansion preserve canonical indices across refresh',async()=>{
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const tab=f.workspace.tabs.get(key)!;tab.snapshot.message_offset=2;tab.snapshot.messages=[{message_index:2,role:'assistant',content:'preview',projection_truncated:true}];
 const original=f.connection.client.exchange.bind(f.connection.client);
 f.connection.client.exchange=async(payload:any)=>{const c=payload.command;if(c.op==='history')return {protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation:'incarnation',result:{revision:1,message_offset:c.offset,next_offset:2,messages:[{message_index:0,role:'user',content:'first'},{message_index:1,role:'assistant',content:'second'}]}}};if(c.op==='message_chunk')return {protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation:'incarnation',result:{data:JSON.stringify({role:'assistant',content:'complete'}),has_more:false,total_bytes:50,next_offset:50}}};return original(payload);};
 await f.workspace.earlier(key);assert.deepEqual(tab.snapshot.messages.map((m:any)=>m.message_index),[0,1,2]);await f.workspace.expand(key,2);assert.equal(tab.snapshot.messages[2].content,'complete');await f.workspace.refresh(key);assert.equal(tab.snapshot.message_offset,0);assert.equal(tab.snapshot.messages[2].content,'complete');f.workspace.close();
});
test('a failed automatic history read retries without showing a composer notice',async()=>{
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const tab=f.workspace.tabs.get(key)!;
 tab.snapshot.message_offset=1;
 tab.snapshot.messages=[{message_index:1,role:'assistant',content:'recent'}];
 const exchange=f.connection.client.exchange.bind(f.connection.client);
 let fail=true;
 f.connection.client.exchange=async(payload:any)=>{
  if(payload.command.op==='history')return fail
   ? {protocol:1,outcome_unknown:true,error:'observation unavailable'}
   : {protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation:'incarnation',result:{revision:1,next_offset:1,messages:[{message_index:0,role:'user',content:'earlier'}]}}};
  return exchange(payload);
 };
 await f.workspace.earlier(key);
 assert.equal(tab.notice,'');
 tab.notice='A previous action needs confirmation.';
 await f.workspace.earlier(key);
 assert.equal(tab.notice,'A previous action needs confirmation.');
 fail=false;
 await f.workspace.earlier(key);
 assert.equal(tab.notice,'A previous action needs confirmation.');
 assert.equal(tab.snapshot.message_offset,0);
 f.workspace.close();
});
test('image submission uses promoted attachment and separate durable mutation receipt',async()=>{
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const original=f.connection.client.exchange.bind(f.connection.client);const uploads:any[]=[];
 f.connection.client.exchange=async(payload:any)=>{if(payload.command.op==='upload_image'){uploads.push(payload.command);return {protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation:'incarnation',result:{id:'artifact',sha256:'a'.repeat(64),byte_size:7,media_type:'image/png'}}};}return original(payload);};
 await f.workspace.attach(key,[new File(['picture'],'example.png',{type:'image/png'})]);await f.workspace.act(key,'submit');
 assert.equal(uploads.length,1);assert.ok(uploads[0].upload_id);const command=f.commands.find(c=>c.op==='submit_content');assert.equal(command.content[0].attachment.id,'artifact');assert.equal(f.workspace.tabs.get(key)!.pictures.length,0);assert.equal(f.storage.length,0);f.workspace.close();
});

test('history-only connection remains readable when decisions are forbidden',async()=>{
 const f=fixture();const original=f.connection.client.exchange.bind(f.connection.client);f.connection.client.exchange=async(payload:any)=>payload.command.op==='decisions'?{protocol:1,outcome_unknown:false,error:'forbidden'}:payload.command.op==='capabilities'?{protocol:1,outcome_unknown:false,result:{scope:'scoped',rights:['history']}}:original(payload);
 const key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);assert.equal(f.workspace.tabs.get(key)!.stale,false);assert.equal(f.workspace.tabs.get(key)!.snapshot.session_id,'a');f.workspace.close();
});
test('delayed output from an old run is rejected',async()=>{
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);const tab=f.workspace.tabs.get(key)!;tab.snapshot.run={run_id:'old',live_text:'OLD'};let release:any;
 const original=f.connection.client.exchange.bind(f.connection.client);f.connection.client.exchange=async(payload:any)=>payload.command.op==='run_output'?await new Promise(resolve=>{release=()=>resolve({protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation:'incarnation',result:{run_id:'old',offset:3,next_offset:7,data:'PAGE',has_more:false}}});}):original(payload);
 const pending=f.workspace.output(key,3);tab.snapshot={...tab.snapshot,run:{run_id:'new',live_text:'NEW'}};release();await assert.rejects(pending,/Output identity changed/);f.workspace.close();
});

test('image upload refusal is explained and does not reserve a submit command',async()=>{
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const original=f.connection.client.exchange.bind(f.connection.client);
 f.connection.client.exchange=async(payload:any)=>payload.command.op==='upload_image'
   ? {protocol:1,outcome_unknown:false,error:'invalid image header or resource limit'} : original(payload);
 await f.workspace.attach(key,[new File(['picture'],'example.png',{type:'image/png'})]);
 await f.workspace.act(key,'submit');
 const tab=f.workspace.tabs.get(key)!;
 assert.match(tab.notice,/invalid image header or resource limit/);
 assert.match(tab.notice,/no message was submitted/);
 assert.equal(tab.pictures.length,1);
 assert.equal(f.commands.some(c=>c.op==='submit_content'),false);
 assert.equal(f.storage.length,0);
 f.workspace.close();
});

test('uncertain image upload keeps its identity and requires status inspection before retry',async()=>{
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 let attempts=0;const original=f.connection.client.exchange.bind(f.connection.client);
 f.connection.client.exchange=async(payload:any)=>{
   if(payload.command.op==='upload_image'){attempts++;throw new Error('Reply timed out; command outcome may be unknown.');}
   return original(payload);
 };
 await f.workspace.attach(key,[new File(['picture'],'example.png',{type:'image/png'})]);
 await f.workspace.act(key,'submit');
 const tab=f.workspace.tabs.get(key)!;
 assert.match(tab.notice,/outcome may be unknown/);
 assert.equal(tab.pictures.length,1);assert.equal(attempts,1);
 assert.equal(f.commands.some(c=>c.op==='submit_content'),false);
 f.workspace.close();
});

test('two pictures wake Voyage and submit once from one Send after fresh status',async()=>{
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const original=f.connection.client.exchange.bind(f.connection.client);
 const uploads:any[]=[];let incarnation='incarnation';
 f.connection.client.exchange=async(payload:any)=>{
   const c=payload.command;
   if(c.op==='upload_image'){
     uploads.push(c);incarnation='resumed';f.connection.voyages[0].incarnation=incarnation;
     return {protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation,result:{id:'artifact',sha256:'a'.repeat(64),byte_size:7,media_type:'image/png'}}};
   }
   if(c.op==='initialize_entities')return entityReply(c,{session_id:'a',revision:1,observation_cursor:3,messages:[],run:{state:'idle'}},incarnation);
   if(c.op==='decisions')return {protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation,result:[]}};
   return original(payload);
 };
 // First read observed the old owner, upload is answered by its resumed owner.
 await f.workspace.refresh(key);
 await f.workspace.attach(key,[new File(['picture'],'2587.jpg',{type:'image/jpeg'}),new File(['picture'],'2588.jpg',{type:'image/jpeg'})]);
 await f.workspace.act(key,'submit');
 const tab=f.workspace.tabs.get(key)!;
 assert.equal(tab.notice,'');
 assert.equal(tab.incarnation,'resumed');assert.equal(tab.stale,false);
 assert.equal(uploads.length,2,'each picture uploaded only once');
 assert.equal(f.commands.filter(c=>c.op==='submit_content').length,1);
 assert.equal(tab.pictures.length,0);f.workspace.close();
});

test('post-upload changed revision or active run never silently submits',async()=>{
 for(const change of [{revision:2},{run:{state:'running'}}]){
  const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
  let uploaded=false;const original=f.connection.client.exchange.bind(f.connection.client);
  f.connection.client.exchange=async(payload:any)=>{
   if(payload.command.op==='upload_image'){uploaded=true;return {protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation:'resumed',result:{id:'artifact',sha256:'a'.repeat(64),byte_size:7}}};}
   if(uploaded&&payload.command.op==='initialize_entities')return entityReply(payload.command,{session_id:'a',revision:1,run:{state:'idle'},messages:[],...change},'resumed');
   return original(payload);
  };
  await f.workspace.attach(key,[new File(['picture'],'example.png',{type:'image/png'})]);await f.workspace.act(key,'submit');
  assert.equal(f.commands.some(c=>c.op==='submit_content'),false);
  assert.equal(f.storage.length,0);assert.equal(f.workspace.tabs.get(key)!.pictures.length,1);
  f.workspace.close();
 }
});

test('pictures steer the active run rather than queueing a new turn',async()=>{
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const tab=f.workspace.tabs.get(key)!;tab.snapshot.run={state:'running',run_id:'r'};
 const original=f.connection.client.exchange.bind(f.connection.client);
 f.connection.client.exchange=async(payload:any)=>{
  if(payload.command.op==='upload_image')return {protocol:1,outcome_unknown:false,result:{session_id:'a',incarnation:'incarnation',result:{id:'artifact',sha256:'a'.repeat(64),byte_size:7}}};
  if(payload.command.op==='initialize_entities')return entityReply(payload.command,{session_id:'a',revision:2,messages:[],run:{state:'running',run_id:'r'}});
  return original(payload);
 };
 await f.workspace.refresh(key);await new Promise(resolve=>setTimeout(resolve,0));
 await f.workspace.attach(key,[new File(['picture'],'photo.png',{type:'image/png'})]);
 await f.workspace.act(key,'steer');
 const command=f.commands.find(c=>c.op==='steer');assert.ok(command,tab.notice);assert.equal(command.run_id,'r');assert.equal(command.parts[0].attachment.id,'artifact');
 assert.equal(f.commands.some(c=>c.op==='submit_content'),false);assert.equal(tab.pictures.length,0);f.workspace.close();
});

test('refresh retains the same subscription across canonical reads', async () => {
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 assert.equal(f.subscriptions(),1);
 await f.workspace.refresh(key);
 assert.equal(f.subscriptions(),1,'canonical status reads must not tear down the subscription');
 assert.equal(f.workspace.needsRefresh(key),false);
 f.workspace.close();
 assert.equal(f.subscriptions(),0);
});

test('socket renewal keeps confirmed status visible but fences actions until the new read', async () => {
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const tab=f.workspace.tabs.get(key)!;
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 const previous=f.connection.client;
 f.connection.client={...previous,exchange:async(value:any)=>{
  if(value.command.op==='initialize_entities')await pending;
  return previous.exchange(value);
 }};
 f.workspace.connectionChanged();
 assert.equal(tab.stale,false,'the last confirmed status stays visible during authenticated renewal');
 assert.equal(tab.freshAt,0,'the old socket cannot authorize an action on its successor');
 assert.equal(f.workspace.actionable(tab),false);
 assert.equal(f.subscriptions(),0,'the old event subscription is released');
 release();await f.workspace.refresh(key);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tab.stale,false);
 assert.ok(tab.freshAt>0);
 assert.equal(f.workspace.actionable(tab),true);
 assert.equal(f.subscriptions(),1,'the new socket gets a fresh subscription');
 f.workspace.close();
});

test('failed events reinitialize bounded entities without legacy downgrade or subscription churn', async () => {
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const tab=f.workspace.tabs.get(key)!;
 assert.equal(f.subscriptions(),1);
 f.emit({protocol:1,session_id:'a',incarnation:'incarnation',result:null,error:'command outcome unknown',outcome_unknown:true});
 assert.equal(tab.stale,false,'an event transport failure does not invalidate the last confirmed status');
 assert.equal(f.workspace.actionable(tab),false,'actions wait for the next confirmed snapshot');
 await f.workspace.refresh(key);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tab.stale,false,'a confirmed snapshot restores status after the failed event');
 assert.equal(f.subscriptions(),0,'failed incompatible observation is not retried as legacy');
 assert.deepEqual(f.projections,['public-v2']);
 f.emit({protocol:1,session_id:'a',incarnation:'incarnation',result:null,error:'command outcome unknown',outcome_unknown:true});
 await f.workspace.refresh(key);
 assert.equal(f.subscriptions(),0,'a failed observation is released');
 assert.equal(f.workspace.needsRefresh(key),true,'bounded entity reinitialization remains available during transport backoff');
 f.workspace.connectionChanged();await f.workspace.refresh(key);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tab.stale,false,'catalogue updates must not mark a confirmed read stale when the client is unchanged');
 assert.equal(f.subscriptions(),0,'polling does not immediately resubscribe');
 f.advanceSnapshot();await f.workspace.refresh(key);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tab.snapshot.revision,2);
 assert.equal(f.workspace.actionable(tab),true,'a recent canonical read can authorize a new action');
 (f.workspace as any).eventRetryAt.set(key,Date.now()-1);
 await f.workspace.refresh(key);
 assert.equal(f.subscriptions(),1,'observation retry resumes after the bounded delay');
 assert.ok(f.projections.every(projection=>projection==='public-v2'),'incompatible peers never trigger a legacy projection');
 f.workspace.close();
});

test('subscription setup failure keeps a confirmed read and obsolete read notices clear', async () => {
 const f=fixture();f.connection.client.subscribe=()=>{throw new Error('Observation unavailable.');};
 const key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 const tab=f.workspace.tabs.get(key)!;
 assert.equal(tab.stale,false);
 assert.equal(f.workspace.needsRefresh(key),true);
 const exchange=f.connection.client.exchange.bind(f.connection.client);
 let fail=true;
 f.connection.client.exchange=async(payload:any)=>{
  if(fail&&payload.command.op==='initialize_entities')throw new Error('Connection lost; command outcome may be unknown.');
  return exchange(payload);
 };
 await f.workspace.refresh(key);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tab.stale,true);
 assert.equal(tab.notice,'Voyage status unavailable. Check the Vessel connection.');
 fail=false;
 await f.workspace.refresh(key);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(tab.notice,'');
 tab.notice='We can’t confirm whether your message went through.';
 await f.workspace.refresh(key);
 assert.match(tab.notice,/can’t confirm whether your message/,'action notices survive a successful read');
 f.workspace.close();
});


test('sidebar metadata updates retain healthy transcript without snapshot reads', async () => {
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 await new Promise(resolve=>setImmediate(resolve));
 const before=f.commands.length;
 for(let i=0;i<10;i++) f.workspace.connectionChanged(false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.commands.length,before,'metadata notifications must not amplify into full transcript reads');
 assert.equal(f.subscriptions(),1);
 f.workspace.connectionChanged();await f.workspace.refresh(key);
 assert.ok(f.commands.slice(before).some(command=>command.op==='initialize_entities'),'explicit action callbacks still refresh canonical authority');
 f.workspace.close();
});

test('catalogued owner replacement fences the previous incarnation immediately', async () => {
 const f=fixture(),key=f.workspace.open('vessel','a','A');await f.workspace.refresh(key);
 await new Promise(resolve=>setImmediate(resolve));
 const tab=f.workspace.tabs.get(key)!;
 f.connection.voyages[0]={session_id:'a',incarnation:'replacement'};
 let release!:()=>void;
 const pending=new Promise<void>(resolve=>{release=resolve;});
 const exchange=f.connection.client.exchange.bind(f.connection.client);
 f.connection.client.exchange=async(payload:any)=>{if(payload.command.op==='initialize_entities')await pending;return exchange(payload);};
 f.workspace.connectionChanged(false);
 assert.equal(f.workspace.actionable(tab),false);
 assert.equal(f.subscriptions(),0);
 release();await f.workspace.refresh(key);
 f.workspace.close();
});


test('persisted message clears only after acceptance and retains uncertain content for review',async()=>{
    const records=new Map<string,any>();let version=0;
    const drafts={async read(key:string){return records.get(key)||null;},async write(key:string,revision:string|null,value:any){assert.equal(records.get(key)?.revision??null,revision);const next=String(++version);if(value)records.set(key,{revision:next,value});else records.delete(key);return value?next:null;}};
    const f=fixture(drafts),key=f.workspace.open('vessel','a','A');await f.workspace.restoreDraft(key);await f.workspace.refresh(key);
    f.workspace.draft(key,'Accepted message');await f.workspace.act(key,'submit');assert.equal(records.has(key),false);
    f.mode('unknown');f.workspace.draft(key,'Uncertain message');await f.workspace.act(key,'submit');
    assert.equal(records.get(key).value.text,'Uncertain message');assert.equal(records.get(key).value.delivery,'review');
    const sends=f.commands.filter(c=>c.op==='submit').length;const reopened=new Workspace(()=>new Map([['vessel',f.connection]]),drafts);reopened.open('vessel','a','A');await reopened.restoreDraft(key);
    assert.equal(reopened.tabs.get(key)?.draft,'Uncertain message');assert.equal(f.commands.filter(c=>c.op==='submit').length,sends);reopened.close();f.workspace.close();
});

test('failed durable send marker prevents submission without discarding the draft',async()=>{
    const drafts={async read(){return null;},async write(){throw new Error('Quota exceeded');}};
    const f=fixture(drafts),key=f.workspace.open('vessel','a','A');await f.workspace.restoreDraft(key);await f.workspace.refresh(key);
    f.workspace.draft(key,'Do not lose me');await f.workspace.act(key,'submit');
    assert.equal(f.commands.filter(c=>c.op==='submit').length,0);assert.equal(f.workspace.tabs.get(key)?.draft,'Do not lose me');assert.match(f.workspace.tabs.get(key)?.draftState?.message||'',/Quota/);assert.match(f.workspace.tabs.get(key)?.notice||'',/no message was submitted/);f.workspace.close();
});
