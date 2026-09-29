import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {ConversationStream, renderPreviews} from '../resources/js/conversation-stream.js';
const snapshot = {session_id:'session', observation_cursor:10};
const event = (cursor=12, fields={}) => ({protocol:1,session_id:'session',incarnation:'incarnation',error:null,outcome_unknown:false,result:{projection:'public-v1',cursor,latest_cursor:cursor,replay_gap:false,events:[{cursor,session_id:'session',kind:'run'}]},...fields});
test('native invalidations respect identity, global cursor gaps, duplicates and unknown kinds', () => {
    const stream = new ConversationStream(); stream.seed(snapshot,'incarnation');
    assert.equal(stream.accept(event()),'refresh');
    assert.equal(stream.accept(event()),'duplicate');
    const unknown=event(16);unknown.result.events[0].kind='future';
    assert.equal(stream.accept(unknown),'refresh');
    assert.equal(stream.accept(event(15)),'resync');
    assert.equal(stream.accept(event(17)),'resync','invalid state cannot append before snapshot');
    stream.seed(snapshot,'incarnation');
    assert.equal(stream.accept(event(12,{incarnation:'new-owner'})),'resync');
    stream.seed({...snapshot,session_id:'other'},'incarnation');
    assert.equal(stream.accept(event()),'resync','switch rejects previous session');
});
test('replay gap, errors, malformed cursor and reconnect require canonical seeding', () => {
    for(const alter of [e=>e.result.replay_gap=true,e=>e.error='cursor ahead',e=>e.outcome_unknown=true,e=>e.result.cursor=NaN,e=>e.result.events[0].cursor=9,e=>e.result.events[0].session_id='other',e=>e.result.latest_cursor=1]) {
        const stream=new ConversationStream();stream.seed(snapshot,'incarnation');const value=event();alter(value);
        assert.equal(stream.accept(value),'resync');stream.seed({...snapshot,observation_cursor:30},'new');
        assert.equal(stream.accept(event(32,{incarnation:'new'})),'refresh');
    }
});
test('DOM previews preserve disclosure, bound UTF-8 and reconcile finalized/canonical identities', () => {
    globalThis.document=new JSDOM('<main></main>').window.document;
    const root=document.querySelector('main');
    const tool={attempt_id:'a',index:0,call_id:'fragment',name:'shell',arguments:'{"command":"<script>"',truncated:false};
    const reasoning={attempt_id:'a',index:0,kind:'thinking',text:'disclosed',finalized:false};
    renderPreviews(root,{tool_previews:[tool],reasoning_previews:[reasoning]});
    assert.equal(root.children.length,2); assert.equal(root.querySelector('script'),null);
    root.children[0].open=true;tool.arguments+='}';renderPreviews(root,{tool_previews:[tool]});
    assert.equal(root.children[0].open,true);assert.equal(root.children.length,1);
    tool.arguments='é'.repeat(20000);renderPreviews(root,{tool_previews:[tool]});
    assert.equal(new TextEncoder().encode(root.querySelector('pre').textContent).length,16384);
    assert.match(root.textContent,/bounded/);
    tool.call_id='canonical';reasoning.finalized=true;
    renderPreviews(root,{tool_previews:[tool],reasoning_previews:[reasoning]},[{tool_calls:[{id:'canonical'}]}]);
    assert.equal(root.children.length,1);assert.match(root.textContent,/finalized disclosure/);
    renderPreviews(root,null);assert.equal(root.hidden,true);assert.equal(root.children.length,0);
});

test('public-v2 appends UTF-8 deltas and canonical messages at sparse cursors without a snapshot', () => {
    const stream = new ConversationStream(); stream.seed(snapshot,'incarnation');
    const state={revision:3,observation_cursor:10,messages:[],run:{run_id:'run',live_text:'é'}};
    const page=(cursor,kind,payload,revision=3)=>({protocol:1,session_id:'session',incarnation:'incarnation',error:null,outcome_unknown:false,result:{projection:'public-v2',cursor,latest_cursor:cursor+4,has_more:false,replay_gap:false,events:[{cursor,session_id:'session',revision,run_id:'run',kind,payload}]}});
    assert.equal(stream.accept(page(17,'text_delta',{offset:2,text:'!'}),state),'append');
    assert.equal(state.run.live_text,'é!');
    assert.equal(stream.accept(page(17,'text_delta',{offset:2,text:'!'}),state),'duplicate');
    const message={message_index:0,role:'assistant',content:'é!'};
    assert.equal(stream.accept(page(25,'message_finalized',{message_index:0,message}),state),'append');
    assert.deepEqual(state.messages,[message]);
    assert.equal(stream.accept(page(31,'text_delta',{offset:0,text:'wrong'}),state),'resync');
});
test('public-v2 unknown events, incarnation changes and replay gaps recover through snapshot', () => {
    const stream=new ConversationStream();stream.seed(snapshot,'incarnation');
    const state={revision:3,messages:[],run:{run_id:'run'}};
    const page=event(15);page.result.projection='public-v2';page.result.events[0]={cursor:15,session_id:'session',revision:4,kind:'future',payload:{}};
    assert.equal(stream.accept(page,state),'refresh');
    const changed=structuredClone(page);changed.incarnation='replacement';changed.result.cursor=18;changed.result.events[0].cursor=18;
    assert.equal(stream.accept(changed,state),'resync');
    stream.seed(snapshot,'incarnation');page.result.replay_gap=true;
    assert.equal(stream.accept(page,state),'resync');
});
