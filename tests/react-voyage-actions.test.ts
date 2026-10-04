import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

test('sidebar context surface is read-only, reports fresh disabled reasons and reviews rename/details',async()=>{
    const dom=new JSDOM('<main id="app"></main>',{url:'https://fixture.invalid'});
    const globals:any={window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,Element:dom.window.Element,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(callback:any)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout};
    const saved=Object.keys(globals).map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
    Object.assign(globalThis,globals);
    const {createRoot}=await import('react-dom/client');
    const {VoyageActions}=await import('../resources/react/VoyageActions.tsx');
    const root=createRoot(dom.window.document.getElementById('app')!);
    const session='11111111-1111-4111-8111-111111111111',incarnation='22222222-2222-4222-8222-222222222222';
    const commands:any[]=[];
    const connection:any={id:'fixture',name:'Fixture Vessel',journal:{entries:()=>[]},client:{async exchange(request:any){
        const command=request.command;commands.push(command);
        let result:any;
        if(command.op==='capabilities')result={scope:'owner'};
        else if(command.op==='inspect'){assert.equal(command.session_id,session);result={session_id:session,incarnation,state:'live'};}
        else if(command.op==='snapshot')result={session_id:session,incarnation,result:{session_id:session,revision:7,name:'Original name',access:'unrestricted',run:{state:'idle'}}};
        else throw Error(`Opening must not mutate: ${command.op}`);
        return {protocol:1,outcome_unknown:false,result};
    }}};
    const settle=async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});};
    const open=async()=>{await act(async()=>{
        const row=dom.window.document.querySelector('#row')!,card=dom.window.document.querySelector<HTMLElement>('#card')!;
        card.focus();row.dispatchEvent(new dom.window.CustomEvent('voyage-context-menu',{detail:card}));
    });await settle();};
    const choose=async(label:string)=>{const item=Array.from(dom.window.document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node=>node.textContent===label)!;assert.ok(item);await act(async()=>item.click());await settle();};
    const dismiss=async()=>{await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('#sidebar-dismiss')!.click());await settle();};
    try{
        await act(async()=>root.render(React.createElement('div',{id:'row'},React.createElement('button',{id:'card'},'Original name'),React.createElement(VoyageActions,{connection,voyage:{session_id:session,name:'Original name'},onChanged:()=>{throw Error('No mutation expected');}}))));
        await open();
        const stop=Array.from(dom.window.document.querySelectorAll('[role="menuitem"]')).find(node=>node.textContent?.startsWith('Stop run'))!;
        assert.equal(stop.getAttribute('aria-disabled'),'true');assert.match(stop.textContent!,/There is no active run/);
        assert.ok(commands.length>=3);assert.ok(commands.every(command=>['capabilities','inspect','snapshot'].includes(command.op)));
        await choose('Rename');
        const input=dom.window.document.querySelector<HTMLInputElement>('#sidebar-name')!;
        assert.equal(dom.window.document.activeElement,input);assert.equal(input.value,'Original name');assert.equal(input.selectionEnd,input.value.length);
        await dismiss();assert.equal(dom.window.document.activeElement?.id,'card');
        await open();await choose('Details');
        assert.equal(dom.window.document.querySelector('#sidebar-details-access')!.textContent,'Full access');
        const technical=dom.window.document.querySelector<HTMLElement>('[data-slot="collapsible-content"]')!;
        assert.equal(technical.hidden,true);
        await act(async()=>Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find(node=>node.textContent==='Technical details')!.click());
        assert.equal(technical.hidden,false);assert.match(technical.textContent!,new RegExp(session));
        await dismiss();await open();await choose('Details');
        assert.equal(dom.window.document.querySelector<HTMLElement>('[data-slot="collapsible-content"]')!.hidden,true);
        assert.ok(commands.every(command=>['capabilities','inspect','snapshot'].includes(command.op)));
    }finally{
        await act(async()=>root.unmount());dom.window.close();
        for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
    }
});
