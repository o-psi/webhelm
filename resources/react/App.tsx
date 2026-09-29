import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuTrigger} from './components/ui/dropdown-menu';
import {NativeSelect} from './components/ui/native-select';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {Button} from './components/ui/button';
import {Card} from './components/ui/card';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from './components/ui/collapsible';
import {Sheet,SheetContent,SheetDescription,SheetTitle,SheetTrigger} from './components/ui/sheet';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog';
import {ArrowDownIcon,ArrowUpIcon,CheckIcon,ChevronDownIcon,ChevronRightIcon,CopyIcon,MenuIcon,PaperclipIcon,PlusIcon,RefreshCwIcon,SearchIcon,ServerIcon,Settings2Icon,SquareIcon,UserRoundIcon,XIcon} from 'lucide-react';
import {HostBrowser} from './HostBrowser';
import {GoalPanel} from './Goal';
import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ToolGroup,threadRows,toolTrigger} from './ToolGroup';
import {Connections} from './Connections';
import {ImagePart,Output} from './MessageParts';
import {VoyageActions} from './VoyageActions';
import {Settings} from './Settings';
import {WebSettings,type WebSettingsPage} from './WebSettings';
import {InferenceControls} from './InferenceControls';
import {NewVoyage,type NewVoyageMessage,type RecoveryDraft} from './NewVoyage';
import {completeNewVoyage} from './new-voyage-delivery';
import {Decisions} from './Decisions';
import {VesselFleet} from '../js/vessel-fleet.js';
import {voyageList, filterVoyages, activityLabel, cardStatus, sidebarGroups} from './presentation';
import {marked} from 'marked';
import DOMPurify from 'dompurify';
import {Workspace, type Tab} from './workspace';
import {voyageLocation, voyagePath} from './voyage-url';
import workingStatuses from '../../shared/helm/assets/working-statuses.json';

type Bootstrap = {tenantId: string; vessels: any[]; ticketUrl: string; connectionsUrl: string; logoutUrl: string; accountName?: string; accountEmail?: string; plan?: string; vesselLimit?: number; paidThrough?: string | null; billingEnabled?: boolean; billingCheckoutUrl?: string; billingPortalUrl?: string | null};
const csrf = () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || '';
function content(value: unknown): string {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(part => part?.text || (part?.type === 'image' ? '[Image attachment]' : JSON.stringify(part))).join('\n');
    return value == null ? '' : JSON.stringify(value, null, 2);
}
export function prose(text: string) {
    return DOMPurify.sanitize(marked.parse(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'')) as string, {ALLOWED_TAGS:['p','br','strong','em','del','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','hr','a','table','thead','tbody','tr','th','td'], ALLOWED_ATTR:['href','title'], ALLOW_DATA_ATTR:false});
}
export function CopyResponse({tab,workspace,message}:{tab:Tab;workspace:Workspace;message:any}){
    const [copied,setCopied]=useState(false),[error,setError]=useState(false);
    const copy=async()=>{
        try{
            const text=message.projection_truncated&&Number.isSafeInteger(message.message_index)?await workspace.canonicalMessage(tab.key,message.message_index,tab.snapshot.revision):message.projection_truncated?null:content(message.content);
            if(typeof text!=='string')throw new Error('Complete response unavailable.');
            await navigator.clipboard.writeText(text);
            setCopied(true);setError(false);
            window.setTimeout(()=>setCopied(false),2000);
        }catch{setError(true);}
    };
    return <div className="message-actions"><Button variant="ghost" size="sm" type="button" aria-label={copied?'Response copied':'Copy response'} title={error?'Copy unavailable. Open the complete message and try again.':'Copy complete response'} onClick={()=>void copy()}>{copied?<CheckIcon aria-hidden="true"/>:<CopyIcon aria-hidden="true"/>}<span>{error?'Copy unavailable':copied?'Copied':'Copy'}</span></Button></div>;
}
function Composer({tab, workspace, onSettings, onRecover, connection, voyage}: {tab?: Tab; workspace: Workspace; onSettings:()=>void; onRecover?:()=>void; connection?:any; voyage?:any}) {
    const fileInput = useRef<HTMLInputElement>(null);
    const [attaching,setAttaching] = useState(false);
    const pickFiles = async (files: File[]) => {
        if (!tab || !files.length) return;
        setAttaching(true);
        try { await workspace.attach(tab.key,files); } finally { setAttaching(false); }
    };
    const activeRun = ['accepted','running','awaiting_decision','starting'].includes(tab?.snapshot?.run?.state);
    const stopping = ['cancel_requested','cancelling'].includes(tab?.snapshot?.run?.state);
    const running = activeRun || stopping;
    const sendOp = running ? 'steer' : 'submit';
    const enabled = tab && !stopping && workspace.actionable(tab,sendOp) && workspace.permitted(tab,sendOp);
    const canStop = tab && activeRun && workspace.actionable(tab) && workspace.permitted(tab,'cancel');
    const send = () => { if (tab && enabled) void workspace.act(tab.key, sendOp); };
    const pendingState=(()=>{try{return {entries:tab?workspace.pending(tab):[],error:false};}catch{return {entries:[],error:true};}})();
    const pendingEntries=pendingState.entries;
    const blocked=pendingEntries.length>0||pendingState.error;
    const earlierMessageOnly=Boolean(!pendingState.error&&pendingEntries.length&&pendingEntries.every((entry:any)=>['submit','submit_content','steer'].includes(entry.op)));
    return <form className="composer" aria-label="Message composer" onPaste={event=>{if(tab&&event.clipboardData.files.length){event.preventDefault();void pickFiles([...event.clipboardData.files]);}}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{if(tab&&event.dataTransfer.files.length){event.preventDefault();void pickFiles([...event.dataTransfer.files]);}}} onSubmit={event => {event.preventDefault(); send();}}>
        <Card className="composer-box gap-2 p-3 shadow-sm" size="sm"><Input ref={fileInput} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" multiple hidden onChange={event=>{const files=[...(event.target.files||[])];event.target.value='';void pickFiles(files);}}/>{attaching && <p className="composer-feedback" role="status">Preparing pictures…</p>}{(tab?.notice||blocked)&&<div className="composer-feedback" role="status"><p>{pendingState.error?'Recovery record is unavailable. This voyage is paused to avoid repeating an uncertain action.':earlierMessageOnly?'An earlier message is unconfirmed. You can keep chatting; check the conversation before repeating that request.':tab?.notice||'A previous action needs confirmation. Check the receipt before trying again.'}</p>{blocked&&<div className="flex flex-wrap items-center gap-2">{pendingEntries.length>0&&<Button variant="ghost" size="sm" type="button" disabled={tab?.busy||!connection?.client} onClick={() => tab && void workspace.reconcile(tab.key)}>Check receipt{pendingEntries.length>1?'s':''}</Button>}{onRecover&&!earlierMessageOnly&&<Button variant="outline" size="sm" type="button" onClick={onRecover}>Continue in a new voyage</Button>}</div>}{pendingEntries.length>0&&<details><summary>Receipt details</summary><ul>{pendingEntries.map((entry:any)=><li key={entry.command_id}><code>{entry.op} · {entry.command_id}</code>{tab?.receiptStates?.[entry.command_id]&&<span> · {tab.receiptStates[entry.command_id].replaceAll('_',' ')}</span>}</li>)}</ul></details>}</div>}{!!tab?.pictures.length&&<div className="pictures">{tab.pictures.map(picture=><figure key={picture.id}><img src={picture.url} alt={picture.name}/><figcaption>{picture.name}</figcaption><Button variant="outline" size="icon-xs" type="button" disabled={tab.busy} aria-label={`Remove ${picture.name}`} onClick={()=>workspace.removePicture(tab.key,picture.id)}><XIcon aria-hidden="true"/></Button></figure>)}</div>}<Textarea className="border-0 bg-transparent px-0 py-0 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent" aria-label="Message" rows={2} value={tab?.draft || ''} disabled={!tab} onChange={event => tab && workspace.draft(tab.key,event.target.value)} placeholder="Ask anything…" onKeyDown={event => {if(event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing){event.preventDefault();send();}}}/>
        <div className="composer-toolbar"><div className="composer-options">
            <Button variant="ghost" type="button" onClick={onSettings} title="Voyage settings" aria-label="Voyage settings"><Settings2Icon aria-hidden="true"/><span className="sr-only">Voyage settings</span></Button>
            <Button variant="ghost" type="button" disabled={!tab||tab.busy||attaching} aria-label="Attach pictures" title="Attach pictures" onClick={()=>fileInput.current?.click()}><PaperclipIcon aria-hidden="true"/></Button>
            {tab&&connection&&tab.snapshot?.inference&&<InferenceControls tab={tab} workspace={workspace} connection={connection}/>}
            {connection&&voyage&&<VoyageActions connection={connection} voyage={voyage} onChanged={()=>workspace.connectionChanged()} accessTrigger triggerLabel={`Access: ${{'read-only':'Read only',approval:'Approval',unrestricted:'Full access'}[tab?.snapshot?.access as 'read-only'|'approval'|'unrestricted']||'Unknown'}`}/>}
        </div>{running && <Button variant="outline" type="button" aria-label="Stop run" disabled={!canStop} onClick={() => tab && void workspace.act(tab.key,'cancel')}><SquareIcon aria-hidden="true"/>{stopping?'Stopping…':'Stop run'}</Button>}<Button variant="default" aria-label={sendOp === 'steer' ? 'Send to current run' : 'Send'} disabled={!enabled || (!tab?.draft.trim() && !tab?.pictures.length)}><ArrowUpIcon aria-hidden="true"/>{sendOp === 'steer' ? 'Send to current run' : 'Send'}</Button></div><small className="composer-hint">Enter to send · Shift+Enter for a new line</small></Card>
    </form>;
}
// Decorative only: the words and frames are not execution progress or transcript content.
export function workingFrame(frame: number) {
    return {word: workingStatuses[Math.floor(frame / 40) % workingStatuses.length], spinner: ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'][frame % 10]};
}
function WorkingIndicator() {
    const [frame, setFrame] = useState(0);
    useEffect(() => {
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (motion.matches) return;
        const epoch = performance.now();
        const timer = window.setInterval(() => setFrame(Math.floor((performance.now() - epoch) / 100)), 100);
        return () => window.clearInterval(timer);
    }, []);
    const {word, spinner} = workingFrame(frame);
    return <span className="working-indicator" aria-label="Working"><span className="working-spinner" aria-hidden="true">{spinner}</span> <span className="working-word" aria-hidden="true">{word}</span></span>;
}

export function RunStatus({tab}: {tab: Tab}) {
    const snapshot = tab.snapshot, run = snapshot?.run;
    if (!snapshot) return null;
    const active = ['accepted', 'running', 'awaiting_decision', 'cancel_requested'].includes(run?.state);
    const pending = Boolean(snapshot.pending_cleanup_run);
    const show = run && (active || run.state !== 'completed' || pending || Boolean(run.live_text));
    const working = !tab.stale && !snapshot.recovery_pending && run?.state === 'running' && !tab.decisions.length;
    const labels: Record<string, string> = {accepted:'Starting', running:'Working', awaiting_decision:'Waiting for you', cancel_requested:'Stopping', completed:'Finishing response…', failed:'Needs attention', cancelled:'Stopped', interrupted:'Interrupted'};
    const cleanup = snapshot.cleanup?.run_id === run?.run_id ? snapshot.cleanup : null;
    return <div className="run-status" role="status" aria-live="polite">
        {snapshot.recovery_notice && <p>{snapshot.recovery_notice}</p>}
        {show && <><p className="run-status-label">{working ? <WorkingIndicator/> : tab.stale && run.state === 'running' ? 'Status unavailable' : snapshot.recovery_pending ? 'Previous run interrupted · saved output' : active && tab.decisions.length ? 'Waiting for you' : labels[run.state] || 'Needs attention'}</p>
            {run.failure_summary && <p>{run.failure_summary}</p>}
            {!active && cleanup?.reason && <p>{cleanup.reason}</p>}
            {pending && !active && <><p>{cleanup?.phase === 'running' ? 'Finishing cleanup. Your draft is kept.' : cleanup?.retryable ? 'Cleanup needs attention. Send again to retry cleanup; your draft is kept.' : 'Previous program cleanup cannot yet be verified. Recovery checks automatically; your draft is kept.'}</p>
                {(cleanup?.pending || []).map((component: string, index: number)=><p key={index}>Waiting for: {component}</p>)}</>}
            {!active && !pending && !snapshot.lifecycle?.archived && ['cancelled','interrupted','failed'].includes(run.state) && <p>Ready to continue.</p>}
        </>}
    </div>;
}

export function Conversation({tab, workspace, active, onSettings, onRecover, connection, voyage}: {tab: Tab; workspace: Workspace; active: boolean; onSettings:()=>void; onRecover?:()=>void; connection?:any; voyage?:any}) {
    const run = tab.snapshot?.run, scroll = useRef<HTMLDivElement>(null), following = useRef(tab.following ?? true);
    const loadingHistory = useRef(false), retryHistoryAt = useRef(0), wasActive = useRef(active);
    const [showJump,setShowJump] = useState(false);
    const [turnNavigation,setTurnNavigation]=useState({previous:false,next:false});
    useEffect(() => {if(active && scroll.current) {
        if (active && !wasActive.current && tab.scrollTop !== undefined) scroll.current.scrollTop = following.current ? scroll.current.scrollHeight : tab.scrollTop;
        wasActive.current = active;
    }},[active,tab.snapshot]);
    const turnPositions=()=>{
        const container=scroll.current;
        if(!container)return [];
        const top=container.getBoundingClientRect().top;
        return [...container.querySelectorAll<HTMLElement>('.message.user')].map(message=>message.getBoundingClientRect().top-top+container.scrollTop-12);
    };
    const updateTurnNavigation=()=>{
        const top=scroll.current?.scrollTop||0,positions=turnPositions();
        const previous=positions.some(position=>position<top-40),next=positions.some(position=>position>top+40);
        setTurnNavigation(current=>current.previous===previous&&current.next===next?current:{previous,next});
    };
    const jumpTurn=(direction:'previous'|'next')=>{
        const container=scroll.current;if(!container)return;
        const positions=turnPositions(),top=container.scrollTop;
        const target=direction==='previous'?positions.filter(position=>position<top-40).at(-1):positions.find(position=>position>top+40);
        if(target==null)return;
        following.current=false;tab.following=false;container.scrollTo({top:target,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
        updateTurnNavigation();
    };
    const loadNearTop = () => {
        const el = scroll.current, offset = tab.snapshot?.message_offset;
        if (!active || !el || !offset || tab.busy || loadingHistory.current || Date.now() < retryHistoryAt.current) return;
        // Preload within one eighth of the visible transcript; also fill short histories.
        if (el.scrollTop > el.clientHeight / 8 && el.scrollHeight > el.clientHeight) return;
        loadingHistory.current = true;
        following.current = false; tab.following = false;
        const height = el.scrollHeight, top = el.scrollTop;
        void workspace.earlier(tab.key).then(() => {
            if (tab.snapshot?.message_offset === offset) retryHistoryAt.current = Date.now() + 3000;
            requestAnimationFrame(() => {
                if (scroll.current === el) {
                    following.current = false;
                    el.scrollTop = top + el.scrollHeight - height;
                    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight >= 80);
                }
                loadingHistory.current = false;
                // If a page still does not fill the viewport, fetch another bounded page.
                if (scroll.current === el && el.scrollHeight <= el.clientHeight && tab.snapshot?.message_offset !== offset) loadNearTop();
            });
        });
    };
    useEffect(() => {if (active) {loadNearTop();updateTurnNavigation();}}, [active, tab.snapshot?.message_offset, tab.snapshot?.messages]);
    const renderMessage=(message:any)=>{return <article key={message.message_index} className={`message ${message.role}`}>
                    {['tool','function'].includes(message.role) ? <pre>{content(message.content)}</pre> : <><span className="sr-only">{message.role}</span><div className="prose" dangerouslySetInnerHTML={{__html:prose(message.parts?.length?message.parts.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n'):content(message.content))}}/></>}
                    {message.interrupted_attempt&&<small className="message-meta">Interrupted attempt</small>}
                    {message.parts?.filter((part:any)=>part.type==='image').map((part:any,index:number)=><ImagePart key={part.attachment?.id||index} attachment={part.attachment} tab={tab} workspace={workspace}/>)}
                    {message.projection_truncated && <Button variant="ghost" disabled={tab.busy} onClick={()=>void workspace.expand(tab.key,message.message_index)}>Read complete message</Button>}
                    {message.role==='assistant'&&Boolean(content(message.content).trim())&&<CopyResponse tab={tab} workspace={workspace} message={message}/>}
                </article>;};
    const headerStatus=voyage?cardStatus(voyage,Boolean(connection?.client),tab.stale?null:tab.snapshot):null;
    const location=[connection?.name,tab.snapshot?.workspace].filter(Boolean).join(' · ');
    return <section className="conversation" hidden={!active} aria-label={tab.title}>
        <header className="conversation-header"><div className="conversation-title"><h1 title={tab.title}>{tab.title}</h1>{location&&<p title={location}>{location}</p>}</div>{headerStatus&&<span className="status-label" data-status-tone={headerStatus.tone} data-animated={headerStatus.animated||undefined}><i aria-hidden="true"/>{headerStatus.label}</span>}</header>
        <div className="transcript" ref={scroll} tabIndex={0} aria-label="Conversation messages" onScroll={() => {const el=scroll.current!;tab.scrollTop=el.scrollTop;following.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;tab.following=following.current;setShowJump(!following.current);updateTurnNavigation();loadNearTop();}}><div className="thread">
            {!tab.snapshot && <p className="empty">Waiting for a current Vessel snapshot…</p>}
            {threadRows(tab.snapshot?.messages||[]).map(row=>row.entries?<ToolGroup key={row.key} entries={row.entries} running={['running','starting','cancelling'].includes(run?.state)} messageStart={run?.message_start} decisions={tab.decisions.length>0} renderMessage={renderMessage}/>:<React.Fragment key={row.key}>{renderMessage(row.message)}</React.Fragment>)}
            <Output tab={tab} workspace={workspace}/>
            {(run?.tool_previews || []).filter((preview:any)=>!(tab.snapshot?.messages||[]).some((message:any)=>message.tool_calls?.some((call:any)=>call.id===preview.call_id))).map((preview:any,index:number) => <Collapsible className="tool-entry" key={index}><CollapsibleTrigger asChild><Button variant="ghost" className={toolTrigger} type="button"><ChevronRightIcon className="tool-chevron" aria-hidden="true"/><span className="tool-summary-text">Tool preview · {preview.name || 'Tool'}</span></Button></CollapsibleTrigger><CollapsibleContent><pre>{content(preview.arguments)}</pre></CollapsibleContent></Collapsible>)}
            {(run?.reasoning_previews||[]).map((preview:any,index:number)=><Collapsible className="tool-entry" key={index}><CollapsibleTrigger asChild><Button variant="ghost" className={toolTrigger} type="button"><ChevronRightIcon className="tool-chevron" aria-hidden="true"/><span className="tool-summary-text">{preview.kind==='summary'?'Reasoning summary':'Provider thinking'} · {preview.finalized?'finalized disclosure':'streaming · provisional'}</span></Button></CollapsibleTrigger><CollapsibleContent><pre>{preview.text}</pre>{preview.truncated&&<small>Preview truncated</small>}</CollapsibleContent></Collapsible>)}
            <RunStatus tab={tab}/>
        </div>{(turnNavigation.previous||turnNavigation.next||showJump)&&<div className="jump-anchor"><div className="turn-navigation" role="group" aria-label="Conversation navigation"><Button variant="ghost" size="icon-sm" type="button" aria-label="Previous user message" title="Previous user message" disabled={!turnNavigation.previous} onClick={()=>jumpTurn('previous')}><ArrowUpIcon aria-hidden="true"/></Button><Button variant="ghost" size="icon-sm" type="button" aria-label="Next user message" title="Next user message" disabled={!turnNavigation.next} onClick={()=>jumpTurn('next')}><ArrowDownIcon aria-hidden="true"/></Button>{showJump&&<Button variant="ghost" size="sm" className="jump-latest" type="button" onClick={() => {following.current=true;tab.following=true;setShowJump(false);scroll.current?.scrollTo({top:scroll.current.scrollHeight});}}>Latest<ArrowDownIcon aria-hidden="true"/></Button>}</div></div>}</div>
        <GoalPanel tab={tab} workspace={workspace}/>
        <Decisions tab={tab} workspace={workspace}/>
        <Composer tab={tab} workspace={workspace} onSettings={onSettings} onRecover={onRecover} connection={active?connection:null} voyage={active?voyage:null}/>
    </section>;
}

export function App({bootstrap}: {bootstrap: Bootstrap}) {
    const [runtime] = useState(() => {
        let workspace: Workspace;
        const fleet = new VesselFleet(bootstrap.vessels, {tenantId: bootstrap.tenantId, changed: () => workspace.connectionChanged(false), ticket: async (vessel: string) => {
            const response = await fetch(bootstrap.ticketUrl, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-TOKEN': csrf()}, body: JSON.stringify({vessel})});
            if (!response.ok) throw Object.assign(new Error('Vessel authorization unavailable'), {permanent: [401, 403, 404, 419].includes(response.status)});
            return response.json();
        }});
        workspace = new Workspace(() => fleet.connections);
        return {fleet, workspace};
    });
    const {fleet, workspace} = runtime;
    useSyncExternalStore(workspace.subscribe, workspace.getVersion, workspace.getVersion);
    const [active, setActive] = useState<string | null>(null), [query, setQuery] = useState('');
    const [vesselFilter,setVesselFilter] = useState('all'), [stateFilter,setStateFilter] = useState('current'),[settledOpen,setSettledOpen]=useState(false);
    const [route, setRoute] = useState(() => typeof window === 'undefined' ? null : voyageLocation(window.location.pathname));
    const selectVoyage = (vessel: string, session: string, title: string) => {
        const path = voyagePath(vessel, session);
        if (window.location.pathname !== path) window.history.pushState(null, '', path + window.location.search + window.location.hash);
        const key=workspace.open(vessel, session, title);
        setRoute({vessel, session}); setActive(key); setMobile(false);
        return key;
    };
    useEffect(() => {
        const changed = () => setRoute(voyageLocation(window.location.pathname));
        window.addEventListener('popstate', changed);
        return () => window.removeEventListener('popstate', changed);
    }, []);
    useEffect(() => {
        fleet.start(); const timer = setInterval(() => { fleet.poll(); for (const key of workspace.tabs.keys()) { if (workspace.needsRefresh(key)) void workspace.refresh(key); void workspace.observePending(key); } workspace.changed(); }, 5000);
        return () => { clearInterval(timer); workspace.close(); fleet.close(); };
    }, [runtime]);
    const [manage,setManage] = useState(()=>typeof location!=='undefined'&&new URLSearchParams(location.search).has('manage-vessels'));
    const [settings,setSettings] = useState<{tab?:Tab}|null>(null);
    const [webSettingsPage,setWebSettingsPage] = useState<WebSettingsPage|null>(null);
    const [newDraftReset,setNewDraftReset]=useState(0),[profileReload,setProfileReload]=useState(0);
    const [recovery,setRecovery]=useState<RecoveryDraft|null>(null);
    const [mobile,setMobile] = useState(false);
    const [mobilePortal,setMobilePortal] = useState<HTMLElement|null>(null);
    const [appearance,setAppearance] = useState(() => {try{return localStorage.getItem('flux.appearance') || 'system';}catch{return 'system';}});
    const [logoutReview,setLogoutReview] = useState(false);
    const logoutForm=useRef<HTMLFormElement>(null);
    useEffect(() => {
        const media=window.matchMedia('(prefers-color-scheme: dark)');
        const update=()=>document.documentElement.classList.toggle('dark',appearance==='dark'||(appearance==='system'&&media.matches));
        update();media.addEventListener('change',update);try{localStorage.setItem('flux.appearance',appearance);}catch{}
        return ()=>media.removeEventListener('change',update);
    },[appearance]);
    const connections=[...fleet.connections.values()], allVoyages=voyageList(connections,query,(connection,voyage)=>{const tab=workspace.tabs.get(JSON.stringify([connection.id,voyage.session_id]));return tab&&!tab.stale&&Date.now()-tab.freshAt<35000?tab.snapshot:null;});
    const voyages=filterVoyages(allVoyages,vesselFilter,stateFilter);
    useEffect(() => {
        if (!route) { setActive(null); return; }
        const connection = fleet.connections.get(route.vessel);
        const voyage = connection?.voyages.find((item: any) => item.session_id === route.session);
        if (voyage) setActive(workspace.open(route.vessel, route.session, voyage.name || route.session));
        else setActive(null); // Never open an unlisted voyage or borrow another Vessel's session.
    }, [route?.vessel, route?.session, fleet.connections.get(route?.vessel || '')?.voyages.some((item: any) => item.session_id === route?.session), runtime]);
    const selected=active && route && active === JSON.stringify([route.vessel, route.session]) ? workspace.tabs.get(active) : null;
    const grouped=sidebarGroups(voyages,selected?.key||null,voyage=>{
        const tab=workspace.tabs.get(JSON.stringify([voyage.connection.id,voyage.session_id]));
        let pendingReceipts=0;try{if(tab)pendingReceipts=workspace.pending(tab).length;}catch{/* Unavailable journal state is shown in the open voyage. */}
        return {decisions:tab&&!tab.stale?tab.decisions.length:0,pendingReceipts};
    });
    const groupedView=!query.trim()&&vesselFilter==='all'&&stateFilter==='current';
    const showNew=()=>{
        if(window.location.pathname!=='/')window.history.pushState(null,'','/'+window.location.search+window.location.hash);
        setRoute(null);setActive(null);setMobile(false);
    };
    const startNew=()=>{setRecovery(null);showNew();};
    const recoverInNewVoyage=(tab:Tab)=>{
        setRecovery({vessel:tab.vessel,workspace:tab.snapshot?.workspace||'',text:tab.draft,hasPictures:tab.pictures.length>0,source:tab.title});
        showNew();
    };
    const deliverNewVoyage=async(vessel:string,process:any,message:NewVoyageMessage)=>{
        const key=selectVoyage(vessel,process.session_id,process.name||'New voyage');
        setRecovery(null);
        setNewDraftReset(value=>value+1);
        await completeNewVoyage(workspace,key,message);
    };
    const row=(voyage:any)=>{
        const key=JSON.stringify([voyage.connection.id,voyage.session_id]),tab=workspace.tabs.get(key);
        const status=cardStatus(voyage,Boolean(voyage.connection.client),tab&&!tab.stale ? tab.snapshot : null);
        let pendingReceipts=0;try{if(tab)pendingReceipts=workspace.pending(tab).length;}catch{/* The open voyage shows journal errors. */}
        return <div className="voyage-row" key={key}><button type="button" className="voyage-card py-2" data-status-tone={status.tone} data-animated={status.animated || undefined} aria-current={selected?.key===key} onClick={()=>selectVoyage(voyage.connection.id,voyage.session_id,voyage.name||voyage.session_id)}>
            <span className="card-topline"><span className="card-vessel" title={voyage.connection.name}>{voyage.connection.name}</span><span className="card-status status-label" title={[status.label,status.detail].filter(Boolean).join(' · ')}><i aria-hidden="true"/>{status.label.startsWith('Last run ')?status.label.slice(9):status.label}</span></span>
            <span className="card-title" title={voyage.name||voyage.session_id}>{voyage.name||voyage.session_id}{tab?.draft && <span className="card-draft" title="Unsent draft"> •</span>}</span><span className="card-activity"><time title={voyage.activity?.iso}>{activityLabel(voyage.activity)}</time>{pendingReceipts>0&&' · Check receipt'}</span>
        </button><VoyageActions connection={voyage.connection} voyage={voyage} onChanged={()=>workspace.connectionChanged()} portalContainer={mobilePortal}/></div>;
    };
    const sidebar=<aside className={`sidebar ${mobile?'mobile-open':''}`} aria-label="Voyages">
            <header className="sidebar-heading"><h2>Voyages <span>{voyages.length}{voyages.length!==allVoyages.length?` of ${allVoyages.length}`:''}</span></h2><Button variant="default" size="icon" onClick={startNew} aria-label="New voyage" title="New voyage"><PlusIcon aria-hidden="true"/></Button><Button variant="ghost" size="icon" className="mobile-close lg:hidden" aria-label="Close voyage navigation" onClick={()=>setMobile(false)}><XIcon aria-hidden="true"/></Button></header>
            <div className="search"><SearchIcon aria-hidden="true"/><Input aria-label="Find a voyage or Vessel" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search voyages…" className="pl-9"/></div>
            <div className="grid grid-cols-2 gap-2"><label className="sr-only" htmlFor="voyage-vessel-filter">Filter by Vessel</label><NativeSelect id="voyage-vessel-filter" value={vesselFilter} onChange={event=>setVesselFilter(event.target.value)}><option value="all">All Vessels</option>{connections.map(connection=><option key={connection.id} value={connection.id}>{connection.name}</option>)}</NativeSelect><label className="sr-only" htmlFor="voyage-state-filter">Filter by status</label><NativeSelect id="voyage-state-filter" value={stateFilter} onChange={event=>setStateFilter(event.target.value)}><option value="current">Current</option><option value="active">Active</option><option value="available">Not active</option><option value="archived">Archived</option><option value="all">All states</option></NativeSelect></div>
            <nav className="voyage-list" aria-label="Voyages">{groupedView?<>
                {([['attention','Needs you'],['working','Working'],['recent','Recent']] as const).map(([kind,title])=>grouped[kind].length>0&&<div key={kind} className="grid gap-0.5"><h3 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">{title} · {grouped[kind].length}</h3>{grouped[kind].map(row)}</div>)}
                {grouped.settled.length>0&&<div className="grid gap-0.5"><Button variant="ghost" type="button" className="mt-2 w-full justify-start text-xs text-muted-foreground" aria-expanded={settledOpen} onClick={()=>setSettledOpen(value=>!value)}><ChevronRightIcon className={settledOpen?'rotate-90':''} aria-hidden="true"/>Settled · {grouped.settled.length}</Button>{settledOpen&&grouped.settled.map(row)}</div>}
            </>:voyages.map(row)}{!voyages.length && <div className="grid gap-2 p-2"><p className="empty">{query||vesselFilter!=='all'||stateFilter!=='current'?'No voyages match these filters.':'No current voyages.'}</p>{(query||vesselFilter!=='all'||stateFilter!=='current')&&<Button variant="outline" type="button" onClick={()=>{setQuery('');setVesselFilter('all');setStateFilter('current');}}>Clear filters</Button>}</div>}</nav>
            <footer className="sidebar-footer"><p className="connection-state" role="status">{selected ? selected.stale?'Reconnecting…':`Connected · ${selected.snapshot?.run?.state||'idle'}` : connections.some((c:any)=>c.client)?'Ready':connections.length?'Connecting…':'No Vessels connected'}</p>
                <div className="footer-controls">
                    <div className="connections"><DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" type="button" className="connections-trigger w-full justify-between gap-2 px-1.5 text-xs font-normal" aria-label="Vessel connections"><ServerIcon aria-hidden="true"/><span>{connections.filter((c:any)=>c.client).length}/{connections.length} connected</span><ChevronDownIcon aria-hidden="true"/></Button></DropdownMenuTrigger>
                        <DropdownMenuContent portalContainer={mobilePortal} side="top" align="start" className="w-64"><DropdownMenuLabel>Vessel connections</DropdownMenuLabel>{connections.map((c:any)=><p className="px-2 py-1 text-xs text-muted-foreground" key={c.id}>{c.name} · {c.status}</p>)}<DropdownMenuItem onSelect={()=>{setMobile(false);setManage(true);}}>Manage Vessels</DropdownMenuItem></DropdownMenuContent>
                    </DropdownMenu></div>
                    {connections.some((connection:any)=>!connection.client)&&<Button variant="ghost" size="icon" className="icon-button" aria-label="Reconnect Vessels" title="Reconnect Vessels" onClick={()=>fleet.reconnect()}><RefreshCwIcon aria-hidden="true"/></Button>}
                    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="icon-button" aria-label="Account and appearance"><UserRoundIcon aria-hidden="true"/></Button></DropdownMenuTrigger>
                        <DropdownMenuContent portalContainer={mobilePortal} side="top" align="end" className="w-48"><DropdownMenuLabel>Settings</DropdownMenuLabel><DropdownMenuItem onSelect={()=>{setMobile(false);setWebSettingsPage('account');}}>HelmWeb Account</DropdownMenuItem><DropdownMenuItem onSelect={()=>{setMobile(false);setWebSettingsPage('appearance');}}>Appearance</DropdownMenuItem><DropdownMenuItem onSelect={()=>{setMobile(false);setManage(true);}}>Vessel connections</DropdownMenuItem><DropdownMenuItem onSelect={()=>{if([...workspace.tabs.values()].some(tab=>tab.draft.trim()||tab.pictures.length))setLogoutReview(true);else logoutForm.current?.requestSubmit();}}>Sign out</DropdownMenuItem></DropdownMenuContent>
                    </DropdownMenu>
                    <form ref={logoutForm} action={bootstrap.logoutUrl} method="post" hidden><Input type="hidden" name="_token" value={csrf()}/></form>
                </div>
            </footer>
        </aside>;
    return <div className="helm-console">
        <Sheet open={mobile} onOpenChange={setMobile}>
            <SheetTrigger asChild><Button variant="outline" size="icon" className="mobile-toggle lg:hidden" aria-label="Open voyage navigation" aria-expanded={mobile}><MenuIcon aria-hidden="true"/></Button></SheetTrigger>
            <SheetContent ref={setMobilePortal} side="left" showCloseButton={false} className="mobile-navigation"><SheetTitle className="sr-only">Voyages</SheetTitle><SheetDescription className="sr-only">Choose a voyage or manage Vessel connections.</SheetDescription>{mobile&&sidebar}</SheetContent>
        </Sheet>
        {!mobile&&sidebar}
        <main className="voyage-workspace" aria-label="Conversation"><NewVoyage fleet={fleet} tenant={bootstrap.tenantId} hidden={Boolean(route)} resetToken={newDraftReset} reloadToken={profileReload} recovery={recovery} onCreated={deliverNewVoyage} onAdvanced={()=>setSettings({})}/>
            {route && !selected && <p className="empty" role="status">Waiting for this voyage on its Vessel. If it does not appear, check your connection or access.</p>}
            {selected && <HostBrowser key={selected.key} tab={selected} client={fleet.connections.get(selected.vessel)?.client} workspace={workspace}/> }
            {[...workspace.tabs.values()].map(tab=><Conversation key={tab.key} tab={tab} workspace={workspace} active={selected?.key===tab.key} onSettings={()=>setSettings({tab})} onRecover={()=>recoverInNewVoyage(tab)} connection={fleet.connections.get(tab.vessel)} voyage={fleet.connections.get(tab.vessel)?.voyages.find((item:any)=>item.session_id===tab.session)}/>)}
        </main>
        {manage&&<Connections bootstrap={bootstrap} states={Object.fromEntries(connections.map(connection => [connection.id, {connected: Boolean(connection.client), status: connection.status}]))} connections={fleet.connections} tenant={bootstrap.tenantId} onReconnect={()=>fleet.reconnect()} onAccountSettings={()=>{setManage(false);setWebSettingsPage('account');}} onClose={()=>setManage(false)}/>}
        {settings&&<Settings fleet={fleet} workspace={workspace} tab={settings.tab} profileOnly={!settings.tab} tenant={bootstrap.tenantId} onClose={()=>{setSettings(null);setProfileReload(value=>value+1);}} onCreated={(vessel,process)=>selectVoyage(vessel,process.session_id,process.name||'New voyage')}/>}
        {webSettingsPage&&<WebSettings account={bootstrap} page={webSettingsPage} onPageChange={setWebSettingsPage} appearance={appearance} onAppearanceChange={setAppearance} onManageVessels={()=>{setWebSettingsPage(null);setManage(true);}} onClose={()=>setWebSettingsPage(null)}/>}
        <Dialog open={logoutReview} onOpenChange={setLogoutReview}><DialogContent><DialogHeader><DialogTitle>Sign out with unsent work?</DialogTitle><DialogDescription>Unsent message drafts and prepared pictures in this browser will be lost. Your voyages continue on their Vessels.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" type="button" onClick={()=>setLogoutReview(false)}>Keep working</Button><Button variant="destructive" type="button" onClick={()=>logoutForm.current?.requestSubmit()}>Sign out</Button></DialogFooter></DialogContent></Dialog>
    </div>;
}
