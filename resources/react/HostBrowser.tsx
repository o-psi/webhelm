import {Button} from './components/ui/button';
import {Sheet,SheetContent,SheetDescription,SheetTitle,SheetTrigger} from './components/ui/sheet';
import React, {useEffect, useId, useRef, useState} from 'react';
import {mountHostBrowser} from '../js/host-browser.js';
import type {Tab} from './workspace';

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
export function HostBrowser({tab, client}: {tab: Tab; client: any}) {
    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [mobile,setMobile] = useState(()=>typeof window!=='undefined'&&Boolean(window.matchMedia?.('(max-width: 1000px)').matches));
    const [viewerRoot,setViewerRoot] = useState<HTMLDivElement|null>(null);
    const panel = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null);
    const latest = useRef(tab);
    latest.current = tab;
    const id = useId();
    const activity = browserActivity(tab.snapshot);
    const ready = Boolean(client);
    const close = () => { setExpanded(false);setOpen(false); toggle.current?.focus(); };
    useEffect(()=>{
        const media=window.matchMedia?.('(max-width: 1000px)');
        if(!media)return;
        const update=()=>setMobile(media.matches);
        update();media.addEventListener?.('change',update);
        return()=>media.removeEventListener?.('change',update);
    },[]);
    useEffect(() => {
        if (!open || !ready || !viewerRoot) return;
        const viewer = mountHostBrowser(viewerRoot, {
            client, sessionId: tab.session, incarnation: tab.incarnation,
            context: () => ({revision: latest.current.snapshot?.revision, refresh:latest.current.stale || !latest.current.incarnation}),
            onClose: close, externalClose:true,
        });
        // Shared viewer auto-connects on mount; disposal detaches, never closes the browser.
        return () => {viewer.dispose();};
    }, [open, viewerRoot, ready, client, tab.vessel, tab.session, tab.incarnation]);
    useEffect(() => {
        if (!open || mobile) return;
        panel.current?.focus();
        const key = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event.key === 'Escape') { event.preventDefault(); close(); }
        };
        document.addEventListener('keydown', key);
        return () => document.removeEventListener('keydown', key);
    }, [open,mobile]);
    useEffect(() => {
        if (!open || !expanded || mobile) return;
        const conversation = panel.current?.closest('.voyage-workspace')?.querySelector<HTMLElement>(':scope > .conversation');
        if (!conversation) return;
        const previous = conversation.inert; conversation.inert = true;
        return () => {conversation.inert = previous;};
    }, [open, expanded,mobile]);
    const action=<Button variant="ghost" ref={toggle} className="task-browser-action" type="button" aria-expanded={open} aria-controls={id} aria-describedby={activity ? `${id}-activity` : undefined} title={`Browser · ${tab.title}`} onClick={() => open ? close() : setOpen(true)}>
            Browser{activity && <span className="browser-activity" aria-hidden="true"/>}
        </Button>;
    const body=<><header className="task-browser-heading"><div>{mobile?<SheetTitle asChild><h2 id={`${id}-title`}>Browser</h2></SheetTitle>:<h2 id={`${id}-title`}>Browser</h2>}<span>{tab.title}</span></div><div className="task-browser-heading-actions"><Button variant="ghost" className="expand-browser" type="button" hidden={mobile} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>{expanded?'Show chat':'Expand browser'}</Button><Button variant="ghost" type="button" aria-label="Close browser viewer" title="Close viewer; keep browser running" onClick={close}>Close ×</Button></div></header>
            {!ready && <p role="status">Vessel disconnected. The browser will reconnect when this Vessel connection returns.</p>}
            <div className="task-browser-content" ref={setViewerRoot}/></>;
    return <div className="react-host-browser">
        {mobile?<Sheet open={open} onOpenChange={next=>{if(!next)close();else setOpen(true);}}><SheetTrigger asChild>{action}</SheetTrigger>{open&&<SheetContent ref={node=>{panel.current=node;}} side="right" showCloseButton={false} id={id} className="task-browser-panel mobile-browser-sheet" aria-labelledby={`${id}-title`}><SheetDescription className="sr-only">Browser for {tab.title}</SheetDescription>{body}</SheetContent>}</Sheet>:action}
        {activity && <span id={`${id}-activity`} className="sr-only">Browser activity in this voyage</span>}
        {open&&!mobile&&<aside ref={panel} tabIndex={-1} id={id} className={`task-browser-panel${expanded?' expanded':''}`} aria-labelledby={`${id}-title`}>{body}</aside>}
    </div>;
}
