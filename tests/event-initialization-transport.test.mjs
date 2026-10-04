import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeEntities} from '../resources/js/vessel-client.js';
const fence={generation:'g',session_id:'s',incarnation:'i'};
const reply=result=>({protocol:1,error:null,outcome_unknown:false,result:{session_id:'s',incarnation:'i',result}});
test('live transport paginates canonical entities without snapshot requests', async()=>{
    const requests=[];
    const client={exchange:async request=>{
        requests.push(request.command);
        const first=request.command.offset===0;
        return reply({version:3,revision:9,cursor:40,next_offset:first?1:2,has_more:first,events:first?[{kind:'begin',fence,cursor:40},{kind:'entity',fence,sequence:0,entity_kind:'session',entity_id:'session',value:{name:'n'}}]:[{kind:'entity',fence,sequence:1,entity_kind:'goal',entity_id:'goal',value:{revision:9,goal:null}},{kind:'complete',fence,sequence:2,cursor:40}]});
    }};
    const scope=await initializeEntities(client,'s','i',{generation:'g'});
    assert.equal(scope.entities.size,2);
    assert.deepEqual(requests.map(request=>request.op),['initialize_entities','initialize_entities']);
    assert.equal(requests[1].expected_revision,9);
    assert.equal(requests[1].expected_cursor,40);
});
test('transport rejects changed owner and missing barriers without fallback',async()=>{
    const client={exchange:async()=>reply({version:3,revision:9,cursor:40,next_offset:0,has_more:false,events:[]})};
    await assert.rejects(initializeEntities(client,'s','i',{generation:'g'}),/barrier/);
});

test('canonical replay keeps sparse cursors and never requests legacy recovery',async()=>{
    const {replayEntities}=await import('../resources/js/vessel-client.js');
    const commands=[],applied=[];
    const client={exchange:async({command})=>{commands.push(command);return reply({version:3,cursor:12,latest_cursor:12,has_more:false,events:[{session_id:'s',cursor:12,kind:'text_delta',payload:{offset:0,text:'é'}}]});}};
    assert.deepEqual(await replayEntities(client,'s','i',3,event=>applied.push(event)),{cursor:12});
    assert.equal(applied.length,1);assert.equal(commands[0].op,'replay_entities');
    client.exchange=async()=>reply({version:3,cursor:12,reset:'retention_gap',events:[]});
    assert.deepEqual(await replayEntities(client,'s','i',12,()=>assert.fail('no synthetic delta')),{reset:'retention_gap',cursor:12});
});
