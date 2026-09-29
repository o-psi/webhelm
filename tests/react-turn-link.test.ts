import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {JSDOM} from 'jsdom';
import {createRoot} from 'react-dom/client';
import {TurnLink,turnHash,linkedTurn} from '../resources/react/TurnLink.tsx';
const session='22222222-2222-4222-8222-222222222222',vessel='11111111-1111-4111-8111-111111111111';
test('message link preserves route/index/revision without content and rejects other sessions and malformed indices',()=>{
 const hash=turnHash(vessel,session,40,12);
 assert.deepEqual(linkedTurn(hash,vessel,session),{index:40,revision:12});
 assert.equal(linkedTurn(hash,session,session),null);
 assert.equal(linkedTurn(`#turn-${vessel}-${session}-9007199254740992-r12`,session),null);
 assert.throws(()=>turnHash(vessel,session,-1,12));
});
test('message link copies only on explicit action and reports clipboard failure',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/'});
 const saved={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
 const copied:string[]=[];
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async(text:string)=>{copied.push(text);}}}});
 const root=createRoot(document.querySelector('#root')!);
 try{
  await React.act(async()=>root.render(React.createElement(TurnLink,{tab:{vessel,session,snapshot:{revision:12}} as any,message:{message_index:40,content:'private fixture text'}})));
  assert.equal(copied.length,0);
  await React.act(async()=>document.querySelector<HTMLButtonElement>('button')!.click());
  assert.deepEqual(copied,[`https://fixture.invalid/voyages/${vessel}/${session}${turnHash(vessel,session,40,12)}`]);
  assert.match(document.body.textContent!,/Message link copied/);
  (navigator as any).clipboard.writeText=async()=>{throw Error('denied');};
  await React.act(async()=>document.querySelector<HTMLButtonElement>('button')!.click());
  assert.match(document.body.textContent!,/could not be copied/);
 }finally{await React.act(async()=>root.unmount());Object.assign(globalThis,{window:saved.window,document:saved.document});Object.defineProperty(globalThis,'navigator',{configurable:true,value:saved.navigator});dom.window.close();}
});
