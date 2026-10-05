<?php

// Offline isolated SQLite checks. Run with the repository's installed vendor tree.
putenv('APP_ENV=testing');
putenv('DB_CONNECTION=sqlite');
putenv('DB_DATABASE=:memory:');
putenv('CACHE_STORE=array');
putenv('APP_KEY=base64:'.base64_encode(str_repeat('p', 32)));
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
foreach (glob(__DIR__.'/../database/migrations/*.php') as $file) {
    (require $file)->up();
}

use App\Attention\AttentionPolicy;
use App\Models\Tenant;
use App\Services\AttentionPolicyStore;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\DB;

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

// Actual two-process race against a disposable file-backed SQLite copy. No fallback
// to pretending sequential calls are a race when pcntl is unavailable.
if (!function_exists('pcntl_fork')) {
    throw new RuntimeException('Concurrent SQLite qualification requires pcntl; race not run.');
}
$database = tempnam(sys_get_temp_dir(), 'attention-policy-');
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
            try {
                config(['database.connections.sqlite.database' => $database]);
                DB::purge('sqlite');
                DB::statement('PRAGMA busy_timeout = 5000');
                // Same exact operation races: both must return identical durable receipt.
                $result = (new AttentionPolicyStore())->change($other->id, $phase === 'duplicate' ? $raceId : (string) Str::uuid(),
                    ['expected_revision' => $phase === 'duplicate' ? 0 : 1, 'stale_policy' => 'seven_days']);
                file_put_contents($resultPath, json_encode($result, JSON_THROW_ON_ERROR));
                exit(0);
            } catch (Throwable $error) {
                file_put_contents($resultPath, $error->getMessage());
                exit(1);
            }
        }
        $children[] = $pid;
    }
    foreach ($children as $pid) {
        pcntl_waitpid($pid, $status);
        policyCheck(pcntl_wifexited($status) && pcntl_wexitstatus($status) === 0, 'race client completed');
    }
    $left = json_decode(file_get_contents($results[0]), true, flags: JSON_THROW_ON_ERROR);
    $right = json_decode(file_get_contents($results[1]), true, flags: JSON_THROW_ON_ERROR);
    if ($phase === 'duplicate') {
        policyCheck($left === $right && $left['body']['revision'] === 1, 'concurrent duplicates exact receipt once');
    } else {
        $statuses = [$left['status'], $right['status']];
        sort($statuses);
        policyCheck($statuses === [200, 409], 'concurrent distinct operations one CAS winner');
    }
    config(['database.connections.sqlite.database' => $database]);
    DB::purge('sqlite');
    policyCheck((new AttentionPolicyStore())->read($other->id)['revision'] === ($phase === 'duplicate' ? 1 : 2), 'race mutation happened once');
    DB::disconnect('sqlite');
    foreach ($results as $path) { unlink($path); }
    }
} finally {
    DB::disconnect('sqlite');
    foreach (array_merge($results, [$database, $database.'-wal', $database.'-shm', $database.'-journal']) as $path) {
        if (file_exists($path)) {
            unlink($path);
        }
    }
}
echo "$checks attention policy checks passed\n";

