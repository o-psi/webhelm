import {request, uuid} from './vessel-client.js';

const terminal = new Set(['succeeded','cancelled','expired','denied','uncertain']);
const providers = {
    chatgpt_oauth: {name:'ChatGPT (experimental)',endpoint:'https://chatgpt.com/backend-api/codex',verification:'https://auth.openai.com/codex/device'},
    xai_oauth: {name:'SuperGrok',endpoint:'https://api.x.ai/v1',verification:'https://accounts.x.ai/oauth2/device'},
};
const supported = p => typeof p?.id === 'string' && p.id.length > 0 && Array.isArray(p.transports) && p.transports.length === 1 && Object.hasOwn(providers,p.transports[0]) && providers[p.transports[0]].endpoint === p.endpoint;
const providerInfo = p => providers[p.transports[0]];
const grokPrerequisite = 'SuperGrok requires native xai_oauth support and account-enrollment permission on this Vessel.';
// Only public enrollment envelopes are durable. Private responses live in this view alone.
export function accountEnrollment(root, {context, refreshed, titleChanged = (_title) => {}}) {
    const $ = id => root.querySelector(`#enrollment-${id}`);
    let generation = 0, active = null, busy = false, timer, stage = 'loading', providerName = null;
    const key = c => `helm-web:enrollment:${root.dataset.tenantId}:${c.connection.id}:${c.connection.vessel_id}:${c.workspace}`;
    function clear() {
        ++generation; clearTimeout(timer);
        $('code').textContent = ''; $('link').removeAttribute('href'); $('private').hidden = true;
    }
    function identify(provider) {
        providerName = provider ? providerInfo(provider).name : null;
    }
    function render(next = stage) {
        stage = next;
        const setup = stage === 'setup', pending = ['pending','recovery'].includes(stage);
        $('setup').hidden = !setup;
        $('start').hidden = !setup;
        $('check').hidden = !pending;
        $('cancel').hidden = !pending;
        const title = providerName ? `Connect ${providerName}` : 'Connect a subscription';
        $('title').textContent = title;
        titleChanged(title);
        $('check').textContent = stage === 'pending' ? 'I’ve signed in' : 'Check sign-in';
        for (const id of ['start','check','cancel','label','provider']) $(id).disabled = busy || stage === 'loading';
        $('panel').setAttribute('aria-busy',String(busy || stage === 'loading'));
    }
    function message(text) { $('status').textContent = text; }
    function current(a, n) { const c = context(); return active === a && generation === n && c?.connection.client === a.client && c.connection === a.context.connection && c.workspace === a.context.workspace; }
    async function exchange(a, op, fields) {
        const reply = await a.client.exchange(request(op, fields));
        if (reply.protocol !== 1 || reply.error != null || reply.outcome_unknown !== false) throw Error();
        return reply.result;
    }
    function saved(c) {
        const record = JSON.parse(localStorage.getItem(key(c)) || 'null');
        if (!record) return null;
        if (!record.command_id || !record.enrollment_id || !record.connection_id || record.workspace !== c.workspace || typeof record.alias !== 'string' || typeof record.label !== 'string' || !record.cancel_id) throw Error();
        // Whitelist fields even when browser storage has been modified.
        return Object.fromEntries(['command_id','enrollment_id','connection_id','workspace','alias','label','cancel_id'].map(k=>[k,record[k]]));
    }
    function envelope(record) { const {cancel_id, ...fields} = record; return fields; }
    async function show(a, n) {
        const result = await exchange(a,'private_account_enrollment',{enrollment_id:a.record.enrollment_id,workspace:a.record.workspace});
        if (!current(a,n)) { if (active === a) clear(); return; }
        const status = result?.status;
        if (status?.enrollment_id !== a.record.enrollment_id) throw Error();
        clear(); n = generation;
        if (terminal.has(status.state)) {
            render(status.state === 'uncertain' ? 'recovery' : status.state === 'succeeded' ? 'done' : 'setup');
            message(status.state === 'succeeded' ? `${providerName} account connected. Reloading account choices…` : `Sign-in ${status.state}. Provider effects may already have occurred; no sign-in is retried automatically.`);
            if (status.state !== 'uncertain') localStorage.removeItem(key(a.context));
            if (status.state === 'succeeded') await refreshed(status.account_id);
            return;
        }
        if (!['starting','pending','exchanging'].includes(status.state)) throw Error();
        render('pending');
        message(status.state === 'pending' ? 'After signing in, come back here and choose “I’ve signed in”.' : 'The provider is processing your sign-in. Check again in a moment.');
        if (status.state === 'pending' && Number.isFinite(status.expires_at) && status.expires_at * 1000 > Date.now()) {
            const verification = providerInfo(a.provider).verification;
            if (result.verification_uri !== verification || typeof result.user_code !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(result.user_code)) throw Error();
            $('link').textContent = `Open ${providerInfo(a.provider).name} sign-in ↗`;
            $('code').textContent = result.user_code; $('link').href = verification; $('private').hidden = false;
            timer = setTimeout(()=>{clear();render('recovery');message('Code expired. Check sign-in for its final status.');},Math.min(status.expires_at*1000-Date.now(),2147483647));
        }
    }
    async function runLocked(kind) {
        if (busy) return;
        clear(); busy = true; render();
        message(kind === 'start' ? 'Starting secure sign-in…' : kind === 'cancel' ? 'Cancelling sign-in…' : 'Checking your sign-in…');
        const c = context();
        try {
            if (!c?.connection?.client || !c.workspace) throw Error();
            const a = active = {context:c,client:c.connection.client,record:null};
            const n = generation;
            a.client.socket?.addEventListener('close',()=>{if(active===a){clear();render('recovery');message('Connection lost. Reconnect, then Check sign-in; do not start again.');}},{once:true});
            a.record = saved(c);
            if (kind === 'start') {
                if (a.record) { identify(null); render('recovery'); message('An earlier sign-in is retained. Check or cancel it before starting another.'); return; }
                const alias = `subscription-${uuid()}`, label = $('label').value.trim();
                if (!label || label.length > 128) {message('Give this account a name, such as Personal or Work.');$('label').focus();return;}
                const caps = await exchange(a,'capabilities',{});
                if (!current(a,n)) return;
                if (caps.vessel_id !== c.connection.vessel_id || (caps.scope !== 'owner' && !caps.rights?.includes('account_enroll'))) {message('This Vessel connection does not permit account enrollment.');return;}
                const catalogue = await exchange(a,'accounts',{workspace:c.workspace});
                if (!current(a,n)) return;
                const provider = catalogue.connections?.find(p=>p.id===$('provider').value && supported(p));
                if (!provider) {message(`This subscription provider is no longer available on this connection. No sign-in was started. ${grokPrerequisite}`);return;}
                a.provider = provider; identify(provider); render();
                a.record = {command_id:uuid(),enrollment_id:uuid(),workspace:c.workspace,connection_id:provider.id,alias,label,cancel_id:uuid()};
                localStorage.setItem(key(c),JSON.stringify(a.record));
                await exchange(a,'enroll_account',envelope(a.record));
            } else {
                if (!a.record) {message('No retained sign-in for this Vessel and workspace.');return;}
                const catalogue = await exchange(a,'accounts',{workspace:c.workspace});
                if (!current(a,n)) return;
                a.provider = catalogue.connections?.find(p=>p.id===a.record.connection_id && supported(p));
                identify(a.provider); render();
                if (!a.provider) throw Error();
                await exchange(a,'resolve_account_enrollment',envelope(a.record));
                if (kind === 'cancel') {
                    if (!current(a,n)) return;
                    await exchange(a,'cancel_account_enrollment',{command_id:a.record.cancel_id,enrollment_id:a.record.enrollment_id,workspace:c.workspace});
                }
            }
            if (current(a,n)) await show(a,n);
        } catch {
            clear(); render('recovery'); message('Sign-in could not be confirmed. Reconnect and use Check sign-in to resolve the original request; it will not be restarted.');
        } finally {busy=false;render();}
    }
    async function run(kind) {
        const c = context(), locks = root.ownerDocument.defaultView.navigator.locks;
        if (!c?.connection || !locks) { message('Account sign-in requires a secure browser with Web Locks support.'); return; }
        try { await locks.request(key(c), {ifAvailable:true}, lock => {
            if (!lock) { message('Another tab is checking this sign-in. Wait, then Check sign-in.'); return; }
            return runLocked(kind);
        }); } catch { clear(); message('Browser coordination failed. Check the original sign-in before continuing.'); }
    }
    for (const kind of ['start','check','cancel']) $(''+kind).addEventListener('click',()=>run(kind));
    function hide() { clear(); $('panel').hidden=true; $('panel').closest('[data-flux-popover]')?.hidePopover?.(); }
    $('close').addEventListener('click',hide);
    const visibilityChanged = () => { if (root.ownerDocument.hidden) clear(); };
    root.ownerDocument.addEventListener('visibilitychange', visibilityChanged);
    return {
        dispose() { hide(); active = null; root.ownerDocument.removeEventListener('visibilitychange', visibilityChanged); },
        hide,
        changed() {if(active && !current(active,generation))clear();},
        async open() {
            clear(); identify(null); render('loading'); $('panel').hidden=false; $('provider').replaceChildren(); message('Loading subscription connections…');
            const c=context(), n=generation;
            if(!c?.connection?.client || !c.workspace){render('unavailable');message('Choose a connected Vessel and workspace first.');return;}
            const a=active={context:c,client:c.connection.client};
            let phase = 'catalogue';
            try {
                const catalogue=await exchange(a,'accounts',{workspace:c.workspace});
                if(!current(a,n))return;
                phase = 'picker';
                for(const p of catalogue.connections || []) if(supported(p)) {
                    const option=root.ownerDocument.createElement('option');option.value=p.id;option.textContent=providerInfo(p).name;$('provider').append(option);
                }
                $('provider-field').hidden = $('provider').options.length < 2;
                const updateProvider = () => {
                    const selected = catalogue.connections.find(p=>p.id===$('provider').value && supported(p));
                    identify(selected); render();
                    $('start').textContent = selected ? `Continue with ${providerInfo(selected).name}` : 'Continue';
                };
                $('provider').onchange = updateProvider;
                phase = 'storage';
                const retained = saved(c);
                if (retained) $('provider').value = retained.connection_id;
                updateProvider();
                phase = 'picker';
                render(retained ? 'recovery' : $('provider').options.length ? 'setup' : 'unavailable');
                if (!retained && !$('provider').options.length) { message(`No authorized native subscription connection is available. ${grokPrerequisite}`); return; }
                if (!retained) $('label').focus();
                message(retained ? 'A prior sign-in is retained. Use Check sign-in; starting again is blocked.' : `Model access and limits depend on your provider and account. No password is entered here.${(catalogue.connections || []).some(p=>supported(p)&&p.transports[0]==='xai_oauth')?'':` ${grokPrerequisite}`}`);
            } catch {
                if (!current(a,n)) return;
                render('unavailable');
                message(phase === 'catalogue' ? 'The Vessel could not confirm the provider-account list. Check that this connection permits account enrollment for the selected workspace.' : phase === 'storage' ? 'The browser could not read the saved sign-in record. Do not clear site storage or start again: a previous sign-in may still be pending.' : 'The account list loaded, but the sign-in picker could not display it. Reload Helm to load the latest interface.');
            }
        },
    };
}
