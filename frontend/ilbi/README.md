# ILBI frontend

React/Vite interface for the ILBI sales platform. Updated: 2026-10-20.

## Development

From this directory:

```bash
npm ci
VITE_API_TARGET=http://127.0.0.1:8000 npm run dev
```

Vite proxies `/api` and `/media` to `VITE_API_TARGET` (default: `http://localhost`). Use the root Docker Compose setup when the backend, proxy and frontend should start together. Production builds use the production stage in this directory's Dockerfile.

```bash
npm test
npm run lint
npm run build
```

`npm run test:camera` runs Chrome/Chromium against generated barcode video frames, covering the scanner lifecycle and all five camera entry points in POS, catalog and inventory intake. It uses mocked API responses and requires neither a physical camera nor a backend. Set `CHROME_PATH` if Chrome is installed outside the standard locations.

`npm run test:labels` checks the enlarged label preview, mandatory barcode digits, optional product name, actual print dimensions and decoding of the printed barcode. Existing product barcodes are preserved; explicit generation for products without a code creates a numeric barcode.

`npm run test:selections` checks product/category dropdowns in Chrome with synthetic data: viewport placement, clipping and transformed containers, older-browser fallback, long labels, fixed search/pagination, keyboard and pointer behavior, inventory return/adjust/write-off dialogs, rapid intake, catalog and B2B mapping. It covers desktop, mobile and short landscape windows without writing inventory data. Selection menus use the browser top layer when available and a dialog-aware portal otherwise.

`npm run test:auth-session` drives the actual app in an isolated Chrome profile with synthetic API responses. It covers login/chat privacy, password plus OTP, failed session verification and retry, late responses, logout/storage events, POS cart/payment drafts, shop switching and product form/image restoration. It never sends a real OTP, support message or sale.

Camera capture requires HTTPS (or localhost for development) and browser camera permission. The shared scanner releases its stream and closes as soon as it reads a code; its decoder loads only when the camera is opened.

## Desktop workspaces

The separate layout icon beside the theme control switches between the original sidebar and the fast top navbar. The choice is stored per account. Both layouts share the same mounted route, cart, form state, shop selection, shift controller and notifications. The fast layout loads its search, tools and dashboard on demand; smaller screens use the existing sidebar without losing the desktop preference. Transitions respect reduced-motion preferences and work without the View Transitions API.

The navbar contains every sidebar destination, favorites/recent pages, permission-aware quick actions, search (`Ctrl/⌘+K`), calculator, fullscreen, theme, profile and logout. Search opens real product/customer/receipt records through the existing pages. Reminders are stored on the server per shop: owners can assign active members, while staff can see their assigned or self-created tasks. Deadline indicators refresh while the app is open; external push/email/Telegram reminders are not configured by this feature. Apply backend migrations before using reminders.

Actual browser captures with synthetic QA data: [light workspace](../../docs/rasmlar/workspace-fast-light.png), [dark workspace](../../docs/rasmlar/workspace-fast-dark.png).

`npm run test:workspace` runs the real UI against an isolated Django/PostgreSQL QA database. Setup is documented in [README_TESTS.md](../../backend/README_TESTS.md#desktop-workspace-browser-test). The test checks route parity, repeated layout switches, request reuse, POS cart/form preservation, search, quick actions/imports, reminders CRUD, tenant/role isolation, reload persistence, reduced motion and screen sizes. It creates synthetic records only.

## Routes and access

`App.jsx` defines public entry pages, authenticated layout routes and role gates. Account state comes from `context/AuthContext.jsx`; consumers use `hooks/useAuth.js` and the stable context object is in `context/authContext.js`; active shop context comes from `TenantContext`. The API checks permissions independently of frontend navigation.

An explicit visit to `/login` clears the previous browser authentication and starts a fresh login flow. The public landing page and its login links keep their existing behavior. Remembered sessions still restore on protected routes after server profile validation; offline/failed validation offers retry without exposing cached account data. Chat, dialogs, notifications and in-flight responses are isolated across authentication changes. Login help uses a fresh guest capability, retained for expansion to `/support`; it never inherits old account or guest conversation history.

POS cart and checkout inputs, new product/category forms (including product image), bulk intake and inventory adjustment/return/write-off drafts are scoped to the authenticated account and shop. Text is saved on each change in browser storage, images in IndexedDB. Logout preserves these drafts, and restoration never submits a transaction. A successful save or explicit clear stores an empty draft so older backups cannot reappear. Identifiable legacy drafts migrate only to the previously cached matching account and its shops; originals are retained. Unattributed old drafts remain stored without being shown to the next account. Browser storage is not an encrypted backup: clearing site data loses drafts, and local device/browser access is outside this UI isolation guarantee. Storage failures show a warning.

- `/login`: username/phone/email, password and Telegram OTP; includes a public help link.
- `/support`: public help center; guests and signed-in users have private conversations. Platform administrators see the operator inbox. UI languages: Uzbek, Russian, English.
- `/docs`: guides and documents filtered by role. Administrator editing writes the corresponding backend Markdown file.
- `/pos`, `/catalog`, `/inventory`, `/sales`, `/debts`, `/b2b`, `/shifts`: operational pages; access and buttons depend on role/permissions.
- `/my-tenants`, `/tenants`, `/seller-profiles/review`, `/employees`, `/services`, `/audit`: relevant owner/admin workflows.

The global help launcher shows unread support replies. On POS, help is a header link so checkout remains unobstructed. Support requests do not automatically inherit a stale tenant header; new conversations attach the active authorized shop only when available.

## Documentation images

`MarkdownViewer` renders the current guides and resolves known Markdown document links into the help center. `DocImage` opens focused PNG screenshots in a native dialog with zoom and keyboard dismissal. Images come from `/api/v1/docs/images/` and use synthetic demo fixtures.

The source documentation is in [docs](../../docs/README.md). Support endpoint/setup details are in [SUPPORT.md](../../docs/SUPPORT.md). The capture script is `scripts/capture_guides.cjs` at repository root.

## Current product limits

Retail POS uses UZS; the USD calculator is informational. The backend currently blocks production retail sales pending fiscal integration. AI support has not been connected. Role guides remain in Uzbek; translated public starter guides and the support interface cover all three supported languages.

## Development recovery

If the support app was added while Docker services were already running, apply its migration with `docker compose exec -T ilbi python manage.py migrate support --noinput` from the repository root. Backend source reloads do not apply schema changes.

A failed support read backs off instead of issuing overlapping repeated requests. The retry button resumes reads. For a development render error, reload once; the recovery button preserves local sessions, guest chat access and drafts.

## ILBI identity

`IlbiLogo.jsx` and the opening use the same vector paths in `src/components/common/ilbi/logo.js`. Product branding has no PRO badge. `public/brand` contains generated SVG, email PNG and touch/avatar exports; regenerate with `node scripts/build_brand_assets.mjs --png` from the repository root.

`brandStorage.js` preserves legacy sessions, tenant drafts, pending checkout keys and guest conversations. Both storage namespaces stay synchronized during the compatibility period; logout clears both. Do not remove compatibility keys until the rollback period is over.

The application uses noindex/robots restrictions for operational and receipt pages. It does not install a PWA or publish a private-data sitemap.
