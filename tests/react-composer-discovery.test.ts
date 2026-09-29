import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {parseDiscovery} from '../resources/react/composer-discovery';

test('discovery accepts bounded advertised metadata and rejects invalid replies',()=>{
    const value=parseDiscovery(
        {section:'tools',execution:'idle',value:{inventory:[{name:'read_file',description:'Read a file'}],source:'builtin_preflight'}},
        {section:'skills',execution:'next_run',value:{skills:[{name:'review',description:'Check changes',path:'/workspace/.agents/skills/review/SKILL.md',scope:'/workspace'},{name:'relative',path:'private/SKILL.md'}],can_read:true,discovery_incomplete:true}},
    );
    assert.deepEqual(value.tools,[{name:'read_file',description:'Read a file'}]);
    assert.deepEqual(value.skills,[{name:'review',description:'Check changes',path:'/workspace/.agents/skills/review/SKILL.md',scope:'/workspace'}]);
    assert.equal(value.toolSource,'builtin_preflight');
    assert.equal(value.skillExecution,'next_run');
    assert.equal(value.incomplete,true);
    assert.throws(()=>parseDiscovery({section:'tools',value:{}},{section:'skills',value:{skills:[]}}),/invalid tool inventory/);
});

test('composer discovery inserts a selected skill without sending and gates old Vessels',async()=>{
    const dom=new JSDOM('<main id="app"></main>',{url:'https://fixture.invalid'});
    const names=['window','document','IS_REACT_ACT_ENVIRONMENT','getComputedStyle','MutationObserver','HTMLElement','HTMLInputElement','Node','NodeFilter','Element','ShadowRoot','Event','CustomEvent','requestAnimationFrame','cancelAnimationFrame'];
    const saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,Element:dom.window.Element,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
    dom.window.HTMLElement.prototype.getClientRects=function(){return [{width:40,height:40}] as any;};
    const {createRoot}=await import('react-dom/client');
    const {ComposerDiscovery}=await import('../resources/react/ComposerDiscovery.tsx');
    const root=createRoot(dom.window.document.getElementById('app')!);
    const tab:any={key:'v:s',draft:'Please review.',incarnation:'one',stale:false,capabilities:['skills_catalog'],scope:'owner',snapshot:{run:{run_id:'run-one'}}};
    const readLog:string[]=[];
    const workspace:any={draft(_key:string,value:string){tab.draft=value;},read(_key:string,_op:string,fields:any){readLog.push(fields.section);if(fields.section==='tools')return Promise.resolve({section:'tools',value:[{name:'read_file'}],execution:'active'});return Promise.resolve({section:'skills',value:{skills:[{name:'review',description:'Review code',path:'/workspace/review/SKILL.md',scope:'/workspace'}],can_read:true,discovery_incomplete:false},execution:'next_run'});}};
    const render=async()=>act(async()=>root.render(React.createElement(ComposerDiscovery,{tab,workspace,onSettings:()=>{},onAttach:()=>{}})));
    try{
        await render();
        await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Discover actions, tools, and skills"]')!.click());
        assert.deepEqual(readLog,['tools','skills']);
        assert.match(dom.window.document.body.textContent!,/next run/);
        await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('section[aria-label="Skills"] button')!.click());
        assert.equal(tab.draft,'Please review.\nUse the "review" filesystem skill at "/workspace/review/SKILL.md" for this task.');
        assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);
        tab.capabilities=[];await render();
        await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Discover actions, tools, and skills"]')!.click());
        assert.match(dom.window.document.body.textContent!,/does not advertise/);
        assert.deepEqual(readLog,['tools','skills']);
        await act(async()=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
        tab.capabilities=['skills_catalog'];
        workspace.read=async()=>{throw new Error('Voyage connection changed.');};
        await render();
        await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Discover actions, tools, and skills"]')!.click());
        assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!,/Voyage connection changed/);
        assert.equal(dom.window.document.querySelector('section[aria-label="Skills"]'),null);
    }finally{
        await act(async()=>root.unmount());await new Promise(resolve=>setTimeout(resolve,10));
        for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
        dom.window.close();
    }
});
