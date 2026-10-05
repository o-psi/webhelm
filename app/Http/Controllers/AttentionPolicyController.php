<?php

namespace App\Http\Controllers;

use App\Attention\AttentionPolicy;
use App\Services\AttentionPolicyStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

final class AttentionPolicyController extends Controller
{
    private function tenant(Request $request): string
    {
        abort_unless($request->user()?->tenant_id, 403);
        return $request->user()->tenant_id;
    }

    private function response(array $body, int $status = 200): JsonResponse
    {
        return response()->json($body, $status)->header('Cache-Control', 'no-store, private');
    }

    public function show(Request $request, AttentionPolicyStore $store): JsonResponse
    {
        return $this->response($store->read($this->tenant($request)));
    }

    public function update(Request $request, AttentionPolicyStore $store): JsonResponse
    {
        $tenant = $this->tenant($request);
        if (strlen($request->getContent()) > AttentionPolicy::MAX_BODY_BYTES) {
            return $this->response(['error' => 'request_too_large'], 413);
        }
        try {
            $payload = json_decode($request->getContent(), true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $this->response(['error' => 'invalid_json'], 422);
        }
        if (!is_array($payload) || array_is_list($payload)
            || array_diff(array_keys($payload), ['operation_id', 'expected_revision', 'stale_policy'])
            || !Str::isUuid($payload['operation_id'] ?? null)) {
            return $this->response(['error' => 'invalid_request_envelope'], 422);
        }
        // Only bounded scalar policy inputs reach durable hashing; malformed
        // envelopes have no admitted operation identity and cannot be replayed.
        if (isset($payload['stale_policy']) && (!is_string($payload['stale_policy']) || strlen($payload['stale_policy']) > 32)
            || isset($payload['expected_revision']) && !is_int($payload['expected_revision'])) {
            return $this->response(['error' => 'invalid_request_envelope'], 422);
        }
        $result = $store->change($tenant, strtolower($payload['operation_id']), $payload);
        return $this->response($result['body'], $result['status']);
    }

    public function receipt(Request $request, AttentionPolicyStore $store, string $operation): JsonResponse
    {
        $result = $store->receipt($this->tenant($request), strtolower($operation));
        // Not found is not proof of effect failure and never instructs a new ID retry.
        return $this->response($result ?? ['error' => 'receipt_not_found', 'outcome' => 'unknown',
            'retry_with_new_identity' => false], $result ? 200 : 404);
    }
}
