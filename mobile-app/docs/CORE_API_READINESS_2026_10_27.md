# Core mobile API readiness — 2026-10-27

The owner reported non-working history, statistics, profile and other mobile modules. Inspection confirmed that Reports, Inventory, Documents and Debts returned an explicit production placeholder, Customers had only a preview initial list and no production GET, and profile/history had no destination screens. Existing financial/account/store safeguards must remain.

## Reports, profile and history slice

Implemented real analytics with the backend's accepted `today`, `this_week`, `this_month`, `this_year` periods and actual KPI/`sales_chart` shape. Saved Z reports are separately read from `/cashbox/reports/` and its detail endpoint. PDF export re-reads the selected authoritative report, requires `is_closed`, checks unchanged auth scope and escapes server text. An analytics summary cannot masquerade as a finalized fiscal Z report or close a shift.

Profile uses `/auth/profile/` GET/PATCH, exposes only backend-editable personal fields, performs inline field validation and refreshes authoritative authentication profile after save. Password change uses `/auth/change-password/` and clears the revoked old session on success. Account identity/phone/username cannot be overwritten through the personal-data form.

History uses the owner-restricted `/audit/history/` list and `/audit/history/<source>/<id>/` detail, including the actual composite event identifier and `details.fields/changes/note` envelope. Account/store/query-scoped reads abort or reject superseded results, present retryable errors and never turn failures into invented zero data.

Actual first-slice verification: `npm test -- --silent tests/coreReadiness.test.tsx` **6 tests passed**. Coverage includes backend-shaped periods/KPI, malformed data rejection, finalized-report/HTML-escape rules, invalid-email/no-PATCH then valid profile update, password-change logout, real history detail envelope and late results after a store switch. These are component/source tests using controlled API responses, not a native installation, production-account mutation or server acceptance. An initial command run from the parent directory failed to find package.json; the actual passing command ran from `mobile-app/`.

Versioned SDK 58 [reference](https://docs.expo.dev/versions/v58.0.0/), [Print](https://docs.expo.dev/versions/v58.0.0/sdk/print/), [Sharing](https://docs.expo.dev/versions/v58.0.0/sdk/sharing/) and [Router introduction](https://docs.expo.dev/router/introduction/) were consulted before API changes. No dependency or native/project version was changed by this slice.

Further slices and final validation are recorded below when actually completed. Full parity/native production acceptance is not implied.

## Customers, debts, stock and documents slice

- Customers now reads paginated `/sales/counterparties/` with server search/debtor filters and **store-wide server summary**, then uses actual POST/PATCH for create/name/note editing. Missing balances cannot silently become zero. Invalid name/phone/backend fields render inline. Account/store changes remount editor state.
- Debts uses the same authoritative debtor list/summary with UZS and USD separately. A payment re-reads the live balance, parses exact minor units, sends decimal amount/currency/cash-card method with a durable original key and checks unchanged auth scope. The accepted response must identify the correct customer, currency and amount. Local acknowledgment failure offers a **local-write-only retry**; it never repeats a second payment POST. Uncertain results retain the journal. No optimistic balance subtraction is used; the server is reloaded.
- Inventory reads real `/inventory/stock/`, filtered/searchable paginated rows, plus `/inventory/movements/` and `/inventory/batches/` for the selected variant. Missing cost/supplier fields are never fabricated; both existing permissions and server redaction are respected. Batch dates/expiry state and decimal units are retained. Stock mutations/reconciliation are a separate remaining slice.
- Documents now lists real paginated `/sales/` with search and payment filter, preserves UZS/USD, and opens the existing saved receipt/share/PDF flow. The fake invoice/signature fixtures and non-working production gate are removed. This does not invent an authoritative signed-invoice backend.
- Home analytics and recent sales load independently under account/store/query scopes, refresh after successful related mutations, retain actual currency and link to the appropriate statistics/documents destination. Its bell is the separately implemented real notification component. Settings links to profile and official downloads, reads the installed native version and exposes server override controls only during development. A malformed development server URL is validated **before** logout.
- Historical receipts and PDF HTML now preserve USD instead of hardcoded UZS/so‘m. Returned/cancelled status, refund/net amount and actual VAT amount are visible where provided by the server; no amount is inferred from another currency. A regression checks the USD/refund/tax screen and generated HTML (mocked native PDF adapter).

Actual component checks: **29 tests passed** across `coreReadiness.test.tsx`, `debts.test.tsx`, `pagedScreens.test.tsx` and `receipts.test.tsx`. The old debt tests that only performed arithmetic on a fixture array were replaced with real screen/transport-boundary tests. Checks include actual page-2 queries and store-wide summaries, missing cost redaction, USD document routing, wrong/overpaid amount blocking, live balance re-read, exact USD/card payload, original-key acknowledgment and local-write-only retry, and stale auth scope rejection. Native OS file generation/sharing, installation and business acceptance were not exercised. Final scoped strict ESLint and whole mobile TypeScript both passed after the receipt changes.

## Actual backend handler/ORM verification

New suite: `backend/apps/core/tests/test_mobile_api_readiness.py`. Actual run: **12 passed in 15.29s** against a separate disposable PostgreSQL test database `test_ilbi_mobile_core` on the existing isolated local test server at `127.0.0.1:55443`. Derived temporary settings reuse `config.settings_test` through the notification test settings, select a different database from that peer's tests, use local test caches and keep mobile push disabled. No production database, user, provider or emulator was used.

Real Django APIClient/ORM checks prove:

1. All four analytics periods return the consumed KPI/`sales_chart` shape and exclude another tenant's 9,999.00 sale.
2. Profile updates normalize contact phone, retain immutable identity/role, reject malformed email and preserve the last valid email.
3. Password change increments `token_version` and an actual previously issued JWT receives HTTP 401 afterward.
4. Customer page 1/page 2 and store-wide summaries agree with database balances; create/edit return the consumed shape.
5. A USD/card debt payment replay with its original idempotency key returns the same payment ID and creates exactly one database payment.
6. Stock/movements/batches return actual decimal quantities; a staff stock viewer receives neither protected costs nor supplier fields.
7. Timeline composite IDs and `details.fields` match the mobile parser, saved receipt item names/currency are preserved, and foreign receipt/history IDs return 404.
8. Z reports are actual saved closed records with server amounts; another tenant's report returns 404.
9. Ungranted staff cannot read commercial modules, platform admin cannot read shop analytics, and anonymous profile access is 401.

The initial API run used the existing local virtualenv on Django **6.1.2**. A peer initially confused the pyproject minimum **6.0.7** with the frozen lock, then verified that `backend/uv.lock` and a clean `uv sync --locked` both install Django **6.1.2**; there is no established Django-version mismatch. A repeat using that clean locked environment is recorded separately when completed.

Raw result: [backend-api-tests.txt](evidence/core-api-2026-10-27/backend-api-tests.txt). These are real local handlers/database operations, **not production network, FCM/APNs delivery or native device acceptance**.

## Production-readiness delta after this slice

The original 131-finding audit remains the exhaustive backlog. Removing placeholder screens does not complete all business workflows. Immediate priorities still include:

| Priority | Finding(s) | Concrete remaining work / reason |
| --- | --- | --- |
| P0 | DMP-127, native/external gates | Existing dependency security findings, signed native acceptance, physical ARM64/iOS, actual FCM/APNs delivery and production deployment/migrations must be verified separately. Passing source/DB checks alone is insufficient. |
| P0/P1 | DMP-009–011 | Documents currently supplies basic sales list/payment/search/pages. Dedicated sales status/date filters and full/partial cancellation with authoritative reason, original quantities and durable uncertain-outcome recovery remain the next financial slice. |
| P1 | DMP-015 | Mixed payment is explicitly disabled in Checkout. The backend sale input accepts one `payment_type`; simply enabling the toggle would create unsupported accounting. Requires an authoritative split-payment contract and financial tests. |
| P1 | DMP-027–032 | Stock read/movements/batches now work; reconciliation, rapid intake, customer/supplier returns, write-offs, transfers/discrepancy and the dedicated deficit workflow remain. Their writes require durable transaction/recovery coverage. |
| P1 | DMP-034–039 | Name/note customer editing and real collection work. Archive, due-date/code details, purchase/payment ledgers, import, credits/refunds and correction/branch/note workflows remain. Currency and cash/card selection alone do not complete all payment administration. |
| P1 | DMP-040–046 | Saved Z reports are connected; opening/closing/counting shifts, income/expenses and B2B accept/reject/partial/return/discrepancy remain separate actual APIs. Never substitute analytics for a closed shift. |
| P1 | DMP-065–068 | Real saved receipts/PDF are available with corrected currency/refund/tax labels. Authoritative A4 invoice identity, sender/receiver signatures and a server signing workflow are not established by the former prototype. Fiscal SDK/provider acceptance and full receipt metadata require explicit coverage. |
| P1 | DMP-003,008,063–064 | Personal profile/password works; avatar selection/upload/delete remains. Analytics has four real periods; custom date ranges, profitability/top-product/cashier exploration remain. Timeline has categories/search/pages/detail, while advanced actor/date audit filters/snapshots remain. |
| P1/P2 | DMP-047–056,061–062 | Team permissions/invitations, seller/store administration and settings, owner Telegram/report settings, reminders/global search/favorites and broader platform-admin workflows remain. AdminHome currently only reads overview counts/activity. |
| P0/P1 | DMP-077–082 and local gates | Existing durable sale/debt recovery must retain original account/store/server keys and data. Unscoped legacy outbox is deliberately blocked; do not enable replay or erase records to make offline tests pass. Additional stock/B2B/financial operations need their own recovery contracts. |

No emulator was touched, no app/platform version was bumped by this agent, and no production server or Git commit/push was performed by this agent. Root coordinates integration, browser checks, incremental commits and any release.
