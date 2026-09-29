import test from 'node:test';
import assert from 'node:assert/strict';
import {validCommand} from '../gateway/protocol.js';
const id='11111111-1111-4111-8111-111111111111';
const valid=command=>validCommand({type:'command',request_id:id,request:{protocol:1,command}});
const limits={runs:20,tokens:200000,elapsed_ms:3600000,no_progress_runs:3};
const command=action=>({op:'goal_update',session_id:id,incarnation:id,command_id:id,expected_revision:0,expires_at_ms:1000,action});
const set={action:'set',objective:'Verify the result\nRetain evidence.',limits,replace_goal_id:null,continue_automatically:false};
test('Goal protocol admits bounded owner requests without accepting model or execution authority',()=>{
    assert.equal(valid({op:'goal_read',session_id:id}),true);
    for(const action of [set,{action:'edit',goal_id:id,objective:'Changed',limits},...['pause','resume','clear'].map(action=>({action,goal_id:id}))])assert.equal(valid(command(action)),true);
    for(const action of [{...set,objective:' '},{...set,objective:'x'.repeat(8193)},{...set,objective:'\u001b[31m'},
        {...set,limits:{...limits,tokens:0}},{...set,limits:{...limits,runs:1001}},{...set,limits:{...limits,elapsed_ms:999}},
        {...set,limits:{...limits,no_progress_runs:11}},{...set,continue_automatically:'true'},
        {...set,authority:'owner'},{action:'complete',goal_id:id},{action:'report',outcome:'complete'},
        {action:'resume',goal_id:id,limits},{action:'clear'}])assert.equal(valid(command(action)),false);
    assert.equal(valid({...command(set),token:'forbidden'}),false);
    assert.equal(valid({...command(set),expected_revision:-1}),false);
});
