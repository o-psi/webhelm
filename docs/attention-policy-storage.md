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
