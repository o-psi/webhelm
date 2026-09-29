<?php

return [
    'enabled' => (bool) env('HELM_BILLING_ENABLED', false),
    'stripe_webhook_secret' => env('HELM_STRIPE_WEBHOOK_SECRET', ''),
    'stripe_live_mode' => (bool) env('HELM_STRIPE_LIVE_MODE', false),
    'portal_url' => env('HELM_STRIPE_PORTAL_URL', ''),
    'links' => [
        'basic_month' => [
            'url' => env('HELM_STRIPE_BASIC_MONTH_URL', ''),
            'link_id' => env('HELM_STRIPE_BASIC_MONTH_LINK_ID', ''),
            'price_id' => env('HELM_STRIPE_BASIC_MONTH_PRICE_ID', ''),
        ],
        'basic_year' => [
            'url' => env('HELM_STRIPE_BASIC_YEAR_URL', ''),
            'link_id' => env('HELM_STRIPE_BASIC_YEAR_LINK_ID', ''),
            'price_id' => env('HELM_STRIPE_BASIC_YEAR_PRICE_ID', ''),
        ],
        'pro_month' => [
            'url' => env('HELM_STRIPE_PRO_MONTH_URL', ''),
            'link_id' => env('HELM_STRIPE_PRO_MONTH_LINK_ID', ''),
            'price_id' => env('HELM_STRIPE_PRO_MONTH_PRICE_ID', ''),
        ],
        'pro_year' => [
            'url' => env('HELM_STRIPE_PRO_YEAR_URL', ''),
            'link_id' => env('HELM_STRIPE_PRO_YEAR_LINK_ID', ''),
            'price_id' => env('HELM_STRIPE_PRO_YEAR_PRICE_ID', ''),
        ],
    ],
];
