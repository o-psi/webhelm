import {NativeSelect} from './components/ui/native-select';
import {Button} from './components/ui/button';
import React, {useEffect, useRef} from 'react';
import {vesselUpdate} from '../js/vessel-update.js';

// The same receipt controller is used across the cutover. It owns this static
// subtree, including its polling lifetime; React owns mounting and disposal.
export function VesselUpdateMarkup() {
    return <>
        <Button variant="ghost" type="button" id="setup-update-open" hidden>Vessel updates</Button>
        <h3 id="update-vessel-name">Vessel update</h3>
        <p id="update-current"/>
        <p id="update-status" role="status"/>
        <div id="update-source" className="vessel-update-source">
            <label>Update source<NativeSelect id="update-channel" defaultValue="stable">
                <option value="stable">Latest stable release</option>
                <option value="nightly">Latest completed development build</option>
            </NativeSelect></label>
            <p>Development builds contain recent GitHub changes and may have unfinished features. The Vessel uses its own download access.</p>
            <Button variant="outline" type="button" id="update-check">Check and prepare update</Button>
        </div>
        <div id="update-review" className="vessel-update-review" hidden>
            <strong id="update-version"/><p id="update-description"/><p id="update-services"/>
            <p>Install this exact build on this Vessel? Its connection will briefly restart. Accounts and existing voyages are retained.</p>
            <Button variant="default" type="button" id="update-approve">Update this Vessel</Button>
            <Button variant="ghost" type="button" id="update-discard">Not now</Button>
        </div>
        <Button variant="outline" type="button" id="update-refresh" hidden>Check update status</Button>
        <Button variant="default" type="button" id="update-continue" hidden>Review current Vessel</Button>
    </>;
}

export function VesselUpdate({connection, caps, tenant, onRefresh}: {connection:any; caps:any; tenant:string; onRefresh:()=>void}) {
    const root=useRef<HTMLDivElement>(null), refresh=useRef(onRefresh);
    refresh.current=onRefresh;
    useEffect(()=>{
        const controller=vesselUpdate(root.current!, {show:()=>{},resume:()=>refresh.current()});
        controller.bind(connection,caps);
        root.current!.querySelector<HTMLElement>('#setup-update-open')!.hidden=true;
        return ()=>controller.dispose();
    },[connection,connection?.client,caps,tenant]);
    return <div ref={root} data-tenant-id={tenant}><VesselUpdateMarkup/></div>;
}
