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
