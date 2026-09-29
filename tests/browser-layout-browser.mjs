// Render the built production React shell, never a real session or external site.
// Run with Node 24: node tests/browser-layout-browser.mjs
// Requires an existing Vite build, playwright-core and Chromium; installs nothing.
// Overrides: PLAYWRIGHT_MODULE, CHROMIUM_PATH, LAYOUT_OUTPUT.
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.LAYOUT_OUTPUT || `${root}/target/browser333-ux-layout`);
const {chromium} = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || `${root}/node_modules/playwright-core/index.mjs`).href);
const build = `${root}/public/build`;
const manifest = JSON.parse(await readFile(`${build}/manifest.json`, 'utf8'));
const entry = manifest['resources/react/main.tsx'];
const bootstrap = {tenantId:'layout-fixture',vessels:[{id:'11111111-1111-4111-8111-111111111111',vessel_id:'v',name:'Fixture Vessel'}],pairings:[{id:'pending-fixture',name:'Hidden pending pairing'}],ticketUrl:'/console/ticket',connectionsUrl:'/connections',logoutUrl:'/console/logout'};
const releaseAssets=version=>[{name:`voyage-${version}-x86_64-unknown-linux-gnu.tar.gz`,size:100},{name:`voyage-${version}-x86_64-unknown-linux-gnu.tar.gz.sha256`,size:100}];
const stableRelease={tag_name:'v1.0.2',draft:false,prerelease:false,assets:releaseAssets('v1.0.2')};
const nightlyReleases=[{tag_name:'nightly-1.0.3-nightly.20260928.1.1',draft:false,prerelease:true,target_commitish:'a'.repeat(40),assets:releaseAssets('1.0.3-nightly.20260928.1.1')}];
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csrf-token" content="fixture">${entry.css.map(css=>`<link rel="stylesheet" href="/build/${css}">`).join('')}</head><body><div id="helm-react" data-bootstrap='${JSON.stringify(bootstrap)}'></div><script type="module" src="/build/${entry.file}"></script></body></html>`;
const server = createServer(async (req,res)=>{
    try {
        if(req.url === '/') {res.setHeader('Content-Type','text/html');res.end(html);return;}
        const path = resolve(build, `.${new URL(req.url,'http://fixture').pathname.replace(/^\/build/,'')}`);
        if(!path.startsWith(build+'/')) {res.writeHead(404).end();return;}
        res.setHeader('Content-Type',extname(path)==='.css'?'text/css':'text/javascript');res.end(await readFile(path));
    } catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(output,{recursive:true});
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true});
const report = {capturedAt:new Date().toISOString(),chromium:browser.version(),entry:entry.file,sha256:createHash('sha256').update(await readFile(`${build}/${entry.file}`)).digest('hex'),synthetic:true,viewports:[],failures:[]};
const check = (value, message) => {if(!value)report.failures.push(message);};
try {
 for(const viewport of (process.env.LAYOUT_VIEWPORT==='mobile'?[{width:390,height:844}]:[{width:1440,height:900},{width:390,height:844}])) {
    const label = viewport.width===1440?'desktop':'mobile';
    const context = await browser.newContext({viewport,reducedMotion:'reduce'});
    const page = await context.newPage();
    const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE',e.message);});page.on('response',r=>{if(r.status()>=400)console.error('HTTP',r.status(),r.url());});
    await page.route('**/*',route=>{
        const url=route.request().url();
        if(url===origin+'/console/ticket')return route.fulfill({json:{url:'wss://fixture.invalid/v1/vessel/browser-socket',vessel_id:'v',token:'a'.repeat(64),expires_at_ms:Date.now()+120000}});
        if(url==='https://api.github.com/repos/o-psi/helm.vessel.voyage/releases/latest')return route.fulfill({json:stableRelease});
        if(url==='https://api.github.com/repos/o-psi/helm.vessel.voyage/releases?per_page=100')return route.fulfill({json:nightlyReleases});
        return url.startsWith(origin+'/')?route.continue():route.abort();
    });
    await page.addInitScript(()=>{
        window.fixtureCommands=[];
        // Transport is synthetic. The App, DOM, CSS, browser layout,
        // controls and event handling are the unmodified production bundle.
        const binding={incarnation:'i',browser_id:'fixture-browser',attachment_id:'fixture-attachment',capture_epoch:1,controller_epoch:1};
        let mode='agent';
        let updateRecord={phase:'idle'};
        class Socket extends EventTarget {
            readyState=0;protocol='voyage.vessel.v1';
            constructor(){super();queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
            send(text){const f=JSON.parse(text);const emit=data=>queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)})));
                if(f.type==='authenticate'){emit({type:'hello',protocol:1,vessel_id:'v',socket_id:'fixture-socket'});return;}
                if(['subscribe','unsubscribe'].includes(f.type))return;
                const c=f.request.command;window.fixtureCommands.push(c);let result;
                if(c.op==='capabilities')result={scope:'owner',vessel_id:'v',version:'1.0.2',features:['execution_profiles'],remote_updates:true,workspaces:[{path:'/work',name:'Work'}]};
                else if(c.op==='update_prepare')result=updateRecord={phase:'ready',operation_id:c.operation_id,release_id:'a'.repeat(64),version:'fixture-next-version',description:'Verified development build from fixture source',services:['vessel.service']};
                else if(c.op==='update_apply')result=updateRecord={...updateRecord,phase:'applying',message:'Installing the approved release.'};
                else if(c.op==='update_status')result=updateRecord;
                else if(c.op==='profiles')result={revision:1,default_profile_id:'fixture',profiles:[{id:'fixture',name:'Fixture profile',model:'fixture-model',account:{account_id:'a',connection_id:'p',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'}}]};
                else if(c.op==='accounts')result={accounts:[{id:'a',connection_id:'p',identity_generation:1,label:'Fixture account',state:'ready',availability:'available'}],connections:[{id:'p',revision:1,label:'Fixture provider',transports:['chatgpt_oauth']}]};
                else if(c.op==='account_models')result={account:c.account,models:[{id:'fixture-model',display_name:'Fixture model',reasoning_efforts:['low','medium']},{id:'other-model',display_name:'Other model',reasoning_efforts:['low']}]};
                else if(c.op==='catalogue')result=[{session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',name:'Browser layout fixture',state:'live',catalogue:{summary:{run_state:'idle'}}}];
                else if(c.op==='snapshot')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:{session_id:'22222222-2222-4222-8222-222222222222',name:'Browser layout fixture',workspace:'/work',revision:1,observation_cursor:5,messages:[...Array.from({length:40},(_,i)=>({role:i%5===0?'user':'assistant',content:i%5===0?`Fixture request ${i/5+1}`:`### Fixture observation ${i+1}\nSynthetic conversation content for scroll and composer layout verification. No personal browsing data.`,message_index:i})),{role:'assistant',message_index:40,content:'',tool_calls:[{id:'fixture-edit',function:{name:'apply_patch',arguments:JSON.stringify({patch:'*** Begin Patch\n*** Update File: src/fixture.ts\n+fixture\n*** End Patch'})}}]},{role:'tool',message_index:41,tool_call_id:'fixture-edit',tool_success:true,content:'Applied'}],inference:{account:{account_id:'a',connection_id:'p',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'},model:'fixture-model',reasoning_effort:'medium',service_tier:null},run:{state:'idle',tool_previews:[{name:'host_browser'}]}}};
                else if(c.op==='decisions')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:[]};
                else if(c.op==='host_browser'){
                    if(c.operation.action==='control'){mode=c.operation.mode;binding.controller_epoch++;}
                    result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:{status:{available:!window.fixtureUnavailable,running:!window.fixtureUnavailable,mode:window.fixtureUnavailable?null:mode,binding:window.fixtureUnavailable?null:{...binding},controller:mode==='private'?binding.attachment_id:null,input_sequence:0,page:{url:'https://fixture.invalid/',title:'Synthetic fixture'},tabs:[]},value:null}};
                } else throw Error(`Unexpected fixture operation ${c.op}`);
                emit({type:'reply',request_id:f.request_id,response:{protocol:1,outcome_unknown:false,result}});
            }
            close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
        }
        window.WebSocket=Socket;
    });
    await page.goto(origin);
    await page.getByRole('option',{name:/Fixture profile/}).waitFor({state:'attached'});
    check(await page.getByRole('form',{name:'New voyage composer'}).isVisible(),`${label}: new voyage composer is missing`);
    check(await page.getByRole('textbox',{name:'Message'}).isVisible(),`${label}: new voyage message is missing`);
    check(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),`${label}: empty draft permits sending`);
    await page.screenshot({path:`${output}/${label}-empty.png`});
    if(label==='desktop') await page.locator('.voyage-card').click();
    if(label==='mobile'){
        await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
        check(await page.locator('[data-slot="sheet-content"]').isVisible(),'mobile: shadcn navigation sheet did not open');
        await page.getByRole('button',{name:'Vessel connections',exact:true}).click();
        check(await page.getByRole('menuitem',{name:'Manage Vessels'}).isVisible(),'mobile: Vessel menu did not open inside the sheet');
        await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'Account and appearance'}).click();
        await page.getByRole('menuitemradio',{name:'dark'}).click();
        check(await page.locator('html.dark').count()===1,'mobile: dark appearance did not apply');
        await page.keyboard.press('Escape');
        await page.locator('.sidebar').click({position:{x:150,y:400}});
        await page.waitForTimeout(300);
        const selectTheme=await page.evaluate(()=>{const probe=document.createElement('span');probe.style.color='var(--foreground)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {expected,actual:getComputedStyle(document.querySelector('.sidebar [data-slot="native-select"]')).color};});
        const lightness=value=>Number(value.match(/\(([\d.]+)/)?.[1]);
        check(Math.abs(lightness(selectTheme.actual)-lightness(selectTheme.expected))<0.02,`mobile: native select foreground ${JSON.stringify(selectTheme)}`);
        await page.screenshot({path:`${output}/${label}-dark-empty.png`});
        await page.getByRole('button',{name:'Account and appearance'}).click();
        await page.getByRole('menuitemradio',{name:'light'}).click();
    }
    await page.getByRole('button',{name:'Vessel connections',exact:true}).click();
    await page.getByRole('menuitem',{name:'Manage Vessels'}).click();
    const vesselCard=page.locator('.connections-card');
    await vesselCard.getByText('Version 1.0.2').waitFor();
    await page.getByText('Stable: v1.0.2').waitFor();
    await page.getByText('Development: 1.0.3-nightly.20260928.1.1').waitFor();
    check(await vesselCard.getByText('New release').count()===0,`${label}: another channel falsely marks this Vessel as having a new release`);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='update_prepare').length===0),`${label}: release lookup prepared a build without consent`);
    check((await vesselCard.boundingBox()).height<100,`${label}: overview card is not compact`);
    check(await page.getByText('Needs confirmation').count()===0,`${label}: pending pairing panel is still shown`);
    await page.waitForTimeout(180);
    await page.screenshot({path:`${output}/${label}-vessel-overview.png`});
    await vesselCard.getByRole('button',{name:'View details for Fixture Vessel'}).click();
    await page.locator('.connections-maintenance #update-current').getByText('1.0.2').waitFor();
    check(await page.locator('.connections-maintenance').getByText('Newer release published').count()===0,`${label}: another channel falsely claims a newer release`);
    check(await page.locator('.connections-maintenance').getByText('Published on another channel').isVisible(),`${label}: cross-channel build is not identified`);
    check(await page.locator('.connections-maintenance').isVisible(),`${label}: Vessel maintenance is missing from Manage Vessels`);
    check(await page.locator('.connections-dialog #update-check').isVisible(),`${label}: update action is not visible`);
    check(await page.locator('.connections-dialog').getByRole('button',{name:'Remove from Helm Web…'}).count()===0,`${label}: removal action is exposed before opening its disclosure`);
    check(await page.locator('.connections-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: Vessel manager overflows horizontally`);
    await page.screenshot({path:`${output}/${label}-vessel-maintenance.png`});
    await page.locator('#update-check').click();
    await page.locator('#update-approve').waitFor({state:'visible'});
    check(await page.locator('#update-status').textContent().then(text=>text.includes('Build prepared for review')),`${label}: prepared update shows idle status`);
    check(await page.locator('#update-source').isHidden(),`${label}: prepared update still shows a second preparation action`);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='update_apply').length===0),`${label}: preparation applied without approval`);
    await page.locator('#update-review').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/${label}-vessel-review.png`});
    await page.getByRole('button',{name:'Close Vessel connections'}).click();
    if(label==='mobile') await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
    await page.getByRole('button',{name:'Account and appearance'}).click();
    await page.getByRole('menuitemradio',{name:'dark'}).click();
    check(await page.locator('html.dark').count()===1,`${label}: dark appearance did not apply to Vessel maintenance`);
    await page.getByRole('button',{name:'Vessel connections',exact:true}).click();
    await page.getByRole('menuitem',{name:'Manage Vessels'}).click();
    await page.locator('.connections-card').getByText('Version 1.0.2').waitFor();
    await page.waitForTimeout(180);
    await page.screenshot({path:`${output}/${label}-vessel-overview-dark.png`});
    await page.locator('.connections-dialog').getByRole('button',{name:'View details for Fixture Vessel'}).click();
    await page.locator('#update-review').waitFor({state:'visible'});
    await page.locator('#update-review').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/${label}-vessel-review-dark.png`});
    await page.locator('#update-approve').click();
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='update_apply').length===1),`${label}: Update this Vessel did not send one exact approval`);
    check(await page.locator('#update-review').isHidden(),`${label}: approved review stayed actionable`);
    await page.getByRole('button',{name:'Close Vessel connections'}).click();
    if(label==='mobile') await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
    await page.getByRole('button',{name:'Account and appearance'}).click();
    await page.getByRole('menuitemradio',{name:'light'}).click();
    await page.locator('.voyage-card').click();
    if(label==='mobile')await page.locator('.mobile-navigation').waitFor({state:'hidden'});
    const conversation=page.locator('.conversation:not([hidden])');
    await page.screenshot({path:`${output}/${label}-before-model.png`});
    check(await conversation.getByRole('button',{name:'Previous user message'}).count()===1,`${label}: turn navigation is missing`);
    const beforeTurn=await conversation.locator('.transcript').evaluate(element=>element.scrollTop);
    await conversation.getByRole('button',{name:'Previous user message'}).click();
    check(await conversation.locator('.transcript').evaluate(element=>element.scrollTop)<beforeTurn,`${label}: previous turn did not move the transcript`);
    await page.getByRole('button',{name:'Choose model'}).click();
    check(await page.getByRole('menuitem',{name:'Fixture model'}).isVisible(),`${label}: direct model choices did not load`);
    await page.keyboard.press('Escape');
    check(await page.locator('button[aria-label="Choose reasoning"]').isVisible(),`${label}: direct reasoning control is missing`);
    const draft=conversation.locator('textarea').first();
    await draft.fill('Retained synthetic draft');
    if(label==='desktop'){
        await page.getByRole('button',{name:'Account and appearance'}).click();
        await page.getByRole('menuitem',{name:'Sign out'}).click();
        check(await page.getByRole('dialog',{name:'Sign out with unsent work?'}).isVisible(),'desktop: unsent draft sign-out review did not open');
        await page.getByRole('button',{name:'Keep working'}).click();
        check(await draft.inputValue()==='Retained synthetic draft','desktop: cancelling sign-out lost the draft');
    }
    await page.waitForTimeout(250);
    await conversation.locator('.transcript').evaluate(el=>{el.scrollTop=321;window.savedTranscript=el;window.savedDraft=document.querySelector('.conversation:not([hidden]) textarea');});
    const geometry=()=>page.evaluate(()=>{
        const rect=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const transcript=document.querySelector('.conversation:not([hidden]) .transcript');
        const toggle=document.querySelector('.task-browser-action');const r=toggle.getBoundingClientRect();
        return {toggle:rect('.task-browser-action'),toggleHit:toggle.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),panel:rect('.task-browser-panel'),composer:rect('.conversation:not([hidden]) form'),draft:rect('.conversation:not([hidden]) textarea'),transcript:rect('.conversation:not([hidden]) .transcript'),scrollTop:transcript.scrollTop,scrollHeight:transcript.scrollHeight,documentWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.conversation:not([hidden]) *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,70),right:el.getBoundingClientRect().right})),primary:rect('.browser-primary'),privacy:rect('.browser-privacy'),activeLabel:document.activeElement.getAttribute('aria-label'),sameTranscript:transcript===window.savedTranscript,sameDraft:document.querySelector('.conversation:not([hidden]) textarea')===window.savedDraft};
    });
    const before=await geometry();
    await page.screenshot({path:`${output}/${label}-closed.png`});
    await page.getByRole('button',{name:'Changes',exact:true}).click();
    check(await page.getByLabel('Recorded changes').isVisible(),`${label}: recorded changes dock did not open`);
    check(await page.getByLabel('Executing-host inspection').isVisible(),`${label}: executing-host inspection is missing`);
    await page.screenshot({path:`${output}/${label}-workspace.png`});
    await page.getByRole('button',{name:'Recorded edits',exact:true}).click();
    check(await page.getByText('src/fixture.ts').first().isVisible(),`${label}: recorded patch path is missing`);
    await page.waitForTimeout(180);
    if(label==='mobile')check(await page.locator('.task-browser-panel').evaluate(el=>Math.abs(el.getBoundingClientRect().width-innerWidth)<1),`${label}: review dock does not fill the viewport`);
    await page.screenshot({path:`${output}/${label}-changes.png`});
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await page.locator('.task-browser-panel').waitFor({state:'detached'});
    await page.getByRole('button',{name:'Browser',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.host-browser-viewer')?.querySelector('.browser-next-mirror'));
    await page.waitForTimeout(150);
    const opened=await geometry();
    await page.screenshot({path:`${output}/${label}-open.png`});
    await page.getByRole('button',{name:'Browse privately',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.browser-primary')?.textContent==='Continue agent'&&!document.querySelector('.browser-primary')?.hidden);
    const privateState=await geometry();
    const privateLabel=await page.locator('.browser-primary').textContent();
    const privateAccessibleLabel=await page.locator('.browser-primary').getAttribute('aria-label');
    await page.screenshot({path:`${output}/${label}-private.png`});
    const commandsBeforeClose=await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='host_browser').map(c=>c.operation.action));
    check(before.toggleHit,`${label}: Browser toggle not hit-testable`);
    check(before.toggle.right<=viewport.width && before.toggle.y>=0,`${label}: Browser toggle outside viewport`);
    check(before.documentWidth<=viewport.width,`${label}: closed shell overflows horizontally`);
    check(opened.documentWidth<=viewport.width,`${label}: open shell overflows horizontally`);
    check(privateLabel==='Continue agent',`${label}: private control label did not change`);
    check(privateAccessibleLabel===privateLabel,`${label}: private accessible label differs`);
    check(commandsBeforeClose.includes('control'),`${label}: control was not forwarded`);
    check(errors.length===0,`${label}: page errors: ${errors.join('; ')}`);
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await page.locator('.task-browser-panel').waitFor({state:'detached'});
    const closed=await geometry();
    const retained=await draft.inputValue();
    const commands=await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='host_browser').map(c=>c.operation.action));
    check(commands.includes('detach')&&!commands.includes('close'),`${label}: close did not detach or stopped browser`);
    check(retained==='Retained synthetic draft' && closed.sameDraft && closed.sameTranscript,`${label}: draft/transcript DOM not retained`);
    report.viewports.push({label,viewport,before,opened,privateState,closed,commands,errors});
    await context.close();
 }
} finally {
 await writeFile(`${output}/measurements.json`,JSON.stringify(report,null,2)+'\n');
 await browser.close();await new Promise(r=>server.close(r));
}
console.log(JSON.stringify(report,null,2));
assert.equal(report.failures.length,0,report.failures.join('\n'));
