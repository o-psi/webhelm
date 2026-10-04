import test from 'node:test';
import assert from 'node:assert/strict';
import {EventInitialization} from '../resources/js/event-initialization.js';
const fence = {generation:'g',session_id:'s',incarnation:'i'};
const begin = {kind:'begin',fence,cursor:40};
const entity = {kind:'entity',fence,sequence:0,entity_kind:'message',entity_id:'message:0',value:{text:'é'}};
const complete = {kind:'complete',fence,sequence:1,cursor:40};
test('initialization publishes only at the exact barrier and clones values', () => {
    const reducer = new EventInitialization();
    assert.throws(() => reducer.accept(complete));
    assert.equal(reducer.accept(begin),null);
    assert.equal(reducer.accept(entity),null);
    assert.throws(() => reducer.accept({...complete,cursor:41}));
    const state = reducer.accept(complete);
    assert.equal(state.cursor,40);
    assert.deepEqual(state.entities.get('message:message:0'),{text:'é'});
    assert.throws(() => reducer.accept(complete));
});
test('reordered, oversized and wrong-incarnation pages cannot publish', () => {
    const reducer = new EventInitialization(); reducer.accept(begin);
    assert.throws(() => reducer.accept({...entity,sequence:1}));
    assert.throws(() => reducer.accept({...entity,fence:{...fence,incarnation:'other'}}));
    assert.throws(() => reducer.accept({...entity,value:'é'.repeat(32768)}));
    assert.throws(() => reducer.accept({...entity,entity_kind:'snapshot'}));
    reducer.accept(entity);
    assert.throws(() => reducer.accept(entity));
    reducer.accept({kind:'reset',fence,reason:'retention_gap'});
    assert.throws(() => reducer.accept(complete));
});

test('content chunks preserve UTF-8 byte offsets and owner fencing', async () => {
    const {acceptContentChunk} = await import('../resources/js/event-initialization.js');
    const chunk = {fence,entity_id:'message:0',offset:0,total_bytes:2,text:'é'};
    assert.equal(acceptContentChunk(chunk,fence,0),2);
    assert.throws(() => acceptContentChunk(chunk,fence,1));
    assert.throws(() => acceptContentChunk(chunk,{...fence,incarnation:'other'},0));
    assert.throws(() => acceptContentChunk({...chunk,text:''},fence,0));
    assert.throws(() => acceptContentChunk({...chunk,total_bytes:1},fence,0));
});
