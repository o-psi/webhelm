<?php

namespace App\Http\Controllers;

use App\Models\VesselConnection;
use App\Services\TenantEntitlements;
use App\Services\StripePaymentLinkBilling;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class ReactConsoleController extends Controller
{
    public function redirect(Request $request): \Illuminate\Http\RedirectResponse
    {
        return redirect()->route('console', $request->boolean('manage-vessels') ? ['manage-vessels' => 1] : []);
    }

    public function __invoke(Request $request, TenantEntitlements $entitlements, StripePaymentLinkBilling $billing): View
    {
        $tenant = $request->user()->tenant;
        if ($billing->enabled()) {
            $billing->applyLatestPaidPeriod($tenant, $entitlements);
        }
        $entitlements->disconnectExcess($tenant);
        $tenant->refresh();
        return view('console.react', [
            'bootstrap' => [
                'connectionStatus' => $request->session()->get('status'),
                'connectionForm' => $request->session()->get('vessel_form'),
                'connectionError' => $request->session()->has('errors') ? 'Connection not confirmed. Check your saved Vessels before trying a new invitation.' : null,
                'tenantId' => $request->user()->tenant_id,
                'principalId' => $request->user()->tenant->principal_id,
                'plan' => $tenant->effectivePlan()->value,
                'billingEnabled' => $billing->enabled(),
                'billingCheckoutUrl' => route('billing.checkout', absolute: false),
                'billingPortalUrl' => $billing->enabled() ? config('billing.portal_url') : null,
                'vesselLimit' => $entitlements->limit($tenant),
                'paidThrough' => $tenant->paid_through_at?->toIso8601String(),
                'vessels' => VesselConnection::where('tenant_id', $request->user()->tenant_id)
                    ->orderByDesc('retention_priority')->orderBy('created_at')->orderBy('id')
                    ->get(['id', 'name', 'vessel_id', 'endpoint'])->toArray(),
                'ticketUrl' => route('console.ticket', absolute: false),
                'connectionsUrl' => route('connections', absolute: false),
                'logoutUrl' => route('console.logout', absolute: false),
            ],
        ]);
    }
}
