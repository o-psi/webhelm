<?php

namespace App\Services;

use App\Attention\AttentionPolicy;
use App\Models\Tenant;
use Illuminate\Support\Facades\DB;

final class AttentionPolicyStore
{
    public function read(string $tenant): array
    {
        $row = DB::table('attention_policies')->where('tenant_id', $tenant)->first();
        $policy = $row?->stale_policy ?? AttentionPolicy::DEFAULT_POLICY;
        return ['stale_policy' => $policy, 'revision' => (int) ($row?->revision ?? 0),
            'eligibility' => AttentionPolicy::eligibility($policy)];
    }

    public function receipt(string $tenant, string $operation): ?array
    {
        $row = DB::table('attention_policy_receipts')->where('tenant_id', $tenant)
            ->where('operation_id', $operation)->first();
        return $row ? ['status' => (int) $row->status, 'body' => json_decode($row->response, true, flags: JSON_THROW_ON_ERROR)] : null;
    }

    /** Tenant-row serialization covers CAS, receipt quota and duplicate operations together. */
    public function change(string $tenant, string $operation, array $payload): array
    {
        $hash = hash('sha256', json_encode(['schema' => 1, 'expected_revision' => $payload['expected_revision'] ?? null,
            'stale_policy' => $payload['stale_policy'] ?? null], JSON_THROW_ON_ERROR));
        return DB::transaction(function () use ($tenant, $operation, $payload, $hash): array {
            // SQLite uses a write before read to acquire its writer lock; other drivers
            // also serialize against this existing tenant row, never a missing policy row.
            if (DB::connection()->getDriverName() === 'sqlite') {
                DB::table('tenants')->where('id', $tenant)->update(['id' => $tenant]);
            }
            Tenant::whereKey($tenant)->lockForUpdate()->firstOrFail();
            $existing = DB::table('attention_policy_receipts')->where('tenant_id', $tenant)
                ->where('operation_id', $operation)->first();
            if ($existing) {
                if (!hash_equals($existing->request_hash, $hash)) {
                    return ['status' => 409, 'body' => ['error' => 'operation_identity_conflict']];
                }
                return ['status' => (int) $existing->status, 'body' => json_decode($existing->response, true, flags: JSON_THROW_ON_ERROR)];
            }
            if (DB::table('attention_policy_receipts')->where('tenant_id', $tenant)->count() >= AttentionPolicy::MAX_RECEIPTS) {
                return ['status' => 507, 'body' => ['error' => 'receipt_capacity_reached', 'retry_with_new_identity' => false]];
            }
            $current = $this->read($tenant);
            if (!is_int($payload['expected_revision'] ?? null) || $payload['expected_revision'] < 0 || $payload['expected_revision'] > 1000000000
                || !in_array($payload['stale_policy'] ?? null, AttentionPolicy::POLICIES, true)) {
                $result = ['status' => 422, 'body' => ['error' => 'invalid_policy_request']];
            } elseif ($payload['expected_revision'] !== $current['revision']) {
                $result = ['status' => 409, 'body' => ['error' => 'revision_conflict', 'current' => $current]];
            } else {
                DB::table('attention_policies')->updateOrInsert(['tenant_id' => $tenant],
                    ['stale_policy' => $payload['stale_policy'], 'revision' => $current['revision'] + 1]);
                $result = ['status' => 200, 'body' => $this->read($tenant)];
            }
            $result['body']['operation_id'] = $operation;
            DB::table('attention_policy_receipts')->insert(['tenant_id' => $tenant, 'operation_id' => $operation,
                'request_hash' => $hash, 'status' => $result['status'],
                'response' => json_encode($result['body'], JSON_THROW_ON_ERROR), 'recorded_at' => now()]);
            return $result;
        });
    }
}
