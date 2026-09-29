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
No unknown command is automatically replayed. Provider credentials remain on Vessels.

The new-voyage screen opens with a message draft and Vessel, workspace, profile and
access controls. Sending creates an independent voyage, confirms its selected
access mode, then submits the first message. An uncertain creation keeps the draft
and requires exact receipt review; recovery never sends the message. Users can also
create a voyage without a first message. Unsent text and pictures live in page
memory and survive switching conversations, but not reloading. Profile setup carries over the archived console’s compact
overview, separate searchable pickers, back navigation, fixed actions, deletion
confirmation and expired-sign-in refresh. React owns the screens and draft state;
no Flux console code is loaded. Reasoning/service and account usage have dedicated
steps. Vessel maintenance in Manage Vessels exposes exact prepare/review/apply/status and capability-gates older
hosts. Voyage setup directs owners of older Vessels there. Existing private keys, tenants, connections and conversation journals need
no migration for this interface cutover.

The sidebar keeps attention and active voyages above recent work, with older
settled voyages available through search or filters. The composer exposes direct
model and reasoning choices for the current voyage; the new-voyage composer can
override those choices without editing the saved profile. Tool activity stays
compact until expanded. The right dock switches between the shared Vessel-hosted
browser and Changes. Changes offers bounded, explicit read requests to the
executing Voyage’s advertised file or shell tools and shows recorded file-edit
requests from loaded conversation history. Recorded edits are historical requests,
not a current filesystem diff. Read requests are admitted as one exact operator
run; the dock waits for that run’s canonical result and never repeats an uncertain
request. Uncertain command notices explain the affected action in the composer;
exact command IDs remain in expandable receipt details for inspection. If a
receipt remains unknown, the original command stays recorded and is never
automatically resent. A fresh canonical voyage snapshot permits a separately
initiated new message in the same conversation; other mutations still wait for
the unresolved receipt. The conversation provides response copying (fetching
complete canonical text when the visible projection is truncated), user-turn
navigation, and a compact sidebar for scanning long voyage lists. Latest follows
streamed output and image/layout growth; reading older messages preserves position.
Older history loads in bounded pages without counting newly appended output as
prepended content. Inactive voyages keep their reading position. The transcript
owns conversation scrolling, including its visually hidden accessibility labels.
Incremental output keeps a 64 KiB UTF-8 prefix, matching snapshots, with exact byte
continuation and explicit reads for more output. This bounds the automatic live
text preview, not all manually expanded history or all browser memory.

Voyages that expose canonical Goal state show a Goal panel above the composer.
It reads the objective, status, usage, limits and recorded model assessment from
the executing Voyage. Owner connections can set, edit, pause, resume and clear;
replacing an existing Goal requires confirmation of that specific Goal. Edits
retain usage and pause continuation. Automatic continuation requires explicit
consent and finite limits; token accounting is not a strict billing cap. Pause
stops future continuation; Stop run requests cancellation of current execution.
Goal drafts stay in memory, and the browser's recovery journal retains command
identity without the objective. Lost responses are observed by exact receipt,
never resent. Goal metadata events trigger an authenticated canonical refresh.
Older runtimes without Goal state do not show these controls. Coordinated runtime,
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

The receipt reports `preparing`, `activating`, `succeeded`, `failed`,
`recovery_required` or `current`
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

### Console verification

Run `npm test` for the active shared transport/auth and React suites. The HTTP
fixture checks canonical root rendering, `/react` redirect, tenant isolation,
CSRF, connection-management feedback and logout. Archived Flux presentation
fixtures are historical and are excluded from the active suite. Use
`node tests/browser-layout-browser.mjs` after building for desktop/mobile Chromium
checks, then verify the authenticated production root in the shared browser.
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

This public repository contains Helm Web independently of the Helm/Vessel/Voyage repository. `shared/` contains snapshots of the viewer, status vocabulary, and browser vendor file from the source repository at split time. Keep these files in sync with protocol changes there. The production updater clones this repository as the `helm` deployment identity without GitHub credentials. Do not place credentials in this repository or overwrite the CT runtime `.env`, database, or backups. A Git push alone does not deploy; request the scoped update job and verify its receipt and health checks.
