import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import {defaultGoalLimits} from '../resources/react/goals';

test('mounted inline goal preserves replacement consent, stale refusal, limits and separate lifecycle authorization',async()=>{
 const dom=new JSDOM('<main id="root"></main>');
 const names=['window','document','IS_REACT_ACT_ENVIRONMENT','HTMLElement','HTMLInputElement','Node','Element','Event'];
 const saved=names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)] as const);
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,HTMLElement:dom.window.HTMLElement,HTMLInputElement:dom.window.HTMLInputElement,Node:dom.window.Node,Element:dom.window.Element,Event:dom.window.Event});
 const {createRoot}=await import('react-dom/client');const {InlineGoalControls}=await import('../resources/react/InlineGoalControls');
 const root=createRoot(document.getElementById('root')!);let effects=0;
 const goal={id:'g',objective:'<script>private</script>',status:'paused',limits:defaultGoalLimits,usage:{runs:1,input_tokens:0,output_tokens:0,elapsed_ms:0,no_progress_runs:0,unmeasured_runs:0}};
 try{
  await act(async()=>root.render(React.createElement(InlineGoalControls,{objective:'Replacement',current:goal,onApply:async()=>{throw Error('Goal changed since review');},onAction:async()=>{effects++;},onClose(){}})));
  const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent===text)!;
  assert.equal(document.querySelector('[role=dialog]'),null);assert.equal(document.querySelector('script'),null);
  assert.equal(button('Save paused goal').disabled,true);assert.equal(button('resume goal').disabled,true);assert.equal(button('clear goal').disabled,true);
  const checks=[...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
  await act(async()=>checks.at(-1)!.click());assert.equal(button('Save paused goal').disabled,false);assert.equal(button('resume goal').disabled,true);assert.equal(button('clear goal').disabled,true);
  await act(async()=>button('Save paused goal').click());assert.match(document.querySelector('[role=alert]')!.textContent!,/changed since review/);assert.match(document.body.textContent!,/Replacement/);assert.equal(effects,0);
  await act(async()=>checks[0].click());assert.equal(button('clear goal').disabled,false);assert.equal(button('resume goal').disabled,true);
  await act(async()=>root.render(React.createElement(InlineGoalControls,{current:goal,onApply:async()=>{},onAction:async()=>{effects++;},onClose(){}})));
  assert.equal(document.querySelectorAll('input[type=checkbox]').length,0);assert.equal(button('resume goal'),undefined);
  await act(async()=>button('Manage goal').click());
  assert.equal(document.querySelectorAll('input[type=checkbox]').length,3);assert.equal(button('resume goal').disabled,true);assert.equal(effects,0);

 }finally{await act(async()=>root.unmount());dom.window.close();for(const [name,d] of saved){if(d)Object.defineProperty(globalThis,name,d);else Reflect.deleteProperty(globalThis,name);}}
});
