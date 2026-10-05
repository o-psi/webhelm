> The console now connects browsers directly to public Vessel WSS endpoints (#307).
> Laravel handles login, tenant connections and temporary credential bootstrap.
> Node is needed to build assets, not to relay conversations. See
> [Helm Web deployment and gateway migration](https://github.com/o-psi/helm.vessel.voyage/blob/main/docs/helm-web.md#upgrade-and-retire-the-conversation-gateway).

# Helm website

## Production console

React 19 / TypeScript is the authenticated console at `/`. `/react` redirects to
`/` and retains the connection-management query. Laravel owns authentication,
tenant-scoped connection bootstrap and the shared public/login pages. The console
loads no Livewire or Flux runtime. The retired console is preserved in
[`archive/helm-web-flux`](https://github.com/o-psi/helm.vessel.voyage/tree/main/archive/helm-web-flux), outside route,
Composer, Vite and default test discovery. Do not implement console changes there.

From this repository root, use `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
The supported Node range is in `package.json`. Production assets contain the
React console plus shared public/login assets; a build alone does not deploy them.

The React console uses source-owned shadcn/ui components in
`resources/react/components/ui`, configured by `components.json`. Add components
from this repository root with `npx shadcn@latest add COMPONENT`, then review the generated
source and lockfile. Its Tailwind 4 theme lives in `resources/react/style.css`;
`resources/css/app.css` remains the separate Flux stylesheet for public/login
pages. The console uses the shadcn neutral light/dark tokens and component
variants. App CSS only lays out the sidebar, conversation, composer and browser
viewer; it does not reskin shadcn controls. Buttons, cards, badges, fields, menus,
dialogs, mobile navigation, disclosures, alerts, progress and sliders use shadcn
primitives. The receipt-driven voyage action, enrollment,
updater and browser adapters retain their focused behavior; these components
do not own execution or transport state.

React owns voyage navigation, drafts, history, run status, settings, decisions,
attachments and connection management.
Vessels advertising `catalogue_changes` supply bounded sidebar updates through
an independent catalogue observer. It checkpoints before hydration, merges current
voyage projections, and rehydrates on explicit replay gaps. Socket renewal fences
late replies from the old connection; admitted commands still drain without replay.
Older Vessels keep the periodic catalogue fallback during the v1.0.3 transition.
Ordinary catalogue metadata updates do not reread every open transcript; explicit
actions, changed owners and changed connections still require fresh canonical reads.
Catalogue metadata does not carry execution authority or replace transcript events.
The sidebar account menu opens a global Settings modal with HelmWeb Account and
Appearance pages. HelmWeb Account shows the current plan, Vessel usage and Stripe
checkout or billing portal controls; Manage Vessels retains connection ordering
for strict downgrades. Voyage setup remains a separate modal for execution profiles.
Shared transport/intent journals retain exact command identities across the
cutover. Browser viewing, account enrollment,
advanced voyage actions and the reviewed updater use explicitly disposed adapters.
Opening the Browser dock carries one start intent for the selected voyage. Socket
renewal, owner changes and incidental viewer remounts observe and reattach an
existing browser; they keep a stopped browser stopped. **Start browser** and a
fresh explicit dock opening can create a browser. Closing the panel only detaches
the viewer. This lifecycle contract is shared with the core viewer snapshot;
other clients retain their existing default opening behavior.
No unknown command is automatically replayed. Provider credentials remain on Vessels.

New user-update preparation, approval and discard require the explicit
`verified_user_updates` feature, owner scope and `remote_updates`. A version string
or the older remote-update flag does not prove that the installed controller
supports the current rollback/quarantine contract. Current core Vessels advertise
the feature only for a supported managed user installation with the current
verified controller; the staged system/root update path does not advertise it.
The legacy gateway capability projection retains this one explicit feature while
preserving its existing owner restriction and unrelated capability filters.
Old Vessels retain normal connection/catalogue/browser access and exact saved
update identity; owner-authorized read-only status checks remain available when
their existing remote-update surface supports them. Reload, reconnect, capability
loss or later recovery cannot revive approval. The UI explains the existing
approved host installer bootstrap/maintenance route; it does not mint a grant,
execute arbitrary host commands or retrofit an immutable old updater.
See [the current core contract](https://github.com/o-psi/helm.vessel.voyage/blob/main/docs/remote-updates.md#current-client-admission-to-verified-user-updates)
and [the tracked legacy delivery defect](https://github.com/o-psi/helm.vessel.voyage/issues/401).

The new-voyage screen opens with a message draft and Vessel, workspace, profile and
access controls. Sending creates an independent voyage, confirms its selected
access mode, then submits the first message. An uncertain creation keeps the draft
and requires exact receipt review; recovery never sends the message. Users can also
create a voyage without a first message. Unsent text and prepared pictures save
per account and voyage in this browser and restore after reload for review. Profile setup carries over the archived console’s compact
overview, separate searchable pickers, back navigation, fixed actions, deletion
confirmation and expired-sign-in refresh. React owns the screens and draft state;
no Flux console code is loaded. Reasoning/service and account usage have dedicated
steps. Vessel maintenance in Manage Vessels exposes exact prepare/review/apply/status and capability-gates older
hosts. Voyage setup directs owners of older Vessels there. Existing private keys, tenants, connections and conversation journals need
no migration for this interface cutover.

The sidebar keeps attention and active voyages above recent work, with older
settled voyages available through search or filters. New and existing voyages use
the same compact, bottom-docked composer. **Configure** shows Model, Reasoning and Access in one compact group. A
new voyage’s destination summary opens its Vessel, Workspace and Profile choices;
an existing voyage keeps its bound destination visible. **More options** contains
Account, Service tier and profile/execution management. New-draft overrides do not
edit the saved profile. Tool activity stays compact until expanded. The discovery button opens
local actions plus the executing Voyage’s advertised tools and filesystem skills
when `skills_catalog` and workspace read access are available. Selection inserts
text into the saved draft and never sends it. Tool inventory is a live-run view or
built-in next-run preview; skill metadata is a next-run preview. Voyage checks
policy again before any tool execution or skill file read. When the Voyage advertises
`workspace_file_catalog`, the same menu lists bounded workspace-relative filenames
under workspace read permission. It omits symlinks and generated/dependency
directories and labels incomplete results. Selecting a file inserts a request in
the unsent draft; Voyage checks current policy before reading contents. The right dock switches
between the shared Vessel-hosted
browser and Changes. When a Vessel advertises `workspace_changes` and the
connection has `workspace_read` permission, Changes reads current Git status and
selected staged/unstaged diffs through the executing Voyage without starting a
run. The read is bounded to 64 KiB and four seconds; truncation and unavailable
states are explicit. Recorded edits show historical requests from loaded
conversation, not a current filesystem diff. The separate explicit Inspect
control still admits one exact operator run and observes its canonical result.

User messages expose **Edit as draft** and **Branch from here**. Editing reads the
complete text when needed and prepares an unsent composer draft. It keeps the
existing draft by appending unless the person explicitly chooses to replace its
text; currently attached pictures and pending-delivery metadata are retained.
Earlier message pictures stay in history and can be added explicitly to the new
draft. A changed conversation, owner, composer or attachment selection refuses
stale preparation, and oversized UTF-8 text is rejected before changing the draft.
Preparing a draft never sends, steers, uploads or runs a tool.

The per-message branch action uses the existing reviewed branch controller. It
reads one bounded history page beginning at the selected canonical user-message
index, checks the observed revision and owner, and pins that boundary through
the human **Create branch** action. It preserves the source composer and pictures,
copies canonical history/settings into an independent voyage, and leaves workspace
files as they are. It resets provider continuation and copies no active run or
pending approvals. Changed/missing/non-user boundaries refuse; uncertain branch
effects remain in the exact receipt journal and are not automatically repeated.

Local verification of this increment passed TypeScript, 60 shared JavaScript
and 140 React tests, the production build, and the Chromium desktop/mobile
layout journey. The browser journey verifies draft retention, edit focus,
explicit selected-user branching, bounded Files selection and no automatic run.
It exposed overlapping edit controls and a missing action-dialog accessible name;
both were corrected before the final passing layout. Screenshots were inspected.
These checks are synthetic; exact-source production deployment remains pending.
**Review pending work** opens uncertainty recovery on demand; technical notices
and exact command IDs stay out of the default composer. Receipt details remain
inspectable. If a
receipt remains unknown, the original command stays recorded and is never
automatically resent. A fresh canonical snapshot permits a separately initiated message only when its
prepared payload is provably distinct from the uncertain message. Cold unknown
payloads fail closed; other mutations still wait for the unresolved receipt. The conversation provides response copying (fetching
complete canonical text when the visible projection is truncated), user-turn
navigation, and a compact sidebar for scanning long voyage lists. Latest follows
streamed output and image/layout growth; reading older messages preserves position.
Older history loads in bounded pages without counting newly appended output as
prepended content. Inactive voyages keep their reading position. The transcript
owns conversation scrolling, including its visually hidden accessibility labels.
Incremental output keeps a 64 KiB UTF-8 prefix, matching snapshots, with exact byte
continuation and explicit reads for more output. This bounds the automatic live
text preview, not all manually expanded history or all browser memory.

Type `/goal [objective]` in the composer to update canonical Goal metadata without
sending an inference prompt. New goals use finite defaults with automatic
continuation disabled; objective edits preserve the observed Goal identity,
limits and usage. A new configuration draft creates its Voyage once, confirms
requested access, then updates Goal metadata without starting inference.
Bare `/goal` reads a concise nonmodal objective/status view. **Manage goal** opens
usage, budget and lifecycle controls on demand. Clear and automatic continuation
retain separate consent checks. There is no persistent Goal bar or Goal modal.
Token accounting is not a strict billing cap. Pause stops future continuation;
Stop run requests cancellation of current execution. Pictures are refused for
Goal commands and retained with the draft. Unknown or refused outcomes retain
intent; confirmed metadata cannot clear newer composer text. Exact receipts are
observed without replay, and metadata events refresh canonical state. Older
runtimes without Goal state refuse the unsupported command. Coordinated runtime,
TUI and release qualification is tracked in
[#378](https://github.com/o-psi/helm.vessel.voyage/issues/378).

helm.vessel.voyage. Foleybridge.Software presents Helm, Vessel, and Voyage
as a product suite for running coding agents across machines the user controls.
Product copy presents Helm Web and the Linux terminal client as two interfaces
to operator-controlled Vessels and independent Voyages. Web use requires Vessel
and Voyage installed on a machine with an authenticated public HTTPS/WSS endpoint;
it does not include hosted agent compute. The
public landing page announces v1.0.0 with pinned Linux x86-64 archive/checksum
links, glibc 2.39+ requirements and review-first installation instructions. It links to focused `/helm`, `/vessel`, and
`/voyage` product pages. The public pages do not execute agents, enroll users or collect email addresses.
An opt-in authenticated **Helm Web console** at `/` gives each OAuth identity a
personal tenant with its own publicly reachable Vessel connections over a direct
authenticated WebSocket after same-origin credential bootstrap. See
[console setup and limits](https://github.com/o-psi/helm.vessel.voyage/blob/main/docs/helm-web.md).
Signed-out visitors go to `/landing`. Google, X and GitHub sign-in are shown only
when their application credentials are configured.
The console never executes agents on the web host.

## Development

Requires PHP 8.3+ with Laravel extensions, Composer, and a Node version allowed
by `package.json`'s `engines`. Flux Pro also requires private Composer
authentication for composer.fluxui.dev; keep auth.json out of Git (it is ignored).

```sh
cd web
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
npm ci
npm run build
php artisan serve
```

Keep `.env`, SQLite databases, logs, `vendor`, `node_modules` and compiled assets
out of Git. The lockfiles preserve deployed dependency versions. Source uses the
Laravel application skeleton, with its original framework configuration and
migrations. Console authentication routes fail closed (404) until explicitly
configured. OAuth sign-in creates a personal tenant with no inherited connections.

## Web account plans and Stripe setup

Free permits 8 connected Vessels. Basic permits 16 at $3 per month or $30 per
year; Pro permits 64 at $9 per month or $90 per year. These limits govern Helm
Web connections only. Vessel grants and running Voyages remain owned by their
hosts. An expired or ended paid subscription falls back to Free. Helm Web stops
issuing new browser credentials for Vessels above the current limit immediately;
the next console or connection action removes those excess Helm Web connections.
Already issued Vessel browser credentials may live for up to 120 seconds, plus
up to 3 seconds to close an open socket. Helm Web does not revoke host grants.

Billing and plan enforcement remain disabled until `HELM_BILLING_ENABLED=true`
and all Stripe settings in `.env.example` are configured. Until then, existing
accounts retain the prior 64-connection ceiling. Before enabling, inspect tenants
with more than 8 connections and put the Vessels they should retain at the top
of Manage Vessels. Enabling billing will remove other saved connections on their
next console visit; the credentials cannot be recovered from Helm Web afterward.
Take a private database backup before that switch.

Create four **recurring subscription** Stripe Payment Links for the prices above,
with one unit per checkout and no adjustable quantity. Configure each link URL,
`plink_` ID and `price_` ID in the matching `HELM_STRIPE_*` variables. Create a
Stripe customer portal link and set `HELM_STRIPE_PORTAL_URL` to its
`https://billing.stripe.com/...` URL. Register the public endpoint
`POST /billing/stripe/webhook` in Stripe for `checkout.session.completed`,
`invoice.paid`, `customer.subscription.updated`, and
`customer.subscription.deleted`; set its signing secret in
`HELM_STRIPE_WEBHOOK_SECRET`. Match `HELM_STRIPE_LIVE_MODE` to the Stripe mode.
Keep this secret and the production `.env` private. Stripe handles checkout,
payment methods, invoicing and cancellation; Laravel derives access only from
signed paid invoice periods associated with a checkout started by that tenant.
Checkout completion alone never grants access. Webhook retries are idempotent.
Stripe may deliver events out of order, so invoice periods are recorded until the
matching checkout binds them. Verify the four links, webhook delivery, upgrade,
expiry and cancellation in Stripe test mode before enabling live mode. A second
active subscription is not automatically assigned to an account; resolve duplicate
charges in Stripe if one is created externally.
For immediate upgrades in the customer portal, configure Stripe to invoice the
proration immediately. Laravel grants the higher limit after that invoice is paid.
An observed price decrease lowers the limit immediately, even if Stripe applies a
credit rather than collecting a new payment. Keep portal quantity adjustment off.

## Deployment

The public Helm Web origin runs in Proxmox CT 106, the dedicated unprivileged
Debian 13 CT named `helm-web`. The laptop remains a Vessel host and serves its
public Vessel API; browser console traffic connects directly to that API after
Helm Web login. The CT has 2 cores, 2 GiB RAM, 512 MiB swap and a 16 GiB root
disk. DHCP attaches to the existing bridge. Container nesting is enabled for
Debian systemd mount compatibility; no host devices are passed through. It
starts at host boot.

Application: `/srv/helm/app`, owned by the unprivileged `helm` deployment account.
Private runtime state is under `/srv/helm/runtime`, outside the application source;
preserve it and the production `.env` across source updates. The initial CT source
was copied from the laptop's live working tree, including uncommitted changes.
Future changes to this repository require an explicit deployment to CT 106 and a private
backup before replacing that source; a local edit or Git push does not update the
running website. Deploy matching PHP source and built assets together.

Nginx serves only `public/`, on `127.0.0.1:80`. PHP-FPM runs as `www-data`.
The deployment account's home must permit traversal (`chmod 755 /srv/helm`).
Only `storage`, `bootstrap/cache` and the SQLite database directory need group
write access for `www-data`; use setgid directories to preserve that group.
The production `.env` is `helm:www-data` mode 0640. Set:

```dotenv
APP_NAME=Helm
APP_ENV=production
APP_DEBUG=false
APP_URL=https://helm.vessel.voyage
SESSION_SECURE_COOKIE=true
LOG_LEVEL=warning
```

Retain the migrated `APP_KEY` exactly across CT upgrades; do not regenerate it.
Generate a key only for a fresh installation with no existing runtime state. Run
`php artisan migrate --force` on the CT as `helm`. Keep the configuration cache
cleared: the private `LARAVEL_STORAGE_PATH` comes from `.env`, but
`php artisan optimize` currently caches paths under `/srv/helm/app/storage`. If
`optimize` was run, follow it with `php artisan config:clear` before serving
traffic. Let `www-data` compile views in
`/srv/helm/runtime/storage/framework/views`; a
view cache generated as `helm` can fail when Laravel later updates a compiled
file's timestamp as `www-data`. Verify both `/up` and an authenticated console
request after changing caches. See [compiled-view deployment notes](deploy/compiled-views.md).

The CT currently has Node 20.19.2, below `package.json`'s supported range. The
initial deployment used matching assets built on the laptop. For later updates,
run `npm ci` and `npm run build` on a host with supported Node, then copy the
matching built assets to the CT; alternatively, upgrade the CT's Node before
building there. Run Composer as `helm` and reapply shared directory permissions
after caching.

### Scoped update from a HelmWeb voyage

CT 106 has a separate `vessel` execution account. A filesystem grant in a voyage
cannot make that account the `helm` application owner or root. Provision the
root-owned deployment job once from an administrator shell on the CT:

```sh
/path/to/checkout/deploy/provision-helm-web-update
```

The provisioner installs a checksum-checked official Node 24 runtime in
`/opt/helm-web`, `sudo`, a systemd job and an exact sudoers command. It **does not**
add `vessel` to the sudo group. The only delegated command starts a fixed job
that fetches canonical GitHub `main`; the caller cannot select a repository,
commit, shell command or destination. It builds as `helm`, not root, and runs
independently of the requesting voyage. To update from a HelmWeb voyage:

```sh
sudo -n /usr/local/sbin/helm-web-update request
/usr/local/sbin/helm-web-update status
```

### Automatic main deployment

Administrator provisioning enables `helm-web-update.timer`: main is checked five
minutes after boot and five minutes after the previous job finishes, with up to
30 seconds coalescing. Builds have a 30-minute timeout, so this is not a five-minute
deployment latency guarantee. The timer invokes the same fixed service and flock;
no webhook, GitHub secret, live checkout pull or additional Vessel rights are added.
A lightweight canonical-main probe skips clone, staging, backup and build when the
installed source is current or the candidate is retry-exhausted. The actual clone
SHA remains authoritative if main changes between probe and clone.

The root-only `/srv/helm/deployments/helm-web-attempts.json` ledger permits three
build attempts per SHA (initial plus two retries). Recording happens atomically
before builds; interrupted builds consume an attempt. Changed main has its own
budget; returning to an exhausted SHA does not reset it. Manual requests obey the
same cap. `retry_exhausted` is a clean no-build outcome. Malformed state refuses
admission, rather than being mistaken for exhaustion. `recovery_required`, unknown
receipt phases and interrupted `activating` receipts fence all future deployment
before overwriting the receipt. Administrators must first inspect/recover the app
and database; only then may they repair the receipt or remove a reviewed source
entry to authorize another attempt. Never erase state simply to silence failures.

Install reviewed files with the existing administrator-only provisioner (never
from a Voyage). Verify `systemctl is-enabled helm-web-update.timer`,
`systemctl list-timers helm-web-update.timer`, `systemctl cat helm-web-update.service`,
service journal, receipt and live `.helm-source`. Verify origin `/up`, `/landing`,
matching built assets and public HTTPS health before declaring success.
`systemctl disable --now helm-web-update.timer` pauses future checks but does not
cancel a running service. Offline tests: `python3 tests/deploy-update.test.py`;
Also run `python3 tests/deploy-update-subprocess.test.py` for sandboxed updater
control-flow checks; these install nothing and are not production acceptance evidence.

The receipt reports `preparing`, `activating`, `succeeded`, `failed`,
`recovery_required`, `retry_exhausted` or `current`
with the exact source commit. Check `journalctl -u helm-web-update.service` as an
administrator for failure details. `request` returning means the job was queued,
not that deployment succeeded. Do not issue repeated requests while one is active.

The job prepares Composer dependencies and Vite assets away from the live site,
checks TypeScript and PHP syntax, stops PHP-FPM for a consistent SQLite backup,
preserves private `.env`/Composer auth, applies migrations, and verifies `/up`,
`/landing` and the built React asset. An unsuccessful activation restores the
previous app and SQLite snapshot before reopening the site. Private backups stay
under `/srv/helm/backups` and remain root-only; the `vessel` account never receives
read access to `/srv/helm/runtime` or `/srv/helm/private`. A successful deployment
retains its prior app and private backup for administrator rollback. The first run
converts `/srv/helm/app` to a link to a versioned release. Keep Nginx/PHP-FPM
pointing to `/srv/helm/app`, and do not edit a release in place.

This is website deployment authority, separate from the reviewed Vessel binary
updater. A host administrator must deliberately provision it; an ordinary Vessel
installation never grants it. Any process running as CT user `vessel` can request
the fixed job after provisioning, so use it only on a Vessel host trusted for that
website. Treat a failed or uncertain receipt as unresolved until the running site
and database are inspected; never assume a queued request updated production.

`deploy/nginx.conf` is installed in `/etc/nginx/sites-available/helm` and linked
under `sites-enabled`. It assumes all requests arrive through the local HTTPS
Cloudflare connector and sets FastCGI HTTPS accordingly. Do not expose this origin
to the LAN without revisiting the HTTPS assumption. Run `nginx -t` before restarting
Nginx; changing from a wildcard listener to loopback requires a restart.

`deploy/cloudflared.service` runs the connector as its own system user, reading
`/etc/cloudflared/tunnel-token` (root:cloudflared, 0640). Never place the credential
in source, command arguments or issue comments. The remotely managed tunnel maps
`helm.vessel.voyage` to `http://localhost:80`, with a final 404 catch-all. Nginx,
PHP 8.4 FPM and cloudflared are enabled at boot. The connector binary is installed
at `/usr/local/bin/cloudflared`; explicit operator upgrades are required.

## Operations and verification

Use the Proxmox console or `pct exec` for administration. Check `systemctl is-active
nginx php8.4-fpm cloudflared`, `systemctl --failed`, and `nginx -t`. The internal
`http://127.0.0.1/up` endpoint should return 200. The public page must contain the
Helm title, and all production React assets must return 200. The console must not
load the archived console bundle or Flux/Livewire scripts. Shared public/login
pages still load their own Flux assets. Verify desktop and mobile layouts.
`/.env` must return 403; unknown pages must return 404. Debug output stays disabled.

If public resolution lags, inspect authoritative/public DNS independently; do not
mistake a resolver cache for a failed tunnel. Tunnel registration alone does not
establish working application routing. The connector's disabled ICMP proxy is
unneeded for this HTTP-only origin.

Before upgrades, back up the application `.env`, private runtime state and database
(using an SQLite-aware backup), and tunnel token to operator-controlled private
storage, or take a stopped container backup. Keep the deployed source and its
matching assets available for rollback. No off-host backup schedule is provisioned
by this change.

Rollback application source and its matching assets together; database rollback
requires the matching backup. Do not regenerate keys during recovery.

Initial checks: production build and Laravel optimization, migrations, Composer
validation/audit, origin HTTP/health, public HTTPS/assets, route-specific titles,
descriptions and links, environment-file denial and service health. These are
HTTP/runtime checks; no browser visual QA or agent execution was performed.

### Composer controls

In the React console, **Enter** sends and **Shift+Enter** inserts a newline.
Enter used to confirm an IME composition does not send. An idle voyage submits a
new turn; an active run uses **Send to current run** to steer it. Sending is
disabled while the run is stopping or the draft is loading.

The composer shows the observed access mode: **Read only**, **Approval**, or
**Full access** (`unrestricted`). Use **Review access mode** to review a fresh
voyage snapshot before applying a revision-bound `set_access` change; the label
is observed state, not a grant of additional authority.

**Stop run** appears only for an active or stopping run, never for an idle voyage
or before selection. It is disabled once stopping begins. Send and stop require
fresh state and the corresponding permission, and are gated while busy or stale.
Uncertain commands remain in the receipt journal: unresolved non-message actions
block sending, and unresolved actions block stopping. A fresh snapshot may allow
a distinct new message after an uncertain earlier send, but never automatically
replays that earlier command. Check the conversation and receipt before repeating
a request.

### Composer drafts

Message and new-voyage drafts save text and prepared pictures in IndexedDB on the
current browser, separately for each signed-in tenant and Vessel/voyage. Reload
restores content for review; it never sends a message or restores execution approval.
Accepted messages clear their saved content. An uncertain send retains the draft
with a review warning so it is not silently repeated. Sign-out leaves drafts on
this browser for that account; use **Discard draft** or clear site data to remove them.
These drafts do not synchronize to another device.

Storage is bounded to 64 drafts and 32 MiB per account, with 64 KiB of UTF-8 text
and the existing four-picture/4 MiB prepared-image limit per draft. Nothing is
automatically evicted. Conflicting tabs, unavailable storage and quota failures
show a warning and preserve the current text for copying. Sending waits for the
recovery marker to save. Runtime credentials, grants and command receipts stay
outside the draft store.

### Console verification

Run `npm test` for the active shared transport/auth and React suites. On the
supported Linux verification host, React files run sequentially in separate
transient systemd user services with private umask `0077`, each capped at
1 GiB memory, zero swap and
25 seconds. The launcher uses the current Node executable and refuses an
unrestricted fallback when the user manager is unavailable. This bounds native
allocations as well as V8 heap and keeps a failing test out of the app cgroup.
It changes no persistent system settings. Keep full and focused verification
under these limits rather than launching unrestricted parallel DOM workers. The HTTP
fixture checks canonical root rendering, `/react` redirect, tenant isolation,
CSRF, connection-management feedback and logout. Archived Flux presentation
fixtures are historical and are excluded from the active suite. Use
`node tests/browser-layout-browser.mjs` after building for desktop/mobile Chromium
checks, then verify the authenticated production root in the shared browser.
`node tests/browser-next-browser.mjs` also prepares a historical live-recovery
regression with naturally recorded snapshot0 and mutation1 older than the live
baseline. It requires visible1 after recovery and progress to2 from a subsequent
recorded delta, with bounded event bytes/count, local recovery time and replay
instances. The shared live viewer uses the supported `useVirtualDom: false`
option so old synchronous mutations are applied without waiting for a non-live
Flush. This source increment awaits coordinated verification; it is not passing
production TLS or deployed-client evidence.
The stopped recovery action keeps its accessible label/title consistent with its
displayed intent. The same Chromium fixture prepares that assertion after
synthetic close and requires all replay instances to be retired; runtime restart
admission remains enforced by the executing Voyage.
Run `node tests/browser-drafts-browser.mjs` against the built bundle for real
IndexedDB reload, prepared-picture retention, tenant/voyage isolation, conflicting
tabs, accepted/uncertain send handling, new-voyage approval reset and discard checks
at desktop and mobile widths. This uses synthetic transport without provider calls.
`node tests/browser-conversation-browser.mjs` exercises the built shell with
synthetic public-v2 frames in real Chromium at wide desktop, narrow desktop and
mobile widths, in light and dark themes. It checks a 128-message recent history,
one 50-message older page, more than 3 MiB of UTF-8 deltas, bounded live text,
retained heap and DOM counts, output paging, Latest/reading anchors, draft retention
and no outer document overflow. It uses existing Playwright/Chromium without
installing dependencies; `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH` and
`CONVERSATION_OUTPUT` override their locations. This is browser rendering and
memory evidence with synthetic transport, not TCP congestion or production login.
For Persistent Goals (#378), the runtime checkout also owns an offline real-process
journey: `python3 voyage/tests/goals.py --bin-dir target/debug --only web --web-root /absolute/path/to/webhelm`.
It uses this repository's existing production build, Playwright and Chromium,
an isolated paired Vessel and supervised Voyage, and the real browser socket
protocol through a fixture TLS proxy. It checks Web/TUI canonical state, conflicting
reviews, reconnect and confirmed Clear without inference. It does not certify
production OAuth or TLS deployment. `tests/goal-protocol.test.mjs` keeps the
retained gateway validator aligned with the runtime browser-command allowlist;
the production console continues to use direct Vessel sockets.

## Files review

The existing review dock includes Files when the executing Vessel advertises
`workspace_file` and `workspace_file_catalog` with WorkspaceRead authority.
Search observes a bounded filename catalogue; selecting a file reads up to
64 KiB of current UTF-8 text under Voyage policy. Linked/nonregular/binary files
and traversal refuse, and changed connection/incarnation responses are withheld.
The preview is read-only and displays truncation. Adding a file reference retains
the current draft and pictures without sending or attaching file bytes. Changes
can explicitly preview untracked text without staging it. Old capabilities keep
the separate operator Inspect workflow. Verify the actual matching core process
journey, Web tests/typecheck/build and production-bundle browser layout before
publication; source publication alone does not deploy these controls.

## Laravel Boost (local AI development)

[Laravel Boost](https://laravel.com/docs/boost) is a development-only Composer
dependency (`laravel/boost`); install with `composer install` from this repository root.
The committed `boost.json`, `AGENTS.md`, and `.agents/skills/` contain the generated
Laravel/Livewire/Flux guidance. They do not replace the root repository instructions.
The Codex generator is used for its portable AGENTS.md and skill format; it does
not imply that Helm uses Codex or that a client connection has been activated.

To refresh the generated guidance and skills from this repository root:

```sh
APP_ENV=local LOG_CHANNEL=stderr php artisan boost:update --no-interaction
```

For Helm, merge [helm-boost.toml](helm-boost.toml) into the **executing host's**
Helm configuration (normally `~/.config/helm/config.toml`), retaining existing
settings. Its relative `artisan` path assumes this repository as workspace;
use the absolute path to `artisan` for other workspaces. Start a new voyage
and check `/tools` for the discovered Boost tools. Helm does not automatically
load this snippet or Codex's `.codex/config.toml`. Existing voyages do not gain
new MCP tools in place. See [MCP configuration](https://github.com/o-psi/helm.vessel.voyage/blob/main/docs/configuration.md#mcp-tools-and-artifacts).

For other MCP clients, configure a stdio server launching `php` with arguments
`["/absolute/path/to/webhelm/artisan", "boost:mcp"]` and environment variables
`APP_ENV=local` and `LOG_CHANNEL=stderr`. These overrides apply only to the
Boost process: the checkout's existing environment may disable development
commands, and its configured log directory may not be writable locally.
Do not change production environment/debug settings to enable Boost.

Boost can inspect application data and logs and exposes database tools; only
connect trusted local development agents, with an appropriate local database
configuration. Enabling the local environment does not replace credentials or
isolate the database. No database query is needed for the initialization/tools
listing smoke check. Do not expose this server publicly. Production deployments
should continue using `composer install --no-dev`; no automatic `boost:update`
Composer hook is installed, so production updates do not depend on a dev package.

## Repository split and shared browser assets

This public repository contains Helm Web independently of the Helm/Vessel/Voyage repository. `shared/` contains snapshots of the viewer, status vocabulary, and browser vendor file from the source repository at split time. Keep these files in sync with protocol changes there. The production updater clones this repository as the `helm` deployment identity without GitHub credentials. Do not place credentials in this repository or overwrite the CT runtime `.env`, database, or backups. The installed automatic main updater follows qualified publications on its timer. A Git push is not deployment evidence: verify the updater’s exact receipt, installed source, actual asset and health checks.

## Execution identity source integration

The React Execution dialog and gateway schema are prepared for the core
`execution_identity` capability. Older peers hide this control. Scoped ordinary
observations show the executing identity and separate launch/process/owned-cleanup
facts; administrator preparation requires both existing connection permissions
and separate protected host-operator enrollment using a fresh root-issued
connection. The client submits configured identity references, never a UID,
environment, executable or credential path. Review identity is saved before
preparation; reconnect and Check observe the exact server receipt and never replay
approval. Explicit approval/revocation remain human actions. Message drafts stay
separate.

This source has not been typechecked, built or exercised, following the user's
instruction to complete milestone implementation before one coordinated final
verification set. It is not production deployment evidence. Core reviewed identity
transition and matching client scope are still being integrated; do not claim
#344/#377 acceptance or advertise source-only work as a verified release.

Fixture-only browser qualification coordination, disabled by default: see
[the expiring coordination runbook](deploy/browser-qualification.md).

### ChatGPT or Grok subscription accounts

In profile setup, choose **Provider account → Add subscription account**, then
select **ChatGPT** or **SuperGrok** for your eligible subscription. The private
view shows the selected provider's verification website and a short device code;
approve it in a browser on any machine. Tokens stay on the selected Vessel, and enrollment neither sends a model request nor changes the host default.
Grok sign-in requires a Vessel with native `xai_oauth` support. Older Vessels continue to offer
their supported providers. The picker rechecks native support before starting; a removed
provider or changed endpoint cannot start enrollment. Expired SuperGrok accounts offer an explicit sign-in
refresh. Subscription limits and model availability are controlled by the selected provider.
Model choices come from the selected account’s catalogue; saved models absent from it
are not added as discovered choices. A catalogue entry is not proof of inference
entitlement. Access denial is distinct from sign-in failure and does not trigger
a credential refresh or automatic retry. SuperGrok quota percentages are unknown. API-key billing is separate and is never
selected as a fallback for either subscription provider.

The bounded browser qualification coordinator's additional idle/media operations
and exact proof fields are documented in
[fixed qualification proofs](docs/browser-qualification-fixed-proofs.md).
Their source contracts are separate from actual native qualification.
