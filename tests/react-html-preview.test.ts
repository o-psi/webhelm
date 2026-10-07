import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import DOMPurify from 'dompurify';
import {HtmlPreview} from '../resources/react/HtmlPreview';
import {threadRows} from '../resources/react/ToolGroup';
import {htmlPublication} from '../resources/react/HtmlPublishedReply';
import {ChatProse} from '../resources/react/ChatProse';
import {Conversation} from '../resources/react/App';
import {prose} from '../resources/react/chat-prose';
import {previewDocument,previewMessage,MAX_PREVIEW_BYTES} from '../resources/react/html-preview-document';

const channel='a'.repeat(32);
const source='<style>button{color:var(--foreground)}</style><button onclick="this.textContent=\'Clicked\'">Click</button>';
const fence=(html:string)=>'```html-preview\n'+html+'\n```';
async function fixture(run:(dom:JSDOM,root:ReturnType<typeof createRoot>,handlers:Set<any>)=>Promise<void>){
    const dom=new JSDOM('<div id="mount"></div>',{url:'https://helm.test/',pretendToBeVisual:true});
    const saved:any={};
    for(const key of ['window','document','getComputedStyle','MutationObserver','requestAnimationFrame']){saved[key]=(globalThis as any)[key];(globalThis as any)[key]=key==='getComputedStyle'?dom.window.getComputedStyle.bind(dom.window):key==='requestAnimationFrame'?(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0):(dom.window as any)[key];}
    Object.defineProperty(dom.window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
    const sanitize=DOMPurify.sanitize;DOMPurify.sanitize=DOMPurify(dom.window as any).sanitize;
    const add=dom.window.addEventListener.bind(dom.window),remove=dom.window.removeEventListener.bind(dom.window),handlers=new Set<any>();
    dom.window.addEventListener=((type:any,handler:any,options:any)=>{if(type==='message')handlers.add(handler);add(type,handler,options);}) as any;
    dom.window.removeEventListener=((type:any,handler:any,options:any)=>{if(type==='message')handlers.delete(handler);remove(type,handler,options);}) as any;
    const root=createRoot(document.querySelector('#mount')!);
    try{await run(dom,root,handlers);}finally{await React.act(async()=>root.unmount());assert.equal(handlers.size,0);Object.assign(globalThis,saved);DOMPurify.sanitize=sanitize;dom.window.close();}
}

test('Markdown never publishes executable HTML, even with html-preview fences',async()=>{
    await fixture(async(dom,root)=>{
        await React.act(async()=>root.render(React.createElement(ChatProse,{text:'**Before**\n\n'+fence(source)+'\n\nAfter \\(x^2\\)'})));
        assert.equal(document.querySelectorAll('iframe').length,0);
        assert.match(document.body.textContent!,/onclick/);
        assert.equal(document.querySelectorAll('.katex').length,1);
    });
});

test('opaque document policy precedes authored scripts and removes navigation metadata and imported contexts',async()=>{
    await fixture(async()=>{
        const html=previewDocument('<meta http-equiv="refresh" content="0;url=https://evil.invalid"><base href="https://evil.invalid"><iframe src="https://evil.invalid"></iframe><script src="https://evil.invalid/x.js"></script><input autofocus>'+source,channel,{foreground:'black'},true);
        assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<script>'));
        assert.doesNotMatch(html,/evil\.invalid|<iframe|http-equiv="refresh"|autofocus/);
        assert.match(html,/connect-src 'none'/);assert.match(html,/frame-src 'none'/);
        assert.match(html,/onclick="this.textContent/);
        assert.throws(()=>previewDocument('x'.repeat(MAX_PREVIEW_BYTES+1),channel,{}),/128 KiB/);
        assert.throws(()=>previewDocument('é'.repeat(MAX_PREVIEW_BYTES),channel,{}),/128 KiB/);
        assert.throws(()=>previewDocument(source,'wrong',{}),/channel/);
        assert.match(previewDocument('<!doctype html><html><body class="mock" data-view="compact"><h2>x</h2></body></html>',channel,{}),/<body class="mock" data-view="compact">/);
    });
});

test('only exact successful explicit tool publications are accepted',()=>{
    const a={id:'11111111-1111-4111-8111-111111111111',sha256:'a'.repeat(64),name:'visual-reply.html',mime_type:'text/html',byte_size:10};
    const entry:any={request:{role:'assistant',message_index:0},call:{id:'call',function:{name:'html_render'}},result:{role:'tool',message_index:1,tool_call_id:'call',tool_success:true,tool_outcome:{execution:'succeeded'},tool_output:{is_error:false,structured_content:{htmlRender:{version:1,artifact:a,title:'Mock',height:320}},content:[{type:'resource',uri:'artifact:'+a.id,mime_type:'text/html',artifact:{...a}}]}}};
    assert.equal(htmlPublication(entry)?.title,'Mock');
    for(const mutate of [(e:any)=>e.call.function.name='shell',(e:any)=>e.result.tool_call_id='foreign',(e:any)=>e.result.tool_success=false,(e:any)=>e.result.projection_truncated=true,(e:any)=>e.result.tool_outcome.incomplete='output_limit',(e:any)=>e.result.tool_output.content[0].artifact.sha256='b'.repeat(64),(e:any)=>e.result.tool_output.structured_content.htmlRender.artifact.mime_type='image/png']){
        const invalid=structuredClone(entry);mutate(invalid);assert.equal(htmlPublication(invalid),null);
    }
});
test('explicit publication is interactive immediately, has only expansion and releases its listener',async()=>{
    await fixture(async(dom,root,handlers)=>{
        await React.act(async()=>root.render(React.createElement(HtmlPreview,{source,identity:'a',title:'Mock'})));
        assert.equal(document.querySelector('iframe')?.getAttribute('sandbox'),'allow-scripts');
        assert.equal(document.querySelectorAll('button').length,1);
        assert.equal(document.querySelector('button')?.textContent,'Expand');
        assert.equal(handlers.size,1);
        await React.act(async()=>root.render(React.createElement('div',null,'Another conversation')));
        assert.equal(document.querySelectorAll('iframe').length,0);assert.equal(handlers.size,0);
    });
});

test('artifact transfer rejects changed metadata, digest, continuation and authority',async()=>{
    const {htmlArtifactBytes}=await import('../resources/js/html-artifacts.js');
    const bytes=new TextEncoder().encode('<button>Mock</button>');
    const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    const a={id:'11111111-1111-4111-8111-111111111111',sha256,name:'visual-reply.html',mime_type:'text/html',byte_size:bytes.length};
    const response=()=>({session_id:'s',incarnation:'i',result:{metadata:{...a},offset:0,next_offset:bytes.length,eof:true,data_base64:btoa(String.fromCharCode(...bytes))}});
    const options={session_id:'s',assertCurrent:()=>{}};
    const client={exchange:async()=>({protocol:1,outcome_unknown:false,result:response()})};
    assert.equal(await htmlArtifactBytes(client,a,options),'<button>Mock</button>');
    for(const mutate of [(r:any)=>r.result.metadata.sha256='b'.repeat(64),(r:any)=>r.result.next_offset=0,(r:any)=>r.result.data_base64=btoa('x'.repeat(bytes.length)),(r:any)=>r.session_id='foreign']){
        await assert.rejects(htmlArtifactBytes({exchange:async()=>{const r=response();mutate(r);return {protocol:1,outcome_unknown:false,result:r};}},a,options));
    }
    let checks=0;await assert.rejects(htmlArtifactBytes(client,a,{...options,assertCurrent:()=>{if(++checks>=2)throw Error('revoked');}}),/revoked/);
});

test('large canonical render arguments use complete call summaries, never incomplete or ambiguous ones',()=>{
    const a={id:'11111111-1111-4111-8111-111111111111',sha256:'a'.repeat(64),name:'visual-reply.html',mime_type:'text/html',byte_size:65536};
    const messages:any[]=[{role:'assistant',message_index:0,content:'',projection_truncated:true,tool_calls_omitted:true,tool_call_summaries_complete:true,tool_call_summaries:[{id:'call',name:'html_render'}]}, {role:'tool',message_index:1,tool_call_id:'call',tool_success:true,tool_outcome:{execution:'succeeded'},tool_output:{is_error:false,structured_content:{htmlRender:{version:1,artifact:a,title:'Mock',height:320}},content:[{type:'resource',uri:'artifact:'+a.id,mime_type:'text/html',artifact:{...a}}]}}];
    const entry=threadRows(messages).flatMap(row=>row.entries||[])[0];assert.equal(htmlPublication(entry)?.title,'Mock');
    const duplicate=threadRows([...messages,{...messages[0],message_index:2}]).flatMap(row=>row.entries||[]);assert.ok(duplicate.every(entry=>htmlPublication(entry)===null));
    const incomplete=structuredClone(messages);incomplete[0].tool_call_summaries_complete=false;assert.ok(threadRows(incomplete).flatMap(row=>row.entries||[]).every(entry=>htmlPublication(entry)===null));
});
