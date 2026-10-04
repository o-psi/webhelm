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
 for(const runOutcome of ['failed','completed']) for(const viewport of (process.env.LAYOUT_VIEWPORT==='mobile'?[{width:390,height:844}]:[{width:1280,height:900},{width:858,height:882},{width:390,height:844},{width:390,height:568},{width:320,height:568}])) {
    const label = viewport.width>600?'desktop':'mobile';
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
    await page.addInitScript(({runOutcome})=>{
        window.fixtureRunOutcome=runOutcome;
        window.fixtureCommands=[];
        window.fixtureClipboard=[];
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.fixtureClipboard.push(text)}});
        // Transport is synthetic. The App, DOM, CSS, browser layout,
        // controls and event handling are the unmodified production bundle.
        const binding={incarnation:'i',browser_id:'fixture-browser',attachment_id:'fixture-attachment',capture_epoch:1,controller_epoch:1,tab_id:'tab',document_epoch:1,viewport_epoch:1};
        let mode='agent';let browserRunning=true;
        let goal={revision:0,goal:null};
        let updateRecord={phase:'idle'};
        class Socket extends EventTarget {
            readyState=0;protocol='voyage.vessel.v1';
            constructor(){super();queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
            send(text){const f=JSON.parse(text);const emit=data=>queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)})));
                if(f.type==='authenticate'){emit({type:'hello',protocol:1,vessel_id:'v',socket_id:'fixture-socket'});return;}
                if(['subscribe','unsubscribe'].includes(f.type))return;
                const c=f.request.command;window.fixtureCommands.push(c);let result;
                if(c.op==='account_usage'&&window.fixtureUsageDeferred){window.releaseFixtureUsage=()=>{window.fixtureUsageDeferred=false;this.send(text);};return;}
                if(c.op==='account_models'&&window.fixtureCatalogueMode==='error'){emit({type:'reply',request_id:f.request_id,response:{protocol:1,outcome_unknown:false,error:'Synthetic catalogue unavailable'}});return;}
                if(c.op==='account_models'&&window.fixtureCatalogueMode==='loading'){window.releaseFixtureCatalogue=()=>{this.send(text);};return;}
                if(c.op==='capabilities')result={scope:'owner',vessel_id:'v',version:'1.0.2',features:['execution_profiles','verified_user_updates','workspace_changes','workspace_file','skills_catalog','workspace_file_catalog'],remote_updates:true,workspaces:[{path:'/work',name:'Work'}]};
                else if(c.op==='update_prepare')result=updateRecord={phase:'ready',operation_id:c.operation_id,channel:c.channel,release_id:'a'.repeat(64),version:c.channel==='nightly'?'1.0.3-nightly.20260928.1.1':'1.0.2',expires_at:Math.floor(Date.now()/1000)+3600,description:'Verified development build from fixture source',services:['vessel.service']};
                else if(c.op==='update_apply')result=updateRecord={...updateRecord,phase:'applying',message:'Installing the approved release.'};
                else if(c.op==='update_status')result=updateRecord;
                else if(c.op==='profiles')result={revision:1,can_manage:true,default_profile_id:'fixture',profiles:[{id:'fixture',name:'Fixture profile',model:'fixture-model',account:{account_id:'a',connection_id:'p',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'}}]};
                else if(c.op==='accounts')result={accounts:[{id:'a',connection_id:'p',identity_generation:1,label:'Fixture account with a long provider subscription identity and workspace-specific description',state:'ready',availability:'available'}],connections:[{id:'p',revision:1,label:'Fixture provider',transports:['chatgpt_oauth']}]};
                else if(c.op==='account_usage')result={account:c.account,refresh_status:'fresh',snapshot:{windows:[]}};
                else if(c.op==='account_models')result={account:c.account,models:[{id:'fixture-model',display_name:'Fixture model with a long readable catalogue description and capability label',reasoning_efforts:['low','medium']},{id:'other-model',display_name:'Other model',reasoning_efforts:['low']}]};
                else if(c.op==='inspect')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',state:'live',workspace:'/work'};
                else if(c.op==='history')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:{revision:1+goal.revision,message_offset:c.offset,next_offset:40,has_more:false,messages:Array.from({length:40-c.offset},(_,n)=>{const i=n+c.offset;return {role:i%5===0?'user':'assistant',message_index:i,content:i%5===0?`Fixture request ${i/5+1}`:`Fixture observation ${i+1}`};})}};
                else if(c.op==='catalogue')result=[{session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',name:'Browser layout fixture',state:'live',catalogue:{summary:{run_state:'idle'}}},...Array.from({length:18},(_,i)=>({session_id:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,incarnation:'i',name:`${i<12?'Background working':i<16?'Completed':'Awaiting decision'} fixture ${i}`,state:'live',catalogue:{summary:{run_state:i<12?'running':i<16?'completed':'awaiting_decision'}}}))];
                else if(c.op==='snapshot')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:{session_id:'22222222-2222-4222-8222-222222222222',name:'Browser layout fixture',workspace:'/work',revision:1+goal.revision,observation_cursor:5+goal.revision,goal,context_status:'Last prepared input: unknown tokens · window: unknown · reserve: unknown · projection 2',context_observation:{projection_generation:2,count:{input_tokens:null}},messages:[...Array.from({length:40},(_,i)=>({role:i%5===0?'user':'assistant',content:i%5===0?`Fixture request ${i/5+1}`:`### Fixture observation ${i+1}\nSynthetic conversation content for scroll and composer layout verification. No personal browsing data.`,message_index:i})),{role:'assistant',message_index:40,content:'',tool_calls:[{id:'fixture-pending',function:{name:'process',arguments:JSON.stringify({command:'A long synthetic process description for bounded summary readability '.repeat(8)})}},{id:'fixture-failed',function:{name:'read_file',arguments:JSON.stringify({path:'/work/long-synthetic-filename.ts'})}},{id:'fixture-edit',function:{name:'apply_patch',arguments:JSON.stringify({patch:'*** Begin Patch\n*** Update File: src/fixture.ts\n+fixture\n*** End Patch'})}}]},{role:'tool',message_index:41,tool_call_id:'fixture-edit',tool_success:true,content:'Applied'},{role:'tool',message_index:42,tool_call_id:'fixture-failed',tool_success:false,content:'Synthetic unsuccessful result'}],inference:{account:{account_id:'a',connection_id:'p',identity_generation:1,connection_revision:1,transport:'chatgpt_oauth'},model:'fixture-model',reasoning_effort:'medium',service_tier:null},run:{state:window.fixtureRunOutcome,tool_previews:[{name:'host_browser'}]}}};
                else if(c.op==='workspace_file')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:{path:c.path,text:'# Current file preview\n',truncated:false,observed_at_ms:Date.now(),observed_bytes:23,file_bytes:23,preview_sha256:'a'.repeat(64)}};
                else if(c.op==='workspace_changes')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:{scope:c.scope,path:c.path||'.',text:c.scope==='status'?' M src/fixture.ts\0?? docs/new.md\0':'diff --git a/src/fixture.ts b/src/fixture.ts\n@@ -1 +1 @@\n-old\n+new\n',truncated:false,observed_at_ms:Date.now()}};
                else if(c.op==='controls')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:c.section==='tools'?{section:'tools',execution:'idle',value:{inventory:[{name:'read_file',description:'Read a workspace file'}],source:'builtin_preflight'}}:c.section==='files'?{section:'files',execution:'idle',value:{files:['src/fixture.ts','docs/new.md'],truncated:false,excluded_directories:['.git','node_modules','target','vendor','.venv'],observed_at_ms:Date.now()}}:{section:'skills',execution:'idle',value:{skills:[{name:'review',description:'Review the workspace',path:'/work/.agents/skills/review/SKILL.md',scope:'/work'}],can_read:true,discovery_incomplete:false}}};
                else if(c.op==='goal_update'){
                    if(c.action.action!=='set')throw Error('Unexpected Goal action');
                    goal={revision:goal.revision+1,goal:{id:c.command_id,session_id:c.session_id,objective:c.action.objective,status:c.action.continue_automatically?'active':'paused',continuation_authorized:c.action.continue_automatically,limits:c.action.limits,usage:{runs:0,input_tokens:0,output_tokens:0,elapsed_ms:0,no_progress_runs:0,unmeasured_runs:0},stop_reason:'user_paused'}};
                    result={session_id:c.session_id,incarnation:'i',result:{command_id:c.command_id,status:'applied',goal_revision:goal.revision,goal_id:c.command_id}};
                }
                else if(c.op==='decisions')result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:[]};
                else if(c.op==='host_browser'){
                    if(c.operation.action==='start')browserRunning=true;
                    if(c.operation.action==='attach')binding.attachment_id=c.operation.binding.attachment_id;
                    if(c.operation.action==='control'){mode=c.operation.mode;binding.controller_epoch++;}
                    if(c.operation.action==='close'){browserRunning=false;mode='agent';}
                    result={session_id:'22222222-2222-4222-8222-222222222222',incarnation:'i',result:{status:{available:!window.fixtureUnavailable,running:browserRunning&&!window.fixtureUnavailable,mode:window.fixtureUnavailable?null:mode,binding:window.fixtureUnavailable||!browserRunning?null:{...binding},controller:['private','human'].includes(mode)?binding.attachment_id:null,input_sequence:0,page:{url:'https://fixture.invalid/',title:'Synthetic fixture'},tabs:[]},value:null}};
                } else throw Error(`Unexpected fixture operation ${c.op}`);
                emit({type:'reply',request_id:f.request_id,response:{protocol:1,outcome_unknown:false,result}});
            }
            close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
        }
        window.WebSocket=Socket;
    },{runOutcome});
    await page.goto(origin);
    await page.getByRole('option',{name:/Fixture profile/}).waitFor({state:'attached'});
    check(await page.getByRole('form',{name:'New voyage composer'}).isVisible(),`${label}: new voyage composer is missing`);
    check(await page.getByRole('textbox',{name:'Message'}).isVisible(),`${label}: new voyage message is missing`);
    check(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),`${label}: empty draft permits sending`);
    async function inspectComposerControls(form,phase){
        const geometry=await form.evaluate(el=>{
            const composer=el.getBoundingClientRect();
            return {composer:{left:composer.left,right:composer.right},viewport:innerWidth,controls:[...el.querySelectorAll('.composer-settings .composer-option-trigger')].map(button=>{
                const r=button.getBoundingClientRect();return {name:button.getAttribute('aria-label'),left:r.left,right:r.right,width:r.width,height:r.height};
            })};
        });
        for(const name of ['Account','Model','Reasoning','Service tier','Access']){
            const control=geometry.controls.find(item=>item.name?.startsWith(name+':')||(name==='Access'&&item.name==='Review access mode'));
            check(Boolean(control),`${label} ${phase}: ${name} trigger missing`);
            if(control)check(control.width>0&&control.height>0&&control.left>=Math.max(0,geometry.composer.left)-1&&control.right<=Math.min(geometry.viewport,geometry.composer.right)+1,`${label} ${phase}: ${name} clipped ${JSON.stringify({control,geometry})}`);
        }
        return geometry;
    }
    const draftControlGeometry=await inspectComposerControls(page.getByRole('form',{name:'New voyage composer'}),'draft');
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-empty.png`});
    if(label==='desktop') await page.locator('.voyage-card').filter({hasText:'Browser layout fixture'}).click();
    if(label==='mobile'){
        await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
        check(await page.locator('[data-slot="sheet-content"]').isVisible(),'mobile: shadcn navigation sheet did not open');
        await page.getByRole('button',{name:'Vessel connections',exact:true}).click();
        check(await page.getByRole('menuitem',{name:'Manage Vessels'}).isVisible(),'mobile: Vessel menu did not open inside the sheet');
        await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'Account and appearance'}).click();
        await page.getByRole('menuitem',{name:'Appearance settings',exact:true}).click();
        await page.getByRole('button',{name:'dark',exact:true}).click();
        check(await page.locator('html.dark').count()===1,'mobile: dark appearance did not apply');
        await page.getByRole('button',{name:'Close settings'}).click();
        await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
        await page.locator('.sidebar').click({position:{x:150,y:400}});
        await page.waitForTimeout(300);
        const selectTheme=await page.evaluate(()=>{const probe=document.createElement('span');probe.style.color='var(--foreground)';document.body.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return {expected,actual:getComputedStyle(document.querySelector('.sidebar [data-slot="select-combobox-trigger"]')).color};});
        const lightness=value=>Number(value.match(/\(([\d.]+)/)?.[1]);
        check(Math.abs(lightness(selectTheme.actual)-lightness(selectTheme.expected))<0.02,`mobile: native select foreground ${JSON.stringify(selectTheme)}`);
        await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-dark-empty.png`});
        await page.getByRole('button',{name:'Account and appearance'}).click();
        await page.getByRole('menuitem',{name:'Appearance settings',exact:true}).click();
        await page.getByRole('button',{name:'light',exact:true}).click();
        await page.getByRole('button',{name:'Close settings'}).click();
        await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
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
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-vessel-overview.png`});
    await vesselCard.getByRole('button',{name:'View details for Fixture Vessel'}).click();
    await page.locator('.connections-maintenance #update-current').getByText('1.0.2').waitFor();
    check(await page.locator('.connections-maintenance').getByText('Newer release published').count()===0,`${label}: another channel falsely claims a newer release`);
    check(await page.locator('.connections-maintenance').getByText('Published on another channel').isVisible(),`${label}: cross-channel build is not identified`);
    check(await page.locator('.connections-maintenance').isVisible(),`${label}: Vessel maintenance is missing from Manage Vessels`);
    check(await page.locator('.connections-dialog #update-check').isVisible(),`${label}: update action is not visible`);
    check(await page.locator('.connections-dialog').getByRole('button',{name:'Remove from Helm Web…'}).count()===0,`${label}: removal action is exposed before opening its disclosure`);
    check(await page.locator('.connections-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: Vessel manager overflows horizontally`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-vessel-maintenance.png`});
    check(await page.locator('#update-check').isDisabled(),`${label}: current stable build can be installed again`);
    await page.getByRole('button',{name:'Release channel',exact:true}).click();await page.getByRole('option',{name:'Latest development build',exact:true}).click();
    await page.locator('#update-selected-version').filter({hasText:'Latest development version: 1.0.3-nightly.20260928.1.1'}).waitFor();
    await page.locator('#update-check').click();
    await page.waitForFunction(()=>window.fixtureCommands.filter(c=>c.op==='update_apply').length===1);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='update_prepare').length===1),`${label}: one click did not prepare exactly once`);
    check(await page.evaluate(()=>window.fixtureCommands.find(c=>c.op==='update_prepare')?.channel==='nightly'),`${label}: selected channel was lost`);
    check(await page.evaluate(()=>window.fixtureCommands.find(c=>c.op==='update_apply')?.release_id==='a'.repeat(64)),`${label}: verified release identity was lost`);
    check(await page.locator('#update-review').isHidden(),`${label}: automatic install exposed a second approval step`);
    await page.locator('#update-status').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-vessel-updating.png`});
    await page.getByRole('button',{name:'Close Vessel connections'}).click();
    if(label==='mobile') await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
    await page.getByRole('button',{name:'Account and appearance'}).click();
    await page.getByRole('menuitem',{name:'Appearance settings',exact:true}).click();
    await page.getByRole('button',{name:'dark',exact:true}).click();
    await page.getByRole('button',{name:'Close settings'}).click();
    if(label==='mobile') await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
    check(await page.locator('html.dark').count()===1,`${label}: dark appearance did not apply to Vessel maintenance`);
    await page.getByRole('button',{name:'Vessel connections',exact:true}).click();
    await page.getByRole('menuitem',{name:'Manage Vessels'}).click();
    await page.locator('.connections-card').getByText('Version 1.0.2').waitFor();
    await page.waitForTimeout(180);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-vessel-overview-dark.png`});
    await page.locator('.connections-dialog').getByRole('button',{name:'View details for Fixture Vessel'}).click();
    await page.locator('#update-status').filter({hasText:/Installing|Checking the saved update/}).waitFor();
    await page.locator('#update-status').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-vessel-updating-dark.png`});
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='update_apply').length===1),`${label}: reopening repeated installation`);
    await page.getByRole('button',{name:'Close Vessel connections'}).click();
    if(label==='mobile') await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
    await page.getByRole('button',{name:'Account and appearance'}).click();
    await page.getByRole('menuitem',{name:'Appearance settings',exact:true}).click();
    await page.getByRole('button',{name:'light',exact:true}).click();
    await page.getByRole('button',{name:'Close settings'}).click();
    if(label==='mobile') await page.getByRole('button',{name:'Open voyage navigation',exact:true}).click();
    await page.locator('.voyage-card').filter({hasText:'Browser layout fixture'}).click();
    if(label==='mobile')await page.locator('.mobile-navigation').waitFor({state:'hidden'});
    const conversation=page.locator('.conversation:not([hidden])');
    await page.getByRole('button',{name:'Set goal',exact:true}).click();
    const goalDialog=page.getByRole('dialog',{name:'Set goal',exact:true});
    await goalDialog.getByRole('textbox',{name:'Objective',exact:true}).fill('Verify the synthetic output <script>plain text</script>');
    check(!await goalDialog.getByRole('checkbox').isChecked(),`${label}: continuation consent was preselected`);
    check(await goalDialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: Goal form overflows horizontally`);
    await goalDialog.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-goal-review.png`});
    await goalDialog.getByRole('button',{name:'Save paused goal',exact:true}).click();
    await page.getByRole('button',{name:'Goal · Paused',exact:true}).waitFor();
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='goal_update').length===1),`${label}: Goal set was not exactly once`);
    check(await page.evaluate(()=>window.fixtureCommands.find(c=>c.op==='goal_update').action.continue_automatically===false),`${label}: paused Goal acquired continuation`);
    await page.getByRole('button',{name:'Goal · Paused',exact:true}).click();
    const goalView=page.getByRole('dialog',{name:'Voyage goal',exact:true});
    check(await goalView.getByText('Verify the synthetic output <script>plain text</script>',{exact:true}).isVisible(),`${label}: canonical Goal objective missing`);
    check(await goalView.locator('script').count()===0,`${label}: Goal objective executed as HTML`);
    await goalView.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
    const goalBounds=await goalView.boundingBox();
    check(goalBounds.width>0&&goalBounds.x>=0&&goalBounds.y>=0&&goalBounds.x+goalBounds.width<=viewport.width&&goalBounds.y+goalBounds.height<=viewport.height,`${label}: short viewport clips Goal dialog`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-goal-state.png`});
    await page.keyboard.press('Escape');
    check(await page.getByRole('button',{name:'Goal · Paused',exact:true}).evaluate(el=>el===document.activeElement),`${label}: Goal close lost focus`);

    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-before-model.png`});
    check(await conversation.getByRole('button',{name:'Previous user message'}).count()===1,`${label}: turn navigation is missing`);
    // The synthetic fixture has no prior scroll restoration. Move to the last
    // user turn before asserting previous-turn navigation.
    await conversation.locator('.transcript').evaluate(element=>{element.scrollTop=element.scrollHeight;});
    await conversation.getByRole('button',{name:'Previous user message'}).waitFor({state:'visible'});
    await page.waitForFunction(() => !document.querySelector('.conversation:not([hidden]) [aria-label="Previous user message"]')?.disabled);
    const beforeTurn=await conversation.locator('.transcript').evaluate(element=>element.scrollTop);
    await conversation.getByRole('button',{name:'Previous user message'}).click();
    check(await conversation.locator('.transcript').evaluate(element=>element.scrollTop)<beforeTurn,`${label}: previous turn did not move the transcript`);
    const linkedMessage=conversation.locator('.message[data-message-index="35"]');
    await linkedMessage.getByRole('button',{name:'Copy message link'}).click();
    const copiedLink=await page.evaluate(()=>window.fixtureClipboard.at(-1));
    check(copiedLink.includes('/voyages/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222#turn-'),`${label}: message link lost its Voyage route`);
    check(!copiedLink.includes('Fixture request'),`${label}: message link included transcript text`);
    await page.evaluate(link=>{window.location.hash=new URL(link).hash;},copiedLink);
    await page.waitForFunction(()=>document.activeElement?.getAttribute('data-message-index')==='35');
    check(await conversation.locator('.message.user').first().textContent().then(text=>text.includes('You')),`${label}: author hierarchy missing`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-linked-turn-light.png`});
    await page.evaluate(()=>document.documentElement.classList.add('dark'));
    await conversation.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-linked-turn-dark.png`});
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));
    await page.evaluate(link=>{window.location.hash=new URL(link).hash.replace(/-r\d+$/,'-r999');},copiedLink);
    await conversation.getByRole('status').filter({hasText:'different conversation revision'}).waitFor();
    check(await page.evaluate(()=>window.fixtureCommands.length===0||!window.fixtureCommands.slice(-1).some(c=>c.op==='submit'||c.op==='steer')),`${label}: link dispatched a message`);
    await page.evaluate(()=>{window.location.hash='';});
    await page.getByRole('button',{name:/^Model:/}).click();
    const modelDialog=page.getByRole('dialog',{name:'Choose model',exact:true});
    await modelDialog.locator('[data-model-choice]').filter({hasText:'Fixture model'}).waitFor();
    for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
        const inspectDialog=async(state)=>{
            await modelDialog.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
            const bounds=await modelDialog.boundingBox();
            check(bounds.width>0&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,`${label}/${theme}/${state}: model dialog clips viewport`);
            const search=modelDialog.getByRole('textbox',{name:'Search models'});
            await search.focus();check(await search.evaluate(el=>el===document.activeElement),`${label}/${theme}/${state}: search unreachable`);
            await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-${viewport.height}-${theme}-${state}.png`});
        };
        await page.evaluate(()=>{window.fixtureCatalogueMode='loading';});
        await modelDialog.getByRole('button',{name:'Refresh',exact:true}).click();
        await modelDialog.getByText('Refreshing model choices…',{exact:true}).waitFor();
        await inspectDialog('loading-models');
        await page.evaluate(()=>{window.fixtureCatalogueMode='error';window.releaseFixtureCatalogue();});
        await modelDialog.getByRole('alert').waitFor();
        await inspectDialog('error-models');
        check(await modelDialog.getByRole('button',{name:'Retry',exact:true}).isEnabled(),`${label}/${theme}: retry unavailable after catalogue error`);
        await page.evaluate(()=>{window.fixtureCatalogueMode='normal';});
        await modelDialog.getByRole('button',{name:'Retry',exact:true}).click();
        await modelDialog.locator('[data-model-choice]').filter({hasText:'Fixture model'}).waitFor();
        await inspectDialog('populated-models');
    }
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));

    check(await modelDialog.locator('[data-model-choice][aria-pressed="true"]').count()===1,`${label}: current model is not marked`);
    await modelDialog.getByRole('textbox',{name:'Search models'}).fill('other');
    check(await modelDialog.locator('[data-model-choice]').count()===1,`${label}: model search did not filter`);
    await page.keyboard.press('ArrowDown');
    check(await modelDialog.locator('[data-model-choice]').evaluate(el=>el===document.activeElement),`${label}: keyboard search did not reach the model`);
    await modelDialog.getByRole('button',{name:'Save Other model to favorites'}).click();
    check(await modelDialog.locator('section[aria-label="Favorites"] [data-model-choice]').count()===1,`${label}: model favorite not grouped`);
    check(await modelDialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: model picker overflows horizontally`);
    async function inspectModelTheme(){
        await modelDialog.evaluate(el=>Promise.allSettled(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
        return modelDialog.evaluate(el=>{const probe=document.createElement('span');probe.style.backgroundColor='var(--popover)';probe.style.color='var(--popover-foreground)';el.append(probe);const expected=getComputedStyle(probe),actual=getComputedStyle(el);const result={background:actual.backgroundColor,color:actual.color,expectedBackground:expected.backgroundColor,expectedColor:expected.color};probe.remove();return result;});
    }
    const lightModelTheme=await inspectModelTheme();
    check(lightModelTheme.background===lightModelTheme.expectedBackground&&lightModelTheme.color===lightModelTheme.expectedColor,`${label}: light model picker does not use theme colors`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-model-picker-light.png`});
    await page.evaluate(()=>document.documentElement.classList.add('dark'));
    const darkModelTheme=await inspectModelTheme();
    check(darkModelTheme.background===darkModelTheme.expectedBackground&&darkModelTheme.color===darkModelTheme.expectedColor&&darkModelTheme.background!==lightModelTheme.background,`${label}: model picker does not adapt to dark appearance`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-model-picker-dark.png`});
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));
    const populatedModelBounds=await modelDialog.boundingBox();
    await modelDialog.getByRole('textbox',{name:'Search models'}).fill('missing-model');
    const emptyModelBounds=await modelDialog.boundingBox();
    check(Math.abs(populatedModelBounds.y-emptyModelBounds.y)<1&&Math.abs(populatedModelBounds.height-emptyModelBounds.height)<1,`${label}: empty search moves model dialog`);

    check(await modelDialog.getByText('No models match your search.',{exact:true}).isVisible(),`${label}: model search empty state missing`);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='set_account_inference').length===0),`${label}: searching changed inference settings`);
    await page.keyboard.press('Escape');
    check(await page.getByRole('button',{name:/^Model:/}).evaluate(el=>el===document.activeElement),`${label}: model picker lost trigger focus`);
    check(await page.getByRole('button',{name:/^Reasoning:/}).isVisible(),`${label}: direct reasoning control is missing`);
    const draft=conversation.locator('textarea').first();
    const existingControlGeometry=await inspectComposerControls(conversation.getByRole('form',{name:'Message composer'}),'existing');
    const contextLabel=page.getByLabel('Request context accounting');
    check(await contextLabel.textContent()==='Last prepared input: unknown tokens · window: unknown · reserve: unknown · projection 2',`${label}: context accounting changed or invented precision`);
    check(await contextLabel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: context status overflows`);
    await conversation.getByRole('button',{name:'Discover actions, tools, skills, and files'}).click();
    const discovery=page.getByRole('dialog',{name:'Composer actions'});
    await discovery.getByRole('button',{name:/review/}).waitFor();
    check(await discovery.getByRole('button',{name:/read_file/}).isVisible(),`${label}: live tool discovery is missing`);
    check(await discovery.getByRole('button',{name:'src/fixture.ts'}).isVisible(),`${label}: file catalogue is missing`);
    check(await discovery.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: discovery dialog overflows horizontally`);
    await discovery.evaluate(el=>Promise.allSettled(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-discovery-light.png`});
    await page.evaluate(()=>document.documentElement.classList.add('dark'));
    await page.waitForFunction(()=>{const dialog=document.querySelector('[role="dialog"][aria-labelledby]');if(!dialog)return false;const probe=document.createElement('span');probe.style.backgroundColor='var(--popover)';dialog.append(probe);const matches=getComputedStyle(probe).backgroundColor===getComputedStyle(dialog).backgroundColor;probe.remove();return matches;});
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-discovery-dark.png`});
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));
    await discovery.getByRole('textbox',{name:'Search actions, tools, skills, and files'}).fill('review');
    await discovery.getByRole('button',{name:/review/}).click();
    await discovery.waitFor({state:'detached'});
    check((await draft.inputValue()).includes('/work/.agents/skills/review/SKILL.md'),`${label}: selected skill did not enter the composer`);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='submit'||c.op==='steer').length===0),`${label}: discovery sent a message`);
    await draft.fill('');
    await conversation.getByRole('button',{name:'Discover actions, tools, skills, and files'}).click();
    await page.getByRole('dialog',{name:'Composer actions'}).getByRole('button',{name:'src/fixture.ts'}).click();
    await page.getByRole('dialog',{name:'Composer actions'}).waitFor({state:'detached'});
    check((await draft.inputValue()).includes('Read the workspace file "src/fixture.ts"'),`${label}: selected file did not enter the composer`);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='submit'||c.op==='steer').length===0),`${label}: file selection sent a message`);
    await draft.fill('');
    await draft.press('/');
    await page.getByRole('dialog',{name:'Composer actions'}).waitFor();
    await page.getByRole('dialog',{name:'Composer actions'}).evaluate(el=>Promise.allSettled(el.getAnimations({subtree:true}).map(animation=>animation.finished)));
    await page.getByRole('dialog',{name:'Composer actions'}).getByRole('textbox',{name:'Search actions, tools, skills, and files'}).press('Escape');
    await page.getByRole('dialog',{name:'Composer actions'}).waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.activeElement===document.querySelector('.conversation:not([hidden]) textarea[aria-label="Message"]'));
    check(await draft.evaluate(el=>el===document.activeElement),`${label}: closing slash discovery did not restore composer focus`);
    await draft.fill('Retained synthetic draft');
    if(label==='desktop'){
        await page.getByRole('button',{name:'Account and appearance'}).click();
        await page.getByRole('menuitem',{name:'Sign out'}).click();
        check(await page.getByRole('dialog',{name:'Sign out with unsent work?'}).isVisible(),'desktop: unsent draft sign-out review did not open');
        await page.getByRole('button',{name:'Keep working'}).click();
        check(await draft.inputValue()==='Retained synthetic draft','desktop: cancelling sign-out lost the draft');
    }
    await page.waitForTimeout(250);
    const editingSource=conversation.locator('.message.user').first();
    const savedComposerText=await draft.inputValue();
    await editingSource.getByRole('button',{name:'Edit as draft',exact:true}).click();
    const editDialog=page.getByRole('dialog',{name:'Edit message as a draft'});
    await editDialog.getByLabel('Edited message text').waitFor();
    check(await editDialog.getByLabel('Edited message text').inputValue()==='Fixture request 1',`${label}: message edit lost canonical text`);
    await editDialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await editDialog.waitFor({state:'detached'});
    check(await editingSource.getByRole('button',{name:'Edit as draft',exact:true}).evaluate(el=>el===document.activeElement),`${label}: cancelling message edit lost trigger focus`);
    await editingSource.getByRole('button',{name:'Edit as draft',exact:true}).click();
    await editDialog.getByLabel('Edited message text').waitFor();
    await editDialog.getByRole('button',{name:savedComposerText?'Add to draft':'Prepare draft',exact:true}).click();
    await editDialog.waitFor({state:'detached'});
    check((await draft.inputValue()).includes('Fixture request 1')&& (!savedComposerText||(await draft.inputValue()).startsWith(savedComposerText)),`${label}: editing replaced unsent work without review`);
    check(await draft.evaluate(el=>el===document.activeElement),`${label}: prepared edit did not return composer focus`);
    await draft.fill(savedComposerText);
    await editingSource.getByRole('button',{name:'Branch from here',exact:true}).click();
    const branchDialog=page.getByRole('dialog',{name:'Branch',exact:true});
    await branchDialog.getByRole('button',{name:'Create branch',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#sidebar-branch')?.value==='0');
    check(await branchDialog.locator('#sidebar-branch').isDisabled(),`${label}: selected branch boundary can move`);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>['branch','submit','steer'].includes(c.op)).length===0),`${label}: message review dispatched an effect`);
    await branchDialog.getByRole('button',{name:'Close',exact:true}).click();
    await branchDialog.waitFor({state:'detached'});
    await conversation.locator('.transcript').evaluate(el=>{el.scrollTop=321;window.savedTranscript=el;window.savedDraft=document.querySelector('.conversation:not([hidden]) textarea');});
    const geometry=()=>page.evaluate(()=>{
        const rect=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
        const transcript=document.querySelector('.conversation:not([hidden]) .transcript');
        const toggle=document.querySelector('.task-browser-action');const r=toggle.getBoundingClientRect();
        return {toggle:rect('.task-browser-action'),toggleHit:toggle.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),panel:rect('.task-browser-panel'),composer:rect('.conversation:not([hidden]) form'),draft:rect('.conversation:not([hidden]) textarea'),transcript:rect('.conversation:not([hidden]) .transcript'),scrollTop:transcript.scrollTop,scrollHeight:transcript.scrollHeight,documentWidth:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('.conversation:not([hidden]) *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,70),right:el.getBoundingClientRect().right})),primary:rect('.browser-primary'),privacy:rect('.browser-privacy'),activeLabel:document.activeElement.getAttribute('aria-label'),sameTranscript:transcript===window.savedTranscript,sameDraft:document.querySelector('.conversation:not([hidden]) textarea')===window.savedDraft};
    });
    const before=await geometry();
    for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
        const visibleGeometry=await page.evaluate(()=>[...document.querySelectorAll('.conversation:not([hidden]) .tool-group-heading')].map(el=>{const r=el.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,text:el.textContent};}));
        check(visibleGeometry.every(r=>r.width>0&&r.left>=0&&r.right<=viewport.width),`${label}/${viewport.width}/${theme}: header or summary exceeds viewport`);
        check(await conversation.locator('.tool-group-heading').filter({hasText:'returned'}).count()>0,`${label}/${theme}: normal tool outcome missing`);
        check(await conversation.locator('.tool-group-heading').filter({hasText:'unsuccessful'}).count()>0,`${label}/${theme}: warning outcome missing`);
        await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-${viewport.height}-${theme}-summary-header.png`});
    }

    check(await conversation.locator('.conversation-header').count()===0,`${label}/${viewport.width}: visible conversation header returned`);
    check(await conversation.getByRole('region',{name:'Selected voyage context'}).count()===1,`${label}: selected context missing`);
    const actionGeometry=await page.locator('.dock-actions').evaluate(el=>{
        const r=el.getBoundingClientRect();const transcript=document.querySelector('.conversation:not([hidden]) .thread').getBoundingClientRect();
        return {left:r.left,right:r.right,bottom:r.bottom,threadTop:transcript.top};
    });
    check(actionGeometry.left>=0&&actionGeometry.right<=viewport.width,`${label}: action dock outside viewport`);
    check(actionGeometry.bottom<=actionGeometry.threadTop,`${label}: action dock overlaps first transcript content`);
    check(before.documentWidth<=viewport.width,`${label}/${viewport.width}: document overflows horizontally`);

    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-closed.png`});
    await page.getByRole('button',{name:'Changes',exact:true}).click();
    check(await page.getByLabel('Recorded changes').isVisible(),`${label}: recorded changes dock did not open`);
    await page.getByLabel('Changed files').getByRole('button',{name:/src\/fixture\.ts/}).waitFor();
    await page.getByLabel('Current Git diff').waitFor();
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='operator_tool').length===0),`${label}: opening Changes started an operator run`);
    await page.getByText('Inspect workspace explicitly').click();
    check(await page.getByLabel('Executing-host inspection').isVisible(),`${label}: explicit inspection is missing`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-workspace.png`});
    await page.getByRole('button',{name:'Recorded edits',exact:true}).click();
    check(await page.getByText('src/fixture.ts').first().isVisible(),`${label}: recorded patch path is missing`);
    await page.waitForTimeout(180);
    if(label==='mobile')check(await page.locator('.task-browser-panel').evaluate(el=>Math.abs(el.getBoundingClientRect().width-innerWidth)<1),`${label}: review dock does not fill the viewport`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-changes.png`});
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await page.locator('.task-browser-panel').waitFor({state:'detached'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    check(await page.getByRole('button',{name:'Changes',exact:true}).evaluate(el=>el===document.activeElement),`${label}: closing Changes did not restore its trigger focus`);
    await page.getByRole('button',{name:'Files',exact:true}).click();
    await page.getByLabel('Workspace files').waitFor();
    await page.getByLabel('Workspace filename list').getByRole('button',{name:'docs/new.md',exact:true}).waitFor();
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='workspace_file').length===0),`${label}: Files opening read content before selection`);
    await page.getByLabel('Find workspace file').fill('new');
    await page.getByLabel('Workspace filename list').getByRole('button',{name:'docs/new.md',exact:true}).click();
    await page.getByLabel('Current file preview').waitFor();
    check((await page.getByLabel('Current file preview').textContent()).includes('# Current file preview'),`${label}: current file content is missing`);
    const draftBeforeFile=await draft.inputValue();
    await page.getByRole('button',{name:'Add reference to draft',exact:true}).click();
    check((await draft.inputValue()).startsWith(draftBeforeFile)&& (await draft.inputValue()).includes('docs/new.md'),`${label}: file reference lost existing draft`);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>['operator_tool','submit','steer'].includes(c.op)).length===0),`${label}: Files review dispatched a run`);
    check(await page.getByLabel('Workspace files').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${label}: Files panel overflows horizontally`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-files-light.png`});
    await page.getByRole('button',{name:'Close panel',exact:true}).click();
    await page.locator('.task-browser-panel').waitFor({state:'detached'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    check(await page.getByRole('button',{name:'Files',exact:true}).evaluate(el=>el===document.activeElement),`${label}: closing Files did not restore its trigger focus`);
    await draft.fill(draftBeforeFile);
    await page.getByRole('button',{name:'Browser',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.host-browser-viewer')?.querySelector('.browser-next-mirror'));
    await page.waitForTimeout(150);
    const opened=await geometry();
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-open.png`});
    await page.getByRole('button',{name:'Browse privately',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.browser-primary')?.textContent==='Continue agent'&&!document.querySelector('.browser-primary')?.hidden);
    const privateState=await geometry();
    const privateLabel=await page.locator('.browser-primary').textContent();
    const privateAccessibleLabel=await page.locator('.browser-primary').getAttribute('aria-label');
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-private.png`});
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
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const closed=await geometry();
    check(await page.getByRole('button',{name:'Browser',exact:true}).evaluate(el=>el===document.activeElement),`${label}: closing Browser did not restore its trigger focus`);
    const retained=await draft.inputValue();
    const commands=await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='host_browser').map(c=>c.operation.action));
    check(commands.includes('detach')&&!commands.includes('close'),`${label}: close did not detach or stopped browser`);
    check(retained==='Retained synthetic draft' && closed.sameDraft && closed.sameTranscript,`${label}: draft/transcript DOM not retained`);
    // Escape follows the currently selected dock, including an in-panel tab
    // switch. It never targets the Browser action captured at initial opening.
    await page.getByRole('button',{name:'Changes',exact:true}).click();
    await page.locator('.task-browser-panel').getByRole('button',{name:'Files',exact:true}).click();
    await page.getByLabel('Workspace files').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.task-browser-panel').waitFor({state:'detached'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    check(await page.getByRole('button',{name:'Files',exact:true}).evaluate(el=>el===document.activeElement),`${label}: Escape after dock switch restored the wrong trigger`);
    // Read-only Settings navigation: no profile mutation or inference application.
    const settingsWritesBefore=await page.evaluate(()=>window.fixtureCommands.filter(c=>['save_profile','set_account_inference','submit','steer'].includes(c.op)).length);
    await conversation.getByRole('button',{name:/^Account:/}).click();
    const settings=page.locator('.profile-setup');
    await settings.getByRole('button',{name:/^Profile/}).click();
    await settings.getByRole('button',{name:'Actions for Fixture profile',exact:true}).click();
    await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
    await settings.getByRole('button',{name:'Account usage',exact:true}).click();
    await page.evaluate(()=>{window.fixtureUsageDeferred=true;});
    await settings.getByRole('button',{name:'Refresh usage',exact:true}).click();
    await settings.getByText('Loading usage…',{exact:true}).waitFor();
    check(await settings.getByRole('button',{name:'Back',exact:true}).isEnabled(),`${label}: usage read blocks Back`);
    check(await settings.getByRole('button',{name:'Close settings',exact:true}).isEnabled(),`${label}: usage read blocks Close`);
    await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await page.evaluate(()=>window.releaseFixtureUsage());
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>['save_profile','set_account_inference','submit','steer'].includes(c.op)).length)===settingsWritesBefore,`${label}: dismissing usage read applied settings`);
    await conversation.getByRole('button',{name:/^Account:/}).click();
    await settings.getByRole('button',{name:/^Profile/}).click();
    await settings.getByRole('button',{name:'Actions for Fixture profile',exact:true}).click();
    await page.getByRole('menuitem',{name:'Edit',exact:true}).click();
    await settings.getByRole('textbox',{name:'Profile name',exact:true}).fill('Unsaved fixture name');
    await settings.getByRole('button',{name:/^Model/}).click();
    await settings.getByRole('searchbox',{name:'Search models',exact:true}).fill('Other');
    await settings.getByRole('button',{name:/Other model/}).click();
    await settings.getByRole('button',{name:/Reasoning & service/}).click();
    const reasoning=settings.getByRole('slider',{name:'Reasoning',exact:true});
    check(await reasoning.getAttribute('aria-valuetext')==='Provider default',`${label}: reasoning exposes numeric rather than semantic default`);
    await settings.getByRole('button',{name:'Back',exact:true}).click();
    check(await settings.getByRole('textbox',{name:'Profile name',exact:true}).inputValue()==='Unsaved fixture name',`${label}: navigation lost unsaved profile name`);
    check(await settings.getByRole('button',{name:/^Model/}).textContent().then(text=>text.includes('Other model')),`${label}: navigation lost unsaved model`);
    await settings.getByRole('button',{name:'Account usage',exact:true}).click();
    await page.evaluate(()=>{window.fixtureUsageDeferred=true;});
    await settings.getByRole('button',{name:'Refresh usage',exact:true}).click();
    await settings.getByText('Loading usage…',{exact:true}).waitFor();
    await settings.getByRole('button',{name:'Back',exact:true}).click();
    check(await settings.getByRole('textbox',{name:'Profile name',exact:true}).inputValue()==='Unsaved fixture name',`${label}: pending usage Back lost draft`);
    check(await settings.getByRole('button',{name:'Close settings',exact:true}).isEnabled(),`${label}: abandoned usage read blocks editor Close`);
    for(const theme of ['light','dark']){
        await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
        const bounds=await settings.boundingBox();
        check(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=viewport.width&&bounds.y+bounds.height<=viewport.height,`${label}/${theme}: profile editor clips viewport`);
        const close=settings.getByRole('button',{name:'Close settings',exact:true});await close.focus();
        check(await close.evaluate(el=>el===document.activeElement),`${label}/${theme}: profile Close unreachable`);
        await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-${theme}-unsaved-profile.png`});
    }
    await settings.getByRole('button',{name:'Close settings',exact:true}).click();
    await page.evaluate(()=>window.releaseFixtureUsage());
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>['save_profile','set_account_inference','submit','steer'].includes(c.op)).length)===settingsWritesBefore,`${label}: unsaved navigation applied changes`);
    // Explicit user close, not malformed initial stopped attach, exercises lifecycle.
    await page.getByRole('button',{name:'Browser',exact:true}).click();
    const viewer=page.locator('.host-browser-viewer');
    await viewer.getByLabel('More browser options').click();
    await viewer.getByRole('button',{name:'Use browser',exact:true}).click();
    await viewer.getByRole('button',{name:'Continue agent',exact:true}).waitFor({state:'visible'});
    await viewer.getByLabel('More browser options').click();
    await viewer.getByRole('button',{name:'Close browser',exact:true}).click();
    await viewer.getByText('Browser stopped',{exact:true}).waitFor();
    check(await viewer.getByText('This browser is stopped. Start a browser before browsing or entering text.',{exact:true}).isVisible(),`${label}: stopped guidance missing`);
    check(await viewer.getByRole('button',{name:'Browse privately',exact:true}).isDisabled(),`${label}: stopped privacy remained enabled`);
    check(await page.evaluate(()=>window.fixtureCommands.filter(c=>c.op==='host_browser'&&c.operation.action==='close').length===1),`${label}: user close was not exactly once`);
    await page.screenshot({path:`${output}/${runOutcome}-${label}-${viewport.width}-valid-stopped.png`});
    report.viewports.push({runOutcome,label,viewport,before,opened,privateState,closed,commands,errors,draftControlGeometry,existingControlGeometry});
    await context.close();
 }
} catch(error) {
 const failedPage=browser.contexts().at(-1)?.pages().at(-1);
 if(failedPage){
  console.error('FAILED FIXTURE UI:',(await failedPage.locator('body').innerText()).slice(-16000));
  console.error('LAST FIXTURE COMMANDS:',JSON.stringify(await failedPage.evaluate(()=>window.fixtureCommands.slice(-12))));
  await failedPage.screenshot({path:`${output}/failed-layout.png`});
 }
 report.failures.push(String(error));
 throw error;
} finally {
 await writeFile(`${output}/measurements.json`,JSON.stringify(report,null,2)+'\n');
 await browser.close();await new Promise(r=>server.close(r));
}
console.log(JSON.stringify(report,null,2));
assert.equal(report.failures.length,0,report.failures.join('\n'));
