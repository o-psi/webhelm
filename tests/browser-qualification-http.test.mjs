import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import net from 'node:net';
const cwd=resolve(import.meta.dirname,'..');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<200;i++){if(await check())return;await wait(25);}throw Error('bounded fixture observation missing');}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
// Adapt __DIR__ only for generated files; source maps never target another checkout.
function loaderSource(){return `$loader=require ${JSON.stringify(join(cwd,'vendor/autoload.php'))}; $loader->setPsr4('App\\\\',${JSON.stringify(join(cwd,'app'))}); foreach(['Services/ConsoleAccess','Services/BrowserQualificationMailbox','Http/Controllers/BrowserQualificationController'] as $name) $loader->addClassMap(['App\\\\'.str_replace('/','\\\\',$name)=>${JSON.stringify(join(cwd,'app'))}.'/'.$name.'.php']);`;}
test('normal HTTP operator/tenant/revision/CSRF gates and original-response publication',{timeout:60000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'helm-coordination-http-'));const db=join(dir,'db.sqlite');writeFileSync(db,'');
 const brokerDir=join(dir,'benign'),original=join(dir,'original'),views=join(dir,'views'),storage=join(dir,'storage'),publicPath=join(dir,'public');
 for(const child of [brokerDir,original,views,join(publicPath,'build'),...['framework/views','framework/sessions','framework/cache','logs'].map(s=>join(storage,s))])mkdirSync(child,{recursive:true,mode:0o700});
 const key=randomBytes(32);writeFileSync(join(brokerDir,'key'),key,{mode:0o600});writeFileSync(join(original,'key'),key,{mode:0o600});
 const state=join(dir,'state.json'),calls=join(dir,'calls.jsonl');writeFileSync(state,JSON.stringify({mode:'normal'}),{mode:0o600});
 writeFileSync(join(publicPath,'build/manifest.json'),JSON.stringify({'resources/css/app.css':{file:'assets/fixture.css',isEntry:true},'resources/js/browser-qualification.js':{file:'assets/fixture.js',isEntry:true}}));
 const env={...process.env,LARAVEL_STORAGE_PATH:storage,APP_ENV:'local',APP_DEBUG:'false',APP_KEY:`base64:${randomBytes(32).toString('base64')}`,APP_URL:'https://helm.example',VIEW_COMPILED_PATH:views,DB_CONNECTION:'sqlite',DB_DATABASE:db,SESSION_DRIVER:'database',CACHE_STORE:'array',SESSION_SECURE_COOKIE:'false',SESSION_COOKIE:'helm_coordination_test',HELM_WEB_ENABLED:'true',HELM_WEB_GATEWAY_SECRET:'',HELM_WEB_LEGACY_GATEWAY_ENABLED:'false',STRIPE_PAYMENT_LINK_BILLING_ENABLED:'false'};
 const php=code=>{const r=spawnSync('php',['-r',`${loaderSource()} $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); ${code}`],{cwd,env,encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout;};
 const migrate=spawnSync('php',['artisan','migrate','--force'],{cwd,env,encoding:'utf8',timeout:10000});assert.equal(migrate.status,0,migrate.stdout+migrate.stderr);
 const seed=JSON.parse(php(`$out=[];foreach(['alice','bob'] as $name){$t=App\\Models\\Tenant::create(['name'=>$name,'principal_id'=>(string)Illuminate\\Support\\Str::uuid()]);$u=App\\Models\\User::create(['name'=>$name,'email'=>$name.'@example.test','tenant_id'=>$t->id]);$v=App\\Models\\VesselConnection::create(['tenant_id'=>$t->id,'name'=>'Owned synthetic fixture','endpoint'=>'https://vessel.example','vessel_id'=>(string)Illuminate\\Support\\Str::uuid(),'revision'=>1,'credential'=>['token'=>str_repeat('a',64),'grant_id'=>(string)Illuminate\\Support\\Str::uuid()]]);$s=$app['session']->driver();$s->flush();$s->regenerate();Illuminate\\Support\\Facades\\Auth::login($u);$s->put('helm_operator_until',time()+3600);$s->save();$cookie=encrypt(Illuminate\\Cookie\\CookieValuePrefix::create('helm_coordination_test',$app['encrypter']->getKey()).$s->getId(),false);$out[$name]=['tenant'=>$t->id,'principal'=>$t->principal_id,'connection'=>$v->id,'vessel'=>$v->vessel_id,'cookie'=>$cookie,'csrf'=>$s->token(),'session'=>$s->getId()];}echo json_encode($out);`));
 const now=Math.floor(Date.now()/1000),job=randomUUID(),a=seed.alice;
 const fixed=['--job-id',job,'--tenant-id',a.tenant,'--connection-id',a.connection,'--principal-id',a.principal,'--vessel-id',a.vessel,'--connection-revision','1','--created-at',String(now),'--expires-at',String(now+120),'--labels','a','b'];
 let broker,bridge,server,pins=null;const children=[];
 const child=(command,args,options)=>{const p=spawn(command,args,options);children.push(p);p.stderr?.resume();return p;};
 let jar={};const call=async(path,options={},who='alice')=>{
  const r=await fetch(`http://127.0.0.1:${port}${path}`,{redirect:'manual',...options,headers:{Accept:'application/json',...(who?{Cookie:jar[who]||`helm_coordination_test=${encodeURIComponent(seed[who].cookie)}`} :{}),...options.headers}});
  if(who){const cookie=r.headers.getSetCookie().find(c=>c.startsWith('helm_coordination_test='));if(cookie)jar[who]=cookie.split(';')[0];}return r;
 };
 const port=await freePort(),base=`/console/qualification/browser/${job}`;
 const mode=value=>writeFileSync(state,JSON.stringify({mode:value}),{mode:0o600});
 const send=(response,headers={})=>call(base+'/response',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':a.csrf,Origin:'https://helm.example',...headers},body:JSON.stringify({response})});
 const issue=()=>{const request={schema:1,id:randomUUID(),kind:'cua_web',operation:{operation:'observe_counter',label:'a',selector:'#count',value:1},expires_at_ms:Date.now()+45000};request.digest=createHash('sha256').update(JSON.stringify(request)).digest('hex');writeFileSync(join(original,request.id+'.request.json'),JSON.stringify(request),{mode:0o600});return request;};
 const response=q=>({schema:1,id:q.id,digest:q.digest,status:'observed',result:{counter_matches:true,no_input_sent:true}});
 try{
  broker=child('/usr/bin/python3',['deploy/browser-qualification-helper.py','broker',...fixed,'--key-file',join(brokerDir,'key'),'--socket',join(brokerDir,'coord.sock')],{cwd,stdio:['ignore','pipe','pipe']});
  let buffered='';broker.stdout.on('data',b=>{buffered+=b;const i=buffered.indexOf('\n');if(i>=0)pins=JSON.parse(buffered.slice(0,i));});await until(()=>pins);
  bridge=child('/usr/bin/python3',['deploy/browser-qualification-helper.py','bridge',...fixed,'--key-file',join(original,'key'),'--mailbox',original,'--port',String(pins.port)],{cwd,stdio:['ignore','ignore','pipe']});
  Object.assign(env,{HELM_BROWSER_QUALIFICATION_ENABLED:'true',HELM_BROWSER_QUALIFICATION_JOB:job,HELM_BROWSER_QUALIFICATION_SOCKET:pins.socket,HELM_BROWSER_QUALIFICATION_SOCKET_DEV:String(pins.socket_dev),HELM_BROWSER_QUALIFICATION_SOCKET_INO:String(pins.socket_ino),HELM_BROWSER_QUALIFICATION_DIRECTORY_DEV:String(pins.directory_dev),HELM_BROWSER_QUALIFICATION_DIRECTORY_INO:String(pins.directory_ino),HELM_BROWSER_QUALIFICATION_PID:String(pins.helper_pid),HELM_BROWSER_QUALIFICATION_START_TICKS:String(pins.helper_start_ticks)});
  const router=join(dir,'router.php');writeFileSync(router,`<?php define('LARAVEL_START',microtime(true));${loaderSource()} $app=require ${JSON.stringify(join(cwd,'bootstrap/app.php'))};$app->usePublicPath(${JSON.stringify(publicPath)});$app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();$mode=json_decode(file_get_contents(${JSON.stringify(state)}),true)['mode'];if($mode==='disabled')config(['browser_qualification.enabled'=>false]);if($mode==='bad_pin')config(['browser_qualification.socket_ino'=>'0']);if($mode==='bad_pid')config(['browser_qualification.helper_start_ticks'=>'0']);$app->instance(App\\Services\\PublicVesselHttp::class,new class($mode) extends App\\Services\\PublicVesselHttp {public function __construct(private string $mode){} public function post(string $origin,string $path,array $body,array $headers=[]):array {if($path!=='/v1/vessel/command'||$body!==['protocol'=>1,'command'=>['op'=>'capabilities']])throw new RuntimeException('Unexpected mutation');file_put_contents(${JSON.stringify(calls)},json_encode(['operation'=>'capabilities'])."\\n",FILE_APPEND);if($this->mode==='revision_during_probe')Illuminate\\Support\\Facades\\DB::table('vessel_connections')->where('id','${a.connection}')->update(['revision'=>2]);if($this->mode==='logout_after_prepare'){$remaining=2;Illuminate\\Support\\Facades\\DB::listen(function($query)use(&$remaining){if($remaining>0&&str_contains($query->sql,'from "users"')){if(--$remaining===0)Illuminate\\Support\\Facades\\DB::table('sessions')->where('id','${a.session}')->delete();}});}return ['protocol'=>1,'error'=>null,'outcome_unknown'=>false,'result'=>['protocol'=>1,'vessel_id'=>$headers['x-voyage-vessel'],'features'=>[],'scope'=>$this->mode==='not_owner'?'workspace':'owner']];}});$app->handleRequest(Illuminate\\Http\\Request::capture());`);
  server=child('php',['-S',`127.0.0.1:${port}`,'-t','public',router],{cwd,env,stdio:['ignore','ignore','pipe']});await until(async()=>{try{return (await call('/up')).status===200;}catch{return false;}});
  const q=issue();await until(async()=>{const r=await call(base+'/request');return r.status===200&&(await r.json()).request?.id===q.id;});
  const html=await (await call(base,{headers:{Accept:'text/html'}})).text();assert.match(html,/Read issued request/);assert.match(html,/Coordination response/);assert.ok(!html.includes('a'.repeat(64)));
  assert.equal((await call(base+'/request',{},null)).status,401);
  assert.equal((await call(base+'/request',{},'bob')).status,404);
  assert.equal((await call(base.replace(job,randomUUID())+'/request')).status,404);
  for(const [value,status] of [['disabled',404],['bad_pin',502],['bad_pid',502],['not_owner',403]]){mode(value);assert.equal((await call(base+'/request')).status,status);}
  mode('normal');assert.equal((await send(response(q),{'X-CSRF-TOKEN':'wrong'})).status,419);
  assert.equal((await send(response(q),{Origin:'https://other.example'})).status,403);
  assert.equal((await send({...response(q),command:'forbidden'})).status,502);
  for(const [body,expected] of [['{"response":'+JSON.stringify(response(q))+',"response":'+JSON.stringify(response(q))+'}',422], ['{"response":{',422], [JSON.stringify({response:{...response(q),schema:2}}),502]]){
   const r=await call(base+'/response',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':a.csrf,Origin:'https://helm.example'},body});assert.equal(r.status,expected);
  }
  assert.equal((await call(base+'/response',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':a.csrf,Origin:'https://helm.example'},body:JSON.stringify({response:response(q),path:'/forbidden'})})).status,422);
  mode('revision_during_probe');assert.equal((await send(response(q))).status,403);assert.equal(existsSync(join(original,q.id+'.response.json')),false);
  php(`Illuminate\\Support\\Facades\\DB::table('vessel_connections')->where('id','${a.connection}')->update(['revision'=>1]);`);
  mode('normal');const accepted=await send(response(q));assert.equal(accepted.status,200,await accepted.clone().text());assert.deepEqual(await accepted.json(),{accepted:true});await until(()=>existsSync(join(original,q.id+'.response.json')));
  assert.deepEqual(JSON.parse(readFileSync(join(original,q.id+'.response.json'),'utf8')),response(q));
  assert.equal((await send(response(q))).status,502);await until(async()=>{const r=await call(base+'/request');return (await r.json()).answered.includes(q.id);});
  const late=issue();await until(async()=>{const r=await call(base+'/request');return (await r.json()).request?.id===late.id;});
  mode('logout_after_prepare');assert.equal((await send(response(late))).status,401);assert.equal(existsSync(join(original,late.id+'.response.json')),false);
  mode('normal');assert.equal((await call(base+'/request')).status,401);
  assert.equal(php("echo Illuminate\\Support\\Facades\\DB::table('web_gateway_tickets')->count();"),'0');
  const operations=readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);assert.ok(operations.length>0&&operations.every(v=>v.operation==='capabilities'));
 }finally{
  for(const p of children.reverse())if(p.exitCode===null){p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),wait(2000)]);if(p.exitCode===null){p.kill('SIGKILL');await new Promise(r=>p.once('exit',r));}}
  rmSync(dir,{recursive:true,force:true});
 }
});
