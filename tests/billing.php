<?php

// Offline entitlement and signed Stripe receipt checks; no provider calls.
putenv('APP_ENV=testing');
putenv('DB_CONNECTION=sqlite');
putenv('DB_DATABASE=:memory:');
putenv('SESSION_DRIVER=database');
putenv('CACHE_STORE=array');
putenv('APP_KEY=base64:'.base64_encode(str_repeat('b', 32)));
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\Tenant;
use App\Models\VesselConnection;
use App\Services\StripePaymentLinkBilling;
use App\Services\TenantEntitlements;
use App\WebPlan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

foreach (glob(__DIR__.'/../database/migrations/*.php') as $file) {
    (require $file)->up();
}

$checks = 0;
function checkBilling(bool $condition, string $name): void {
    global $checks;
    if (!$condition) throw new RuntimeException($name);
    $checks++;
}
function billingRefuses(callable $run, string $name): void {
    try { $run(); } catch (Throwable) { checkBilling(true, $name); return; }
    throw new RuntimeException('Accepted '.$name);
}

$links = [];
foreach (['basic_month', 'basic_year', 'pro_month', 'pro_year'] as $key) {
    $links[$key] = ['url' => 'https://buy.stripe.com/test_'.$key,
        'link_id' => 'plink_'.str_replace('_', '', $key),
        'price_id' => 'price_'.str_replace('_', '', $key)];
}
config(['billing.enabled' => false, 'billing.stripe_webhook_secret' => 'whsec_'.str_repeat('s', 32),
    'billing.stripe_live_mode' => false, 'billing.portal_url' => 'https://billing.stripe.com/p/login/test',
    'billing.links' => $links]);
$billing = app(StripePaymentLinkBilling::class);
$entitlements = app(TenantEntitlements::class);
$tenant = Tenant::create(['name' => 'Owner', 'principal_id' => (string) Str::uuid()]);
$other = Tenant::create(['name' => 'Other', 'principal_id' => (string) Str::uuid()]);
checkBilling($entitlements->limit($tenant) === 64, 'disabled rollout retains existing ceiling');
config(['billing.enabled' => true]);
checkBilling($billing->enabled() && $entitlements->limit($tenant) === 8, 'Free limit');

$credential = ['token' => str_repeat('a', 64), 'grant_id' => (string) Str::uuid()];
$connections = [];
for ($i = 0; $i < 8; $i++) {
    $vesselId = (string) Str::uuid();
    $entitlements->saveConnection($tenant, 'Vessel '.$i, 'https://vessel.example',
        $credential + ['vessel_id' => $vesselId]);
    $connections[] = VesselConnection::where('tenant_id', $tenant->id)->where('vessel_id', $vesselId)->firstOrFail();
}
checkBilling(VesselConnection::where('tenant_id', $tenant->id)->count() === 8, 'eight Free connections');
billingRefuses(fn() => $entitlements->saveConnection($tenant, 'Ninth', 'https://vessel.example',
    $credential + ['vessel_id' => (string) Str::uuid()]), 'ninth Free connection');
checkBilling(!$entitlements->permits($other, $connections[0]), 'tenant isolation');
checkBilling(!$entitlements->canAdd($tenant, (string) Str::uuid()), 'Free add denied');

$url = $billing->checkout($tenant, WebPlan::Basic, 'month');
$reference = DB::table('billing_checkout_intents')->first()->id;
checkBilling(str_contains($url, 'client_reference_id='.$reference), 'checkout references tenant intent');
checkBilling($tenant->fresh()->effectivePlan() === WebPlan::Free, 'checkout alone does not grant plan');

$sign = static function (array $event): array {
    $raw = json_encode($event, JSON_THROW_ON_ERROR);
    $time = time();
    return [$raw, 't='.$time.',v1='.hash_hmac('sha256', $time.'.'.$raw, config('billing.stripe_webhook_secret'))];
};
$receive = static function (array $event) use ($billing, $entitlements, $sign): void {
    [$raw, $signature] = $sign($event);
    $billing->receive($raw, $signature, $entitlements);
};
$periodStart = time() - 60;
$periodEnd = time() + 30 * 86400;
$invoice = ['id' => 'in_basicone', 'status' => 'paid', 'paid' => true, 'currency' => 'usd',
    'amount_paid' => 300, 'customer' => 'cus_basicone', 'subscription' => 'sub_basicone',
    'lines' => ['has_more' => false, 'data' => [[
        'price' => ['id' => 'price_basicmonth'], 'quantity' => 1,
        'period' => ['start' => $periodStart, 'end' => $periodEnd],
    ]]]];
$event = static fn(string $id, string $type, array $object): array => [
    'id' => $id, 'type' => $type, 'created' => time(), 'livemode' => false,
    'data' => ['object' => $object],
];
[$raw, $signature] = $sign($event('evt_bad', 'invoice.paid', $invoice));
billingRefuses(fn() => $billing->receive($raw, 't=1,v1=bad', $entitlements), 'invalid webhook signature');
$receive($event('evt_invoiceone', 'invoice.paid', $invoice));
checkBilling($tenant->fresh()->effectivePlan() === WebPlan::Free, 'out-of-order invoice not yet bound');
$session = ['id' => 'cs_test_basicone', 'mode' => 'subscription',
    'client_reference_id' => $reference, 'payment_link' => 'plink_basicmonth',
    'subscription' => 'sub_basicone', 'customer' => 'cus_basicone'];
[$raw, $signature] = $sign($event('evt_wronglink', 'checkout.session.completed',
    array_replace($session, ['payment_link' => 'plink_promonth'])));
billingRefuses(fn() => $billing->receive($raw, $signature, $entitlements), 'wrong payment link');
$receive($event('evt_checkoutone', 'checkout.session.completed', $session));
checkBilling($tenant->fresh()->effectivePlan() === WebPlan::Basic && $entitlements->limit($tenant->fresh()) === 16,
    'signed paid invoice grants Basic after checkout binds');
$receive($event('evt_checkoutone', 'checkout.session.completed', $session));
checkBilling(DB::table('billing_webhook_events')->where('id', 'evt_checkoutone')->count() === 1,
    'webhook retry is idempotent');
checkBilling($tenant->fresh()->paid_through_at->timestamp === $periodEnd, 'paid through from invoice period');

for ($i = 8; $i < 10; $i++) {
    $entitlements->saveConnection($tenant->fresh(), 'Vessel '.$i, 'https://vessel.example',
        $credential + ['vessel_id' => (string) Str::uuid()]);
}
checkBilling(VesselConnection::where('tenant_id', $tenant->id)->count() === 10, 'Basic accepts more than eight');
$proInvoice = $invoice;
$proInvoice['id'] = 'in_proone';
$proInvoice['amount_paid'] = 900;
$proInvoice['lines']['data'][0]['price']['id'] = 'price_promonth';
$proInvoice['lines']['data'][0]['period']['start'] = time() - 30;
$receive($event('evt_proupgrade', 'invoice.paid', $proInvoice));
checkBilling($tenant->fresh()->effectivePlan() === WebPlan::Pro && $entitlements->limit($tenant->fresh()) === 64,
    'paid Stripe price change grants Pro without new checkout');
for ($i = 10; $i < 19; $i++) {
    $entitlements->saveConnection($tenant->fresh(), 'Vessel '.$i, 'https://vessel.example',
        $credential + ['vessel_id' => (string) Str::uuid()]);
}
$ordered = VesselConnection::where('tenant_id', $tenant->id)->orderBy('created_at')->orderBy('id')->pluck('id')->all();
$priority = array_merge(array_slice($ordered, -2), array_slice($ordered, 0, -2));
$entitlements->setRetentionOrder($tenant, $priority);
checkBilling($entitlements->retainedConnectionIds($tenant->fresh())[0] === $priority[0], 'retention priority saved');
$basicRenewal = $invoice;
$basicRenewal['id'] = 'in_basicrenewal';
$basicRenewal['lines']['data'][0]['period']['start'] = time() - 10;
$receive($event('evt_basicdowngrade', 'invoice.paid', $basicRenewal));
checkBilling($entitlements->limit($tenant->fresh()) === 16
    && VesselConnection::where('tenant_id', $tenant->id)->count() === 16,
    'paid downgrade to Basic immediately enforces sixteen');
checkBilling(VesselConnection::where('tenant_id', $tenant->id)->whereIn('id', array_slice($priority, 0, 2))->count() === 2,
    'priority Vessels survive paid downgrade');
$receive($event('evt_endone', 'customer.subscription.deleted', ['id' => 'sub_basicone', 'ended_at' => time() - 1]));
checkBilling($tenant->fresh()->effectivePlan() === WebPlan::Free, 'ended subscription falls to Free');
checkBilling(VesselConnection::where('tenant_id', $tenant->id)->count() === 8, 'downgrade removes excess connections');
checkBilling(VesselConnection::where('tenant_id', $tenant->id)->whereIn('id', array_slice($priority, 0, 8))->count() === 8,
    'highest priority Vessels retained on Free');

echo "PASS $checks billing checks\n";
