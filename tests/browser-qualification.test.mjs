import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {installQualificationForm} from '../resources/js/browser-qualification.js';

test('fixed coordination helper adverse contracts stay offline and bounded',{timeout:20000},()=>{
 const result=spawnSync('/usr/bin/python3',['tests/browser-qualification-helper.py'],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:15000,maxBuffer:65536});
 assert.equal(result.status,0,result.stdout+result.stderr);assert.match(result.stderr,/OK/);
});
function fixture(fetch){
 const dom=new JSDOM('<meta name="csrf-token" content="synthetic-csrf"><main id="browser-qualification" data-request-url="/fixed/request" data-response-url="/fixed/response"><button id="qualification-refresh"></button><pre id="qualification-request"></pre><form id="qualification-form"><textarea id="qualification-response"></textarea><button id="qualification-submit"></button></form><p id="qualification-status"></p></main>');
 const root=dom.window.document.querySelector('main');installQualificationForm(root,{fetch});
 return {dom,root,refresh:()=>root.querySelector('#qualification-refresh').click(),input:root.querySelector('textarea'),submit:()=>root.querySelector('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true})),status:()=>root.querySelector('#qualification-status').textContent,button:root.querySelector('#qualification-submit')};
}
const issued={id:'11111111-2222-4333-8444-555555555555',digest:'a'.repeat(64)};
const response={schema:1,...issued,status:'observed',result:{counter_matches:true,no_input_sent:true}};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('coordinator makes no automatic requests and uses normal same-origin CSRF once',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.endsWith('/request')?{request:issued,answered:[]}:{accepted:true}};});
 try{
  assert.equal(calls.length,0);assert.equal(f.button.disabled,true);f.refresh();await settle();
  f.input.value=JSON.stringify(response);f.submit();f.submit();await settle();
  assert.equal(calls.length,2);assert.equal(calls[1].options.credentials,'same-origin');assert.equal(calls[1].options.headers['X-CSRF-TOKEN'],'synthetic-csrf');assert.deepEqual(JSON.parse(calls[1].options.body),{response});
  assert.match(f.status(),/queued once/);assert.equal(f.input.value,'');assert.equal(f.button.disabled,true);
  f.refresh();await settle();assert.equal(f.button.disabled,true);f.input.value=JSON.stringify(response);f.submit();await settle();assert.equal(calls.length,3);
 }finally{f.dom.window.close();}
});
test('malformed, wrong identity or oversize response never sends and uncertainty never retries',async()=>{
 const calls=[];const f=fixture(async(url,options)=>{calls.push({url,options});if(url.endsWith('/response'))throw Error('synthetic transport failure');return {ok:true,json:async()=>({request:issued})};});
 try{
  f.refresh();await settle();
  for(const value of ['invalid','null',JSON.stringify({...response,id:'wrong'}),JSON.stringify({...response,result:{unexpected:'x'.repeat(65536)}})]){
   f.input.value=value;f.submit();await settle();assert.equal(calls.length,1);
  }
  f.input.value=JSON.stringify(response);f.submit();await settle();assert.match(f.status(),/unconfirmed or refused/);
  f.submit();await settle();assert.equal(calls.length,2);
  f.refresh();await settle();assert.equal(f.button.disabled,true);f.submit();await settle();assert.equal(calls.length,3);
 }finally{f.dom.window.close();}
});
