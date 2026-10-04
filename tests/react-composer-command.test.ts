import test from 'node:test';
import assert from 'node:assert/strict';
import {parseComposerCommand,dispatchComposerCommand} from '../resources/react/composer-command';
import {completeNewVoyage} from '../resources/react/new-voyage-delivery';
import {defaultGoalLimits} from '../resources/react/goals';

test('only literal goal command boundaries intercept inference',()=>{
    assert.deepEqual(parseComposerCommand('/goal'),{kind:'goal-status'});
    assert.deepEqual(parseComposerCommand('/goal   '),{kind:'goal-status'});
    assert.deepEqual(parseComposerCommand('/goal Build safely'),{kind:'goal-set',objective:'Build safely'});
    for(const text of ['/goals','Explain /goal',' /goal','/goalkeeper'])assert.equal(parseComposerCommand(text).kind,'message');
});
function fixture(){
    const calls:string[]=[];
    const tab:any={snapshot:{session_id:'s',goal:{revision:0,goal:null}},incarnation:'i',stale:false};
    const workspace:any={tabs:new Map([['k',tab]]),refresh:async()=>{calls.push('read');},restoreDraft:async()=>{},draft:()=>{},goalUpdate:async(_key:any,_review:any,action:any)=>{calls.push('goal');assert.equal(action.continue_automatically,false);},act:async()=>{calls.push('inference');}};
    return {workspace,calls};
}
test('status and objective only read and open explicit paused review',async()=>{
    const {workspace,calls}=fixture();const reviews:any[]=[];
    await dispatchComposerCommand(workspace,'k','/goal',{onGoalReview:value=>reviews.push(value)});
    await dispatchComposerCommand(workspace,'k','/goal Build',{onGoalReview:value=>reviews.push(value)});
    assert.deepEqual(calls,['read','read']);assert.equal(reviews[0].action,undefined);
    assert.equal(reviews[1].action.continue_automatically,false);assert.equal(reviews[1].action.replace_goal_id,null);
});
test('new goal delivery uses fresh metadata only and recovery never replays',async()=>{
    const {workspace,calls}=fixture();const message:any={text:'/goal Build',pictures:[],access:'approval',send:true,applyAccess:true,goalIntent:{objective:'Build',limits:defaultGoalLimits,replace_goal_id:null,continue_automatically:false}};
    await completeNewVoyage(workspace,'k',message);assert.deepEqual(calls,['read','goal']);
    calls.length=0;await completeNewVoyage(workspace,'k',{...message,send:false,applyAccess:false});assert.deepEqual(calls,['read']);
});
