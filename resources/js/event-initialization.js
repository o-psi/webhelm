// Staged event-only initialization fencing. Not connected to the legacy stream.
export const EVENT_CONNECTION_VERSION = 3;
const MAX_ENTITY_BYTES = 32768;
const kinds = new Set(['session','run','message','decision','command_outcome','lifecycle','catalogue','goal','settings','account','usage','tool','reasoning','resource','artifact','browser','terminal','update','notification','workspace']);
const sameFence = (a,b) => a && b && ['generation','session_id','incarnation'].every(key => typeof a[key] === 'string' && a[key].length > 0 && a[key] === b[key]);
export class EventInitialization {
    constructor() { this.reset(); }
    reset() { this.fence = null; this.cursor = null; this.sequence = 0; this.bytes = 0; this.entities = new Map(); }
    accept(event) {
        if (event.kind === 'begin') {
            if (!sameFence(event.fence,event.fence) || !Number.isSafeInteger(event.cursor) || event.cursor < 0) throw new Error('Invalid initialization');
            this.reset(); this.fence = {...event.fence}; this.cursor = event.cursor; return null;
        }
        if (!sameFence(this.fence,event.fence)) throw new Error('Initialization fence mismatch');
        if (event.kind === 'reset') { this.reset(); return null; }
        if (!Number.isSafeInteger(event.sequence) || event.sequence !== this.sequence) throw new Error('Initialization sequence mismatch');
        if (event.kind === 'entity') {
            if (!kinds.has(event.entity_kind) || typeof event.entity_id !== 'string' || !event.entity_id.length || new TextEncoder().encode(event.entity_id).length > 256) throw new Error('Invalid entity identity');
            const value = JSON.stringify(event.value);
            if (value === undefined || new TextEncoder().encode(value).length > MAX_ENTITY_BYTES) throw new Error('Entity requires bounded chunks');
            const bytes = new TextEncoder().encode(value).length;
            if (this.bytes + bytes > 8 * 1024 * 1024) throw new Error('Initialization requires paged scopes');
            this.bytes += bytes;
            this.entities.set(`${event.entity_kind}:${event.entity_id}`,JSON.parse(value)); this.sequence++; return null;
        }
        if (event.kind !== 'complete' || event.cursor !== this.cursor) throw new Error('Initialization barrier mismatch');
        const result = {fence:{...this.fence},cursor:this.cursor,entities:new Map(this.entities)};
        this.reset(); return result;
    }
}

export function acceptContentChunk(chunk, fence, nextOffset) {
    if (!sameFence(chunk.fence,fence) || !Number.isSafeInteger(nextOffset) || nextOffset < 0 || chunk.offset !== nextOffset) throw new Error('Content identity or offset mismatch');
    if (typeof chunk.entity_id !== 'string' || !chunk.entity_id.length || new TextEncoder().encode(chunk.entity_id).length > 256 || typeof chunk.text !== 'string') throw new Error('Invalid content chunk');
    const bytes = new TextEncoder().encode(chunk.text).length;
    const end = nextOffset + bytes;
    if (bytes > MAX_ENTITY_BYTES || !Number.isSafeInteger(chunk.total_bytes) || !Number.isSafeInteger(end) || end > chunk.total_bytes || (bytes === 0 && end !== chunk.total_bytes)) throw new Error('Invalid content extent');
    return end;
}

// Presentation view assembled from typed entities, never accepted as a wire snapshot.
export function entityPresentation(scope) {
    const session = scope.entities.get('session:session');
    if (!session || session.session_id !== scope.fence.session_id || !Number.isSafeInteger(session.revision)) throw new Error('Missing canonical session entity');
    const messages = [...scope.entities.entries()].filter(([key])=>key.startsWith('message:')).map(([,value])=>value).sort((a,b)=>a.message_index-b.message_index);
    return {...session,...(scope.entities.get('settings:settings')||{}),messages,turns:scope.entities.get('run:turns')||[],recovery_notice:scope.entities.get('resource:recovery_notice')??null,goal:scope.entities.get('goal:goal'),lifecycle:scope.entities.get('lifecycle:lifecycle'),run:scope.entities.get('run:run')??null,retained_cleanup:scope.entities.get('resource:retained_cleanup'),cleanup:scope.entities.get('resource:cleanup'),session_resources:scope.entities.get('resource:session_resources'),execution_usage:scope.entities.get('usage:usage'),observation_cursor:scope.cursor};
}
