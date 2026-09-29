import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';

const cwd = resolve(import.meta.dirname, '..');
const boot = `require 'vendor/autoload.php'; $app = require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap();`;

test('concurrent SQLite ticket counters serialize read then write transactions', {timeout: 30000}, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'helm-cache-test-'));
    const database = join(dir, 'database.sqlite');
    writeFileSync(database, '');
    const storage = join(dir, 'storage');
    for (const path of ['framework/cache/data', 'framework/sessions', 'framework/views', 'logs']) {
        mkdirSync(join(storage, path), {recursive: true});
    }
    const env = {...process.env, APP_ENV: 'testing', APP_KEY: `base64:${randomBytes(32).toString('base64')}`,
        DB_CONNECTION: 'sqlite', DB_DATABASE: database, CACHE_STORE: 'database',
        LARAVEL_STORAGE_PATH: storage};
    const children = [];
    try {
        const migrate = spawnSync('php', ['artisan', 'migrate', '--force'], {cwd, env, encoding: 'utf8'});
        assert.equal(migrate.status, 0, migrate.stderr + migrate.stdout);
        const setup = spawnSync('php', ['-r', `${boot}
            $store = Illuminate\\Support\\Facades\\Cache::store('database')->getStore();
            if ($store->getConnection()->getName() !== 'sqlite_cache') throw new RuntimeException('Database cache uses the wrong connection');
            $connection = $store->getConnection();
            $connection->statement('create table counters (id integer primary key, value integer not null)');
            $connection->insert('insert into counters (id, value) values (1, 0)');
        `], {cwd, env, encoding: 'utf8'});
        assert.equal(setup.status, 0, setup.stderr + setup.stdout);

        const worker = `${boot}
            $connection = Illuminate\\Support\\Facades\\Cache::store('database')->getStore()->getConnection();
            fwrite(STDOUT, "ready\\n"); fflush(STDOUT); fgets(STDIN);
            $connection->transaction(function () use ($connection) {
                $value = $connection->table('counters')->where('id', 1)->value('value');
                usleep(150000);
                $connection->table('counters')->where('id', 1)->update(['value' => $value + 1]);
            });
            for ($i = 0; $i < 10; $i++) Illuminate\\Support\\Facades\\RateLimiter::hit('fleet:fixture', 60);
        `;
        const ready = [];
        const finished = [];
        for (let i = 0; i < 6; i++) {
            const child = spawn('php', ['-r', worker], {cwd, env, stdio: ['pipe', 'pipe', 'pipe']});
            children.push(child);
            let stdout = '', stderr = '';
            ready.push(new Promise((resolveReady, rejectReady) => {
                child.stdout.on('data', chunk => {
                    stdout += chunk;
                    if (stdout.includes('ready\n')) resolveReady();
                });
                child.once('error', rejectReady);
                child.once('exit', code => { if (!stdout.includes('ready\n')) rejectReady(new Error(`worker exited before barrier: ${code} ${stderr}`)); });
            }));
            child.stderr.on('data', chunk => { stderr += chunk; });
            finished.push(new Promise((resolveFinished, rejectFinished) => {
                child.once('error', rejectFinished);
                child.once('exit', code => code === 0 ? resolveFinished() : rejectFinished(new Error(`worker ${i}: ${code} ${stderr}`)));
            }));
        }
        await Promise.all(ready);
        for (const child of children) child.stdin.end('\n');
        await Promise.all(finished);
        const verify = spawnSync('php', ['-r', `${boot}
            $connection = Illuminate\\Support\\Facades\\Cache::store('database')->getStore()->getConnection();
            echo $connection->table('counters')->where('id', 1)->value('value'), ':', Illuminate\\Support\\Facades\\RateLimiter::attempts('fleet:fixture');
        `], {cwd, env, encoding: 'utf8'});
        assert.equal(verify.status, 0, verify.stderr + verify.stdout);
        assert.equal(verify.stdout, '6:60');
    } finally {
        for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
        rmSync(dir, {recursive: true, force: true});
    }
});
