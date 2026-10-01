import {request, uuid} from './vessel-client.js';
import {compareReleaseVersions,installedReleaseChannel} from './release-channels.js';

// Older binaries advertised remote_updates while invoking their old installed
// controller. Only the explicit current contract admits new installer effects.
const mayObserveUpdates = caps => caps?.scope === 'owner' && caps.remote_updates === true;
const verifiedUserUpdates = caps => mayObserveUpdates(caps)
    && Array.isArray(caps.features) && caps.features.includes('verified_user_updates');
const installerBootstrap = 'Remote updates need the current verified installer on this Vessel. Use its existing approved host installer route, then reconnect. Saved updates are retained for status review; previous approval will not be repeated.';

// A stored id observes one server-owned operation. Reload/reconnect never repeats
// approval or starts another update, even when the original reply was lost.
export function vesselUpdate(root, {show, resume, releaseInfo = /** @type {(channel: 'stable'|'nightly') => ({phase: string, version?: string}|null)} */ (() => null)}) {
    const $ = id => root.querySelector(`#${id}`);
    let context = null, generation = 0, pending = null, timer = null, busy = false, authorized = null, statusOverride = null;
    const listeners = [];
    function listen(id, callback) {
        const node = $(id);
        node.addEventListener('click', callback);
        listeners.push(() => node.removeEventListener('click', callback));
    }
    const storageKey = c => `helm-web:update:${root.dataset.tenantId}:${c.id}:${c.vessel_id}`;
    const text = (id, value) => { $(id).textContent = String(value ?? ''); };
    const active = (c, n) => context?.c === c && generation === n;
    const mayPrepare = record => !record || ['idle','discarded','complete','failed','ready'].includes(record.phase);
    const reviewExpired = record => record?.phase === 'ready' && (!Number.isSafeInteger(record.expires_at) || Date.now() >= record.expires_at * 1000);
    const selectedRelease = () => {
        const channel = $('update-channel').value;
        const release = releaseInfo(channel);
        return release?.phase === 'published' && installedReleaseChannel(release.version) === channel ? {channel,version:release.version} : null;
    };
    const phaseMessage = {
        idle: 'Choose a channel and update to its latest published version.',
        preparing: 'The Vessel is downloading and verifying the selected version. Installation follows automatically if it matches.',
        ready: 'A prepared build is available. Choose a channel to update.',
        applying: 'Installing the approved build. Checking the Vessel connection…',
        observing: 'Checking the saved update. Approval will not be repeated.',
        discarded: 'Prepared build discarded. No update was installed.',
        failed: 'The update did not complete. Check its status before trying again.',
        unconfirmed: 'Update outcome is uncertain. Check its status before another action.',
    };
    function remember(record) {
        if (record?.operation_id) localStorage.setItem(storageKey(context.c), JSON.stringify({operation_id:record.operation_id}));
        pending = record;
    }
    function render(record) {
        const phase = record?.phase || 'idle';
        const expired = reviewExpired(record);
        const release = selectedRelease();
        const sameChannel = release?.channel === installedReleaseChannel(context?.caps.version);
        const comparison = sameChannel ? compareReleaseVersions(release.version,context?.caps.version) : null;
        const current = comparison !== null && comparison <= 0;
        text('update-selected-version',authorized ? `Updating to ${authorized.version}` : release ? `Latest ${release.channel === 'nightly' ? 'development' : 'stable'} version: ${release.version}` : 'Published version unavailable. Check again later.');
        const supported = verifiedUserUpdates(context?.caps);
        const unsupported = context && !supported
            ? context.caps.scope !== 'owner' ? 'Only this Vessel’s account owner can approve an update.' : installerBootstrap
            : null;
        const expiryMessage = supported ? 'The previous prepared build is no longer valid. A new update will replace it automatically.'
            : 'The saved prepared build has expired. Its operation is retained for status review after installer bootstrap.';
        const retainedPhase = phase === 'preparing' ? 'The saved update is preparing. Installation will not be approved by this client.'
            : phase === 'ready' ? 'The saved preparation remains available for status review.' : phaseMessage[phase];
        const operationStatus = statusOverride || (expired ? expiryMessage : record?.message || (!supported ? retainedPhase : phaseMessage[phase]) || 'Check the current update status.');
        $('update-alert').hidden = phase === 'idle' && !statusOverride && !unsupported;
        text('update-status', unsupported ? `${unsupported}${record?.operation_id ? ` Saved update: ${operationStatus}` : ''}` : operationStatus);
        $('update-source').hidden = !supported || !mayPrepare(record) || Boolean(authorized && (phase === 'ready' || phase === 'preparing'));
        $('update-review').hidden = !supported || phase !== 'ready' || expired || Boolean(authorized && !authorized.approvalSent);
        $('update-refresh').hidden = !mayObserveUpdates(context?.caps) || ['idle','discarded'].includes(phase);
        $('update-continue').hidden = phase !== 'complete';
        text('update-version',record?.version);
        text('update-description',record?.description);
        text('update-services',record?.services?.length ? `Services to restart: ${record.services.join(', ')}` : '');
        $('update-discard').disabled = busy || !supported;
        text('update-check',current ? 'Already up to date' : 'Update this Vessel');
        $('update-check').disabled = busy || !release || current || Boolean(authorized?.approvalSent) || !supported;
    }
    async function exchange(c, op, fields) {
        if (!c.client) throw Error('Waiting for this Vessel to reconnect. Your update request is retained.');
        const reply = await c.client.exchange(request(op, fields));
        if (reply.protocol !== 1 || reply.error != null || reply.outcome_unknown !== false) throw Error('The Vessel could not confirm the request. Check this update’s status; it has not been repeated.');
        return reply.result;
    }
    function maybeAutoApply() {
        if (!authorized || authorized.approvalSent || pending?.phase !== 'ready' || busy || !verifiedUserUpdates(context?.caps)) return;
        const matches = pending.operation_id === authorized.operation_id
            && pending.channel === authorized.channel
            && compareReleaseVersions(pending.version,authorized.version) === 0
            && /^[a-f0-9]{64}$/.test(pending.release_id || '');
        const validExpiry = Number.isSafeInteger(pending.expires_at) && Date.now() < pending.expires_at * 1000;
        if (!matches || !validExpiry) {
            authorized = null;
            statusOverride = !matches
                ? 'The Vessel prepared a different build than the version you selected. Nothing was installed. Review the latest version before updating again.'
                : 'The prepared build has no valid approval window. Choose Update to prepare a fresh build.';
            render(pending);
            return;
        }
        authorized.approvalSent = true;
        const fields={operation_id:pending.operation_id,release_id:pending.release_id};
        pending={...pending,phase:'applying'};
        statusOverride='Installing the verified version you selected. The Vessel may briefly disconnect.';
        render(pending);
        void mutate('update_apply',fields);
    }
    async function refresh() {
        const {c,caps} = context || {};
        if (!c || !mayObserveUpdates(caps) || busy || (!verifiedUserUpdates(caps) && !pending?.operation_id)) return;
        const n=generation;
        try {
            const record = await exchange(c,'update_status',{operation_id:pending?.operation_id || '00000000-0000-0000-0000-000000000000'});
            if (!active(c,n)) return;
            if (pending?.operation_id && record.operation_id !== pending.operation_id) throw Error('Update identity changed. Reopen update review.');
            let verified = false;
            if (record.phase === 'complete') {
                const capabilities = await exchange(c,'capabilities',{});
                if (!active(c,n)) return;
                if (capabilities.vessel_id !== c.vessel_id) throw Error('Vessel identity changed. Reconnect before reviewing updates.');
                verified = capabilities.running_release === record.release_id && capabilities.features?.includes('execution_profiles');
                context.caps=capabilities;
                text('update-current',capabilities.version || 'unknown');
            }
            remember(record);
            if (record.phase === 'complete') {authorized=null;statusOverride=null;}
            render(record);
            if (record.phase === 'ready') maybeAutoApply();
            if (record.phase === 'complete') {
                statusOverride = verified
                    ? 'Update complete. Reconnected to the verified Vessel version.'
                    : 'This saved update is complete, but this connection does not match its reviewed release. Check for updates to review the current installation.';
                render(record);
                $('update-continue').hidden = !verified;
            }
        } catch (error) { if (active(c,n)) {statusOverride=error.message;render(pending);} }
        if (active(c,n) && !busy && pending?.operation_id && !['ready','complete','failed','discarded','unconfirmed'].includes(pending.phase)) {
            clearTimeout(timer); timer=setTimeout(refresh,3000);
        }
    }
    async function mutate(op, fields) {
        if (busy || !verifiedUserUpdates(context?.caps)) return;
        const {c}=context, n=generation;
        let failure = null;
        busy=true; render(pending);
        try {
            const record=await exchange(c,op,fields);
            if (record?.operation_id !== fields.operation_id || (op === 'update_apply' && record.release_id !== fields.release_id)) {
                throw Error('Update identity changed. Check the saved operation before another action.');
            }
            if (active(c,n)) { remember(record.phase === 'complete' ? {...record,phase:'applying'} : record); statusOverride=null; render(pending); }
        } catch(error) { if (active(c,n)) { failure=error.message; statusOverride=failure; render(pending); } }
        finally { if (active(c,n)) { busy=false; render(pending); } }
        // Resolve the already journalled identity after an uncertain response.
        if (active(c,n)) await refresh();
        if (failure && active(c,n) && pending?.phase === 'ready' && !reviewExpired(pending)) {
            statusOverride=`${failure} The prepared build remains saved; approval was not repeated. Check its status before another action.`;
            render(pending);
        }
    }
    function prepare({channel,version}) {
        const record={operation_id:uuid(),phase:'preparing'};
        authorized={operation_id:record.operation_id,channel,version,approvalSent:false};
        try { remember(record); } catch {
            authorized=null;
            statusOverride='Browser recovery storage is unavailable. Enable it before updating this Vessel.';
            render(pending);
            return;
        }
        statusOverride='The Vessel is verifying the selected version. It will install only if the prepared version matches.';
        render(record);
        void mutate('update_prepare',{operation_id:record.operation_id,channel});
    }
    listen('update-check',async() => {
        if (busy || !verifiedUserUpdates(context?.caps) || !mayPrepare(pending) || authorized?.approvalSent) return;
        const release=selectedRelease();
        if (!release) return;
        const installedChannel=installedReleaseChannel(context.caps.version);
        const comparison=release.channel === installedChannel ? compareReleaseVersions(release.version,context.caps.version) : null;
        if (comparison !== null && comparison <= 0) return;
        statusOverride=null;
        if (pending?.phase === 'ready') {
            const {c}=context,n=generation,oldOperation=pending.operation_id;
            if (!reviewExpired(pending) && pending.channel === release.channel && compareReleaseVersions(pending.version,release.version) === 0) {
                authorized={operation_id:oldOperation,...release,approvalSent:false};
                maybeAutoApply();
                return;
            }
            authorized=null;
            await mutate('update_discard',{operation_id:oldOperation});
            if (!active(c,n) || pending?.operation_id !== oldOperation || pending.phase !== 'discarded') return;
        }
        prepare(release);
    });
    listen('update-discard',() => {
        if (pending?.phase !== 'ready' || busy || !verifiedUserUpdates(context?.caps)) return;
        authorized=null;
        void mutate('update_discard',{operation_id:pending.operation_id});
    });
    const channelSelect=$('update-channel'), rerender=()=>render(pending);
    channelSelect.addEventListener('change',rerender);
    listeners.push(()=>channelSelect.removeEventListener('change',rerender));
    listen('update-refresh',refresh);
    listen('update-continue',() => resume());
    listen('setup-update-open',() => { show(); refresh(); });
    return {
        bind(c,caps) {
            ++generation; clearTimeout(timer); busy=false; pending=null; authorized=null; statusOverride=null; context=c && caps ? {c,caps}:null;
            $('setup-update-open').hidden = !context;
            if (!context) return;
            text('update-vessel-name',`Update ${c.name}`); text('update-current',caps.version || 'unknown');
            try { pending=JSON.parse(localStorage.getItem(storageKey(c)) || 'null'); } catch { pending=null; }
            if (pending?.operation_id) pending={operation_id:pending.operation_id,phase:'observing',message:mayObserveUpdates(caps)
                ? 'Checking the saved update. Approval will not be repeated.'
                : 'The saved update is retained, but this connection cannot check its status. Approval will not be repeated.'};
            render(pending);
            if (mayObserveUpdates(caps) && pending?.operation_id) refresh();
        },
        releasesChanged() { if (context) render(pending); },
        required() { show(); },
        dispose() { ++generation; clearTimeout(timer); context=null; listeners.forEach(remove=>remove()); },
    };
}
