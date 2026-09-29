import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React from 'react';

test('global settings has HelmWeb Account and Appearance pages', async () => {
    const dom = new JSDOM('<meta name="csrf-token" content="csrf-test"><div id="mount"></div>',
        {url: 'https://helm.test/', pretendToBeVisual: true});
    const saved: Record<string, unknown> = {};
    for (const key of ['window', 'document', 'location', 'Event', 'CustomEvent', 'MutationObserver',
        'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement',
        'Node', 'NodeFilter', 'Element', 'ShadowRoot', 'getComputedStyle',
        'requestAnimationFrame', 'cancelAnimationFrame']) {
        saved[key] = (globalThis as any)[key];
        (globalThis as any)[key] = key === 'getComputedStyle'
            ? dom.window.getComputedStyle.bind(dom.window)
            : key === 'requestAnimationFrame' ? (callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0)
                : key === 'cancelAnimationFrame' ? clearTimeout : (dom.window as any)[key];
    }
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const {createRoot} = await import('react-dom/client');
    const {WebSettings} = await import('../resources/react/WebSettings.tsx');
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    let page: 'account' | 'appearance' = 'account';
    let appearance = 'system';
    let manage = 0;
    const account = {accountName:'Captain', accountEmail:'captain@example.test', plan:'free',
        vesselLimit:8, vessels:[{id:'one'}], billingEnabled:true,
        billingCheckoutUrl:'/billing/checkout', billingPortalUrl:'https://billing.stripe.com/p/login/example'};
    const render = () => React.act(async()=>root.render(React.createElement(WebSettings, {
        account, page, onPageChange:(value:'account'|'appearance')=>{page=value;},
        appearance, onAppearanceChange:(value:string)=>{appearance=value;},
        onManageVessels:()=>{manage++;}, onClose:()=>{},
    })));
    const button = (label:string) => [...dom.window.document.querySelectorAll('button')]
        .find(node=>node.textContent?.trim() === label);
    try {
        await render();
        const dialog = dom.window.document.querySelector('.web-settings-dialog')!;
        assert.match(dialog.textContent!, /HelmWeb Account/);
        assert.match(dialog.textContent!, /Captain · captain@example\.test/);
        assert.match(dialog.textContent!, /1 of 8 Vessel connections used/);
        assert.match(dialog.textContent!, /\$3\/month or \$30\/year/);
        assert.match(dialog.textContent!, /\$9\/month or \$90\/year/);
        assert.equal(dom.window.document.querySelectorAll('form[action="/billing/checkout"]').length, 4);
        assert.equal(dom.window.document.querySelector('form[action="/billing/checkout"] input[name="_token"]')?.getAttribute('value'), 'csrf-test');
        await React.act(async()=>button('Manage Vessels')!.click());
        assert.equal(manage, 1);
        await React.act(async()=>button('Appearance')!.click());
        await render();
        assert.equal(page, 'appearance');
        assert.match(dialog.textContent!, /Choose how Helm Web looks/);
        await React.act(async()=>button('dark')!.click());
        await render();
        assert.equal(appearance, 'dark');
    } finally {
        await React.act(async()=>root.unmount());
        delete saved.Event; delete saved.CustomEvent;
        Object.assign(globalThis, saved);
        dom.window.close();
    }
});
