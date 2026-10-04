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

test('scope memory is bounded and an interrupted generation is replaced', () => {
    const reducer = new EventInitialization(); reducer.accept(begin);
    const value = 'x'.repeat(32760);
    for (let sequence = 0; sequence < 256; sequence++) reducer.accept({...entity,sequence,entity_id:`message:${sequence}`,value});
    assert.throws(() => reducer.accept({...entity,sequence:256,entity_id:'overflow',value}));
    const nextFence = {...fence,generation:'new'};
    reducer.accept({...begin,fence:nextFence,cursor:90});
    assert.throws(() => reducer.accept(complete));
    const state = reducer.accept({kind:'complete',fence:nextFence,sequence:0,cursor:90});
    assert.equal(state.entities.size,0);
});

test('presentation is derived only from canonical typed entities',async()=>{
    const {entityPresentation}=await import('../resources/js/event-initialization.js');
    const scope={fence,cursor:40,entities:new Map([['session:session',{session_id:'s',revision:9,model:'m'}],['message:message:1',{message_index:1,content:'b'}],['message:message:0',{message_index:0,content:'a'}],['goal:goal',{revision:3,goal:null}]])};
    const view=entityPresentation(scope);
    assert.deepEqual(view.messages.map(message=>message.content),['a','b']);
    assert.equal(view.goal.revision,3);
    assert.equal(view.observation_cursor,40);
    assert.throws(()=>entityPresentation({...scope,fence:{...fence,session_id:'other'}}));
});

test('typed presentation retains interrupted-work warning and turn navigation',async()=>{
    const {entityPresentation}=await import('../resources/js/event-initialization.js');
    const scope={fence,cursor:3,entities:new Map([['session:session',{session_id:'s',revision:1,model:'m',message_offset:90,total_messages:100}],['run:turns',[{run_id:'interrupted',state:'failed'}]],['resource:recovery_notice','Previous work has unknown effects; not repeated.']])};
    const view=entityPresentation(scope);
    assert.equal(view.turns[0].run_id,'interrupted');
    assert.match(view.recovery_notice,/unknown effects/);
    assert.equal(view.message_offset,90);assert.equal(view.total_messages,100);
});
