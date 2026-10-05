# Tenant attention policy storage (partial #18)

This slice stores preferences only. Initial `three_days`, `seven_days` and `off`
are supported. Configured policy is separate from its effect: non-off policies
report `unavailable` without authoritative work/obligation facts; off reports
`disabled`. No automatic settlement, UI configuration, per-voyage enumeration,
PR observation, execution/archive/approval, composer or owner-command change exists.
#18 and #39 remain open.

Authenticated web-session routes (standard CSRF protection applies to PATCH):
- GET `/console/attention-policy`: current preference/revision/eligibility.
- PATCH same path: JSON `operation_id` UUID, integer `expected_revision`,
  `stale_policy`. No other fields. Body <=4096 bytes, policy text <=32 bytes.
- GET `/console/attention-policy/receipts/{operation}`: tenant-local exact stored
  status/body. Cold lookup after timeout does not submit anything. 404 means
  unknown, not safe to retry with a new operation identity.

Responses are no-store/private. Identity comes solely from authenticated tenant;
there are no client tenant/Vessel/session selectors or private titles. Policy is
lazy-created on first successful CAS; initial revision is zero. Tenant-row locking
serializes SQLite writers and other SQL clients before reading CAS/receipts.
A successful write increments revision even for the same chosen value.

Canonical SHA-256 hashes schema version, expected revision and policy in fixed
field order (not JSON input key order). Same operation/hash returns original exact
result, including persisted 409 revision conflicts and 422 invalid policy failures.
Same operation/different hash returns 409 without replacing original evidence.
Malformed/oversized/unauthenticated envelopes are not admitted operations. Database
errors roll back both preference and receipt: after uncertain transport/database
failure, read the original receipt and current state; never invent a new-ID retry.

Maximum 10000 receipts per tenant. No TTL, deletion, eviction or silent pruning.
Capacity exhaustion refuses new operation admission with 507; existing receipts
remain queryable/replayable. No lists/batches/pagination are exposed in this slice;
only singleton policy and exact receipt lookup. Rate limits PATCH30/min, receipt
GET60/min. Receipts retain at most bounded scalar request hash and small policy
response, not transcripts. Data-preserving rollback is mandatory.

Offline checks: `php tests/attention-policy.php` with installed repository vendor
and SQLite. Tests isolate config/routes/services caches, storage/views/logs, fake key and file-backed SQLite before bootstrap, assert selected paths before schema writes, and clean only their owned temporary root. Fork races use independent connections and ready/start barriers with bounded owned-child termination. Routed session/CSRF/auth/logout and cold receipt checks do not use OAuth or providers. Capacity is seeded in bounded batches.
Supervisor must execute the bounded routed/race checks before integration; test source alone is not passing proof.
Production migrations/publication are supervisor-owned. No dependencies added.

Fixture failure handling: top-level Throwable exits 1 with a fixed safe error category;
routed GET reports only numeric status. Sessions are saved through the configured
Laravel driver and Auth::login (selected serialization), not manually encoded.
APP_ENV is local before bootstrap; runningUnitTests is asserted false so real
CSRF enforcement cannot be bypassed by fixture mode. Prior 79a671a runtime failed
at routed GET and is not qualification evidence.

## On-demand Inbox settings (frontend qualification pending)

WebSettings now exposes an Inbox page, receiving tenantId from its existing
account bootstrap prop; no App/RequestContext or composer changes. Invalid/missing
tenant identity fails closed. Three/seven/off selection is explicit Save only,
with configured preference separate from unavailable/disabled effect.

HTTP intents retain only bounded tenant/UUID/revision/choice/prepared metadata,
in separate per-operation keys. Retention precedes PATCH. One outstanding record
blocks another save; races across tabs can create separate records which each
require exact server CAS/receipt reconciliation. At most eight retained records
are inspected; excess/corrupt/unavailable storage blocks writes without eviction.
Timeout, close, abort, reload and expired login never automatically resend PATCH.
Cold receipt GET unwraps {status,body}; 404 remains unknown and blocks new semantic
retry. Confirmed outcomes clear only identical metadata, not a newer intent.
Journal keys are tenant-scoped, contain no auth/session/composer/private titles,
and survive logout for same-tenant reauthentication receipt reads. 401/403 fences
that client against further reads/writes; late generation responses are ignored.
Dialog cleanup aborts requests but preserves intent. Reads have an eight-second
bound and 8192-byte response cap. No new dependency or provider operation.

Focused frontend source tests: tests/react-attention-policy.test.ts. These are
not execution evidence until supervisor runs bounded focused/full/type/build and
actual Settings render qualification. Full #18/#39 acceptance remains incomplete.

The settings HTTP client binds every read, write and receipt lookup to its validated
bootstrap tenant through `X-Helm-Expected-Tenant`. The server refuses a mismatch
with the authenticated tenant before accessing policy storage. This expectation
is not authority and never selects a tenant; it prevents an old tab from applying
retained intent under an account changed in another window. Foreign-scope intents
are refused before sending. Direct authenticated API callers without a scope hint
remain confined to their current tenant.
