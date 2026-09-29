<?php

namespace App\Services;

use App\Models\Tenant;
use App\WebPlan;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use JsonException;

final class StripePaymentLinkBilling
{
    private const LINKS = ['basic_month', 'basic_year', 'pro_month', 'pro_year'];

    public function enabled(): bool
    {
        if (!config('billing.enabled') || !is_string(config('billing.stripe_webhook_secret'))
            || !str_starts_with(config('billing.stripe_webhook_secret'), 'whsec_')) {
            return false;
        }
        $portal = parse_url(config('billing.portal_url', ''));
        if (!is_array($portal) || ($portal['scheme'] ?? null) !== 'https'
            || ($portal['host'] ?? null) !== 'billing.stripe.com') {
            return false;
        }
        foreach (self::LINKS as $key) {
            $link = config("billing.links.$key");
            if (!is_array($link) || !$this->validLink($link)) {
                return false;
            }
        }
        return true;
    }

    private function validLink(array $link): bool
    {
        $parts = parse_url($link['url'] ?? '');
        return is_array($parts) && ($parts['scheme'] ?? null) === 'https'
            && ($parts['host'] ?? null) === 'buy.stripe.com'
            && !empty($parts['path']) && empty($parts['user']) && empty($parts['pass'])
            && !isset($parts['query']) && !isset($parts['fragment'])
            && is_string($link['link_id'] ?? null) && preg_match('/^plink_[A-Za-z0-9]+$/D', $link['link_id']) === 1
            && is_string($link['price_id'] ?? null) && preg_match('/^price_[A-Za-z0-9]+$/D', $link['price_id']) === 1;
    }

    public function checkout(Tenant $tenant, WebPlan $plan, string $interval): string
    {
        abort_unless($this->enabled(), 503, 'Billing is not configured.');
        abort_unless($plan !== WebPlan::Free && in_array($interval, ['month', 'year'], true), 422);
        abort_if($tenant->effectivePlan() !== WebPlan::Free, 409, 'Manage your existing subscription before starting another.');
        $key = $plan->value.'_'.$interval;
        $link = config("billing.links.$key");
        $reference = (string) Str::uuid();
        DB::table('billing_checkout_intents')->insert([
            'id' => $reference, 'tenant_id' => $tenant->id, 'plan' => $plan->value,
            'interval' => $interval, 'payment_link_id' => $link['link_id'],
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $separator = str_contains($link['url'], '?') ? '&' : '?';
        return $link['url'].$separator.'client_reference_id='.rawurlencode($reference);
    }

    public function receive(string $rawBody, string $signatureHeader, TenantEntitlements $entitlements): void
    {
        abort_unless($this->enabled(), 503, 'Billing is not configured.');
        $this->verifySignature($rawBody, $signatureHeader);
        try {
            $event = json_decode($rawBody, true, flags: JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            abort(400, 'Invalid Stripe event.');
        }
        abort_unless(is_array($event) && is_string($event['id'] ?? null)
            && preg_match('/^evt_[A-Za-z0-9]+$/D', $event['id']) === 1
            && is_string($event['type'] ?? null)
            && ($event['livemode'] ?? null) === (bool) config('billing.stripe_live_mode')
            && is_array($event['data']['object'] ?? null), 400, 'Invalid Stripe event.');

        DB::transaction(function () use ($event, $entitlements): void {
            if (DB::table('billing_webhook_events')->where('id', $event['id'])->exists()) {
                return;
            }
            $object = $event['data']['object'];
            match ($event['type']) {
                'checkout.session.completed' => $this->bindCheckout($object, $entitlements),
                'invoice.paid' => $this->recordPaidInvoice($object, $event, $entitlements),
                'customer.subscription.updated' => $this->recordSubscriptionState($object, $event, $entitlements),
                'customer.subscription.deleted' => $this->recordEnding($object, $event, $entitlements),
                default => null,
            };
            DB::table('billing_webhook_events')->insert([
                'id' => $event['id'], 'type' => $event['type'],
                'created_at' => now(), 'updated_at' => now(),
            ]);
        });
    }

    private function verifySignature(string $rawBody, string $header): void
    {
        $parts = [];
        foreach (explode(',', $header) as $field) {
            [$key, $value] = array_pad(explode('=', trim($field), 2), 2, '');
            $parts[$key][] = $value;
        }
        $timestamp = $parts['t'][0] ?? '';
        abort_unless(ctype_digit($timestamp) && abs(time() - (int) $timestamp) <= 300, 400, 'Invalid Stripe signature.');
        $expected = hash_hmac('sha256', $timestamp.'.'.$rawBody, config('billing.stripe_webhook_secret'));
        foreach ($parts['v1'] ?? [] as $signature) {
            if (hash_equals($expected, $signature)) {
                return;
            }
        }
        abort(400, 'Invalid Stripe signature.');
    }

    private function bindCheckout(array $session, TenantEntitlements $entitlements): void
    {
        $reference = $session['client_reference_id'] ?? null;
        if (!is_string($reference) || !Str::isUuid($reference)) {
            return;
        }
        $intent = DB::table('billing_checkout_intents')->where('id', $reference)->lockForUpdate()->first();
        if (!$intent || $intent->status !== 'pending') {
            return;
        }
        $sessionId = $session['id'] ?? null;
        $subscriptionId = $session['subscription'] ?? null;
        $customerId = $session['customer'] ?? null;
        abort_unless(($session['mode'] ?? null) === 'subscription'
            && ($session['payment_link'] ?? null) === $intent->payment_link_id
            && is_string($sessionId) && preg_match('/^cs_[A-Za-z0-9_]+$/D', $sessionId) === 1
            && is_string($subscriptionId) && preg_match('/^sub_[A-Za-z0-9]+$/D', $subscriptionId) === 1
            && is_string($customerId) && preg_match('/^cus_[A-Za-z0-9]+$/D', $customerId) === 1,
            422, 'Stripe checkout did not match its payment link.');
        $tenant = Tenant::whereKey($intent->tenant_id)->lockForUpdate()->first();
        if (!$tenant) {
            DB::table('billing_checkout_intents')->where('id', $reference)->update(['status' => 'conflict', 'updated_at' => now()]);
            return;
        }
        if ($tenant->stripe_subscription_id && $tenant->stripe_subscription_id !== $subscriptionId
            && $tenant->effectivePlan() !== WebPlan::Free) {
            DB::table('billing_checkout_intents')->where('id', $reference)->update(['status' => 'conflict', 'checkout_session_id' => $sessionId, 'updated_at' => now()]);
            return;
        }
        if ($tenant->stripe_subscription_id !== $subscriptionId) {
            $tenant->forceFill(['stripe_customer_id' => $customerId,
                'stripe_subscription_id' => $subscriptionId,
                'stripe_price_id' => null, 'plan' => WebPlan::Free,
                'paid_through_at' => null, 'stripe_ended_at' => null])->save();
        }
        DB::table('billing_checkout_intents')->where('id', $reference)->update([
            'status' => 'bound', 'checkout_session_id' => $sessionId, 'updated_at' => now(),
        ]);
        $this->applyLatestPaidPeriod($tenant, $entitlements);
    }

    private function recordPaidInvoice(array $invoice, array $event, TenantEntitlements $entitlements): void
    {
        if (($invoice['status'] ?? null) !== 'paid' || ($invoice['paid'] ?? null) !== true
            || ($invoice['currency'] ?? null) !== 'usd' || ($invoice['amount_paid'] ?? 0) <= 0) {
            return;
        }
        $invoiceId = $invoice['id'] ?? null;
        $subscriptionId = $invoice['subscription'] ?? $invoice['parent']['subscription_details']['subscription'] ?? null;
        $customerId = $invoice['customer'] ?? null;
        if (!is_string($invoiceId) || !str_starts_with($invoiceId, 'in_')
            || !is_string($subscriptionId) || !str_starts_with($subscriptionId, 'sub_')
            || !is_string($customerId) || !str_starts_with($customerId, 'cus_')) {
            return;
        }
        $lines = $invoice['lines'] ?? null;
        abort_unless(is_array($lines) && ($lines['has_more'] ?? false) === false
            && is_array($lines['data'] ?? null), 422, 'Incomplete paid invoice lines.');
        $recognized = [];
        foreach ($lines['data'] as $line) {
            $priceId = $line['pricing']['price_details']['price'] ?? $line['price']['id'] ?? null;
            if (!is_string($priceId) || $this->planForPrice($priceId) === null) {
                continue;
            }
            if (($line['amount'] ?? 0) <= 0) {
                continue;
            }
            $recognized[] = [$priceId, $line];
        }
        if ($recognized === []) {
            return;
        }
        abort_unless(count($recognized) === 1, 422, 'Ambiguous paid invoice.');
        [$priceId, $line] = $recognized[0];
        $start = $line['period']['start'] ?? null;
        $end = $line['period']['end'] ?? null;
        abort_unless(($line['quantity'] ?? null) === 1 && is_int($start) && is_int($end)
            && $start > 0 && $end > $start && $end <= time() + 370 * 86400,
            422, 'Invalid paid subscription period.');
        DB::table('billing_invoice_periods')->insertOrIgnore([
            'invoice_id' => $invoiceId, 'subscription_id' => $subscriptionId,
            'customer_id' => $customerId, 'price_id' => $priceId,
            'starts_at' => $start, 'ends_at' => $end,
            'paid_at' => $invoice['status_transitions']['paid_at'] ?? $event['created'] ?? time(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $tenant = Tenant::where('stripe_subscription_id', $subscriptionId)
            ->where('stripe_customer_id', $customerId)->lockForUpdate()->first();
        if ($tenant) {
            $this->applyLatestPaidPeriod($tenant, $entitlements);
        }
    }

    private function recordEnding(array $subscription, array $event, TenantEntitlements $entitlements): void
    {
        $subscriptionId = $subscription['id'] ?? null;
        if (!is_string($subscriptionId) || !str_starts_with($subscriptionId, 'sub_')) {
            return;
        }
        $ended = $subscription['ended_at'] ?? $event['created'] ?? time();
        abort_unless(is_int($ended) && $ended > 0, 422, 'Invalid subscription ending.');
        DB::table('billing_subscription_endings')->updateOrInsert(
            ['subscription_id' => $subscriptionId],
            ['ended_at' => $ended, 'updated_at' => now(), 'created_at' => now()],
        );
        $tenant = Tenant::where('stripe_subscription_id', $subscriptionId)->lockForUpdate()->first();
        if ($tenant) {
            $this->applyLatestPaidPeriod($tenant, $entitlements);
        }
    }

    private function recordSubscriptionState(array $subscription, array $event, TenantEntitlements $entitlements): void
    {
        $subscriptionId = $subscription['id'] ?? null;
        $customerId = $subscription['customer'] ?? null;
        $items = $subscription['items']['data'] ?? null;
        $created = $event['created'] ?? null;
        if (!is_string($subscriptionId) || !str_starts_with($subscriptionId, 'sub_')
            || !is_string($customerId) || !str_starts_with($customerId, 'cus_')
            || !is_array($items) || count($items) !== 1 || ($subscription['items']['has_more'] ?? false) !== false
            || !is_int($created) || $created <= 0) {
            return;
        }
        $priceId = $items[0]['price']['id'] ?? null;
        if (!is_string($priceId) || !$this->planForPrice($priceId) || ($items[0]['quantity'] ?? null) !== 1) {
            return;
        }
        $existing = DB::table('billing_subscription_states')->where('subscription_id', $subscriptionId)->lockForUpdate()->first();
        $existingPlan = $existing ? $this->planForPrice($existing->price_id) : null;
        if ($existing && ($existing->event_created > $created
            || ($existing->event_created === $created
                && $existingPlan && $existingPlan->vesselLimit() <= $this->planForPrice($priceId)->vesselLimit()))) {
            return;
        }
        DB::table('billing_subscription_states')->updateOrInsert(
            ['subscription_id' => $subscriptionId],
            ['customer_id' => $customerId, 'price_id' => $priceId, 'event_created' => $created,
                'created_at' => $existing?->created_at ?? now(), 'updated_at' => now()],
        );
        $tenant = Tenant::where('stripe_subscription_id', $subscriptionId)
            ->where('stripe_customer_id', $customerId)->lockForUpdate()->first();
        if ($tenant) {
            $this->applyLatestPaidPeriod($tenant, $entitlements);
        }
    }

    public function applyLatestPaidPeriod(Tenant $tenant, TenantEntitlements $entitlements): void
    {
        if (!$tenant->stripe_subscription_id || !$tenant->stripe_customer_id) {
            return;
        }
        $period = DB::table('billing_invoice_periods')
            ->where('subscription_id', $tenant->stripe_subscription_id)
            ->where('customer_id', $tenant->stripe_customer_id)
            ->where('starts_at', '<=', time())
            ->orderByDesc('starts_at')->orderByDesc('paid_at')->orderByDesc('invoice_id')->first();
        if (!$period) {
            return;
        }
        $plan = $this->planForPrice($period->price_id);
        if (!$plan) {
            return;
        }
        $effectivePriceId = $period->price_id;
        $state = DB::table('billing_subscription_states')
            ->where('subscription_id', $tenant->stripe_subscription_id)
            ->where('customer_id', $tenant->stripe_customer_id)->first();
        if ($state && ($statePlan = $this->planForPrice($state->price_id))
            && $statePlan->vesselLimit() < $plan->vesselLimit()) {
            $plan = $statePlan;
            $effectivePriceId = $state->price_id;
        }
        $ending = DB::table('billing_subscription_endings')
            ->where('subscription_id', $tenant->stripe_subscription_id)->first();
        $end = min($period->ends_at, $ending?->ended_at ?? $period->ends_at);
        if ($tenant->plan === $plan && $tenant->stripe_price_id === $effectivePriceId
            && $tenant->paid_through_at?->timestamp === $end
            && $tenant->stripe_ended_at?->timestamp === ($ending?->ended_at)) {
            return;
        }
        $tenant->forceFill([
            'plan' => $plan, 'stripe_price_id' => $effectivePriceId,
            'paid_through_at' => CarbonImmutable::createFromTimestampUTC($end),
            'stripe_ended_at' => $ending ? CarbonImmutable::createFromTimestampUTC($ending->ended_at) : null,
        ])->save();
        $entitlements->disconnectExcess($tenant);
    }

    private function planForPrice(string $priceId): ?WebPlan
    {
        foreach (self::LINKS as $key) {
            if (config("billing.links.$key.price_id") === $priceId) {
                return str_starts_with($key, 'basic_') ? WebPlan::Basic : WebPlan::Pro;
            }
        }
        return null;
    }
}
