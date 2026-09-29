import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React from 'react';

test('Vessel manager separates overview, setup and destructive confirmation', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {url: 'https://helm.test/', pretendToBeVisual: true});
    dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    const saved: Record<string, unknown> = {};
    for (const key of ['window', 'document', 'location', 'localStorage', 'Event', 'CustomEvent', 'MutationObserver', 'HTMLElement', 'Node', 'NodeFilter', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Element', 'ShadowRoot', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
        saved[key] = (globalThis as any)[key];
        (globalThis as any)[key] = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : key === 'requestAnimationFrame' ? (callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0) : key === 'cancelAnimationFrame' ? clearTimeout : (dom.window as any)[key];
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const oldFetch = globalThis.fetch;
    let requests = 0;
    const commands: string[] = [];
    const connection = {id: 'c', name: 'Workstation', vessel_id: 'v', client: {async exchange({command}: any) {
        commands.push(command.op);
        return {protocol: 1, outcome_unknown: false, error: null, result: {vessel_id: 'v', version: '1.0.2', scope: 'owner', remote_updates: true, features: ['execution_profiles']}};
    }}};
    const assets=(version:string)=>[{name:`voyage-${version}-x86_64-unknown-linux-gnu.tar.gz`,size:100},{name:`voyage-${version}-x86_64-unknown-linux-gnu.tar.gz.sha256`,size:100}];
    globalThis.fetch = async input => {
        const url=String(input);
        if(url.endsWith('/releases/latest'))return new Response(JSON.stringify({tag_name:'v1.0.2',draft:false,prerelease:false,assets:assets('v1.0.2')}));
        if(url.includes('/releases?'))return new Response(JSON.stringify([{tag_name:'nightly-1.0.3-nightly.20260928.1.1',draft:false,prerelease:true,target_commitish:'a'.repeat(40),assets:assets('1.0.3-nightly.20260928.1.1')}]));
        requests++;throw Error('network lost');
    };
    const {createRoot} = await import('react-dom/client');
    const {Connections} = await import('../resources/react/Connections.tsx');
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    const query = (selector: string) => dom.window.document.querySelector(selector);
    const click = async (label: string) => React.act(async () => {
        const button = [...dom.window.document.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.includes(label));
        assert.ok(button, `missing ${label}`);
        button.click();
    });
    const enter = async (selector: string, value: string) => React.act(async () => {
        const input = query(selector) as HTMLInputElement | HTMLTextAreaElement;
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
        setter.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    });
    try {
        await React.act(async () => root.render(React.createElement(Connections, {
            bootstrap: {vessels: [{id: 'c', name: 'Workstation', vessel_id: 'v', endpoint: 'https://vessel.example'}],
                pairings: [{id: 'p', name: 'Laptop'}], plan: 'free', vesselLimit: 8,
                billingEnabled: true, billingCheckoutUrl: '/billing/checkout'},
            states: {c: {connected: true, status: 'Connected'}}, connections: new Map([['c', connection]]), tenant: 'test', onClose: () => {},
        })));
        assert.match(query('.connections-card')!.textContent!, /Connected/);
        assert.match(query('.connections-card')!.textContent!, /vessel.example/);
        assert.match(query('.connections-card')!.textContent!, /Version 1\.0\.2/);
        assert.match(query('.connections-dialog')!.textContent!, /Stable: v1\.0\.2/);
        assert.match(query('.connections-dialog')!.textContent!, /Development: 1\.0\.3-nightly/);
        assert.match(query('.connections-dialog')!.textContent!, /1 of 8 Vessel connections used/);
        assert.match(query('.connections-dialog')!.textContent!, /\$3\/month or \$30\/year/);
        assert.match(query('.connections-dialog')!.textContent!, /\$9\/month or \$90\/year/);
        assert.equal(query('form[action="/billing/checkout"] input[name="plan"]')?.getAttribute('value'), 'basic');
        assert.doesNotMatch(query('.connections-card')!.textContent!, /New release/,'newer development build does not mark a stable Vessel');
        assert.equal(query('.connections-pending'), null);
        assert.doesNotMatch(query('.connections-dialog')!.textContent!, /Laptop|Needs confirmation/);
        assert.deepEqual(commands, ['capabilities']);
        await click('View details for Workstation');
        assert.ok(query('.connections-details .connections-status.is-connected'));
        assert.match(query('.connections-maintenance')!.textContent!, /Software updates/);
        assert.equal(query('#update-current')!.textContent, '1.0.2');
        assert.ok(query('#update-check'), 'the selected Vessel has update controls');
        assert.doesNotMatch(query('.connections-maintenance')!.textContent!, /Newer release published/);
        assert.match(query('.connections-maintenance')!.textContent!, /Published on another channel/);
        assert.equal(commands.includes('update_prepare'),false,'opening maintenance does not download a build');
        assert.deepEqual(commands, ['capabilities', 'capabilities']);
        assert.equal(query('.connections-details dd'),null,'technical identifiers start collapsed');
        await click('Connection details');
        assert.match(query('.connections-details dl')!.textContent!, /vessel.example/);
        assert.equal(query('.connections-confirm'), null);
        await click('Remove connection');
        await click('Remove from Helm Web');
        assert.ok(query('.connections-confirm'));
        assert.equal(requests, 0);
        await click('Keep connection');
        assert.equal(query('.connections-confirm'), null);
        await click('Back');
        assert.equal(query('.connections-maintenance'), null);
        await click('Add Vessel');
        await enter('input', 'New host');
        await enter('textarea', 'private invitation');
        await click('How do I get an invitation');
        assert.match(query('.connections-guide')!.textContent!, /pair-invite/);
        await click('Back');
        assert.equal((query('input') as HTMLInputElement).value, 'New host');
        assert.equal((query('textarea') as HTMLTextAreaElement).value, 'private invitation');
        await click('Existing credential');
        await enter('textarea', 'private credential');
        await click('New invitation');
        assert.equal((query('textarea') as HTMLTextAreaElement).value, 'private invitation');
        await React.act(async () => query('form')!.dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})));
        assert.equal(requests, 1);
        assert.match(query('.connections-notice')!.textContent!, /outcome uncertain/);
        assert.equal((query('textarea') as HTMLTextAreaElement).value, 'private invitation');
        assert.equal((query('button[form="vessel-add-form"]') as HTMLButtonElement).disabled, true);
    } finally {
        await React.act(async () => root.unmount());
        globalThis.fetch = oldFetch;
        // Radix may dispatch its deferred teardown event after React unmounts.
        delete saved.Event;
        delete saved.CustomEvent;
        Object.assign(globalThis, saved);
        dom.window.close();
    }
});

test('maintenance handles old, offline and reconnected Vessels without crossing identities', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {url: 'https://helm.test/', pretendToBeVisual: true});
    const saved: Record<string, unknown> = {};
    for (const key of ['window', 'document', 'location', 'localStorage', 'Event', 'CustomEvent', 'MutationObserver', 'HTMLElement', 'Node', 'NodeFilter', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Element', 'ShadowRoot', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
        saved[key] = (globalThis as any)[key];
        (globalThis as any)[key] = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : key === 'requestAnimationFrame' ? (callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0) : key === 'cancelAnimationFrame' ? clearTimeout : (dom.window as any)[key];
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const oldFetch=globalThis.fetch;
    globalThis.fetch=async()=>{throw Error('Release metadata unavailable');};
    const {createRoot} = await import('react-dom/client');
    const {Connections} = await import('../resources/react/Connections.tsx');
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    const old = {id:'old', name:'Old Vessel', vessel_id:'old-id', client:{async exchange() {return {protocol:1, outcome_unknown:false, error:null, result:{vessel_id:'old-id', version:'1.0.0', scope:'owner', features:[], remote_updates:false}};}}};
    const reconnecting: {id:string; name:string; vessel_id:string; client:any} = {id:'offline', name:'Offline Vessel', vessel_id:'offline-id', client:null};
    const connections = new Map<string, any>([['old', old], ['offline', reconnecting]]);
    const props = {bootstrap:{vessels:[{id:'old', name:'Old Vessel', vessel_id:'old-id'}, {id:'offline', name:'Offline Vessel', vessel_id:'offline-id'}], pairings:[]},
        states:{old:{connected:true,status:'Connected'},offline:{connected:false,status:'Unavailable'}}, connections, tenant:'test', onClose() {}};
    const render = () => React.act(async()=>root.render(React.createElement(Connections,props)));
    const card = (name:string) => [...dom.window.document.querySelectorAll('.connections-card')].find(node=>node.querySelector('h3')?.textContent===name);
    const select = async (name:string) => React.act(async()=>{
        const selected=card(name);
        assert.ok(selected,name);selected.querySelector<HTMLButtonElement>('button')!.click();
    });
    const back = () => React.act(async()=>dom.window.document.querySelector<HTMLButtonElement>('.connections-back')!.click());
    try {
        await render();
        assert.match(card('Old Vessel')!.textContent!, /Version 1\.0\.0/);
        assert.match(card('Offline Vessel')!.textContent!, /Version unavailable/);
        await select('Old Vessel');
        assert.match(dom.window.document.querySelector('.connections-maintenance')!.textContent!, /one-time remote administrator installation/);
        assert.equal(dom.window.document.querySelector<HTMLElement>('#update-source')!.hidden,true);

        await back();
        await select('Offline Vessel');
        assert.match(dom.window.document.querySelector('.connections-maintenance')!.textContent!, /Connect this Vessel/);
        assert.equal(dom.window.document.querySelector('#update-check'),null);

        reconnecting.client = {async exchange() {return {protocol:1,outcome_unknown:false,error:null,result:{vessel_id:'different-id',version:'wrong',scope:'owner',remote_updates:true}};}};
        await render();
        assert.match(dom.window.document.querySelector('.connections-maintenance')!.textContent!, /Vessel identity changed/);
        assert.equal(dom.window.document.querySelector('#update-check'),null);
        await back();
        assert.match(card('Offline Vessel')!.textContent!, /Version unavailable/);
        await select('Offline Vessel');

        reconnecting.client = {async exchange() {return {protocol:1,outcome_unknown:false,error:null,result:{vessel_id:'offline-id',version:'current',scope:'owner',remote_updates:true,features:['execution_profiles']}};}};
        await render();
        assert.equal(dom.window.document.querySelector('#update-current')!.textContent,'current');
        assert.ok(dom.window.document.querySelector('#update-check'));
    } finally {
        await React.act(async()=>root.unmount());
        globalThis.fetch=oldFetch;
        delete saved.Event;delete saved.CustomEvent;
        Object.assign(globalThis,saved);
        dom.window.close();
    }
});
