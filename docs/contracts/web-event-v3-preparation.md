# Web #6: isolated contract preparation (not cutover)

Web inventory baseline: `1ccd387c22be884967d6c3f30a9a64c7133aee5a`.
Public Core draft PR #429: `ce31fce5f1027b06a416d444eda91e9eba023bd2`.
Definitions: [event_connection.rs](https://github.com/o-psi/helm.vessel.voyage/blob/ce31fce5f1027b06a416d444eda91e9eba023bd2/crates/voyage-protocol/src/event_connection.rs), [vessel.rs](https://github.com/o-psi/helm.vessel.voyage/blob/ce31fce5f1027b06a416d444eda91e9eba023bd2/crates/voyage-protocol/src/vessel.rs), and [release contract](https://github.com/o-psi/helm.vessel.voyage/blob/ce31fce5f1027b06a416d444eda91e9eba023bd2/docs/event-only-v1.1.0.md).

## Boundary

No production imports, gateway admission, dependencies, fallback removal or authority changes. Entity families below are routing targets from the public enum, NOT defined payload schemas. Source existence, offline fixture integrity, owner conformance, live transport traces and deployment are separate evidence classes. This document and vectors do not complete #6. A version3 constant does not imply protocol1 duplex frames can be relabeled version3.

## Production interaction coverage / proposed ownership

Every row requires a zero-legacy-call trace in an **admitted future v3 journey**, retaining the existing supported-peer path until coordinated cutover. Authentication/ticket renewal is Web-local transport establishment, not an entity hydration substitute. Gateway allowlist-only operations are not evidence of a rendered panel.

| Owner / production entry point | Current calls or fallback | Typed family target (payload unresolved unless noted) | Removal / preservation assertion |
|---|---|---|---|
| Transport: `vessel-client.js`, `gateway/protocol.js`, fleet connection | protocol1 command/reply, public-v2 subscribe, public-v1 compatibility; capabilities projection | Admission / CommandOutcome / Notification | No version guessing, downgrade after uncertainty or mutation before owner admission + barrier; correlation ID never replaces command ID. |
| Fleet: `vessel-fleet.js` | capabilities, catalogue, catalogue_changes; timed fallback catalogue reads | Catalogue / Lifecycle | Initial scoped catalogue barrier then ordered replay; no fallback catalogue refresh; sparse authorized cursors valid; owner/revocation fences. |
| Conversation: `workspace.ts`, `conversation-stream.js` | snapshot bootstrap, decisions, capabilities; refresh on unsupported events/errors; degraded snapshot recovery and freshness timers | Session / Run / Message / Decision / Tool / Reasoning / Resource | No snapshot/public-v1/refresh recovery; generation staged until exact completion; no previews becoming executable calls. |
| Composer / conversation commands: `workspace.ts`, `Decisions.tsx` | submit, submit_content, steer, cancel, respond, rename, set_access; upload_image; receipt reconciliation | CommandOutcome / Decision / Artifact | Exact durable identities survive timeout/reconnect; never replay uncertain effects; no snapshot pre-submit fence; separate Decide authorization. |
| History/export: `workspace.ts`, `sidebar-actions.js` | history, message_chunk, run_output; paged export; snapshot action review | Message / Run / Lifecycle | Bounded selected history/content, stable message indices and UTF-8 offsets; no monolithic history disguised as event; no snapshot for export/control authority. |
| Sidebar lifecycle: `sidebar-actions.js` | inspect, snapshot, history, rename/archive/clear/delete/compact/branch/restart; receipt and process reconciliation | Lifecycle / Session / CommandOutcome | Scope + incarnation + revision verified; exact branch/restart semantics and receipt reconciliation, no hidden refresh or external-effect replay. |
| Tools/files: `ComposerDiscovery.tsx`, `WorkspaceFiles.tsx`, workspace helpers | controls tools/skills/files, workspace_changes, workspace_file | Tool / Workspace / Resource | Scoped bounded discovery and preview results; preserve workspace_read authority and path limits; no snapshot freshness substituted for event barrier. |
| Goals: React goal panels / workspace read-action adapter | goal_read, goal_update, goal_reconcile | Goal / Usage / Resource / CommandOutcome | Bounded child reconciliation, budget and retained obligations preserved; no guessed goal entity body or automatic child continuation. |
| Setup/settings: `Settings.tsx`, `settings.ts` | capabilities, inspect, profiles, accounts, account_models, account_usage(refresh true); save_profile/delete_profile/set_default_profile; account_defaults; set_account_inference | Settings / Account / Usage / CommandOutcome | Exact account generation/revisions, settings scope and durable outcomes; usage refresh is an effect, not retryable hydration; model discovery denial preserved. |
| Creation: `settings.ts`, `new-voyage-delivery.ts` | start_account / resolve_start_account; stored creation intent; initial submission | Session / Settings / Account / CommandOutcome | Start and initial submission identities stay separate; receipt-only reconciliation, no snapshot after creation or blind resend. |
| Enrollment: `account-enrollment.js` | accounts, capabilities, enroll_account, private_account_enrollment, resolve_account_enrollment, cancel_account_enrollment | Account / CommandOutcome | Private enrollment stays private, no credentials/input in public entities; terminal enrollment state not inferred from transport status. |
| Execution: `ExecutionPanel.tsx` | execution inventory/status/review/prepare/prepare_transition/reconcile_transition/approve/control(cancel or revoke) | Settings / Resource / CommandOutcome | Pinned identity/review/digest/approval and executing-owner authority retained; independent correlated outcomes, no repeat on uncertainty. |
| Browser: `host-browser.js`, shared browser bridge | snapshot owner/revision reads, host_browser operation; bounded DOM/media mirror stream | Browser / Resource / CommandOutcome | Event-derived canonical fences replace session snapshot; DOM snapshots are separate, not removed; private-frame/input boundaries remain. |
| Update: `vessel-update.js` | update_status, update_prepare, update_apply, update_discard, refresh/status timers | Update / CommandOutcome | Pinned review + independent updater readiness and bounded progress; no status polling, no effect replay. |
| Artifacts: `attachments.js`, image upload helper | read_artifact chunks, upload_image | Artifact / CommandOutcome | Authorized bounded transfer and authentic content IDs; no inline unbounded replacement. |
| Terminal | No host-terminal production caller found under current resources/js or resources/react; enum alone is not a panel | Terminal / Resource | Owner lifecycle/output/private-input definitions and actual caller journey required before coverage claim. |

Audit method: read production `request`, `exchange`, `subscribe`, workspace read/action and dynamic settings/sidebar/update dispatch; cross-check gateway explicit whitelist, not only literal calls. Local storage drafts/journal, Laravel saved-Vessel/ticket endpoints and UI repaint timers are not retired session observation routes. Capability enum names alone do not qualify a replacement. All rows above remain migration obligations, not passing claims.

## Concrete pinned vectors

`tests/fixtures/event-v3/vectors.json` contains explicit Rust-derived oracle inputs/expected boundaries, with exact source hash. `tests/preparation/event-v3-vectors.test.mjs` checks fixture provenance/coverage integrity ONLY; it does not duplicate the Rust reducer or assert Web conformance. Neither file is imported from production or added to default test scripts. Supervisor may run the explicit lightweight command:

```
node --test --test-concurrency=1 tests/preparation/event-v3-vectors.test.mjs
```

Version3 public definitions support: exact generation/session/incarnation equality, begin/complete cursor equality, exact sequence, publication only after completion, reset reasons retention_gap/incarnation_changed/initialization_expired/slow_consumer, and byte-offset chunks (32 KiB per chunk/entity, 8 MiB aggregate initialization). Repeated completion is rejected by the gate; exact-frame deduplication explicitly belongs to transport. No replay-idempotency guarantee is invented. Unknown envelope fields are rejected by serde. The synthetic private_input exclusion vector establishes envelope schema rejection ONLY: opaque entity values are JSON and require independent authorized projection; it cannot establish privacy or prohibit all secret-bearing payloads.

No entity values are fabricated. The empty selected scope exercises the public fence without inventing non-chat payloads. Chunk tests cover multibyte text, final empty chunk, offset gap and extent mismatch. Bounds for aggregate history are recorded, not claimed repaired by the vectors.

## Unresolved owner/client gates

1. Core atomic decision + cursor initialization, all-history aggregate overflow, active-output multi-page invalidation and omitted recovery/turn metadata are unresolved findings in PR429. Client must not repair these by guessing snapshot state or advancing a cursor.
2. Public initialize_entities/initialize_decisions/replay_entities operations exist; frozen selected scopes/history continuation and atomic cross-stream barrier semantics are not qualified by this preparation.
3. The entity-kind enum covers non-chat families but complete stable payloads, authorized producers/change ordering and revocation coverage are still required.
4. Staged CommandEnvelope ControlOperation currently defines cancel, rename, set_access only; full Web durable admission/outcome mapping remains incomplete. Existing wire operations are not automatically new typed command envelopes.
5. Version3 is explicitly staged/not advertised. Owner + gateway + TUI/Web negotiation, incompatible-peer upgrade handling, command fencing and all-surface live replay must be verified before legacy removal.

Checkpoint proposal: review this manifest and pinned offline vectors; allocate separate ownership for transport/gateway, session/history, catalogue/sidebar, settings/accounts/creation, and browser/update/execution. Refresh pins after Core repairs, add conformance adapters only against settled public definitions, and preserve supported-peer production behavior meanwhile. Owner/gateway readiness precedes any v3-only Web publication; final #6 requires exact integrated tested commits, zero-legacy transport/browser journeys and deployed version evidence. No build, live conformance or deployment is asserted here.
