import {DraftSlot,type DraftRepository} from './drafts';
import {assertGoalReview,validateGoalAction,goalReceipt,type GoalAction,type GoalReview} from './goals';
import {uuid, request, voyageResult, mutation, resolved, receiptStatus, initializeEntities} from '../js/vessel-client.js';
import {ConversationStream} from '../js/conversation-stream.js';
import {entityPresentation} from '../js/event-initialization.js';
import {preparePicture, MAX_PICTURE_BYTES, MAX_PICTURES} from './prepare-picture';
import {inspectionRequest,inventorySupports,type InspectionScope} from './inspection-command';

export type Connection = {id: string; name: string; client: any; journal: any; voyages: any[]; status: string};
export type Picture = {id: string; name: string; size: number; url: string; base64: string; uploadId: string; attachment?: any; file?:File};
export type Tab = {key: string; vessel: string; session: string; title: string; draft: string; snapshot: any; incarnation: string | null; stale: boolean; busy: boolean; notice: string; receiptStates: Record<string,string>; freshAt: number; decisions: any[]; rights?: string[]; scope?: string; capabilities?:string[]; pictures: Picture[]; scrollTop?: number; following?: boolean; draftState?:DraftSlot; draftLoading?:boolean};
const actionName=(op:string)=>['submit','submit_content','steer'].includes(op)?'message':({operator_tool:'workspace request',set_access:'access change',set_account_inference:'model change',cancel:'stop request',respond:'decision',goal_update:'goal change'} as Record<string,string>)[op]||'action';
const uncertainNotice=(op:string)=>`We can’t confirm whether your ${actionName(op)} went through. Check the conversation and receipt before trying again.`;
const statusReadNotice='Voyage status unavailable. Check the Vessel connection.';
const notApplied=(status:string)=>['not_applied','not_admitted','rejected'].includes(status);
const settledNotice=(op:string,status:string)=>notApplied(status)?`Your ${actionName(op)} was not applied. Review the current voyage before trying again.`:`Your ${actionName(op)} was ${status==='accepted'||status==='queued'||status==='requested'?'accepted':'recorded'}. Check the voyage for its result.`;
// Transport state outlives React renders; optional local drafts never dispatch.
export class Workspace {
    tabs = new Map<string, Tab>();
    private draftReads = new Map<string,Promise<void>>();
    private reads = new Map<string, Promise<void>>();
    private streams = new Map<string, {client: any; incarnation: string; stream: ConversationStream; stop: () => void}>();
    private observedClients = new Map<string, any>();
    private eventRetryAt = new Map<string, number>();
    private legacyEvents = new Set<string>();
    private listeners = new Set<() => void>();
    private closed = false;
    private queued = new Set<string>();
    private epochs = new Map<string, number>();
    private autoReceiptReads = new Map<string, number>();
    version = 0;
    constructor(private connections: () => Map<string, Connection>, private drafts?:DraftRepository) {}
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    getVersion = () => this.version;
    changed = () => { this.version++; this.listeners.forEach(listener => listener()); };
    open(vessel: string, session: string, title: string) {
        const key = JSON.stringify([vessel, session]);
        if (!this.tabs.has(key)) {
            const tab:Tab = {key, vessel, session, title, draft: '', snapshot: null, incarnation: null, stale: true, busy: false, notice: '', receiptStates: {}, freshAt: 0, decisions: [], pictures: []};
            this.tabs.set(key,tab);
            if(this.drafts){
                const slot=new DraftSlot(this.drafts,key,()=>this.changed());tab.draftState=slot;tab.draftLoading=true;
                const restoring=slot.loaded().then(async()=>{
                    if(this.closed||this.tabs.get(key)!==tab)return;
                    tab.draft=slot.value.text;
                    const pictures=await Promise.all(slot.value.pictures.map(file=>this.picture(file,file.name)));
                    if(this.closed||this.tabs.get(key)!==tab){pictures.forEach(picture=>URL.revokeObjectURL(picture.url));return;}
                    tab.pictures=pictures;this.changed();
                }).catch(()=>{tab.notice='Saved pictures could not be restored. Keep this page open.';this.changed();}).finally(()=>{tab.draftLoading=false;this.changed();});
                this.draftReads.set(key,restoring);
            }
        }
        this.changed(); void this.refresh(key); return key;
    }
    draft(key: string, value: string) { const tab = this.tabs.get(key); if (tab && !tab.draftLoading) { tab.draft = value; this.saveDraft(tab); this.changed(); } }
    private saveDraft(tab:Tab){tab.draftState?.set({text:tab.draft,pictures:tab.pictures.map(p=>p.file!).filter(Boolean),delivery:tab.draftState.value.delivery});}
    async restoreDraft(key:string){await this.draftReads.get(key);}
    async saveDrafts(){await Promise.all([...this.tabs.values()].map(tab=>tab.draftState?.flush()));}
    async clearDraft(key:string){
        const tab=this.tabs.get(key);if(!tab||tab.busy||tab.draftLoading)return;
        tab.draft='';tab.pictures.forEach(p=>URL.revokeObjectURL(p.url));tab.pictures=[];
        this.changed();
        await tab.draftState?.discard();
    }
    private async picture(blob:Blob,name:string):Promise<Picture>{
        const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
        for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        return {id:uuid(),name,size:blob.size,url:URL.createObjectURL(blob),base64:btoa(binary),uploadId:uuid(),file:new File([blob],name,{type:blob.type})};
    }
    pending(tab: Tab) { return this.connections().get(tab.vessel)?.journal?.entries().filter((entry: any) => entry.session_id === tab.session) || []; }
    actionable(tab: Tab, op = '') {
        try {
            const pending=this.pending(tab);
            // A previous send may remain unknown after its receipt expires. A fresh
            // canonical snapshot can authorize a distinct new message; the old
            // command ID stays in the journal and is never dispatched again.
            const message=['submit','submit_content','steer'].includes(op);
            const blocked=pending.some((entry:any)=>!message||!['submit','submit_content','steer'].includes(entry.op));
            return Boolean(this.connections().get(tab.vessel)?.client && tab.snapshot && !tab.stale && !tab.busy && Date.now() - tab.freshAt < 35000 && !blocked);
        }
        catch { return false; }
    }
    permitted(tab: Tab, op: string) {
        if(op==='goal_update')return tab.scope==='owner';
        const right = op==='respond'?'decide':op==='cancel'?'cancel':op==='set_account_inference'?'account_use':'execute';
        return tab.scope==='owner'||Boolean(tab.rights?.includes(right));
    }
    connectionChanged(refreshUnchanged = true) {
        for (const tab of this.tabs.values()) {
            const connection = this.connections().get(tab.vessel), stream = this.streams.get(tab.key), client = connection?.client;
            const owner = connection?.voyages.find(voyage => voyage.session_id === tab.session);
            const ownerChanged = Boolean(owner && tab.incarnation && owner.incarnation !== tab.incarnation);
            const clientChanged = this.observedClients.get(tab.key) !== client;
            if (!client) {
                tab.stale = true; stream?.stop(); this.streams.delete(tab.key); this.eventRetryAt.delete(tab.key);
            } else if (ownerChanged || (this.observedClients.has(tab.key) && clientChanged)) {
                // Ticket renewal replaces an authenticated socket before the old
                // one drains. Keep the last confirmed status visible while the
                // replacement is read, but fence actions until that read lands.
                tab.freshAt = 0; stream?.stop(); this.streams.delete(tab.key); this.eventRetryAt.delete(tab.key);
            }
            // Sidebar metadata updates are independent of transcript delivery.
            // Explicit action callbacks still request a fresh canonical review.
            if (client && (refreshUnchanged || clientChanged || ownerChanged || tab.stale)) void this.refresh(tab.key);
        }
        this.changed();
    }
    needsRefresh(key: string) {
        const tab = this.tabs.get(key), stream = this.streams.get(key);
        return Boolean(tab && (tab.stale || !stream?.stream.valid || !stream.client || Date.now() - tab.freshAt > 30000));
    }
    async refresh(key: string): Promise<void> {
        if (this.closed) return;
        if (this.reads.has(key)) { this.queued.add(key); return this.reads.get(key); }
        const tab = this.tabs.get(key), connection = tab && this.connections().get(tab.vessel), client = connection?.client;
        if (!tab || !client || tab.busy) return;
        const epoch = this.epochs.get(key) || 0;
        const task = (async () => {
            try {
                const owner = connection.voyages.find((voyage:any)=>voyage.session_id===tab.session);
                if (!owner?.incarnation) throw new Error('Canonical owner unavailable; refresh the Vessel connection.');
                const scope = await initializeEntities(client,tab.session,owner.incarnation);
                const envelope = {incarnation:scope.fence.incarnation};
                const snapshot = entityPresentation(scope);
                const capabilities = await client.exchange(request('capabilities'));
                const caps = capabilities?.protocol===1 && capabilities.outcome_unknown===false && !capabilities.error ? capabilities.result : {scope:'unknown',rights:[]};
                if (snapshot.session_id !== tab.session || !Number.isSafeInteger(snapshot.revision)) throw new Error('Invalid snapshot identity.');
                let decisions: any[] = [];
                try { if(caps.scope==='owner'||caps.rights?.includes('decide')) decisions = voyageResult(await client.exchange(request('decisions', {session_id: tab.session})), tab.session, envelope.incarnation).result; } catch { /* History and decision authority are independent. */ }
                if (this.closed || this.connections().get(tab.vessel)?.client !== client || tab.busy || (this.epochs.get(key) || 0) !== epoch) return;
                if (tab.snapshot?.revision === snapshot.revision && tab.incarnation === envelope.incarnation) { snapshot.messages = tab.snapshot.messages; snapshot.message_offset = tab.snapshot.message_offset; }
                const currentStream = this.streams.get(key);
                if (currentStream?.stream.valid && currentStream.incarnation === envelope.incarnation && Number.isSafeInteger(snapshot.observation_cursor) && snapshot.observation_cursor < currentStream.stream.cursor) {
                    return;
                }
                if (tab.incarnation && tab.incarnation !== envelope.incarnation) { this.eventRetryAt.delete(key); this.legacyEvents.delete(key); }
                Object.assign(tab, {snapshot, scope:caps.scope, rights:caps.rights||[], capabilities:caps.features||[], incarnation: envelope.incarnation, title: snapshot.name || tab.title, decisions: Array.isArray(decisions) ? decisions : [], stale: false, freshAt: Date.now()});
                this.observedClients.set(key, client);
                if (tab.notice === statusReadNotice) tab.notice = '';
                const existing = this.streams.get(key);
                if (existing && (existing.client !== client || existing.incarnation !== envelope.incarnation || !existing.stream.valid)) {
                    existing.stop(); this.streams.delete(key);
                }
                const stream = this.streams.get(key)?.stream || new ConversationStream();
                if (!this.streams.has(key)) stream.seed(snapshot, envelope.incarnation);
                if (stream.valid && client.subscribe && !this.streams.has(key) && Date.now() >= (this.eventRetryAt.get(key) || 0)) {
                    try {
                        const legacy = this.legacyEvents.has(key);
                        const stop = client.subscribe(tab.session, envelope.incarnation, stream.cursor, (event: any) => {
                            if (this.closed || this.connections().get(tab.vessel)?.client !== client || this.streams.get(key)?.stream !== stream) return;
                            const action = stream.accept(event, tab.snapshot);
                            if (action === 'duplicate') return;
                            if (action === 'append') { tab.freshAt = Date.now(); this.changed(); return; }
                            if (action === 'resync') {
                                this.streams.get(key)?.stop();
                                this.streams.delete(key);
                                // A live owner from before projection negotiation may reject
                                // the new field. Try the exact legacy request once; then back off.
                                if (!legacy && event?.outcome_unknown === true) {
                                    this.legacyEvents.add(key);
                                    this.eventRetryAt.delete(key);
                                } else this.eventRetryAt.set(key, Date.now() + 30000);
                                if (event?.error != null || event?.outcome_unknown !== false) tab.freshAt = 0;
                                else tab.stale = true;
                                this.changed();
                            }
                            void this.refresh(key);
                        }, legacy ? null : 'public-v2');
                        this.streams.set(key, {client, incarnation: envelope.incarnation, stream, stop});
                    } catch { this.eventRetryAt.set(key, Date.now() + 30000); }
                }
            } catch { tab.stale = true; if (!this.pending(tab).length) tab.notice = statusReadNotice; }
            finally { this.changed(); }
        })();
        this.reads.set(key, task);
        try { await task; } finally { this.reads.delete(key); if(this.queued.delete(key) && !this.closed) void this.refresh(key); }
    }
    async goalUpdate(key:string,review:GoalReview,action:GoalAction){
        const tab=this.tabs.get(key);
        if(!tab||!this.actionable(tab,'goal_update')||!this.permitted(tab,'goal_update'))throw new Error('Goal controls require a fresh owner connection and resolved receipts.');
        const current=assertGoalReview(review,tab.snapshot,tab.incarnation);
        validateGoalAction(current,action);
        const active=['accepted','running','awaiting_decision','cancel_requested','starting','cancelling'].includes(tab.snapshot.run?.state);
        if(action.action!=='pause'&&(active||tab.snapshot.pending_cleanup_run))throw new Error('Wait for the run and its cleanup before changing the goal.');
        return this.act(key,'goal_update',{action});
    }
    async act(key: string, op: string, fields: Record<string, unknown> = {}, onReceipt?: (value:any)=>void) {
        const tab = this.tabs.get(key);
        if (!tab || tab.draftLoading || !this.actionable(tab,op) || !this.permitted(tab,op)) return;
        if (tab.snapshot.lifecycle?.archived || tab.snapshot.lifecycle?.deleted || (tab.snapshot.pending_cleanup_run && !['cancel','respond','set_access','steer'].includes(op) && !(op==='goal_update'&&(fields.action as GoalAction)?.action==='pause') && !['running','starting','cancelling'].includes(tab.snapshot.run?.state))) { tab.notice='Voyage lifecycle or cleanup blocks this action. Review its status.'; this.changed(); return; }
        const connection = this.connections().get(tab.vessel)!;
        const client = connection.client;
        const draft = tab.draft;
        if (['submit', 'steer'].includes(op)) {
            if ((!draft.trim() && !tab.pictures.length) || new TextEncoder().encode(draft).length > 65536) { tab.notice = 'Message must contain 1–65536 UTF-8 bytes.'; this.changed(); return; }
            fields = {prompt: draft};
        }
        const pictures = [...tab.pictures];
        const origin = structuredClone(tab.snapshot), incarnation = tab.incarnation;
        let command: any;
        let stage: 'upload' | 'submit' = 'upload';
        this.epochs.set(key, (this.epochs.get(key) || 0) + 1);
        tab.busy = true; this.changed();
        try {
            if (['submit','steer'].includes(op) && pictures.length) {
                const content: any[] = draft ? [{type: 'text', text: draft}] : [];
                for (const picture of pictures) {
                    if (!picture.attachment) {
                        const upload = await client.exchange(request('upload_image', {session_id: tab.session, upload_id: picture.uploadId, name: picture.name, data_base64: picture.base64}));
                        if (upload?.error && upload.outcome_unknown === false) throw new Error(`Picture upload refused: ${upload.error}`);
                        const attachment = voyageResult(upload, tab.session).result;
                        if (!attachment || typeof attachment.id !== 'string' || typeof attachment.sha256 !== 'string' || typeof attachment.byte_size !== 'number') throw new Error('Invalid picture upload receipt.');
                        if (this.closed || this.tabs.get(key) !== tab || this.connections().get(tab.vessel)?.client !== client || tab.incarnation !== incarnation) throw new Error('Voyage connection changed while uploading pictures.');
                        // Artifacts belong to the session, not its transient process.
                        // Keep confirmed uploads even when the process resumes.
                        picture.attachment = attachment;

                    }
                    content.push({type: 'image', attachment: picture.attachment});
                }
                // Snapshot is a read, not an upload/submit replay. Keep busy throughout
                // so one click remains one admission even across a process wake-up.
                const current = voyageResult(await client.exchange(request('snapshot', {session_id:tab.session})), tab.session).result;
                if (this.closed || this.connections().get(tab.vessel)?.client !== client || this.tabs.get(key) !== tab) throw new Error('Voyage connection changed while preparing pictures.');
                if (op === 'steer') {
                    if (current?.session_id !== tab.session || current.run?.run_id !== origin.run?.run_id || current.recovery_pending || !['accepted','running','awaiting_decision'].includes(current.run?.state)) throw new Error('The addressed run finished while preparing pictures. Draft retained.');
                    fields = {prompt:draft, parts:content};
                } else {
                    if (current?.session_id !== tab.session || current.revision !== origin.revision) throw new Error('Conversation changed while preparing pictures. Review the updated conversation before sending.');
                    if (current.lifecycle?.archived || current.lifecycle?.deleted || current.pending_cleanup_run || current.recovery_pending || ['accepted','running','awaiting_decision','cancel_requested','starting','cancelling'].includes(current.run?.state)) throw new Error('Voyage is not ready for a new message. Draft retained.');
                    op = 'submit_content'; fields = {content};
                }
            }
            if (tab.incarnation !== incarnation || tab.snapshot.revision !== origin.revision) throw new Error('Voyage changed while preparing attachments. Nothing submitted.');
            command = mutation(op, origin, incarnation, fields);
            if (this.closed || this.connections().get(tab.vessel)?.client !== client) throw new Error('Voyage connection changed before submission.');
            if(['submit','steer','submit_content'].includes(op))await tab.draftState?.sending();
            if(this.closed||this.connections().get(tab.vessel)?.client!==client||tab.incarnation!==incarnation||tab.snapshot.revision!==origin.revision)throw new Error('Voyage changed before submission. Nothing submitted.');
            stage = 'submit';
            connection.journal.prepare(command.command);
            const response = await client.exchange(command);
            const basicKnown = resolved(response, command.command.command_id, tab.session);
            const goalKnown = op!=='goal_update'||Boolean(response.error)||notApplied(receiptStatus(response))||goalReceipt(response.result?.result,{state:origin.goal,action:fields.action as GoalAction,command:command.command.command_id});
            const known = basicKnown&&goalKnown;
            if (known && receiptStatus(response) !== 'unknown_after_restart') connection.journal.settle(command.command.command_id);
            const status = receiptStatus(response);
            if (known && status === 'unknown_after_restart') tab.receiptStates[command.command.command_id] = status;
            if(known&&!response.error&&!notApplied(status)&&status!=='unknown_after_restart')onReceipt?.(response.result?.result);
            tab.notice = response.error ? `Vessel refused: ${response.error}` : !known || status === 'unknown_after_restart' ? uncertainNotice(op) : notApplied(status) ? settledNotice(op,status) : '';
            if (known && !response.error && ['accepted', 'queued', 'applied'].includes(status) && ['submit', 'steer', 'submit_content'].includes(op)) {
                if (tab.draft === draft) tab.draft = '';
                tab.pictures = tab.pictures.filter(picture => !pictures.includes(picture)); pictures.forEach(picture => URL.revokeObjectURL(picture.url));
                this.saveDraft(tab); await tab.draftState?.flush();
            }
            return Boolean(known && !response.error && !notApplied(status) && status!=='unknown_after_restart');
        } catch (error) {
            const reason = error instanceof Error ? error.message : 'Unexpected error';
            if (stage === 'upload') {
                tab.notice = `${reason} Draft and pictures retained; no message was submitted.`;
            } else {
                tab.notice = uncertainNotice(op);
            }
        }
        finally { tab.busy = false; if (stage === 'submit') tab.stale = true; this.changed(); await this.refresh(key); }
    }
    async inspect(key:string,scope:InspectionScope,path:string){
        const tab=this.tabs.get(key);
        if(!tab||!this.actionable(tab)||!this.permitted(tab,'operator_tool'))throw new Error('Wait for a fresh voyage with execution permission.');
        if(['accepted','running','awaiting_decision','cancel_requested','starting','cancelling'].includes(tab.snapshot?.run?.state))throw new Error('Wait for the current run before inspecting the workspace.');
        const command=inspectionRequest(scope,path);
        const tools=await this.read(key,'controls',{run_id:tab.snapshot?.run?.run_id||null,section:'tools'});
        if(!inventorySupports(tools,command.name))throw new Error(`Executing voyage does not advertise ${command.name}; no local fallback is available.`);
        let receipt:any=null;
        const applied=await this.act(key,'operator_tool',command,value=>{receipt=value;});
        if(!applied||typeof receipt?.run_id!=='string')throw new Error('Inspection admission or exact run identity is unconfirmed. Check the voyage receipt; do not repeat the request.');
        return receipt.run_id as string;
    }
    async canonicalMessage(key:string,index:number,revision:number){
        const tab=this.tabs.get(key);if(!tab||tab.snapshot?.revision!==revision||!Number.isSafeInteger(index))throw new Error('Inspection result changed. Reopen it.');
        const incarnation=tab.incarnation;let offset=0,text='',page:any;
        do{
            page=await this.read(key,'message_chunk',{index,offset,limit:65536,expected_revision:revision});
            if(page.total_bytes>4*1024*1024||typeof page.data!=='string'||new TextEncoder().encode(text).length+new TextEncoder().encode(page.data).length>4*1024*1024||page.has_more&&(!Number.isSafeInteger(page.next_offset)||page.next_offset<=offset))throw new Error('Inspection result exceeds the browser limit or has invalid continuation.');
            text+=page.data;offset=page.next_offset;
        }while(page.has_more);
        if(tab.snapshot?.revision!==revision||tab.incarnation!==incarnation)throw new Error('Inspection result changed. Reopen it.');
        const message=JSON.parse(text);
        if(message.role!=='assistant'||typeof message.content!=='string')throw new Error('Canonical inspection result unavailable.');
        return message.content as string;
    }
    async attach(key: string, files: File[], guard?: () => boolean) {
        const tab = this.tabs.get(key); if (!tab || tab.busy || tab.draftLoading || this.closed || guard && !guard()) return false;
        let success = true;
        tab.busy = true; this.changed();
        try {
            for (const file of files) {
                if (tab.pictures.length >= MAX_PICTURES) throw new Error('At most four pictures per message.');
                const remaining=MAX_PICTURE_BYTES-tab.pictures.reduce((n,p) => n+p.size,0);
                const {blob,name} = await preparePicture(file,remaining);
                const picture=await this.picture(blob,name||'pasted-image');
                if (this.closed || this.tabs.get(key) !== tab || guard && !guard()) {URL.revokeObjectURL(picture.url);throw new Error('Voyage changed; capture not attached.');}
                tab.pictures.push(picture);this.saveDraft(tab);
            }
        } catch (error) { success = false; tab.notice = error instanceof Error ? error.message : 'Picture unavailable.'; }
        finally { tab.busy = false; this.changed(); }
        return success;
    }
    removePicture(key: string, id: string) {
        const tab = this.tabs.get(key); if (!tab || tab.busy) return;
        tab.pictures = tab.pictures.filter(picture => { if (picture.id !== id) return true; URL.revokeObjectURL(picture.url); return false; }); this.saveDraft(tab);this.changed();
    }
    async artifact(key: string, attachment: any) {
        const tab = this.tabs.get(key), client = tab && this.connections().get(tab.vessel)?.client;
        if (!tab || !client) throw new Error('Vessel unavailable.');
        const {imageBytes} = await import('../js/attachments.js');
        return imageBytes(client, attachment, {session_id: tab.session} as any);
    }
    async output(key: string, offset: number) {
        const tab = this.tabs.get(key); if (!tab || !this.actionable(tab)) return;
        const run = tab.snapshot.run;
        const page = await this.read(key, 'run_output', {run_id:run.run_id,offset,limit:65536});
        if (tab.snapshot.run?.run_id !== run.run_id || tab.snapshot.run?.live_text !== run.live_text || tab.snapshot.run?.partial_text !== run.partial_text || tab.snapshot.run?.live_text_offset !== run.live_text_offset || page.run_id !== run.run_id || page.offset !== offset || (page.has_more && page.next_offset <= offset)) throw new Error('Output identity changed.');
        return page;
    }
    async respond(key: string, decision: any, response: unknown) {
        const tab = this.tabs.get(key);
        if (!tab || decision.expires_at_ms <= Date.now() || decision.incarnation !== tab.incarnation || decision.run_id !== tab.snapshot?.run?.run_id) {
            if (tab) { tab.notice = 'Decision expired or voyage changed. Refresh before responding.'; this.changed(); }
            return;
        }
        return this.act(key, 'respond', {decision_id: decision.decision_id, response, expires_at_ms: Math.min(Date.now() + 60000, decision.expires_at_ms)});
    }
    async read(key: string, op: string, fields: Record<string, unknown> = {}) {
        const tab = this.tabs.get(key), connection = tab && this.connections().get(tab.vessel);
        if (!tab || !connection?.client || tab.stale) throw new Error('Wait for a fresh connected snapshot.');
        const client = connection.client, incarnation: any = tab.incarnation;
        const value = voyageResult(await client.exchange(request(op, {session_id: tab.session, ...fields})), tab.session, incarnation).result;
        if (this.closed || this.tabs.get(key) !== tab || this.connections().get(tab.vessel)?.client !== client || tab.incarnation !== incarnation) throw new Error('Voyage connection changed.');
        return value;
    }
    async changes(key:string,scope:'status'|'unstaged'|'staged',path?:string){
        const tab=this.tabs.get(key);
        if(!tab||tab.stale||Date.now()-tab.freshAt>35000)throw new Error('Reconnect the voyage before reviewing changes.');
        if(!tab.capabilities?.includes('workspace_changes'))throw new Error('This Vessel needs an update for automatic Changes review.');
        if(tab.scope!=='owner'&&!tab.rights?.includes('workspace_read'))throw new Error('Workspace review permission is unavailable.');
        const value=await this.read(key,'workspace_changes',{scope,...(path?{path}:{})});
        if(tab.stale||!value||value.scope!==scope||value.path!==(path||'.')||typeof value.text!=='string'||value.text.length>65536||typeof value.truncated!=='boolean'||!Number.isSafeInteger(value.observed_at_ms))throw new Error('Workspace observation changed or was invalid.');
        return value as {scope:typeof scope;path:string;text:string;truncated:boolean;observed_at_ms:number};
    }
    async file(key:string,path:string){
        const tab=this.tabs.get(key);
        const allowed=()=>Boolean(tab&&!tab.stale&&Date.now()-tab.freshAt<=35000&&tab.capabilities?.includes('workspace_file')&&(tab.scope==='owner'||tab.rights?.includes('workspace_read')));
        if(!allowed())throw new Error('Reconnect with workspace read permission and file-preview capability.');
        if(!path||path.length>4096||path.startsWith('/')||path.includes('\\')||/[\u0000-\u001f\u007f]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Invalid workspace-relative file path.');
        const value=await this.read(key,'workspace_file',{path});
        if(!allowed()||!value||value.path!==path||typeof value.text!=='string'||new TextEncoder().encode(value.text).length>65536||typeof value.truncated!=='boolean'||!Number.isSafeInteger(value.observed_at_ms)||!Number.isSafeInteger(value.file_bytes)||value.file_bytes<0||value.observed_bytes!==new TextEncoder().encode(value.text).length||!/^[a-f0-9]{64}$/.test(value.preview_sha256))throw new Error('File observation changed or was invalid.');
        return value as {path:string;text:string;truncated:boolean;file_bytes:number;observed_bytes:number;preview_sha256:string;observed_at_ms:number};
    }
    async earlier(key: string) {
        const tab = this.tabs.get(key); if (!tab || !this.actionable(tab) || !tab.snapshot.message_offset) return;
        tab.busy = true; this.changed();
        const snapshot = tab.snapshot, revision = snapshot.revision;
        try {
            const end = snapshot.message_offset, start = Math.max(0, end - 50); let offset = start;
            const messages: any[] = [];
            while (offset < end) {
                const page = await this.read(key, 'history', {offset, limit: end - offset, expected_revision: revision});
                if (page.revision !== revision || !Number.isSafeInteger(page.next_offset) || page.next_offset <= offset || page.next_offset > end || !Array.isArray(page.messages)) throw new Error('Invalid history continuation.');
                messages.push(...page.messages); offset = page.next_offset;
            }
            if (tab.snapshot !== snapshot) throw new Error('History changed. Refresh before loading earlier messages.');
            tab.snapshot = {...snapshot, messages: [...messages, ...snapshot.messages], message_offset: start};
        } catch { /* Automatic history loading retries after a short pause; keep action notices intact. */ }
        finally { tab.busy = false; this.changed(); }
    }
    async expand(key: string, index: number) {
        const tab = this.tabs.get(key); if (!tab || !this.actionable(tab)) return;
        tab.busy = true; this.changed(); const revision = tab.snapshot.revision;
        try {
            let offset = 0, text = '', page;
            do {
                page = await this.read(key, 'message_chunk', {index, offset, limit: 65536, expected_revision: revision});
                if (page.total_bytes > 4*1024*1024 || (page.has_more && (!Number.isSafeInteger(page.next_offset) || page.next_offset <= offset))) throw new Error('Message exceeds expansion limit or has invalid continuation.');
                if (typeof page.data !== 'string' || new TextEncoder().encode(text).length + new TextEncoder().encode(page.data).length > 4*1024*1024) throw new Error('Message exceeds browser expansion limit.');
                text += page.data; offset = page.next_offset;
            } while (page.has_more);
            if (tab.snapshot.revision !== revision) throw new Error('History changed.');
            const expanded = {...JSON.parse(text), message_index: index, projection_truncated: false};
            tab.snapshot = {...tab.snapshot, messages: tab.snapshot.messages.map((message: any) => message.message_index === index ? expanded : message)};
        } catch (error) { tab.notice = error instanceof Error ? error.message : 'Message unavailable.'; }
        finally { tab.busy = false; this.changed(); }
    }
    async reconcile(key: string) {
        const tab = this.tabs.get(key); if (!tab || tab.busy) return;
        const connection = this.connections().get(tab.vessel); if (!connection?.client) return;
        tab.busy = true; this.changed();
        try {
            let lastSettled:{op:string;status:string}|null=null;
            for (const entry of this.pending(tab)) {
                const response = await connection.client.exchange(request('receipt', {session_id: tab.session, command_id: entry.command_id}));
                if (resolved(response, entry.command_id, tab.session, true) && (entry.op!=='goal_update'||receiptStatus(response)==='unknown_after_restart'||notApplied(receiptStatus(response))||goalReceipt(response.result?.result))) {
                    const status=receiptStatus(response);
                    if (status === 'unknown_after_restart') tab.receiptStates[entry.command_id] = status;
                    else {
                        connection.journal.settle(entry.command_id);
                        delete tab.receiptStates[entry.command_id];
                        lastSettled={op:entry.op,status};
                    }
                }
            }
            const pending=this.pending(tab);
            tab.notice=pending.length===1&&tab.receiptStates[pending[0].command_id]==='unknown_after_restart'?`The Vessel cannot confirm whether your ${actionName(pending[0].op)} was applied after a restart. Review this conversation before sending similar work in a new voyage.`:pending.length===1?uncertainNotice(pending[0].op):pending.length>1?`We can’t confirm ${pending.length} actions yet. Check the conversation and receipts before trying again.`:lastSettled?settledNotice(lastSettled.op,lastSettled.status):tab.notice;
        } catch { tab.notice = 'We can’t check the receipt right now. Check the current voyage before trying again.'; }
        finally { tab.busy = false; this.changed(); }
    }
    async observePending(key: string) {
        const tab = this.tabs.get(key);
        if (this.closed || !tab || tab.busy || !this.connections().get(tab.vessel)?.client) return;
        const entries = this.pending(tab).filter((entry: any) => !entry.sidebar_action && (this.autoReceiptReads.get(entry.command_id) || 0) < 3);
        if (!entries.length) return;
        for (const entry of entries) this.autoReceiptReads.set(entry.command_id, (this.autoReceiptReads.get(entry.command_id) || 0) + 1);
        await this.reconcile(key);
        for (const entry of entries) if (!this.pending(tab).some((pending: any) => pending.command_id === entry.command_id)) this.autoReceiptReads.delete(entry.command_id);
    }
    close() { this.tabs.forEach(tab => tab.pictures.forEach(picture => URL.revokeObjectURL(picture.url))); this.closed = true; this.streams.forEach(stream => stream.stop()); this.streams.clear(); this.observedClients.clear(); this.eventRetryAt.clear(); this.legacyEvents.clear(); this.autoReceiptReads.clear(); this.listeners.clear(); }
}
