import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';

test('offline plan and signed Stripe receipt lifecycle', () => {
    const result = spawnSync('php', ['tests/billing.php'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PASS \d+ billing checks/);
});
