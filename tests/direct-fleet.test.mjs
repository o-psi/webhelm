import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {VesselFleet} from '../resources/js/vessel-fleet.js';
import {request} from '../resources/js/vessel-client.js';

const vessel = '10000000-0000-4000-8000-000000000001';
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate) { for(let i=0;i<100;i++) {if(predicate())return;await pause();} assert.fail('connection did not settle'); }
function fixture(t, count=1, handle=null) {
    const sockets=[], requests=[], store=new Map();
    globalThis.crypto ||= webcrypto;
    globalThis.localStorage={get length(){return store.size;},key:i=>[...store.keys()][i],getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
    class Socket extends EventTarget {
        constructor(url,protocol) {
            super(); this.url=url; this.protocol=protocol; this.readyState=0; sockets.push(this);
            queueMicrotask(()=>{if(this.readyState===3)return;this.readyState=1;this.dispatchEvent(new Event('open'));});
        }
        receive(value) { const e=new Event('message'); e.data=JSON.stringify(value);this.dispatchEvent(e); }
        send(text) {
            const frame=JSON.parse(text);requests.push({socket:this,frame});
            if(frame.type==='authenticate') {
                assert.deepEqual(Object.keys(frame).sort(),['token','type']);
                queueMicrotask(()=>this.receive({type:'hello',protocol:1,socket_id:vessel,vessel_id:vessel}));
            } else if(handle?.(this, frame)) return;
            else if(frame.request.command.op==='capabilities') queueMicrotask(()=>this.reply(frame,{features:[]}));
            else if(frame.request.command.op==='catalogue') queueMicrotask(()=>this.reply(frame,[]));
        }
        reply(frame,result) {this.receive({type:'reply',request_id:frame.request_id,response:{protocol:1,error:null,outcome_unknown:false,result}});}
        close(){if(this.readyState===3)return;this.readyState=3;const e=new Event('close');e.code=1000;e.reason='';this.dispatchEvent(e);}
    }
    globalThis.WebSocket=Socket;
    let mint=async id=>({token:'a'.repeat(64),expires_at_ms:Date.now()+120000,vessel_id:vessel,url:`wss://vessel-${id}.example/v1/vessel/browser-socket`});
    const fleet=new VesselFleet(Array.from({length:count},(_,i)=>({id:String(i),vessel_id:vessel})),{tenantId:'tenant',ticket:id=>mint(id),changed:()=>{}});
    t.after(()=>fleet.close());
    return {fleet,sockets,requests,setMint:fn=>mint=fn};
}

test('five Vessels use direct endpoints, fixed protocol and first-frame credentials',async t=>{
    const {fleet,sockets,requests}=fixture(t,5);fleet.start();
    await until(()=>[...fleet.connections.values()].every(c=>c.client));
    assert.equal(sockets.length,5);
    sockets.forEach((socket,i)=>{
        assert.equal(socket.url.href,`wss://vessel-${i}.example/v1/vessel/browser-socket`);
        assert.equal(socket.protocol,'voyage.vessel.v1');
        assert.equal(requests.find(r=>r.socket===socket).frame.type,'authenticate');
    });
});

test('renewal replaces socket without replay and drains an already dispatched command',async t=>{
    const {fleet,sockets,requests}=fixture(t);fleet.start();const c=fleet.connections.get('0');
    await until(()=>c.client && !c.connecting);
    const old=c.client;
    const pending=old.exchange(request('submit',{command_id:vessel}));
    const dispatched=requests.at(-1).frame;
    await fleet.connect(c,true);
    assert.notEqual(c.client,old);assert.equal(sockets[0].readyState,1);
    sockets[0].reply(dispatched,{accepted:true});assert.deepEqual((await pending).result,{accepted:true});
    await until(()=>sockets[0].readyState===3);
    assert.equal(requests.filter(r=>r.frame.request?.command.op==='submit').length,1);
    assert.equal(c.status,'Connected');assert.equal(c.client.socket,sockets[1]);
});

test('temporary mint failure keeps current connection; removal shuts it down',async t=>{
    const {fleet,setMint}=fixture(t);fleet.start();const c=fleet.connections.get('0');await until(()=>c.client&&!c.connecting);
    const old=c.client;setMint(async()=>{throw Error('Authorization unavailable');});
    await fleet.connect(c,true);assert.equal(c.client,old);assert.equal(old.socket.readyState,1);assert.ok(c.reconnect);
    setMint(async()=>{throw Object.assign(Error('Connection removed'),{permanent:true});});
    await fleet.connect(c,true);assert.equal(c.client,null);assert.equal(old.socket.readyState,3);assert.equal(c.stopped,true);
});

test('untrusted bootstrap URL or mismatched Vessel never opens a socket',async t=>{
    const {fleet,sockets,setMint}=fixture(t);const c=fleet.connections.get('0');
    for(const url of ['ws://vessel.example/v1/vessel/browser-socket','wss://vessel.example/v1/vessel/browser-socket?token=secret','wss://user:secret@vessel.example/v1/vessel/browser-socket']) {
        c.stopped=false;setMint(async()=>({token:'a'.repeat(64),expires_at_ms:Date.now()+120000,vessel_id:vessel,url}));
        await fleet.connect(c);assert.equal(c.stopped,true);
    }
    assert.equal(sockets.length,0);
});

test('closing during bootstrap prevents a late socket and reconnect',async t=>{
    const {fleet,sockets,setMint}=fixture(t);let resolve;
    setMint(()=>new Promise(r=>{resolve=r;}));const connecting=fleet.connect(fleet.connections.get('0'));
    fleet.close();resolve({});await connecting;assert.equal(sockets.length,0);
});

const entry = (name='Initial') => ({session_id:vessel,incarnation:vessel,state:'live',workspace:'/synthetic',name});
const page = (cursor, entries=[], extra={}) => ({cursor,latest_cursor:cursor,has_more:false,replay_gap:false,entries,...extra});
function feedFixture(t) {
    const pending=[]; let hydration=[entry()];
    const result=fixture(t,1,(socket,frame)=>{
        const command=frame.request.command;
        if(command.op==='capabilities') {queueMicrotask(()=>socket.reply(frame,{features:['catalogue_changes']}));return true;}
        if(command.op==='catalogue') {queueMicrotask(()=>socket.reply(frame,hydration));return true;}
        if(command.op==='catalogue_changes') {pending.push({socket,frame});return true;}
        return false;
    });
    return {...result,pending,setHydration:value=>{hydration=value;},answer:(index,value)=>pending[index].socket.reply(pending[index].frame,value)};
}

test('catalogue checkpoint precedes hydration, changes merge, and gaps rehydrate',async t=>{
    const {fleet,pending,requests,answer,setHydration}=feedFixture(t);fleet.start();const c=fleet.connections.get('0');
    await until(()=>pending.length===1);
    assert.equal(requests.filter(r=>r.frame.request?.command.op==='catalogue').length,0);
    assert.equal(pending[0].frame.request.command.after,null);
    answer(0,page(4,[],{replay_gap:true}));
    await until(()=>pending.length===2);
    assert.equal(c.voyages[0].name,'Initial');
    assert.equal(pending[1].frame.request.command.after,4);
    c.lastCatalogue=0;fleet.poll();
    assert.equal(requests.filter(r=>r.frame.request?.command.op==='catalogue').length,1);
    answer(1,page(5,[entry('Changed')]));
    await until(()=>pending.length===3);
    assert.equal(c.voyages[0].name,'Changed');
    assert.equal(c.voyages.length,1);
    setHydration([entry('Gap recovery')]);answer(2,page(9000,[],{replay_gap:true}));
    await until(()=>pending.length===4);
    assert.equal(c.voyages[0].name,'Gap recovery');
    assert.equal(pending[3].frame.request.command.after,9000);
});

test('renewed catalogue ignores a delayed old socket page and stops after close',async t=>{
    const {fleet,pending,answer,setHydration}=feedFixture(t);fleet.start();const c=fleet.connections.get('0');
    await until(()=>pending.length===1);answer(0,page(1,[],{replay_gap:true}));await until(()=>pending.length===2);
    setHydration([entry('Replacement')]);await fleet.connect(c,true);
    await until(()=>pending.length===3);answer(2,page(2,[],{replay_gap:true}));await until(()=>pending.length===4);
    answer(1,page(100,[entry('Stale old socket')]));await pause();
    assert.equal(c.voyages[0].name,'Replacement');
    fleet.close();answer(3,page(101,[entry('After close')]));await pause();
    assert.equal(c.voyages[0].name,'Replacement');assert.equal(pending.length,4);
});

test('invalid catalogue cursor and oversized pages preserve the last usable list',async t=>{
    for(const invalid of [page(0,[entry('Regression')]),page(1,[entry('Unchanged cursor')]),page(2,Array.from({length:129},()=>entry())),page(2,[],{has_more:true}),page(2,[entry('Gap corruption')],{replay_gap:true})]) {
        const {fleet,pending,answer}=feedFixture(t);fleet.start();const c=fleet.connections.get('0');
        await until(()=>pending.length===1);answer(0,page(1,[],{replay_gap:true}));await until(()=>pending.length===2);
        answer(1,invalid);await until(()=>c.status==='Voyage list unavailable');
        assert.equal(c.voyages[0].name,'Initial');fleet.close();
    }
});
