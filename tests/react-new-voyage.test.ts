import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {NewVoyage} from '../resources/react/NewVoyage';
import {completeNewVoyage} from '../resources/react/new-voyage-delivery';

const binding={account_id:'account',connection_id:'provider',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'};

async function mount({uncertain=false,recovery=null}:{uncertain?:boolean;recovery?:any}={}){
    const dom=new JSDOM('<div id="root"></div>',{url:'https://helm.test'});
    const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,HTMLTextAreaElement:dom.window.HTMLTextAreaElement,HTMLSelectElement:dom.window.HTMLSelectElement,Event:dom.window.Event});
    const {createRoot}=await import('react-dom/client');
    const commands:any[]=[],created:any[]=[],advanced:any[]=[];
    const connection:any={id:'c',name:'Fixture Vessel',vessel_id:'v',voyages:[],client:{async exchange({command}:any){
        commands.push(command);
        let result:any;
        switch(command.op){
            case 'capabilities':result={vessel_id:'v',scope:'owner',features:['execution_profiles'],workspaces:[{path:'/work',name:'Work'}]};break;
            case 'profiles':result={revision:3,default_profile_id:'everyday',profiles:[{id:'everyday',name:'Everyday',account:binding,model:'m',reasoning_effort:'high',service_tier:null}]};break;
            case 'accounts':result={accounts:[{id:'account',connection_id:'provider',identity_generation:1,label:'Account',state:'ready',availability:'available'}],connections:[{id:'provider',revision:1,label:'Provider',transports:['chatgpt_oauth']}]};break;
            case 'account_models':result={account:binding,models:[{id:'m',display_name:'Everyday model',reasoning_efforts:['low','high']},{id:'other',display_name:'Other model',reasoning_efforts:['low']}]};break;
            case 'start_account':if(uncertain)return {protocol:1,outcome_unknown:true,result:null};result={session_id:command.session_id,workspace:'/work',incarnation:'i',name:'New voyage'};break;
            case 'resolve_start_account':result={command_id:command.command_id,session_id:command.session_id,status:'created',process:{session_id:command.session_id,workspace:'/work',incarnation:'i',name:'New voyage'}};break;
            default:throw new Error(command.op);
        }
        return {protocol:1,outcome_unknown:false,error:null,result};
    }}};
    const second={...connection,id:'second',name:'Second Vessel',vessel_id:'v2',client:{async exchange(request:any){const reply=await connection.client.exchange(request);if(request.command.op==='capabilities')reply.result.vessel_id='v2';return reply;}}};
    const root=createRoot(document.getElementById('root')!);
    await act(async()=>root.render(React.createElement(NewVoyage,{fleet:{connections:new Map([['c',connection],['second',second]])},tenant:'t',hidden:false,resetToken:0,reloadToken:0,recovery,onCreated:(vessel:string,process:any,message:any)=>{created.push({vessel,process,message});},onAdvanced:(location:any)=>advanced.push(location)})));
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,230));});
    const button=(label:string)=>{const found=[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>(item.getAttribute('aria-label')||item.textContent||'').trim()===label);assert.ok(found,label);return found;};
    const dispose=async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close();};
    return {dom,commands,created,advanced,button,dispose};
}

test('uncertain message transfer starts as a reviewable draft and sends nothing',async()=>{
    const view=await mount({recovery:{vessel:'c',workspace:'/work',text:'Check the old result first',hasPictures:true,source:'Original voyage'}});
    try{
        assert.equal(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')?.value,'Check the old result first');
        assert.match(document.querySelector('.new-voyage-recovery')!.textContent!,/earlier action may have happened/);
        assert.match(document.querySelector('.new-voyage-recovery')!.textContent!,/Reattach any pictures/);
        assert.equal(view.commands.some(command=>command.op==='start_account'||command.op==='submit'),false);
    }finally{await view.dispose();}
});

test('new voyage sends the retained prompt only after an exact creation receipt',async()=>{
    const view=await mount();
    try{
        assert.equal(view.button('Send').disabled,true);
        await act(async()=>{const input=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;Object.getOwnPropertyDescriptor(view.dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Build a dashboard');input.dispatchEvent(new view.dom.window.Event('input',{bubbles:true}));});
        assert.equal(view.button('Send').disabled,false);
        await act(async()=>view.button('Send').click());
        assert.equal(view.commands.filter(command=>command.op==='start_account').length,1);
        assert.equal(view.created.length,1);
        assert.equal(view.created[0].message.text,'Build a dashboard');
        assert.deepEqual({access:view.created[0].message.access,send:view.created[0].message.send,applyAccess:view.created[0].message.applyAccess},{access:'approval',send:true,applyAccess:true});
        assert.equal(view.commands.some(command=>command.op==='submit'||command.op==='set_access'),false,'the composer leaves later effects to the workspace');
    }finally{await view.dispose();}
});

test('uncertain creation is never replayed and recovery transfers an unsent draft',async()=>{
    const view=await mount({uncertain:true});
    try{
        await act(async()=>{const input=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;Object.getOwnPropertyDescriptor(view.dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Keep this draft');input.dispatchEvent(new view.dom.window.Event('input',{bubbles:true}));});
        await act(async()=>view.button('Send').click());
        assert.equal(view.created.length,0);
        assert.equal(view.button('Send').disabled,true);
        assert.equal(view.commands.filter(command=>command.op==='start_account').length,1);
        await act(async()=>view.button('Check creation · Fixture Vessel').click());
        assert.equal(view.commands.filter(command=>command.op==='start_account').length,1);
        assert.equal(view.commands.filter(command=>command.op==='resolve_start_account').length,1);
        assert.equal(view.created[0].message.text,'Keep this draft');
        assert.equal(view.created[0].message.send,false);
        assert.equal(view.created[0].message.applyAccess,false);
    }finally{await view.dispose();}
});

test('direct model and reasoning choices create one voyage without editing the saved profile',async()=>{
    const view=await mount();
    try{
        const selects=[...document.querySelectorAll<HTMLSelectElement>('select')];
        const model=selects.find(select=>select.closest('label')?.textContent?.startsWith('Model'))!;
        const reasoning=selects.find(select=>select.closest('label')?.textContent?.startsWith('Reasoning'))!;
        assert.equal(model.disabled,false);
        await act(async()=>{model.value='other';model.dispatchEvent(new view.dom.window.Event('change',{bubbles:true}));});
        await act(async()=>{reasoning.value='low';reasoning.dispatchEvent(new view.dom.window.Event('change',{bubbles:true}));});
        await act(async()=>view.button('Create without message').click());
        const start=view.commands.find(command=>command.op==='start_account');
        assert.equal(start.model,'other');assert.equal(start.reasoning_effort,'low');assert.equal(start.service_tier,null);
        assert.equal(view.commands.some(command=>command.op==='save_profile'),false);
        assert.equal(view.created[0].message.send,false);
    }finally{await view.dispose();}
});

test('first message waits for confirmed access and remains a draft when access is uncertain',async()=>{
    const calls:string[]=[];
    const tab:any={snapshot:{access:'read-only'},notice:''};
    const workspace:any={restoreDraft:async()=>{},tabs:new Map([['k',tab]]),draft(_key:string,value:string){calls.push('draft');tab.draft=value;},async refresh(){calls.push('refresh');},actionable(){return true;},permitted(){return true;},async act(_key:string,op:string){calls.push(op);if(op==='set_access')tab.snapshot.access='approval';return true;},changed(){calls.push('changed');}};
    const message:any={text:'Build a dashboard',pictures:[],access:'approval',send:true,applyAccess:true};
    await completeNewVoyage(workspace,'k',message);
    assert.deepEqual(calls,['draft','refresh','set_access','refresh','submit']);
    calls.length=0;tab.snapshot.access='read-only';workspace.act=async(_key:string,op:string)=>{calls.push(op);return false;};
    await completeNewVoyage(workspace,'k',message);
    assert.equal(calls.includes('submit'),false);
    assert.match(tab.notice,/access mode is not confirmed/);
    assert.equal(tab.draft,'Build a dashboard');
});


test('profile management receives the selected Vessel and workspace, not the first connection',async()=>{
 const view=await mount({recovery:{vessel:'second',workspace:'/chosen',text:'',hasPictures:false,source:'draft'}});
 try{
  assert.equal(view.button('Manage profiles').disabled,false);
  await act(async()=>view.button('Manage profiles').click());
  assert.deepEqual(view.advanced,[{vessel:'second',workspace:'/chosen'}]);
  assert.equal(view.commands.some(c=>c.op==='start_account'||c.op==='submit'),false);
 }finally{await view.dispose();}
});
