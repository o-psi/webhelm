import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {SignoutDeparture} from '../resources/react/signout-departure';

// Model requestSubmit's validation, actual cancelable submit dispatch, then
// default navigation. No jsdom unimplemented navigation or listener reordering.
function nativeSubmit(form:HTMLFormElement,win:any,navigate:()=>void){
 return ()=>{if(!form.checkValidity())return;const event=new win.Event('submit',{bubbles:true,cancelable:true});if(form.dispatchEvent(event))navigate();};
}
test('native default departure follows submit dispatch; cancellation never grants consent',()=>{
 const dom=new JSDOM('<form><input required></form>'),form=dom.window.document.querySelector('form')!,departure=new SignoutDeparture();
 let warnings=0;form.requestSubmit=nativeSubmit(form,dom.window,()=>{const event=new dom.window.Event('beforeunload');if(!departure.permits(event))warnings++;assert.equal(departure.permits(event),true);});
 departure.submit(form);assert.equal(departure.permits(new dom.window.Event('beforeunload')),false);
 form.querySelector('input')!.value='valid';const cancel=(event:Event)=>event.preventDefault();form.addEventListener('submit',cancel);
 departure.submit(form);assert.equal(departure.permits(new dom.window.Event('beforeunload')),false);form.removeEventListener('submit',cancel);
 departure.submit(form);assert.equal(warnings,0);assert.equal(departure.permits(new dom.window.Event('beforeunload')),false);departure.reset();dom.window.close();
});

test('rendered App and New signout review retains content and rearms both real departure guards',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://helm.test',pretendToBeVisual:true});
 Object.defineProperty(dom.window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
 const globals:Record<string,unknown>={window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,location:dom.window.location,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)};
 for(const name of ['Node','NodeFilter','Element','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','HTMLButtonElement','Event','KeyboardEvent','MouseEvent','CustomEvent','MutationObserver','ShadowRoot'])globals[name]=(dom.window as any)[name];
 const previous=new Map(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value]of Object.entries(globals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 const {createRoot}=await import('react-dom/client'),{App}=await import('../resources/react/App');
 const {Workspace}=await import('../resources/react/workspace');
 const originalOpen=Workspace.prototype.open;let existing:any;
 Workspace.prototype.open=function(...args:any[]){existing=this;return originalOpen.apply(this,args as [string,string,string]);};
 const {VesselFleet}=await import('../resources/js/vessel-fleet.js');const originalStart=VesselFleet.prototype.start;
 VesselFleet.prototype.start=function(){const connection=this.connections.get('11111111-1111-4111-8111-111111111111');connection.voyages=[{session_id:'22222222-2222-4222-8222-222222222222',name:'Existing voyage'}];connection.client={exchange:async({command}:any)=>({protocol:1,outcome_unknown:false,result:command.op==='capabilities'?{scope:'owner'}:{session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:command.op==='snapshot'?{session_id:'22222222-2222-4222-8222-222222222222',revision:1,messages:[],run:{state:'idle'}}:[]}}),subscribe:()=>()=>{}};this.changed();};
 const {BrowserDrafts}=await import('../resources/react/drafts');const repository=new BrowserDrafts('signout');
 await repository.write('new-voyage',null,{text:'New unsent',pictures:[]});
 // Capture the constructed Workspace through its public open method when needed
 // using getVersion is not possible for instance fields. Render New first; real
 // Existing guard is registered by App independently of tab presence.
 const root=createRoot(dom.window.document.querySelector('#root')!);
 const listeners=new Set<EventListenerOrEventListenerObject>();
 const originalAdd=dom.window.addEventListener.bind(dom.window);
 dom.window.addEventListener=((type:any,listener:any,options:any)=>{if(type==='beforeunload')listeners.add(listener);originalAdd(type,listener,options);}) as any;
 const originalRemove=dom.window.removeEventListener.bind(dom.window);
 dom.window.removeEventListener=((type:any,listener:any,options:any)=>{if(type==='beforeunload')listeners.delete(listener);originalRemove(type,listener,options);}) as any;
 const unload=()=>{const event=new dom.window.Event('beforeunload',{cancelable:true});dom.window.dispatchEvent(event);return event.defaultPrevented;};
 const click=async(label:string)=>{const button=[...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent?.trim()===label||node.getAttribute('aria-label')===label);assert.ok(button,label);await act(async()=>{if(label==='Account and appearance'){button.focus();button.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,20));}else button.click();});};
 const review=async()=>{await click('Account and appearance');const menu=[...dom.window.document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node=>node.textContent?.trim()==='Sign out');assert.ok(menu);await act(async()=>menu.click());};
 try{
  await act(async()=>{root.render(React.createElement(App,{bootstrap:{tenantId:'signout',vessels:[{id:'11111111-1111-4111-8111-111111111111',name:'Fixture'}],ticketUrl:'/ticket',connectionsUrl:'/connections',logoutUrl:'/logout'},draftRepository:repository}));await new Promise(resolve=>setTimeout(resolve,20));});
  assert.equal(listeners.size,2,'actual App and New guards registered');
  const voyage=[...dom.window.document.querySelectorAll<HTMLButtonElement>('button.voyage-card')].find(node=>node.textContent?.includes('Existing voyage'));assert.ok(voyage);await act(async()=>voyage.click());await act(async()=>{await existing.restoreDraft(JSON.stringify(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']));existing.draft(JSON.stringify(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']),'Existing unsent');});
  const text=()=>dom.window.document.querySelector<HTMLTextAreaElement>('.new-voyage textarea')!.value;
  assert.equal(text(),'New unsent');assert.equal(existing.tabs.get(JSON.stringify(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'])).draft,'Existing unsent');assert.equal(unload(),true);
  await review();await click('Keep working');assert.equal(text(),'New unsent');assert.equal(unload(),true);
  await review();await act(async()=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(text(),'New unsent');assert.equal(unload(),true);
  const form=dom.window.document.querySelector<HTMLFormElement>('form[action="/logout"]')!;
  let duplicate=true;form.requestSubmit=nativeSubmit(form,dom.window,()=>{duplicate=unload();});
  await review();await click('Sign out');assert.equal(duplicate,false);assert.equal(text(),'New unsent');assert.equal(unload(),true);
  const cancel=(event:Event)=>event.preventDefault();form.addEventListener('submit',cancel);await click('Sign out');assert.equal(unload(),true);form.removeEventListener('submit',cancel);
  const required=dom.window.document.createElement('input');required.required=true;form.append(required);await click('Sign out');assert.equal(unload(),true);required.remove();
  // Throw handling is exercised directly at the native submission boundary; React
  // reports event-handler errors globally, so avoid manufacturing ignored errors.
  const departure=new SignoutDeparture();form.requestSubmit=()=>{throw Error('failed');};assert.throws(()=>departure.submit(form),/failed/);assert.equal(departure.permits(new dom.window.Event('beforeunload')),false);
  form.requestSubmit=nativeSubmit(form,dom.window,()=>{});await click('Sign out');await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(unload(),true);assert.equal(text(),'New unsent');
 }finally{Workspace.prototype.open=originalOpen;VesselFleet.prototype.start=originalStart;await act(async()=>root.unmount());await new Promise(resolve=>setTimeout(resolve,50));for(const [key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}dom.window.close();}
});
