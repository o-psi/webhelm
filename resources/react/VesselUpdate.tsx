import {SelectCombobox} from './components/ui/select-combobox';
import {Button} from './components/ui/button';
import {Alert,AlertDescription} from './components/ui/alert';
import React, {useEffect, useRef} from 'react';
import {vesselUpdate} from '../js/vessel-update.js';
import {compareReleaseVersions,installedReleaseChannel,isNewerOnInstalledChannel} from '../js/release-channels.js';

export type ReleaseCheck = {phase:'checking'|'published'|'none'|'error'; version?:string};
export type Releases = Record<'stable'|'nightly',ReleaseCheck>;

function releaseDescription(channel:'stable'|'nightly',release:ReleaseCheck|undefined, installed?:string) {
    if (!release || release.phase === 'checking') return {version:'Checking…',status:'Reading published releases'};
    if (release.phase === 'error') return {version:'Check unavailable',status:'Try again later'};
    if (release.phase === 'none' || !release.version) return {version:'No published build',status:'You can check again later'};
    const installedChannel=installedReleaseChannel(installed);
    if (installedChannel && installedChannel!==channel) return {version:release.version,status:'Published on another channel'};
    const comparison = compareReleaseVersions(release.version,installed);
    return {version:release.version,status:isNewerOnInstalledChannel(channel,release.version,installed) ? 'Newer release published' : comparison === null ? 'Vessel verifies compatibility on prepare' : 'Installed version is current or newer'};
}

// The same receipt controller is used across the cutover. It owns this static
// subtree, including its polling lifetime; React owns mounting and disposal.
export function VesselUpdateMarkup({releases,installed}: {releases?:Releases; installed?:string}={}) {
    const installedChannel=installedReleaseChannel(installed) || 'stable';
    return <div className="space-y-4">
        <Button variant="ghost" type="button" id="setup-update-open" hidden>Vessel updates</Button>
        <h4 id="update-vessel-name" className="sr-only">Vessel update</h4>
        <div className="rounded-lg bg-muted/50 px-3 py-2"><span className="text-xs font-medium text-muted-foreground">Installed version</span><p id="update-current" className="break-all font-mono text-sm font-semibold"/></div>
        <div id="update-source" className="vessel-update-source space-y-3">
            <div className="space-y-2"><label htmlFor="update-channel" className="block text-sm font-medium">Release channel</label><SelectCombobox id="update-channel" defaultValue={installedChannel} className="w-full sm:max-w-xs">
                <option value="stable">Latest stable release</option>
                <option value="nightly">Latest development build</option>
            </SelectCombobox><div id="update-selected-version" className="text-sm font-semibold">Checking published version…</div></div>
            <Button variant="default" type="button" id="update-check" className="w-full sm:w-auto">Update this Vessel</Button>
            <p className="text-xs text-muted-foreground">The Vessel verifies the selected version, then installs it and restarts its services. Development builds may include unfinished features.</p>
        </div>
        <Alert id="update-alert" role="status" className="bg-muted/20"><AlertDescription id="update-status"/></Alert>
        <div className="grid gap-2 sm:grid-cols-2" role="status" aria-label="Published release channels">
            {(['stable','nightly'] as const).map(channel=>{
                const description=releaseDescription(channel,releases?.[channel],installed);
                return <div key={channel} className="min-w-0 rounded-lg border px-3 py-2"><div className="text-xs font-medium text-muted-foreground">{channel==='stable'?'Stable':'Development'}</div><div className="truncate text-sm font-semibold" title={description.version}>{description.version}</div><div className="text-xs text-muted-foreground">{description.status}</div></div>;
            })}
        </div>
        <div id="update-review" className="vessel-update-review space-y-3 rounded-lg border bg-muted/20 p-4" hidden>
            <div><p className="text-xs font-medium text-muted-foreground">Previously prepared build</p><strong id="update-version" className="mt-1 block break-all text-sm"/></div><p id="update-description" className="break-words text-sm text-muted-foreground"/><p id="update-services" className="text-xs text-muted-foreground"/>
            <Button variant="outline" type="button" id="update-discard">Discard prepared build</Button>
        </div>
        <Button variant="ghost" type="button" id="update-refresh" className="w-fit text-muted-foreground" hidden>Check update status</Button>
        <Button variant="default" type="button" id="update-continue" className="w-full sm:w-auto" hidden>Review current Vessel</Button>
    </div>;
}

export function VesselUpdate({connection, caps, releases, tenant, onRefresh}: {connection:any; caps:any; releases:Releases; tenant:string; onRefresh:()=>void}) {
    const root=useRef<HTMLDivElement>(null), refresh=useRef(onRefresh), currentReleases=useRef(releases), updater=useRef<ReturnType<typeof vesselUpdate>|null>(null);
    refresh.current=onRefresh;
    currentReleases.current=releases;
    useEffect(()=>{
        const controller=vesselUpdate(root.current!, {show:()=>{},resume:()=>refresh.current(),releaseInfo:(channel:'stable'|'nightly')=>currentReleases.current[channel]});
        updater.current=controller;
        controller.bind(connection,caps);
        root.current!.querySelector<HTMLElement>('#setup-update-open')!.hidden=true;
        return ()=>{updater.current=null;controller.dispose();};
    },[connection,connection?.client,caps,tenant]);
    useEffect(()=>updater.current?.releasesChanged(),[releases]);
    return <div ref={root} data-tenant-id={tenant}><VesselUpdateMarkup releases={releases} installed={caps.version}/></div>;
}
