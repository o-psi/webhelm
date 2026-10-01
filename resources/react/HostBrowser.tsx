import {Button} from './components/ui/button';
import {FilesIcon,GlobeIcon,Maximize2Icon,Minimize2Icon,XIcon} from 'lucide-react';
import {Sheet,SheetContent,SheetDescription,SheetTitle,SheetTrigger} from './components/ui/sheet';
import React, {useEffect, useId, useRef, useState} from 'react';
import {mountHostBrowser} from '../js/host-browser.js';
import {ReviewChanges} from './ReviewChanges';
import {WorkspaceFiles} from './WorkspaceFiles';
import type {Tab,Workspace} from './workspace';

// Message metadata, not prose: mentioning a tool is not browser activity.
export function browserActivity(snapshot: any): boolean {
    const calls = new Set<string>();
    const named = (name: unknown) => typeof name === 'string' && /^(?:functions\.)?host_browser$/.test(name);
    for (const message of snapshot?.messages || []) {
        for (const call of message.tool_calls || []) {
            if (named(call.name ?? call.function?.name)) calls.add(call.id);
        }
        if (named(message.name) && ['tool', 'function'].includes(message.role)) return true;
    }
    return calls.size > 0 || (snapshot?.run?.tool_previews || []).some((call: any) => named(call.name));
}

// Only the selected voyage and its exact live socket may own a viewer.
export function HostBrowser({tab, client, workspace}: {tab: Tab; client: any; workspace:Workspace}) {
    const [open, setOpen] = useState(false);
    const [view,setView]=useState<'browser'|'changes'|'files'>('browser');
    const [expanded, setExpanded] = useState(false);
    const [mobile,setMobile] = useState(()=>typeof window!=='undefined'&&Boolean(window.matchMedia?.('(max-width: 1000px)').matches));
    const [viewerRoot,setViewerRoot] = useState<HTMLDivElement|null>(null);
    const panel = useRef<HTMLElement>(null), browserToggle = useRef<HTMLButtonElement>(null),changesToggle=useRef<HTMLButtonElement>(null),filesToggle=useRef<HTMLButtonElement>(null);
    const latest = useRef(tab);
    const returnFocus = useRef<{view:'browser'|'changes'|'files';vessel:string;session:string;incarnation:string|null}|null>(null);
    latest.current = tab;
    const id = useId();
    const activity = browserActivity(tab.snapshot);
    const ready = Boolean(client);
    const close = () => {
        const origin=latest.current;
        returnFocus.current={view,vessel:origin.vessel,session:origin.session,incarnation:origin.incarnation};
        setExpanded(false);setOpen(false);
    };
    const show=(next:'browser'|'changes'|'files')=>{if(open&&view===next){close();return;}returnFocus.current=null;setView(next);setExpanded(false);setOpen(true);};
    const restoreFocus=(origin:NonNullable<typeof returnFocus.current>)=>{
        if(returnFocus.current!==origin)return;
        returnFocus.current=null;
        const current=latest.current;
        if(current.vessel!==origin.vessel||current.session!==origin.session||current.incarnation!==origin.incarnation)return;
        const trigger=(origin.view==='browser'?browserToggle:origin.view==='files'?filesToggle:changesToggle).current;
        if(trigger?.isConnected&&!trigger.disabled)trigger.focus();
    };
    useEffect(()=>{
        if(open||mobile||!returnFocus.current)return;
        const origin=returnFocus.current;
        // Desktop panel removal, viewer disposal and inert restoration finish
        // before focus returns. Mobile waits for the sheet's cleanup event.
        const frame=requestAnimationFrame(()=>restoreFocus(origin));
        return()=>cancelAnimationFrame(frame);
    },[open,mobile,tab.vessel,tab.session,tab.incarnation]);
    useEffect(()=>{
        const media=window.matchMedia?.('(max-width: 1000px)');
        if(!media)return;
        const update=()=>setMobile(media.matches);
        update();media.addEventListener?.('change',update);
        return()=>media.removeEventListener?.('change',update);
    },[]);
    useEffect(() => {
        if (!open || view!=='browser' || !ready || !viewerRoot) return;
        const viewer = mountHostBrowser(viewerRoot, {
            client, sessionId: tab.session, incarnation: tab.incarnation,
            context: () => ({revision: latest.current.snapshot?.revision, refresh:latest.current.stale || !latest.current.incarnation}),
            onClose: close, externalClose:true,
        });
        // Shared viewer auto-connects on mount; disposal detaches, never closes the browser.
        return () => {viewer.dispose();};
    }, [open, view, viewerRoot, ready, client, tab.vessel, tab.session, tab.incarnation]);
    useEffect(() => {
        if (!open || mobile) return;
        panel.current?.focus();
    },[open,mobile]);
    useEffect(()=>{
        if(!open||mobile)return;
        const key = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event.key === 'Escape') { event.preventDefault(); close(); }
        };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, [open,mobile,view]);
    useEffect(() => {
        if (!open || !expanded || mobile) return;
        const conversation = panel.current?.closest('.voyage-workspace')?.querySelector<HTMLElement>(':scope > .conversation');
        if (!conversation) return;
        const previous = conversation.inert; conversation.inert = true;
        return () => {conversation.inert = previous;};
    }, [open, expanded,mobile]);
    const changesAction=<Button variant="outline" ref={changesToggle} className="review-action" type="button" aria-label="Changes" aria-expanded={open&&view==='changes'} aria-controls={id} title={`Changes · ${tab.title}`} onClick={()=>show('changes')}><FilesIcon aria-hidden="true"/><span className="dock-action-label">Changes</span></Button>;
    const browserAction=<Button variant="outline" ref={browserToggle} className="task-browser-action" type="button" aria-label="Browser" aria-expanded={open&&view==='browser'} aria-controls={id} aria-describedby={activity ? `${id}-activity` : undefined} title={`Browser · ${tab.title}`} onClick={()=>show('browser')}><GlobeIcon aria-hidden="true"/><span className="dock-action-label">Browser</span>{activity && <span className="browser-activity" aria-hidden="true"/>}</Button>;
    const filesAction=<Button variant="outline" ref={filesToggle} className="files-action" type="button" aria-label="Files" aria-expanded={open&&view==='files'} aria-controls={id} title={`Files · ${tab.title}`} onClick={()=>show('files')}><FilesIcon aria-hidden="true"/><span className="dock-action-label">Files</span></Button>;
    const actions=<div className="dock-actions">{changesAction}{filesAction}{mobile?<SheetTrigger asChild>{browserAction}</SheetTrigger>:browserAction}</div>;
    const body=<><header className="task-browser-heading"><div>{mobile?<SheetTitle asChild><h2 id={`${id}-title`}>{view==='browser'?'Browser':view==='files'?'Files':'Changes'}</h2></SheetTitle>:<h2 id={`${id}-title`}>{view==='browser'?'Browser':view==='files'?'Files':'Changes'}</h2>}<span>{tab.title}</span></div><div className="task-browser-heading-actions">{view==='browser'&&<Button variant="ghost" size="sm" className="expand-browser" type="button" hidden={mobile} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded?<Minimize2Icon aria-hidden="true"/>:<Maximize2Icon aria-hidden="true"/>}{expanded?'Show chat':'Expand browser'}</Button>}<Button variant="ghost" size="sm" type="button" aria-label="Close panel" title="Close panel; task browser keeps running" onClick={close}><XIcon aria-hidden="true"/>Close panel</Button></div></header>
            <div className="flex gap-1 border-b px-3 py-2"><Button variant={view==='changes'?'secondary':'ghost'} size="sm" type="button" aria-pressed={view==='changes'} onClick={()=>{setExpanded(false);setView('changes');}}>Changes</Button><Button variant={view==='files'?'secondary':'ghost'} size="sm" type="button" aria-pressed={view==='files'} onClick={()=>{setExpanded(false);setView('files');}}>Files</Button><Button variant={view==='browser'?'secondary':'ghost'} size="sm" type="button" aria-pressed={view==='browser'} onClick={()=>setView('browser')}>Browser</Button></div>
            {view==='browser'?<>{!ready && <p role="status">Vessel disconnected. The browser will reconnect when this Vessel connection returns.</p>}<div className="task-browser-content" ref={setViewerRoot}/></>:view==='files'?<WorkspaceFiles tab={tab} workspace={workspace}/>:<ReviewChanges tab={tab} workspace={workspace}/>}</>;
    return <div className="react-host-browser">
        {mobile?<Sheet open={open} onOpenChange={next=>{if(!next)close();else setOpen(true);}}>{actions}{open&&<SheetContent onCloseAutoFocus={event=>{
            // The sheet's only primitive trigger is Browser. Suppress its
            // default handoff and restore the actual selected dock only after
            // portal/focus-scope cleanup, with the original identity fences.
            event.preventDefault();
            const origin=returnFocus.current;
            if(origin)requestAnimationFrame(()=>restoreFocus(origin));
        }} ref={node=>{panel.current=node;}} side="right" showCloseButton={false} id={id} className="task-browser-panel mobile-browser-sheet" aria-labelledby={`${id}-title`}><SheetDescription className="sr-only">Review dock for {tab.title}</SheetDescription>{body}</SheetContent>}</Sheet>:actions}
        {activity && <span id={`${id}-activity`} className="sr-only">Browser activity in this voyage</span>}
        {open&&!mobile&&<aside ref={panel} tabIndex={-1} id={id} className={`task-browser-panel${expanded?' expanded':''}`} aria-labelledby={`${id}-title`}>{body}</aside>}
    </div>;
}
