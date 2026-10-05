<?php
use App\Livewire\Landing;
use App\Http\Controllers\{BillingCheckoutController,ConsoleAuthController,OAuthController,StripeWebhookController,VesselConnectionController,GatewayController};
use App\Http\Middleware\{ConsoleHeaders,ConsoleOperator};
use Illuminate\Support\Facades\Route;
Route::get('/landing', Landing::class)->name('home');
Route::view('/helm','products.helm')->name('products.helm');
Route::view('/vessel','products.vessel')->name('products.vessel');
Route::view('/voyage','products.voyage')->name('products.voyage');
Route::post('/console/gateway/authorize',[GatewayController::class,'authorizeTicket'])->withoutMiddleware([
    \Illuminate\Foundation\Http\Middleware\PreventRequestForgery::class,
    \Illuminate\Session\Middleware\StartSession::class,
    \Illuminate\View\Middleware\ShareErrorsFromSession::class,
]);
Route::post('/billing/stripe/webhook', StripeWebhookController::class)->withoutMiddleware([
    \Illuminate\Foundation\Http\Middleware\PreventRequestForgery::class,
    \Illuminate\Session\Middleware\StartSession::class,
    \Illuminate\View\Middleware\ShareErrorsFromSession::class,
])->middleware('throttle:60,1');
Route::middleware(ConsoleHeaders::class)->group(function () {
    Route::view('/console/login','console.login')->name('console.login');
    Route::get('/auth/{provider}',[OAuthController::class,'redirect'])->name('oauth.redirect')->middleware('throttle:20,1');
    Route::get('/auth/{provider}/callback',[OAuthController::class,'callback'])->name('oauth.callback')->middleware('throttle:20,1');
    Route::post('/console/logout',[ConsoleAuthController::class,'logout'])->name('console.logout');
});
Route::middleware([ConsoleOperator::class,ConsoleHeaders::class])->group(function () {
    Route::get('/react', [\App\Http\Controllers\ReactConsoleController::class, 'redirect'])->name('console.react');
    Route::get('/', \App\Http\Controllers\ReactConsoleController::class)->name('console');
    Route::get('/voyages/{vessel}/{session}', \App\Http\Controllers\ReactConsoleController::class)
        ->whereUuid('vessel')->whereUuid('session')->name('console.voyage');
    Route::post('/console/ticket',[ConsoleAuthController::class,'ticket'])->name('console.ticket')->middleware('throttle:console-tickets');
    Route::get('/console/qualification/browser/{job}', [\App\Http\Controllers\BrowserQualificationController::class, 'show'])
        ->whereUuid('job')->name('qualification.browser');
    Route::get('/console/qualification/browser/{job}/request', [\App\Http\Controllers\BrowserQualificationController::class, 'peek'])
        ->whereUuid('job')->name('qualification.browser.request')->middleware('throttle:60,1');
    Route::post('/console/qualification/browser/{job}/response', [\App\Http\Controllers\BrowserQualificationController::class, 'reply'])
        ->whereUuid('job')->name('qualification.browser.response')->middleware('throttle:60,1');
    Route::post('/billing/checkout', BillingCheckoutController::class)->name('billing.checkout')->middleware('throttle:10,1');
    Route::get('/console/attention-policy', [\App\Http\Controllers\AttentionPolicyController::class, 'show'])->name('attention-policy.show');
    Route::patch('/console/attention-policy', [\App\Http\Controllers\AttentionPolicyController::class, 'update'])->name('attention-policy.update')->middleware('throttle:30,1');
    Route::get('/console/attention-policy/receipts/{operation}', [\App\Http\Controllers\AttentionPolicyController::class, 'receipt'])->whereUuid('operation')->name('attention-policy.receipt')->middleware('throttle:60,1');
    Route::get('/connections',[VesselConnectionController::class,'index'])->name('connections');
    Route::post('/connections',[VesselConnectionController::class,'store'])->name('connections.store')->middleware('throttle:10,1');
    Route::post('/connections/pair',[VesselConnectionController::class,'pair'])->name('connections.pair')->middleware('throttle:10,1');
    Route::post('/connections/retention',[VesselConnectionController::class,'retention'])->name('connections.retention')->middleware('throttle:10,1');
    Route::delete('/connections/{id}',[VesselConnectionController::class,'destroy'])->name('connections.destroy');
});
