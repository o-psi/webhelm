<?php

namespace App\Http\Controllers;

use App\Services\StripePaymentLinkBilling;
use App\WebPlan;
use Illuminate\Http\Request;

class BillingCheckoutController extends Controller
{
    public function __invoke(Request $request, StripePaymentLinkBilling $billing): \Illuminate\Http\RedirectResponse
    {
        $data = $request->validate([
            'plan' => ['required', 'in:basic,pro'],
            'interval' => ['required', 'in:month,year'],
        ]);
        $url = $billing->checkout($request->user()->tenant, WebPlan::from($data['plan']), $data['interval']);
        return redirect()->away($url);
    }
}
