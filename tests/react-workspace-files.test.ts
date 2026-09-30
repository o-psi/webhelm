import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Workspace} from '../resources/react/workspace';
import {filePreviewAvailable} from '../resources/react/WorkspaceFiles';

function fixture(){
    const session='session',key=JSON.stringify(['vessel',session]);
    let exchanges=0,reply:any=null,barrier:Promise<void>|null=null;
    const client={async exchange({command}:any){
        assert.equal(command.op,'workspace_file');exchanges++;
        if(barrier)await barrier;
        const text='Current document €\n';
        return {protocol:1,outcome_unknown:false,error:null,result:reply||{session_id:session,incarnation:'incarnation',result:{path:command.path,text,truncated:false,observed_at_ms:1,file_bytes:Buffer.byteLength(text),observed_bytes:Buffer.byteLength(text),preview_sha256:createHash('sha256').update(text).digest('hex')}}};
    }};
    const connections=new Map<string,any>();
    const workspace=new Workspace(()=>connections);
    workspace.open('vessel',session,'Fixture');connections.set('vessel',{id:'vessel',client,voyages:[],journal:{entries:()=>[]}});
    const tab=workspace.tabs.get(key)!;
    Object.assign(tab,{snapshot:{session_id:session,revision:1},incarnation:'incarnation',stale:false,freshAt:Date.now(),scope:'workspaces',rights:['workspace_read'],capabilities:['workspace_file']});
    return {workspace,tab,key,get exchanges(){return exchanges;},get reply(){return reply;},set reply(value:any){reply=value;},set barrier(value:Promise<void>){barrier=value;}};
}

test('file preview uses explicit read authority and preserves the draft without an operator run',async()=>{
    const f=fixture();f.workspace.draft(f.key,'Existing draft');
    assert.equal(filePreviewAvailable(f.tab),true);
    const value=await f.workspace.file(f.key,'docs/current.md');
    assert.equal(value.text,'Current document €\n');assert.equal(f.exchanges,1);
    assert.equal(f.tab.draft,'Existing draft');assert.equal(f.tab.busy,false);
    f.tab.rights=['history'];assert.equal(filePreviewAvailable(f.tab),false);
    await assert.rejects(f.workspace.file(f.key,'docs/current.md'),/permission/);assert.equal(f.exchanges,1);
    f.tab.rights=['workspace_read'];f.tab.capabilities=[];
    await assert.rejects(f.workspace.file(f.key,'docs/current.md'),/capability/);assert.equal(f.exchanges,1);
    f.workspace.close();
});

test('invalid paths and stale identity never disclose a selected file',async()=>{
    const f=fixture();
    for(const path of ['../outside','/private','a\\b','a\nb','./file','a//b',''])await assert.rejects(f.workspace.file(f.key,path),/relative/);
    assert.equal(f.exchanges,0);
    let release!:()=>void;f.barrier=new Promise<void>(resolve=>{release=resolve;});
    const observation=f.workspace.file(f.key,'docs/current.md');
    f.tab.rights=[];release();
    await assert.rejects(observation,/changed/);assert.equal(f.exchanges,1);
    f.workspace.close();
});

test('wrong-file and oversized Unicode responses are rejected by the actual byte bound',async()=>{
    const f=fixture();
    const text='€'.repeat(32768);
    f.reply={session_id:'session',incarnation:'incarnation',result:{path:'docs/current.md',text,truncated:true,observed_at_ms:1,file_bytes:999999,observed_bytes:Buffer.byteLength(text),preview_sha256:'a'.repeat(64)}};
    await assert.rejects(f.workspace.file(f.key,'docs/current.md'),/invalid/);
    f.reply.result.text='other';f.reply.result.path='docs/other.md';f.reply.result.observed_bytes=5;
    await assert.rejects(f.workspace.file(f.key,'docs/current.md'),/invalid/);
    f.workspace.close();
});

test('replacement of a same-key Tab fences the earlier asynchronous file observation',async()=>{
    const f=fixture();
    let release!:()=>void;f.barrier=new Promise<void>(resolve=>{release=resolve;});
    const pending=f.workspace.file(f.key,'docs/current.md');
    f.workspace.tabs.set(f.key,{...f.tab,rights:['history']});
    release();
    await assert.rejects(pending,/changed/);
    assert.equal(f.exchanges,1);
    f.workspace.close();
});
