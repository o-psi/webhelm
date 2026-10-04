import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCommandIdentity} from '../resources/js/event-command.js';
const command = {version:3,correlation_id:'f1111111-1111-4111-8111-111111111111',command_id:'f2222222-2222-4222-8222-222222222222',session_id:'session',incarnation:'owner',expected_revision:9,expires_at_ms:100,operation:{operation:'cancel',run_id:'run'}};
test('command identity refuses stale peers and preserves exact durable command', () => {
    assert.equal(validateCommandIdentity(command,'session','owner',99),command);
    for (const mutation of [{version:1},{incarnation:'other'},{expires_at_ms:99},{command_id:'00000000-0000-0000-0000-000000000000'},{correlation_id:'invalid'}]) {
        assert.throws(() => validateCommandIdentity({...command,...mutation},'session','owner',99));
    }
    assert.equal(command.command_id,'f2222222-2222-4222-8222-222222222222');
});
