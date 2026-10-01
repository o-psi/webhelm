import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {EntityReceiver,MAX_ENTITY_BYTES,MAX_CHUNK_BYTES} from '../resources/js/entity-stream.js';
const scope={vessel_id:'00000000-0000-0000-0000-000000000001',session_id:'00000000-0000-0000-0000-000000000002',incarnation:'00000000-0000-0000-0000-000000000003'};
const id='00000000-0000-0000-0000-000000000004';
const manifest=text=>({stream_id:id,scope,kind:'message',key:'message:12',byte_size:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')});
const start=value=>({type:'entity_start',manifest:value});
const chunk=(text,offset=0)=>({type:'entity_chunk',stream_id:id,offset,text});
const end={type:'entity_end',stream_id:id};

test('exact Unicode evidence stays hidden until complete and duplicates never install twice',async()=>{
    const receiver=new EntityReceiver(scope,id),text='Exact evidence 🦀 survives';
    await receiver.accept(start(manifest(text)));

    assert.equal(await receiver.accept(chunk('Exact evidence ')),null);
    assert.equal(await receiver.accept(chunk('Exact evidence ')),null);
    assert.equal(await receiver.accept(chunk('🦀 survives',15)),null);
    const verified=await receiver.accept(end);

    assert.equal(verified.text,text);
    assert.equal(await receiver.accept(start(manifest(text))),null);
    assert.equal(await receiver.accept(chunk('Exact evidence ')),null);
    assert.equal(await receiver.accept(end),null);
});

test('scope changes, offset gaps and corrupted content fail closed without partial results',async()=>{
    for(const fault of ['scope','gap','digest']){
        const receiver=new EntityReceiver(scope,id),value=manifest('safe');
        if(fault==='scope')value.scope={...scope,incarnation:'00000000-0000-0000-0000-000000000099'};
        if(fault==='digest')value.sha256='0'.repeat(64);

        if(fault==='scope')await assert.rejects(receiver.accept(start(value)),{code:'wrong_scope'});
        else{
            await receiver.accept(start(value));
            if(fault==='gap')await assert.rejects(receiver.accept(chunk('safe',1)),{code:'invalid_chunk'});
            else{await receiver.accept(chunk('safe'));await assert.rejects(receiver.accept(end),{code:'digest_mismatch'});}
        }

        await assert.rejects(receiver.accept(end),{code:'stream_invalidated'});
    }
});

test('bounds, unknown variants and unpaired Unicode never enter an entity',async()=>{
    for(const alter of [m=>m.byte_size=MAX_ENTITY_BYTES+1,m=>m.key='../secret',m=>m.kind='snapshot',m=>m.extra='private',m=>m.scope={...scope,incarnation:null}]){
        const receiver=new EntityReceiver(scope,id),value=manifest('safe');alter(value);
        await assert.rejects(receiver.accept(start(value)));
        await assert.rejects(receiver.accept(end),{code:'stream_invalidated'});
    }
    for(const text of ['', '\ud800', 'x'.repeat(MAX_CHUNK_BYTES+1)]){
        const receiver=new EntityReceiver(scope,id);await receiver.accept(start(manifest('safe')));
        await assert.rejects(receiver.accept(chunk(text)),{code:'invalid_chunk'});
    }
});

test('aborted, incomplete and conflicting streams require a newly bound receiver',async()=>{
    for(const fault of ['incomplete','conflict','abort']){
        const receiver=new EntityReceiver(scope,id),value=manifest('safe');
        await receiver.accept(start(value));await receiver.accept(chunk('sa'));

        if(fault==='incomplete')await assert.rejects(receiver.accept(end),{code:'incomplete'});
        else if(fault==='conflict')await assert.rejects(receiver.accept(chunk('xx')),{code:'conflicting_chunk'});
        else assert.equal(await receiver.accept({type:'entity_abort',stream_id:id}),null);

        await assert.rejects(receiver.accept(start(value)),{code:'stream_invalidated'});
    }
    const receiver=new EntityReceiver(scope,id);
    await receiver.accept(start(manifest('safe')));await receiver.accept(chunk('safe'));
    assert.equal((await receiver.accept(end)).text,'safe');
});

test('concurrent delivery is serialized through digest completion and caller mutation cannot retarget it',async()=>{
    const receiver=new EntityReceiver(scope,id),value=manifest('safe');
    const begun=receiver.accept(start(value));value.scope={...scope,session_id:null,incarnation:null};value.kind='account';
    const results=await Promise.all([begun,receiver.accept(chunk('safe')),receiver.accept(end),receiver.accept(end)]);

    assert.deepEqual(results.map(value=>value?.text??null),[null,null,'safe',null]);
    assert.equal(results[2].manifest.kind,'message');
    assert.deepEqual(results[2].manifest.scope,scope);
});

test('overloaded delivery invalidates queued content instead of accumulating unbounded work',async()=>{
    const receiver=new EntityReceiver(scope,id),requests=[];
    for(let i=0;i<34;i++)requests.push(receiver.accept(start(manifest('safe'))));
    const results=await Promise.allSettled(requests);

    assert.ok(results.some(result=>result.status==='rejected'&&result.reason.code==='stream_overloaded'));
    assert.ok(results.every(result=>result.status==='rejected'));
    await assert.rejects(receiver.accept(end),{code:'stream_invalidated'});
});

test('an entity receiver cannot be reused for another command stream',async()=>{
    const receiver=new EntityReceiver(scope,id);
    await receiver.accept(start(manifest('safe')));await receiver.accept(chunk('safe'));await receiver.accept(end);
    const other=manifest('different');other.stream_id='00000000-0000-0000-0000-000000000005';

    await assert.rejects(receiver.accept(start(other)),{code:'unknown_stream'});
    await assert.rejects(receiver.accept(start(manifest('safe'))),{code:'stream_invalidated'});
});

test('shared Rust and Web wire fixture installs exactly one byte-faithful result',async()=>{
    const fixture=JSON.parse(await readFile(new URL('./fixtures/entity-stream.json',import.meta.url),'utf8'));
    const receiver=new EntityReceiver(fixture.scope,fixture.stream_id),results=[];

    for(const event of fixture.events){const value=await receiver.accept(event);if(value)results.push(value);}

    assert.equal(results.length,1);
    assert.equal(results[0].text,fixture.expected_text);
});
