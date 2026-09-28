import test from 'node:test';
import assert from 'node:assert/strict';
import {recordedChanges} from '../resources/react/ReviewChanges';

test('recorded edits are identified from tool requests and do not claim current filesystem state',()=>{
 const messages=[
  {role:'assistant',message_index:0,tool_calls:[{id:'patch',function:{name:'apply_patch',arguments:JSON.stringify({patch:'*** Begin Patch\n*** Update File: src/app.ts\n+new line\n*** End Patch'})}},{id:'write',function:{name:'write_file',arguments:{path:'src/other.ts',content:'content'}}},{id:'read',function:{name:'read_file',arguments:{path:'src/app.ts'}}}]},
  {role:'tool',tool_call_id:'patch',tool_success:true,content:'Applied'},
  {role:'tool',tool_call_id:'write',tool_success:false,content:'Refused'},
 ];
 const changes=recordedChanges(messages);
 assert.deepEqual(changes.map(change=>[change.path,change.kind,change.status]),[['src/app.ts','Patch','Done'],['src/other.ts','File write','Failed']]);
 assert.match(changes[0].preview,/\+new line/);
 assert.equal(changes.some(change=>change.path==='src/app.ts'&&change.kind==='File read'),false);
});
