import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {disclosureOpen,saveDisclosure,maxDisclosures} from '../resources/react/activity-disclosures.ts';
import {threadRows,ToolGroup,activitySummary,toolRunActive} from '../resources/react/ToolGroup.tsx';
const messages=Array.from({length:5},(_,i)=>[{role:'assistant',message_index:i*2,content:'',tool_calls:[{id:`call-${i}`,function:{name:'shell',arguments:`command-${i}`}}]},{role:'tool',message_index:i*2+1,tool_call_id:`call-${i}`,content:`result-${i}`}]).flat();
test('tool calls and results become one group with no duplicate result messages',()=>{
 const rows=threadRows(messages);assert.equal(rows.length,1);assert.equal(rows[0].entries?.length,5);assert.equal(rows[0].entries?.[0].result.content,'result-0');
 const split=threadRows([...messages,{role:'assistant',message_index:10,content:'Explanation',tool_calls:[{id:'final'}]},{role:'tool',message_index:11,tool_call_id:'final',content:'Done'}]);assert.equal(split.length,3);assert.equal(split[1].message.content,'Explanation');assert.equal(split[2].entries?.length,1);
});
test('activity summary hides action details until expansion and preserves an open detail on rerender',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://example.test'});const previous={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),requestAnimationFrame:(callback:FrameRequestCallback)=>setTimeout(()=>callback(Date.now()),0),cancelAnimationFrame:clearTimeout});
 const {createRoot}=await import('react-dom/client');const root=createRoot(document.querySelector('#root')!);const entries=threadRows(messages)[0].entries!;
 entries[4].call={...entries[4].call,function:{name:'shell',arguments:JSON.stringify({command:'first line\nsecond line\nthird line'})}};
 const render=()=>React.createElement(ToolGroup,{scope:{tenant:'tenant',vessel:'vessel',session:'session'},groupKey:'tools:0',entries,running:false,messageStart:0,decisions:false,renderMessage:(message:any)=>React.createElement('pre',null,message.content)});
 try{
  await React.act(async()=>root.render(render()));assert.equal(document.querySelectorAll('[data-tool-id]').length,0);assert.match(document.querySelector('.tool-group-heading')!.textContent!,/5 commands.*5 returned/);assert.doesNotMatch(document.body.textContent!,/result-4|command-4/);
  await React.act(async()=>{document.querySelector<HTMLButtonElement>('.tool-group-heading')!.click();});assert.equal(document.querySelectorAll('[data-tool-id]').length,5);
  const detail=document.querySelector<HTMLElement>('[data-tool-id="call-4"]')!;
  await React.act(async()=>{detail.querySelector<HTMLButtonElement>('button')!.click();});assert.match(detail.textContent!,/result-4/);assert.match(detail.querySelector('.tool-summary-text')!.textContent!,/first line\nsecond line\nthird line/);
  await React.act(async()=>root.render(render()));assert.equal(detail.getAttribute('data-state'),'open');
  await React.act(async()=>{document.querySelector<HTMLButtonElement>('.tool-group-heading')!.click();});assert.equal(document.querySelectorAll('[data-tool-id]').length,0);
  await React.act(async()=>{document.querySelector<HTMLButtonElement>('.tool-group-heading')!.click();});assert.equal(document.querySelectorAll('[data-tool-id]').length,5);
  const reopened=document.querySelector<HTMLElement>('[data-tool-id="call-4"]')!;assert.equal(reopened.getAttribute('data-state'),'open');
  await React.act(async()=>root.render(null));await React.act(async()=>root.render(render()));assert.equal(document.querySelector('[data-tool-id="call-4"]')!.getAttribute('data-state'),'open');
  assert.match(document.querySelector('[data-tool-id="call-4"]')!.textContent!,/result-4/);
 }finally{await React.act(async()=>root.unmount());Object.assign(globalThis,previous);dom.window.close();}
});


test('tool summary clamps to two lines only while collapsed',async()=>{
 const {readFileSync}=await import('node:fs');
 const css=readFileSync(new URL('../resources/react/style.css',import.meta.url),'utf8');
 assert.match(css,/\.tool-entry\[data-state="closed"\] \.tool-trigger>\.tool-summary-text\{[^}]*-webkit-line-clamp:2;[^}]*max-height:3em;[^}]*overflow:hidden/);
 assert.match(css,/\.tool-summary-text\{[^}]*overflow-wrap:anywhere;[^}]*line-height:1\.5/);
});


test('activity distinguishes action failures and unconfirmed results from the run, with honest summed timing',()=>{
 const entry=(status:any,elapsed:number)=>({key:'x',call:{function:{name:'list_directory'}},result:{tool_outcome:{execution:status,elapsed_ms:elapsed},tool_success:true}});
 const summary=activitySummary([entry('completed',1200),entry('policy_refused',50),{key:'pending',call:{function:{name:'read_file'}},request:{message_index:0}}],false,5,false);
 assert.equal(summary.kinds,'2 directory listings · 1 file read');
 assert.equal(summary.outcomes,'1 returned · 1 unsuccessful action · 1 unconfirmed');
 assert.equal(summary.timing,'1.2 s tool time (partial)');
 assert.equal(summary.failed,1);
});

 test('disclosures are bounded, identity isolated, content free and fail safe',()=>{
 const dom=new JSDOM('',{url:'https://example.test'});const previous=globalThis.window;globalThis.window=dom.window as any;
 const scope={tenant:'t',vessel:'v',session:'s'};
 try {
  saveDisclosure(scope,'entry:call',true);assert.equal(disclosureOpen(scope,'entry:call'),true);
  for(const field of ['tenant','vessel','session'])assert.equal(disclosureOpen({...scope,[field]:'other'},'entry:call'),false);
  saveDisclosure(scope,'entry:call',false);assert.equal(disclosureOpen(scope,'entry:call'),false);
  for(let i=0;i<maxDisclosures+5;i++)saveDisclosure(scope,`group:${i}`,true);
  const raw=dom.window.localStorage.getItem('helmweb.activity-disclosures.v1')!;
  const stored=JSON.parse(raw);assert.equal(stored.length,maxDisclosures);assert.ok(stored.every((entry:any)=>entry.length===2&&typeof entry[0]==='string'&&typeof entry[1]==='boolean'));
  assert.equal(disclosureOpen(scope,'group:0'),false);
  dom.window.localStorage.setItem('helmweb.activity-disclosures.v1','broken');assert.equal(disclosureOpen(scope,'group:1'),false);
  Object.defineProperty(dom.window,'localStorage',{get(){throw Error('unavailable');}});
  assert.doesNotThrow(()=>saveDisclosure(scope,'group:1',true));assert.equal(disclosureOpen(scope,'group:1'),false);
 }finally{globalThis.window=previous;dom.window.close();}
 });
 test('process plural and summary warning color are scoped to unsuccessful outcomes',async()=>{
 const summary=activitySummary([{key:'a',call:{name:'process'}},{key:'b',call:{name:'process'}}],false,0,false);
 assert.equal(summary.kinds,'2 processes');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const html=renderToStaticMarkup(React.createElement(ToolGroup,{entries:[{key:'a',call:{name:'process'},result:{tool_outcome:{execution:'completed'},tool_success:true}},{key:'b',call:{name:'process'},result:{tool_outcome:{execution:'policy_refused'},tool_success:false}}],running:false,messageStart:0,decisions:false,renderMessage:()=>null}));
 assert.match(html,/<span>1 returned<\/span>/);assert.match(html,/<span class="text-destructive">1 unsuccessful action<\/span>/);
 assert.match(html,/flex-wrap/);assert.match(html,/max-w-\[45%\]/);assert.doesNotMatch(html,/flex-1 truncate/);
 });

 test('tool activity follows saved active lifecycle without claiming completed or idle work is pending',()=>{
 const entry={key:'call',call:{name:'read_file'},request:{message_index:5}};
 for(const state of ['accepted','running','awaiting_decision','cancel_requested','starting','cancelling']){
  assert.equal(toolRunActive(state),true,state);
  assert.equal(activitySummary([entry],toolRunActive(state),5,state==='awaiting_decision').outcomes,'1 pending',state);
 }
 for(const state of ['idle','failed','completed','cancelled','interrupted',undefined]){
  assert.equal(toolRunActive(state),false,String(state));
  assert.equal(activitySummary([entry],toolRunActive(state),5,true).outcomes,'1 unconfirmed',String(state));
 }
 });
 test('approval pending reason survives disclosure while controls remain outside collapsed groups',async()=>{
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {actionStatus}=await import('../resources/js/tool-presentation.js');
 const entry={key:'approval',call:{name:'read_file'},request:{message_index:5}};
 assert.equal(actionStatus(entry.call,undefined,toolRunActive('awaiting_decision'),true),'Awaiting approval');
 const html=renderToStaticMarkup(React.createElement(ToolGroup,{entries:[entry],running:toolRunActive('awaiting_decision'),messageStart:5,decisions:true,renderMessage:()=>null}));
 assert.match(html,/1 pending/);assert.match(html,/aria-expanded="false"/);assert.doesNotMatch(html,/data-tool-id/);
 const {readFileSync}=await import('node:fs');const app=readFileSync(new URL('../resources/react/App.tsx',import.meta.url),'utf8');
 assert.match(app,/running=\{toolRunActive\(run\?\.state\)\}/);
 assert.ok(app.indexOf('<Decision')>app.indexOf('<ToolGroup'),'decision controls remain outside tool renderer');
 });
