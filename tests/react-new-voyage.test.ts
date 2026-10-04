import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

import {completeNewVoyage} from '../resources/react/new-voyage-delivery';

const binding={account_id:'account',connection_id:'provider',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'};

async function mount({uncertain=false,recovery=null,scoped=false,revokeWorkspace=false,accountChanged=false,unknownModels=false,reorderedProfile=false}:{reorderedProfile?:boolean;unknownModels?:boolean;accountChanged?:boolean;uncertain?:boolean;recovery?:any;scoped?:boolean;revokeWorkspace?:boolean}={}){
    const dom=new JSDOM('<div id="root"></div>',{url:'https://helm.test',pretendToBeVisual:true});
    // Radix focus traversal and Floating UI must see constructors from this window.
    const globals:Record<string,unknown>={window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,
        getComputedStyle:dom.window.getComputedStyle.bind(dom.window),requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)};
    for(const name of ['Node','NodeFilter','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','Event','KeyboardEvent','MouseEvent','CustomEvent','MutationObserver']){
        globals[name]=(dom.window as any)[name];
    }
    const previous=new Map(Object.keys(globals).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
    for(const [name,value] of Object.entries(globals))Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
    const {createRoot}=await import('react-dom/client');
    const {NewVoyage}=await import('../resources/react/NewVoyage');
    const commands:any[]=[],created:any[]=[],advanced:any[]=[];
    let capabilityReads=0,accountReads=0;let failModels=unknownModels;
    const connection:any={id:'c',name:'Fixture Vessel',vessel_id:'v',voyages:[],client:{async exchange({command}:any){
        commands.push(command);
        let result:any;
        switch(command.op){
            case 'capabilities':result={vessel_id:'v',scope:scoped?'scoped':'owner',rights:['create','account_use','execute'],features:['execution_profiles'],workspaces:revokeWorkspace&&++capabilityReads>1?[]:[{path:'/work',name:'Work'}]};break;
            case 'profiles':result={revision:3,default_profile_id:'everyday',profiles:[{id:'everyday',name:'Everyday',account:reorderedProfile?{transport:binding.transport,connection_revision:binding.connection_revision,identity_generation:binding.identity_generation,connection_id:binding.connection_id,account_id:binding.account_id}:binding,model:'m',reasoning_effort:'high',service_tier:null}]};break;
            case 'accounts':accountReads++;result={accounts:[{id:'account',connection_id:'provider',identity_generation:accountChanged&&accountReads>1?2:1,label:'Account',state:'ready',availability:'available'}],connections:[{id:'provider',revision:1,label:'Provider',transports:['chatgpt_oauth']}]};break;
            case 'account_models':if(failModels)throw Error('Catalogue unavailable');result={account:binding,models:[{id:'m',display_name:'Everyday model',reasoning_efforts:['low','high']},{id:'other',display_name:'Other model',reasoning_efforts:['low'],service_tiers:['flex']}]};break;
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
    const dispose=async()=>{
        await act(async()=>root.unmount());
        // Let portal focus restoration and animation-frame cleanup settle while its
        // owning window is still installed; never leak constructors to the next test.
        await act(async()=>{await new Promise<void>(resolve=>dom.window.requestAnimationFrame(()=>dom.window.requestAnimationFrame(()=>resolve())));});
        dom.window.close();
        for(const [name,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}
    };
    const choose=async(name:string,value:string)=>{
        const trigger=[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.getAttribute('aria-label')?.startsWith(name+':'))!;
        assert.ok(trigger,name);
        await act(async()=>trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
        await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
        const option=[...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item=>item.textContent?.trim()===value)!;
        assert.ok(option,value);await act(async()=>option.click());
    };
    const chooseModel=async()=>{
        const trigger=[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.getAttribute('aria-label')?.startsWith('Model:'))!;
        await act(async()=>trigger.click());
        const option=[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.includes('Other model')&&!item.getAttribute('aria-label')?.includes('favorites'))!;
        assert.ok(option);await act(async()=>option.click());
    };
    return {dom,commands,created,advanced,button,dispose,choose,chooseModel,allowModels:()=>{failModels=false;}};
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
        await view.chooseModel();
        await view.choose('Reasoning','low');
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

test('scoped workspace recovery uses an authorized choice and rechecks revocation before creation',async()=>{
 const view=await mount({scoped:true,revokeWorkspace:true,recovery:{vessel:'c',workspace:'/forbidden',text:'Keep my draft',hasPictures:false,source:'draft'}});
 try{
  assert.equal(view.button('Workspace').textContent,'/work');
  await act(async()=>view.button('Manage profiles').click());assert.equal(view.advanced[0].workspace,'/work');
  assert.equal(view.button('Create without message').disabled,false);
  await act(async()=>view.button('Create without message').click());
  assert.match(document.body.textContent!,/workspace is no longer permitted/);
  assert.equal(view.commands.some(command=>command.op==='start_account'),false);
  assert.equal(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!.value,'Keep my draft');
 }finally{await view.dispose();}
});

test('composer account review retains the reviewed model on reopen without saving a profile',async()=>{
    const view=await mount();
    try{
        await act(async()=>view.button('Review account').click());
        await view.choose('Model','Other model');
        await act(async()=>view.button('Use account and model').click());
        await act(async()=>view.button('Review account').click());
        assert.ok([...document.querySelectorAll('button')].some(item=>item.getAttribute('aria-label')==='Model: Other model'));
        await act(async()=>view.button('Cancel account review').click());
        await act(async()=>view.button('Create without message').click());
        const start=view.commands.find(command=>command.op==='start_account');
        assert.deepEqual(start.account,binding);assert.equal(start.model,'other');assert.equal(start.reasoning_effort,null);
        assert.equal(view.commands.some(command=>command.op==='save_profile'),false);
    }finally{await view.dispose();}
});

test('reviewed account generation change prevents creation',async()=>{
    const view=await mount({accountChanged:true});
    try{
        await act(async()=>view.button('Review account').click());
        await act(async()=>view.button('Use account and model').click());
        await act(async()=>view.button('Create without message').click());
        assert.equal(view.commands.some(command=>command.op==='start_account'),false);
        assert.match(document.body.textContent||'',/selected account is unavailable/);
    }finally{await view.dispose();}
});

 test('draft service tier is catalogue backed, edits send nothing and first creation carries it',async()=>{
    const view=await mount();
    try{
        await view.chooseModel();
        await view.choose('Service tier','flex');
        assert.equal(view.commands.some(command=>['start_account','submit','set_account_inference'].includes(command.op)),false);
        await act(async()=>view.button('Create without message').click());
        assert.equal(view.commands.find(command=>command.op==='start_account')?.service_tier,'flex');
        assert.equal(view.commands.some(command=>command.op==='save_profile'),false);
    }finally{await view.dispose();}
});

test('all five draft controls share presentation and unavailable catalogue never fabricates options or effects',async()=>{
    const view=await mount({unknownModels:true});
    try{
        for(const name of ['Account','Model','Service tier','Reasoning','Access']){
            assert.ok([...document.querySelectorAll('button')].some(item=>item.getAttribute('aria-label')?.startsWith(name+':')),name);
        }
        for(const name of ['Service tier','Reasoning']){
            const trigger=[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.getAttribute('aria-label')?.startsWith(name+':'))!;
            assert.equal(trigger.disabled,true);
        }
        await view.choose('Access','Read only');
        assert.equal(view.commands.some(command=>['start_account','submit','set_access','set_account_inference','save_profile'].includes(command.op)),false);
        assert.equal(view.button('Create without message').disabled,false,'unchanged saved profile is usable without a fabricated catalogue override');
    }finally{await view.dispose();}
});

test('failed draft catalogue is inspectable and retry is read-only before successful choices',async()=>{
    const view=await mount({unknownModels:true,scoped:true,revokeWorkspace:true});
    try{
        assert.match(document.body.textContent||'',/Catalogue unavailable/);
        const trigger=[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.getAttribute('aria-label')?.startsWith('Model:'))!;
        assert.equal(trigger.disabled,false);
        await act(async()=>trigger.click());
        assert.match(document.querySelector('[role="dialog"]')?.textContent||'',/Catalogue unavailable/);
        assert.equal(document.querySelectorAll('[data-model-choice]').length,0);
        assert.equal(view.button('Retry').disabled,false,'read-only picker recovery remains enabled on error');
        assert.equal(view.button('Refresh').disabled,false);
        view.allowModels();
        await act(async()=>view.button('Retry').click());
        assert.equal(view.commands.filter(command=>command.op==='account_models').length,2);
        assert.equal(view.commands.some(command=>['start_account','submit','save_profile','set_account_inference'].includes(command.op)),false);
        const recovered=document.querySelector<HTMLButtonElement>('[data-model-choice]');
        assert.ok(recovered);assert.equal(recovered.disabled,false);
        const other=[...document.querySelectorAll<HTMLButtonElement>('[data-model-choice]')].find(item=>item.textContent?.includes('Other model'))!;
        await act(async()=>other.click());
        await act(async()=>view.button('Create without message').click());
        assert.equal(view.commands.some(command=>command.op==='start_account'),false,'revoked workspace still blocks creation after catalogue recovery');
        assert.match(document.body.textContent||'',/workspace is no longer permitted/);
    }finally{await view.dispose();}
});

test('account review resolves reordered exact binding to the observed label and selected radio without effects',async()=>{
    const view=await mount({reorderedProfile:true});
    try{
        await act(async()=>view.button('Review account').click());
        const section=document.querySelector<HTMLElement>('[aria-label="Review composer account"]')!;
        const expectedLabel='Account · Provider · chatgpt oauth';
        const trigger=section.querySelector<HTMLButtonElement>(`button[aria-label="Account: ${expectedLabel}"]`)!;
        assert.ok(trigger,'normalized catalogue binding order must not leak raw JSON');
        assert.equal(section.querySelector<HTMLButtonElement>('button[aria-label="Model: Everyday model"]')?.disabled,false);
        await act(async()=>trigger.dispatchEvent(new view.dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
        await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
        const selected=document.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
        assert.equal(selected?.textContent?.trim(),expectedLabel);
        assert.doesNotMatch(trigger.textContent||'',/account_id|identity_generation|connection_revision/);
        assert.equal(view.commands.some(command=>['start_account','submit','save_profile','set_account_inference'].includes(command.op)),false);
    }finally{await view.dispose();}
});

test('account presentation never matches stale generations, revisions or transport',async()=>{
    const {reviewedAccountOption}=await import('../resources/react/ComposerAccountReview');
    const reordered={transport:binding.transport,connection_revision:binding.connection_revision,identity_generation:binding.identity_generation,connection_id:binding.connection_id,account_id:binding.account_id};
    const accounts=[{binding:reordered,label:'Observed account',ready:true}];
    assert.equal(reviewedAccountOption(accounts,binding).selected,accounts[0]);
    assert.equal(reviewedAccountOption(accounts,binding).value,JSON.stringify(reordered));
    for(const changed of [{identity_generation:2},{connection_revision:2},{transport:'openai_responses'}]){
        const option=reviewedAccountOption(accounts,{...binding,...changed});
        assert.equal(option.selected,undefined);assert.equal(option.value,'');
    }
});
