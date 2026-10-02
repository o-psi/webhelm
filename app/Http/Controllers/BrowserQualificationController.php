<?php

namespace App\Http\Controllers;

use App\Models\VesselConnection;
use App\Services\{BrowserQualificationMailbox, ConsoleAccess, VesselGateway};
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Contracts\View\View;

class BrowserQualificationController extends Controller
{
    /** @return array{0:array<string,mixed>,1:VesselConnection,2:array<string,mixed>} */
    private function admitted(Request $request, string $job, BrowserQualificationMailbox $mailbox, VesselGateway $gateway): array
    {
        abort_unless($mailbox->enabled($job), 404);
        abort_unless(ConsoleAccess::authenticated($request), 401);
        try {
            $binding = $mailbox->binding($job);
        } catch (\Throwable) {
            abort(502, 'Fixture coordination unavailable.');
        }
        abort_unless(($binding['tenant_id'] ?? '') === $request->user()->tenant_id, 404);
        $connection = VesselConnection::where('tenant_id', $request->user()->tenant_id)->findOrFail($binding['connection_id'] ?? '');
        abort_unless(ConsoleAccess::pinnedOperator($request, $connection), 401);
        abort_unless($connection->revision === ($binding['connection_revision'] ?? null)
            && $connection->vessel_id === ($binding['vessel_id'] ?? null)
            && $request->user()->tenant->principal_id === ($binding['principal_id'] ?? null), 409);
        $credential = $connection->credential;
        try {
            $caps = $gateway->call('probe', ['connection' => [
                'url' => preg_replace('/^https:/', 'wss:', VesselGateway::endpoint($connection->endpoint)).'/v1/vessel/socket',
                'token' => $credential['token'], 'grant_id' => $credential['grant_id'], 'vessel_id' => $connection->vessel_id,
            ]]);
        } catch (\Throwable) {
            abort(502, 'Vessel owner could not be verified.');
        }
        abort_unless(($caps['scope'] ?? '') === 'owner' && ConsoleAccess::pinnedOperator($request, $connection), 403);
        return [$binding, $connection, array_intersect_key($binding, array_flip([
            'tenant_id', 'connection_id', 'connection_revision', 'principal_id', 'vessel_id',
        ]))];
    }

    /** @return array<string,mixed> */
    private function exchange(BrowserQualificationMailbox $mailbox, array $message): array
    {
        try {
            return $mailbox->exchange($message);
        } catch (\Throwable) {
            abort(502, 'Fixture response refused or unconfirmed.');
        }
    }

    /** @return array<string,mixed> */
    private function responseBody(string $raw): array
    {
        try {
            $data = json_decode($raw, true, flags: JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            abort(422, 'Malformed fixture response.');
        }
        // json_decode alone discards duplicate object fields. Observe key tokens
        // only after its grammar check, so an ambiguous receipt is refused.
        preg_match_all('/"(?:\\\\.|[^"\\\\])*"|[{}\[\]:,]/s', $raw, $matches);
        $stack = [];
        foreach ($matches[0] as $index => $token) {
            if ($token === '{' || $token === '[') {
                $stack[] = $token === '{' ? [] : null;
            } elseif ($token === '}' || $token === ']') {
                array_pop($stack);
            } elseif (str_starts_with($token, '"') && ($matches[0][$index + 1] ?? '') === ':') {
                $key = json_decode($token, true, flags: JSON_THROW_ON_ERROR);
                $last = array_key_last($stack);
                abort_unless($last !== null && is_array($stack[$last]) && !array_key_exists($key, $stack[$last]), 422);
                $stack[$last][$key] = true;
            }
        }
        abort_unless(is_array($data) && array_keys($data) === ['response'] && is_array($data['response']), 422);
        return $data;
    }

    public function show(Request $request, string $job, BrowserQualificationMailbox $mailbox, VesselGateway $gateway): View
    {
        [$binding] = $this->admitted($request, $job, $mailbox, $gateway);
        return view('console.browser-qualification', ['job' => $job, 'expires' => $binding['expires_at']]);
    }

    public function peek(Request $request, string $job, BrowserQualificationMailbox $mailbox, VesselGateway $gateway): JsonResponse
    {
        [, $connection, $actor] = $this->admitted($request, $job, $mailbox, $gateway);
        $result = $this->exchange($mailbox, ['protocol' => 1, 'action' => 'peek', 'actor' => $actor]);
        abort_unless(ConsoleAccess::pinnedOperator($request, $connection), 401);
        return response()->json($result)->header('Cache-Control', 'no-store, private');
    }

    public function reply(Request $request, string $job, BrowserQualificationMailbox $mailbox, VesselGateway $gateway): JsonResponse
    {
        abort_unless(strlen($request->getContent()) <= 65536, 413);
        abort_unless($request->header('Origin') === VesselGateway::endpoint(config('app.url')), 403);
        $data = $this->responseBody($request->getContent());
        [, $connection, $actor] = $this->admitted($request, $job, $mailbox, $gateway);
        $prepared = $this->exchange($mailbox, ['protocol' => 1, 'action' => 'prepare', 'actor' => $actor, 'response' => $data['response']]);
        abort_unless(ConsoleAccess::pinnedOperator($request, $connection), 401);
        $result = $this->exchange($mailbox, ['protocol' => 1, 'action' => 'commit', 'actor' => $actor, 'ticket' => $prepared['ticket'] ?? '']);
        abort_unless(ConsoleAccess::pinnedOperator($request, $connection), 401);
        return response()->json(['accepted' => $result['accepted'] === true])->header('Cache-Control', 'no-store, private');
    }
}
