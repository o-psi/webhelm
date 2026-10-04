import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

test('model search, favorites and keyboard selection retain current state and fence stale inventory',async()=>{
    const dom=new JSDOM('<main id="app"></main>',{url:'https://fixture.invalid'});
    const names=['window','document','localStorage','IS_REACT_ACT_ENVIRONMENT','getComputedStyle','MutationObserver','HTMLElement','HTMLInputElement','Node','NodeFilter','Element','ShadowRoot','Event','CustomEvent','requestAnimationFrame','cancelAnimationFrame'];
    const saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,Element:dom.window.Element,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
    dom.window.HTMLElement.prototype.getClientRects=function(){return [{width:40,height:40}] as any;};
    const {createRoot}=await import('react-dom/client');
    const {InferenceControls}=await import('../resources/react/InferenceControls.tsx');
    const root=createRoot(dom.window.document.getElementById('app')!);
    const account={account_id:'a',connection_id:'c',identity_generation:1,connection_revision:1,transport:'openai_responses'};
    const models=[{id:'alpha',display_name:'Alpha',reasoning_efforts:['low']},{id:'beta',display_name:'Beta <script>plain</script>',reasoning_efforts:['high']}];
    const tab:any={key:'v:s',incarnation:'one',snapshot:{workspace:'/fixture',run:{state:'idle'},inference:{account,model:'alpha',reasoning_effort:'low',service_tier:'flex'}},notice:null};
    const actions:any[]=[];
    const workspace:any={actionable:()=>true,permitted:()=>true,changed(){},async act(_key:string,op:string,settings:any){actions.push({op,settings});return true;}};
    const reply=()=>({protocol:1,result:{account,models},outcome_unknown:false,error:null});
    let respond=async()=>reply();let requests=0;
    const connection={client:{async exchange(command:any){assert.equal(command.command.op,'account_models');requests++;return respond();}}};
    const render=async()=>act(async()=>root.render(React.createElement(InferenceControls,{tab,workspace,connection})));
    const button=(name:string)=>[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(node=>(node.getAttribute('aria-label')||node.textContent)===name)!;
    const click=async(name:string)=>{assert.ok(button(name),name);await act(async()=>button(name).click());};
    const choose=(id:string)=>[...dom.window.document.querySelectorAll<HTMLButtonElement>('[data-model-choice]')].find(node=>node.textContent?.includes(id))!;
    const type=async(value:string)=>{const input=dom.window.document.querySelector<HTMLInputElement>('[aria-label="Search models"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});return input;};
    try{
        await render();await click('Choose model');
        assert.equal(dom.window.document.activeElement?.getAttribute('aria-label'),'Search models');
        assert.equal(choose('Alpha').getAttribute('aria-pressed'),'true');
        const dialogClasses=document.querySelector('[role="dialog"]')!.className;
        assert.match(dialogClasses,/h-\[85dvh\]/,'dialog height is independent of result count');
        assert.match(document.querySelector('[aria-label="Available models"]')!.className,/flex-1/,'results own the remaining scroll area');
        assert.ok(dom.window.document.querySelector('script')===null,'model labels do not create a script node');
        const input=await type('beta');
        assert.equal(dom.window.document.querySelectorAll('[data-model-choice]').length,1);
        await act(async()=>input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
        assert.ok(dom.window.document.activeElement===choose('Beta'),'ArrowDown focuses the exact Beta choice');
        await click('Save Beta <script>plain</script> to favorites');
        assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('helm:model-favorites:v1')!),['beta']);
        assert.ok(dom.window.document.querySelector('section[aria-label="Favorites"] [data-model-choice]')===choose('Beta'),'Favorites retains the exact Beta choice');
        await type('no match');assert.match(dom.window.document.body.textContent!,/No models match/);
        assert.equal(document.querySelector('[role="dialog"]')!.className,dialogClasses,'empty search preserves the dialog geometry contract');
        const modelTrigger=button('Choose model');
        // Radix restores focus in its deferred unmount-autofocus callback. Observe
        // the real exact-node focus event after React commits the dialog closure;
        // an arbitrary delay or an immediate activeElement read can race it.
        let cancelFocusObservation!:()=>void;
        const focusRestored=new Promise<void>((resolve,reject)=>{
            const cleanup=()=>{clearTimeout(deadline);dom.window.document.removeEventListener('focusin',observeFocus);};
            const observeFocus=(event:Event)=>{
                if(event.target!==modelTrigger)return;
                cleanup();resolve();
            };
            const deadline=setTimeout(()=>{cleanup();reject(new Error('Escape did not restore focus to the exact model trigger.'));},1000);
            cancelFocusObservation=cleanup;
            dom.window.document.addEventListener('focusin',observeFocus);
        });
        try{
            await act(async()=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
            await act(async()=>focusRestored);
        }finally{cancelFocusObservation();}
        assert.equal(dom.window.document.querySelector('[role="dialog"]'),null,'Escape dismisses the model dialog');
        assert.equal(button('Choose model'),modelTrigger,'Escape retains the original trigger identity');
        assert.ok(dom.window.document.activeElement===modelTrigger,'Escape restores focus to the exact model trigger');assert.equal(actions.length,0);
        await click('Choose model');assert.equal(dom.window.document.querySelector<HTMLInputElement>('input')!.value,'');
        const before=requests;await act(async()=>choose('Alpha').click());assert.equal(requests,before);assert.equal(actions.length,0);
        await click('Choose model');
        respond=async()=>{throw new Error('fixture unavailable');};await click('Refresh');
        assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/fixture unavailable/);
        assert.ok(button('Retry'));assert.equal(actions.length,0);
        respond=async()=>reply();await click('Retry');assert.ok(dom.window.document.querySelector('[role="alert"]')===null,'successful Retry clears the alert node');
        let release!:(value:any)=>void;respond=()=>new Promise(resolve=>{release=resolve;});
        await act(async()=>choose('Beta').click());
        const staleRelease=release;respond=async()=>reply();tab.incarnation='two';await render();await act(async()=>staleRelease(reply()));
        assert.equal(actions.length,0);assert.match(tab.notice,/changed/);
        respond=async()=>reply();await click('Choose model');await act(async()=>choose('Beta').click());
        assert.equal(actions.length,1);assert.deepEqual(actions[0],{op:'set_account_inference',settings:{account,model:'beta',reasoning_effort:null,service_tier:null}});
    }finally{
        await act(async()=>root.unmount());await new Promise(resolve=>setTimeout(resolve,10));
        for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
        dom.window.close();
    }
});
