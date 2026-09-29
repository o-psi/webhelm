import test from 'node:test';
import assert from 'node:assert/strict';
import {changeEntries} from '../resources/react/WorkspaceChanges';
import {Workspace} from '../resources/react/workspace';

test('Git status entries retain exact paths and separate staged, unstaged and untracked state',()=>{
    const entries=changeEntries(' M src/a.ts\0M  src/b.ts\0?? docs/new file.md\0');
    assert.deepEqual(entries.map(({path,staged,unstaged,untracked})=>[path,staged,unstaged,untracked]),[
        ['src/a.ts',false,true,false],['src/b.ts',true,false,false],['docs/new file.md',false,false,true],
    ]);
    assert.equal(changeEntries(' M incomplete').length,0,'a partial record cannot claim a complete path');
});

test('workspace Changes reads require advertised capability, exact Voyage and read permission',async()=>{
    const session='session', key=JSON.stringify(['vessel',session]);let reads=0;
    const client={async exchange({command}:any){
        if(command.op==='workspace_changes'){
            reads++;
            return {protocol:1,outcome_unknown:false,error:null,result:{session_id:session,incarnation:'incarnation',result:{scope:command.scope,path:command.path||'.',text:' M src/a.ts\0',truncated:false,observed_at_ms:1}}};
        }
        throw new Error('Unexpected operation');
    }};
    const connection:any={id:'vessel',client,voyages:[],journal:{entries:()=>[]}};
    const connections=new Map<string,any>();
    const workspace=new Workspace(()=>connections);
    workspace.open('vessel',session,'Fixture');
    connections.set('vessel',connection);
    const tab=workspace.tabs.get(key)!;
    Object.assign(tab,{snapshot:{session_id:session,revision:1},incarnation:'incarnation',stale:false,freshAt:Date.now(),scope:'workspaces',rights:['history'],capabilities:['workspace_changes']});
    await assert.rejects(workspace.changes(key,'status'),/permission/);assert.equal(reads,0);
    tab.rights=['workspace_read'];
    assert.equal((await workspace.changes(key,'status')).text,' M src/a.ts\0');assert.equal(reads,1);
    tab.stale=true;await assert.rejects(workspace.changes(key,'status'),/Reconnect/);assert.equal(reads,1);
    workspace.close();
});
