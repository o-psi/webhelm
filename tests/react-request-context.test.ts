import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import type {Tab} from '../resources/react/workspace.ts';

test('request accounting is read-only, unknown-safe and identity-bound',async()=>{
    const dom=new JSDOM('<main id="app"></main>');
    const names=['window','document','IS_REACT_ACT_ENVIRONMENT','HTMLElement','Event'];
    const saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event});
    const {createRoot}=await import('react-dom/client');
    const {RequestContext}=await import('../resources/react/RequestContext.tsx');
    const root=createRoot(dom.window.document.getElementById('app')!);
    const tab={key:'a',session:'a',incarnation:'one',stale:false,snapshot:{run:{run_id:'r'}}} as Tab;
    const calls:any[]=[];
    const workspace={async read(...args:any[]){calls.push(args);return {section:'context',run_id:'r',value:{scope:'prior request',input_tokens:null,enabled_capacity:null,method:'<script>untrusted</script>'}};}} as any;
    try{
        await act(async()=>root.render(React.createElement(RequestContext,{tab,workspace})));
        assert.equal(calls.length,0);
        await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('button')!.click());
        assert.deepEqual(calls,[['a','controls',{run_id:'r',section:'context'}]]);
        assert.match(dom.window.document.body.textContent!,/Unknown/);
        assert.match(dom.window.document.body.textContent!,/<script>untrusted<\/script>/);
        assert.equal(dom.window.document.querySelector('script'),null);
        tab.incarnation='two';
        await act(async()=>root.render(React.createElement(RequestContext,{tab,workspace})));
        assert.equal(dom.window.document.querySelector('dl'),null);
    }finally{
        await act(async()=>root.unmount());dom.window.close();
        for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
    }
});
