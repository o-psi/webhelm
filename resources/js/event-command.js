import {EVENT_CONNECTION_VERSION} from './event-initialization.js';
// Staged event-only command admission. No fallback or command replay is allowed.
export function validateCommandIdentity(command, session, incarnation, now) {
    if (command.version !== EVENT_CONNECTION_VERSION) throw new Error('Incompatible event connection: upgrade both peers');
    if (command.session_id !== session || command.incarnation !== incarnation) throw new Error('Stale canonical owner identity');
    if (!Number.isSafeInteger(command.expires_at_ms) || command.expires_at_ms <= now) throw new Error('Command expired; observe retained outcome before replacement');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const key of ['command_id','correlation_id']) {
        if (typeof command[key] !== 'string' || !uuid.test(command[key]) || command[key] === '00000000-0000-0000-0000-000000000000') throw new Error('Missing command identity');
    }
    return command;
}
