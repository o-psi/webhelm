import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import DOMPurify from 'dompurify';
import {Conversation,CopyResponse} from '../resources/react/App.tsx';

test('live tool preview appears before the working indicator', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {pretendToBeVisual:true});
    const saved = {window:globalThis.window, document:globalThis.document, getComputedStyle:globalThis.getComputedStyle, requestAnimationFrame:globalThis.requestAnimationFrame, cancelAnimationFrame:globalThis.cancelAnimationFrame};
    Object.defineProperty(dom.window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
    Object.assign(globalThis, {window:dom.window, document:dom.window.document, getComputedStyle:dom.window.getComputedStyle.bind(dom.window), requestAnimationFrame:(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0), cancelAnimationFrame:clearTimeout, IS_REACT_ACT_ENVIRONMENT:true});
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    const tab:any = {key:'t', title:'Voyage', snapshot:{messages:[], run:{state:'running', tool_previews:[{call_id:'pending',name:'shell',arguments:'echo hello'}]}}, decisions:[], pictures:[], draft:'', busy:false};
    const workspace:any = {actionable:()=>false, permitted:()=>false, pending:()=>[]};
    try {
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{}})));
        const thread = dom.window.document.querySelector('.thread')!;
        const preview = thread.querySelector('.tool-entry')!;
        const working = thread.querySelector('.working-indicator')!;
        assert.match(preview.textContent!, /Tool preview · shell/);
        assert.ok(preview.compareDocumentPosition(working) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    } finally {await React.act(async()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();}
});

test('transcript preloads at the top edge, preserves the anchor and avoids duplicate reads', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {pretendToBeVisual:true});
    const saved = {window:globalThis.window, document:globalThis.document, requestAnimationFrame:globalThis.requestAnimationFrame};
    Object.assign(globalThis, {window:dom.window, document:dom.window.document, requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0), IS_REACT_ACT_ENVIRONMENT:true});
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    const tab:any = {key:'t', title:'Voyage', snapshot:{message_offset:100, messages:[]}, decisions:[], pictures:[]};
    let reads = 0;
    const workspace:any = {actionable:()=>false,permitted:()=>false,earlier:async()=>{reads++;tab.snapshot={...tab.snapshot,message_offset:50,messages:tab.snapshot.messages};}};
    try {
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:false,onSettings:()=>{}})));
        const el = dom.window.document.querySelector<HTMLElement>('.transcript')!;
        let height = 2000;
        Object.defineProperties(el,{clientHeight:{get:()=>800},scrollHeight:{get:()=>height}});
        el.scrollTop=1200;
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{}})));
        await React.act(async()=>el.dispatchEvent(new dom.window.Event('scroll',{bubbles:true})));
        assert.equal(reads,0);
        el.scrollTop=100;
        await React.act(async()=>{el.dispatchEvent(new dom.window.Event('scroll',{bubbles:true}));height=2600;await new Promise(resolve=>setTimeout(resolve,0));});
        assert.equal(reads,1);
        assert.equal(el.scrollTop,700);
        assert.doesNotMatch(dom.window.document.body.textContent!,/Load earlier messages/);
        await React.act(async()=>el.dispatchEvent(new dom.window.Event('scroll',{bubbles:true})));
        assert.equal(reads,1);
    } finally {await React.act(async()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();}
});


test('OS picture selection displays a composer error instead of silently disappearing', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {pretendToBeVisual:true});
    const saved = {window:globalThis.window, document:globalThis.document, requestAnimationFrame:globalThis.requestAnimationFrame};
    Object.assign(globalThis, {window:dom.window, document:dom.window.document, requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0), IS_REACT_ACT_ENVIRONMENT:true});
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    const tab:any = {key:'t', title:'Voyage', snapshot:{messages:[]}, decisions:[], pictures:[], draft:'', notice:'', busy:false};
    const workspace:any = {actionable:()=>false, permitted:()=>false, pending:()=>[], attach:async(_key:string,files:File[])=>{
        assert.equal(files[0].name,'unsupported.svg');tab.notice='Use PNG, JPEG or WebP; at most four pictures and 2 MiB total.';return false;
    }};
    try {
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{}})));
        const input = dom.window.document.querySelector<HTMLInputElement>('input[type=file]')!;
        Object.defineProperty(input,'files',{configurable:true,value:[new dom.window.File(['svg'],'unsupported.svg',{type:'image/svg+xml'})]});
        await React.act(async()=>{input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await Promise.resolve();});
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{}})));
        assert.match(dom.window.document.querySelector('.composer')!.textContent!,/Use PNG, JPEG or WebP/);
    } finally {await React.act(async()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();}
});


test('OS picture selection shows a named preview in the composer', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {pretendToBeVisual:true});
    const saved = {window:globalThis.window, document:globalThis.document, requestAnimationFrame:globalThis.requestAnimationFrame};
    Object.assign(globalThis, {window:dom.window, document:dom.window.document, requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0), IS_REACT_ACT_ENVIRONMENT:true});
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    const tab:any = {key:'t', title:'Voyage', snapshot:{messages:[]}, decisions:[], pictures:[], draft:'', notice:'', busy:false};
    const workspace:any = {actionable:()=>true,permitted:()=>true,pending:()=>[],attach:async(_key:string,files:File[])=>{
        tab.pictures.push({id:'p',name:files[0].name,url:'blob:preview'});return true;
    }};
    try {
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{}})));
        const input=dom.window.document.querySelector<HTMLInputElement>('input[type=file]')!;
        Object.defineProperty(input,'files',{configurable:true,value:[new dom.window.File(['png'],'photo.png',{type:'image/png'})]});
        await React.act(async()=>{input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await Promise.resolve();});
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{}})));
        assert.equal(dom.window.document.querySelector('.composer .pictures img')?.getAttribute('alt'),'photo.png');
        assert.match(dom.window.document.querySelector('.composer')!.textContent!,/photo.png/);
        assert.equal(dom.window.document.querySelector<HTMLButtonElement>('.composer [aria-label="Send"]')?.disabled,false);
    } finally {await React.act(async()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();}
});

test('uncertain earlier message stays inspectable while a fresh composer can send', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {pretendToBeVisual:true});
    const saved = {window:globalThis.window, document:globalThis.document, requestAnimationFrame:globalThis.requestAnimationFrame};
    Object.assign(globalThis, {window:dom.window, document:dom.window.document, requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0), IS_REACT_ACT_ENVIRONMENT:true});
    const root=createRoot(dom.window.document.querySelector('#mount')!);
    const id='a0c1465a-f47c-47aa-8a17-04c786833419';
    const tab:any={key:'t',title:'Voyage',snapshot:{messages:[]},decisions:[],pictures:[],draft:'Retained',notice:'We can’t confirm whether your message went through. Check the conversation and receipt before trying again.',busy:false};
    let checks=0;
    const workspace:any={actionable:()=>true,permitted:()=>true,pending:()=>[{op:'submit',command_id:id}],reconcile:async()=>{checks++;}};
    try{
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{},onRecover:()=>{},connection:{client:{}},voyage:{}})));
        assert.equal(dom.window.document.querySelector('.composer-feedback'),null,'technical recovery stays absent until requested');
        await React.act(async()=>[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Review pending work')!.click());
        const feedback=dom.window.document.querySelector('.composer-feedback')!;
        assert.match(feedback.querySelector('p')!.textContent!,/You can keep chatting/);
        assert.doesNotMatch(feedback.querySelector('p')!.textContent!,new RegExp(id));
        assert.equal(dom.window.document.querySelectorAll('.composer-feedback').length,1);
        assert.equal(feedback.querySelector('details')!.open,false);
        assert.match(feedback.querySelector('code')!.textContent!,new RegExp(id));
        await React.act(async()=>dom.window.document.querySelector<HTMLButtonElement>('.composer-feedback button')!.click());
        assert.equal(checks,1);
        assert.equal([...dom.window.document.querySelectorAll<HTMLButtonElement>('.composer-feedback button')].some(button=>button.textContent==='Continue in a new voyage'),false);
        assert.equal(dom.window.document.querySelector<HTMLButtonElement>('.composer [aria-label="Send"]')?.disabled,false);
    }finally{await React.act(async()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();}
});

test('unreadable command journal still explains why sending is blocked',async()=>{
    const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
    const saved={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame};
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0),IS_REACT_ACT_ENVIRONMENT:true});
    const root=createRoot(dom.window.document.querySelector('#mount')!);
    const tab:any={key:'t',title:'Voyage',snapshot:{messages:[]},decisions:[],pictures:[],draft:'Retained',notice:'',busy:false};
    const workspace:any={actionable:()=>false,permitted:()=>false,pending:()=>{throw new Error('corrupt journal');}};
    try{
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{},onRecover:()=>{}})));
        assert.equal(dom.window.document.querySelector('.composer-feedback'),null);
        await React.act(async()=>[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='Review pending work')!.click());
        assert.match(dom.window.document.querySelector('.composer-feedback')!.textContent!,/Recovery record is unavailable/);
        assert.equal(dom.window.document.querySelector<HTMLButtonElement>('.composer [aria-label="Send"]')?.disabled,true);
        assert.ok([...dom.window.document.querySelectorAll('button')].some(button=>button.textContent==='Continue in a new voyage'));
    }finally{await React.act(async()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();}
});

test('copy response reads canonical text before writing to the clipboard',async()=>{
    const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
    const saved={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame};
    const clipboard=Object.getOwnPropertyDescriptor(globalThis.navigator,'clipboard');
    let copied='',reads=0;
    Object.defineProperty(globalThis.navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{copied=text;}}});
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0),IS_REACT_ACT_ENVIRONMENT:true});
    const root=createRoot(dom.window.document.querySelector('#mount')!);
    const tab:any={key:'t',title:'Voyage',snapshot:{revision:7,messages:[{message_index:2,role:'assistant',content:'Projected text',projection_truncated:true}]},decisions:[],pictures:[],draft:'',notice:'',busy:false};
    const workspace:any={actionable:()=>false,permitted:()=>false,pending:()=>[],canonicalMessage:async(key:string,index:number,revision:number)=>{assert.deepEqual([key,index,revision],['t',2,7]);reads++;return 'Complete canonical response';}};
    try{
        await React.act(async()=>root.render(React.createElement(CopyResponse,{tab,workspace,message:tab.snapshot.messages[0]})));
        await React.act(async()=>dom.window.document.querySelector<HTMLButtonElement>('[aria-label="Copy response"]')!.click());
        assert.equal(reads,1);assert.equal(copied,'Complete canonical response');
        assert.ok(dom.window.document.querySelector('[aria-label="Response copied"]'));
    }finally{await React.act(async()=>root.unmount());Object.assign(globalThis,saved);if(clipboard)Object.defineProperty(globalThis.navigator,'clipboard',clipboard);else delete (globalThis.navigator as any).clipboard;dom.window.close();}
});

test('live growth follows latest, respects reading position, and restores hidden voyages', async () => {
    const dom = new JSDOM('<div id="mount"></div>', {pretendToBeVisual:true});
    const saved = {window:globalThis.window, document:globalThis.document, requestAnimationFrame:globalThis.requestAnimationFrame, ResizeObserver:globalThis.ResizeObserver};
    const callbacks = new Set<ResizeObserverCallback>();
    class Observer {
        constructor(readonly callback:ResizeObserverCallback){callbacks.add(callback);}
        observe(){} disconnect(){callbacks.delete(this.callback);}
    }
    Object.assign(globalThis, {window:dom.window, document:dom.window.document, ResizeObserver:Observer, requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0), IS_REACT_ACT_ENVIRONMENT:true});
    const root = createRoot(dom.window.document.querySelector('#mount')!);
    const tab:any = {key:'t', title:'Voyage', snapshot:{messages:[]}, decisions:[], pictures:[], draft:''};
    let reads = 0;
    const workspace:any = {actionable:()=>false,permitted:()=>false,pending:()=>[],earlier:async()=>{reads++;}};
    const render=(active:boolean)=>root.render(React.createElement(Conversation,{tab,workspace,active,onSettings:()=>{}}));
    const resize=()=>{for(const callback of callbacks)callback([],{} as ResizeObserver);};
    try {
        await React.act(async()=>render(false));
        const el = dom.window.document.querySelector<HTMLElement>('.transcript')!;
        let height=2000,top=0;
        Object.defineProperties(el,{clientHeight:{get:()=>800},scrollHeight:{get:()=>height},scrollTop:{get:()=>top,set:value=>{top=Math.max(0,Math.min(value,height-800));}}});
        await React.act(async()=>render(true));
        assert.equal(el.scrollTop,1200,'initial hydration opens at latest');
        await React.act(async()=>{height=2400;resize();});
        assert.equal(el.scrollTop,1600,'stream growth keeps latest visible');
        el.scrollTop=600;
        await React.act(async()=>el.dispatchEvent(new dom.window.Event('scroll')));
        await React.act(async()=>{height=2800;resize();});
        assert.equal(el.scrollTop,600,'incoming output must not pull a reader away');
        assert.match(dom.window.document.querySelector('.turn-navigation')!.textContent!,/Latest/);
        await React.act(async()=>render(false));
        el.scrollTop=0;
        await React.act(async()=>el.dispatchEvent(new dom.window.Event('scroll')));
        await React.act(async()=>{height=3200;resize();});
        await React.act(async()=>render(true));
        assert.equal(el.scrollTop,600,'hiding and reactivating preserves the reading position');
        assert.equal(reads,0);
        await React.act(async()=>root.unmount());
        assert.equal(callbacks.size,0,'size observers are released');
    } finally {await React.act(async()=>root.unmount());Object.assign(globalThis,saved);dom.window.close();}
});

test('history anchoring ignores simultaneous appended output', async () => {
    const dom=new JSDOM('<div id="mount"></div>',{pretendToBeVisual:true});
    const saved={window:globalThis.window,document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame};
    const sanitize=DOMPurify.sanitize;DOMPurify.sanitize=DOMPurify(dom.window as any).sanitize;
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,requestAnimationFrame:(fn:FrameRequestCallback)=>fn(0),IS_REACT_ACT_ENVIRONMENT:true});
    const root=createRoot(document.querySelector('#mount')!);
    const tab:any={key:'t',title:'Voyage',following:false,scrollTop:600,snapshot:{message_offset:100,messages:[{message_index:100,role:'user',content:'Reading this message'}]},decisions:[],pictures:[],draft:''};
    let height=2000,anchorTop=0,release!:()=>void;
    const workspace:any={actionable:()=>false,permitted:()=>false,pending:()=>[],earlier:()=>new Promise<void>(resolve=>{release=resolve;})};
    try{
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:false,onSettings:()=>{}})));
        const el=document.querySelector<HTMLElement>('.transcript')!,message=document.querySelector<HTMLElement>('[data-message-index="100"]')!;
        Object.defineProperties(el,{clientHeight:{get:()=>800},scrollHeight:{get:()=>height}});
        message.getBoundingClientRect=()=>({top:anchorTop,bottom:anchorTop+200}) as DOMRect;
        await React.act(async()=>root.render(React.createElement(Conversation,{tab,workspace,active:true,onSettings:()=>{}})));
        el.scrollTop=100;
        await React.act(async()=>el.dispatchEvent(new dom.window.Event('scroll')));
        await React.act(async()=>{height+=1000;anchorTop+=600;tab.snapshot.message_offset=50;release();await Promise.resolve();});
        assert.equal(el.scrollTop,700,'only the 600px prepended page affects the reading anchor, not the 400px live output');
    }finally{await React.act(async()=>root.unmount());Object.assign(globalThis,saved);DOMPurify.sanitize=sanitize;dom.window.close();}
});
