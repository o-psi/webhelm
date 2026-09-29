// Built production React + real Chromium, synthetic bounded public-v2 transport.
// No provider, production tenant, or external website. Installs nothing.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.env.CONVERSATION_OUTPUT||`${root}/target/browser-conversation`);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||`${root}/node_modules/playwright-core/index.mjs`).href);
const build=`${root}/public/build`,manifest=JSON.parse(await readFile(`${build}/manifest.json`,'utf8')),entry=manifest['resources/react/main.tsx'];
const vessel='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222';
const bootstrap={tenantId:'conversation-fixture',vessels:[{id:vessel,vessel_id:'v',name:'Fixture Vessel'}],ticketUrl:'/console/ticket',connectionsUrl:'/connections',logoutUrl:'/console/logout'};
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${entry.css.map(css=>`<link rel="stylesheet" href="/build/${css}">`).join('')}</head><body><div id="helm-react" data-bootstrap='${JSON.stringify(bootstrap)}'></div><script type="module" src="/build/${entry.file}"></script></body></html>`;
const server=createServer(async(req,res)=>{
    try{
        if(req.url.startsWith('/voyages/')){res.setHeader('Content-Type','text/html');res.end(html);return;}
        if(req.url==='/console/ticket'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:'wss://fixture.invalid/v1/vessel/browser-socket',vessel_id:'v',token:'a'.repeat(64),expires_at_ms:Date.now()+120000}));return;}
        const path=resolve(build,`.${new URL(req.url,'http://fixture').pathname.replace(/^\/build/,'')}`);
        if(!path.startsWith(build+'/')){res.writeHead(404).end();return;}
        res.setHeader('Content-Type',extname(path)==='.css'?'text/css':'text/javascript');res.end(await readFile(path));
    }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
const report={at:new Date().toISOString(),chromium:browser.version(),entry:entry.file,sha256:createHash('sha256').update(await readFile(`${build}/${entry.file}`)).digest('hex'),synthetic:true,cases:[]};
try{
    for(const width of [1440,768,390])for(const dark of [false,true]){
        const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage();
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
        await page.addInitScript(({session,dark})=>{
            if(dark)localStorage.setItem('helm-theme','dark');
            const messages=Array.from({length:256},(_,i)=>({message_index:i,role:i%2===0?'user':'assistant',content:`Message ${i}\n\n`+'Synthetic history with retained canonical content. '.repeat(24)}));
            let cursor=10,bytes=0,subscription,socket;
            window.fixtureCounts={snapshot:0,history:0,output:0,frames:0,bytes:0,mutations:0};
            const envelope=result=>({session_id:session,incarnation:'i',result});
            const emit=value=>socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));
            window.fixtureStream=async(count,characters=1024)=>{
                for(let i=0;i<count;i++){
                    const text='界'.repeat(characters)+'\n',offset=bytes;
                    bytes+=new TextEncoder().encode(text).length;cursor++;
                    emit({type:'event',subscription_id:subscription,event:{protocol:1,...envelope({projection:'public-v2',cursor,latest_cursor:cursor,replay_gap:false,events:[{cursor,session_id:session,revision:1,run_id:'r',kind:'text_delta',payload:{offset,text}}]}),outcome_unknown:false,error:null}});
                    window.fixtureCounts.frames++;window.fixtureCounts.bytes=bytes;
                    if(i%8===7)await new Promise(resolve=>requestAnimationFrame(resolve));
                }
                await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            };
            class Socket extends EventTarget{
                readyState=0;protocol='voyage.vessel.v1';
                constructor(){super();socket=this;queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
                send(text){
                    const f=JSON.parse(text);
                    if(f.type==='authenticate'){queueMicrotask(()=>emit({type:'hello',protocol:1,vessel_id:'v',socket_id:'socket'}));return;}
                    if(f.type==='subscribe'){subscription=f.request_id;return;}
                    if(f.type==='unsubscribe')return;
                    const c=f.request.command;let result;
                    if(c.op==='capabilities')result={scope:'owner',vessel_id:'v',features:[]};
                    else if(c.op==='catalogue')result=[{session_id:session,incarnation:'i',name:'Long conversation',state:'live',catalogue:{summary:{run_state:'running'}}}];
                    else if(c.op==='snapshot'){
                        window.fixtureCounts.snapshot++;
                        result=envelope({session_id:session,revision:1,observation_cursor:cursor,messages:messages.slice(128),message_offset:128,history_truncated:true,run:{run_id:'r',state:'running',partial_text:'',partial_text_bytes:bytes,live_text:'',live_text_offset:0,stream_reconciled:true}});
                    }else if(c.op==='decisions')result=envelope([]);
                    else if(c.op==='history'){
                        window.fixtureCounts.history++;
                        result=envelope({revision:1,next_offset:c.offset+c.limit,messages:messages.slice(c.offset,c.offset+c.limit)});
                    }else if(c.op==='run_output'){
                        window.fixtureCounts.output++;
                        const canonical=new TextEncoder().encode(('界'.repeat(128)+'\n').repeat(8)+('界'.repeat(1024)+'\n').repeat(window.fixtureCounts.frames-8));
                        let end=Math.min(c.offset+c.limit,canonical.length);
                        while(end<canonical.length&&(canonical[end]&0xc0)===0x80)end--;
                        const data=new TextDecoder('utf-8',{fatal:true}).decode(canonical.subarray(c.offset,end));
                        result=envelope({run_id:'r',offset:c.offset,data,next_offset:end,total_bytes:bytes,has_more:end<bytes});
                    }else{window.fixtureCounts.mutations++;throw Error(`Unexpected command ${c.op}`);}
                    queueMicrotask(()=>emit({type:'reply',request_id:f.request_id,response:{protocol:1,outcome_unknown:false,result}}));
                }
                close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
            }
            window.WebSocket=Socket;
        },{session,dark});
        await page.goto(`${origin}/voyages/${vessel}/${session}`);
        const transcript=page.locator('.conversation:not([hidden]) .transcript');
        await transcript.locator('.message').last().waitFor();
        if(dark)await page.evaluate(()=>document.documentElement.classList.add('dark'));
        const geometry=()=>transcript.evaluate(el=>({top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight,gap:el.scrollHeight-el.scrollTop-el.clientHeight,outer:document.documentElement.scrollHeight-innerHeight,horizontal:document.documentElement.scrollWidth-innerWidth,composerBottom:document.querySelector('.conversation:not([hidden]) .composer').getBoundingClientRect().bottom,viewport:innerHeight}));
        await page.waitForFunction(()=>{const el=document.querySelector('.conversation:not([hidden]) .transcript');return el&&el.scrollHeight-el.scrollTop-el.clientHeight<2;});
        assert.equal(await page.evaluate(()=>window.fixtureCounts.history),0,'initial hydration must not eagerly download all history');
        await page.evaluate(()=>window.fixtureStream(8,128));
        assert.ok((await geometry()).gap<2,'live output follows latest');
        await transcript.evaluate(el=>{el.scrollTop=el.scrollHeight/2;el.dispatchEvent(new Event('scroll'));});
        const reading=(await geometry()).top;
        await page.evaluate(()=>window.fixtureStream(24));
        assert.ok(Math.abs((await geometry()).top-reading)<2,'stream growth preserves reading position');
        await page.getByRole('button',{name:'Latest',exact:true}).click();
        await page.waitForFunction(()=>{const el=document.querySelector('.conversation:not([hidden]) .transcript');return el.scrollHeight-el.scrollTop-el.clientHeight<2;});
        // The live prefix crosses 64 KiB and then receives another 3 MiB.
        const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
        await cdp.send('HeapProfiler.collectGarbage');
        const heap=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
        const before=await heap();
        await page.evaluate(()=>window.fixtureStream(1024));
        await cdp.send('HeapProfiler.collectGarbage');const after=await heap();
        const liveBytes=await page.locator('.live pre').evaluate(el=>new TextEncoder().encode(el.textContent).length);
        assert.ok(liveBytes<=65536,'rendered live output is bounded');
        assert.ok(after.JSHeapUsedSize-before.JSHeapUsedSize<16*1024*1024,'retained heap must plateau beyond the display cap');
        assert.equal(await page.evaluate(()=>window.fixtureCounts.snapshot),1,'deltas do not cause repeated snapshots');
        assert.equal(await transcript.locator('.message').count(),128);
        await page.getByRole('button',{name:'Load more output',exact:true}).click();
        await page.waitForFunction(()=>new TextEncoder().encode(document.querySelector('.live pre')?.textContent||'').length>65536);
        assert.equal(await page.evaluate(()=>window.fixtureCounts.output),1);
        assert.equal(await page.locator('.live pre').evaluate(el=>el.textContent.includes('\ufffd')),false,'paging preserves UTF-8 boundaries');
        await page.getByRole('textbox',{name:'Message',exact:true}).fill('Unsent retained draft');
        await transcript.evaluate(el=>{el.scrollTop=40;el.dispatchEvent(new Event('scroll'));});
        await page.waitForFunction(()=>document.querySelectorAll('.conversation:not([hidden]) .message').length===178,null,{timeout:5000}).catch(async error=>{
            console.error('HISTORY',await page.evaluate(()=>({counts:window.fixtureCounts,messages:document.querySelectorAll('.conversation:not([hidden]) .message').length,notices:[...document.querySelectorAll('[role="status"]')].map(el=>el.textContent)})),await geometry(),errors);throw error;
        });
        assert.equal(await page.evaluate(()=>window.fixtureCounts.history),1,'one bounded older page');
        const anchor=await transcript.locator('[data-message-index="128"]').evaluate(el=>el.getBoundingClientRect().top);
        assert.ok(anchor>-200&&anchor<100,'prepending history preserves the visible message');
        const state=await geometry();
        if(state.outer>1){
            console.error('OVERFLOW',state,await page.evaluate(()=>[...document.querySelectorAll('body > *, .helm-console > *, .voyage-workspace > *, .conversation:not([hidden]) > *')].map(el=>({tag:el.tagName,cls:el.className,hidden:el.hidden,height:el.getBoundingClientRect().height,top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom,overflow:getComputedStyle(el).overflow,position:getComputedStyle(el).position}))));
            await page.screenshot({path:`${output}/overflow.png`});
        }
        assert.ok(state.outer<=1&&state.horizontal<=1,'conversation owns scrolling without document overflow');
        assert.ok(state.composerBottom<=state.viewport+1,'composer stays inside viewport');
        await page.getByRole('button',{name:'Changes',exact:true}).click();
        await page.getByRole('button',{name:'Close panel',exact:true}).click();
        assert.equal(await page.getByRole('textbox',{name:'Message',exact:true}).inputValue(),'Unsent retained draft');
        assert.deepEqual(errors,[]);
        const counts=await page.evaluate(()=>window.fixtureCounts);assert.equal(counts.mutations,0);
        await page.screenshot({path:`${output}/${width}-${dark?'dark':'light'}.png`});
        report.cases.push({width,dark,counts,liveBytes,heapBefore:before.JSHeapUsedSize,heapAfter:after.JSHeapUsedSize,nodesBefore:before.Nodes,nodesAfter:after.Nodes,geometry:state,errors});
        await context.close();
    }
}finally{
    await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');
    await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify(report,null,2));
