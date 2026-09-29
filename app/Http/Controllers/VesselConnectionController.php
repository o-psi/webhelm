<?php
namespace App\Http\Controllers;
use App\Models\VesselConnection;
use App\Models\VesselPairing;
use App\Services\VesselGateway;
use App\Services\TenantEntitlements;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Symfony\Component\HttpKernel\Exception\HttpException;
class VesselConnectionController extends Controller {
    private function consoleRedirect(Request $request): \Illuminate\Http\RedirectResponse {
        return redirect()->route('console', ['manage-vessels' => 1]);
    }
    public function index(Request $request) {
        return $this->consoleRedirect($request);
    }
    public function store(Request $request, VesselGateway $gateway, TenantEntitlements $entitlements) {
        $request->session()->flash('vessel_form', 'import');
        $request->session()->flash('manage_vessels', true);
        $data = $request->validate(['name' => ['required','string','max:100'], 'credential' => ['required','string','max:16384']]);
        try {
            $credential = json_decode($data['credential'], true, flags: JSON_THROW_ON_ERROR);
            $this->save($request, $gateway, $entitlements, $data['name'], $credential);
        } catch (HttpException $error) {
            if ($error->getStatusCode() === 422 && $error->getMessage() === 'Connection limit reached.') {
                return $this->consoleRedirect($request)->withErrors(['connection' => $error->getMessage()]);
            }
            return $this->consoleRedirect($request)->withErrors(['connection' => 'Unable to add this Vessel. Check the web address and connection credential.']);
        } catch (\Throwable) { return $this->consoleRedirect($request)->withErrors(['connection' => 'Unable to add this Vessel. Check the web address and connection credential.']); }
        return $this->consoleRedirect($request)->with('status', 'Vessel connected.');
    }
    private function save(Request $request, VesselGateway $gateway, TenantEntitlements $entitlements, string $name, array $credential, ?VesselPairing $pairing = null): void {
        $endpoint = VesselGateway::endpoint($credential['endpoint'] ?? '');
        foreach (['grant_id','vessel_id'] as $key) abort_unless(Str::isUuid($credential[$key] ?? ''), 422);
        abort_unless(is_string($credential['token'] ?? null) && preg_match('/^[a-f0-9]{64}$/Di', $credential['token']), 422);
        $entitlements->disconnectExcess($request->user()->tenant);
        if ($pairing === null) {
            abort_unless($entitlements->canAdd($request->user()->tenant->fresh(), $credential['vessel_id']), 422, 'Connection limit reached.');
        }
        $probe = $gateway->call('probe', ['connection' => ['url' => preg_replace('/^https:/','wss:',$endpoint).'/v1/vessel/socket',
            'token' => $credential['token'], 'grant_id' => $credential['grant_id'], 'vessel_id' => $credential['vessel_id']]]);
        abort_unless(($probe['vessel_id'] ?? null) === $credential['vessel_id'], 422);
        $entitlements->saveConnection($request->user()->tenant->fresh(), $name, $endpoint, $credential, $pairing);
    }
    public function pair(Request $request, VesselGateway $gateway, TenantEntitlements $entitlements) {
        $request->session()->flash('vessel_form', 'pair');
        $request->session()->flash('manage_vessels', true);
        $data = $request->validate(['name'=>['required','string','max:100'], 'invitation'=>['required','string','max:16384']]);
        try {
            $invitation = json_decode($data['invitation'],true,flags:JSON_THROW_ON_ERROR);
            abort_unless(($invitation['principal_id'] ?? null) === $request->user()->tenant->principal_id,422);
            foreach (['invitation_id','vessel_id'] as $key) abort_unless(Str::isUuid($invitation[$key] ?? ''),422);
            abort_unless(is_string($invitation['code'] ?? null) && strlen($invitation['code']) <= 1024,422);
            abort_unless(($invitation['expires_at_ms'] ?? 0) > now()->getTimestampMs(),422);
            $payload = ['endpoint'=>VesselGateway::endpoint($invitation['endpoint'] ?? ''), 'principal_id'=>$invitation['principal_id'],
                'invitation_id'=>$invitation['invitation_id'], 'vessel_id'=>$invitation['vessel_id'], 'code'=>$invitation['code'], 'command_id'=>(string) Str::uuid()];
            $entitlements->disconnectExcess($request->user()->tenant);
            $pairing = $entitlements->reservePairing($request->user()->tenant->fresh(), $data['name'], $payload);
            return $this->completePair($request, $gateway, $entitlements, $pairing);
        } catch (HttpException $error) {
            if (in_array($error->getMessage(), ['Connection limit reached.', 'A pairing for this Vessel is already pending.'], true)) {
                return $this->consoleRedirect($request)->withErrors(['connection' => $error->getMessage()]);
            }
            return $this->consoleRedirect($request)->withErrors(['connection'=>'We couldn’t confirm this connection. Check your saved Vessels before trying a new invitation.']);
        } catch (\Throwable) { return $this->consoleRedirect($request)->withErrors(['connection'=>'We couldn’t confirm this connection. Check your saved Vessels before trying a new invitation.']); }
    }
    private function completePair(Request $request,VesselGateway $gateway,TenantEntitlements $entitlements,VesselPairing $pairing) {
        $response = $gateway->call('pair',$pairing->request);
        $credential = $response['result'] ?? $response;
        abort_unless(($credential['principal_id'] ?? null) === $request->user()->tenant->principal_id
            && ($credential['vessel_id'] ?? null) === $pairing->request['vessel_id']
            && ($credential['endpoint'] ?? null) === $pairing->request['endpoint'],422);
        $this->save($request,$gateway,$entitlements,$pairing->name,$credential,$pairing);
        return $this->consoleRedirect($request)->with('status','Vessel paired.');
    }
    public function destroy(Request $request,string $id) {
        $request->session()->flash('manage_vessels', true);
        $connection = VesselConnection::where('tenant_id',$request->user()->tenant_id)->findOrFail($id);
        $request->validate(['confirm_disconnect' => ['accepted']]);
        $connection->delete();
        return $this->consoleRedirect($request)->with('status','Connection removed. Existing direct Vessel credentials expire within 120 seconds; socket closure may take up to 3 additional seconds. Already admitted work is not cancelled. The underlying grant is preserved for other clients; revoke it on the Vessel if no longer needed.');
    }

    public function retention(Request $request, TenantEntitlements $entitlements): \Illuminate\Http\RedirectResponse {
        $request->session()->flash('manage_vessels', true);
        $validator = Validator::make($request->all(), ['vessels' => ['required', 'array', 'max:64'], 'vessels.*' => ['required', 'uuid', 'distinct']]);
        if ($validator->fails()) {
            return $this->consoleRedirect($request)->withErrors(['connection' => 'Refresh your Vessel list before changing its order.']);
        }
        $data = $validator->validated();
        try {
            $entitlements->setRetentionOrder($request->user()->tenant, $data['vessels']);
        } catch (HttpException $error) {
            if ($error->getStatusCode() !== 422) throw $error;
            return $this->consoleRedirect($request)->withErrors(['connection' => $error->getMessage()]);
        }
        return $this->consoleRedirect($request)->with('status', 'Vessel priority saved. Connections at the top stay first if your plan limit falls.');
    }
}
