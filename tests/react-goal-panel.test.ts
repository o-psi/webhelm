import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {assertGoalReview,defaultGoalLimits} from '../resources/react/goals.ts';
import type {Tab} from '../resources/react/workspace.ts';

test('Goal dialog requires replacement consent, retains a stale draft, escapes text and restores keyboard focus',async()=>{
    const dom=new JSDOM('<main id="app"></main>');
    const names=['window','document','IS_REACT_ACT_ENVIRONMENT','getComputedStyle','MutationObserver','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Node','NodeFilter','Element','ShadowRoot','Event','CustomEvent','requestAnimationFrame','cancelAnimationFrame'];
    const saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,HTMLTextAreaElement:dom.window.HTMLTextAreaElement,HTMLSelectElement:dom.window.HTMLSelectElement,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,Element:dom.window.Element,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
    dom.window.HTMLElement.prototype.getClientRects=function(){return [{width:40,height:40}] as any;};
    const {createRoot}=await import('react-dom/client');
    const {GoalPanel}=await import('../resources/react/Goal.tsx');
    const root=createRoot(dom.window.document.getElementById('app')!);
    const tab={key:'a',session:'a',incarnation:'one',stale:false,scope:'owner',snapshot:{session_id:'a',revision:3,run:{state:'idle'},goal:{revision:1,goal:{id:'goal-a',session_id:'a',objective:'<img src=x onerror=alert(1)>\u202e',status:'paused',continuation_authorized:false,limits:{...defaultGoalLimits},usage:{runs:1,input_tokens:0,output_tokens:0,elapsed_ms:0,no_progress_runs:0,unmeasured_runs:0},stop_reason:'user_paused',assessment:{run_id:'r',evidence_sha256:'a'.repeat(64),report:{outcome:'blocked',summary:'<script>bad()</script>',evidence:[{call_id:'c',conclusion:'<b>plain evidence</b>'}]}}}}}} as Tab;
    const actions:any[]=[];
    const workspace={permitted:()=>tab.scope==='owner',actionable:()=>!tab.stale,changed(){},async goalUpdate(_key:string,review:any,action:any){assertGoalReview(review,tab.snapshot,tab.incarnation);actions.push(action);return true;}} as any;
    const button=(text:string)=>[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===text)!;
    const click=async(text:string)=>{assert.ok(button(text),text);await act(async()=>button(text).click());};
    const render=async()=>act(async()=>root.render(React.createElement(GoalPanel,{tab,workspace})));
    try{
        await render();await click('Goal · Paused');
        const dialog=dom.window.document.querySelector('[role="dialog"]')!;
        assert.equal(dialog.contains(dom.window.document.activeElement),true);
        assert.ok(dialog.querySelector('img,script,b')===null,'untrusted Goal text must not create HTML elements');
        assert.match(dialog.textContent!,/<script>bad\(\)<\/script>/);assert.doesNotMatch(dialog.textContent!,/\u202e/);
        await click('Replace goal');
        const input=dom.window.document.querySelector('textarea')!;
        await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(input,'New private objective');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
        const checkboxes=[...dom.window.document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
        assert.equal(checkboxes.length,1);assert.ok(checkboxes.every(node=>!node.checked));
        assert.equal(button('Start goal').disabled,true);
        await act(async()=>checkboxes[0].click());assert.equal(button('Start goal').disabled,false);
        tab.snapshot.goal.revision++;
        await click('Start goal');
        assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/changed since review/);
        assert.equal(input.value,'New private objective');assert.equal(actions.length,0);
        await act(async()=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
        assert.ok(dom.window.document.querySelector('[role="dialog"]')===null,'Escape must close the Goal dialog');
        // Radix restores focus after its deferred unmount lifecycle. Bound the
        // observation rather than racing that timer, and never stringify React's
        // cyclic DOM/Fiber tree in a strict-equality assertion failure.
        for(let attempt=0;attempt<20&&dom.window.document.activeElement!==button('Goal · Paused');attempt++){
            await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
        }
        assert.ok(dom.window.document.activeElement===button('Goal · Paused'),'closing the dialog must restore focus to the Goal toggle');
        await click('Goal · Paused');await click('Replace goal');
        const fresh=dom.window.document.querySelector('textarea')!;
        await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype,'value')!.set!.call(fresh,'Fresh objective');fresh.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
        await act(async()=>dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
        await click('Start goal');
        assert.deepEqual(actions,[{action:'set',objective:'Fresh objective',limits:defaultGoalLimits,replace_goal_id:'goal-a',continue_automatically:true}]);
        tab.scope='scoped';await render();await click('Goal · Paused');
        for(const text of ['Resume within these limits','Replace goal','Clear goal','Edit objective or limits'])assert.equal(button(text).disabled,true);
        assert.match(dom.window.document.querySelector('[role="dialog"]')!.textContent!,/owner access/);
    }finally{
        await act(async()=>root.unmount());
        await new Promise(resolve=>setTimeout(resolve,10));
        for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
        dom.window.close();
    }
});
