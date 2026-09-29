import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {Button} from './components/ui/button';
import {Card,CardContent,CardDescription,CardHeader,CardTitle} from './components/ui/card';
import {Badge} from './components/ui/badge';
import {Dialog, DialogContent, DialogTitle} from './components/ui/dialog';
import {Alert,AlertDescription} from './components/ui/alert';
import {Collapsible,CollapsibleContent,CollapsibleTrigger} from './components/ui/collapsible';
import {VesselUpdate,type Releases} from './VesselUpdate';
import {vesselRead} from './settings';
import {checkReleaseChannel,installedReleaseChannel,isNewerOnInstalledChannel} from '../js/release-channels.js';
import React, {useEffect, useRef, useState} from 'react';
import {ArrowLeftIcon,ArrowRightIcon,ChevronDownIcon,ChevronRightIcon,ExternalLinkIcon,PlusIcon,RefreshCwIcon,ServerIcon,XIcon} from 'lucide-react';

type Vessel = {id: string; name: string; vessel_id: string; endpoint?: string};
type Bootstrap = {
    vessels: Vessel[]; principalId?: string;
    connectionStatus?: string | null; connectionError?: string | null;
    connectionForm?: string | null;
};
type Status = {connected: boolean; status: string};
type Screen = 'list' | 'add' | 'guide' | 'details';
type Method = 'invitation' | 'credential';

const guideUrl = 'https://github.com/o-psi/helm.vessel.voyage/blob/main/docs/getting-started-web.md';

function endpointHost(endpoint?: string): string {
    if (!endpoint) return 'Saved Vessel';
    try { return new URL(endpoint).host || endpoint; }
    catch { return endpoint; }
}

function bootstrapFrom(html: string): Bootstrap {
    const page = new DOMParser().parseFromString(html, 'text/html');
    const value = page.querySelector<HTMLElement>('#helm-react')?.dataset.bootstrap;
    if (!value) throw new Error('Connection status could not be read. Reload to inspect it before trying again.');
    const data = JSON.parse(value) as Bootstrap;
    if (!Array.isArray(data.vessels)) {
        throw new Error('Connection status was incomplete. Reload before trying again.');
    }
    return data;
}

function usePublishedReleases(): Releases {
    const [releases,setReleases] = useState<Releases>({stable:{phase:'checking'},nightly:{phase:'checking'}});
    useEffect(()=>{
        let mounted=true;
        const pending: {controller:AbortController; timer:ReturnType<typeof setTimeout>}[]=[];
        for(const channel of ['stable','nightly'] as const) {
            const controller=new AbortController();
            const timer=setTimeout(()=>{
                controller.abort();
                if(mounted)setReleases(current=>({...current,[channel]:{phase:'error'}}));
            },10000);
            pending.push({controller,timer});
            checkReleaseChannel(channel,controller.signal)
                .then(version=>{if(mounted&&!controller.signal.aborted)setReleases(current=>({...current,[channel]:version?{phase:'published',version}:{phase:'none'}}));})
                .catch(()=>{if(mounted)setReleases(current=>({...current,[channel]:{phase:'error'}}));})
                .finally(()=>clearTimeout(timer));
        }
        return()=>{mounted=false;pending.forEach(({controller,timer})=>{clearTimeout(timer);controller.abort();});};
    },[]);
    return releases;
}

function releaseSummary(release:Releases['stable']) {
    return release.phase==='checking'?'Checking…':release.phase==='published'?release.version:release.phase==='none'?'No published build':'Check unavailable';
}

function VesselOverviewCard({vessel, connection, status, releases, onView}: {vessel:Vessel; connection:any; status:string; releases:Releases; onView:()=>void}) {
    const [version, setVersion] = useState<string | null | undefined>(undefined);
    const connected = Boolean(connection?.client && connection.vessel_id === vessel.vessel_id);
    useEffect(() => {
        let alive = true;
        setVersion(connected ? undefined : null);
        if (connected) {
            vesselRead(connection, 'capabilities').then(value => {
                if (!alive) return;
                setVersion(value?.vessel_id === vessel.vessel_id && typeof value.version === 'string' && value.version.trim() ? value.version : null);
            }).catch(() => { if (alive) setVersion(null); });
        }
        return () => { alive = false; };
    }, [connection, connection?.client, vessel.vessel_id, connected]);
    const versionLabel = version === undefined ? 'Checking version…' : version ? `Version ${version}` : 'Version unavailable';
    const channel = installedReleaseChannel(version);
    const newer = channel && releases[channel].version && isNewerOnInstalledChannel(channel,releases[channel].version,version);
    const host = endpointHost(vessel.endpoint);
    return <Card role="article" className="connections-card overflow-hidden p-0">
        <button type="button" className="group flex w-full flex-col gap-2 rounded-xl p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring" aria-label={`View details for ${vessel.name}`} onClick={onView}>
            <span className="flex w-full min-w-0 items-center gap-2"><span className="connections-server" aria-hidden="true"><ServerIcon/></span><h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{vessel.name}</h3><Badge variant="outline" className={`connections-status ${connected ? 'is-connected' : ''}`}><i aria-hidden="true"/>{status}</Badge></span>
            <span className="flex w-full min-w-0 items-center gap-2 pl-10 text-xs text-muted-foreground"><span className="max-w-[60%] shrink-0 truncate font-medium text-foreground" title={versionLabel}>{versionLabel}</span>{newer && <Badge variant="secondary" title={`Newer published ${channel} release; the Vessel verifies it on Prepare`}>New release</Badge>}<span aria-hidden="true">·</span><span className="min-w-0 flex-1 truncate" title={host}>{host}</span><ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true"/></span>
        </button>
    </Card>;
}

function VesselMaintenance({connection, releases, tenant, onReconnect}: {connection:any; releases:Releases; tenant:string; onReconnect?:()=>void}) {
    const [caps, setCaps] = useState<any>(null);
    const [notice, setNotice] = useState('');
    const [failed, setFailed] = useState(false);
    const [reload, setReload] = useState(0);

    useEffect(() => {
        let alive = true;
        setCaps(null);
        setFailed(false);
        if (!connection?.client) {
            setNotice('Connect this Vessel to check its maintenance status.');
        } else {
            const observedClient = connection.client;
            setNotice('Checking Vessel capabilities…');
            vesselRead(connection, 'capabilities').then(value => {
                if (connection.client !== observedClient) throw new Error('Vessel connection changed. Check again before reviewing maintenance.');
                if (value?.vessel_id !== connection.vessel_id) throw new Error('Vessel identity changed. Reconnect before reviewing maintenance.');
                if (alive) { setCaps(value); setNotice(''); }
            }).catch(error => { if (alive) { setNotice(error instanceof Error ? error.message : 'Vessel capabilities unavailable.'); setFailed(true); } });
        }
        return () => { alive = false; };
    }, [connection, connection?.client, reload]);

    return <Card className="connections-maintenance" role="region" aria-label="Vessel maintenance">
        <CardHeader><div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><RefreshCwIcon className="size-4" aria-hidden="true"/></span><div className="space-y-1"><CardTitle><h3>Software updates</h3></CardTitle><CardDescription>Choose a channel and install its latest published version.</CardDescription></div></div></CardHeader>
        <CardContent className="space-y-4">
            {notice && <Alert role="status"><AlertDescription>{notice}</AlertDescription></Alert>}
            {caps && <VesselUpdate connection={connection} caps={caps} releases={releases} tenant={tenant} onRefresh={()=>setReload(value=>value+1)}/>}
            {!connection?.client && onReconnect && <Button variant="outline" type="button" onClick={onReconnect}>Reconnect Vessels</Button>}
            {connection?.client && failed && <Button variant="outline" type="button" onClick={()=>setReload(value=>value+1)}>Check again</Button>}
        </CardContent>
    </Card>;
}

export function Connections({bootstrap, states = {}, connections, tenant, onReconnect, onClose}: {
    bootstrap: Bootstrap; states?: Record<string, Status>;
    connections: Map<string, any>; tenant: string;
    onReconnect?: () => void; onClose: () => void;
}) {
    const releases=usePublishedReleases();
    const initialMethod = bootstrap.connectionForm === 'import' ? 'credential' : 'invitation';
    const initialScreen = bootstrap.connectionError && ['pair', 'import'].includes(bootstrap.connectionForm || '') ? 'add' : 'list';
    const [data, setData] = useState<Bootstrap>(bootstrap);
    const [screen, setScreen] = useState<Screen>(initialScreen);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [method, setMethod] = useState<Method>(initialMethod);
    const [name, setName] = useState('');
    const [invitation, setInvitation] = useState('');
    const [credential, setCredential] = useState('');
    const [notice, setNotice] = useState(bootstrap.connectionError || bootstrap.connectionStatus || '');
    const [error, setError] = useState(Boolean(bootstrap.connectionError));
    const [busy, setBusy] = useState(false);
    const [uncertain, setUncertain] = useState(false);
    const [confirmRemove, setConfirmRemove] = useState(false);
    const [removeOpen, setRemoveOpen] = useState(false);
    const heading = useRef<HTMLHeadingElement>(null);
    const nameField = useRef<HTMLInputElement>(null);
    const selected = data.vessels.find(vessel => vessel.id === selectedId);
    const count = data.vessels.length;
    const online = data.vessels.filter(vessel => states[vessel.id]?.connected).length;
    const secret = method === 'invitation' ? invitation : credential;

    useEffect(() => {
        if (screen === 'add') nameField.current?.focus();
        else heading.current?.focus();
    }, [screen]);

    function back() {
        setConfirmRemove(false);
        setRemoveOpen(false);
        setScreen(screen === 'guide' ? 'add' : 'list');
    }
    function close() { if (!busy) onClose(); }
    function openAdd() {
        setNotice(''); setError(false); setUncertain(false);
        setScreen('add');
    }
    function onCancel(event: Event) {
        event.preventDefault();
        if (busy) return;
        if (confirmRemove) setConfirmRemove(false);
        else if (screen !== 'list') back();
        else onClose();
    }
    async function send(path: string, body: unknown, method: 'POST' | 'DELETE' = 'POST') {
        if (busy || uncertain) return;
        setBusy(true); setNotice(''); setError(false);
        try {
            const response = await fetch(path, {
                method, credentials: 'same-origin',
                headers: {'X-Helm-Client': 'react', 'Content-Type': 'application/json', Accept: 'application/json',
                    'X-CSRF-TOKEN': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || ''},
                body: JSON.stringify(body),
            });
            if (!response.redirected) throw new Error('Connection outcome uncertain. Check status before trying again.');
            const updated = bootstrapFrom(await response.text());
            setData(updated);
            if (updated.connectionError) {
                setNotice(updated.connectionError); setError(true);
                return; // Keep both private drafts in memory for review; do not replay.
            }
            location.assign('/?manage-vessels=1');
        } catch {
            setUncertain(true); setError(true);
            setNotice('Connection outcome uncertain. Check status before trying again; your entries are retained in this window.');
        } finally { setBusy(false); }
    }
    async function checkStatus() {
        if (busy) return;
        setBusy(true);
        try {
            const response = await fetch('/?manage-vessels=1', {credentials: 'same-origin', headers: {Accept: 'text/html'}});
            if (!response.ok || response.redirected) throw new Error('Status unavailable');
            const updated = bootstrapFrom(await response.text());
            setData(updated); setUncertain(false);
            const found = updated.vessels.some(vessel => vessel.name === name);
            if (screen === 'add' && found) {
                setScreen('list'); setNotice('A saved connection has this name. Review its details before another attempt.');
                setError(false);
                return;
            }
            setNotice('No saved connection was found. Review the invitation and try again if it is still valid.');
            setError(false);
        } catch {
            setNotice('Status could not be checked. Keep this window open and try Check status again.');
            setError(true);
        } finally { setBusy(false); }
    }
    function viewDetails(id: string) { setSelectedId(id); setConfirmRemove(false); setRemoveOpen(false); setScreen('details'); }
    const statusLabel = (id: string) => {
        const status = states[id];
        return !status ? 'Saved' : status.connected ? 'Connected' : status.status === 'Connecting…' ? 'Connecting' : 'Unavailable';
    };
    const title = screen === 'list' ? 'Your Vessels' : screen === 'add' ? 'Add a Vessel' : screen === 'guide' ? 'Get an invitation' : selected?.name || 'Vessel details';
    const command = `STATE="/path/to/vessel/state"\nENDPOINT="https://vessel.example.com"\nINVITE_DIR=$(mktemp -d)\nvessel pair-invite --directory "$STATE" \\\n  --endpoint "$ENDPOINT" \\\n  --principal ${data.principalId || 'YOUR_PRINCIPAL_ID'} \\\n  --full-access \\\n  --output "$INVITE_DIR/invitation.json" &&\ncat "$INVITE_DIR/invitation.json"`;

    return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent showCloseButton={false} className="settings-dialog connections-dialog flex w-[min(760px,calc(100vw-24px))] max-w-none flex-col gap-0 bg-background p-0 text-foreground sm:max-w-none max-sm:w-[calc(100vw-16px)]" onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>onCancel(event)} aria-labelledby="vessel-manager-title">
        <header className="connections-header">
            {screen !== 'list' && <Button variant="ghost" size="icon" type="button" className="connections-back" disabled={busy} onClick={back} aria-label="Back"><ArrowLeftIcon aria-hidden="true"/></Button>}
            <div className="connections-title"><DialogTitle asChild><h2 id="vessel-manager-title" ref={heading} tabIndex={-1}>{title}</h2></DialogTitle>
                <p>{screen === 'list' ? `${count} saved · ${online} connected` : screen === 'add' ? 'Connect a computer where your voyages will run.' : screen === 'guide' ? 'Create a private invitation on the Vessel host.' : 'Manage software and connection access.'}</p></div>
            {screen === 'list' && <Button variant="default" type="button" className="connections-add" onClick={openAdd} disabled={busy || count >= 64}><PlusIcon aria-hidden="true"/>Add Vessel</Button>}
            <Button variant="ghost" size="icon" type="button" className="connections-close" aria-label="Close Vessel connections" disabled={busy} onClick={close}><XIcon aria-hidden="true"/></Button>
        </header>
        {notice && <Alert className={`connections-notice ${error ? 'is-error' : ''}`} variant={error?'destructive':'default'} role={error ? 'alert' : 'status'}><AlertDescription>{notice}</AlertDescription>
            {uncertain && <Button variant="outline" type="button" onClick={()=>void checkStatus()} disabled={busy}>Check status</Button>}</Alert>}
        <div className="connections-body">
            {screen === 'list' && <>
                <p className="connections-intro">These computers run your voyages. Provider credentials stay on each Vessel.</p>
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" role="status" aria-label="Published release checks"><span>Stable: {releaseSummary(releases.stable)}</span><span>Development: {releaseSummary(releases.nightly)}</span></div>
                {count ? <div className="connections-grid" data-single={count===1 || undefined}>{data.vessels.map(vessel => <VesselOverviewCard key={vessel.id} vessel={vessel} connection={connections.get(vessel.id)} status={statusLabel(vessel.id)} releases={releases} onView={()=>viewDetails(vessel.id)}/>)}</div> : <div className="connections-empty"><span aria-hidden="true"><ServerIcon/></span><h3>No Vessels yet</h3><p>Add a computer you control to start a voyage from Helm Web.</p><Button variant="default" type="button" onClick={openAdd}>Add your first Vessel</Button></div>}
                {count >= 64 && <p>Connection limit reached. Remove a Vessel before adding another.</p>}
            </>}
            {screen === 'add' && <>
                <div className="connections-method" aria-label="Connection method"><Button variant={method === 'invitation' ? 'secondary' : 'outline'} type="button" aria-pressed={method === 'invitation'} disabled={busy} onClick={()=>setMethod('invitation')}>New invitation</Button><Collapsible open={method==='credential'} onOpenChange={open=>setMethod(open?'credential':'invitation')}><CollapsibleTrigger asChild><Button variant="ghost" type="button" disabled={busy}>Existing credential (advanced)</Button></CollapsibleTrigger><CollapsibleContent><p>Import an existing grant only when moving an established Vessel connection. Importing replaces this Web account’s saved connection.</p></CollapsibleContent></Collapsible></div>
                <form id="vessel-add-form" onSubmit={event=>{event.preventDefault();void send(method === 'invitation' ? '/connections/pair' : '/connections', {name, [method]: secret});}}>
                    <label>Name<Input ref={nameField} required maxLength={100} value={name} onChange={event=>setName(event.target.value)} placeholder="e.g. My workstation" disabled={busy} autoComplete="off"/></label>
                    <label>{method === 'invitation' ? 'Invitation JSON' : 'Connection credential JSON'}<Textarea required maxLength={16384} rows={5} value={secret} onChange={event=>method === 'invitation' ? setInvitation(event.target.value) : setCredential(event.target.value)} placeholder={method === 'invitation' ? 'Paste the private invitation from your Vessel' : 'Paste an existing Vessel connection credential'} disabled={busy} autoComplete="off" spellCheck={false}/></label>
                    <p className="connections-private">This private value goes to Helm Web for pairing and is never placed in a voyage message. {method === 'invitation' ? 'Invitations expire after 10 minutes.' : 'Importing the same Vessel replaces this tenant’s saved connection.'}</p>
                    {method === 'invitation' && <Button variant="link" type="button" className="connections-help-link h-auto px-0" onClick={()=>setScreen('guide')}>How do I get an invitation?<ArrowRightIcon aria-hidden="true"/></Button>}
                </form>
            </>}
            {screen === 'guide' && <div className="connections-guide">
                <ol><li>Install Vessel and Voyage on a Linux machine you control.</li><li>Expose its authenticated public HTTPS/WSS endpoint. A local service alone is not reachable from Helm Web.</li><li>On that machine, replace the paths and endpoint below, then run this command. Paste the resulting invitation into Add a Vessel.</li></ol>
                <pre>{command}</pre><p>Keep the invitation private. It grants this Web account full access to that Vessel and expires after 10 minutes.</p>
                <a href={guideUrl} target="_blank" rel="noopener noreferrer">Full first-time setup guide<ExternalLinkIcon aria-hidden="true"/></a>
            </div>}
            {screen === 'details' && selected && <div className="connections-details grid gap-4">
                <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3"><div className="flex min-w-0 items-center gap-3"><ServerIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true"/><div className="min-w-0"><p className="text-xs text-muted-foreground">Connection</p><p className="truncate text-sm font-medium">{endpointHost(selected.endpoint)}</p></div></div><Badge variant="outline" className={`connections-status ${states[selected.id]?.connected ? 'is-connected' : ''}`}><i aria-hidden="true"/>{statusLabel(selected.id)}</Badge></div>
                {connections.get(selected.id)?.vessel_id === selected.vessel_id
                    ? <VesselMaintenance connection={connections.get(selected.id)} releases={releases} tenant={tenant} onReconnect={onReconnect}/>
                    : <p role="status">Vessel connection changed. Reload Manage Vessels before reviewing maintenance.</p>}
                <Collapsible className="group rounded-xl border" ><CollapsibleTrigger asChild><Button variant="ghost" type="button" className="h-auto w-full justify-between px-4 py-3">Connection details<ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden="true"/></Button></CollapsibleTrigger><CollapsibleContent><dl className="grid gap-3 border-t p-4 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Address</dt><dd className="mt-1 break-all font-mono text-xs">{selected.endpoint || 'Not available'}</dd></div><div><dt className="text-xs text-muted-foreground">Vessel ID</dt><dd className="mt-1 break-all font-mono text-xs">{selected.vessel_id}</dd></div></dl></CollapsibleContent></Collapsible>
                <Collapsible className="connections-danger group rounded-xl border" open={removeOpen} onOpenChange={open=>{setRemoveOpen(open);if(!open)setConfirmRemove(false);}}><CollapsibleTrigger asChild><Button variant="ghost" type="button" className="h-auto w-full justify-between px-4 py-3 text-muted-foreground">Remove connection<ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true"/></Button></CollapsibleTrigger><CollapsibleContent><div className="space-y-3 border-t p-4"><p className="text-sm text-muted-foreground">This stops new access through this Web account. Existing voyages keep running; grants used by other clients remain valid.</p>
                    {!confirmRemove ? <Button variant="destructive" type="button" onClick={()=>setConfirmRemove(true)}>Remove from Helm Web…</Button> : <Alert className="connections-confirm" role="group" aria-label={`Confirm removing ${selected.name}`} variant="destructive"><AlertDescription>Remove <strong>{selected.name}</strong> from this Web account?</AlertDescription><div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" type="button" disabled={busy} onClick={()=>setConfirmRemove(false)}>Keep connection</Button><Button variant="destructive" type="button" className="connections-remove" disabled={busy || uncertain} onClick={()=>void send(`/connections/${encodeURIComponent(selected.id)}`, {confirm_disconnect: 1}, 'DELETE')}>Remove {selected.name}</Button></div></Alert>}
                </div></CollapsibleContent></Collapsible>
            </div>}
        </div>
        {(screen === 'list' || screen === 'add') && <footer className="connections-footer">
            {screen === 'list' ? <Button variant="outline" type="button" onClick={close}>Done</Button> : <Button variant="default" className="connections-primary" type="submit" form="vessel-add-form" disabled={busy || uncertain || !name.trim() || !secret.trim()}>{busy ? 'Connecting…' : 'Connect Vessel'}</Button>}
        </footer>}
    </DialogContent></Dialog>;
}
