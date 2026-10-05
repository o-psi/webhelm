import test from 'node:test';
import assert from 'node:assert/strict';
import {PolicyIntents,type PolicyIntent} from '../resources/react/attention-policy-intents';
import {outcome,policyView,PolicyClient} from '../resources/react/attention-policy-client';
const tenant='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const intent:PolicyIntent={tenant,operation_id:'33333333-3333-4333-8333-333333333333',expected_revision:0,stale_policy:'three_days',state:'prepared'};
function storage(){const map=new Map<string,string>();return {get length(){return map.size;},key:(i:number)=>[...map.keys()][i]??null,getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);},removeItem:(key:string)=>{map.delete(key);},clear:()=>map.clear()} as Storage;}
const view={stale_policy:'three_days',revision:1,eligibility:{effect:'unavailable',reason:'authoritative_work_and_obligation_facts_unavailable',automatic_settlement:false}};
test('durable identity survives reload; other tenant and newer intent cannot be cleared',()=>{
    const s=storage(),a=new PolicyIntents(s,tenant);a.prepare(intent);
    assert.deepEqual(new PolicyIntents(s,tenant).read(),[intent]);assert.deepEqual(new PolicyIntents(s,other).read(),[]);
    assert.throws(()=>a.prepare({...intent,operation_id:'44444444-4444-4444-8444-444444444444'}));
    a.settle({...intent,expected_revision:9});assert.equal(a.read().length,1);a.settle(intent);assert.equal(a.read().length,0);
});
test('storage failure and corruption fail before send',()=>{
    const s=storage();s.setItem=()=>{throw Error('quota');};assert.throws(()=>new PolicyIntents(s,tenant).prepare(intent));
    const bad=storage();bad.setItem(`helm-web:policy:${tenant}:${intent.operation_id}`,'{}');assert.throws(()=>new PolicyIntents(bad,tenant).read());
    assert.throws(()=>new PolicyIntents(storage(),'missing'));
});
test('exact response contract rejects foreign identity, wrong revision and inferred effects',()=>{
    assert.ok(policyView(view));assert.ok(outcome({status:200,body:{...view,operation_id:intent.operation_id}},intent));
    assert.ok(outcome({status:409,body:{error:'revision_conflict',operation_id:intent.operation_id,current:view}},intent));
    assert.equal(outcome({status:200,body:{...view,revision:0,operation_id:intent.operation_id}},intent),false);
    assert.equal(outcome({status:200,body:{...view,operation_id:other}},intent),false);
    assert.equal(policyView({...view,eligibility:{...view.eligibility,automatic_settlement:true}}),false);
});
test('cold receipt wrapper and 404 unknown never submit a PATCH',async()=>{
    const calls:string[]=[];const client=new PolicyClient((async(url:any,options:any)=>{calls.push(options.method);return new Response(JSON.stringify({status:200,body:{...view,operation_id:intent.operation_id}}),{status:200});}) as typeof fetch);
    assert.equal((await client.receipt(intent))?.status,200);assert.deepEqual(calls,['GET']);
    const missing=new PolicyClient((async()=>new Response(JSON.stringify({error:'receipt_not_found',outcome:'unknown',retry_with_new_identity:false}),{status:404})) as typeof fetch);
    assert.equal(await missing.receipt(intent),null);
});
test('close fences late response and unauthorized context cannot read again',async()=>{
    let resolve!:(response:Response)=>void;const client=new PolicyClient((()=>new Promise(r=>{resolve=r;})) as typeof fetch);
    const pending=client.read();client.close();resolve(new Response(JSON.stringify(view)));await assert.rejects(pending);
    let calls=0;const denied=new PolicyClient((async()=>{calls++;return new Response('{}',{status:401});}) as typeof fetch);
    await assert.rejects(denied.read());await assert.rejects(denied.receipt(intent));assert.equal(calls,1);
});
test('Inbox renders explicit tenant preference without composer or effects',async()=>{
    const {JSDOM}=await import('jsdom');const React=await import('react');
    const dom=new JSDOM('<div id="mount"></div>',{url:'https://helm.test'});
    const saved:Record<string,unknown>={};for(const key of ['window','document','localStorage','fetch','IS_REACT_ACT_ENVIRONMENT'])saved[key]=(globalThis as any)[key];
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,
        fetch:async()=>new Response(JSON.stringify({...view,revision:0}))});
    const {createRoot}=await import('react-dom/client');const {AttentionPolicySettings}=await import('../resources/react/AttentionPolicySettings');
    const root=createRoot(dom.window.document.querySelector('#mount')!);
    try{
        await React.act(async()=>{root.render(React.createElement(AttentionPolicySettings,{tenantId:tenant}));await new Promise(r=>setTimeout(r,20));});
        assert.match(dom.window.document.body.textContent!,/Three days \(default\)/);
        assert.match(dom.window.document.body.textContent!,/unavailable until authoritative/);
        assert.equal(dom.window.document.querySelectorAll('input[type=radio]').length,3);
        assert.equal(dom.window.document.querySelectorAll('textarea').length,0);
        await React.act(async()=>root.render(React.createElement(AttentionPolicySettings,{tenantId:undefined})));
        assert.match(dom.window.document.body.textContent!,/Account unavailable/);
    }finally{await React.act(async()=>root.unmount());for(const [key,value] of Object.entries(saved))(globalThis as any)[key]=value;dom.window.close();}
});
test('capacity and multi-tab separate identities preserve all no-replay metadata',()=>{
    const s=storage(),a=new PolicyIntents(s,tenant),b=new PolicyIntents(s,tenant);a.prepare(intent);
    assert.throws(()=>b.prepare({...intent,operation_id:other}));
    for(let i=0;i<8;i++){const op=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;s.setItem(`helm-web:policy:${tenant}:${op}`,JSON.stringify({...intent,operation_id:op}));}
    assert.throws(()=>a.read());assert.equal(s.length,9);
});
