// Production bundle, real IndexedDB, synthetic scoped transport. No provider.
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.env.DRAFT_OUTPUT||`${root}/target/browser-drafts`);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE||`${root}/node_modules/playwright-core/index.mjs`).href);
const build=`${root}/public/build`,manifest=JSON.parse(await readFile(`${build}/manifest.json`,'utf8')),entry=manifest['resources/react/main.tsx'];
const vessel='11111111-1111-4111-8111-111111111111',sessions=['22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    try{
        if(url.pathname==='/'||url.pathname.startsWith('/voyages/')){
            const bootstrap={tenantId:url.searchParams.get('tenant')||'draft-account-a',vessels:[{id:vessel,vessel_id:'v',name:'Draft Vessel'}],ticketUrl:'/console/ticket',connectionsUrl:'/connections',logoutUrl:'/console/logout'};
            res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${entry.css.map(css=>`<link rel="stylesheet" href="/build/${css}">`).join('')}</head><body><div id="helm-react" data-bootstrap='${JSON.stringify(bootstrap)}'></div><script type="module" src="/build/${entry.file}"></script></body></html>`);return;
        }
        if(url.pathname==='/console/ticket'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:'wss://fixture.invalid/v1/vessel/browser-socket',vessel_id:'v',token:'a'.repeat(64),expires_at_ms:Date.now()+120000}));return;}
        const path=resolve(build,`.${url.pathname.replace(/^\/build/,'')}`);
        if(!path.startsWith(build+'/')){res.writeHead(404).end();return;}
        res.setHeader('Content-Type',extname(path)==='.css'?'text/css':'text/javascript');res.end(await readFile(path));
    }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true});
const report={at:new Date().toISOString(),chromium:browser.version(),entry:entry.file,sha256:createHash('sha256').update(await readFile(`${build}/${entry.file}`)).digest('hex'),cases:[]};
try{
 for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];
    await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.addInitScript(({sessions})=>{
        window.fixtureCommands=[];
        const account={account_id:'a',connection_id:'p',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'};
        class Socket extends EventTarget{
            readyState=0;protocol='voyage.vessel.v1';
            constructor(){super();queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
            send(text){const f=JSON.parse(text),emit=data=>queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)})));
                if(f.type==='authenticate'){emit({type:'hello',protocol:1,vessel_id:'v',socket_id:'socket'});return;}
                if(['subscribe','unsubscribe'].includes(f.type))return;
                const c=f.request.command;window.fixtureCommands.push(c);const envelope=result=>({session_id:c.session_id,incarnation:'i',result});let result;
                if(c.op==='capabilities')result={scope:'owner',vessel_id:'v',features:['execution_profiles'],workspaces:[{path:'/work',name:'Work'}]};
                else if(c.op==='catalogue')result=sessions.map((session,index)=>({session_id:session,incarnation:'i',name:`Draft voyage ${index+1}`,state:'live',catalogue:{summary:{run_state:'idle'}}}));
                else if(c.op==='snapshot')result=envelope({session_id:c.session_id,name:'Draft voyage',workspace:'/work',revision:1,observation_cursor:5,messages:[],run:{state:'idle'}});
                else if(c.op==='decisions')result=envelope([]);
                else if(c.op==='profiles')result={revision:1,default_profile_id:'fixture',profiles:[{id:'fixture',name:'Fixture',model:'m',account}]};
                else if(c.op==='accounts')result={accounts:[{id:'a',connection_id:'p',identity_generation:1,label:'Fixture',state:'ready',availability:'available'}],connections:[{id:'p',revision:1,label:'Provider',transports:['chatgpt_oauth']}]};
                else if(c.op==='account_models')result={account,models:[{id:'m',display_name:'Fixture',reasoning_efforts:[]}]};
                else if(c.op==='upload_image')result=envelope({id:c.upload_id,sha256:'a'.repeat(64),byte_size:68});
                else if(['submit','submit_content','steer'].includes(c.op)){
                    sessionStorage.setItem('fixture-sends',String(Number(sessionStorage.getItem('fixture-sends')||0)+1));
                    if(window.fixtureUnknown){emit({type:'reply',request_id:f.request_id,response:{protocol:1,outcome_unknown:true,result:null}});return;}
                    result=envelope({command_id:c.command_id,status:'accepted'});
                }else if(c.op==='receipt')result=envelope({command_id:c.command_id,status:'unknown_after_restart'});
                else throw Error(`Unexpected fixture operation ${c.op}`);
                emit({type:'reply',request_id:f.request_id,response:{protocol:1,outcome_unknown:false,error:null,result}});
            }
            close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
        }
        window.WebSocket=Socket;
    },{sessions});
    const page=await context.newPage();const path=`${origin}/voyages/${vessel}/${sessions[0]}`;
    const editor=p=>p.locator('.conversation:not([hidden]) textarea[aria-label="Message"]');
    const ready=async p=>{await editor(p).waitFor();await p.waitForFunction(()=>{const e=document.querySelector('.conversation:not([hidden]) textarea');return e&&!e.disabled;});};
    page.on('dialog',dialog=>dialog.accept());
    await page.goto(path);await ready(page);await editor(page).fill('Private unsent <literal> 界');
    await page.locator('.conversation:not([hidden]) input[type="file"]').setInputFiles({name:'tiny.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ0AAAAASUVORK5CYII=','base64')});
    await page.locator('.conversation:not([hidden]) .pictures img').waitFor();
    await page.getByText('Draft voyage 2',{exact:true}).click();await ready(page);assert.equal(await editor(page).inputValue(),'');
    await page.getByText('Draft voyage 1',{exact:true}).click();await ready(page);assert.equal(await editor(page).inputValue(),'Private unsent <literal> 界');
    assert.equal(await page.locator('.conversation:not([hidden]) .pictures img').count(),1);
    const second=await context.newPage();await second.goto(path);await ready(second);assert.equal(await editor(second).inputValue(),'');await second.close();
    await page.reload();await ready(page);assert.equal(await editor(page).inputValue(),'');assert.equal(await page.locator('.conversation:not([hidden]) .pictures img').count(),0);
    await editor(page).fill('Accepted message');await page.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.conversation:not([hidden]) textarea')?.value==='');
    await editor(page).fill('Unknown message');await page.evaluate(()=>window.fixtureUnknown=true);await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByText('This draft may already have been sent. Check the conversation before sending it again.',{exact:true}).waitFor();
    const identity=await page.evaluate(()=>window.fixtureCommands.filter(command=>['submit','submit_content'].includes(command.op)).at(-1).command_id);
    await page.reload();await ready(page);assert.equal(await editor(page).inputValue(),'');
    assert.equal(await page.evaluate(()=>Number(sessionStorage.getItem('fixture-sends')||0)),2);
    const receiptIds=await page.evaluate(()=>window.fixtureCommands.filter(command=>command.op==='receipt').map(command=>command.command_id));assert.ok(receiptIds.includes(identity));
    await page.goto(path+'?tenant=draft-account-b');await ready(page);assert.equal(await editor(page).inputValue(),'');
    await page.goto(origin);const composer=page.locator('.new-voyage');await composer.locator('textarea').waitFor();await composer.locator('textarea').fill('New unsent message');
    await page.reload();await composer.locator('textarea').waitFor();assert.equal(await composer.locator('textarea').inputValue(),'');
    assert.deepEqual(errors,[]);
    report.cases.push({width,volatilePictures:true,tabRetention:true,reloadClears:true,accountIsolation:true,windowIsolation:true,acceptedCleared:true,exactUnknownReceipt:identity,newComposerReloadClears:true,errors});await context.close();
 }
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
