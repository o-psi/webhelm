import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

test('workspace search, explicit paths and preferences respect host scope and restore focus without execution',async()=>{
    const dom=new JSDOM('<main id="app"></main>',{url:'https://fixture.invalid'});
    const globals=['window','document','localStorage','IS_REACT_ACT_ENVIRONMENT','getComputedStyle','MutationObserver','HTMLElement','HTMLInputElement','Node','NodeFilter','Element','ShadowRoot','Event','CustomEvent','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'];
    const saved=globals.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,Element:dom.window.Element,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout,ResizeObserver:class{observe(){}unobserve(){}disconnect(){}}});
    const {createRoot}=await import('react-dom/client');
    const {WorkspacePicker}=await import('../resources/react/WorkspacePicker');
    const root=createRoot(document.getElementById('app')!);
    const chosen:string[]=[];
    let props={tenant:'tenant-a',vessel:'host-a',vesselName:'Host A',value:'/work',choices:[{path:'/work',name:'Work'},{path:'/projects/website',name:'Website'}],allowCustom:true,disabled:false};
    function choose(path:string){chosen.push(path);props={...props,value:path};root.render(React.createElement(WorkspacePicker,{...props,onChoose:choose}));}
    const render=async()=>act(async()=>root.render(React.createElement(WorkspacePicker,{...props,onChoose:choose})));
    const button=(name:string)=>{const result=[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>(item.getAttribute('aria-label')||item.textContent||'').trim()===name);assert.ok(result,name);return result;};
    const click=async(name:string)=>act(async()=>button(name).click());
    const type=async(value:string)=>{
        const input=document.querySelector<HTMLInputElement>('[aria-label="Search workspaces"]')!;assert.ok(input);
        await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});return input;
    };
    // Radix restores Popover trigger focus after the close commit. Do not
    // reopen another FocusScope until that observable boundary has completed.
    const closeAndRestore=async(action:()=>void,trigger:HTMLElement)=>{
        let cleanup=()=>{};
        const restored=new Promise<void>((resolve,reject)=>{
            const focused=()=>{cleanup();resolve();};
            const timeout=setTimeout(()=>{cleanup();reject(new Error('Workspace close did not restore focus within 250 ms'));},250);
            cleanup=()=>{clearTimeout(timeout);trigger.removeEventListener('focus',focused);};
            trigger.addEventListener('focus',focused);
        });
        try{await act(async()=>action());await act(async()=>restored);}finally{cleanup();}
        assert.ok(document.activeElement===trigger,'settled Workspace focus returns to exact trigger');
    };
    try{
        await render();const trigger=button('Workspace');await click('Workspace');
        assert.ok(document.activeElement===document.querySelector('[role="combobox"]'),'workspace search owns initial focus');
        assert.equal(document.querySelector('[role="option"][aria-selected="true"]')?.textContent,'Work/work');
        await click('Pin workspace');assert.equal(button('Unpin').getAttribute('aria-pressed'),'true');
        const search=await type('website');assert.equal(document.querySelectorAll('[role="option"]').length,1);
        await closeAndRestore(()=>{search.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));},trigger);
        assert.deepEqual(chosen,['/projects/website']);assert.equal(document.querySelector('[role="listbox"]'),null);
        assert.ok(document.activeElement===trigger,'workspace trigger focus restored');
        await render();await click('Workspace');assert.ok(document.querySelector('[role="group"][aria-label="Recent"]'));
        const path=await type('/other folder');
        await closeAndRestore(()=>{path.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));},trigger);
        assert.equal(chosen.at(-1),'/other folder');
        await render();await click('Workspace');const input=await type('no matching folder');
        assert.equal(document.querySelectorAll('[role="option"]').length,0);
        const count=chosen.length;await act(async()=>input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));assert.equal(chosen.length,count);
        await closeAndRestore(()=>{input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));},trigger);assert.equal(document.querySelector('[role="listbox"]'),null);assert.ok(document.activeElement===trigger,'workspace trigger focus restored');
        props={...props,allowCustom:false,value:'/allowed',choices:[{path:'/allowed',name:'Allowed'}]};await render();await click('Workspace');
        assert.equal(document.querySelectorAll('[role="option"]').length,1);assert.doesNotMatch(document.querySelector('[role="listbox"]')!.textContent!,/other folder|Website|\/work/);
        await type('/forbidden');assert.equal(document.querySelectorAll('[role="option"]').length,0);
        props={...props,vessel:'host-b',vesselName:'Host B',allowCustom:true,value:'/host-b',choices:[]};await render();assert.equal(document.querySelector('[role="listbox"]'),null);
        await click('Workspace');assert.doesNotMatch(document.querySelector('[role="listbox"]')!.textContent!,/other folder|Website|\/work/);
        props={...props,vessel:'host-a',tenant:'tenant-b',value:'/tenant-b'};await render();await click('Workspace');assert.doesNotMatch(document.querySelector('[role="listbox"]')!.textContent!,/other folder|Website|\/work/);
        props={...props,disabled:true};await render();assert.equal(document.querySelector('[role="listbox"]'),null);assert.equal(button('Workspace').disabled,true);
    }finally{
        await act(async()=>root.unmount());await new Promise(resolve=>setTimeout(resolve,10));
        for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
        dom.window.close();
    }
});
