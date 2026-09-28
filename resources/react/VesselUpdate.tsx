import {NativeSelect} from './components/ui/native-select';
import {Button} from './components/ui/button';
import {Alert,AlertDescription} from './components/ui/alert';
import React, {useEffect, useRef} from 'react';
import {vesselUpdate} from '../js/vessel-update.js';
import {compareReleaseVersions} from '../js/release-channels.js';

export type ReleaseCheck = {phase:'checking'|'published'|'none'|'error'; version?:string};
export type Releases = Record<'stable'|'nightly',ReleaseCheck>;

function releaseDescription(release:ReleaseCheck|undefined, installed?:string) {
    if (!release || release.phase === 'checking') return {version:'Checking…',status:'Reading published releases'};
    if (release.phase === 'error') return {version:'Check unavailable',status:'You can still prepare on the Vessel'};
    if (release.phase === 'none' || !release.version) return {version:'No published build',status:'You can check again later'};
    const comparison = compareReleaseVersions(release.version,installed);
    return {version:release.version,status:comparison === 1 ? 'Newer release published' : comparison === null ? 'Vessel verifies compatibility on prepare' : 'Installed version is current or newer'};
}

// The same receipt controller is used across the cutover. It owns this static
// subtree, including its polling lifetime; React owns mounting and disposal.
export function VesselUpdateMarkup({releases,installed}: {releases?:Releases; installed?:string}={}) {
    return <div className="space-y-4">
        <Button variant="ghost" type="button" id="setup-update-open" hidden>Vessel updates</Button>
        <h4 id="update-vessel-name" className="sr-only">Vessel update</h4>
        <div className="rounded-lg bg-muted/50 px-4 py-3"><span className="text-xs font-medium text-muted-foreground">Installed version</span><p id="update-current" className="mt-1 break-all font-mono text-sm font-semibold"/></div>
        <div className="grid gap-2 sm:grid-cols-2" role="status" aria-label="Published release channels">
            {(['stable','nightly'] as const).map(channel=>{
                const description=releaseDescription(releases?.[channel],installed);
                return <div key={channel} className="min-w-0 rounded-lg border px-3 py-2"><div className="text-xs font-medium text-muted-foreground">{channel==='stable'?'Stable':'Development'}</div><div className="truncate text-sm font-semibold" title={description.version}>{description.version}</div><div className="text-xs text-muted-foreground">{description.status}</div></div>;
            })}
        </div>
        <Alert role="status" className="bg-muted/20"><AlertDescription id="update-status"/></Alert>
        <div id="update-source" className="vessel-update-source space-y-3">
            <div className="space-y-2"><label htmlFor="update-channel" className="block text-sm font-medium">Release channel</label><NativeSelect id="update-channel" defaultValue="stable" className="w-full sm:max-w-xs">
                <option value="stable">Latest stable release</option>
                <option value="nightly">Latest development build</option>
            </NativeSelect><p className="text-xs text-muted-foreground">Development builds may include unfinished features. Downloads run on the Vessel.</p></div>
            <Button variant="default" type="button" id="update-check" className="w-full sm:w-auto">Prepare on Vessel</Button>
        </div>
        <div id="update-review" className="vessel-update-review space-y-3 rounded-lg border bg-muted/20 p-4" hidden>
            <div><p className="text-xs font-medium text-muted-foreground">Prepared build</p><strong id="update-version" className="mt-1 block break-all text-sm"/></div><p id="update-description" className="break-words text-sm text-muted-foreground"/><p id="update-services" className="text-xs text-muted-foreground"/>
            <p className="text-sm">Installing this build briefly restarts the Vessel connection. Accounts and existing voyages are retained.</p>
            <div className="flex flex-wrap gap-2"><Button variant="default" type="button" id="update-approve">Update this Vessel</Button>
            <Button variant="outline" type="button" id="update-discard">Not now</Button></div>
        </div>
        <Button variant="ghost" type="button" id="update-refresh" className="w-fit text-muted-foreground" hidden>Check update status</Button>
        <Button variant="default" type="button" id="update-continue" className="w-full sm:w-auto" hidden>Review current Vessel</Button>
    </div>;
}

export function VesselUpdate({connection, caps, releases, tenant, onRefresh}: {connection:any; caps:any; releases:Releases; tenant:string; onRefresh:()=>void}) {
    const root=useRef<HTMLDivElement>(null), refresh=useRef(onRefresh);
    refresh.current=onRefresh;
    useEffect(()=>{
        const controller=vesselUpdate(root.current!, {show:()=>{},resume:()=>refresh.current()});
        controller.bind(connection,caps);
        root.current!.querySelector<HTMLElement>('#setup-update-open')!.hidden=true;
        return ()=>controller.dispose();
    },[connection,connection?.client,caps,tenant]);
    return <div ref={root} data-tenant-id={tenant}><VesselUpdateMarkup releases={releases} installed={caps.version}/></div>;
}
