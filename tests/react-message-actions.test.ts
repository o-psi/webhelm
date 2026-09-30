import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {Workspace,type Tab} from '../resources/react/workspace.ts';
import {messagePoint,placeMessageDraft,reviewMessageDraft} from '../resources/react/message-draft.ts';
import {sidebarActions} from '../resources/js/sidebar-actions.js';

const vessel='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222',owner='33333333-3333-4333-8333-333333333333';
function draftFixture(){
    const calls:any[]=[];
    const connection={id:vessel,name:'Fixture',client:{async exchange(command:any){calls.push(command);throw Error('No request expected');}},journal:{entries:()=>[]},voyages:[],status:'Connected'};
    const workspace=new Workspace(()=>new Map([[vessel,connection]]));
    const picture={id:'prepared-picture',name:'kept.png',size:1,url:'blob:kept',base64:'eA==',uploadId:'kept-upload',file:new File([new Uint8Array([1])],'kept.png',{type:'image/png'})};
    const message={role:'user',message_index:4,content:'Canonical earlier text'};
    const tab={key:JSON.stringify([vessel,session]),vessel,session,title:'Fixture',draft:'Existing unsent text',pictures:[picture],stale:false,busy:false,draftLoading:false,incarnation:owner,freshAt:Date.now(),snapshot:{session_id:session,revision:7,messages:[message]},notice:'',decisions:[],receiptStates:{}} as Tab;
    workspace.tabs.set(tab.key,tab);
    return {workspace,tab,picture,message,calls};
}

test('message editing prepares local text with explicit placement and preserves pictures, history and pending delivery metadata',async()=>{
    for(const placement of ['append','replace'] as const){
        const {workspace,tab,picture,message,calls}=draftFixture();
        const saved:any[]=[];
        tab.draftState={value:{delivery:'review'},set(value:any){saved.push(value);}} as any;
        const pictures=tab.pictures,review=await reviewMessageDraft(workspace,tab,message);
        assert.equal(tab.draft,'Existing unsent text');assert.equal(calls.length,0);
        placeMessageDraft(workspace,tab,review,'Edited text',placement);
        assert.equal(tab.draft,placement==='append'?'Existing unsent text\n\nEdited text':'Edited text');
        assert.equal(tab.pictures,pictures);assert.equal(tab.pictures[0],picture);
        assert.equal(message.content,'Canonical earlier text');assert.equal(saved.at(-1).delivery,'review');
        assert.equal(saved.at(-1).pictures[0],picture.file,'persistent draft keeps the prepared picture bytes');
        assert.deepEqual(calls,[],'preparing a draft must not Submit, Steer, upload, branch or execute tools');
    }
});

test('stale source, changed composer, missing canonical boundary and UTF-8 overflow leave the current draft and pictures intact',async()=>{
    const changes=[(tab:Tab)=>tab.snapshot.revision++,(tab:Tab)=>tab.incarnation='changed-owner',(tab:Tab)=>tab.stale=true,(tab:Tab)=>tab.busy=true,(tab:Tab)=>tab.draftLoading=true,(tab:Tab)=>tab.session='changed-session',(tab:Tab)=>tab.draft='Newer unsent text',(tab:Tab)=>tab.pictures=[{...tab.pictures[0],id:'new-picture'}],(tab:Tab)=>tab.snapshot.messages[0].content='Changed canonical text'];
    for(const change of changes){
        const {workspace,tab,message,calls}=draftFixture(),review=await reviewMessageDraft(workspace,tab,message);
        change(tab);const draft=tab.draft,pictures=tab.pictures;
        assert.throws(()=>placeMessageDraft(workspace,tab,review,'Edited','replace'));
        assert.equal(tab.draft,draft);assert.equal(tab.pictures,pictures);assert.deepEqual(calls,[]);
    }
    const {workspace,tab,message}=draftFixture(),review=await reviewMessageDraft(workspace,tab,message);
    assert.throws(()=>placeMessageDraft(workspace,tab,review,'界'.repeat(21846),'replace'),/64 KiB/);
    assert.throws(()=>messagePoint(tab,{...message,role:'assistant'}));
    assert.equal(tab.draft,'Existing unsent text');
});

test('truncated text uses the existing bounded expansion and refuses a revision change before review',async()=>{
    for(const stale of [false,true]){
        const {workspace,tab,message,calls}=draftFixture();
        (message as any).projection_truncated=true;
        const reads:any[]=[];
        workspace.expand=async(key,index)=>{reads.push({key,index});if(stale)tab.snapshot.revision++;else tab.snapshot.messages=[{role:'user',message_index:4,content:'Complete canonical text',projection_truncated:false}];};
        const reviewing=reviewMessageDraft(workspace,tab,message);
        if(stale)await assert.rejects(reviewing,/conversation changed/);
        else assert.equal((await reviewing).text,'Complete canonical text');
        assert.deepEqual(reads,[{key:tab.key,index:4}]);assert.equal(tab.draft,'Existing unsent text');assert.equal(tab.pictures.length,1);assert.deepEqual(calls,[]);
    }
});

function branchFixture(){
    const dom=new JSDOM('<div id="root"><form id="sidebar-action-form"></form></div>');
    const form=dom.window.document.querySelector('form')!;
    for(const id of ['action-title','action-target','action-status','details-summary','details-advanced','access-review','access-summary','confirm-label','action-details','details-name','details-process','details-run','details-access','details-workspace']){const node=dom.window.document.createElement('p');node.id=`sidebar-${id}`;form.append(node);}
    for(const id of ['name','access','branch','retain','confirm']){const field=dom.window.document.createElement('label');field.id=`sidebar-${id}-field`;const input=dom.window.document.createElement(id==='branch'||id==='access'?'select':'input');input.id=`sidebar-${id}`;field.append(input);form.append(field);}
    for(const id of ['submit','reconcile','dismiss','branch-more']){const button=dom.window.document.createElement('button');button.id=`sidebar-${id}`;button.type=id==='submit'?'submit':'button';form.append(button);}
    const previous=Object.getOwnPropertyDescriptor(globalThis,'Option');Object.defineProperty(globalThis,'Option',{configurable:true,value:dom.window.Option});
    const commands:any[]=[],entries:any[]=[];let revision=7,historyRole='user',historyIndex=250;
    const connection:any={id:vessel,name:'Fixture',journal:{entries:()=>entries,prepare:(command:any)=>entries.push(command),settle:(id:string)=>{const index=entries.findIndex(entry=>entry.command_id===id);if(index>=0)entries.splice(index,1);}},client:{async exchange(request:any){
        const command=request.command;commands.push(command);let result:any;
        if(command.op==='capabilities')result={scope:'owner'};
        else if(command.op==='inspect')result={session_id:session,incarnation:owner,state:'live'};
        else if(command.op==='snapshot')result={session_id:session,incarnation:owner,result:{session_id:session,revision,run:{state:'idle'}}};
        else if(command.op==='history')result={session_id:session,incarnation:owner,result:{revision,message_offset:command.offset,messages:[{role:historyRole,message_index:historyIndex,content:'Selected earlier user request'}],next_offset:251,has_more:false}};
        else if(command.op==='branch')result={session_id:command.branch_id,incarnation:'44444444-4444-4444-8444-444444444444'};
        else throw Error(`Unexpected ${command.op}`);
        return {protocol:1,outcome_unknown:false,result};
    }}};
    const controller=sidebarActions(dom.window.document.querySelector('#root'),{modal:()=>({async show(){},close(){}})});
    const boundary={index:250,revision:7,incarnation:owner};
    return {dom,form,connection,commands,entries,controller,boundary,get revision(){return revision;},set revision(value:number){revision=value;},set historyRole(value:string){historyRole=value;},set historyIndex(value:number){historyIndex=value;},close(){controller.invalidate();dom.window.close();if(previous)Object.defineProperty(globalThis,'Option',previous);else delete(globalThis as any).Option;}};
}

test('branch from an earlier user message uses bounded canonical review and waits for explicit Create branch',async()=>{
    const fixture=branchFixture();
    try{
        await fixture.controller.open(fixture.connection,{session_id:session,name:'Fixture'},'branch',fixture.boundary);
        const select=fixture.dom.window.document.querySelector<HTMLSelectElement>('#sidebar-branch')!;
        assert.equal(select.value,'250');assert.equal(select.disabled,true);
        const history=fixture.commands.find(command=>command.op==='history');assert.equal(history.offset,250);assert.equal(history.limit,128);assert.equal(history.expected_revision,7);
        assert.equal(fixture.commands.some(command=>command.op==='branch'),false);assert.deepEqual(fixture.entries,[]);
        fixture.form.dispatchEvent(new fixture.dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
        const branches=fixture.commands.filter(command=>command.op==='branch');assert.equal(branches.length,1);
        assert.equal(branches[0].session_id,session);assert.equal(branches[0].incarnation,owner);assert.equal(branches[0].through_message,250);assert.equal(branches[0].expected_revision,7);
        assert.deepEqual(fixture.entries,[]);assert.equal(fixture.commands.some(command=>['submit','steer','operator_tool'].includes(command.op)),false);
    }finally{fixture.close();}
});

test('selected branch boundary is copied before asynchronous dialog and state reads',async()=>{
    const fixture=branchFixture();
    try{
        const boundary={...fixture.boundary};
        const opening=fixture.controller.open(fixture.connection,{session_id:session,name:'Fixture'},'branch',boundary);
        boundary.index=251;boundary.revision=8;boundary.incarnation='changed';
        await opening;
        assert.equal(fixture.dom.window.document.querySelector<HTMLSelectElement>('#sidebar-branch')!.value,'250');
        assert.equal(fixture.commands.find(command=>command.op==='history').offset,250);
        assert.equal(fixture.commands.some(command=>command.op==='branch'),false);
    }finally{fixture.close();}
});

test('stale revision or owner, unobserved index, non-user boundary and a changed review cannot create a branch',async()=>{
    for(const bad of ['revision','owner','missing-index','non-user','changed-after-review','changed-selection']){
        const fixture=branchFixture();
        try{
            const boundary={...fixture.boundary};
            if(bad==='revision')boundary.revision=6;if(bad==='owner')boundary.incarnation='different-owner';
            if(bad==='missing-index')fixture.historyIndex=251;if(bad==='non-user')fixture.historyRole='assistant';
            await fixture.controller.open(fixture.connection,{session_id:session,name:'Fixture'},'branch',boundary);
            if(bad==='changed-after-review')fixture.revision=8;
            if(bad==='changed-selection')fixture.dom.window.document.querySelector<HTMLSelectElement>('#sidebar-branch')!.value='';
            fixture.form.dispatchEvent(new fixture.dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
            assert.equal(fixture.commands.some(command=>command.op==='branch'),false,bad);assert.deepEqual(fixture.entries,[]);
        }finally{fixture.close();}
    }
});

test('stock edit dialog escapes text, keeps the existing draft by default and focuses the composer without sending',async()=>{
    const dom=new JSDOM('<div id="root"></div><textarea aria-label="Message"></textarea>',{pretendToBeVisual:true});
    const names=['window','document','IS_REACT_ACT_ENVIRONMENT','getComputedStyle','MutationObserver','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Node','NodeFilter','Element','ShadowRoot','Event','CustomEvent','requestAnimationFrame','cancelAnimationFrame'];
    const saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
    for(const name of names)if(name in dom.window)(globalThis as any)[name]=(dom.window as any)[name];
    Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
    dom.window.HTMLElement.prototype.getClientRects=function(){return [{width:40,height:40}] as any;};
    const {createRoot}=await import('react-dom/client'),{MessageActions}=await import('../resources/react/MessageActions.tsx');
    const root=createRoot(dom.window.document.querySelector('#root')!),{workspace,tab,message,calls}=draftFixture();message.content='<script>untrusted text</script>';
    const button=(label:string)=>[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===label)!;
    try{
        await act(async()=>root.render(React.createElement(MessageActions,{tab,workspace,message,active:true,onPrepared:()=>dom.window.document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!.focus()})));
        await act(async()=>button('Edit as draft').click());
        const dialog=dom.window.document.querySelector('[role="dialog"]')!;assert.ok(dialog);assert.equal(dialog.querySelector('script'),null);assert.equal(tab.draft,'Existing unsent text');
        assert.equal(dom.window.document.querySelector<HTMLSelectElement>('select[aria-label="Prepare edited message"]')!.value,'append');
        await act(async()=>button('Add to draft').click());await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));
        assert.equal(tab.draft,'Existing unsent text\n\n<script>untrusted text</script>');assert.equal(tab.pictures.length,1);assert.equal(dom.window.document.activeElement?.getAttribute('aria-label'),'Message');assert.deepEqual(calls,[]);
    }finally{await act(async()=>root.unmount());for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete(globalThis as any)[name];}dom.window.close();}
});
