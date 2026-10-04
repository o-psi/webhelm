import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';

test('searchable select preserves controlled values, imperative adapters, disabled choices and nested-dialog focus',async()=>{
    const dom=new JSDOM('<main id="app"></main>',{url:'https://fixture.invalid'});
    const names=['window','document','localStorage','IS_REACT_ACT_ENVIRONMENT','getComputedStyle','MutationObserver','HTMLElement','HTMLInputElement','Node','NodeFilter','Element','ShadowRoot','Event','CustomEvent','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'];
    const saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
    Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,Element:dom.window.Element,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent,requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout,ResizeObserver:class{observe(){}unobserve(){}disconnect(){}}});
    dom.window.HTMLElement.prototype.getClientRects=function(){return [{width:40,height:40}] as any;};
    const {createRoot}=await import('react-dom/client');
    const {SelectCombobox}=await import('../resources/react/components/ui/select-combobox');
    const {Dialog,DialogContent,DialogTitle}=await import('../resources/react/components/ui/dialog');
    const root=createRoot(document.getElementById('app')!);
    const changed:string[]=[];
    function Controlled(){
        const [value,setValue]=React.useState('stable');
        return React.createElement('label',null,'Release channel',React.createElement(SelectCombobox,{value,onChange:event=>{changed.push(event.target.value);setValue(event.target.value);}},
            React.createElement('option',{value:'stable'},'Stable'),React.createElement('option',{value:'nightly'},'Development'),React.createElement('option',{value:''},'Provider default'),React.createElement('option',{value:'retired',disabled:true},'Retired')));
    }
    const settle=async()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
    const button=(name:string)=>{const found=[...document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.getAttribute('aria-label')===name);assert.ok(found,name);return found;};
    const click=async(name:string)=>act(async()=>button(name).click());
    const search=async(value:string,label='Search release channel')=>{
        const node=document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;assert.ok(node,label);
        await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});return node;
    };
    const enter=async(input:HTMLInputElement)=>act(async()=>input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
    try{
        let constructions=0;
        dom.window.customElements.define('picker-label',class extends dom.window.HTMLElement{
            constructor(){super();constructions++;}
        });
        const {installButtonTooltips}=await import('../resources/js/button-tooltips.js');
        if(!document.getElementById('helm-button-tooltip'))installButtonTooltips(document);
        await act(async()=>root.render(React.createElement('div',null,...['Model','Account','Reasoning','Service tier','Access'].map(name=>React.createElement('label',{key:name},
            React.createElement('span',{className:'sr-only'},React.createElement('picker-label',null,name)),React.createElement('span',{hidden:true},'Hidden'),React.createElement('span',{inert:true},'Inert'),React.createElement('span',{'aria-hidden':'true'},'Decoration'),
            React.createElement(SelectCombobox,null,React.createElement('option',{value:'ready'},`${name} ready`)))))));await settle();
        assert.equal(constructions,5,'label extraction must not clone custom elements');
        for(const name of ['Model','Account','Reasoning','Service tier','Access']){
            const picker=button(name);
            for(const type of ['pointerover','focusin']){
                await act(async()=>picker.dispatchEvent(new dom.window.Event(type,{bubbles:true})));
                assert.equal(constructions,5);
                assert.equal(document.querySelector<HTMLElement>('#helm-button-tooltip')!.hidden,true);
                assert.equal(picker.disabled,false);
                assert.equal(picker.textContent,`${name} ready`);
            }
            await click(name);
            assert.ok(document.querySelector(`[aria-label="Search ${name.toLowerCase()}"]`),'picker initializes after hover and focus');
            await act(async()=>document.querySelector('input')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settle();
        }
        await act(async()=>root.render(React.createElement('label',null,'Implicit label',
            React.createElement('span',{id:'explicit-label',className:'sr-only'},'Explicit label'),
            React.createElement(SelectCombobox,{'aria-labelledby':'explicit-label'},React.createElement('option',null,'Ready')))));await settle();
        assert.equal(button('Explicit label').textContent,'Ready','aria-labelledby takes precedence over implicit labels');
        await act(async()=>root.render(React.createElement('label',null,'Implicit label',
            React.createElement('span',{id:'explicit-label',className:'sr-only'},'Explicit label'),
            React.createElement(SelectCombobox,{'aria-label':'Direct label','aria-labelledby':'explicit-label'},React.createElement('option',null,'Ready')))));await settle();
        assert.equal(button('Direct label').textContent,'Ready','aria-label takes precedence over aria-labelledby');
        const icon=document.createElement('button');icon.setAttribute('aria-label','Icon action');icon.innerHTML='<svg></svg>';document.body.append(icon);
        for(const type of ['pointerover','focusin']){
            icon.dispatchEvent(new dom.window.Event(type,{bubbles:true}));
            assert.equal(document.querySelector<HTMLElement>('#helm-button-tooltip')!.hidden,false);
            assert.equal(document.querySelector('#helm-button-tooltip')!.textContent,'Icon action');
            icon.dispatchEvent(new dom.window.Event('focusout',{bubbles:true}));
        }
        icon.remove();
        await act(async()=>root.render(React.createElement(Controlled)));await settle();
        assert.equal(document.querySelector('select')!.hidden,true);assert.equal(button('Release channel').textContent,'Stable');
        const trigger=button('Release channel');await click('Release channel');assert.equal(changed.length,0);
        assert.equal(document.activeElement===document.querySelector('[role="combobox"]'),true);
        await enter(await search('development'));await settle();assert.deepEqual(changed,['nightly']);assert.equal(button('Release channel').textContent,'Development');assert.equal(document.activeElement===trigger,true);
        await click('Release channel');await enter(await search('retired'));assert.deepEqual(changed,['nightly'],'disabled options cannot change the value');
        const empty=await search('no match');assert.equal(document.querySelectorAll('[role="option"]').length,0);assert.match(document.body.textContent!,/No matching choices/);
        await act(async()=>empty.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await settle();assert.equal(document.activeElement===trigger,true);
        await click('Release channel');await enter(await search('provider default'));await settle();assert.equal(changed.at(-1),'');assert.equal(button('Release channel').textContent,'Provider default');
        await act(async()=>root.render(React.createElement(Dialog,{open:true},React.createElement(DialogContent,{'aria-describedby':undefined},React.createElement(DialogTitle,null,'Account'),React.createElement('label',null,'Provider',React.createElement(SelectCombobox,{id:'provider'}))))));await settle();
        const binding=document.getElementById('provider') as HTMLSelectElement;
        await act(async()=>{
            const group=dom.window.document.createElement('optgroup');group.label='Subscriptions';
            group.append(new dom.window.Option('Alpha','a'),new dom.window.Option('Beta','b'));
            binding.replaceChildren(group);binding.value='b';
        });await settle();assert.equal(button('Provider').textContent,'Beta');assert.equal(changed.length,2,'controller assignments do not synthesize changes');
        const events:string[]=[];binding.onchange=()=>events.push(binding.value);
        await click('Provider');assert.ok(document.querySelector('[role="dialog"] [role="listbox"]'),'popup remains inside the parent dialog');
        await enter(await search('alpha','Search provider'));await settle();assert.deepEqual(events,['a']);assert.equal(binding.value,'a');assert.equal(button('Provider').textContent,'Alpha');
        await act(async()=>{binding.selectedIndex=1;});await settle();assert.equal(button('Provider').textContent,'Beta');assert.equal(events.length,1);
        await click('Provider');await act(async()=>{binding.disabled=true;});await settle();assert.equal(document.querySelector('[role="listbox"]'),null);assert.equal(button('Provider').disabled,true);
        await act(async()=>{binding.disabled=false;binding.options[0].textContent='Alpha <script>plain text</script>';});await settle();await click('Provider');
        assert.match(document.querySelector('[role="listbox"]')!.textContent!,/Alpha <script>plain text<\/script>/);assert.equal(document.querySelector('script'),null);
        await act(async()=>{binding.replaceChildren();});await settle();assert.match(document.body.textContent!,/No choices available/);
    }finally{
        await act(async()=>root.unmount());await new Promise(resolve=>setTimeout(resolve,10));
        for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
        dom.window.close();
    }
});
