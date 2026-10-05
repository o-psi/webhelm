<?php

use App\Attention\AttentionPolicy;
use App\Models\Tenant;
use App\Services\AttentionPolicyStore;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;

// Offline isolated SQLite checks. Run with the repository's installed vendor tree.
try {
$ownedRoot = sys_get_temp_dir().'/attention-policy-'.bin2hex(random_bytes(12));
mkdir($ownedRoot, 0700);
foreach (['storage/framework/sessions', 'storage/framework/cache/data', 'storage/views', 'storage/logs'] as $directory) {
    mkdir($ownedRoot.'/'.$directory, 0700, true);
}
touch($ownedRoot.'/database.sqlite');
$originalEnvironment = [];
foreach ([
    'APP_ENV' => 'local', 'APP_KEY' => 'base64:'.base64_encode(str_repeat('p', 32)),
    'DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => $ownedRoot.'/database.sqlite',
    'SESSION_DRIVER' => 'database', 'CACHE_STORE' => 'array', 'LOG_CHANNEL' => 'single',
    'APP_CONFIG_CACHE' => $ownedRoot.'/absent-config.php',
    'APP_ROUTES_CACHE' => $ownedRoot.'/absent-routes.php',
    'APP_EVENTS_CACHE' => $ownedRoot.'/absent-events.php',
    'APP_SERVICES_CACHE' => $ownedRoot.'/absent-services.php',
    'APP_PACKAGES_CACHE' => $ownedRoot.'/absent-packages.php',
    'LARAVEL_STORAGE_PATH' => $ownedRoot.'/storage', 'VIEW_COMPILED_PATH' => $ownedRoot.'/storage/views',
] as $key => $value) {
    $originalEnvironment[$key] = [getenv($key), $_ENV[$key] ?? null, $_SERVER[$key] ?? null];
    putenv($key.'='.$value);
    $_ENV[$key] = $_SERVER[$key] = $value;
}
$parentPid = getmypid();
register_shutdown_function(function () use ($ownedRoot, $originalEnvironment, $parentPid): void {
    if (getmypid() !== $parentPid) { return; }
    foreach ($originalEnvironment as $key => [$environment, $env, $server]) {
        putenv($environment === false ? $key : $key.'='.$environment);
        if ($env === null) { unset($_ENV[$key]); } else { $_ENV[$key] = $env; }
        if ($server === null) { unset($_SERVER[$key]); } else { $_SERVER[$key] = $server; }
    }
    if (is_dir($ownedRoot)) {
        $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($ownedRoot, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($files as $file) {
            if ($file->isDir() && !$file->isLink()) { rmdir($file->getPathname()); } else { unlink($file->getPathname()); }
        }
        rmdir($ownedRoot);
    }
});
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (Illuminate\Support\Facades\DB::connection()->getDriverName() !== 'sqlite'
    || Illuminate\Support\Facades\DB::connection()->getDatabaseName() !== $ownedRoot.'/database.sqlite'
    || config('view.compiled') !== $ownedRoot.'/storage/views'
    || $app->storagePath() !== $ownedRoot.'/storage') {
    throw new RuntimeException('Fixture isolation failed before schema writes');
}
foreach (glob(__DIR__.'/../database/migrations/*.php') as $file) {
    (require $file)->up();
}


$checks = 0;
function policyCheck(bool $value, string $name): void
{
    global $checks;
    if (!$value) {
        throw new RuntimeException($name);
    }
    $checks++;
}
$tenant = Tenant::create(['principal_id' => (string) Str::uuid(), 'name' => 'Policy test']);
$other = Tenant::create(['principal_id' => (string) Str::uuid(), 'name' => 'Other']);
$a = new AttentionPolicyStore();
$b = new AttentionPolicyStore();
policyCheck($a->read($tenant->id)['stale_policy'] === 'three_days', 'initial policy is three days');
policyCheck($a->read($tenant->id)['eligibility']['effect'] === 'unavailable', 'default has no auto effect');
$id = (string) Str::uuid();
$payload = ['expected_revision' => 0, 'stale_policy' => 'seven_days'];
$first = $a->change($tenant->id, $id, $payload);
policyCheck($first['status'] === 200 && $first['body']['revision'] === 1, 'first client CAS');
policyCheck($b->change($tenant->id, $id, array_reverse($payload, true)) === $first, 'canonical duplicate exact receipt');
policyCheck($b->change($tenant->id, $id, ['expected_revision' => 0, 'stale_policy' => 'off'])['status'] === 409, 'same ID different hash');
$loser = (string) Str::uuid();
$conflict = $b->change($tenant->id, $loser, ['expected_revision' => 0, 'stale_policy' => 'off']);
policyCheck($conflict['status'] === 409, 'second client stale CAS fails');
policyCheck($a->receipt($tenant->id, $loser) === $conflict, 'cold conflict receipt');
policyCheck($a->receipt($other->id, $id) === null, 'receipt tenant isolation');
policyCheck($a->read($other->id)['revision'] === 0, 'policy tenant isolation');
$invalid = (string) Str::uuid();
$failure = $a->change($tenant->id, $invalid, ['expected_revision' => 1, 'stale_policy' => 'forever']);
policyCheck($failure['status'] === 422 && $b->receipt($tenant->id, $invalid) === $failure, 'invalid policy durable failure receipt');
$off = $a->change($tenant->id, (string) Str::uuid(), ['expected_revision' => 1, 'stale_policy' => 'off']);
policyCheck($off['body']['eligibility']['effect'] === 'disabled', 'off separate from unavailable');
policyCheck($b->receipt($tenant->id, $id) === $first, 'timeout cold success lookup remains exact after changes');
policyCheck($b->change($tenant->id, $loser, ['expected_revision' => 0, 'stale_policy' => 'off']) === $conflict, 'failure replay stays exact after changes');
policyCheck(DB::table('attention_policy_receipts')->count() === 4, 'duplicates do not grow storage');
policyCheck(AttentionPolicy::eligibility('seven_days')['automatic_settlement'] === false, 'no automatic settlement');

// Seed quota without 10000 mutations; preserve exact existing receipts.
$seed = [];
for ($index = 0; $index < AttentionPolicy::MAX_RECEIPTS - 4; $index++) {
    $seed[] = ['tenant_id' => $tenant->id, 'operation_id' => (string) Str::uuid(),
        'request_hash' => str_repeat('0', 64), 'status' => 422, 'response' => '{}', 'recorded_at' => now()];
    if (count($seed) === 100) { DB::table('attention_policy_receipts')->insert($seed); $seed = []; }
}
if ($seed) { DB::table('attention_policy_receipts')->insert($seed); }
policyCheck($a->change($tenant->id, (string) Str::uuid(), ['expected_revision' => 2, 'stale_policy' => 'off'])['status'] === 507, 'capacity refuses new admission');
policyCheck($a->change($tenant->id, $id, $payload) === $first && $a->receipt($tenant->id, $id) === $first, 'capacity preserves duplicates and cold lookup');

// Exercise controller boundary without a provider or HTTP server.
$controller = new App\Http\Controllers\AttentionPolicyController();
$request = Illuminate\Http\Request::create('/console/attention-policy', 'GET');
$request->setUserResolver(fn () => (object) ['tenant_id' => $tenant->id]);
$response = $controller->show($request, $a);
policyCheck(str_contains($response->headers->get('Cache-Control'), 'no-store'), 'private no-store response');
$missing = $controller->receipt($request, $a, (string) Str::uuid());
policyCheck($missing->getStatusCode() === 404 && json_decode($missing->getContent(), true)['retry_with_new_identity'] === false, 'missing receipt unknown no new ID retry');
$envelope = Illuminate\Http\Request::create('/console/attention-policy', 'PATCH', [], [], [], ['CONTENT_TYPE' => 'application/json'], json_encode(['operation_id' => (string) Str::uuid(), 'tenant_id' => $other->id]));
$envelope->setUserResolver(fn () => (object) ['tenant_id' => $tenant->id]);
policyCheck($controller->update($envelope, $a)->getStatusCode() === 422, 'client tenant selector refused');
$large = Illuminate\Http\Request::create('/console/attention-policy', 'PATCH', [], [], [], [], str_repeat('x', 4097));
$large->setUserResolver(fn () => (object) ['tenant_id' => $tenant->id]);
policyCheck($controller->update($large, $a)->getStatusCode() === 413, 'bounded body');
$revoked = Illuminate\Http\Request::create('/console/attention-policy', 'GET');
try {
    $controller->show($revoked, $a);
    throw new RuntimeException('unauthenticated access accepted');
} catch (Symfony\Component\HttpKernel\Exception\HttpException $error) {
    policyCheck($error->getStatusCode() === 403, 'controller refuses absent tenant');
}


// Real routed requests through web/session/auth/CSRF middleware. No OAuth.
config(['helm.enabled' => true, 'session.driver' => 'database', 'session.encrypt' => false]);
$app->instance('env', 'local'); // Do not allow testing-mode CSRF bypass.
$http = $app->make(Illuminate\Contracts\Http\Kernel::class);
$user = App\Models\User::create(['name' => 'HTTP policy', 'tenant_id' => $other->id]);
$session = app('session')->driver();
$session->flush();
$session->regenerate();
Illuminate\Support\Facades\Auth::login($user);
$session->put('helm_operator_until', time() + 600);
$session->regenerateToken();
$session->save();
$sessionId = $session->getId();
$csrf = $session->token();
policyCheck(in_array(config('session.serialization'), ['json', 'php'], true), 'known selected session serialization');
policyCheck(DB::table('sessions')->where('id', $sessionId)->exists(), 'actual session driver saved');
policyCheck(!$app->runningUnitTests(), 'real CSRF not unit-test bypassed');
$cookieName = config('session.cookie');
$cookie = app('encrypter')->encrypt(Illuminate\Cookie\CookieValuePrefix::create($cookieName, app('encrypter')->getKey()).$sessionId, false);
$routed = function (string $method, string $path, ?array $body = null, bool $signedIn = true, ?string $token = null) use ($http, $cookieName, $cookie): Symfony\Component\HttpFoundation\Response {
    auth()->forgetGuards();
    app('session')->forgetDrivers();
    $request = Illuminate\Http\Request::create($path, $method, [], $signedIn ? [$cookieName => $cookie] : [], [],
        ['HTTP_ACCEPT' => 'application/json', 'CONTENT_TYPE' => 'application/json', 'HTTP_X_CSRF_TOKEN' => $token ?? ''],
        $body === null ? null : json_encode($body, JSON_THROW_ON_ERROR));
    $response = $http->handle($request);
    $http->terminate($request, $response);
    return $response;
};
$httpRead = $routed('GET', '/console/attention-policy');
fwrite(STDERR, 'attention-policy routed_get status='.$httpRead->getStatusCode()."\n");
policyCheck($httpRead->getStatusCode() === 200 && str_contains($httpRead->headers->get('Cache-Control'), 'no-store'), 'routed session GET private status='.$httpRead->getStatusCode());
policyCheck($routed('GET', '/console/attention-policy', null, false)->getStatusCode() === 401, 'routed anonymous refused');
$httpOperation = (string) Str::uuid();
$httpPayload = ['operation_id' => $httpOperation, 'expected_revision' => 0, 'stale_policy' => 'seven_days'];
policyCheck($routed('PATCH', '/console/attention-policy', $httpPayload)->getStatusCode() === 419, 'routed CSRF missing rejected');
$httpWrite = $routed('PATCH', '/console/attention-policy', $httpPayload, true, $csrf);
policyCheck($httpWrite->getStatusCode() === 200, 'routed CSRF valid PATCH');
policyCheck($routed('GET', '/console/attention-policy/receipts/'.$id)->getStatusCode() === 404, 'routed foreign receipt inaccessible');
policyCheck($routed('GET', '/console/attention-policy/receipts/'.$httpOperation)->getStatusCode() === 200, 'routed cold receipt');
foreach ([['operation_id' => (string) Str::uuid()],
    ['operation_id' => (string) Str::uuid(), 'expected_revision' => 1, 'stale_policy' => ['nested']],
    ['operation_id' => (string) Str::uuid(), 'expected_revision' => -1, 'stale_policy' => 'off']] as $invalidInput) {
    policyCheck($routed('PATCH', '/console/attention-policy', $invalidInput, true, $csrf)->getStatusCode() === 422, 'routed missing/nested/invalid validation');
}
policyCheck($routed('POST', '/console/logout', [], true, $csrf)->getStatusCode() === 302, 'routed logout');
policyCheck($routed('GET', '/console/attention-policy')->getStatusCode() === 401, 'old session denied after logout');


// Actual two-process race against a disposable file-backed SQLite copy. No fallback
// to pretending sequential calls are a race when pcntl is unavailable.
if (!function_exists('pcntl_fork')) {
    throw new RuntimeException('Concurrent SQLite qualification requires pcntl; race not run.');
}
$database = tempnam($ownedRoot, 'race-');
unlink($database);
DB::statement("VACUUM INTO '".str_replace("'", "''", $database)."'");
$results = [];
$children = [];
$raceId = (string) Str::uuid();
try {
    foreach (['duplicate', 'cas'] as $phase) {
    $results = [];
    $children = [];
    foreach ([0, 1] as $index) {
        $resultPath = $database.'.result'.$phase.$index;
        $results[] = $resultPath;
        $pid = pcntl_fork();
        if ($pid === -1) {
            throw new RuntimeException('Cannot fork SQLite race client');
        }
        if ($pid === 0) {
            // Child must not run the parent owned-root shutdown cleanup.
            try {
                config(['database.connections.sqlite.database' => $database]);
                DB::purge('sqlite');
                DB::statement('PRAGMA busy_timeout = 5000');
                file_put_contents($database.'.ready'.$phase.$index, 'ready');
                $deadline = microtime(true) + 5;
                while (!file_exists($database.'.start'.$phase)) {
                    if (microtime(true) > $deadline) { throw new RuntimeException('Race start barrier timeout'); }
                    usleep(1000);
                }
                // Same exact operation races: both must return identical durable receipt.
                $result = (new AttentionPolicyStore())->change($other->id, $phase === 'duplicate' ? $raceId : (string) Str::uuid(),
                    ['expected_revision' => $phase === 'duplicate' ? 1 : 2, 'stale_policy' => 'seven_days']);
                file_put_contents($resultPath, json_encode($result, JSON_THROW_ON_ERROR));
                exit(0);
            } catch (Throwable $error) {
                file_put_contents($resultPath, 'race_fixture_error');
                exit(1);
            }
        }
        $children[] = $pid;
    }
    $deadline = microtime(true) + 5;
    while (!file_exists($database.'.ready'.$phase.'0') || !file_exists($database.'.ready'.$phase.'1')) {
        if (microtime(true) > $deadline) { throw new RuntimeException('Race ready barrier timeout'); }
        usleep(1000);
    }
    file_put_contents($database.'.start'.$phase, 'start');
    foreach ($children as $pid) {
        $deadline = microtime(true) + 6;
        while (pcntl_waitpid($pid, $status, WNOHANG) === 0) {
            if (microtime(true) > $deadline) { throw new RuntimeException('Owned race child timeout'); }
            usleep(1000);
        }
        policyCheck(pcntl_wifexited($status) && pcntl_wexitstatus($status) === 0, 'race client completed');
    }
    $left = json_decode(file_get_contents($results[0]), true, flags: JSON_THROW_ON_ERROR);
    $right = json_decode(file_get_contents($results[1]), true, flags: JSON_THROW_ON_ERROR);
    if ($phase === 'duplicate') {
        policyCheck($left === $right && $left['body']['revision'] === 2, 'concurrent duplicates exact receipt once');
    } else {
        $statuses = [$left['status'], $right['status']];
        sort($statuses);
        policyCheck($statuses === [200, 409], 'concurrent distinct operations one CAS winner');
    }
    config(['database.connections.sqlite.database' => $database]);
    DB::purge('sqlite');
    policyCheck((new AttentionPolicyStore())->read($other->id)['revision'] === ($phase === 'duplicate' ? 2 : 3), 'race mutation happened once');
    $children = [];
    DB::disconnect('sqlite');
    foreach ($results as $path) { unlink($path); }
    }
} finally {
    foreach ($children as $pid) {
        if (pcntl_waitpid($pid, $status, WNOHANG) === 0) { posix_kill($pid, SIGTERM); pcntl_waitpid($pid, $status); }
    }
    foreach (glob($database.'.ready*') as $path) { unlink($path); }
    foreach (glob($database.'.start*') as $path) { unlink($path); }
    DB::disconnect('sqlite');
    foreach (array_merge($results, [$database, $database.'-wal', $database.'-shm', $database.'-journal']) as $path) {
        if (file_exists($path)) {
            unlink($path);
        }
    }
}
echo "$checks attention policy checks passed\n";
} catch (Throwable $failure) {
    // Fixed safe category only: never print exception/request/session payloads.
    fwrite(STDERR, "FAIL attention-policy assertion_or_fixture_error\n");
    exit(1);
}
