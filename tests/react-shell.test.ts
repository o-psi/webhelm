import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';

test('React shell renders safely without Livewire and uses the production console', async () => {
    const dom = new JSDOM('<meta name="csrf-token" content="fixture-token">');
    const previous = globalThis.document;
    globalThis.document = dom.window.document;
    try {
        const {App}=await import('../resources/react/App.tsx');
        const html = renderToStaticMarkup(React.createElement(App, {bootstrap: {tenantId: 'tenant', vessels: [{id: 'v', name: '<img src=x onerror=alert(1)>', vessel_id: 'owner'}], ticketUrl: '/console/ticket', connectionsUrl: '/connections', logoutUrl: '/console/logout'}}));
        const output = new JSDOM(html).window.document;
        assert.equal(output.querySelectorAll('img,script').length, 0);
        assert.ok(output.querySelector('[aria-label="Vessel connections"]'));
        assert.doesNotMatch(output.body.textContent!, /React preview|existing console/i);
        assert.equal(output.querySelector('.tabs'), null);
        assert.equal(output.querySelector('.welcome'), null);
        assert.equal(output.querySelectorAll('main textarea[aria-label="Message"]').length, 1);
        assert.match(output.querySelector('main')?.textContent || '', /What should we work on\?/);
        assert.ok(output.querySelector('#voyage-vessel-filter'));
        assert.equal(output.querySelectorAll('main form[aria-label="New voyage composer"]').length, 1);
        assert.equal(output.querySelector('main button[type="submit"]')?.textContent, 'Send');
        assert.ok(output.querySelector('[aria-label="Open voyage navigation"]'));
        assert.ok(output.querySelector('[aria-label="Account and appearance"]'));
        assert.equal(output.querySelector('form')?.getAttribute('method'), 'post');
        assert.equal(output.querySelector<HTMLInputElement>('[name="_token"]')?.value, 'fixture-token');
        assert.equal(output.querySelector('nav')?.getAttribute('aria-label'), 'Voyages');
        assert.equal(output.querySelectorAll('[wire\\:id]').length, 0);
    } finally { globalThis.document = previous; dom.window.close(); }
});

test('console keeps responsive layout while shadcn owns control styling', async () => {
    const {readFileSync} = await import('node:fs');
    const css = readFileSync(new URL('../resources/react/style.css', import.meta.url), 'utf8');
    assert.match(css, /grid-template-columns:256px minmax\(0,1fr\)/);
    assert.match(css, /\.dark\{color-scheme:dark/);
    // One reading measure at every width: the thread never widens past 768px.
    assert.match(css, /\.thread\{max-width:768px/);
    assert.doesNotMatch(css, /max-width:80rem|max-width:96rem/);
    // Helm geometry is layered so shadcn utilities passed through className win.
    assert.match(css, /@layer components \{\n:root\{/);
    // Run-state colors are semantic tokens in both themes.
    assert.match(css, /--status-active: oklch/);
    assert.match(css, /\[data-status-tone=warning\]\{--tone:var\(--status-warning\)\}/);
    assert.match(css, /--primary: oklch\(0\.205 0 0\)/);
    assert.doesNotMatch(css, /\.composer textarea\[data-slot="textarea"\]/);
    assert.doesNotMatch(css, /\.settings-dialog button\{padding/);
    assert.doesNotMatch(css, /\.new-voyage,\.send-button\{/);
    assert.match(css, /prefers-reduced-motion:reduce/);
    assert.match(css, /\.sidebar\.mobile-open/);
    assert.match(css, /\.conversation\[hidden\]\{display:none\}/);
});

test('React approval UI distinguishes root consent from generic approval', async()=>{
 const {Decisions}=await import('../resources/react/Decisions.tsx');
 const tab:any={key:'a',vessel:'host',incarnation:'inc',snapshot:{run:{run_id:'run'}},decisions:[{decision_id:'root',incarnation:'inc',run_id:'run',expires_at_ms:Date.now()+10000,request:{kind:'root_grant',root_grant:{path:'/workspace',permission:'write',lifetime:'current_run',reason:'Edit project'}}}]};
 const html=renderToStaticMarkup(React.createElement(Decisions,{tab,workspace:{actionable:()=>true,permitted:()=>true} as any}));
 assert.match(html,/Grant access for this run/);assert.match(html,/Not inherited by children/);assert.doesNotMatch(html,/>Approve</);
 tab.decisions[0].request.root_grant.path='/workspace\nspoof';
 const invalid=renderToStaticMarkup(React.createElement(Decisions,{tab,workspace:{actionable:()=>true,permitted:()=>true} as any}));
 assert.match(invalid,/Unsupported filesystem request/);assert.doesNotMatch(invalid,/Grant access for this run/);
});

test('React enrollment island mounts and scrubs private state on unmount',async()=>{
 const {Enrollment}=await import('../resources/react/Enrollment.tsx');
 const {createRoot}=await import('react-dom/client');
 const {act}=React;
 const dom=new JSDOM('<div id="mount"></div>',{url:'https://helm.test'});
 const saved={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(dom.window.document.querySelector('#mount')!);
 const connection:any={id:'c',vessel_id:'v',client:{socket:new dom.window.EventTarget(),async exchange(){return {protocol:1,outcome_unknown:false,result:{accounts:[],connections:[]}};}}};
 try{
  await act(async()=>root.render(React.createElement(Enrollment,{connection,workspace:'/work',tenant:'t',onRefreshed:()=>{}})));
  await act(async()=>{dom.window.document.querySelector<HTMLButtonElement>('[data-open]')!.click();});
  assert.match(dom.window.document.body.textContent!,/No authorized native subscription connection is available/);
  await act(async()=>root.unmount());assert.equal(dom.window.document.querySelector('#enrollment-code'),null);
 }finally{Object.assign(globalThis,saved);dom.window.close();}
});

test('React voyage details observe an exact pending receipt without replay',async()=>{
 const {createRoot}=await import('react-dom/client');const {act}=React;
 const dom=new JSDOM('<div id="mount"></div>',{url:'https://helm.test'});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 (dom.window.HTMLElement.prototype as any).attachEvent=()=>{};(dom.window.HTMLElement.prototype as any).detachEvent=()=>{};
 const saved={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),MutationObserver:dom.window.MutationObserver,NodeFilter:dom.window.NodeFilter,Node:dom.window.Node,Element:dom.window.Element,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,HTMLTextAreaElement:dom.window.HTMLTextAreaElement,HTMLSelectElement:dom.window.HTMLSelectElement,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
 const {VoyageActions}=await import('../resources/react/VoyageActions.tsx');
 const commands:string[]=[];let pending:any[]=[{session_id:'s',command_id:'cmd',op:'rename',sidebar_action:true}];const connection:any={id:'c',vessel_id:'v',name:'Vessel',journal:{entries:()=>pending,settle:(id:string)=>{pending=pending.filter(entry=>entry.command_id!==id);}},client:{async exchange({command}:any){commands.push(command.op);const result=command.op==='capabilities'?{scope:'owner',vessel_id:'v'}:command.op==='inspect'?{session_id:'s',incarnation:'i',state:'live'}:command.op==='receipt'?{session_id:'s',result:{command_id:'cmd',status:'applied'}}:{session_id:'s',incarnation:'i',result:{session_id:'s',revision:1,access:'approval',run:{state:'idle'},messages:[{content:'private conversation'}]}};return {protocol:1,outcome_unknown:false,result};}}};
 const root=createRoot(dom.window.document.querySelector('#mount')!);
 try{await act(async()=>root.render(React.createElement(VoyageActions,{connection,voyage:{session_id:'s',name:'Voyage'},onChanged:()=>{}})));
 await act(async()=>{dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Voyage actions"]')!.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true,button:0}));});
 await act(async()=>{[...dom.window.document.querySelectorAll<HTMLElement>('[data-actions] [role="menuitem"]')].find(item=>item.textContent==='Details')!.click();});
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
 await act(async()=>{[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Technical details')!.click();});
 assert.equal(dom.window.document.querySelector('[data-slot=dialog-content]')?.getAttribute('data-state'),'open');assert.equal(dom.window.document.querySelector('#sidebar-details-run')!.textContent,'idle');assert.match(dom.window.document.querySelector('#sidebar-action-details')!.textContent!,/"revision": 1/);assert.doesNotMatch(dom.window.document.querySelector('#sidebar-action-details')!.textContent!,/private conversation/);assert.equal((dom.window.document.querySelector('#sidebar-reconcile') as HTMLElement).hidden,false);
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1600));});
 // Menu availability and dialog confirmation independently refresh read-only state.
 assert.deepEqual(commands,['capabilities','inspect','snapshot','capabilities','inspect','snapshot','receipt']);assert.equal(pending.length,0);assert.equal((dom.window.document.querySelector('#sidebar-reconcile') as HTMLElement).hidden,true);
 await act(async()=>{dom.window.document.querySelector<HTMLButtonElement>('#sidebar-dismiss')!.click();});
 await act(async()=>root.render(React.createElement(VoyageActions,{connection,voyage:{session_id:'s',name:'Voyage'},onChanged:()=>{},accessTrigger:true,triggerLabel:'Access: Approval'})));
 await act(async()=>{dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Review access mode"]')!.click();});
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});
 assert.match(dom.window.document.querySelector('#sidebar-access-summary')!.textContent!,/Current: Approval. Proposed: Approval.*Vessel/);
 assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#sidebar-submit')!.disabled,true);
 await act(async()=>{const select=dom.window.document.querySelector<HTMLSelectElement>('#sidebar-access')!;select.value='read-only';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.match(dom.window.document.querySelector('#sidebar-access-summary')!.textContent!,/Current: Approval. Proposed: Read only.*Vessel/);
 assert.equal(dom.window.document.querySelector<HTMLButtonElement>('#sidebar-submit')!.disabled,false);
 assert.equal(commands.includes('set_access'),false);
 let outerSubmits=0;dom.window.document.querySelector('#mount')!.addEventListener('submit',()=>outerSubmits++);
 connection.journal.prepare=(command:any)=>pending.push(command);
 const originalExchange=connection.client.exchange;
 connection.client.exchange=async(request:any)=>request.command.op==='set_access'?(commands.push('set_access'),{protocol:1,outcome_unknown:false,result:{session_id:'s',incarnation:'i',result:{command_id:request.command.command_id,status:'applied'}}}):originalExchange(request);
 await act(async()=>{dom.window.document.querySelector('#sidebar-action-form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
 assert.equal(commands.filter(command=>command==='set_access').length,1);
 assert.equal(outerSubmits,0,'saving a voyage action cannot submit an enclosing chat composer');
 await act(async()=>root.unmount());assert.equal(dom.window.document.querySelector('[data-slot=dialog-content]'),null);
 }finally{Object.assign(globalThis,saved);dom.window.close();}
});

 test('conversation has no visible title/status header and retains accessible selected context',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../resources/react/App.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/<header className="conversation-header"/);
 assert.match(source,/<div className="sr-only" role="region" aria-label="Selected voyage context">/);
 assert.match(source,/<h1>\{tab.title\}<\/h1>/);
 assert.match(source,/headerStatus&&<p>\{headerStatus.label\}<\/p>/);
 const css=readFileSync(new URL('../resources/react/style.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/\.conversation-header/);
 assert.match(css,/\.conversation>\.transcript\{padding-top:60px\}/);
 });
