import {connectionDiagnostic as log} from './connection-diagnostics.js';
import {request, IntentJournal, VesselSocket} from './vessel-client.js';

// Every configured connection owns its own socket, catalogue, lease and journal.
export class VesselFleet {
    constructor(vessels, {tenantId, ticket, changed}) {
        Object.assign(this, {tenantId, ticket, changed});
        this.connections = new Map(vessels.map(vessel => [vessel.id, {
            ...vessel, client: null, journal: null, voyages: [], status: 'Connecting…',
            generation: 0, retry: 1000, lastCatalogue: 0, polling: false, stopped: false,
        }]));
        this.closed = false;
    }
    start() { for (const connection of this.connections.values()) this.connect(connection); }
    async connect(connection, renewing = false) {
        if (this.closed || connection.connecting) return;
        connection.connecting = true;
        const generation = connection.generation;
        const previous = connection.client;
        const current = () => !this.closed && generation === connection.generation;
        clearTimeout(connection.reconnect); clearTimeout(connection.renewal);
        if (!previous) { connection.status = 'Connecting…'; this.changed(); }
        let socket;
        try {
            const auth = await this.ticket(connection.id);
            if (!current()) return;
            const url = new URL(auth.url);
            if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash
                || url.pathname !== '/v1/vessel/browser-socket' || (url.port && url.port !== '443')
                || auth.vessel_id !== connection.vessel_id || typeof auth.token !== 'string'
                || !/^[a-f0-9]{64}$/i.test(auth.token) || !Number.isSafeInteger(auth.expires_at_ms)
                || auth.expires_at_ms <= Date.now() + 10000 || auth.expires_at_ms > Date.now() + 125000) {
                throw Object.assign(new Error('Invalid Vessel authorization'), {permanent:true});
            }
            socket = new WebSocket(url, 'voyage.vessel.v1');
            connection.opening = socket;
            await new Promise((resolve, reject) => {
                const finish = error => {
                    clearTimeout(timer); socket.removeEventListener('message', receive);
                    socket.removeEventListener('close', closed);
                    error ? reject(error) : resolve();
                };
                const closed = () => finish(new Error('Vessel unavailable'));
                const receive = event => {
                    try {
                        const frame = JSON.parse(event.data);
                        if (socket.protocol !== 'voyage.vessel.v1' || frame.type !== 'hello' || frame.protocol !== 1
                            || frame.vessel_id !== connection.vessel_id || typeof frame.socket_id !== 'string') throw Error();
                        finish();
                    } catch { finish(new Error('Vessel authentication failed')); socket.close(); }
                };
                const timer = setTimeout(() => { finish(new Error('Connection timed out')); socket.close(); }, 10000);
                socket.addEventListener('open', () => socket.send(JSON.stringify({type:'authenticate', token:auth.token})), {once:true});
                socket.addEventListener('message', receive);
                socket.addEventListener('close', closed, {once:true});
                socket.addEventListener('error', () => socket.close());
            });
            if (!current()) { socket.close(); return; }
            try {
                connection.journal ||= new IntentJournal(localStorage, `${this.tenantId}:${connection.id}:${auth.vessel_id}`);
                connection.journal.entries();
            } catch { throw Object.assign(new Error('Command journal unavailable'), {permanent:true}); }
            const client = new VesselSocket(socket, reason => {
                if (!current() || connection.client !== client) return;
                connection.catalogueObserver?.abort();
                connection.client = null; connection.status = `Offline · ${reason}`;
                clearTimeout(connection.renewal); this.changed(); this.schedule(connection);
            });
            connection.catalogueObserver?.abort();
            connection.socket = socket; connection.client = client; connection.opening = null;
            // New reads/commands use the replacement. Already dispatched commands
            // keep receiving replies on the old socket; nothing is replayed.
            if (previous) {
                connection.draining ||= new Set(); connection.draining.add(previous);
                previous.drain().finally(() => connection.draining.delete(previous));
            }
            connection.retry = 1000; connection.lastCatalogue = 0; connection.polling = false;
            connection.status = 'Connected';
            connection.renewal = setTimeout(() => this.connect(connection, true), Math.max(1000, auth.expires_at_ms - Date.now() - 30000));
            log(renewing ? 'renewal_ack' : 'connected',{connection:connection.id,generation});
            this.changed(); this.observeCatalogue(connection);
        } catch (error) {
            socket?.close();
            if (!current()) return;
            connection.stopped ||= Boolean(error.permanent);
            if (connection.stopped) { connection.client?.close(); connection.client = null; }
            connection.status = error.message; this.changed(); this.schedule(connection);
        } finally {
            connection.connecting = false;
            if (connection.opening === socket) connection.opening = null;
        }
    }
    schedule(connection) {
        if (this.closed || connection.stopped) return;
        clearTimeout(connection.reconnect);
        log('reconnect_scheduled',{connection:connection.id,delay_ms:connection.retry});
        connection.reconnect = setTimeout(() => this.connect(connection), connection.retry);
        connection.retry = Math.min(connection.retry * 2, 15000);
    }
    async observeCatalogue(connection) {
        const client = connection.client, generation = connection.generation;
        const controller = new AbortController();
        connection.catalogueObserver = controller;
        const current = () => !this.closed && !controller.signal.aborted
            && client === connection.client && generation === connection.generation;
        const read = async command => {
            const response = await client.exchange(command);
            if (response.protocol !== 1 || response.error != null || response.outcome_unknown !== false) throw Error('Voyage list unavailable');
            return response.result;
        };
        const hydrate = async () => {
            const entries = await read(request('catalogue'));
            if (!Array.isArray(entries) || entries.length > 4096) throw Error('Invalid voyage list');
            if (current()) { connection.voyages = entries; connection.status = 'Connected'; this.changed(); }
        };
        const page = async (after, wait_ms) => {
            const value = await read(request('catalogue_changes', {after, limit:128, wait_ms}));
            if (!value || !Number.isSafeInteger(value.cursor) || value.cursor < 0
                || !Number.isSafeInteger(value.latest_cursor) || value.latest_cursor < value.cursor
                || typeof value.replay_gap !== 'boolean' || value.has_more !== (value.cursor < value.latest_cursor)
                || (after === null && !value.replay_gap)
                || (!value.replay_gap && after !== null && value.cursor < after)
                || !Array.isArray(value.entries) || value.entries.length > 128
                || (value.replay_gap && (value.entries.length || value.has_more))
                || (!value.replay_gap && value.cursor === after && (value.entries.length || value.has_more))
                || value.entries.some(entry => !entry || typeof entry.session_id !== 'string' || typeof entry.incarnation !== 'string')
                || new Set(value.entries.map(entry => entry.session_id)).size !== value.entries.length) throw Error('Invalid catalogue change page');
            return value;
        };
        while (current()) {
            try {
                const caps = await read(request('capabilities'));
                if (!current()) return;
                if (!caps?.features?.includes('catalogue_changes')) {
                    connection.catalogueObserver = null;
                    await this.catalogue(connection);
                    return;
                }
                // Checkpoint before hydration: a change racing the full read
                // remains in the next page. Pages are current projections.
                let cursor = (await page(null, 0)).cursor;
                if (!current()) return;
                await hydrate();
                while (current()) {
                    const next = await page(cursor, 8000);
                    if (!current()) return;
                    const previousCursor = cursor;
                    cursor = next.cursor;
                    if (next.replay_gap) { await hydrate(); continue; }
                    if (next.entries.length) {
                        const entries = new Map(connection.voyages.map(entry => [entry.session_id, entry]));
                        for (const entry of next.entries) entries.set(entry.session_id, entry);
                        if (entries.size > 4096) throw Error('Voyage list exceeds limit');
                        connection.voyages = [...entries.values()].sort((a,b) => a.session_id.localeCompare(b.session_id));
                        connection.status = 'Connected'; this.changed();
                    }
                    // Bound request rate even if a peer ignores long-poll waits.
                    if (cursor === previousCursor) await catalogueDelay(controller.signal, 200);
                }
            } catch {
                if (!current()) return;
                connection.status = 'Voyage list unavailable'; this.changed();
                await catalogueDelay(controller.signal, 2000);
            }
        }
    }
    async catalogue(connection) {
        if (!connection.client || connection.polling || Date.now() - connection.lastCatalogue < 10000) return;
        const client = connection.client, generation = connection.generation;
        connection.polling = true;
        try {
            const response = await client.exchange(request('catalogue'));
            if (response.protocol !== 1 || response.error != null || response.outcome_unknown !== false || !Array.isArray(response.result)) throw new Error('Voyage list unavailable');
            if (generation !== connection.generation || client !== connection.client || this.closed) return;
            connection.voyages = response.result;
            connection.status = 'Connected';
        } catch {
            if (generation !== connection.generation || client !== connection.client || this.closed) return;
            connection.status = 'Voyage list unavailable';
        } finally {
            if (generation === connection.generation && client === connection.client && !this.closed) {
                connection.polling = false; connection.lastCatalogue = Date.now(); this.changed();
            }
        }
    }
    poll() { for (const connection of this.connections.values()) if (!connection.catalogueObserver) this.catalogue(connection); }
    reconnect() {
        for (const connection of this.connections.values()) { connection.stopped = false; this.connect(connection); }
    }
    close() {
        this.closed = true;
        for (const connection of this.connections.values()) {
            connection.catalogueObserver?.abort();
            connection.generation++; clearTimeout(connection.reconnect); clearTimeout(connection.renewal); connection.opening?.close(); connection.socket?.close();
            for (const client of connection.draining || []) client.close();
        }
    }
}

function catalogueDelay(signal, milliseconds) {
    return new Promise(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, milliseconds);
        signal.addEventListener('abort', finish, {once:true});
        if (signal.aborted) finish();
    });
}
