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
        assert.equal(dom.window.document.querySelector('script'),null);
        const input=await type('beta');
        assert.equal(dom.window.document.querySelectorAll('[data-model-choice]').length,1);
        await act(async()=>input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
        assert.equal(dom.window.document.activeElement,choose('Beta'));
        await click('Save Beta <script>plain</script> to favorites');
        assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('helm:model-favorites:v1')!),['beta']);
        assert.equal(dom.window.document.querySelector('section[aria-label="Favorites"] [data-model-choice]'),choose('Beta'));
        await type('no match');assert.match(dom.window.document.body.textContent!,/No models match/);
        await act(async()=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
        assert.equal(dom.window.document.activeElement,button('Choose model'));assert.equal(actions.length,0);
        await click('Choose model');assert.equal(dom.window.document.querySelector<HTMLInputElement>('input')!.value,'');
        const before=requests;await act(async()=>choose('Alpha').click());assert.equal(requests,before);assert.equal(actions.length,0);
        await click('Choose model');
        respond=async()=>{throw new Error('fixture unavailable');};await click('Refresh');
        assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/fixture unavailable/);
        assert.ok(button('Retry'));assert.equal(actions.length,0);
        respond=async()=>reply();await click('Retry');assert.equal(dom.window.document.querySelector('[role="alert"]'),null);
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
