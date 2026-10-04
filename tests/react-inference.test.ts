import test from 'node:test';
import assert from 'node:assert/strict';
import {proposedInference} from '../resources/react/InferenceControls';

const current={account:{account_id:'a',connection_id:'p',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'},model:'m',reasoning_effort:'high',service_tier:'flex'};
const models=[{id:'m',reasoning_efforts:['low','high'],service_tiers:['flex']},{id:'other',reasoning_efforts:['low']}];

test('direct model choice resets dependent reasoning and service settings for the next run',()=>{
 assert.deepEqual(proposedInference(current,models,'model','other'),{account:current.account,model:'other',reasoning_effort:null,service_tier:null});
 assert.deepEqual(proposedInference(current,models,'reasoning','low'),{account:current.account,model:'m',reasoning_effort:'low',service_tier:'flex'});
 assert.throws(()=>proposedInference(current,models,'reasoning','unsupported'),/Reasoning choices changed/);
 assert.throws(()=>proposedInference(current,models,'model','unknown'),/Model choices changed/);
});

test('service selection preserves reasoning and rejects unadvertised service tiers',()=>{
 const current={account:{account_id:'a'},model:'m',reasoning_effort:'high',service_tier:null};
 const models=[{id:'m',service_tiers:['flex']}];
 assert.equal(proposedInference(current,models,'service','flex').service_tier,'flex');
 assert.equal(proposedInference(current,models,'service','flex').reasoning_effort,'high');
 assert.throws(()=>proposedInference(current,models,'service','invented'),/Service choices changed/);
});
