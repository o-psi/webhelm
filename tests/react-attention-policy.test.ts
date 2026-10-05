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
    const calls:string[]=[];const client=new PolicyClient(tenant,(async(url:any,options:any)=>{calls.push(options.method);return new Response(JSON.stringify({status:200,body:{...view,operation_id:intent.operation_id}}),{status:200});}) as typeof fetch);
    assert.equal((await client.receipt(intent))?.status,200);assert.deepEqual(calls,['GET']);
    const missing=new PolicyClient(tenant,(async()=>new Response(JSON.stringify({error:'receipt_not_found',outcome:'unknown',retry_with_new_identity:false}),{status:404})) as typeof fetch);
    assert.equal(await missing.receipt(intent),null);
});
test('close fences late response and unauthorized context cannot read again',async()=>{
    let resolve!:(response:Response)=>void;const client=new PolicyClient(tenant,(()=>new Promise(r=>{resolve=r;})) as typeof fetch);
    const pending=client.read();client.close();resolve(new Response(JSON.stringify(view)));await assert.rejects(pending);
    let calls=0;const denied=new PolicyClient(tenant,(async()=>{calls++;return new Response('{}',{status:401});}) as typeof fetch);
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

test('account scope is explicit on reads and foreign intent never submits',async()=>{
    const calls:any[]=[];const client=new PolicyClient(tenant,(async(url:any,options:any)=>{calls.push(options);return new Response(JSON.stringify(view));}) as typeof fetch);
    await client.read();assert.equal(calls[0].headers['X-Helm-Expected-Tenant'],tenant);
    await assert.rejects(client.save({...intent,tenant:other}));await assert.rejects(client.receipt({...intent,tenant:other}));assert.equal(calls.length,1);
    assert.throws(()=>new PolicyClient('missing'));
});

test('actual Save retains unknown identity across close/reopen and reconciles without another PATCH',async()=>{
    const {JSDOM}=await import('jsdom');const React=await import('react');
    const dom=new JSDOM('<meta name="csrf-token" content="fixture"><div id="mount"></div>',{url:'https://helm.test'});
    const saved:Record<string,unknown>={};for(const key of ['window','document','localStorage','fetch','IS_REACT_ACT_ENVIRONMENT'])saved[key]=(globalThis as any)[key];
    let patches=0,operation='',confirmed=false;
    const settled={stale_policy:'off',revision:1,eligibility:{effect:'disabled',reason:'policy_off',automatic_settlement:false}};
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,
        fetch:async(url:string,options:any)=>{
            assert.equal(options.headers['X-Helm-Expected-Tenant'],tenant);
            if(options.method==='PATCH'){patches++;const payload=JSON.parse(options.body);operation=payload.operation_id;assert.equal(payload.stale_policy,'off');throw Error('transport outcome unknown');}
            if(url.includes('/receipts/'))return new Response(JSON.stringify(confirmed?{status:200,body:{...settled,operation_id:operation}}:{error:'receipt_not_found',outcome:'unknown',retry_with_new_identity:false}),{status:confirmed?200:404});
            return new Response(JSON.stringify(confirmed?settled:{...view,revision:0}));
        }});
    const {createRoot}=await import('react-dom/client');const {AttentionPolicySettings}=await import('../resources/react/AttentionPolicySettings');
    const root=createRoot(dom.window.document.querySelector('#mount')!);
    const render=async(element:any)=>React.act(async()=>{root.render(element);await new Promise(r=>setTimeout(r,20));});
    try{
        await render(React.createElement(AttentionPolicySettings,{tenantId:tenant}));
        await React.act(async()=>{(dom.window.document.querySelector('input[value="off"]') as HTMLInputElement).click();});
        const button=()=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Save preference')!;
        assert.equal(button().disabled,false);
        await React.act(async()=>{button().click();await new Promise(r=>setTimeout(r,20));});
        assert.equal(patches,1);assert.equal(new PolicyIntents(dom.window.localStorage,tenant).read()[0].operation_id,operation);
        await render(null);await render(React.createElement(AttentionPolicySettings,{tenantId:tenant}));
        assert.equal(patches,1);assert.equal(button().disabled,true);assert.match(dom.window.document.body.textContent!,/Outcome unknown/);
        confirmed=true;
        await React.act(async()=>{[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent==='Check current policy and receipts')!.click();await new Promise(r=>setTimeout(r,20));});
        assert.equal(patches,1);assert.equal(new PolicyIntents(dom.window.localStorage,tenant).read().length,0);
        assert.equal((dom.window.document.querySelector('input[value="off"]') as HTMLInputElement).checked,true);
    }finally{await React.act(async()=>root.unmount());for(const [key,value] of Object.entries(saved))(globalThis as any)[key]=value;dom.window.close();}
});
