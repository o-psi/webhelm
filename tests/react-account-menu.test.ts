import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React from 'react';

test('account menu escapes identity, exposes selected appearance and preserves actions', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {url:'https://helm.test/',pretendToBeVisual:true});
    const keys = ['window','document','Event','CustomEvent','MutationObserver','HTMLElement','HTMLInputElement','Node','NodeFilter','Element','ShadowRoot','getComputedStyle','requestAnimationFrame','cancelAnimationFrame'];
    const saved = new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
    const savedAct = Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT');
    for (const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):key==='requestAnimationFrame'?(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0):key==='cancelAnimationFrame'?clearTimeout:(dom.window as any)[key]});
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const {createRoot} = await import('react-dom/client');
    const {AccountMenu} = await import('../resources/react/AccountMenu.tsx');
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    const actions: string[] = [];
    let appearance = 'system';
    const render = () => React.act(async()=>root.render(React.createElement(AccountMenu, {
        name:'<img src=x onerror=alert(1)>',email:'<script>alert(1)</script>@example.test',appearance,
        onAppearanceChange:(value:string)=>{appearance=value;},
        onAccount:()=>actions.push('account'),onAppearanceSettings:()=>actions.push('appearance'),
        onConnections:()=>actions.push('connections'),onLogout:()=>actions.push('logout'),
    })));
    const open = async () => {
        const trigger = dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Account and appearance"]')!;
        await React.act(async()=>{trigger.focus();trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,20));});
        assert.equal(trigger.getAttribute('aria-expanded'),'true');
        assert.ok(dom.window.document.querySelector('[role="menu"]'));
    };
    try {
        await render();
        await open();
        const menu = dom.window.document.querySelector('[role="menu"]')!;
        assert.ok(menu.textContent?.includes('<img src=x onerror=alert(1)>'));
        assert.ok(menu.textContent?.includes('<script>alert(1)</script>@example.test'));
        assert.equal(menu.querySelectorAll('img,script').length,0);
        assert.equal(menu.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent,'System');
        for (const label of ['Light','Dark','System']) {
            if (!dom.window.document.querySelector('[role="menu"]')) await open();
            const choice = [...dom.window.document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(node=>node.textContent===label)!;
            await React.act(async()=>choice.click());
            await render();
            assert.equal(appearance,label.toLowerCase());
        }
        for (const [label,action] of [['HelmWeb Account','account'],['Vessel connections','connections'],['Appearance settings','appearance'],['Sign out','logout']]) {
            await open();
            const item = [...dom.window.document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node=>node.textContent===label)!;
            await React.act(async()=>{item.focus();item.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
            assert.equal(actions.at(-1),action);
        }
        await open();
        await React.act(async()=>{dom.window.document.querySelector('[role="menu"]')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,20));});
        assert.equal(dom.window.document.querySelector('[role="menu"]'),null);
        assert.equal(dom.window.document.activeElement?.getAttribute('aria-label'),'Account and appearance');
    } finally {
        await React.act(async()=>root.unmount());
        for (const [key,descriptor] of saved) {if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}
        if(savedAct)Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',savedAct);else delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
        dom.window.close();
    }
});
