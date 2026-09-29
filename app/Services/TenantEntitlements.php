<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\VesselConnection;
use App\Models\VesselPairing;
use Illuminate\Support\Facades\DB;

final class TenantEntitlements
{
    public function __construct(private StripePaymentLinkBilling $billing)
    {
    }

    public function limit(Tenant $tenant): int
    {
        return $this->billing->enabled() ? $tenant->effectivePlan()->vesselLimit() : 64;
    }

    /** @return list<string> */
    public function retainedConnectionIds(Tenant $tenant): array
    {
        return VesselConnection::where('tenant_id', $tenant->id)
            ->orderByDesc('retention_priority')
            ->orderBy('created_at')
            ->orderBy('id')
            ->limit($this->limit($tenant))
            ->pluck('id')->all();
    }

    public function permits(Tenant $tenant, VesselConnection $connection): bool
    {
        return $connection->tenant_id === $tenant->id
            && in_array($connection->id, $this->retainedConnectionIds($tenant), true);
    }

    public function disconnectExcess(Tenant $tenant): int
    {
        if (!$this->billing->enabled()) {
            return 0;
        }
        return DB::transaction(function () use ($tenant): int {
            $current = Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $retained = $this->retainedConnectionIds($current);
            return VesselConnection::where('tenant_id', $tenant->id)
                ->whereNotIn('id', $retained)->delete();
        });
    }

    public function canAdd(Tenant $tenant, string $vesselId): bool
    {
        if (VesselConnection::where('tenant_id', $tenant->id)->where('vessel_id', $vesselId)->exists()) {
            return true;
        }
        return $this->reservedSlots($tenant) < $this->limit($tenant);
    }

    public function reservePairing(Tenant $tenant, string $name, array $request): VesselPairing
    {
        return DB::transaction(function () use ($tenant, $name, $request): VesselPairing {
            $current = Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $this->expirePairings($current);
            $existing = VesselPairing::where('tenant_id', $tenant->id)
                ->where('vessel_id', $request['vessel_id'])->where('status', 'pending')->first();
            abort_if($existing !== null, 409, 'A pairing for this Vessel is already pending.');
            abort_unless($this->canAdd($current, $request['vessel_id']), 422, 'Connection limit reached.');
            abort_if(VesselPairing::where('tenant_id', $tenant->id)->where('status', 'pending')->count() >= 16, 422);
            return VesselPairing::create([
                'tenant_id' => $tenant->id, 'vessel_id' => $request['vessel_id'],
                'name' => $name, 'request' => $request,
            ]);
        });
    }

    public function saveConnection(Tenant $tenant, string $name, string $endpoint, array $credential, ?VesselPairing $pairing = null): void
    {
        DB::transaction(function () use ($tenant, $name, $endpoint, $credential, $pairing): void {
            $current = Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $this->expirePairings($current);
            $existing = VesselConnection::where('tenant_id', $tenant->id)
                ->where('vessel_id', $credential['vessel_id'])->first();
            if ($existing) {
                $existing->update(['name' => $name, 'endpoint' => $endpoint,
                    'credential' => $credential, 'revision' => $existing->revision + 1]);
            } else {
                $reserved = $this->reservedSlots($current);
                $ownsReservation = $pairing !== null && $pairing->tenant_id === $tenant->id
                    && $pairing->vessel_id === $credential['vessel_id']
                    && VesselPairing::whereKey($pairing->id)->where('status', 'pending')->exists();
                abort_unless($ownsReservation
                    ? $reserved <= $this->limit($current)
                    : $reserved < $this->limit($current), 422, 'Connection limit reached.');
                VesselConnection::create([
                    'tenant_id' => $tenant->id, 'name' => $name, 'endpoint' => $endpoint,
                    'vessel_id' => $credential['vessel_id'], 'credential' => $credential,
                ]);
            }
            $pairing?->delete();
        });
    }

    /** @param list<string> $ids */
    public function setRetentionOrder(Tenant $tenant, array $ids): void
    {
        DB::transaction(function () use ($tenant, $ids): void {
            Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $saved = VesselConnection::where('tenant_id', $tenant->id)->pluck('id')->all();
            $submitted = $ids;
            sort($saved);
            sort($submitted);
            abort_unless($saved === $submitted, 422, 'Refresh your Vessel list before changing its order.');
            foreach ($ids as $position => $id) {
                VesselConnection::where('tenant_id', $tenant->id)->whereKey($id)
                    ->update(['retention_priority' => count($ids) - $position]);
            }
        });
    }

    private function reservedSlots(Tenant $tenant): int
    {
        $connected = VesselConnection::where('tenant_id', $tenant->id);
        $pending = VesselPairing::where('tenant_id', $tenant->id)->where('status', 'pending')
            ->where('created_at', '>=', now()->subMinutes(10))
            ->whereNotIn('vessel_id', $connected->select('vessel_id'))
            ->count();
        return VesselConnection::where('tenant_id', $tenant->id)->count() + $pending;
    }

    private function expirePairings(Tenant $tenant): void
    {
        VesselPairing::where('tenant_id', $tenant->id)->where('status', 'pending')
            ->where('created_at', '<', now()->subMinutes(10))->delete();
    }
}
