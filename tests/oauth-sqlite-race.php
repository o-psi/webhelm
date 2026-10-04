<?php

// Scoped offline fixture: php tests/oauth-sqlite-race.php
// Two real OS processes, real OAuthAccounts, disposable file-backed SQLite.
// No Socialite redirect/callback, provider HTTP, production DB or application edits.
use App\Models\OAuthIdentity;
use App\Models\Tenant;
use App\Models\User;
use App\Models\VesselConnection;
use App\Services\OAuthAccounts;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;

function expectRace(bool $condition, string $message): void
{
    if (! $condition) {
        throw new RuntimeException($message);
    }
}

function bootRace(string $directory): void
{
    foreach ([
        'APP_ENV' => 'testing', 'APP_KEY' => 'base64:'.base64_encode(str_repeat('r', 32)),
        'DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => $directory.'/database.sqlite',
        'SESSION_DRIVER' => 'array', 'CACHE_STORE' => 'array',
        'APP_CONFIG_CACHE' => $directory.'/absent-config.php',
        'LARAVEL_STORAGE_PATH' => $directory.'/storage',
        'VIEW_COMPILED_PATH' => $directory.'/storage/views',
    ] as $key => $value) {
        putenv($key.'='.$value);
        $_ENV[$key] = $_SERVER[$key] = $value;
    }
    require __DIR__.'/../vendor/autoload.php';
    $app = require __DIR__.'/../bootstrap/app.php';
    $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    expectRace(config('view.compiled') === $directory.'/storage/views', 'compiled views must be isolated');
    expectRace(DB::connection()->getDriverName() === 'sqlite', 'fixture driver must be SQLite');
    expectRace(DB::connection()->getDatabaseName() === $directory.'/database.sqlite', 'fixture database must be isolated');
    DB::statement('PRAGMA busy_timeout = 1000');
}

function waitRace(callable $ready, float $deadline): void
{
    while (! $ready()) {
        expectRace(microtime(true) < $deadline, 'bounded race barrier timed out');
        usleep(10000);
    }
}

// Child exception reporting must not be converted to Laravel's zero exit status.
if (($argv[1] ?? '') === '--worker') {
    try {
        [$script, $mode, $directory, $round, $worker, $subject] = $argv;
        bootRace($directory);
        $observed = false;
        DB::listen(function ($query) use (&$observed, $directory, $round, $worker): void {
            // Pause AFTER the real initial identity lookup returned empty. Both
            // workers must observe absence before either enters the transaction.
            if (! $observed && str_starts_with(strtolower($query->sql), 'select')
                && str_contains($query->sql, 'oauth_identities')) {
                $observed = true;
                expectRace(file_put_contents($directory.'/ready-'.$round.'-'.$worker, 'ready') !== false, 'write ready marker');
                waitRace(fn () => is_file($directory.'/release-'.$round), microtime(true) + 8);
            }
        });
        $profile = (new Laravel\Socialite\Two\User)->map([
            'id' => $subject, 'name' => 'Synthetic race identity', 'email' => 'shared@example.test',
        ]);
        $user = app(OAuthAccounts::class)->resolve('google', $profile);
        expectRace($observed, 'worker must pass initial lookup barrier');
        echo json_encode(['user' => $user->id, 'tenant' => $user->tenant_id], JSON_THROW_ON_ERROR);
        exit(0);
    } catch (Throwable $error) {
        fwrite(STDERR, get_class($error).': '.$error->getMessage()."\n");
        exit(1);
    }
}

$directory = sys_get_temp_dir().'/webhelm-oauth-race-'.bin2hex(random_bytes(8));
$children = [];
$failure = null;
try {
    expectRace(mkdir($directory, 0700), 'create disposable directory');
    expectRace(mkdir($directory.'/storage', 0700), 'create isolated storage');
    expectRace(mkdir($directory.'/storage/views', 0700), 'create isolated compiled views');
    expectRace(touch($directory.'/database.sqlite'), 'create disposable SQLite file');
    bootRace($directory);
    foreach (glob(__DIR__.'/../database/migrations/*.php') as $migration) {
        (require $migration)->up();
    }
    expectRace(User::count() === 0 && Tenant::count() === 0 && OAuthIdentity::count() === 0, 'fresh identity tables');

    foreach ([['same-subject', 'same-subject'], ['different-a', 'different-b']] as $round => $subjects) {
        $pair = [];
        foreach ($subjects as $worker => $subject) {
            $process = new Process([PHP_BINARY, __FILE__, '--worker', $directory, (string) $round, (string) $worker, $subject]);
            $process->setTimeout(12);
            $children[] = $process;
            $pair[] = $process;
            $process->start();
        }
        waitRace(function () use ($pair, $directory, $round): bool {
            foreach ($pair as $worker => $process) {
                $process->checkTimeout();
                expectRace($process->isRunning(), 'worker exited before barrier: '.$process->getErrorOutput());
                if (! is_file($directory.'/ready-'.$round.'-'.$worker)) {
                    return false;
                }
            }
            return true;
        }, microtime(true) + 10);
        expectRace(file_put_contents($directory.'/release-'.$round, 'release') !== false, 'release concurrent lookups');
        $results = [];
        foreach ($pair as $process) {
            $process->wait();
            expectRace($process->getExitCode() === 0, 'worker failed: '.$process->getErrorOutput().$process->getOutput());
            $results[] = json_decode($process->getOutput(), true, 8, JSON_THROW_ON_ERROR);
        }
        if ($round === 0) {
            expectRace($results[0] === $results[1], 'same subject returns exactly the same user and tenant');
            expectRace(OAuthIdentity::count() === 1 && User::count() === 1 && Tenant::count() === 1, 'same-subject race leaves exactly one identity/user/tenant');
        } else {
            expectRace($results[0]['user'] !== $results[1]['user'] && $results[0]['tenant'] !== $results[1]['tenant'], 'different subjects with same email never auto-link');
            expectRace(OAuthIdentity::count() === 3 && User::count() === 3 && Tenant::count() === 3, 'different-subject race has no orphan or merged allocation');
        }
        foreach (Tenant::all() as $tenant) {
            expectRace(User::where('tenant_id', $tenant->id)->count() === 1, 'each tenant has one owner');
            expectRace(VesselConnection::where('tenant_id', $tenant->id)->count() === 0, 'each new tenant has no connections');
            expectRace(DB::table('vessel_pairings')->where('tenant_id', $tenant->id)->count() === 0, 'each new tenant has no pairings');
        }
    }
} catch (Throwable $error) {
    $failure = $error;
} finally {
    foreach ($children as $process) {
        if ($process->isRunning()) {
            $process->stop(0.2);
        }
        if ($process->isRunning()) {
            $failure = new RuntimeException('child cleanup not observed');
        }
    }
    if (class_exists(DB::class)) {
        DB::disconnect('sqlite');
    }
    if (is_dir($directory)) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($files as $file) {
            $removed = $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
            if (! $removed) {
                $failure = new RuntimeException('temporary file cleanup failed');
            }
        }
        if (! rmdir($directory) || file_exists($directory)) {
            $failure = new RuntimeException('temporary directory cleanup not observed');
        }
    }
}
if ($failure !== null) {
    fwrite(STDERR, get_class($failure).': '.$failure->getMessage()."\n");
    exit(1);
}
echo "SQLite OAuth identity races passed; four children exited and disposable database/storage cleanup observed.\n";
