# Support module

Updated: 2026-10-14. The module provides guest and authenticated operator conversations. AI is intentionally not connected in this release.

## Setup

Apply migrations with the normal backend deployment. `apps.support` and `/api/v1/support/` are registered in settings and the API router. No extra Python or runtime frontend dependencies are required.

```bash
cd backend
uv run python manage.py migrate
```

When source files are bind-mounted into a running development container, Gunicorn reloads Python code but does not rerun the startup migration command. After adding the support app to an already running stack, apply its migration explicitly:

```bash
docker compose exec -T ilbi python manage.py migrate support --plan
docker compose exec -T ilbi python manage.py migrate support --noinput
```

A missing support table returns `503` with `error.code = support_not_ready` and `Retry-After: 30`, rather than an uncontrolled 500. Other database programming errors retain their normal error behavior. Schema changes are never applied from an HTTP request.

The existing Redis service is used for shared support rate limits. Celery worker delivers Telegram notifications; chat persistence does not depend on successful notification delivery.

Environment variables in `backend/.env`:

```dotenv
SUPPORT_PHONE=+998770212149
SUPPORT_TELEGRAM_USERNAME=abdulxadiy_0
SUPPORT_OPERATOR_PHONES=+998770212149
```

`SUPPORT_OPERATOR_PHONES` accepts comma-separated phone numbers. Each recipient must share their own contact with the bot configured by `TELEGRAM_BOT_TOKEN`. Contacts linked to a different bot or a group ID are excluded. `FRONTEND_URL` must be the real frontend origin so notification links work. Notifications contain language and an authenticated panel link, without names, messages, images or guest credentials. A phone number or Telegram username alone does not enable bot delivery.

Working hours have not been configured; the UI states this and does not claim operators are online. Operators are active accounts with role `platform_admin`.

Outside explicitly enabled local demo mode, tagged demo administrators are excluded from Telegram delivery. This applies to saved personal/group preferences, queued test notifications and legacy operator-phone recipients, even if their account remains active in the database.

## Routes and access

| Route under `/api/v1/support/` | Access |
| --- | --- |
| `metadata/` | Public contacts, languages, image limit and AI-disabled flag |
| `guest/` | Guest's own paginated conversations; POST starts a conversation |
| `conversations/` | Authenticated user's own conversations; POST starts one |
| `inbox/` | Platform administrators; optional `status` and `mine=true` filters |
| `<collection>/<uuid>/` | Detail; POST `action` = `read`, `claim`, `close`, `reopen` |
| `<collection>/<uuid>/messages/` | GET history; POST a text/image message |
| `<collection>/<uuid>/messages/<id>/image/` | Private image after conversation ownership check |

Guest requests use `X-Support-Token`, a cryptographically random 32-byte lowercase hex value created and persisted in browser local storage. Only SHA-256 is stored in the database. Tokens never appear in URLs or list responses. Guest endpoints deliberately ignore stale login authorization, keeping support reachable when login fails. They never grant account or tenant privileges. Signing in does not automatically merge a guest conversation into an account.

An authenticated conversation belongs to its author, regardless of shared tenant membership. A supplied `X-Tenant-ID` is checked against active membership before it is attached as optional context. Support itself does not require an active tenant, so users who cannot access a shop can still ask for help.

## Conversation behavior

- States: `waiting → active → closed`. Reopening clears the assignment and returns to `waiting`.
- Operators must claim a chat before replying. Database row locking prevents two operators claiming the same chat; a conflicting request receives 409.
- Another assigned operator's chat is readable by the team, but cannot be replied to or closed by them.
- A visitor may close or reopen their own conversation. `claim` is an operator-only action.
- List responses include per-thread unread counts and `unread_total` over the full filtered collection, not only the current page. Read markers only move forward.
- Message history returns 50 items and `has_more`. Use `before_id` for older items or `after_id` for incremental updates; they cannot be combined.
- Browser polls active chats every five seconds, list every 15 seconds, and the global unread launcher every 20 seconds after successful reads. Reads never overlap within a poller. Failures increase the interval to at most two minutes, while server Retry-After instructions are respected. Manual retry can resume immediately; hidden tabs pause polling.
- Message POST requires a client-generated UUID `client_id`; retries in the same conversation return the existing message. The browser retains that ID on a failed send.

Limits: 4,000 characters per message, 160 per subject, 100 per visitor name, five open conversations per identity, 120 requests/minute and 20 writes/minute per authenticated user or guest IP. Guest limits use the last address appended to `X-Forwarded-For`. Keep the backend accessible only behind the trusted reverse proxy; client-supplied prefixes do not change the limit identity.

Images: PNG/JPEG/WebP, up to 2 MB and 16 megapixels. Pillow validates and re-encodes to a resized JPEG with metadata removed. Small attachments are stored privately in the database, avoiding the public `/media/` route. List/history queries defer binary data. Include attachment storage in database capacity and backup planning; retention is not automatically enforced in this release.

## Documentation

The public help guides `yordam_uz`, `yordam_ru` and `yordam_en` supplement role-gated guides. Detailed role manuals remain in Uzbek. The support UI is translated into all three languages; this does not translate messages automatically.

Focused synthetic screenshots are in `docs/rasmlar/focused`. `/api/v1/docs/images/<filename>.png` serves only that directory and a restricted PNG filename. Markdown uses `../rasmlar/focused/<filename>.png`; the viewer opens an enlarged dialog with zoom controls.

## Validation

```bash
docker compose -f backend/docker-compose.test.yml up -d
cd backend
uv run pytest apps/support/tests apps/accounts/tests/test_terms_and_docs_views.py
cd ../frontend/ilbi
npm run build
npm run lint
npm test
```

The support tests cover guest/account isolation, stale authentication on guest routes, tenant spoofing, operator conflicts, status transitions, message retries, history cursors, read markers, upload validation, private images, rate limits and Telegram recipient filtering. Browser verification should also exercise guest request → operator claim → reply → guest reload, all languages, mobile sizing and image enlargement.

## Future AI boundary

AI will use approved documentation, filtered by the requester's role; guests must not receive administrator-only guides. Provider, hosting, retrieval, costs and data policy are not selected here. No financial operations or tenant database access have been added for AI. Operator chat is usable independently.

### Regenerating focused screenshots

`scripts/capture_guides.cjs` captures actual UI regions and adds SVG arrows/number labels in the browser before taking each PNG. It does not manufacture screen contents. It also checks guest → operator replies, language switching and mobile persistence, and writes `docs/rasmlar/focused/manifest.json`.

Use a disposable backend with `config.settings_test`-based settings, synthetic data from `seed_demo_platform`, disabled external email/Telegram delivery, and a Vite preview targeting that backend. Never point the script at a real customer instance. The script expects seeded `demo_owner` and `demo_admin` sessions in a private JSON file with this structure:

```json
{
  "demo_owner": {"tokens": {"access": "demo JWT", "refresh": "demo JWT"}, "user": {}},
  "demo_admin": {"tokens": {"access": "demo JWT", "refresh": "demo JWT"}, "user": {}}
}
```

Obtain `tokens` with `issue_tokens()` and `user` with `UserProfileSerializer()` only from that synthetic database. Do not commit the sessions file. Install Playwright in a separate tooling directory or make it available through `PLAYWRIGHT_MODULE`.

```bash
ILBI_DOCS_AUTH_FILE=/tmp/ilbi-docs-sessions.json \
ILBI_DOCS_BASE_URL=http://127.0.0.1:5177 \
PLAYWRIGHT_MODULE=/path/to/tooling/node_modules/playwright \
CHROME_PATH=/path/to/chrome \
node scripts/capture_guides.cjs
```

If `CHROME_PATH` is omitted, Playwright uses its installed browser. Review every crop after a UI change: a passing screenshot command alone does not establish that a guide image is useful.

### Development hot updates and recovery

`AuthContext.jsx` exports the provider component; consumers import `useAuth` from `hooks/useAuth.js`. The context object lives in `context/authContext.js` and preserves its identity across Vite updates. Keep hooks and context creation outside the provider's component module so a development update cannot leave consumers attached to a different context object.

The app error boundary reloads the page without clearing local storage. Do not clear browser data as a routine repair: it also removes the guest support credential, remembered sessions and local drafts.

## ILBI screenshots and bot profile

The 16 current focused PNG guides are regenerated with `scripts/capture_rebranding_guides.mjs` against an isolated synthetic preview. Set `ILBI_DOCS_AUTH_FILE` to a private fixture file containing `_meta.synthetic=true` and the matching `_meta.origin`; never use real account sessions. The script also verifies mobile login, both loading themes and reduced motion. Unused old full-screen screenshots and their duplicate public copies were removed; the documented `/api/v1/docs/images/` endpoint continues serving focused images.

`branding/ilbi-bot-profile.json` is the reviewed public profile for `@ilbi_bot`. `scripts/update_bot_branding.py` checks the bot identity before applying names, descriptions, commands and avatar; matching updates are skipped. Credentials stay in ignored env files and no chat messages are sent by this command.
