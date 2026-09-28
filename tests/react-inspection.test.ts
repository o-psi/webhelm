import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectionRequest,inventorySupports} from '../resources/react/inspection-command';
import {Workspace} from '../resources/react/workspace';

test('inspection requests are fixed read scopes with bounded workspace-relative paths',()=>{
 assert.deepEqual(inspectionRequest('file','src/app.ts'),{name:'read_file',arguments:{path:'src/app.ts'}});
 assert.deepEqual(inspectionRequest('directory','.'),{name:'list_directory',arguments:{path:'.',recursive:false}});
 const status=inspectionRequest('status',"team's work");
 assert.equal(status.name,'shell');assert.match(status.arguments.command,/status --porcelain=v1/);assert.match(status.arguments.command,/'team'"'"'s work'$/);
 for(const path of ['/etc/passwd','../secret','a/../secret','a\\b','a:b','line\nbreak'])assert.throws(()=>inspectionRequest('file',path),/workspace-relative/);
 assert.equal(inventorySupports({section:'tools',value:[{name:'shell',input_schema:{}}]},'shell'),true);
 assert.equal(inventorySupports({section:'tools',value:[{name:'shell'}]},'shell'),false);
});

test('workspace inspection admits one exact operator run and preserves the message draft',async()=>{
 const commands:any[]=[],prepared:string[]=[],settled:string[]=[];
 const connection:any={id:'c',name:'Vessel',client:{async exchange({command}:any){
  commands.push(command);
  let result:any,revision=1;
  if(command.op==='controls')result={section:'tools',value:[{name:'shell',input_schema:{}}]};
  else if(command.op==='operator_tool')result={command_id:command.command_id,status:'accepted',run_id:'run-exact'};
  else if(command.op==='snapshot'){revision=2;result={session_id:'s',revision,run:{run_id:'run-exact',state:'running'},messages:[]};}
  else if(command.op==='capabilities')result={scope:'owner'};
  else if(command.op==='decisions')result=[];
  else if(command.op==='message_chunk')result={data:JSON.stringify({role:'assistant',content:'exact diff'}),has_more:false,total_bytes:52,next_offset:52};
  else throw new Error(command.op);
  return {protocol:1,outcome_unknown:false,error:null,result:{session_id:'s',incarnation:'i',result}};
 }},journal:{entries:()=>[],prepare:(command:any)=>prepared.push(command.command_id),settle:(id:string)=>settled.push(id)}};
 const workspace=new Workspace(()=>new Map([['c',connection]]));
 const tab:any={key:'k',vessel:'c',session:'s',title:'Voyage',draft:'unsent',snapshot:{session_id:'s',revision:1,run:{state:'idle'},messages:[]},incarnation:'i',stale:false,busy:false,notice:'',freshAt:Date.now(),decisions:[],scope:'owner',pictures:[]};
 workspace.tabs.set('k',tab);
 const run=await workspace.inspect('k','unstaged','.');
 assert.equal(run,'run-exact');assert.equal(commands.filter(command=>command.op==='operator_tool').length,1);
 assert.equal(prepared.length,1);assert.deepEqual(settled,prepared);
 assert.equal(tab.draft,'unsent');
 assert.equal(await workspace.canonicalMessage('k',8,2),'exact diff');
 workspace.close();
});

test('uncertain inspection admission retains its durable identity and never retries',async()=>{
 const commands:any[]=[],pending:any[]=[];
 const connection:any={id:'c',client:{async exchange({command}:any){commands.push(command);if(command.op==='controls')return {protocol:1,outcome_unknown:false,result:{session_id:'s',incarnation:'i',result:{section:'tools',value:[{name:'shell',input_schema:{}}]}}};return {protocol:1,outcome_unknown:true};}},journal:{entries:()=>pending,prepare:(command:any)=>pending.push({session_id:'s',command_id:command.command_id,op:command.op}),settle:()=>assert.fail('uncertain intent must remain')}};
 const workspace=new Workspace(()=>new Map([['c',connection]]));
 workspace.tabs.set('k',{key:'k',vessel:'c',session:'s',title:'Voyage',draft:'unsent',snapshot:{session_id:'s',revision:1,run:{state:'idle'}},incarnation:'i',stale:false,busy:false,notice:'',freshAt:Date.now(),decisions:[],scope:'owner',pictures:[]} as any);
 await assert.rejects(workspace.inspect('k','status','.'),/unconfirmed/);
 assert.equal(commands.filter(command=>command.op==='operator_tool').length,1);
 assert.equal(pending.length,1);assert.equal(workspace.tabs.get('k')?.draft,'unsent');
 workspace.close();
});
