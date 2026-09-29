<?php

namespace App\Http\Controllers;

use App\Services\StripePaymentLinkBilling;
use App\Services\TenantEntitlements;
use Illuminate\Http\Request;

class StripeWebhookController extends Controller
{
    public function __invoke(Request $request, StripePaymentLinkBilling $billing, TenantEntitlements $entitlements): \Illuminate\Http\Response
    {
        $billing->receive($request->getContent(), $request->header('Stripe-Signature', ''), $entitlements);
        return response('', 200);
    }
}
