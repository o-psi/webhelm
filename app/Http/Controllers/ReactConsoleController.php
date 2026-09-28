<?php

namespace App\Http\Controllers;

use App\Models\VesselConnection;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class ReactConsoleController extends Controller
{
    public function redirect(Request $request): \Illuminate\Http\RedirectResponse
    {
        return redirect()->route('console', $request->boolean('manage-vessels') ? ['manage-vessels' => 1] : []);
    }

    public function __invoke(Request $request): View
    {
        return view('console.react', [
            'bootstrap' => [
                'connectionStatus' => $request->session()->get('status'),
                'connectionForm' => $request->session()->get('vessel_form'),
                'connectionError' => $request->session()->has('errors') ? 'Connection not confirmed. Check your saved Vessels before trying a new invitation.' : null,
                'tenantId' => $request->user()->tenant_id,
                'principalId' => $request->user()->tenant->principal_id,
                'vessels' => VesselConnection::where('tenant_id', $request->user()->tenant_id)
                    ->get(['id', 'name', 'vessel_id', 'endpoint'])->toArray(),
                'ticketUrl' => route('console.ticket', absolute: false),
                'connectionsUrl' => route('connections', absolute: false),
                'logoutUrl' => route('console.logout', absolute: false),
            ],
        ]);
    }
}
