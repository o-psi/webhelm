import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

// Exercise the production Composer and real freshness/rights/journal gates;
// only dispatch is replaced so these regressions cannot contact a provider.
test('actual composer preserves keyboard, run transitions and command safety gates', async()=>{
    const dom=new JSDOM('<div id="mount"></div>',{url:'https://helm.test'});
    const keys=['window','document','navigator','HTMLElement','HTMLInputElement','HTMLTextAreaElement','localStorage','IS_REACT_ACT_ENVIRONMENT'] as const;
    const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='localStorage'?dom.window.localStorage:(dom.window as any)[key]});
    const {createRoot}=await import('react-dom/client');
    const {Composer}=await import('../resources/react/App.tsx');
    const {Workspace}=await import('../resources/react/workspace.ts');
    const root=createRoot(dom.window.document.querySelector('#mount')!);
    let pending:any[]=[];
    const workspace=new Workspace(()=>new Map([['v',{client:{},journal:{entries:()=>pending}} as any]]));
    const tab:any={key:'v:s',vessel:'v',session:'s',incarnation:'i',scope:'owner',rights:[],capabilities:[],snapshot:{revision:7,access:'approval',run:{state:'idle'}},freshAt:Date.now(),stale:false,busy:false,draft:'A message',pictures:[],draftLoading:false};
    const effects:Array<[string,string]>=[];
    workspace.act=async(key,op)=>{effects.push([key,op]);};
    const render=async()=>{await React.act(async()=>root.render(React.createElement(Composer,{tab,workspace,onSettings:()=>{}})));};
    const button=(label:string)=>dom.window.document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    const keyboard=async(init:KeyboardEventInit={})=>{
        const event=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...init});
        await React.act(async()=>{dom.window.document.querySelector('textarea')!.dispatchEvent(event);});
        return event;
    };
    try{
        workspace.refresh=async()=>{};workspace.tabs.set(tab.key,tab);
        await render();
        assert.equal(button('Stop run'),null);
        assert.equal(button('Send')!.disabled,false);
        const shifted=await keyboard({shiftKey:true});
        assert.equal(shifted.defaultPrevented,false,'Shift+Enter retains native newline behavior');
        const composing=await keyboard({isComposing:true});
        assert.equal(composing.defaultPrevented,false,'IME confirmation is not intercepted');
        assert.deepEqual(effects,[]);
        assert.equal((await keyboard()).defaultPrevented,true);
        assert.deepEqual(effects,[['v:s','submit']]);
        await React.act(async()=>button('Send')!.click());
        assert.deepEqual(effects.at(-1),['v:s','submit']);
        for(const state of ['accepted','starting','running','awaiting_decision']){
            tab.snapshot.run.state=state;await render();
            assert.equal(button('Send'),null);
            assert.equal(button('Send to current run')!.disabled,false);
            assert.equal(button('Stop run')!.disabled,false);
            await keyboard();assert.deepEqual(effects.at(-1),['v:s','steer']);
        }
        await React.act(async()=>button('Stop run')!.click());
        assert.deepEqual(effects.at(-1),['v:s','cancel']);
        for(const state of ['cancel_requested','cancelling']){
            tab.snapshot.run.state=state;await render();
            assert.equal(button('Stop run')!.disabled,true);
            assert.equal(button('Send to current run')!.disabled,true);
            const count=effects.length;await keyboard();assert.equal(effects.length,count);
        }
        tab.snapshot.run.state='idle';await render();assert.equal(button('Stop run'),null);
        // The textarea stays editable while send/stop are gated by a fresh snapshot.
        for(const patch of [{stale:true},{busy:true},{freshAt:Date.now()-36000},{scope:'participant',rights:[]}]){
            Object.assign(tab,{stale:false,busy:false,freshAt:Date.now(),draftLoading:false,scope:'owner',rights:[]},patch);
            tab.snapshot.run.state='running';await render();
            assert.equal(button('Send to current run')!.disabled,true);
            assert.equal(button('Stop run')!.disabled,true);
            const count=effects.length;await keyboard();assert.equal(effects.length,count);
        }
        Object.assign(tab,{stale:false,busy:false,freshAt:Date.now(),draftLoading:false,scope:'owner'});
        tab.draftLoading=true;await render();
        assert.equal(button('Send to current run')!.disabled,true);
        assert.equal(button('Stop run')!.disabled,false,'loading a draft does not prevent cancelling an active run');
        tab.draftLoading=false;
        pending=[{session_id:'s',command_id:'uncertain-access',op:'set_access'}];await render();
        assert.equal(button('Send to current run')!.disabled,true);
        assert.equal(button('Stop run')!.disabled,true);
        const count=effects.length;await keyboard();assert.equal(effects.length,count);
        assert.equal(pending[0].command_id,'uncertain-access','render/keypress never consumes uncertain records');
        pending=[{session_id:'s',command_id:'uncertain-send',op:'submit'}];await render();
        assert.equal(button('Send to current run')!.disabled,false,'a distinct message is allowed after a fresh snapshot');
        assert.equal(button('Stop run')!.disabled,true,'cancel still requires receipt resolution');
        await keyboard();assert.deepEqual(effects.at(-1),['v:s','steer']);
        assert.equal(pending[0].command_id,'uncertain-send');
        pending=[];tab.snapshot.run.state='idle';await render();assert.equal(button('Stop run'),null);
        await React.act(async()=>root.render(React.createElement(Composer,{workspace,onSettings:()=>{}})));
        assert.equal(button('Stop run'),null);assert.equal(button('Send')!.disabled,true);
        tab.scope='owner';tab.stale=false;tab.busy=false;tab.snapshot={revision:9,run:{state:'idle'},goal:{revision:1,goal:null}};tab.draft='/goal';
        pending=[{command_id:'uncertain',op:'submit'}];
        await render();const beforeGoal=effects.length;
        assert.equal(dom.window.document.querySelectorAll('.composer-surface-footer').length,1);
        assert.equal(dom.window.document.querySelector('[aria-label="Composer configuration"]'),null);
        await keyboard();
        assert.ok(dom.window.document.querySelector('[aria-label="Goal review"]'),'bare goal status is nonmodal while message receipt is pending');
        assert.equal(dom.window.document.querySelector('[role="dialog"]'),null);assert.equal(effects.length,beforeGoal,'goal status never dispatches inference');
    }finally{
        await React.act(async()=>root.unmount());
        for(const key of keys){const descriptor=saved.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}
        dom.window.close();
    }
});
