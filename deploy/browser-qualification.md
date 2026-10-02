# Expiring browser qualification coordination

This is prepared source for issue [#333](https://github.com/o-psi/helm.vessel.voyage/issues/333).
It is disabled by default. Source preparation and offline contract tests do not
establish production TLS, Chromium sandbox compatibility, browser acceptance or
measured client cost. Those remain obligations of the maintained production
qualification driver in the core repository, `voyage/tests/host_browser_production.py`.

## Why this route exists

The host driver issues private, exact requests for observations from two actual
Helm Web fixture tabs. Host commands relayed through a separate operator chat can
take longer than a requested cost window. A third same-origin coordinator page
lets the current human operator submit locally reduced counts through normal
Web authentication and CSRF. It opens no Fleet/Vessel WebSocket, runs no host
commands and does not replace either measured React tab or either native viewer.
It makes no background HTTP requests. Read/submit outside measured windows.

GET `/console/qualification/browser/JOB_UUID` is the page; its normal GET
`/request` and CSRF-protected POST `/response` accept only an already registered
job. All routes retain the existing operator/header middleware and tenant,
current database session, saved connection revision, principal, Vessel and
entitlement checks. A normal HTTPS capabilities read must confirm owner scope;
this path never calls pairing, browser credential issuance, session creation,
update, execution or a provider. Current operator/connection checks repeat after
prepare and before commit. A concurrent revocation after the last check remains
a delivery race; expiry and exact original receipts bound it. No grant is minted.

## Actual users and authority

On CT106 the PHP-FPM **worker** is `www-data` UID33, while Vessel/gateway and the
ordinary native client run as `vessel` UID1000. The PHP master UID0 is not an
application worker. Do not configure a same-user mailbox shortcut.

* **Broker**, ordinary UID33: only a newly created private benign socket/key
  directory, a private Unix socket for PHP33 and a loopback-only TCP listener.
  At most 64 issued records and replies are held in memory for this job. It never
  sees or opens UID1000's original mailbox or production credentials.
* **Bridge**, ordinary UID1000: its own new job-only key file and the existing
  private mailbox of the owned qualification driver. It pins request descriptors,
  regular/private/single-link inodes, digest, expiry and directory identity. It
  alone publishes original responses with Linux `renameat2(RENAME_NOREPLACE)`,
  after revalidating the same issued inode/digest. It never reads UID33 files.
* The fixed loopback transfer is HMAC authenticated using a fresh 32-byte,
  job-only key. A one-time approved host setup provisions separate new private
  key files for the two users. The value never appears in argv, chat, stdout,
  logs, a shared group, an ACL or the browser. This key only authenticates
  benign benchmark metadata; it conveys no Vessel, user or execution authority.
  No persistent privileged helper/service or system identity changes are used.

Every accepted transfer has an exact job UUID, strict sequence and nonce, and a
request/response direction-specific MAC. Replay, truncation, duplicate JSON
fields, unknown schemas and unknown operations refuse. Invalid authenticated
operations consume their sequence. An ambiguous transfer stops the bridge; it
is not resubmitted. Both wall and monotonic lifetimes are at most 600 seconds.
Malformed/refused errors are fixed categories, without submitted input.

Only operation enums, the two predeclared benign labels, at most four predeclared
site-label IDs, bounded expected counter values (0..2), fixed condition/index,
10-second window timing, issued UUID/digest, and whitelisted booleans/numeric
counts cross the transfer. Original URLs, selectors, title, frame payloads,
input text, arbitrary strings, paths, commands, credentials and grants do not.
The operator must already know the two fixture Voyages and approved site list
from the private qualification setup. Unknown/unavailable/truncated metrics and
false observations remain such; they cannot make the driver's acceptance pass.

## Before enabling

The release/deployment owner coordinates this setup after source verification
and qualified current artifact adoption. No provision/deploy action is implied
by this document. Confirm:

1. Corrected current core artifact and Web source are delivered; ordinary saved
   owner admission works over strict public HTTPS/WSS. Reuse that exact current
   connection and existing human session. No cookie export or server auth mint.
2. Official Chromium and standard sandbox have actual kernel compatibility
   evidence. Installation is not a successful browser launch. On CT106 use
   `/usr/bin/chromium` and preserve its normal sandbox. CT106's ordinary user
   manager is running but `/run/user/1000/bus` is absent; do not assume a user
   session bus or change manager/linger policy. The approved bounded system
   launch with `User=vessel`/`Group=vessel` ran the standalone about:blank smoke
   successfully, with zero remaining owned Chrome/helper processes. That lacks
   the full live PID/start/UID/invocation witness and is not browser acceptance.
   Capture those identities in the actual driver. Never add `--no-sandbox`,
   create a bus/security workaround or ignore TLS.
3. Supported private Node path is observed, not inferred. CT106's staged official
   Node v24.21.0 executable is
   `/home/vessel/.local/share/voyage/runtime/node-v24.21.0/node` (not `bin/node`).
   The verified executable SHA256 is
   `7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c`;
   the official archive SHA256 is
   `fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`.
   Put the exact executable into `config.host_browser_launch.node`; worker
   discovery otherwise checks `/usr/bin/node` then `/usr/local/bin/node`, and
   existing Node20.19.2 is below the worker floor. Do not change global Node.
4. Exactly two precreated owned, nonsensitive empty fixture Voyages, their
   canonical owner/incarnation identities and approved fixture routes are pinned
   in the existing private production configuration. Use normal current clients,
   not a façade/transport rewrite. Provider requests are not needed or authorized.
5. The official production driver and passive cost collectors are present at
   verified source hashes. Native WSS meter is opt-in/default off and pinned to
   its own private output inode/PID/start, 600-second lifetime and exact route.
   Its active continuity checks must succeed. Preserve the normal TLS and socket
   routes. Host/client CPU, RSS, heap, payload and latency scopes remain distinct.

## Fixed host startup

All helper and test invocations use `/usr/bin/python3 -I` to exclude user-site
and Python environment startup. The helper uses only the standard library;
its tests load the maintained source by explicit absolute importlib path.
Only server-controlled setup supplies these arguments. Substitute already pinned
benign fixture identities and privately known absolute paths locally, without
printing credentials. The setup administrator may create two **new** mode0700
key directories owned by UID33 and UID1000 and provision one identical random
32-byte file into each (mode0600, correct UID, single link, O_EXCL/no symlink).
Do not modify existing directory permissions, groups, ACLs, grants or services.
The original driver mailbox stays owned/private to UID1000. The broker directory
must permit no UID1000 traversal; the bridge key directory permits no UID33
traversal. Production data is never copied into either.

Use the same preissued `created_at` and `expires_at` Unix seconds in both argv;
`expires_at-created_at` is positive and <=600. Start as each existing ordinary
user through the approved host conduit:

```sh
/usr/bin/python3 -I deploy/browser-qualification-helper.py broker \
  --key-file PRIVATE_UID33_JOB_KEY --socket PRIVATE_UID33_COORD_SOCKET \
  --job-id JOB_UUID --tenant-id TENANT_UUID --connection-id CONNECTION_UUID \
  --principal-id PRINCIPAL_UUID --vessel-id VESSEL_UUID \
  --connection-revision PINNED_REVISION --created-at CREATED --expires-at EXPIRES \
  --labels LABEL_A LABEL_B --site-labels APPROVED_SITE_LABEL_1 APPROVED_SITE_LABEL_2
```

Both processes receive the same fixed benign site labels from the approved
private site catalogue. A missing/unknown site label refuses; no URL is
accepted in its place.

The broker prints only job UUID, private socket/directory dev+ino, its PID/start
ticks and assigned loopback port. Feed these benign pins into approved Web server
configuration locally:

```dotenv
HELM_BROWSER_QUALIFICATION_ENABLED=true
HELM_BROWSER_QUALIFICATION_JOB=JOB_UUID
HELM_BROWSER_QUALIFICATION_SOCKET=PRIVATE_UID33_COORD_SOCKET
HELM_BROWSER_QUALIFICATION_SOCKET_DEV=OBSERVED_DEV
HELM_BROWSER_QUALIFICATION_SOCKET_INO=OBSERVED_INO
HELM_BROWSER_QUALIFICATION_DIRECTORY_DEV=OBSERVED_PARENT_DEV
HELM_BROWSER_QUALIFICATION_DIRECTORY_INO=OBSERVED_PARENT_INO
HELM_BROWSER_QUALIFICATION_PID=OBSERVED_PID
HELM_BROWSER_QUALIFICATION_START_TICKS=OBSERVED_START
```

These fixed pins are required; no path/port from an HTTP request is accepted.
The PHP worker must own the socket/directory and the helper's `/proc` identity.
Apply config through the normal coordinated deployment process; do not weaken
private permissions to accommodate cache/FPM setup.

```sh
/usr/bin/python3 -I deploy/browser-qualification-helper.py bridge \
  --key-file PRIVATE_UID1000_JOB_KEY --mailbox ORIGINAL_DRIVER_PRIVATE_MAILBOX \
  --port OBSERVED_LOOPBACK_PORT \
  --job-id JOB_UUID --tenant-id TENANT_UUID --connection-id CONNECTION_UUID \
  --principal-id PRINCIPAL_UUID --vessel-id VESSEL_UUID \
  --connection-revision PINNED_REVISION --created-at CREATED --expires-at EXPIRES \
  --labels LABEL_A LABEL_B --site-labels APPROVED_SITE_LABEL_1 APPROVED_SITE_LABEL_2
```

Record both exact owned PIDs/start ticks and their source/config hashes. Broker
and bridge are observational metadata helpers, yet consume CPU/RSS. Record their
cost separately or explicitly include their owned identities in the appropriate
cost ledger; do not attribute their work to a Voyage or silently exclude their
overhead from whole-host claims. No raw private data is needed to measure this.

## Current human operator sequence

Root owns CUA on the existing signed-in browser. Open the exact coordinator route
in a third tab normally. Keep the two fixture React tabs/viewers mounted. Import
`voyage/tests/host_browser_cua_cost.mjs` through the maintained CUA helper loading
path, select only the two owned fixture targets and enable its supported CDP
Network/Performance methods. Enable observation **before** a normal same-origin
reload, then open the Browser dock. Never print raw events, WebSocket payloads,
URLs/auth headers/tokens/cookies; retain only returned counts/scalars.

1. Click **Read issued request**. Observe its exact UUID, digest, operation,
   expiry and whitelisted labels. The host driver retains rich fixture parameters
   privately. It never asks this form to execute a command or accept a new URL.
2. Perform the specified normal fixture UI observation. Submit only this envelope
   in **Coordination response**, then click **Submit this response once**:

   ```json
   {"schema":1,"id":"ISSUED_UUID","digest":"ISSUED_SHA256","status":"observed","result":{"counter_matches":true,"no_input_sent":true}}
   ```

   The example result applies only to `observe_counter`; other operations have
   their own exact boolean/count whitelist. Form data is not model history or a
   workspace file. Submit reduced nonsecret metrics only. Unknown stays unknown.
3. A success means **queued once**, not original private publication. Read status
   outside the measured window: `queued` is broker-held, while `answered` means
   the bridge observed atomic publication and acknowledged it. The driver uses
   only the original exact response file. Do not repeat a submitted request,
   even if refresh shows the same UUID after an unconfirmed submission.
4. For `measure_arm`, choose `Date.now()+15000` in CUA and submit only
   `{"started_at_ms":FUTURE_UTC_MS}` in the exact envelope. Observe the following
   `measure_window` and verify the same start, labels, index, condition and 10000
   milliseconds. Start the actual bounded CUA call before that time:

   ```js
   const reduced = await Promise.all(selectedObservers.map(o =>
     o.measureAt(armedStart, 10000)));
   ```

   Afterwards submit only `{"viewers":reduced}`. Arm must still be >=1s and <=30s
   ahead when received; actual host/Web start alignment and elapsed windows must
   match within 1s. Never backdate, raise timing tolerances or fabricate a metric.
   No coordinator refresh/submit occurs during a measured window.
5. Preserve production-driver exact identity, private-input exclusion, explicit
   controller/return, actual renewal, unsupported/media localized fallback,
   separate site/cost facts and observed cleanup requirements. The standalone
   form does not establish any of these by itself.

## Failure and cleanup

Expired/malformed/wrong-MAC/replayed/oversize/unknown/foreign/changed-job requests
refuse without interpreting arbitrary strings. No uncertain UI input or bridge
transfer is automatically retried. If a request is not published before its
45-second driver deadline, retain incomplete evidence and stop that qualification;
no effect replay or timing rewrite. Queued data is bounded and expires with the
job. In-memory broker replies disappear on exit, so queued success alone is never
acceptance evidence.

Disable the fixture feature through normal Web config before cleanup. Stop only
owned helper PIDs with matching start ticks (SIGTERM runs descriptor/socket
cleanup); observe their exit. Expiry also terminates both ordinary helpers. The
broker removes only its still-pinned socket. Privately remove the two new key
files and benign broker directory only after processes stop and identity matches.
Keep original driver mailbox/evidence until qualified records are retained;
never remove a parent directory, another job, existing credentials or sessions.
Record zero remaining owned helpers/viewers/browser processes, and retain genuine
unknown/cleanup obligations.

## Verification entrypoints

Prepared focused sources (no production access required):

```sh
node --test tests/browser-qualification.test.mjs tests/browser-qualification-http.test.mjs
```

The helper tests cover signed metadata and exact actor/schema/UUID/digest gates,
wrong key/direction/nonce/sequence, replay, truncation/duplicates/nonfinite counts,
wall+monotonic expiry, bounded registry, private UID/permissions, symlink/FIFO/
hard-link/changed-inode refusal, no-clobber race, false/unknown preservation, and
prepare-without-commit. HTTP tests use a fresh local database and synthetic normal
session, enforce actual CSRF/operator/tenant/revision/current-session checks and
only a fake read-only capabilities adapter. They run owned ordinary helpers and
verify original no-clobber publication. They do **not** establish CT106 cross-UID,
public TLS, production credentials or real browser qualification. Form tests
cover exact one-shot CSRF submission, size/identity errors and no automatic retry.
Coordinate the focused run and existing Web typecheck/build/regression gate once
all relevant source edits are ready. End-to-end enablement remains a separately
coordinated host action after successful verification and normal Web publication.

The HTTP fixture has a 45-second internal deadline and 1.5-second fetch/body
deadlines, within its existing 60-second test bound. Unexpected authentication
or bootstrap status fails immediately. Private `/tmp/helm-coordination-http-*`
evidence is retained on success and failure (mode0700; bounded child logs and
last response mode0600), rather than erased by cleanup. Only stage, HTTP status
and owned retirement metadata is printed; fixture keys, cookies and response
bodies stay private. TERM/KILL handling awaits the original exit event and checks
PID/start/UID identity; an unconfirmed retirement fails. This is offline fixture
cleanup evidence, not production/native browser cleanup acceptance.
