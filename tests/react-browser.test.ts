import test from 'node:test';
import assert from 'node:assert/strict';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {HostBrowser, browserActivity} from '../resources/react/HostBrowser.tsx';
import type {Tab} from '../resources/react/workspace.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
test('selected React browser uses shared controls, live revision fences and detach-only cleanup', async () => {
    const dom = new JSDOM('<div id="app"></div>', {url:'https://console.test'});
    const names = ['window','document','IS_REACT_ACT_ENVIRONMENT','requestAnimationFrame','cancelAnimationFrame'] as const;
    const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis,name));
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
    const root = createRoot(dom.window.document.getElementById('app')!);
    const sent: any[] = [];
    const running = new Map<string,boolean>();
    const socket = (name: string) => ({exchange:async (payload: any) => {
        const command = payload.command;
        sent.push({name,...command});
        const operation = command.operation;
        if(operation.action==='start')running.set(command.session_id,true);
        const binding = {incarnation:command.incarnation,browser_id:'browser',attachment_id:'attachment',tab_id:'tab',document_epoch:1,viewport_epoch:1,controller_epoch:1,capture_epoch:1};
        const status = {available:true,running:running.get(command.session_id)===true,binding:running.get(command.session_id)?binding:null,mode:'human',controller:'attachment',tabs:['tab']};
        return {protocol:1,outcome_unknown:false,result:{session_id:command.session_id,incarnation:command.incarnation,result:{status,value:null}}};
    }});
    let tab = {key:'one',vessel:'vessel-one',session:'session-one',title:'Selected task',incarnation:'owner-one',stale:false,snapshot:{revision:7}} as Tab;
    let client: any = socket('first');
    const render = () => act(async () => {root.render(React.createElement(HostBrowser,{key:tab.key,tab,client,workspace:{} as any})); await tick();});
    const click = async (label: string) => act(async () => {
        const button = label==='Browser'?dom.window.document.querySelector<HTMLButtonElement>('.task-browser-action'):[...dom.window.document.querySelectorAll('button')].find(node=>node.textContent===label);
        assert.ok(button, label); button.click(); await tick();
    });
    try {
        await render(); assert.equal(sent.length,0);
        await click('Browser');
        assert.equal(dom.window.document.querySelector('.task-browser-action')?.getAttribute('aria-expanded'),'true');
        assert.ok(dom.window.document.querySelector('.browser-next-mirror'));
        assert.equal(dom.window.document.querySelector('video'),null);
        assert.ok(sent.some(item=>item.operation.action==='start'), 'one click opens and connects the viewer');
        assert.equal(sent.find(item=>item.operation.action==='start').operation.expected_revision,7);
        tab = {...tab,snapshot:{revision:9}}; await render();
        assert.equal(dom.window.document.querySelectorAll('.browser-next-mirror').length,1, 'snapshot refresh does not remount the viewer');
        assert.ok(sent.every(item=>item.name==='first' && item.session_id==='session-one' && item.incarnation==='owner-one'));
        client = socket('replacement'); await render();
        assert.ok(sent.some(item=>item.name==='first' && item.operation.action==='detach'));
        tab = {...tab,stale:true}; client = null; await render();
        assert.match(dom.window.document.body.textContent!,/Vessel disconnected/);
        assert.equal(sent.at(-1).name,'replacement'); assert.equal(sent.at(-1).operation.action,'detach');
        client = socket('second'); tab = {...tab,key:'two',vessel:'vessel-two',session:'session-two',incarnation:'owner-two',stale:false}; await render();
        assert.equal(dom.window.document.querySelector('.browser-next-mirror'),null,'switching tasks requires explicit reopening');
        await click('Browser');
        assert.equal(sent.at(-1).session_id,'session-two'); assert.equal(sent.at(-1).incarnation,'owner-two');
        await click('Browser'); assert.equal(sent.at(-1).operation.action,'detach');
        await click('Browser');
        await act(async()=>{dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await tick();});
        // React commits the closed panel before its restoration animation frame.
        const focusDeadline=Date.now()+1000;
        while(dom.window.document.activeElement!==dom.window.document.querySelector('.task-browser-action')&&Date.now()<focusDeadline) {
            await act(async()=>{await tick();});
        }
        assert.equal(dom.window.document.activeElement===dom.window.document.querySelector('.task-browser-action'),true,'Escape restores the discoverable action');
        await click('Browser'); await click('Close panel');
        assert.equal(dom.window.document.querySelector('.browser-next-mirror'),null);
        await click('Browser');
        await act(async()=>root.unmount()); await tick();
        assert.equal(sent.at(-1).operation.action,'detach');
        assert.ok(!sent.some(item=>item.operation.action==='close'));
        assert.equal(dom.window.localStorage.length,0);
    } finally {
        await act(async()=>root.unmount());
        names.forEach((name,index)=>{const descriptor=saved[index];if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];});
        dom.window.close();
    }
});


test('browser activity uses current voyage tool metadata, not assistant prose', () => {
    assert.equal(browserActivity({messages:[{role:'assistant',content:'Try host_browser'}]}),false);
    assert.equal(browserActivity({messages:[{role:'assistant',tool_calls:[{id:'call',function:{name:'host_browser'}}]}]}),true);
    assert.equal(browserActivity({messages:[{role:'tool',name:'functions.host_browser',content:'result'}]}),true);
    assert.equal(browserActivity({messages:[],run:{tool_previews:[{name:'host_browser'}]}}),true);
    assert.equal(browserActivity({messages:[{role:'tool',name:'shell'}]}),false);
    assert.equal(browserActivity(null),false);
});

test('stopped browser stays stopped across socket and owner remounts until an explicit Start or opening', async () => {
    const dom = new JSDOM('<div id="app"></div>', {url:'https://console.test'});
    const names = ['window','document','IS_REACT_ACT_ENVIRONMENT','requestAnimationFrame','cancelAnimationFrame'] as const;
    const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis,name));
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
    const root = createRoot(dom.window.document.getElementById('app')!);
    const sent: any[]=[];
    const attachments=new Map<string,string>();
    const nil='00000000-0000-0000-0000-000000000000';
    let running=false,browser=0,mode='agent',controller:string|null=null;
    const socket=(name:string)=>({exchange:async(payload:any)=>{
        const command=payload.command,operation=command.operation;
        assert.equal(command.op,'host_browser');
        sent.push({name,...command});
        if(operation.action==='start'){assert.equal(running,false);running=true;browser++;mode='agent';controller=null;}
        if(operation.action==='attach')attachments.set(name,operation.binding.attachment_id);
        if(operation.action==='detach')attachments.delete(name);
        if(operation.action==='control'){mode=operation.mode;controller=operation.binding.attachment_id;}
        if(operation.action==='close'){assert.equal(mode,'human');assert.equal(controller,attachments.get(name));running=false;mode='agent';controller=null;attachments.clear();}
        const binding=running?{incarnation:command.incarnation,browser_id:`browser-${browser}`,attachment_id:attachments.get(name)||nil,tab_id:'tab',document_epoch:1,viewport_epoch:1,controller_epoch:1,capture_epoch:1}:null;
        const status={available:true,running,binding,mode,controller,tabs:running?['tab']:[]};
        return {protocol:1,outcome_unknown:false,result:{session_id:command.session_id,incarnation:command.incarnation,result:{status,value:null}}};
    }});
    let tab={key:'one',vessel:'vessel-one',session:'session-one',title:'Owned browser task',incarnation:'owner-one',stale:false,snapshot:{revision:7}} as Tab;
    let client:any=socket('initial');
    const render=()=>act(async()=>{root.render(React.createElement(HostBrowser,{tab,client,workspace:{} as any}));await tick();});
    const click=(label:string)=>act(async()=>{
        const button=label==='Browser'?dom.window.document.querySelector<HTMLButtonElement>('.task-browser-action'):[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent===label);
        assert.ok(button,label);assert.equal(button.disabled,false,label);button.click();await tick();
    });
    const starts=()=>sent.filter(command=>command.operation.action==='start');
    const stopped=()=>{assert.equal(running,false);assert.equal(dom.window.document.querySelector('.browser-next-status')?.textContent,'Browser stopped');};
    try {
        await render();assert.equal(sent.length,0);
        await click('Browser');assert.equal(starts().length,1);assert.equal(browser,1);
        await click('Use browser');await click('Close browser');stopped();
        const afterClose=sent.length;
        client=socket('renewed');await render();stopped();
        assert.equal(starts().length,1);
        assert.deepEqual(sent.slice(afterClose).map(command=>command.operation.action),['status']);
        tab={...tab,incarnation:'owner-two',snapshot:{revision:11}};await render();stopped();
        assert.equal(starts().length,1,'owner replacement is observation, not another Start');
        client=null;await render();
        client=socket('reconnected');await render();stopped();
        assert.equal(starts().length,1,'transport recovery cannot revive a stopped browser');
        await click('Start browser');assert.equal(starts().length,2);assert.equal(browser,2);
        assert.equal(starts()[1].incarnation,'owner-two');assert.equal(starts()[1].operation.expected_revision,11);
        assert.notEqual(starts()[0].operation.command_id,starts()[1].operation.command_id);
        await click('Close panel');assert.equal(running,true,'closing the panel only detaches');
        const whileClosed=sent.length;
        client=socket('closed-panel-renewal');await render();assert.equal(sent.length,whileClosed);
        await click('Browser');assert.equal(starts().length,2,'explicit opening reattaches an existing browser');
        await click('Use browser');await click('Close browser');stopped();
        await click('Close panel');await click('Browser');
        assert.equal(starts().length,3,'fresh explicit opening may create one browser');assert.equal(browser,3);
        assert.equal(sent.filter(command=>command.operation.action==='close').length,2);
        assert.equal(dom.window.localStorage.length,0);
    } finally {
        await act(async()=>root.unmount());await tick();
        names.forEach((name,index)=>{const descriptor=saved[index];if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];});
        dom.window.close();
    }
});
