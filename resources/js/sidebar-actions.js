import {request, voyageResult, mutation, uuid} from './vessel-client.js';

const activeRun = s => ['starting','running','cancelling'].includes(s?.run?.state);
const archived = v => Boolean(v.process.archive || v.snapshot?.lifecycle?.archived);
const terminal = new Set(['applied','accepted','requested','already_terminal','deleted','not_applied']);
const actionLabel = op => ({set_access:'access change',rename:'rename',archive:'archive change',branch:'branch creation',cancel:'stop request',clear:'conversation clear',compact:'context compaction',delete:'deletion',restart:'restart'})[op] || 'action';
const uncertainAction = op => `We can’t confirm whether the ${actionLabel(op)} went through. Check the voyage and its receipt before trying again.`;
const observedAction = (op,status) => status==='unknown_after_restart'?uncertainAction(op):status==='not_applied'?`The ${actionLabel(op)} was not applied. Reopen for a fresh review.`:`The ${actionLabel(op)} was ${['accepted','requested'].includes(status)?'accepted':'recorded'}. Reopen to check the current voyage state.`;
const descriptions = {
    access:'Change execution policy on the owning Vessel. Configured roots and server limits still apply.',
    rename:'Rename this voyage.', archive:'Archive an idle voyage, or restore an archived voyage.',
    branch:'Create an independent voyage with copied canonical history and current settings. No active run or pending approvals are copied. Provider continuation is reset; future turns can incur provider charges.',
    cancel:'Request cancellation of this exact run. Requested cancellation is not proof of completed cleanup.',
    clear:'Remove current messages and provider continuation, preserving voyage identity and prior run/receipt evidence. This is not forensic erasure. Branch first if you need a copy.',
    compact:'Compact working context while preserving canonical conversation history. This can reset provider continuation.',
    delete:'Permanently delete this voyage’s conversation history. This cannot be undone.', details:'Fresh public voyage details.',
};
export function actionReason(action, view, connection) {
    if (!connection.client) return 'Vessel is offline.';
    if (!view) return 'Loading fresh voyage state…';
    if (action === 'details' && view.process) return null;
    if (view.error) return view.error;
    if (connection.journal.entries().some(e => e.session_id === view.process.session_id)) return 'An earlier command is unresolved. Check its receipt; do not repeat it.';
    const caps = view.caps;
    if (['access','branch'].includes(action) && caps.scope !== 'owner') return 'Executing-account owner authority is required.';
    const rights = {rename:['lifecycle'],archive:['lifecycle'],branch:['create','history','lifecycle'],cancel:['cancel'],clear:['lifecycle'],compact:['lifecycle'],delete:['lifecycle'],access:['execute']};
    if ((caps.scope !== 'owner' || Array.isArray(caps.rights)) && rights[action]?.some(r => !caps.rights?.includes(r))) return 'This connection lacks the required authority.';
    if (action === 'archive' && view.process.state === 'stopped' && view.process.archive) return null;
    if (archived(view) && action !== 'archive') return 'Restore this archived voyage first.';
    if (!['live','suspended'].includes(view.process.state)) return 'Voyage is unavailable; unavailable is not stopped.';
    const s = view.snapshot;
    if (!s) return 'No current snapshot.';
    if (s.lifecycle?.deleted) return 'History has been deleted.';
    if (action === 'cancel') return activeRun(s) ? null : 'There is no active run to cancel.';
    if (activeRun(s) && action !== 'access') return 'Wait for the current run to finish.';
    if (s.pending_cleanup_run && !(action === 'access' && activeRun(s))) return 'Waiting for confirmed cleanup.';
    return null;
}
async function read(client, op, fields = {}) {
    const response = await client.exchange(request(op, fields));
    if (response?.protocol !== 1 || response.outcome_unknown !== false || response.error) throw new Error(response?.error?.message || response?.error || 'Vessel could not confirm this read.');
    return response.result;
}
export async function inspect(connection, id) {
    const client = connection.client;
    if (!client) throw new Error('Vessel is offline.');
    const caps = await read(client,'capabilities');
    const process = await read(client,'inspect',{session_id:id});
    if (process.session_id !== id || !process.incarnation) throw new Error('Voyage identity changed.');
    let snapshot = null, error = null;
    try { if (['live','suspended'].includes(process.state)) {
        snapshot = voyageResult(await client.exchange(request('snapshot',{session_id:id,incarnation:process.incarnation})),id,process.incarnation).result;
        if (snapshot.session_id !== id || !Number.isSafeInteger(snapshot.revision)) throw new Error('Invalid snapshot.');
    }
    } catch (failure) { error = failure.message; }
    if (client !== connection.client) throw new Error('Connection changed; reopen the action.');
    return {caps,process,snapshot,client,error};
}
export function sidebarActions(root, {changed = () => {}, modal = name => window.Flux.modal(name)} = {}) {
    const $ = id => root.querySelector(`#sidebar-${id}`);
    let epoch = 0, current = null, sending = false, receiptTimer = null;
    const status = text => { $('action-status').textContent = text; };
    function stopReceiptObservation() { if (receiptTimer !== null) { clearTimeout(receiptTimer); receiptTimer = null; } }
    function pendingFor(connection,item) { return connection.journal.entries().some(entry=>entry.session_id===item.session_id && entry.sidebar_action); }
    function observeReceipts(mine,remaining=3) {
        stopReceiptObservation();
        if(mine!==epoch || !current || !pendingFor(current.connection,current.item)) return;
        receiptTimer=setTimeout(async()=>{
            receiptTimer=null;
            if(mine!==epoch || !current) return;
            if(sending) { observeReceipts(mine,remaining); return; }
            await reconcile();
            if(mine!==epoch || !current || !pendingFor(current.connection,current.item)) return;
            if(remaining>1) observeReceipts(mine,remaining-1);
            else status(uncertainAction(current.connection.journal.entries().find(entry=>entry.session_id===current.item.session_id&&entry.sidebar_action)?.op));
        },1500);
    }
    function invalidate() { stopReceiptObservation(); epoch++; current = null; if ($('submit')) $('submit').disabled = true; }
    function bind(node, connection, item) {
        const row = node.querySelector('[data-voyage-row]'), menu = node.querySelector('[data-flux-menu]');
        let loaded = null, ticket = 0;
        async function prepare() {
            const mine = ++ticket; loaded = null; render();
            try { const next = await inspect(connection,item.session_id); if (mine === ticket) loaded = next; }
            catch(error) { if (mine === ticket) loaded = {error:error.message}; }
            if (mine === ticket) render();
        }
        function render() {
            for (const control of menu.querySelectorAll('[data-voyage-action]')) {
                const reason = actionReason(control.dataset.voyageAction,loaded,connection);
                control.disabled = Boolean(reason); control.setAttribute('aria-disabled',String(Boolean(reason)));
                control.title = reason || descriptions[control.dataset.voyageAction];
                let hint = control.querySelector('[data-disabled-reason]');
                if (!hint) { hint=document.createElement('span'); hint.dataset.disabledReason=''; hint.className='block text-xs opacity-70'; control.append(hint); }
                hint.textContent = reason || '';
            }
        }
        row.addEventListener('contextmenu',prepare,true);
        function openMenu(event) {
            event.preventDefault(); event.stopPropagation(); const rect=row.getBoundingClientRect();
            row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.right,clientY:rect.bottom}));
            queueMicrotask(() => menu.focus());
        }
        node.querySelector('[data-voyage-actions]').addEventListener('click',openMenu);
        row.addEventListener('keydown',event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event); });
        for (const control of menu.querySelectorAll('[data-voyage-action]')) control.addEventListener('click',() => {
            if (!control.disabled) open(connection,item,control.dataset.voyageAction);
        });
        render();
        return (nextConnection, nextItem) => { connection = nextConnection; item = nextItem; };
    }
    /** @param {{index:number,revision:number,incarnation:string}|null} boundary */
    async function open(connection,item,action,boundary = null) {
        const selected=boundary?{index:boundary.index,revision:boundary.revision,incarnation:boundary.incarnation}:null;
        stopReceiptObservation(); const mine = ++epoch; current = null;
        await modal('sidebar-action').show();
        if (mine !== epoch) return;
        bindListeners();
        if (!$('submit')) throw new Error('Action dialog unavailable.');
        $('submit').disabled=true;
        $('action-title').textContent=({access:'Access mode',archive:'Archive or restore',cancel:'Cancel run',details:'Voyage details'})[action] || action[0].toUpperCase()+action.slice(1);
        $('action-target').textContent=`${item.name || item.session_id} · ${connection.name} · ${item.session_id}`;
        for (const name of ['name','access','branch','retain','confirm']) $(`${name}-field`).hidden=true;
        $('details-summary').hidden=true; $('details-advanced').hidden=true; $('access-review').hidden=true; $('confirm').value=''; $('branch').disabled=false;
        $('reconcile').hidden=!pendingFor(connection,item);
        status('Loading fresh voyage state…');
        try {
            const view = await inspect(connection,item.session_id);
            if (mine !== epoch) return;
            if(selected&&(action!=='branch'||!Number.isSafeInteger(selected.index)||selected.index<0||selected.index>4294967295||!Number.isSafeInteger(selected.revision)||selected.revision<0||typeof selected.incarnation!=='string'||!selected.incarnation))throw new Error('Message point unavailable. Reopen the current message.');
            const point=selected;
            if(point&&(view.process.incarnation!==point.incarnation||view.snapshot?.revision!==point.revision))throw new Error('The conversation changed since this message was selected. Reopen the current message.');
            current={connection,item,action,view,mine,boundary:point};
            const reason=actionReason(action,view,connection);
            status(reason || descriptions[action]);
            $('submit').hidden=action==='details';
            $('submit').textContent=action==='archive' ? (archived(view) ? 'Restore voyage' : 'Archive voyage') : ({rename:'Rename voyage',access:'Save access mode',branch:'Create branch',cancel:'Request cancellation',compact:'Compact context',clear:'Clear conversation',delete:'Delete voyage'})[action] || 'Confirm';
            if (action==='details') {
                $('details-summary').hidden=false; $('details-advanced').hidden=false;
                const values={name:view.snapshot?.name||item.name||item.session_id,process:view.process.state||'Unknown',run:view.snapshot?.run?.state||'No current run',access:({'read-only':'Read only',approval:'Approval',unrestricted:'Full access'})[view.snapshot?.access]||'Unavailable',workspace:view.snapshot?.workspace||view.process.workspace||'Unavailable'};
                for(const [key,value] of Object.entries(values)) $('details-'+key).textContent=key==='process'||key==='run'?String(value).replaceAll('_',' '):String(value);
                const snapshot=view.snapshot;
                $('action-details').textContent=JSON.stringify({
                    process:{session_id:view.process.session_id,incarnation:view.process.incarnation,state:view.process.state,archive:view.process.archive,workspace:view.process.workspace},
                    snapshot:snapshot&&{session_id:snapshot.session_id,revision:snapshot.revision,lifecycle:snapshot.lifecycle,run:snapshot.run&&{run_id:snapshot.run.run_id,state:snapshot.run.state,failure_summary:snapshot.run.failure_summary},pending_cleanup_run:snapshot.pending_cleanup_run,cleanup:snapshot.cleanup,access:snapshot.access,workspace:snapshot.workspace,message_offset:snapshot.message_offset,loaded_message_count:snapshot.messages?.length},
                    error:view.error,
                },null,2);
            }
            if (['rename','branch'].includes(action)) { $('name-field').hidden=false; $('name').value=action==='rename' ? view.snapshot?.name || item.name || '' : ''; }
            if (action==='access') { $('access-field').hidden=false; $('access-review').hidden=false; $('access').value=view.snapshot?.access || 'approval'; updateAccessReview(); }
            if (action==='compact') $('retain-field').hidden=false;
            if (action==='branch' && !reason) {
                $('branch-field').hidden=false; $('branch').replaceChildren(new Option('Full conversation',''));
                current.branchOffset=point?.index??0; current.branchIndices=new Set();
                await loadBranchPoints();
                if(mine!==epoch||current?.mine!==mine)return;
                if(point){
                    if(!current?.branchIndices.has(point.index)||!current.branchBoundaryObserved)throw new Error('The selected user message is not available at this conversation revision.');
                    $('branch').value=String(point.index);$('branch').disabled=true;$('branch-more').hidden=true;
                    $('branch').selectedOptions[0].textContent='Selected user message';
                    status(`${descriptions.branch} Copy history through the selected message. Workspace files stay as they are.${current.branchBoundaryPreview?` Selected text: ${current.branchBoundaryPreview}`:''}`);
                }
            }
            if (['clear','delete','compact'].includes(action)) { $('confirm-field').hidden=false; $('confirm-label').textContent=`Type ${action==='compact' ? 'COMPACT' : action.toUpperCase()} to confirm`; }
            $('submit').disabled=Boolean(reason || action==='access' && $('access').value===view.snapshot?.access);
            if(action==='rename'&&!reason){$('name').focus();$('name').select();}
            if(pendingFor(connection,item)) observeReceipts(mine);
        } catch(error) { if(mine===epoch) {current=null;status(error.message); $('submit').disabled=true;} }
    }
    function updateAccessReview() {
        if(!current || current.action!=='access') return;
        const labels={'read-only':'Read only',approval:'Approval',unrestricted:'Full access'};
        const currentMode=labels[current.view.snapshot?.access]||'Unknown',nextMode=labels[$('access').value]||'Unknown';
        $('access-summary').textContent=`Current: ${currentMode}. Proposed: ${nextMode}. This changes future tool authority for this voyage on ${current.connection.name}. Configured roots and host limits still apply.`;
        $('submit').disabled=Boolean(actionReason('access',current.view,current.connection) || $('access').value===current.view.snapshot?.access);
    }
    async function loadBranchPoints() {
        const target=current;
        if(!target || target.action!=='branch' || target.branchLoading) return;
        const {view,item,mine}=target, offset=target.branchOffset;
        target.branchLoading=true; $('branch-more').disabled=true;
        try {
            const page=voyageResult(await view.client.exchange(request('history',{session_id:item.session_id,incarnation:view.process.incarnation,expected_revision:view.snapshot.revision,offset,limit:128})),item.session_id,view.process.incarnation).result;
            if(mine!==epoch || current!==target) return;
            if(page.revision!==view.snapshot.revision || page.message_offset!==offset) throw new Error('History changed during branch review.');
            if(!Array.isArray(page.messages)||page.messages.length>128)throw new Error('Invalid bounded branch history.');
            for(const [n,message] of (page.messages || []).entries()) if(message.role==='user') {
                const index=message.message_index ?? offset+n;
                if(!Number.isSafeInteger(index)||index<offset) throw new Error('Invalid canonical index.');
                target.branchIndices.add(index); $('branch').append(new Option(`Through user message ${index+1}`,String(index)));
                if(target.boundary&&message.message_index===target.boundary.index){
                    target.branchBoundaryObserved=true;
                    const value=Array.isArray(message.parts)&&message.parts.length?message.parts.filter(part=>part.type==='text').map(part=>part.text||'').join(' '):typeof message.content==='string'?message.content:'';
                    target.branchBoundaryPreview=value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').slice(0,160);
                }
            }
            $('branch-more').hidden=!page.has_more;
            if(page.has_more && (!Number.isSafeInteger(page.next_offset)||page.next_offset<=offset)) throw new Error('History paging did not advance.');
            target.branchOffset=page.next_offset;
        } finally {target.branchLoading=false; if(mine===epoch) $('branch-more').disabled=false;}
    }
    async function send(connection, command) {
        connection.journal.prepare({...command,sidebar_action:true});
        const response=await connection.client.exchange(request(command.op,Object.fromEntries(Object.entries(command).filter(([k])=>k!=='op'))));
        if (response?.protocol!==1 || response.outcome_unknown!==false) throw new Error('Outcome unknown. Check the receipt; do not repeat this action.');
        if (response.error) { if(!['branch','restart'].includes(command.op)) connection.journal.settle(command.command_id); throw new Error(response.error.message || String(response.error)); }
        return response;
    }
    async function execute(event) {
        event.preventDefault(); event.stopPropagation(); if (!current || sending) return;
        const target=current, {connection,item,action,view,mine}=target;
        sending=true; $('submit').disabled=true;
        try {
            if (['clear','delete','compact'].includes(action) && $('confirm').value !== (action==='compact'?'COMPACT':action.toUpperCase())) throw new Error('Enter the exact confirmation word.');
            const fields={};
            if (['rename','branch'].includes(action)) { fields.name=$('name').value.trim() || null; if(fields.name && new TextEncoder().encode(fields.name).length>256) throw new Error('Name exceeds 256 UTF-8 bytes.'); if(action==='rename' && !fields.name) throw new Error('Enter a name.'); }
            if (action==='compact') { fields.retain=Number($('retain').value); fields.preserve_canonical=true; if(!Number.isInteger(fields.retain)||fields.retain<0||fields.retain>4294967295||!$('retain').value) throw new Error('Enter a valid message count.'); }
            if (action==='branch') { fields.branch_id=uuid(); fields.through_message=$('branch').value===''?null:Number($('branch').value); if(fields.through_message!==null && (!Number.isSafeInteger(fields.through_message)||fields.through_message<0||!target.branchIndices?.has(fields.through_message))) throw new Error('Invalid branch boundary.'); if(target.boundary&&(!target.branchBoundaryObserved||fields.through_message!==target.boundary.index))throw new Error('The selected message point changed. Reopen the message.'); }
            if (action==='access') { fields.access=$('access').value; if(fields.access===view.snapshot?.access) throw new Error('Choose a different access mode.'); }
            if (['clear','delete'].includes(action)) fields.confirm_session_id=item.session_id;
            const fresh=await inspect(connection,item.session_id);
            if(mine!==epoch || current!==target || fresh.client!==view.client) throw new Error('Selection or connection changed; nothing sent. Reopen the action.');
            if(fresh.process.incarnation!==view.process.incarnation || fresh.snapshot?.revision!==view.snapshot?.revision || fresh.process.state!==view.process.state) throw new Error('Voyage changed since review. Reopen this action.');
            const reason=actionReason(action,fresh,connection); if(reason) throw new Error(reason);
            let base=fresh, commandId=uuid();
            if(action==='archive' && fresh.process.state==='stopped' && fresh.process.archive) {
                const reply=await send(connection,{op:'restart',command_id:commandId,session_id:item.session_id,incarnation:fresh.process.incarnation});
                if(reply.result?.session_id!==item.session_id || !reply.result.incarnation || reply.result.incarnation===fresh.process.incarnation) throw new Error('Restart outcome unconfirmed. Check pending receipt.');
                base=await inspect(connection,item.session_id);
                if(base.process.incarnation!==reply.result.incarnation || !base.snapshot) throw new Error('Restored process identity unconfirmed.');
                connection.journal.settle(commandId);
                if(mine!==epoch || current!==target) throw new Error('Restart observed, but selection changed. Reopen Restore to finish.');
            }
            if(action==='archive') fields.archived=!archived(fresh);
            const op=action==='access'?'set_access':action;
            const command=mutation(op,base.snapshot,base.process.incarnation,{...fields,command_id:commandId}).command;
            const response=await send(connection,command);
            if(action==='branch') {
                if(response.result?.session_id!==fields.branch_id || !response.result.incarnation) throw new Error('Branch start unconfirmed. Check pending receipt.');
                connection.journal.settle(commandId);
            } else {
                const envelope=voyageResult(response,item.session_id,base.process.incarnation);
                if(envelope.result?.command_id!==commandId || !terminal.has(envelope.result.status)) throw new Error('Outcome unconfirmed. Check pending receipt.');
                connection.journal.settle(commandId);
                if(['not_applied','unknown_after_restart'].includes(envelope.result.status)) throw new Error(observedAction(op,envelope.result.status));
            }
            if(mine===epoch) {status(action==='branch'?`Branch created: ${fields.branch_id}`:action==='cancel'?'Cancellation requested; cleanup may still be pending.':'Action confirmed by Vessel.'); current=null;}
            changed();
        } catch(error) { if(mine===epoch) status(error.message); }
        finally { sending=false; if(mine===epoch) { $('reconcile').hidden=!pendingFor(connection,item); if(current) $('submit').disabled=Boolean(actionReason(action,view,connection) || action==='access' && $('access').value===view.snapshot?.access); if(current&&pendingFor(connection,item)) observeReceipts(mine); } }
    }
    async function reconcile() {
        if(!current || sending) return;
        const {connection,item,mine}=current; sending=true; $('submit').disabled=true;
        try {
            const entries=connection.journal.entries().filter(e=>e.session_id===item.session_id && e.sidebar_action);
            if(!entries.length) {status('No pending sidebar command. Reopen the action for a fresh review.');return;}
            for(const entry of entries) {
                if(entry.op==='restart') {
                    const process=await read(connection.client,'inspect',{session_id:item.session_id});
                    if(process.incarnation!==entry.incarnation && ['live','suspended'].includes(process.state)) {connection.journal.settle(entry.command_id);if(mine===epoch) status('A restarted process is observed. Reopen Restore to finish; no command was replayed.');}
                    else if(mine===epoch) status(uncertainAction('restart'));
                    continue;
                }
                const reply=await read(connection.client,'receipt',{session_id:item.session_id,command_id:entry.command_id});
                if(reply.session_id!==item.session_id || reply.result?.command_id!==entry.command_id) throw new Error('Receipt identity mismatch.');
                const receipt=reply.result;
                if(entry.op==='branch' && receipt.status==='snapshot_committed') {
                    if(receipt.branch_id!==entry.branch_id) throw new Error('Branch receipt identity mismatch.');
                    const child=await read(connection.client,'inspect',{session_id:entry.branch_id});
                    if(child.session_id!==entry.branch_id || !child.incarnation) throw new Error('Source frozen; branch start is still uncertain.');
                    connection.journal.settle(entry.command_id); if(mine===epoch) status('Branch created. Reopen to review the new voyage.');
                } else if(entry.op==='branch' && !['not_applied','unknown_after_restart'].includes(receipt.status)) { if(mine===epoch) status(uncertainAction(entry.op)); } else if(terminal.has(receipt.status)) {connection.journal.settle(entry.command_id);if(mine===epoch) status(observedAction(entry.op,receipt.status));}
                else if(mine===epoch) status(uncertainAction(entry.op));
            }
            changed();
        } catch { if(mine===epoch) status('We couldn’t verify this action. Check the current voyage and try the receipt review again when connected.'); }
        finally {sending=false; if(mine===epoch) $('reconcile').hidden=!pendingFor(connection,item);}
    }
    let boundForm = null;
    function bindListeners() {
        const form = $('action-form');
        if (!form || form === boundForm) return;
        boundForm = form;
        $('branch-more').addEventListener('click',()=>loadBranchPoints().catch(error=>{status(error.message); $('submit').disabled=true;}));
        $('access').addEventListener('change',updateAccessReview);
        form.addEventListener('submit',execute);
        $('reconcile').addEventListener('click',reconcile);
        $('dismiss').addEventListener('click',()=>{invalidate();modal('sidebar-action').close();});
    }
    bindListeners();
    return {bind,open,invalidate,reconcile};
}
