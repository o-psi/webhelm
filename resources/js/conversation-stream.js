// Display-only public observations. Never turn a preview into an executable call.
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
const bounded = (value, limit) => {
    const bytes = new TextEncoder().encode(clean(value));
    return {text:new TextDecoder('utf-8', {fatal:false}).decode(bytes.subarray(0,limit)).replace(/\ufffd$/, ''), truncated:bytes.length > limit};
};

// Mirrors the native ToolPreview/ReasoningPreview display limits. Identity is
// attempt + index, not the provider call ID (which can arrive in fragments).
export function renderPreviews(root, run, messages = []) {
    const canonical = new Set(messages.flatMap(message => (message.tool_calls || []).map(call => call.id)));
    const rows = [];
    for (const preview of (run?.tool_previews || []).slice(0,32)) {
        if (preview.call_id && canonical.has(preview.call_id)) continue;
        const value = bounded(preview.arguments, 16384);
        rows.push({key:`tool:${preview.attempt_id}:${preview.index}`, title:`${clean(preview.name) || 'Tool call'} · streaming · provisional`, text:value.text, truncated:value.truncated || preview.truncated});
    }
    for (const preview of (run?.reasoning_previews || []).slice(0,32)) {
        const value = bounded(preview.text, 16384);
        rows.push({key:`reasoning:${preview.attempt_id}:${preview.index}:${preview.kind}:${Boolean(preview.finalized)}`, title:`${preview.kind === 'summary' ? 'Reasoning summary' : 'Provider thinking'} · ${preview.finalized ? 'finalized disclosure' : 'streaming · provisional'}`, text:value.text, truncated:value.truncated || preview.truncated});
    }
    const old = new Map([...root.children].map(node => [node.dataset.previewKey,node]));
    for (const row of rows) {
        let node = old.get(row.key);
        if (!node) {
            node = document.createElement('details'); node.dataset.previewKey = row.key;
            node.className = 'my-4 rounded-xl border border-zinc-200 p-3 dark:border-zinc-700';
            node.append(document.createElement('summary'), document.createElement('pre'), document.createElement('p'));
            node.children[1].className = 'mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm';
        }
        node.children[0].textContent = row.title;
        node.children[1].textContent = row.text;
        node.children[2].textContent = row.truncated ? '… preview bounded; more content may be omitted' : '';
        root.append(node); old.delete(row.key);
    }
    for (const node of old.values()) node.remove();
    root.hidden = !rows.length;
}

// Snapshot projection uses the same 64 KiB UTF-8 prefix. Keep the byte cursor
// even after truncation, so later deltas do not cause a snapshot per frame.
const streamTextLimit=65536;
function appendPrefix(prefix, text) {
    const bytes=new TextEncoder().encode(prefix+text);
    let end=Math.min(bytes.length,streamTextLimit);
    while(end<bytes.length&&(bytes[end]&0xc0)===0x80)end--;
    return {text:new TextDecoder().decode(bytes.subarray(0,end)),truncated:end<bytes.length};
}

export class ConversationStream {
    seed(snapshot, incarnation) {
        this.session = snapshot.session_id; this.incarnation = incarnation;
        this.cursor = snapshot.observation_cursor;
        this.valid = Number.isSafeInteger(this.cursor) && this.cursor >= 0;
    }
    accept(event, snapshot) {
        const fail = () => { this.valid = false; return 'resync'; };
        if (!this.valid || event.protocol !== 1 || event.session_id !== this.session || event.incarnation !== this.incarnation || event.error != null || event.outcome_unknown !== false) return fail();
        const page = event.result;
        if (!page || !['public-v1','public-v2'].includes(page.projection) || page.replay_gap || !Number.isSafeInteger(page.cursor) || !Number.isSafeInteger(page.latest_cursor) || page.cursor > page.latest_cursor || !Array.isArray(page.events)) return fail();
        if (page.cursor <= this.cursor) return 'duplicate';
        let cursor = this.cursor, changed = false, refresh = false;
        for (const item of page.events) {
            if (!Number.isSafeInteger(item.cursor) || item.cursor > page.cursor || item.session_id !== this.session) return fail();
            if (item.cursor <= cursor) continue;
            cursor = item.cursor;
            if (page.projection === 'public-v1') { refresh = true; continue; }
            if (!Number.isSafeInteger(item.revision) || !snapshot || item.revision < snapshot.revision) continue;
            const payload = item.payload;
            if (item.kind === 'message_created' && Number.isSafeInteger(payload?.message_index)) {
                // Creation has only an index; finalized supplies the public projection.
                continue;
            } else if (item.kind === 'message_finalized' && Number.isSafeInteger(payload?.message_index) && payload.message?.message_index === payload.message_index && Array.isArray(snapshot.messages)) {
                const messages = snapshot.messages;
                const index = messages.findIndex(message => message.message_index === payload.message_index);
                if (index >= 0) messages[index] = payload.message;
                else if (!messages.length || messages.at(-1).message_index + 1 === payload.message_index) messages.push(payload.message);
                else return fail();
                changed = true;
            } else if (item.kind === 'text_delta' && item.run_id === snapshot.run?.run_id && Number.isSafeInteger(payload?.offset) && typeof payload.text === 'string') {
                const run = snapshot.run, partial = run.partial_text;
                const encoder=new TextEncoder(),partialBytes=typeof partial==='string'?encoder.encode(partial).length:-1;
                const deltaBytes=encoder.encode(payload.text).length;
                if (partialBytes<0 || partialBytes>streamTextLimit || payload.offset<0 || run.partial_text_bytes!==payload.offset ||
                    !Number.isSafeInteger(payload.offset+deltaBytes) || encoder.encode(JSON.stringify(payload)).length>32768 ||
                    (run.partial_text_truncated ? partialBytes>=payload.offset : partialBytes!==payload.offset)) return fail();
                if(!run.partial_text_truncated){
                    const next=appendPrefix(partial,payload.text);
                    run.partial_text=next.text;run.partial_text_truncated=next.truncated;
                }
                run.partial_text_bytes+=deltaBytes;
                if (run.stream_reconciled && Number.isSafeInteger(run.live_text_offset) && payload.offset >= run.live_text_offset && typeof run.live_text === 'string' && !run.live_text_truncated) {
                    const next=appendPrefix(run.live_text,payload.text);
                    run.live_text=next.text;run.live_text_truncated=next.truncated;
                }
                changed = true;
            } else refresh = true;
        }
        if (cursor !== page.cursor) return fail();
        this.cursor = cursor;
        if (snapshot && changed) snapshot.observation_cursor = cursor;
        return refresh ? 'refresh' : changed ? 'append' : 'duplicate';
    }
}
