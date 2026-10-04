import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';

 test('console restores Flux appearance, persists choices and follows system changes only in System mode', async () => {
    const dom = new JSDOM('<meta name="csrf-token" content="fixture"><div id="mount"></div>', {url:'https://helm.test/',pretendToBeVisual:true});
    const keys = ['window','document','location','localStorage','Event','CustomEvent','MutationObserver','HTMLElement','HTMLInputElement','HTMLTextAreaElement','Node','NodeFilter','Element','ShadowRoot','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','IS_REACT_ACT_ENVIRONMENT'];
    const saved = new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    for (const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):key==='requestAnimationFrame'?(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0):key==='cancelAnimationFrame'?clearTimeout:(dom.window as any)[key]});
    const listeners = new Set<()=>void>();
    const media = {matches:false,addEventListener(_type:string,listener:()=>void){listeners.add(listener);},removeEventListener(_type:string,listener:()=>void){listeners.delete(listener);}};
    Object.defineProperty(dom.window,'matchMedia',{value:(query:string)=>query==='(prefers-color-scheme: dark)'?media:{matches:false,addEventListener(){},removeEventListener(){}}});
    dom.window.localStorage.setItem('flux.appearance','dark');
    const {createRoot} = await import('react-dom/client');
    const {App} = await import('../resources/react/App.tsx');
    let root = createRoot(dom.window.document.querySelector('#mount')!);
    const render = () => React.act(async()=>root.render(React.createElement(App,{bootstrap:{tenantId:'appearance-fixture',vessels:[],ticketUrl:'/ticket',connectionsUrl:'/connections',logoutUrl:'/logout'},draftRepository:{async read(){return null;},async write(){return null;}}})));
    const dark = () => dom.window.document.documentElement.classList.contains('dark');
    const open = async () => {
        const trigger = dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Account and appearance"]')!;
        await React.act(async()=>{trigger.focus();trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,20));});
    };
    const select = async (label:string) => {
        await open();
        const choice = [...dom.window.document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item=>item.textContent===label)!;
        assert.ok(choice);
        await React.act(async()=>choice.click());
        assert.equal(dom.window.localStorage.getItem('flux.appearance'),label.toLowerCase());
    };
    const system = async (matches:boolean) => React.act(async()=>{media.matches=matches;for(const listener of listeners)listener();});
    try {
        await render();
        assert.equal(dark(),true,'restores persisted Dark despite light OS');
        await select('Light');
        assert.equal(dark(),false);
        await system(true);
        assert.equal(dark(),false,'explicit Light ignores dark OS');
        await select('System');
        assert.equal(dark(),true,'System immediately uses current OS');
        await system(false);
        assert.equal(dark(),false,'System follows OS changes');
        await system(true);
        assert.equal(dark(),true);
        await select('Dark');
        await system(false);
        assert.equal(dark(),true,'explicit Dark ignores light OS');
        await React.act(async()=>root.unmount());
        assert.equal(listeners.size,0,'unmount removes appearance listener');
        root = createRoot(dom.window.document.querySelector('#mount')!);
        await render();
        assert.equal(dark(),true,'saved choice survives remount');
        await open();
        assert.equal(dom.window.document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent,'Dark');
    } finally {
        await React.act(async()=>root.unmount());
        for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}
        dom.window.close();
    }
});
