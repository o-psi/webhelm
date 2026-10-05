<?php

// Real Socialite/OIDC code; only the outbound HTTP transport is replaced.
putenv('APP_ENV=testing');
putenv('DB_CONNECTION=sqlite');
putenv('DB_DATABASE=:memory:');
putenv('SESSION_DRIVER=array');
putenv('CACHE_STORE=array');
putenv('APP_KEY=base64:'.base64_encode(str_repeat('m', 32)));
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\OAuthController;
use App\Models\OAuthIdentity;
use App\Models\Tenant;
use App\Models\User;
use App\Services\OAuthAccounts;
use App\Services\OAuthProviders;
use Firebase\JWT\JWT;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Laravel\Socialite\Two\AbstractProvider;

$count = 0;
$passed = false;
register_shutdown_function(function () use (&$passed): void { if (! $passed) { exit(1); } });
function checkMicrosoft(bool $condition, string $message): void
{
    global $count;
    if (! $condition) { throw new RuntimeException($message); }
    $count++;
}
function microsoftRequest(string $path, array $query = []): Request
{
    global $app;
    $request = Request::create('https://helm.example'.$path, 'GET', $query);
    $request->setLaravelSession($app['session']->driver());
    $app->instance('request', $request);
    return $request;
}
class MicrosoftFixtureProviders extends OAuthProviders
{
    public array $history = [];
    public array $responses = [];
    public function driver(string $provider): AbstractProvider
    {
        $driver = parent::driver($provider);
        $configuration = (new ReflectionProperty(AbstractProvider::class, 'httpClient'))->getValue($driver)->getConfig();
        checkMicrosoft($configuration['connect_timeout'] === 5, 'bounded connection deadline');
        checkMicrosoft($configuration['timeout'] === 15, 'bounded request deadline');
        checkMicrosoft($configuration['allow_redirects'] === false, 'Microsoft credentials never follow HTTP redirects');
        $handler = HandlerStack::create(new MockHandler($this->responses));
        $handler->push(Middleware::history($this->history));
        return $driver->setHttpClient(new Client(array_replace($configuration, ['handler' => $handler, 'allow_redirects' => false])));
    }
}
foreach (glob(__DIR__.'/../database/migrations/0001_*.php') as $path) { (require $path)->up(); }
(require __DIR__.'/../database/migrations/2026_09_01_000000_create_oauth_tenants.php')->up();
(require __DIR__.'/../database/migrations/2026_09_15_230200_create_vessel_connections.php')->up();
foreach (['google', 'x', 'github', 'microsoft'] as $id) {
    config(['services.'.$id.'.client_id' => '', 'services.'.$id.'.client_secret' => '']);
}
config(['app.url' => 'https://helm.example/', 'services.microsoft.tenant' => 'common']);
checkMicrosoft(OAuthController::providers() === [], 'unconfigured Microsoft is hidden');
config(['services.microsoft.client_id' => 'fixture-client']);
checkMicrosoft(OAuthController::providers() === [], 'incomplete Microsoft is hidden');
config(['services.microsoft.client_secret' => 'fixture-client-secret']);
checkMicrosoft(OAuthController::providers() === ['microsoft' => 'Microsoft'], 'configured Microsoft is offered');
checkMicrosoft(route('oauth.redirect', 'microsoft', absolute: false) === '/auth/microsoft', 'shared login button uses the provider route');

$session = $app['session']->driver();
$session->start();
$controller = new OAuthController;
$accounts = new OAuthAccounts;
$providers = new MicrosoftFixtureProviders;
$app->instance(OAuthProviders::class, $providers);
$key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
if ($key === false) { throw new RuntimeException('RSA fixture creation failed.'); }
openssl_pkey_export($key, $privateKey);
$details = openssl_pkey_get_details($key);
$base64url = static fn (string $value): string => rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
$jwks = ['keys' => [['kty' => 'RSA', 'kid' => 'fixture-key', 'alg' => 'RS256', 'use' => 'sig',
    'n' => $base64url($details['rsa']['n']), 'e' => $base64url($details['rsa']['e'])]]];
$metadata = ['issuer' => 'https://login.microsoftonline.com/{tenantid}/v2.0',
    'jwks_uri' => 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    'id_token_signing_alg_values_supported' => ['RS256']];
$jsonResponse = static fn (array $data): Response => new Response(200, [], json_encode($data, JSON_THROW_ON_ERROR));
$begin = function () use ($controller, $providers, $session): array {
    Auth::logout();
    Cache::flush();
    $providers->history = [];
    $providers->responses = [];
    $response = $controller->redirect(microsoftRequest('/auth/microsoft'), 'microsoft', $providers);
    parse_str(parse_url($response->getTargetUrl(), PHP_URL_QUERY), $query);
    checkMicrosoft(str_starts_with($response->getTargetUrl(), 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?'), 'both account types use common authority');
    checkMicrosoft($query['redirect_uri'] === 'https://helm.example/auth/microsoft/callback', 'trusted exact callback');
    checkMicrosoft($query['scope'] === 'openid profile User.Read', 'minimal identity scopes without offline access');
    checkMicrosoft(strlen($query['state']) >= 32 && $query['code_challenge_method'] === 'S256', 'state and PKCE');
    checkMicrosoft(strlen($query['nonce']) === 64 && $session->get('helm_microsoft_nonce') === $query['nonce'], 'nonce binds login attempt');
    return $query;
};
$consumer = '9188040d-6c67-4c5b-b112-36a304b66dad';
$organization = '11111111-2222-3333-4444-555555555555';
$claimsFor = static fn (array $query, string $tenant): array => [
    'iss' => 'https://login.microsoftonline.com/'.$tenant.'/v2.0', 'tid' => $tenant,
    'sub' => 'same-opaque-subject', 'aud' => 'fixture-client', 'nonce' => $query['nonce'],
    'iat' => time() - 1, 'nbf' => time() - 1, 'exp' => time() + 3600,
];
$callbacks = function (array $query, array $claims, array $profile, ?string $token = null) use ($providers, $privateKey, $jsonResponse, $metadata, $jwks, $controller, $accounts): mixed {
    $token ??= JWT::encode($claims, $privateKey, 'RS256', 'fixture-key');
    $providers->responses = [$jsonResponse(['access_token' => 'synthetic-access-token', 'id_token' => $token]),
        $jsonResponse($metadata), $jsonResponse($jwks), $jsonResponse($profile)];
    return $controller->callback(microsoftRequest('/auth/microsoft/callback', ['code' => 'fixture-code', 'state' => $query['state']]), 'microsoft', $providers, $accounts);
};
$users = [];
foreach ([$consumer => '00000000847f35fe', $organization => 'abcdefab-1234-1234-1234-abcdefabcdef'] as $tenant => $graphId) {
    $query = $begin();
    $verifier = $session->get('code_verifier');
    $before = $session->getId();
    $response = $callbacks($query, $claimsFor($query, $tenant), ['id' => $graphId, 'displayName' => 'Fixture person']);
    checkMicrosoft(Auth::check() && in_array(parse_url($response->getTargetUrl(), PHP_URL_PATH) ?? '', ['', '/'], true), 'signed Microsoft callback succeeds');
    $users[$tenant] = Auth::id();
    checkMicrosoft($session->getId() !== $before, 'successful login rotates session');
    checkMicrosoft(Auth::user()->email === null, 'profile email is not collected or used for identity');
    checkMicrosoft(! $session->has('helm_microsoft_nonce') && ! $session->has('state') && ! $session->has('code_verifier'), 'successful attempt consumed');
    checkMicrosoft(! str_contains(json_encode($session->all()), 'synthetic-access-token'), 'provider token excluded from session');
    parse_str((string) $providers->history[0]['request']->getBody(), $exchange);
    checkMicrosoft($exchange['code_verifier'] === $verifier, 'real token exchange sends PKCE verifier');
    checkMicrosoft((string) $providers->history[0]['request']->getUri() === 'https://login.microsoftonline.com/common/oauth2/v2.0/token', 'token endpoint is common authority');
    checkMicrosoft((string) $providers->history[1]['request']->getUri() === 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration', 'real discovery validated');
    checkMicrosoft($providers->history[3]['request']->getUri()->getQuery() === '%24select=id%2CdisplayName', 'Graph requests only identity display fields');
    $providers->history = [];
    Auth::logout();
    $controller->callback(microsoftRequest('/auth/microsoft/callback', ['code' => 'fixture-code', 'state' => $query['state']]), 'microsoft', $providers, $accounts);
    checkMicrosoft(! Auth::check() && $providers->history === [], 'callback replay rejected without HTTP');
}
checkMicrosoft($users[$consumer] !== $users[$organization] && Tenant::count() === 2, 'same subject in different tenants never merges');
$query = $begin();
$callbacks($query, $claimsFor($query, $consumer), ['id' => 'opaque-personal-id', 'displayName' => 'Changed display name']);
checkMicrosoft(Auth::id() === $users[$consumer] && Tenant::count() === 2, 'repeat sign-in preserves user and tenant');
$other = $accounts->resolve('github', (new Laravel\Socialite\Two\User)->map(['id' => $consumer.':same-opaque-subject', 'name' => 'Other provider']));
checkMicrosoft($other->id !== Auth::id(), 'identical subject on another provider stays separate');

foreach (['audience', 'ambiguous-audience', 'wrong-authorized-party', 'wrong-algorithm', 'issuer', 'nonce', 'missing-nonce', 'missing-subject', 'oversized-subject', 'future-issued', 'expired', 'bad-signature', 'invalid-tenant', 'missing-token', 'state', 'denied', 'attempt-expired', 'exchange-failure', 'profile-failure', 'profile-redirect', 'profile-malformed', 'profile-empty-id'] as $failure) {
    $query = $begin();
    $claims = $claimsFor($query, $consumer);
    match ($failure) {
        'audience' => $claims['aud'] = 'prefix-fixture-client-suffix',
        'ambiguous-audience' => $claims['aud'] = ['fixture-client', 'other-client'],
        'wrong-authorized-party' => $claims['azp'] = 'other-client',
        'issuer' => $claims['iss'] = 'https://attacker.example/'.$consumer.'/v2.0',
        'nonce' => $claims['nonce'] = 'wrong-nonce',
        'missing-nonce' => $claims['nonce'] = null,
        'missing-subject' => $claims['sub'] = '',
        'oversized-subject' => $claims['sub'] = str_repeat('x', 155),
        'future-issued' => $claims['iat'] = time() + 3600,
        'expired' => $claims['exp'] = time() - 1,
        'invalid-tenant' => $claims['tid'] = 'invalid-tenant',
        default => null,
    };
    $beforeUsers = User::count();
    $beforeTenants = Tenant::count();
    $signed = JWT::encode($claims, $privateKey, 'RS256', 'fixture-key');
    if ($failure === 'wrong-algorithm') { $signed = JWT::encode($claims, str_repeat('h', 64), 'HS256', 'fixture-key'); }
    if ($failure === 'bad-signature') { $signed = substr($signed, 0, -10).'AAAAAAAAAA'; }
    if ($failure === 'missing-token') {
        $providers->responses = [$jsonResponse(['access_token' => 'synthetic-access-token'])];
    } elseif (in_array($failure, ['state', 'denied', 'attempt-expired', 'exchange-failure'], true)) {
        $providers->responses = [new Response(400, [], '{"secret":"synthetic-access-token"}')];
    } else {
        $providers->responses = [$jsonResponse(['access_token' => 'synthetic-access-token', 'id_token' => $signed]), $jsonResponse($metadata), $jsonResponse($jwks),
            match ($failure) {
                'profile-failure' => new Response(503, [], '{"secret":"synthetic-access-token"}'),
                'profile-redirect' => new Response(302, ['Location' => 'https://attacker.example/'], '{"id":"opaque-id","displayName":"Fixture"}'),
                'profile-malformed' => new Response(200, [], 'invalid JSON'),
                'profile-empty-id' => $jsonResponse(['id' => '', 'displayName' => 'Fixture']),
                default => $jsonResponse(['id' => 'opaque-id', 'displayName' => 'Fixture']),
            }];
    }
    $params = ['code' => 'fixture-code', 'state' => $failure === 'state' ? 'wrong-state' : $query['state']];
    if ($failure === 'denied') { $params['error'] = 'access_denied'; }
    if ($failure === 'attempt-expired') { $session->put('helm_oauth_attempt.expires', time() - 1); }
    $response = $controller->callback(microsoftRequest('/auth/microsoft/callback', $params), 'microsoft', $providers, $accounts);
    checkMicrosoft(! Auth::check() && str_ends_with($response->getTargetUrl(), '/console/login'), $failure.' fails closed');
    checkMicrosoft(User::count() === $beforeUsers && Tenant::count() === $beforeTenants, $failure.' leaves no identity allocation');
    checkMicrosoft($session->get('errors')->first('oauth') === 'Sign-in could not be completed. Please try again.', $failure.' gives safe error');
    checkMicrosoft(! $session->has('helm_microsoft_nonce') && ! $session->has('state') && ! $session->has('code_verifier') && ! $session->has('helm_oauth_attempt'), $failure.' clears attempt');
    checkMicrosoft(! str_contains(json_encode($session->all()), 'synthetic-access-token'), $failure.' excludes provider secret');
    if (in_array($failure, ['state', 'denied', 'attempt-expired'], true)) {
        checkMicrosoft($providers->history === [], $failure.' has no provider HTTP');
    }
}
checkMicrosoft(OAuthIdentity::count() === 3, 'failed sign-ins never persist identities');
// Exercise actual shared Blade controls without requiring unrelated Vite assets.
Illuminate\Support\Facades\Vite::swap(new class extends Illuminate\Foundation\Vite {
    public function __invoke($entrypoints, $buildDirectory = null): Illuminate\Support\HtmlString
    {
        return new Illuminate\Support\HtmlString('');
    }
});
$html = view('console.login', ['errors' => new Illuminate\Support\ViewErrorBag])->render();
checkMicrosoft(str_contains($html, 'Continue with Microsoft') && str_contains($html, '/auth/microsoft'), 'shared login renders configured Microsoft button');
config(['services.microsoft.client_secret' => '']);
$html = view('console.login', ['errors' => new Illuminate\Support\ViewErrorBag])->render();
checkMicrosoft(! str_contains($html, 'Continue with Microsoft'), 'shared login hides incomplete Microsoft provider');
config(['services.microsoft.client_secret' => 'fixture-client-secret']);

// Key rollover retries only the original JWKS read, never the token exchange.
$query = $begin();
$rotatedKeys = $jwks;
$rotatedKeys['keys'][0]['kid'] = 'rotated-key';
$providers->responses = [$jsonResponse(['access_token' => 'synthetic-access-token', 'id_token' => JWT::encode($claimsFor($query, $consumer), $privateKey, 'RS256', 'rotated-key')]),
    $jsonResponse($metadata), $jsonResponse($jwks), $jsonResponse($rotatedKeys), $jsonResponse(['id' => 'opaque-personal-id', 'displayName' => 'Fixture'])];
$controller->callback(microsoftRequest('/auth/microsoft/callback', ['code' => 'fixture-code', 'state' => $query['state']]), 'microsoft', $providers, $accounts);
checkMicrosoft(Auth::id() === $users[$consumer] && count($providers->history) === 5, 'unknown signing key refreshes once and login succeeds');
checkMicrosoft($providers->history[3]['request']->getHeaderLine('Cache-Control') === 'no-cache', 'JWKS rollover forces fresh key read');
checkMicrosoft(count(array_filter($providers->history, static fn (array $entry): bool => $entry['request']->getMethod() === 'POST')) === 1, 'key rollover never replays token exchange');
checkMicrosoft(App\Models\VesselConnection::where('tenant_id', Auth::user()->tenant_id)->count() === 0, 'new Microsoft tenant inherits no connections');
$oldSession = $session->getId();
(new App\Http\Controllers\ConsoleAuthController)->logout(microsoftRequest('/console/logout'));
checkMicrosoft(! Auth::check() && $oldSession !== $session->getId() && ! $session->has('helm_operator_until'), 'Microsoft logout invalidates authenticated session');
$passed = true;
echo "Microsoft OAuth offline checks passed: $count\n";
