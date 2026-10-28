# ILBI Platform

Current platform release: [v1.4.0](docs/releases/v1.4.0.md).

Repository: [Abdulxadiy/ilbi](https://github.com/Abdulxadiy/ilbi). Clone with `git clone https://github.com/Abdulxadiy/ilbi.git`; the project root is `ilbi/` and the Django backend is `backend/`.

Push ready changes to main with Git or IDE Source Control. Passing CI automatically builds the Windows and Linux packages and deploys the platform and downloads to production; saving a local file does not push it. Details: [CI and automatic deployment](automation/README.md).

ILBI is an enterprise-grade multi-tenant retail and wholesale sales platform designed for inventory tracking, point-of-sale (POS) operations, cash register (cashbox) accounting, debt management, and B2B commerce.

---

## Tech Stack

- **Backend**: Python 3.12, Django (version constrained in `backend/pyproject.toml`), Django REST Framework, Celery, Gunicorn + Gevent
- **Database & Cache**: PostgreSQL 16, Redis 7
- **Frontend**: React 19, Vite, Tailwind CSS, Lucide Icons
- **Proxy & Server**: Nginx, Docker, Docker Compose
- **Telegram Services**: Aiogram 3 (2FA SMS and notification bot)
- **API Documentation**: OpenAPI 3 / drf-spectacular (Swagger UI & Redoc)

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/)
- [uv](https://docs.astral.sh/uv/) (Python package manager, optional for bare-metal development)
- [Node.js](https://nodejs.org/) v22+ & npm (optional for bare-metal frontend development)

### 1. Environment Setup

Copy example environment files to configure your local environment:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp telegram_bot_sms/.env.example telegram_bot_sms/.env
```

Review and adjust variables in all three environment files. Use matching PostgreSQL credentials and internal service tokens. For local development set `DJANGO_DEBUG=True`; enable synthetic demo login only when explicitly needed.

---

## Running the Application

### Development (Docker Compose)

Start the entire platform including backend, frontend, database, redis, celery, and nginx:

```bash
docker compose up --build
```

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost/api/v1/
- **API Documentation (Swagger)**: http://localhost/api/docs/
- **API Documentation (Redoc)**: http://localhost/api/redoc/

The optional React Native mobile development service runs with `docker compose --profile mobile up -d --build --no-deps mobile`. Open [the interactive phone preview](http://localhost:8082/preview). It uses synthetic design data by default and supports live code refresh. See [mobile development instructions](mobile-app/README.md) and [the implementation review](mobile-app/docs/MOBILE_REVIEW.md) for native testing and current limitations.

The frontend root `/` is ILBI's public presentation page. Sign-in stays at `/login`; authenticated work starts at `/dashboard`. The presentation follows native scrolling in both directions, including a four-stage sales story. Reduced-motion preferences and short windows retain the complete, unpinned presentation.

The product gallery presents six real interface captures with synthetic demonstration data. It supports side previews, touch swipes, mouse dragging, keyboard navigation and an original-size image viewer. Automatic playback pauses on hover, focus, hidden pages and when the gallery leaves the viewport; manual navigation stops playback until the visitor enables it again. Reduced-motion preferences disable autoplay by default.

### Bare-Metal Development (Manual)

#### Backend:
```bash
cd backend
uv sync
uv run python manage.py migrate
uv run python manage.py runserver 0.0.0.0:8000
```

#### Frontend:
```bash
cd frontend/ilbi
npm install
npm run dev
```

---

## Running Tests

Run the backend test suite using the isolated test database stack:

```bash
# 1. Start test Postgres and Redis
docker compose -f backend/docker-compose.test.yml up -d

# 2. Run pytest with coverage
cd backend
uv run pytest
```

Run frontend linting:

```bash
cd frontend/ilbi
npm run lint
```

To check the built public page, its reversible scroll effects, mobile layouts and sign-in routing in Chrome:

```bash
cd frontend/ilbi
npm run build
npm run test:landing
```

These browser checks use synthetic API responses and never sign in to or write to a real backend. Screenshots and the JSON report are saved under `branding/ilbi-motion-studio/qa/landing/`; set `ILBI_LANDING_QA_DIR` to choose another output directory.

---

## Windows / Linux desktop and offline stores

The cloud origin is fixed to `https://ilbi.uz` in the packaged application and backend. Setup has no editable server address; saved host configuration and credential destinations are checked before any cloud request. Environment variables cannot replace the production cloud origin. The retired origin is rejected by all network paths; encrypted settings from the previous official release are migrated locally without contacting that server. LAN register pairing remains separate. An untrusted address in an older vault is refused without deleting store data.

Linux selects Secret Service automatically on Hyprland/Sway and retains KDE's native wallet selection. Plaintext storage is refused. Failed secure saves leave setup retryable; backend startup failures preserve the encrypted vault and database for another attempt. Public download metadata is fetched directly from the fixed official origin before any store is configured, using the desktop network stack without cookies, account tokens or redirects. Package tests reproduce Hyprland without a `--password-store` workaround, exercise secure-store failure twice, open Downloads before setup, recover a failed download request, and then start and reopen the encrypted store normally.

Native Linux x64 uses the same Electron UI and offline backend as Windows. Download the `.tar.gz` on [Downloads](https://ilbi.uz/download), extract it and run `bash install.sh` inside `ILBI/` as your normal user. The installer creates an application menu entry and `~/.local/bin/ilbi`; no Wine, VM, system Python or PostgreSQL service is required. GNOME Keyring or KWallet must be available and unlocked. App data stays under `${XDG_CONFIG_HOME:-~/.config}/ILBI`; program files live in `${XDG_DATA_HOME:-~/.local/share}/ilbi-app`. Older installations without update support must be closed once before installing this package; subsequent updates support closing and reopening automatically. The data folder is preserved. AUR/pacman repositories are not published, so `yay -S ilbi` / `pacman -S ilbi` are not installation methods yet.

Linux releases are built on Ubuntu 22.04 and target glibc x86_64 desktops (Ubuntu 22.04+, Arch). They bundle verified Astral standalone Python 3.13.16, hashed application wheels and PostgreSQL 16.15 compiled from verified upstream source without optional external runtime libraries. Build tools: Python 3.13+, uv, Node 24, GCC/make, bison/flex. Run `python3 desktop/build_linux_runtime.py` then `npm run dist:linux --prefix desktop/ilbi -- --runtime-ready`. `dbus-run-session -- bash desktop/test_linux_package.sh` installs into disposable XDG directories and tests the actual package, encrypted vault, database startup/restart and updates. CI uses Xvfb on Ubuntu; Arch must also be checked locally. Native Windows-specific checks remain separate. Both artifacts must pass CI before their combined download feed is published.

Illustrated setup guide: [`/desktop-guide`](https://ilbi.uz/desktop-guide), also linked from Downloads, first-run setup and the app's **ILBI → Ilovani sozlash (rasmli qo‘llanma)** menu. Its seven annotated screenshots and text are bundled for offline reading. The rounded Windows icon uses transparent corners and separate DPI sizes; reinstall the latest package to update desktop/Start shortcuts.

The Windows desktop source is in `desktop/ilbi`. It bundles the React UI,
Python/Django and PostgreSQL; customers do not install Docker, Python, Node or
Redis. Each independent store has **one primary computer** with its own database.
Additional registers use that primary over the local network with a pinned TLS
certificate and a unique register key delivered through an owner-approved one-use
code. Initial pairing requires internet; daily LAN operation does not. The primary
computer and the local network must remain available to the other registers.
Closing ILBI on the primary stops that store's local service.

The local business transaction and its durable outgoing command commit together.
Reconnection sends commands in dependency order, with server receipts preventing
duplicate effects after a lost acknowledgement. A selected urgent command moves
below the active command; it brings required dependencies forward and never
interrupts an upload. The panel shows real upload progress, server confirmation,
errors and retry controls. Server changes are pulled only after local pending
commands finish, so a refresh cannot erase unsent work. Catalog/customer edit
conflicts and rejected financial commands remain visible for review.

Offline coverage includes the store's catalog, images/imports, inventory,
retail sales, returns/voids, counterparties, debt payments, cash income/expenses,
shifts, Fast-workspace reminders/search and reports from the downloaded records.
Both Classic and Fast workspaces are included in desktop v1.2.0, with the sync
control available in both. Layout selection and account drafts remain local.
Cross-store B2B
confirmation/transfers, employee/security administration, support, Telegram,
online payments and external providers require a live server. Historical receipt
prices, identifiers and business timestamps are preserved during synchronization.
An offline receipt's public web link becomes available after the sale reaches the
server. Images not yet downloaded need a later connection; attachment uploads are
limited to 10 MB in total per offline operation.

**Release boundary:** the existing production fiscal-provider gate is retained.
Retail POS intentionally rejects sales with `DEBUG=False` until the platform's
fiscal integration is implemented. Desktop packaging does not remove this gate.
The automated retail-sale scenarios use isolated synthetic test settings; this
is not evidence that a production fiscal provider or a physical receipt printer
works. CI checks native Windows startup and installer installation/uninstallation.
Real Windows desktop interaction, updates over an existing store, LAN registers,
printers and fiscal/payment hardware still require acceptance testing.

Initial setup:

1. Deploy the matching backend code and migrations to the HTTPS server first.
   The usual backend `manage.py migrate --noinput` includes `desktop_sync`.
   Do not switch the cloud deployment to `config.settings_desktop`.
2. Install the Windows x64 package and choose **Ishni boshlash** on the primary.
   The official HTTPS server is already selected. Sign in online as the store owner, select the
   store and open **Online rejim → Sinxronlash markazi** to download its database
   through **Internetsiz ishlashni yoqish**. Offline enrollment is optional.
   No separate offline password is created: online password plus OTP first proves
   the account, then a device-bound verifier is stored under OS-protected keys.
   Multiple stores require an explicit owner store selection.
3. Each cashier signs in online once with their ordinary account password and OTP.
   Prepared accounts automatically use the local session through connection changes while their register-bound 24-hour second-factor proof is valid. At that fixed deadline, online Telegram verification is required; background synchronization never extends it.
   Old PIN installations require one online login after upgrading; the database,
   pending operations and drafts are preserved. No cloud password hashes are copied.
4. To add another register, open **ILBI → Kassalar va xavfsizlik**, create the
   three-minute one-use code, enter it on the new PC, compare both fingerprints,
   and approve as owner. Both PCs require internet for first pairing. The fixed
   official HTTPS relay stores only an encrypted envelope; X25519/HKDF/AES-GCM
   provisioning is readable only by the requesting PC. Each register receives a
   unique revocable LAN key. Single-PC stores have no LAN listener. Afterwards
   the primary must stay open and both PCs use the same LAN (TCP 49243).
5. Signed offline grants expire after seven days. Remaining time and early warning
   appear in Sync Center. While online, security checks refresh permissions/revocation
   independently of the outbox and renew the lease without waiting for an empty queue.
   Clock rollback and altered local grants/session records require reauthentication.
   Expired/revoked sessions preserve pending work for review and reconnection.

Trusted-device cloud credentials are encrypted in the native vault and stored only
as a keyed digest on the server. They renew synchronization after a multi-day
outage within the seven-day lease, including when the ordinary one-day web refresh
token has expired. Resulting access and refresh tokens are bound to the device;
device revocation, owner password changes and staff dismissal invalidate them.
Interactive sessions additionally require the fixed 24-hour second-factor proof; background renewal does not extend it. These credentials never reach the renderer.

Prepared registers lock on restart and after ten idle minutes by default; the owner
can select 1–60 minutes or lock immediately. Actual input renews activity, API polling
and token refresh do not. Wrong-password limits are per user/register. Remembered
credentials use OS encryption; the register restores the username
and password on ordinary login. An inactivity lock requires manual password entry while preserving the encrypted remembered password. Browser password managers remain unchanged.

The primary automatically keeps seven authenticated AES-256-GCM cold backups while
open and idle. Database/outbox/media and the primary's account-scoped localStorage /
IndexedDB drafts are included. Restore authenticates the entire archive before
extracting, requires owner password plus a native confirmation, saves the current
state first, and uses a restart recovery journal. Backups are bound to this installation's
OS-protected key; they do not protect against loss of the disk or OS credential store.
Live PostgreSQL files have private profile permissions; they are not encrypted by
the database password. Use OS disk encryption for protection of the live cluster.

Desktop updates are checked at startup and every 15 minutes against the fixed
official release feed. Both workspaces show an update notice; an unfocused app
also sends a native notification. **ILBI → Yangilanishni tekshirish** opens the
update window manually. One action downloads the platform package with real
progress, checks its size and SHA-256, waits for active requests and synchronization
to finish, then opens the installer. Windows stages files before gracefully
closing ILBI and replacing them; Linux uses a separate progress window and an
atomic installation. Both reopen ILBI automatically. Save unsaved forms and pause
other registers before updating their primary computer.

Build metadata embeds the Git commit and its timestamp, allowing newer builds
with the same displayed version while refusing older releases. Downloads accept
only immutable package paths at the official HTTPS origin, without credentials
or redirects. Interrupted downloads can be retried. The first upgrade from an
older app without this mechanism still requires downloading a package manually.
Native package acceptance downloads a real artifact through the actual UI,
installs it while ILBI is running, and verifies automatic relaunch plus preservation
of a durable outbox row, the encrypted vault and browser storage in an isolated
unenrolled profile.

The installer preserves `%APPDATA%\ILBI` (Linux: `${XDG_CONFIG_HOME:-~/.config}/ILBI`),
including the database, encrypted cloud credentials and outbox;
uninstalling also preserves it. Back up this directory while ILBI is closed.
The encrypted device vault belongs to its Windows account; a folder copy is not
a supported migration to another Windows account/computer. Do not delete or
replace the primary while it contains unsent work. A replacement primary needs
the old cloud device explicitly revoked after its pending work has been resolved.
No code-signing certificate is configured.

To build locally (requires a development Python with pip, Node/npm and internet):

```bash
python desktop/build_windows_runtime.py
npm ci --prefix frontend/ilbi
npm ci --prefix desktop/ilbi
npm test --prefix desktop/ilbi
npm run dist:win --prefix desktop/ilbi
```

Pinned Python/PostgreSQL/MSVC archives are checked by SHA-256. Dependency wheels
are checked against `uv.lock` and `desktop/windows-wheel-lock.json`. Deployment
`.env` files, cloud database contents and development dependencies are excluded.
The output is `desktop/ilbi/release/ILBI-Setup-1.3.1-x64.exe`. The build verifies
that the installer contains its application payload. Main CI calls the
**ILBI Windows desktop** workflow, starts the native Windows Python/PostgreSQL
service, installs the built package, tests its installed service and uninstalls it.
A successful production deployment publishes that exact verified CI artifact.
The desktop workflow can also be run manually to inspect an installer separately.

The public download page is `/download`, linked from the landing page and both
workspace menus. It reads `/downloads/releases.json`; unpublished Windows/mobile
builds have disabled download controls. The desktop reads that same public feed
through its configured cloud origin. Build files are kept outside the React
bundle so an installer never embeds another copy of itself.

After a successful build, prepare the public files locally:

```bash
python desktop/export_downloads.py
```

This verifies the installer hash, copies it to `desktop/downloads` and atomically
writes `releases.json`. Its default channel is `preview`, shown as **Sinov
nusxasi** on the page. This local export command does not upload anything.
Main CI and production deploy automatically build, verify and transfer the installer
and feed; no manual file copy is needed for that flow. Production Compose mounts
the release directory read-only at Nginx's `/var/www/downloads`. It is public and contains
release files only. Nginx supports resumed/range downloads, returns 404 for absent
files and does not cache the feed. After release acceptance, export with
`--channel stable`. A future mobile release can be added under the feed's
`mobile` key with `version`, `label` and an HTTPS or `/downloads/…` `url`; subsequent
Windows exports preserve that entry. Mobile application development is separate.

Additional verification commands, using only disposable test databases:

```bash
cd backend
uv sync --group desktop
uv run pytest apps/desktop_sync/tests apps/core/tests/test_api_docs_production.py
uv run python ../desktop/verify_runtime.py
cd ../frontend/ilbi
npm test
npm run test:sync
npm run test:downloads
```

The integration runner creates and drops two disposable databases on the isolated
test PostgreSQL at `127.0.0.1:5433`. It exercises three simultaneous cashier
sessions, offline sale/debt/cash/shift/image changes, priority, a process restart,
offline unlock, reconnect, server refresh and stale open-form identifier mapping.
It also verifies offline reminder creation/completion/deletion and lease recovery.
Browser tests use synthetic responses. The Windows startup test is deliberately
skipped on Linux; a passing Linux run does not establish native Windows support.

## Production Deployment

Lightsail installation status, SSH operations, deferred DNS/HTTPS activation and CI/CD setup are documented in [ops/README.md](ops/README.md).

Production uses a separate Compose file with a built React bundle served by Nginx. The development Vite server is used only by `docker-compose.yml`.

1. Prepare separate production environment files on the server:

```bash
cp .env.production.example .env.production
cp backend/.env.production.example backend/.env.production
cp telegram_bot_sms/.env.production.example telegram_bot_sms/.env.production
```

2. Set `PUBLIC_HOST` to the canonical domain in `.env.production`. Use unique production secrets, matching database credentials in the root/backend files, and matching bot/internal tokens in the backend/bot files. Set the real SMTP credentials in the backend file. Production does not load the local development `.env`.
3. Obtain a trusted TLS certificate for `PUBLIC_HOST`. Put the resolved certificate chain in `fullchain.pem` and its private key in `privkey.pem` under the absolute directory specified by `TLS_CERT_DIR`. Do not use symlinks pointing outside that directory. The directory is mounted read-only; a missing directory or certificate makes startup fail. Keep the private key outside the repository. After renewal, update these resolved files, validate with `docker compose --env-file .env.production -f docker-compose.prod.yml exec frontend nginx -t`, and reload with the same command ending in `nginx -s reload`.
4. Validate the deployment configuration and production settings before launching:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config -q
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --no-deps --entrypoint python ilbi manage.py check --deploy
```

5. Launch the production layout only after the remaining release requirements are met:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Only frontend ports 80/443 are published. Nginx terminates TLS, redirects HTTP to the configured HTTPS domain, rejects unknown hosts, and overwrites client-supplied proxy headers. Django trusts this private edge, sets secure session/CSRF cookies, and redirects public HTTP requests. Existing authenticated `/api/v1/internal/` service calls remain HTTP inside Docker; the public edge blocks this entire prefix. The backend must not be published directly. An additional load balancer or CDN requires its own reviewed proxy configuration; do not forward arbitrary client `X-Forwarded-*` headers through this edge.

The production edge also applies separate per-IP request budgets in [nginx.prod.conf](frontend/ilbi/nginx.prod.conf): login, OTP send/verify, password reset and password changes share a sustained **60 requests/minute**, with `burst=30`; the remaining `/api/` routes share **60 requests/second**, with `burst=120`. These use Nginx's leaky-bucket accounting with `nodelay`, rather than fixed minute/second windows. A short burst can pass immediately; excess requests receive `429` before reaching Django. Login abuse does not consume the business API budget. Token refresh, profile reads and Telegram-link status use the general API budget. Static files, the SPA and media do not use these API counters. Existing account/OTP/DRF limits remain in force.

Edge-generated `429` responses use the application's JSON error shape, `Cache-Control: no-store`, security headers and `Retry-After` of 2 seconds for auth or 1 second for the general API. Ongoing traffic from the same IP can require waiting longer. Application-generated `429` responses retain their own body and retry delay. Counters use the socket peer IP, ignore supplied identity headers and are shared by workers of one Nginx instance; separate edge instances have separate budgets. Review the initial rates against actual peak traffic from stores sharing an IP. Keep new sensitive auth routes in the explicit auth map. See [Nginx request limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).

Cloudflare/WAF/DDoS protection is a separate deployment step and is not activated by this configuration. Before putting a CDN or load balancer in front, configure real visitor IP restoration using only explicitly trusted proxy ranges and prevent direct origin bypass; otherwise limits count the proxy's shared IP. Do not trust arbitrary `CF-Connecting-IP` or `X-Forwarded-For` headers. These local Nginx checks do not simulate a network-scale DDoS attack.

Production uses `config.settings_production`, rejects debug/demo mode and wildcard hosts, requires an HTTPS frontend origin matching `ALLOWED_HOSTS`, and disables Gunicorn reload even if its environment flag is enabled. Development continues to use its existing `.env` and `config.settings`.

Accounts tagged with `ilbi_local_demo` or the legacy `inventra_local_demo` group are rejected whenever either local demo switch is off. This covers new password login, previously issued access/refresh tokens, existing Telegram login tickets, password-reset/invitation links and password changes through the old-password endpoint. The persistent group marker still applies after editing a demo account's username or phone. Support notification tasks also exclude blocked demo admins, including personal/group preferences and legacy operator-phone recipients. Local synthetic demos continue working only with both debug and demo mode explicitly enabled. Deploying this policy requires updating the backend and Celery worker; it does not delete accounts or replace production secrets.

Production sets `API_DOCS_ENABLED=False`: the technical `/api/schema/`, `/api/docs/` (Swagger) and `/api/redoc/` routes return 404. Development and test settings keep them available. Product help at `/docs` and `/api/v1/docs/`, support and business APIs keep their existing routes and permissions. Offline schema generation with `manage.py spectacular --validate --fail-on-warn` remains available, including with production settings; protect any exported schema file as an operator artefact.

Access and refresh JWTs must include an integer `token_version` matching the account's current version. Missing, null, boolean, float, string and mismatched versions are rejected with 401. Existing legacy sessions without this claim must sign in again after deployment; normally issued current tokens continue working. Password changes revoke earlier access and refresh tokens through the existing account version increment.

Production also requires an explicit `redis://` or `rediss://` `REDIS_URL`. The default Django cache uses this shared Redis with a domain-specific production prefix. Public receipt requests keep their existing limit of 60/minute per client IP, and store creation keeps 5/day per owner; workers and replicas now share the same history. Support keeps its separate cache alias/prefix, and login keeps its existing Redis keys. Redis must remain available; there is no fallback to local counters. These existing DRF throttles use non-atomic cache operations, so simultaneous bursts can still exceed the nominal limit; this change does not provide strict concurrency control or DDoS protection. [DRF throttling behavior](https://www.django-rest-framework.org/api-guide/throttling/).

The backend readiness probe runs `python -B healthcheck.py` every 15 seconds, with a 10-second Docker timeout, a 120-second startup grace period and three failure retries. Its private `GET /api/v1/internal/health/ready/` endpoint accepts only the actual loopback peer, independently of forwarded headers. It performs a read-only PostgreSQL `SELECT 1` on a separate connection and a Redis `PING`; it returns `200 {"status":"ready"}` or `503 {"status":"not_ready"}` without credentials or exception details. Responses are not cached. PostgreSQL connect/statement timeouts and Redis socket timeouts apply only to the probe, and connections are closed afterwards. The lightweight HTTP checker uses no proxy, follows no redirect and accepts only the expected JSON response.

On initial Compose startup, worker, beat, bot and frontend wait for the backend's `service_healthy` state. Later dependency failures mark the backend unhealthy, and readiness recovers when the dependency returns; this does not automatically restart containers, stop already running workers or send external alerts. These are separate operational tasks. [Compose startup and health conditions](https://docs.docker.com/compose/how-tos/startup-order/).

After a separately approved server deployment, inspect the state or run the probe inside its container:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml exec ilbi python -B healthcheck.py
```

The probe prints only `ready` (exit 0) or `not ready` (exit 1). The endpoint is blocked at the public HTTPS edge and also rejects non-loopback socket peers. Readiness covers the database connection and Redis response; release migrations and external service checks remain separate requirements.

HSTS initially applies only to the canonical domain for one hour (`SECURE_HSTS_SECONDS=3600`, set in the root production environment). Increase it after verifying HTTPS and certificate renewal. `includeSubDomains` and browser preload are deliberately disabled until every affected domain is ready; Django `check --deploy` therefore reports the corresponding two advisory warnings. Do not enable preload just to remove these warnings.

For local regression checks, run `cd backend && uv run pytest apps/core/tests/test_production_settings.py -q`.
Shared-counter integration checks are in `apps/core/tests/test_shared_throttles.py`: they need Docker and an already available `redis:7-alpine` image, start a disposable Redis on a random loopback port, and exercise production throttles in separate Python processes without using an application database. See [the test guide](backend/README_TESTS.md).
Readiness checks are in `apps/core/tests/test_readiness.py`: they use a separate production WSGI process and new synthetic PostgreSQL/Redis containers, then stop/restart each test dependency to verify failure and recovery without using application data.
From the repository root, `python -m unittest discover -s tests/deployment -v` checks the rendered Compose configuration, a real isolated Nginx TLS edge, and encrypted backup/recovery against a synthetic PostgreSQL database. It requires Docker, OpenSSL, GnuPG (`gpg` / `gpgconf`) and already available `nginx:alpine`, `python:3.12-slim` and `postgres:16-alpine` images. It creates temporary test certificates/containers, uses no application database, and removes its resources afterwards.

[Encrypted data backup and recovery](docs/DATA_BACKUP_RESTORE_UZ.md) covers the PostgreSQL 16 database, local media and editable docs. The utility requires stopped writers and restores only into new isolated resources. MinIO storage needs a separate backup adapter. Production scheduling, off-server copies and actual server activation remain separate deployment tasks.

The existing backend entrypoint still applies migrations and collects static files; restructuring startup is a separate release task.

For optional MinIO storage, set `USE_MINIO=True` in the backend environment, use matching MinIO credentials in both environment files and add `--profile minio` to the Compose command. Startup creates the private media bucket if needed; browser image URLs use `/media/` through the application proxy.

Existing media and database volumes must be retained or migrated when switching layouts. The production retail POS remains disabled until the already required fiscal provider integration is configured.

Cash shifts now open explicitly. The previous counted balance is offered as the next opening balance; entering `0` starts an empty cashbox. Owners grant cashbox actions and purchase-cost visibility in the employee permissions form. Legacy debt payments whose cash/card tender was never recorded remain ledger corrections and are not guessed as cash income.

Customer debt can have an optional **Qarzni qaytarish sanasi** in nasiya checkout or customer create/edit in **Qarzlar**. It applies to the customer's total outstanding UZS/USD balance. Leave it empty to keep the existing behavior. On that date (Asia/Tashkent), the owner receives one in-app notification with the remaining balance and a link to the customer. The server checks every five minutes; the desktop also checks when refreshing the owner's notification feed, including offline. Missed dates are caught up when the app is opened. Changing the date schedules a new reminder, clearing it cancels the schedule, and full repayment/void clears it automatically. Partial repayment keeps the date. Reading or deleting a notification does not send it again. Deadline edits participate in offline conflict detection. Apply sales migration `0019` and update desktop installations together with the server because the replica schema changes.

---

## Documentation

Full architectural documentation, guides, and policies are available in the [`docs/`](docs/) directory:

- [Documentation Index](docs/README.md)
- [Platform Admin Guide](docs/qollanmalar/platform_admin_qollanma.md)
- [Store Owner Guide](docs/qollanmalar/owner_qollanma.md)
- [Staff Guide](docs/qollanmalar/staff_qollanma.md)
- [Terms & Conditions](docs/hujjatlar/foydalanish_qoidalari.md)
- [Privacy Policy](docs/hujjatlar/maxfiylik_siyosati.md)

---

## License

Copyright (c) 2026 ILBI. All rights reserved. See [LICENSE](LICENSE) for details.

## Support and current guides

`/support` is available to visitors and signed-in users. It provides Uzbek, Russian and English support UI, private conversation history and image attachments. Platform administrators use the same route as an operator inbox. Public contacts are +998770212149 and @abdulxadiy_0; bot login uses @ilbi_bot. AI is not enabled in this release.

See [support setup and API](docs/SUPPORT.md) for Telegram recipient configuration and [documentation index](docs/README.md) for concise role guides and focused, annotated screenshots. After updating, apply backend migrations and rebuild the frontend.

Retail POS currently accepts UZS only. Production retail sales are blocked pending fiscal provider integration; the guide screenshots use synthetic demo data. USD catalog values and the currency calculator do not enable USD retail checkout.

## CBU exchange rates

In **Sozlamalar → Valyuta & Kurs**, each store can enable **CBU kursidan avtomatik foydalanish**. USD calculations then use the latest effective official rate; manual editing is blocked by the API and UI. Turning it off restores the store's saved manual rate. Existing stores start in manual mode. Official USD/EUR/RUB rates, their effective dates and last successful check times are shown together; EUR/RUB are informational.

After deploying this change, run backend migrations, rebuild the frontend, and restart the Celery worker and Beat. Initialize the shared rates once from the backend environment:

```bash
python manage.py migrate
python manage.py sync_cbu_rates
```

Celery Beat schedules `apps.tenants.tasks.sync_cbu_rates_task` hourly, with retries after source failures. Requests use CBU's date-specific JSON endpoint for the current Asia/Tashkent date. All three currencies are validated and stored atomically, normalized by `Nominal`. Future rates are not applied early; weekends/source outages retain the latest effective rate and its actual date. If no effective USD rate has been fetched, enabling automatic mode is rejected.

`Tenant.usd_rate` remains the saved manual rate in the database. Tenant API responses expose the effective rate as `usd_rate`, the saved value as read-only `manual_usd_rate`, the selected `auto_usd_rate` flag and `usd_rate_source`, and read-only `cbu_rates`. In automatic mode, omit `usd_rate` from PATCH requests, including unrelated settings saves. Debt conversions save the applied rate, source, effective date and converted UZS amount; historical operations are never recalculated using today's rate. Older records retain their original notes without inventing a missing rate.

Validation: `cd backend && .venv/bin/python -m pytest apps/tenants/tests/test_exchange_rates.py -q`; `cd frontend/ilbi && npm run test:currency`.

## Unified activity history

Owners and platform administrators have a **Tarix** sidebar entry at `/history`. The read-only timeline combines existing sales, standalone stock movements, debt payments, cash income/expenses, shift openings/closings and audit records. It supports server pagination, category, text/actor search and Asia/Tashkent date bounds. Owners remain restricted to the selected tenant; administrators may filter by `tenant_id`. Ordinary staff cannot read this consolidated financial and administrative history.

`GET /api/v1/audit/history/` returns the timeline. `GET /api/v1/audit/history/{source}/{id}/` returns a scoped detail record, including the same sale serializer used by receipts. The frontend reuses the thermal receipt and A4 components. Sale-linked stock lines and the existing stock-adjustment audit entry are omitted from duplicate timeline representations.

Successful catalog API mutations now record actor, object name and before/after snapshots in the existing immutable audit journal, in the same transaction as the mutation. Deleted product snapshots remain readable; failed and no-op edits do not create events. Price-only edits retain their existing price-change audit. Existing sales/movements are immediately available; edits that were never recorded before this release cannot be reconstructed. Apply `core.0014_catalog_history_actions` through the normal migration process and rebuild the frontend.

Validation: `cd backend && .venv/bin/python -m pytest apps/core/tests/test_history_api.py apps/catalog/tests -q`; `cd frontend/ilbi && npm run test:history`. Browser QA uses synthetic data and covers receipts/A4, intake/edit details, filtering/pagination, tenant switching with delayed replies, errors and mobile/light/dark layout.

## ILBI rebranding and existing deployments

Backend source is in `backend/`; frontend source is in `frontend/ilbi/`. The master plan is `ILBI_MASTER_PLAN.md`; the implementation checklist is [REBRANDING_AUDIT_ILBI_UZ.md](REBRANDING_AUDIT_ILBI_UZ.md). UI, loading, print, email and Telegram branding use ILBI / ilbi.uz without a PRO product badge.

For existing Docker installations, pin `COMPOSE_PROJECT_NAME` and the resource mapping in the ignored root `.env`. `ILBI_NETWORK_NAME` / `ILBI_NETWORK_EXTERNAL` and `ILBI_VENV_VOLUME` / `ILBI_VENV_EXTERNAL` allow reusing the original network and dependency volume. Existing PostgreSQL roles/databases and media buckets can retain their configured names; changing env text does not rename stored data. The backend service is now `ilbi`, with a temporary legacy DNS alias for internal clients. `FRONTEND_PORT` selects the Docker frontend port if a native Vite server already uses 5173.

Domain TLS/DNS and sender-domain verification are deployment tasks. Existing local SMTP credentials and its verified sender address are retained with the ILBI display name; the default/example sender for a new installation is `ILBI <noreply@ilbi.uz>`.
