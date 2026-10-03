import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
test('profiles editor saves, duplicates, defaults and deletes without mutating voyage settings',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://helm.test'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout,MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,HTMLInputElement:dom.window.HTMLInputElement,HTMLTextAreaElement:dom.window.HTMLTextAreaElement,HTMLSelectElement:dom.window.HTMLSelectElement,Element:dom.window.Element,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent});
 dom.window.HTMLDialogElement.prototype.showModal=function(){};dom.window.HTMLDialogElement.prototype.close=function(){};
 const binding={account_id:'a',connection_id:'p',identity_generation:1,connection_revision:1,transport:'openai_responses'};
 let catalogue:any={revision:1,can_manage:true,default_profile_id:'first',profiles:[{id:'first',name:'Everyday',account:binding,model:'m',reasoning_effort:'high',service_tier:null}]};const commands:any[]=[];
 const connection:any={id:'c',name:'Vessel',vessel_id:'v',voyages:[],client:{async exchange({command}:any){commands.push(command);let result:any;
 switch(command.op){case 'capabilities':result={vessel_id:'v',scope:'owner',features:['execution_profiles'],workspaces:[{path:'/work',name:'Work'}]};break;case 'accounts':result={accounts:[{id:'a',connection_id:'p',identity_generation:1,label:'Work',state:'ready',availability:'available'}],connections:[{id:'p',revision:1,label:'Provider',transports:['openai_responses']},{id:'chat',label:'ChatGPT',transports:['chatgpt_oauth'],endpoint:'https://chatgpt.com/backend-api/codex'},{id:'grok',label:'SuperGrok',transports:['xai_oauth'],endpoint:'https://api.x.ai/v1'}]};break;case 'profiles':result=structuredClone(catalogue);break;case 'account_models':result={account:binding,models:[{id:'m',is_default:true,reasoning_efforts:['high'],service_tiers:[]}]};break;case 'save_profile':assert.equal(command.expected_revision,catalogue.revision);catalogue.profiles=[...catalogue.profiles.filter((p:any)=>p.id!==command.profile.id),command.profile];catalogue.revision++;result=structuredClone(catalogue);break;case 'set_default_profile':catalogue.default_profile_id=command.profile_id;catalogue.revision++;result=structuredClone(catalogue);break;case 'delete_profile':catalogue.profiles=catalogue.profiles.filter((p:any)=>p.id!==command.profile_id);catalogue.revision++;result=structuredClone(catalogue);break;default:throw new Error(command.op);}return {protocol:1,outcome_unknown:false,error:null,result};}}};
 const {Settings}=await import('../resources/react/Settings');
 const root=createRoot(document.getElementById('root')!);const click=async(label:string)=>{const button=[...document.querySelectorAll('button')].find(b=>(b.getAttribute('aria-label')||b.textContent)===label)!;assert.ok(button,label);await act(async()=>{button.click();});};
 try{await act(async()=>root.render(React.createElement(Settings,{fleet:{connections:new Map([['wrong',{id:'wrong',name:'Wrong Vessel',client:{exchange(){assert.fail('must not query the first Vessel');}}}],['c',connection]])},location:{vessel:'c',workspace:'/chosen'},workspace:{} as any,tenant:'test',onClose(){},onCreated(){}})));
 assert.equal([...document.querySelectorAll('label')].some(label=>label.textContent?.startsWith('Model')),false);
 assert.equal(commands.filter(command=>command.op==='account_models').length,0,'choosing a saved profile does not discover models');
 await act(async()=>[...document.querySelectorAll<HTMLButtonElement>('.setup-row')].find(button=>button.querySelector('strong')?.textContent==='Profile')!.click());
 const action=async(name:string,label:string)=>{await act(async()=>{const trigger=document.querySelector<HTMLButtonElement>(`[aria-label="Actions for ${name}"]`)!;trigger.dispatchEvent(new dom.window.MouseEvent('pointerdown',{bubbles:true,button:0}));});const menu=document.querySelector(`[role="menu"][aria-label="Actions for ${name}"]`)!;await act(async()=>[...menu.querySelectorAll('button')].find(button=>button.textContent===label)!.click());};
 assert.ok(document.querySelector('header [aria-label="Create profile"]'),'create stays in the fixed header');
 await action('Everyday','Duplicate');assert.match(document.body.textContent!,/Reasoning & service/);await click('Save profile');assert.equal(catalogue.profiles.length,2);assert.equal(catalogue.profiles[1].name,'Everyday copy');
 await action('Everyday','Edit');assert.equal(document.querySelector<HTMLInputElement>('input')!.value,'Everyday','editing a row targets that row, not the selected duplicate');await click('Cancel profile edit');
 await action('Everyday copy','Make default');assert.equal(catalogue.default_profile_id,catalogue.profiles[1].id);
 await action('Everyday','Delete');assert.match(document.body.textContent!,/Delete Everyday\?/);assert.equal(catalogue.profiles.length,2,'delete requires its confirmation screen');await click('Delete profile');assert.equal(catalogue.profiles.length,1);assert.equal(catalogue.profiles[0].name,'Everyday copy','deletion targets the menu row, not the selected default');
 await click('Create profile');assert.equal(document.querySelector<HTMLInputElement>('input')!.value,'');
 await act(async()=>document.querySelector<HTMLButtonElement>('.setup-row')!.click());
 await click('Add subscription account');
 assert.equal(document.querySelector('#profile-setup-title')!.textContent,'Connect ChatGPT (experimental)',document.querySelector('#enrollment-status')?.textContent||'');
 const provider=document.querySelector<HTMLSelectElement>('#enrollment-provider')!;
 await act(async()=>{provider.value='grok';provider.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(document.querySelector('#profile-setup-title')!.textContent,'Connect SuperGrok');
 const dialog=document.querySelector('[role="dialog"]')!;
 assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent,'Connect SuperGrok');
 assert.equal(document.querySelector('#enrollment-start')!.textContent,'Continue with SuperGrok');
 await act(async()=>{provider.value='chat';provider.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 assert.equal(document.querySelector('#profile-setup-title')!.textContent,'Connect ChatGPT (experimental)');
 assert.equal(commands.some(c=>c.op==='set_account_inference'||c.op==='start_account'||c.op==='enroll_account'),false);
 assert.ok(commands.filter(c=>c.workspace).every(c=>c.workspace==='/chosen'),'all profile/account reads and writes retain the selected workspace');

 }finally{await act(async()=>root.unmount());dom.window.close();}
});

test('old Vessel settings direct maintenance to Manage Vessels without requesting unsupported profiles',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://helm.test'});Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout,MutationObserver:dom.window.MutationObserver,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,NodeFilter:dom.window.NodeFilter,HTMLInputElement:dom.window.HTMLInputElement,HTMLTextAreaElement:dom.window.HTMLTextAreaElement,HTMLSelectElement:dom.window.HTMLSelectElement,Element:dom.window.Element,ShadowRoot:dom.window.ShadowRoot,Event:dom.window.Event,CustomEvent:dom.window.CustomEvent});
 dom.window.HTMLDialogElement.prototype.showModal=function(){};dom.window.HTMLDialogElement.prototype.close=function(){};
 const commands:string[]=[];
 const connection:any={id:'old',name:'Old Vessel',vessel_id:'v',client:{async exchange({command}:any){commands.push(command.op);return {protocol:1,outcome_unknown:false,error:null,result:{vessel_id:'v',scope:'owner',version:'1.0.0',features:[],workspaces:[]}};}}};
 const {Settings}=await import('../resources/react/Settings');
 const root=createRoot(document.getElementById('root')!);
 const props={fleet:{connections:new Map([['old',connection]])},workspace:{} as any,tenant:'test',onClose(){},onCreated(){assert.fail('No voyage should be created');}};
 try{await act(async()=>root.render(React.createElement(Settings,props)));
 assert.deepEqual(commands,['capabilities']);assert.match(document.body.textContent!,/Open Manage Vessels to review maintenance/);
 assert.equal(document.querySelector('#update-source'),null);
 assert.equal(document.body.textContent!.includes('Vessel maintenance'),false);
 await act(async()=>document.querySelector<HTMLButtonElement>('.setup-row')!.click());
 const workspace=document.querySelector<HTMLInputElement>('input[placeholder="Existing absolute folder on this Vessel"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(workspace,'/work');workspace.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 connection.client={...connection.client};
 await act(async()=>root.render(React.createElement(Settings,props)));
 assert.deepEqual(commands,['capabilities','capabilities'],'reconnection does not send unsupported profile or account reads');
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
