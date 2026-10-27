# ILBI Desktop ↔ Mobile — Detailed parity audit

Audit date: 2026-10-24 (Asia/Tashkent). Baseline Git HEAD: `8ad308a7f755720bb7c4656eec53ef06c69433bb`.

Status: **COMPLETE — source comparison and available checks; native/real-backend acceptance remains open**. Unique findings currently recorded: **131**.

<!-- IMPLEMENTATION_LEDGER_START -->
## Implementation ledger — live

**Working principle: implement → test → record evidence → advance.** The audit below is the historical baseline; this ledger records subsequent implementation. `TESTED_CODE` means the named automated/code checks passed, not native or production acceptance. `VERIFIED_RUNTIME` states the actual runtime used. `EXTERNAL_GATE` requires the stated external runtime/service; it is not completed.

| ID | Status | Latest evidence / remaining verification |
| --- | --- | --- |
| [DMP-001](#dmp-001) | TESTED_CODE | Explicit consent checkbox and sessionEntry business gate tested; legal document routes fetch server content. Auth/gates: 17 tests pass; tsc/lint pass. |
| [DMP-002](#dmp-002) | OPEN | Pending |
| [DMP-003](#dmp-003) | IN_PROGRESS | Real profile/password API, inline validation and logout/session isolation tested; avatar upload/delete remains. See CORE_API_READINESS_2026_10_27.md. |
| [DMP-004](#dmp-004) | OPEN | Pending |
| [DMP-005](#dmp-005) | TESTED_CODE | Profile failure shows retry/logout recovery; retry component and delayed profile-after-logout tests pass. |
| [DMP-006](#dmp-006) | TESTED_CODE | Validated membership selection, explicit multi-store gate, saved account/server-scoped choice, Home switch entry and store-choice UI tested. |
| [DMP-007](#dmp-007) | TESTED_CODE | 9 permission/checkout tests pass: active-membership grants, cross-store isolation, owner-only actions, admin separation and denied sale POST. Router guards and navigation/action checks added; tsc/lint pass. |
| [DMP-008](#dmp-008) | IN_PROGRESS | Four real analytics periods, KPI/chart and scoped loading connected; custom-date/profitability/drill-down parity remains. |
| [DMP-009](#dmp-009) | TESTED_CODE | Dedicated sales/customer/date/status/payment filters, pagination/detail:28 mobile and33 PostgreSQL cases; SALES_HISTORY_READINESS_2026_10_27.md. Native/deploy gate remains. |
| [DMP-010](#dmp-010) | TESTED_CODE | Reasoned full returns use per-dialog IDs, actor/store-bound receipts and original-key concurrency/rollback coverage; native financial acceptance pending. |
| [DMP-011](#dmp-011) | TESTED_CODE | Exact fractional item returns, remaining-quantity checks, actor-bound acknowledgements and retained completed keys tested;33 real sales backend cases. |
| [DMP-012](#dmp-012) | TESTED_CODE | Cart wholesale toggle uses configured partner prices, preserves negotiated overrides, persists mode and sends is_partner_sale. Cart persistence/quote tests verify mode, prices and missing partner configuration; tsc/lint pass. |
| [DMP-013](#dmp-013) | TESTED_CODE | Checkout re-reads selected live variants immediately before a new sale; stock reduction between opening checkout and confirming blocks POST. Quote/checkout suites: 21 tests pass; tsc/lint pass. |
| [DMP-014](#dmp-014) | TESTED_CODE | Catalog retains USD label and disables retail add; cart domain rejects USD and live quote checks current currency. USD screen/domain/quote tests pass. |
| [DMP-015](#dmp-015) | OPEN | Pending |
| [DMP-016](#dmp-016) | TESTED_CODE | Integer per-line VAT inclusive/exclusive totals, current tenant receipt settings and expected_tax_settings POST guard implemented. Fractional backend contract and VAT/checkout tests pass; backend receipt-tax suite passes. |
| [DMP-017](#dmp-017) | TESTED_CODE | Live expired_batches render their actual batch/date/quantity and require an explicit acknowledgement keyed to those warnings. Integration test blocks POST before consent and allows it afterward. |
| [DMP-018](#dmp-018) | TESTED_CODE | 199 mobile tests plus SDK58 permission introspection and host phone regression pass. Actual installed Android deny/grant dialogs and virtual preview work; Android camera registry verifies active→background closed→resume active→dismiss closed (camera.json). |
| [DMP-019](#dmp-019) | TESTED_CODE | Paged catalog and exact barcode mode implemented; pagination/real-shape screen tests pass, including complete barcode query; full Jest suite, tsc and lint pass. |
| [DMP-020](#dmp-020) | TESTED_CODE | 14 targeted mobile checks and 36 isolated PostgreSQL catalog/category API/service checks passed; Chrome created USD parent/child, followed category filter and deleted both with persistent tabs. tsc/strict lint passed. |
| [DMP-021](#dmp-021) | TESTED_CODE | 192 mobile tests, 37 real PostgreSQL catalog API/service tests and interactive Chrome product/variant create/edit flow passed. Actual receipt snapshots retain old names/prices after catalog edits. tsc/strict lint passed. |
| [DMP-022](#dmp-022) | TESTED_CODE | Actual backend accepts negotiated price below the advisory minimum and preserves old receipt prices; Chrome changed catalog default while existing cart kept its negotiated price. All 192 mobile tests passed. |
| [DMP-023](#dmp-023) | TESTED_CODE | Actual PostgreSQL product/variant archive and restore, archived POS exclusion and preserved stock/history on DELETE tested; Chrome lifecycle flow passed; read-only UI and confirmed rejection tests pass. |
| [DMP-024](#dmp-024) | OPEN | Pending |
| [DMP-025](#dmp-025) | OPEN | Pending |
| [DMP-026](#dmp-026) | OPEN | Pending |
| [DMP-027](#dmp-027) | TESTED_CODE | Real stock/movements, scoped search/pages and reasoned adjustment/recovery:61 inventory ORM/API and48 mobile tests. See INVENTORY_READINESS_2026_10_27.md. |
| [DMP-028](#dmp-028) | TESTED_CODE | Multi-line intake with actual supplier/invoice/cost/batch/expiry, persisted drafts and capability gate; once-only/rollback tested. Native acceptance pending. |
| [DMP-029](#dmp-029) | TESTED_CODE | Actual customer/supplier returns and write-off, batch selection/reasons and durable keyed receipts;61 inventory/48 mobile checks passed. |
| [DMP-030](#dmp-030) | TESTED_CODE | Real batch selection/expiry filters, exact quantities and protected supplier/cost visibility. Replays use current permissions; native acceptance pending. |
| [DMP-031](#dmp-031) | TESTED_CODE | Dispatch, mapped partial receipt, physical return and owner discrepancy closure; real concurrency/rollback/permission checks passed. No physical-return bypass. |
| [DMP-032](#dmp-032) | IN_PROGRESS | Real quantity sorting/expiry filters and notification-to-stock navigation work; dedicated deficit report/operational delivery remains. |
| [DMP-033](#dmp-033) | TESTED_CODE | Real paged customer list/search/store-wide debt summaries and basic create/edit;29 core mobile and12 API/ORM cases passed. |
| [DMP-034](#dmp-034) | IN_PROGRESS | Actual basic create/name/note editing connected; code/due-date/archive/delete lifecycle remains separate. |
| [DMP-035](#dmp-035) | OPEN | Pending |
| [DMP-036](#dmp-036) | OPEN | Pending |
| [DMP-037](#dmp-037) | IN_PROGRESS | Actual debtor search/summary and guarded collection/recovery work; overdue/soon/future filters and installed restart acceptance remain. |
| [DMP-038](#dmp-038) | TESTED_CODE | Exact UZS/USD cash/card/branch/note, authoritative quote, actor-bound ack and stale-balance/no-new-credit guard:83 backend,40 quote and16 UI checks plus journal tests. See DEBT_QUOTE_PROTOCOL_2026_10_27.md. |
| [DMP-039](#dmp-039) | OPEN | Pending |
| [DMP-040](#dmp-040) | TESTED_CODE | Real current/open shift, UZS/USD cash, stale report protection and original-key receipt protocol; cashbox45 mobile /12 PostgreSQL tests passed. Deploy/native gate remains; see CASHBOX_READINESS_2026_10_27.md. |
| [DMP-041](#dmp-041) | TESTED_CODE | Counted close/discrepancy/staff notes, reread changed totals, exact acknowledgement and atomic report/shift/inbox rollback tested; native acceptance pending. |
| [DMP-042](#dmp-042) | TESTED_CODE | Real paged income/expense lists and keyed writes, editable dates, source/category reuse scoped to server/account/store; cashbox45/12 tests passed. More list filter controls remain. |
| [DMP-043](#dmp-043) | IN_PROGRESS | Authoritative historical Z-report list/detail/PDF sharing connected and API/component tested. Full desktop layout variants, printer/native sharing acceptance remain; see CORE_API_READINESS_2026_10_27.md. |
| [DMP-044](#dmp-044) | TESTED_CODE | Actual scoped B2B incoming/outgoing lists, detail and escaped PDF;33 PostgreSQL/23 mobile checks and host Chrome flow passed. See B2B_API_READINESS_2026_10_27.md. |
| [DMP-045](#dmp-045) | TESTED_CODE | Permitted category/variant mapping, durable actor/payload receipts and exact1.250 acceptance verified by ORM and synthetic Chrome. |
| [DMP-046](#dmp-046) | TESTED_CODE | Reject, physical-return receipt and owner-only discrepancy closure have once-only stock/debt tests. Dispatched goods cannot be generically cancelled. |
| [DMP-047](#dmp-047) | OPEN | Pending |
| [DMP-048](#dmp-048) | OPEN | Pending |
| [DMP-049](#dmp-049) | OPEN | Pending |
| [DMP-050](#dmp-050) | OPEN | Pending |
| [DMP-051](#dmp-051) | OPEN | Pending |
| [DMP-052](#dmp-052) | OPEN | Pending |
| [DMP-053](#dmp-053) | TESTED_CODE | Actual manual/CBU settings and exact conversion, section-local PATCH/revision guard;40 settings/receipt mobile and73 backend checks. STORE_SETTINGS_READINESS_2026_10_27.md. |
| [DMP-054](#dmp-054) | TESTED_CODE | Real receipt/tax configuration and immutable saved identity/layout/server totals;40 mobile/73 backend and host persistence/snapshot checks. Native/fiscal acceptance remains. |
| [DMP-055](#dmp-055) | IN_PROGRESS | Actual Telegram/preferences form and explicit send/test confirmation connected; unknown outcomes guarded. No live Telegram acceptance send performed. |
| [DMP-056](#dmp-056) | IN_PROGRESS | Validated schedules/targets and manual action UI connected; invalid weekday/day rejected. Actual scheduled/manual delivery acceptance remains. |
| [DMP-057](#dmp-057) | TESTED_CODE | 222 mobile tests, strict lint/tsc, 19 PostgreSQL support tests, full host/Chrome regression and actual installed API 36 Android owner/guest sidebar flow passed; see SUPPORT_MOBILE_VALIDATION.md and support-* evidence. |
| [DMP-058](#dmp-058) | OPEN | Pending |
| [DMP-059](#dmp-059) | IN_PROGRESS | Operator inbox/claim/close/reopen/read-through and assignment-gated replies implemented; component checks reject replying to another operator’s conversation, and actual PostgreSQL support tests cover assignment. |
| [DMP-060](#dmp-060) | TESTED_CODE | Actual inbox/actions/deep links and recipient-safe direct FCM source, Firebase inputs validated;22 push plus57 activity backend checks. OS delivery/deploy external; NOTIFICATION_READINESS_2026_10_27.md. |
| [DMP-061](#dmp-061) | OPEN | Pending |
| [DMP-062](#dmp-062) | OPEN | Pending |
| [DMP-063](#dmp-063) | IN_PROGRESS | Owner-scoped real timeline/categories/search/pages/details connected and API-tested; advanced actor/date filters and all snapshot/link cases remain. |
| [DMP-064](#dmp-064) | IN_PROGRESS | Actual audit-backed history respects owner/store scope; standalone full audit filters remain. Credential presentation hardening in progress. |
| [DMP-065](#dmp-065) | OPEN | Pending |
| [DMP-066](#dmp-066) | OPEN | Pending |
| [DMP-067](#dmp-067) | OPEN | Pending |
| [DMP-068](#dmp-068) | IN_PROGRESS | Saved identity/address/header/footer/legal data/display flags,58/80mm PDFs and server line totals implemented; native print/fiscal provider acceptance remains. |
| [DMP-069](#dmp-069) | OPEN | Pending |
| [DMP-070](#dmp-070) | OPEN | Pending |
| [DMP-071](#dmp-071) | OPEN | Pending |
| [DMP-072](#dmp-072) | OPEN | Pending |
| [DMP-073](#dmp-073) | OPEN | Pending |
| [DMP-074](#dmp-074) | OPEN | Pending |
| [DMP-075](#dmp-075) | OPEN | Pending |
| [DMP-076](#dmp-076) | OPEN | Pending |
| [DMP-077](#dmp-077) | OPEN | Pending |
| [DMP-078](#dmp-078) | IN_PROGRESS | Native journal screen lists active account/store intents, original payload summaries, explicit retry/busy status and confirmed results; 16 journal/reconciliation/UI tests pass; tsc/lint pass. |
| [DMP-079](#dmp-079) | IN_PROGRESS | Original-key reconciliation, stale-session/foreign-origin guards and scoped legacy-sale review with cart backup/tombstone implemented; 16 tests pass. Unscoped legacy records are retained and never transmitted. |
| [DMP-080](#dmp-080) | OPEN | Pending |
| [DMP-081](#dmp-081) | OPEN | Pending |
| [DMP-082](#dmp-082) | OPEN | Pending |
| [DMP-083](#dmp-083) | IN_PROGRESS | Genuine owner-signed standalone 1.0.0/build 1 APK built and installed on fresh API 36 Android; login/downloads/native version work with Metro stopped. Real APK export/local staging activation passed, preserving desktop metadata. See MOBILE_UPDATES_VALIDATION.md. |
| [DMP-084](#dmp-084) | TESTED_CODE | tests/auth.test.tsx + login.test.tsx: unlinked bot gate, real bot link, polling confirmation and one automatic OTP; 17 auth/profile/gate/UI tests pass; tsc/lint pass. |
| [DMP-085](#dmp-085) | TESTED_CODE | Linked-account initial OTP and concurrent bot confirmation tests pass; OTP UI appears only after otp_sent acknowledgment. |
| [DMP-086](#dmp-086) | TESTED_CODE | Tests reject incomplete codes, prevent cooldown resend, and reset expired login tickets; UI countdown and back action tested. |
| [DMP-087](#dmp-087) | TESTED_CODE | profile.test.ts: 4 tests passed using membership-shaped server data; AuthProvider now retains /auth/me permissions and rejects a thin tenant response. |
| [DMP-088](#dmp-088) | TESTED_CODE | auth.test.tsx/profile.test.ts: 10 tests passed; no authenticated profile on lookup failure, no stale profile resurrection after logout, authoritative membership retained. |
| [DMP-089](#dmp-089) | TESTED_CODE | 4 catalog contract tests pass: backend product parent field maps to valid cart ID, malformed records rejected, decimal price fallback verified; tsc/lint pass. |
| [DMP-090](#dmp-090) | TESTED_CODE | Per-sale optional ISO debt deadline input/payload added; valid date reaches sale POST, invalid calendar date is blocked. Financial suite: 33 tests pass; tsc/lint pass. |
| [DMP-091](#dmp-091) | TESTED_CODE | 26 targeted Jest tests passed: money.test.ts, cartPrice.test.tsx, checkout.test.tsx; typecheck passed; lint 0 errors. Decimal and negative-input screen cases included. |
| [DMP-092](#dmp-092) | TESTED_CODE | Dedicated decimal quantity sheet accepts 0,125 with three-place validation. BigInt line math and exact fractional increment tests pass; Docker browser applies 0,125 then restores quantity 2. |
| [DMP-093](#dmp-093) | TESTED_CODE | Confirmed change uses Decimal-compatible accepted server total. Regression test: 30,000 tendered and 24,000.50 server total produces 5,999.50; no earlier local-total substitution. |
| [DMP-094](#dmp-094) | TESTED_CODE | Version-3 origin/account/store cart persists payment method, raw amount, deadline and stable cart ID. Remount and v2 backup/migration tests pass. |
| [DMP-095](#dmp-095) | TESTED_CODE | Card/debt receipt rendering tests verify Karta/Nasiya labels and no cash/change rows; HTML output uses the same payment selection. |
| [DMP-096](#dmp-096) | TESTED_CODE | 9 receipt regression tests pass: missing/invalid IDs show an actionable error, request failure offers retry; tsc/lint pass. |
| [DMP-097](#dmp-097) | TESTED_CODE | Receipt scope/ID/mode changes remount isolated state. Tests generate a mocked PDF then change ID and verify cleared PDF state; late old request is ignored. |
| [DMP-098](#dmp-098) | TESTED_CODE | client.test.ts: 5 tests passed, including binary Blob preservation and explicit text; existing refresh/stale-session/failed-POST regressions retained. |
| [DMP-099](#dmp-099) | TESTED_CODE | client.test.ts: 10 tests passed, including clearing authorization before server-origin change and rejecting credential-bearing invalid URLs. |
| [DMP-100](#dmp-100) | TESTED_CODE | 26 persistence/identity/draft tests passed. Equal account/store IDs on distinct API servers restore separate carts and use separate financial identities; original data retained. |
| [DMP-101](#dmp-101) | TESTED_CODE | 11 transaction/identity tests pass: 40 concurrent increments across connections, atomic rollback, 20 same-intent submissions, distinct pending carts serialized by atomic sale lock, retained confirmed cart key. Native SQLite adapter compiles; native DB runtime remains unexecuted. |
| [DMP-102](#dmp-102) | TESTED_CODE | Injected read failure and corrupt-data tests passed: no empty overwrite; draft remains stored; explicit retry restores original items. |
| [DMP-103](#dmp-103) | TESTED_CODE | drafts.test.ts validates version/server/account/store, IDs, numeric types/finite quantities/prices and fractional precision; corrupt data is blocked and retained. |
| [DMP-104](#dmp-104) | TESTED_CODE | Persistence tests cover failed write, visible error state, blocked unready mutations, retry and flush; global saving/error UI and catalog readiness guard added. Typecheck/lint pass. |
| [DMP-105](#dmp-105) | TESTED_CODE | Search/store sequencing and AbortController guards implemented in paged resources and dashboard. Deferred-response and store-switch tests pass; full Jest suite/tsc/lint pass. |
| [DMP-106](#dmp-106) | TESTED_CODE | Customer picker uses server search and numbered pages with visible load/retry controls. UI test selects a customer on page 2; full Jest suite/tsc/lint pass. |
| [DMP-107](#dmp-107) | TESTED_CODE | client.test.ts: deadline/uncertain-outcome, 429 Retry-After and refresh-401 metadata/session-clear notification tests passed. |
| [DMP-108](#dmp-108) | TESTED_CODE | Failed rejection persistence retains original server error. Confirmed result remains visible after local save failure; local-only retry never repeats POST. 33 financial tests/tsc/lint pass. |
| [DMP-109](#dmp-109) | TESTED_CODE | Clear-cart sheet offers retain/explicit clear actions. UI test proves neither opening nor cancellation clears data; confirmed clear resets cart identity/payment. Pending journal records remain preserved. |
| [DMP-110](#dmp-110) | VERIFIED_RUNTIME | Docker Chrome phone preview passed: visible five-tab navigation in Documents, Inventory, Customers, Reports and Settings; sidebar navigation, theme, price, live refresh and checkout regression pass. |
| [DMP-111](#dmp-111) | VERIFIED_RUNTIME | Docker Chrome phone test asserts editable price target height >=44px; price negotiation and fractional quantity interaction pass at the phone viewport. |
| [DMP-112](#dmp-112) | TESTED_CODE | All current raw TextInputs have explicit accessible names; icon-only controls have labels; shared Button retains name and busy/disabled state while loading. 169 Jest tests, tsc and lint pass; phone browser regression passes. |
| [DMP-113](#dmp-113) | TESTED_CODE | Fullscreen checkout/receipt and login handle bottom insets; secondary screens retain inset-aware tabs; drawer/footer and modal sheets consume bottom insets. Full 169-test/tsc/lint and web phone regression pass. |
| [DMP-114](#dmp-114) | TESTED_CODE | 199 tests, strict lint/tsc pass. Actual installed Android API36 test found and fixed missing absolute keyboard offset; real keyboard price/quantity/checkout interaction, process-restart draft and confirmed synthetic sale passed. |
| [DMP-115](#dmp-115) | OPEN | Pending |
| [DMP-116](#dmp-116) | TESTED_CODE | Neutral/cancel feedback defaults to informational icon; errors announce an alert and use an error icon, with explicit feedback types and no success icon. Component regressions plus full 169-test suite pass. |
| [DMP-117](#dmp-117) | OPEN | Pending |
| [DMP-118](#dmp-118) | OPEN | Pending |
| [DMP-119](#dmp-119) | OPEN | Pending |
| [DMP-120](#dmp-120) | TESTED_CODE | Template launcher/adaptive/monochrome assets replaced by deterministic PNG renders of the approved ILBI vector mark; actual icon inspected. Expo doctor: 20/20; Android and iOS Hermes exports pass. |
| [DMP-121](#dmp-121) | TESTED_CODE | Native receipt header test retains R&1, while exported HTML correctly contains R&amp;1; native Text no longer receives HTML entities. |
| [DMP-122](#dmp-122) | TESTED_CODE | Actual isolated PostgreSQL/Django API test passes, including fractional sale and idempotent retry; 13 mobile contract/checkout tests pass against generated real serializer responses; tsc/lint pass. |
| [DMP-123](#dmp-123) | VERIFIED_RUNTIME | frontend npm run test:document-share passes in real Chrome: public links, offline/pending recovery, clipboard/cancel, downloadable 58/80mm/A4/multipage PDFs and QR/tax preservation. Obsolete domain assertion updated to ilbi.uz and dialog-close helper now waits for committed closure. |
| [DMP-124](#dmp-124) | OPEN | Pending |
| [DMP-125](#dmp-125) | OPEN | Pending |
| [DMP-126](#dmp-126) | TESTED_CODE | Repository CI now runs mobile lint, tsc, Jest/real serializer contracts, Android+iOS Hermes exports, Docker phone interaction/Fast Refresh and evidence uploads. Matching local checks pass (176 tests, zero lint warnings, both exports, browser regression); YAML parses. |
| [DMP-127](#dmp-127) | EXTERNAL_GATE | 2026-10-27 live npm audit reports 3 high entries / 1 Zod advisory after compatible Forge1.4.1 update. Expo CLI still requires Zod3 while the published patch is v4. Audit gate remains active; primary sources and resolution conditions in docs/DEPENDENCY_SECURITY.md. |
| [DMP-128](#dmp-128) | TESTED_CODE | Unused prototype imports/state and generic transition adapter removed; unused direct navigation dependencies removed while Router requirements remain. 176 tests and tsc pass; ESLint across all sources/tests reports zero errors and zero warnings. |
| [DMP-129](#dmp-129) | OPEN | Pending |
| [DMP-130](#dmp-130) | OPEN | Pending |
| [DMP-131](#dmp-131) | TESTED_CODE | Settings danger logout button now renders its icon white against the danger background; tsc/lint and phone navigation regression pass. |

<!-- IMPLEMENTATION_LEDGER_END -->

## How to use this record

This is the single desktop/mobile comparison record requested by the owner. Read the capability inventory, then the detailed findings for the feature you are implementing. The audit changes documentation only. It does not enable incomplete modules or fix the listed defects. Paths refer to the repository root; line numbers belong to the audited working-tree snapshot, which includes the pre-existing uncommitted mobile implementation.

The Electron app loads the shared React web UI and adds an embedded local backend, offline data/sync, pairing, security, backups, native export and updates. The mobile app is a separate Expo/React Native implementation. A browser-rendered mobile screen is not native acceptance evidence.

Classification: `ABSENT` = no corresponding implemented workflow; `MOCK-ONLY` = synthetic/local preview or real-mode gate; `PARTIAL` = implemented subset; `SOURCE-BUG` = a concrete incorrect source path; `REPRODUCED` = exercised using isolated synthetic probes; `CONDITIONAL` = desktop capability whose mobile product/role scope needs a decision; `UNVERIFIED` = no sufficient execution evidence; `SHARED-BLOCKER` = a shared backend readiness boundary, not a mobile-only defect. Conditional/desktop-specific capabilities must not silently become required cashier features.

Priority: P1 blocks reliable business use/data integrity or an essential operation; P2 is a material capability/usability gap; P3 is polish/maintenance. These are audit priorities, not proven production incidents.

A complete list of discoverable differences in this snapshot is the objective. Finite source review cannot prove that no unknown runtime bug exists. The final pass ledger states what was reviewed, how new findings were deduplicated, and the native/backend limitations.

## Current counts

| Classification | Findings |
| --- | ---: |
| ABSENT | 59 |
| CONDITIONAL | 7 |
| MOCK-ONLY | 5 |
| PARTIAL | 28 |
| REPRODUCED | 7 |
| SHARED-BLOCKER | 1 |
| SOURCE-BUG | 17 |
| UNVERIFIED | 7 |

| Priority | Findings |
| --- | ---: |
| P1 | 59 |
| P2 | 69 |
| P3 | 3 |

## Desktop capability inventory and scope

**Baseline is implemented source, not a claim that every desktop business flow is production-ready.** In particular, the source deliberately closes retail POS when DEBUG is false pending fiscal integration (see DMP-129). Some desktop signatures are locally stored, not server-verified legal signing. Mixed payment is not supported by the current sale serializer, and unreachable dual-currency comments do not override POS’s explicit UZS-only checks.

| Desktop area | Discoverable capabilities | Current mobile correspondence | Finding references |
| --- | --- | --- | --- |
| Login / SetupAccount / AcceptTerms | Username/phone/email password entry, direct/demo/password login, Telegram contact gate, OTP send/resend/verify, invitation/reset/resume, terms acceptance. | Credential/OTP subset exists; contact/recovery/terms/session contracts have open gaps. | DMP-001, DMP-002, DMP-003, DMP-004, DMP-005, DMP-084, DMP-085, DMP-086, DMP-087, DMP-088 |
| Profile | Account fields, avatar upload/delete, password changes, remembered-login policy. | Settings displays account information only. | DMP-003, DMP-004 |
| Dashboard (tenant) | Period/custom-date analytics, revenue/cost/profit/payment/debt summaries, charts and recent activity under permissions. | Today-only Home summary/recent sales subset. | DMP-008, DMP-007 |
| POS | Category browsing, paginated product lookup, camera/Enter barcode lookup, partner price, editable quantity/current-sale price, stock/expiry/tax checks, currency calculator, account-scoped cart/payment drafts, customer/debt date, confirmed receipt/invoice. | Cart, per-sale price, customer selection and basic checkout exist; see detailed safeguards and missing paths. | DMP-012, DMP-013, DMP-014, DMP-015, DMP-016, DMP-017, DMP-018, DMP-090, DMP-091, DMP-092, DMP-093, DMP-094, DMP-109 |
| Catalog | Categories/parent structure, product/variant CRUD, names/units/SKU/code/barcode/currency, three price tiers, MXIK/package metadata, archive/restore/delete, product/gallery images, spreadsheet import, generated barcodes/labels. | Read/add/search subset; management and complete paging/contract coverage absent. | DMP-019, DMP-020, DMP-021, DMP-022, DMP-023, DMP-024, DMP-025, DMP-026, DMP-089 |
| Sales | Server-filtered paginated sales history/detail, full and partial voids with reason, receipt token rotation, receipt/invoice/share/export. | Recent Home list and Receipt only; no full history or void workflow. | DMP-009, DMP-010, DMP-011 |
| Inventory | Authoritative stock/detail/movements/adjustments, supplier/cost permissions, multi-line intake, batch/expiry management, deficits, customer/supplier returns, write-off, inter-store transfers/returns/discrepancies. | Real module gated; local preview adjustment is not a business write. | DMP-027, DMP-028, DMP-029, DMP-030, DMP-031, DMP-032 |
| Debts / customers | Search/page/filter customers, UZS/USD debt and credit summaries, metadata/due date/code, purchase/payment ledger, cash/card/branch/note collection, credit refunds/correction, spreadsheet import. | Customer create/picker subset; Customers list not loaded; Debts real mode gated. | DMP-033, DMP-034, DMP-035, DMP-036, DMP-037, DMP-038, DMP-039, DMP-106 |
| Shifts / cashbox | Current shift, opening UZS/USD cash, counted close/discrepancy/staff note, income/expenses/category preferences, historical reports and modern/thermal report views. | No actual shift/cashbox flow; Reports is a gated fixture. | DMP-040, DMP-041, DMP-042, DMP-043 |
| B2BTransactions | Inbox/outgoing/search/page, invoice, barcode/currency/unit mapping, acceptance by item/category/variant, reject, returned-goods receipt and discrepancy closure. | No B2B implementation. | DMP-044, DMP-045, DMP-046 |
| Employees / permission editor | Hire/invite/edit/fire, account block/unblock, archive/restore/reasons, granular permission choices/categories/presets. | No team management; role scope still required. | DMP-007, DMP-047, DMP-048 |
| MyTenants | Owned store discovery/creation, seller profiles, seller metadata updates and profile-store binding. | Existing store selection only. | DMP-049, DMP-006 |
| Tenants / PlatformAccounts / PlatformDashboard | Global overview, accounts/identity/status, login-ban recovery, tenant creation/edit/status/owner invitations/ownership transfer. | Conditional admin scope absent; platform_admin currently has no appropriate dedicated mobile experience. | DMP-050, DMP-051, DMP-052, DMP-124, DMP-125 |
| SellerProfileReviews | Status/search/page, approve with future expiry, reject with reason, queue/profile detail. | Conditional admin scope absent. | DMP-052 |
| Services — currency | Manual internal USD rate, automatic CBU data, currency conversion helper, tenant configuration persistence. | No tenant-settings form. | DMP-053 |
| Services — receipt/taxes | Store identity/address/phone/footer, tax regime/VAT mode/rates/display settings, receipt paper width and previews; historical snapshots remain authoritative. | No configuration parity; simplified independent receipt renderer. | DMP-054, DMP-016, DMP-068 |
| Services — messaging/automation | Telegram group/preferences, sale/debt notifications, scheduled daily/shift/low-stock reports and explicit test/manual send. Platform support bot settings are a separate admin service. | Absent. | DMP-055, DMP-056, DMP-125 |
| Audit / History | Action/tenant/page filters, event categories, custom periods, actor/time/change snapshots, linked business details/print/export. | Absent. | DMP-063, DMP-064 |
| Support / HelpLauncher | Guest and signed-in support, account-scoped conversations, text/images/voice/stickers, read/unread and reply context; operator claim/close/reopen and customer profile controls. | Absent; operator/admin capability is conditional. | DMP-057, DMP-058, DMP-059 |
| Layout / notifications | Persistent navigation, role-aware menu, store switch, notification pagination/read/delete/detail/action parsing, error/loading/recovery/confirmation components. | Sidebar/tabs exist; notifications, guards and cross-module consistency remain partial. | DMP-060, DMP-110, DMP-116, DMP-117 |
| Workspace | Classic/fast desktop presentation, overview cards, global search, quick tools/calculator/favorites, assigned due reminders and completion. | No equivalent business tools; mobile layout need not mimic the desktop fast workspace. | DMP-061, DMP-062 |
| ReceiptSlip / PublicReceiptView | Saved tax/identity/product/state fields, scannable QR/barcode, token public route, 58/80mm receipt printing and real file export/share. | Saved items/basic total/copy link/temporary PDF subset; native system behavior still unverified. | DMP-068, DMP-069, DMP-070, DMP-071, DMP-072, DMP-095, DMP-096, DMP-097, DMP-121 |
| InvoiceA4Modal / signatures | Sale-linked conditional invoice title, full rows/tax/amount-in-words, sender/receiver signature capture, local tenant+sale persistence, export including signature images. | Gated canonical documents, one volatile SVG signature, share toast only. | DMP-065, DMP-066, DMP-067 |
| Documentation | Real help/legal Markdown/content/images/navigation, role-controlled save and certificate print. | Do not confuse this with the mobile invoice sample screen. | DMP-074 |
| Exports / import helpers | Filtered spreadsheet export, binary templates, row preview/validation/commit, appropriate error/cancel handling. | No complete file workflow; request blob option is not implemented correctly. | DMP-073, DMP-098, DMP-099, DMP-107 |
| Landing | Public presentation, product carousel, links into login/download/help. | Public marketing page; not a mandatory native cashier screen. | OPTIONAL PUBLIC SURFACE |
| Downloads / DesktopGuide | Windows/Linux artifacts/install directions/update controls and a bundled illustrated offline guide. | Desktop installer acquisition is not a mobile feature gap; native distribution/onboarding must have its own accepted flow. | DESKTOP-SPECIFIC / DMP-083 |

### Desktop shell capabilities and mobile equivalents

| Electron/native surface | What the desktop adds | Appropriate mobile comparison |
| --- | --- | --- |
| setup / setup state / cloud mode | First run, official-server policy, online use without mandatory offline preparation, local runtime startup/recovery. | Mobile endpoint/first-run/session policy; do not copy an Electron setup window. |
| primary local host | Bundled Python/Django/PostgreSQL, isolated local data, stable local origin, process supervision. | A suitable native database/cache/journal if offline is approved; PostgreSQL binaries are not a parity requirement. |
| join / claim / approve / cancel / status | Expiring one-time pairing code, cross-device confirmation, per-register identity and LAN target selection. | Conditional mobile secondary-register support; DMP-082. |
| register list / revoke / reconnect | Owner-managed device access, revoke only selected register, primary-host availability dependency. | Device management/offline grant policy; DMP-076, DMP-082. |
| encrypted vault and saved login | OS-backed secret protection and deliberate remember/forget management; live database files are not automatically full-disk encrypted. | Native secure-storage lifecycle/credential policy; app backup behavior must be verified separately. |
| session lock / activate / activity / timeout / events | Durable manual/idle lock, session guard, owner/security panel. | Mobile background privacy/idle unlock, DMP-080. |
| backup status / create / restore | Protected backups, owner reauthorization, quiesced runtime, preserved drafts/pending work and recovery. | Mobile-appropriate backup/recovery/data ownership, DMP-081. |
| update status / check / window / run / events | Official manifest/file verification, progress, maintenance/waiting for active work, installer/relaunch and retained data. | Signed native distribution/update/migration; do not port NSIS or Linux helper scripts. |
| document PDF | Native save dialog with actual canceled/saved state; safe document preparation and output. | Real native file saving/view/share with identical document content. |
| receipt share links | Verifies pending/offline receipt status before exposing shareable cloud links. | Token availability/status and offline reconciliation, not guessed receipt IDs. |
| app menu / downloads / guide / OS notice | Native menu, external official downloads, offline illustrated instructions and background update notification. | Mobile onboarding/help and store/update UX; Windows/Linux-specific controls are not missing mobile business features. |

## Repeat comparison ledger

Passes are additive and deduplicated; a newly noticed detail of an existing item is appended there instead of counted twice. Missing workflows, concrete bugs, conditional role scope and unverified acceptance have different classifications.

| Pass | View examined | New unique records | Cumulative | Result |
| --- | --- | ---: | ---: | --- |
| 1 | Routes, roles, core POS/catalog/inventory/customer/cashbox workflows | 43 | 43 | Established the business-feature baseline. |
| 2 | B2B, team/stores/admin, settings, support, workspace, documents/export and desktop offline/security/release | 40 | 83 | Found additional areas invisible in the basic five mobile tabs. |
| 3 | API serializers/payloads, auth phases, numeric fields, persistence, request ordering and failure paths; isolated synthetic probes | 25 | 108 | Found new field/OTP/money/session/binary/concurrency defects beyond the feature list. |
| 4 | Touch/navigation/accessibility/loading/time/error states and actual document-share browser regression | 15 | 123 | Found interaction/acceptance gaps and a stale desktop/web test assertion. |
| 5 | All central API declarations, CI/dependencies, hidden admin actions and backend readiness boundaries | 6 | 129 | Added unban/support-config/CI/tooling items and the shared production fiscal gate. |
| 6 | Reverse mobile module → desktop/backend comparison; fixture/data-origin/mutation consistency | 1 | 130 | Found inconsistent shared identities/balances in synthetic preview. Existing sync/customer records also gained evidence. |
| 7 | Common component/action review and evidence corrections, distinguishing actual defects from assumptions | 1 | 131 | Found the destructive-button icon contrast defect; corrected evidence pointers. |
| 8 | Final page/API/Electron/mobile coverage reconciliation, negative-search review and duplicate check | 0 | 131 | Every discovered surface has a record, existing subset, conditional/desktop-only decision, or explicit validation limit. |
| 9 | Cross-check by role, online/offline, persistence/failure/retry and document output; source/probe evidence validation | 0 | 131 | No further unique issue in the reviewed scope; no application fix was made. |

**Stopping rule reached for this source audit:** the final two distinct comparison passes produced no additional unique finding. This does not mean the application has no unknown bugs or that the 131 records are fixed. Native/device, real backend/fiscal and deployed production checks remain open; repeat the comparison after implementation or when new evidence changes a record.


## Finding index

| ID | Area | Priority | Classification | Finding |
| --- | --- | --- | --- | --- |
| [DMP-001](#dmp-001) | Auth | P1 | ABSENT | Terms acceptance and policy gate |
| [DMP-002](#dmp-002) | Auth | P1 | ABSENT | Password reset, invitation onboarding and resume |
| [DMP-003](#dmp-003) | Auth | P2 | ABSENT | Account profile, avatar and password management |
| [DMP-004](#dmp-004) | Auth | P2 | ABSENT | Remembered login with native credential protection |
| [DMP-005](#dmp-005) | Auth | P1 | PARTIAL | Account/session recovery UI |
| [DMP-006](#dmp-006) | Stores | P1 | PARTIAL | Explicit multi-store choice and consistent store switching |
| [DMP-007](#dmp-007) | Permissions | P1 | PARTIAL | Role/permission-aware navigation and action guards |
| [DMP-008](#dmp-008) | Analytics | P2 | PARTIAL | Dashboard periods, custom dates and detailed analytics |
| [DMP-009](#dmp-009) | Sales history | P1 | ABSENT | Dedicated sales list, server filters and pagination |
| [DMP-010](#dmp-010) | Sales history | P1 | ABSENT | Full sale cancellation and reason |
| [DMP-011](#dmp-011) | Sales history | P1 | ABSENT | Partial item cancellation and returned quantities |
| [DMP-012](#dmp-012) | POS | P2 | ABSENT | Partner/wholesale price mode |
| [DMP-013](#dmp-013) | POS | P1 | ABSENT | Live stock revalidation before accepting payment |
| [DMP-014](#dmp-014) | POS | P1 | SOURCE-BUG | Non-UZS item handling and currency safety |
| [DMP-015](#dmp-015) | POS | P2 | ABSENT | USD exchange calculator with current tenant rate |
| [DMP-016](#dmp-016) | POS | P1 | ABSENT | Tax-inclusive/exclusive totals and settings expectation |
| [DMP-017](#dmp-017) | POS | P1 | ABSENT | Expiry/batch warning at checkout |
| [DMP-018](#dmp-018) | POS | P2 | ABSENT | Real camera barcode scanning |
| [DMP-019](#dmp-019) | Catalog | P1 | PARTIAL | Server pagination and exact barcode lookup |
| [DMP-020](#dmp-020) | Catalog | P2 | ABSENT | Category tree and category administration |
| [DMP-021](#dmp-021) | Catalog | P2 | ABSENT | Product and variant creation/editing |
| [DMP-022](#dmp-022) | Catalog | P2 | ABSENT | Persistent product prices and minimum-price policy |
| [DMP-023](#dmp-023) | Catalog | P2 | ABSENT | Archive, restore and delete product lifecycle |
| [DMP-024](#dmp-024) | Catalog | P2 | PARTIAL | Product images, thumbnails and gallery management |
| [DMP-025](#dmp-025) | Catalog | P2 | ABSENT | Spreadsheet product import with preview/commit |
| [DMP-026](#dmp-026) | Catalog | P2 | ABSENT | Product barcode generation and label printing |
| [DMP-027](#dmp-027) | Inventory | P1 | MOCK-ONLY | Real stock list, movements and reconciliation |
| [DMP-028](#dmp-028) | Inventory | P1 | ABSENT | Rapid multi-line stock intake |
| [DMP-029](#dmp-029) | Inventory | P1 | ABSENT | Customer return, supplier return and write-off |
| [DMP-030](#dmp-030) | Inventory | P1 | ABSENT | Batch stock, suppliers, expiry and protected costs |
| [DMP-031](#dmp-031) | Inventory | P1 | ABSENT | Inter-store transfer dispatch, receipt, return and discrepancy |
| [DMP-032](#dmp-032) | Inventory | P2 | ABSENT | Deficit view and low-stock operational workflow |
| [DMP-033](#dmp-033) | Customers | P1 | PARTIAL | Authoritative customer list and balance summaries |
| [DMP-034](#dmp-034) | Customers | P2 | PARTIAL | Customer editing, deletion, notes, code and due date |
| [DMP-035](#dmp-035) | Customers | P1 | ABSENT | Customer purchase and payment ledger |
| [DMP-036](#dmp-036) | Customers | P2 | ABSENT | Spreadsheet customer import |
| [DMP-037](#dmp-037) | Debts | P1 | MOCK-ONLY | Real debt filters and collection |
| [DMP-038](#dmp-038) | Debts | P1 | PARTIAL | Payment currency, cash/card, branch and note |
| [DMP-039](#dmp-039) | Debts | P1 | ABSENT | Customer credit refund and payment correction |
| [DMP-040](#dmp-040) | Cashbox | P1 | ABSENT | Open shift and current-register status |
| [DMP-041](#dmp-041) | Cashbox | P1 | ABSENT | Close shift, counted cash and discrepancy explanation |
| [DMP-042](#dmp-042) | Cashbox | P1 | ABSENT | Cash expenses/income and reusable categories |
| [DMP-043](#dmp-043) | Cashbox | P1 | MOCK-ONLY | Historical Z-reports and share/print layouts |
| [DMP-044](#dmp-044) | B2B | P1 | ABSENT | Incoming/outgoing B2B transaction lists |
| [DMP-045](#dmp-045) | B2B | P1 | ABSENT | Accept B2B with destination product/category mapping |
| [DMP-046](#dmp-046) | B2B | P1 | ABSENT | Reject, receive return and close B2B discrepancy |
| [DMP-047](#dmp-047) | Team | P2 | ABSENT | Hire, edit, invite and lifecycle management |
| [DMP-048](#dmp-048) | Team | P2 | ABSENT | Granular permission editor and role presets |
| [DMP-049](#dmp-049) | Stores | P2 | ABSENT | Owner store creation and seller-profile binding |
| [DMP-050](#dmp-050) | Platform administration | P2 | CONDITIONAL | Platform overview, account status and identity recovery |
| [DMP-051](#dmp-051) | Platform administration | P2 | CONDITIONAL | Tenant administration, ownership transfer and activation |
| [DMP-052](#dmp-052) | Platform administration | P2 | CONDITIONAL | Seller verification decisions and validity |
| [DMP-053](#dmp-053) | Settings | P2 | ABSENT | Store currency settings and automatic CBU rate |
| [DMP-054](#dmp-054) | Settings | P1 | ABSENT | Receipt identity, layout and tax configuration |
| [DMP-055](#dmp-055) | Settings | P2 | ABSENT | Telegram destination, notification preferences and test |
| [DMP-056](#dmp-056) | Settings | P2 | ABSENT | Scheduled and on-demand daily/shift/low-stock reports |
| [DMP-057](#dmp-057) | Support | P2 | ABSENT | Authenticated and guest help conversations |
| [DMP-058](#dmp-058) | Support | P2 | ABSENT | Attachments, voice, stickers and multilingual support UI |
| [DMP-059](#dmp-059) | Support | P2 | CONDITIONAL | Operator inbox and customer/tenant profile actions |
| [DMP-060](#dmp-060) | Notifications | P2 | ABSENT | Real notification inbox, unread count and actions |
| [DMP-061](#dmp-061) | Workspace | P2 | ABSENT | Global search, favorites and quick tools |
| [DMP-062](#dmp-062) | Workspace | P2 | ABSENT | Reminders, assignment, due dates and completion |
| [DMP-063](#dmp-063) | History | P2 | ABSENT | Unified activity timeline and change snapshots |
| [DMP-064](#dmp-064) | History | P2 | ABSENT | Audit journal with filters and detail |
| [DMP-065](#dmp-065) | Documents | P1 | MOCK-ONLY | Sale-linked A4 invoice with authoritative rows |
| [DMP-066](#dmp-066) | Documents | P1 | PARTIAL | Sender and receiver signatures with persisted document identity |
| [DMP-067](#dmp-067) | Documents | P1 | MOCK-ONLY | Actual document PDF/share action |
| [DMP-068](#dmp-068) | Receipts | P1 | PARTIAL | Saved receipt snapshot, taxes and product identifiers |
| [DMP-069](#dmp-069) | Receipts | P1 | PARTIAL | Thermal 58/80 mm format and configurable printer output |
| [DMP-070](#dmp-070) | Receipts | P2 | PARTIAL | Real QR/barcode and public receipt viewing |
| [DMP-071](#dmp-071) | Receipts | P2 | ABSENT | Rotate/revoke public receipt share token |
| [DMP-072](#dmp-072) | Receipts | P2 | PARTIAL | Permanent file saving and genuine file viewing |
| [DMP-073](#dmp-073) | Exports | P2 | ABSENT | Excel/CSV exports of business lists |
| [DMP-074](#dmp-074) | Documentation | P2 | ABSENT | Real help/legal documentation and certificate printing |
| [DMP-075](#dmp-075) | Offline | P1 | ABSENT | Usable offline data store and business write journal |
| [DMP-076](#dmp-076) | Offline | P1 | ABSENT | Offline enrollment, account grants and credential expiry |
| [DMP-077](#dmp-077) | Offline | P1 | ABSENT | Automatic reconnect synchronization with ordered dependencies |
| [DMP-078](#dmp-078) | Offline | P2 | ABSENT | Sync center, progress, priority and retry controls |
| [DMP-079](#dmp-079) | Offline | P1 | PARTIAL | Uncertain result reconciliation and journal migration |
| [DMP-080](#dmp-080) | Security | P1 | ABSENT | Session auto-lock and background privacy |
| [DMP-081](#dmp-081) | Offline | P1 | ABSENT | Encrypted backup, restore and pending-work preservation |
| [DMP-082](#dmp-082) | Offline | P2 | CONDITIONAL | Connect to an existing local primary register |
| [DMP-083](#dmp-083) | Release | P1 | UNVERIFIED | Installed mobile package, updates and data migration |
| [DMP-084](#dmp-084) | Auth | P1 | ABSENT | Telegram bot connection onboarding is missing |
| [DMP-085](#dmp-085) | Auth | P1 | SOURCE-BUG | Initial OTP is never requested by mobile login |
| [DMP-086](#dmp-086) | Auth | P2 | PARTIAL | OTP validity, resend cooldown and expired-ticket recovery |
| [DMP-087](#dmp-087) | Auth | P1 | SOURCE-BUG | Membership permission metadata is overwritten by a thinner response |
| [DMP-088](#dmp-088) | Auth | P1 | SOURCE-BUG | Partially initialized profile becomes an authenticated session |
| [DMP-089](#dmp-089) | Catalog | P2 | SOURCE-BUG | Variant parent-product ID mapping differs from backend |
| [DMP-090](#dmp-090) | Checkout | P1 | ABSENT | Per-sale debt due-date selection and payload |
| [DMP-091](#dmp-091) | Money input | P1 | REPRODUCED | Decimal prices and payments are changed into different amounts |
| [DMP-092](#dmp-092) | Cart | P2 | PARTIAL | Fractional quantity entry and precise line display |
| [DMP-093](#dmp-093) | Checkout | P1 | SOURCE-BUG | Confirmed change uses the earlier local total, not accepted server total |
| [DMP-094](#dmp-094) | Checkout | P2 | PARTIAL | Payment draft survives neither navigation nor process restart |
| [DMP-095](#dmp-095) | Receipts | P1 | SOURCE-BUG | Card/debt receipts are labeled as cash |
| [DMP-096](#dmp-096) | Receipts | P2 | SOURCE-BUG | Invalid/missing sale ID waits forever without an actionable error |
| [DMP-097](#dmp-097) | Receipts | P2 | UNVERIFIED | Route-parameter changes do not reset the loaded receipt/PDF state |
| [DMP-098](#dmp-098) | API | P2 | REPRODUCED | Declared binary response handling returns text instead of a file |
| [DMP-099](#dmp-099) | API | P1 | REPRODUCED | Runtime API-origin changes retain the current authorization |
| [DMP-100](#dmp-100) | Persistence | P1 | SOURCE-BUG | Server identity is absent from draft and financial-intent keys |
| [DMP-101](#dmp-101) | Financial operations | P1 | REPRODUCED | Concurrent submissions get different retry identities |
| [DMP-102](#dmp-102) | Persistence | P1 | SOURCE-BUG | A transient cart restore failure can overwrite the saved draft |
| [DMP-103](#dmp-103) | Persistence | P1 | PARTIAL | Saved cart records have no schema validation or migration |
| [DMP-104](#dmp-104) | Persistence | P2 | PARTIAL | Cart mutation has no readiness/saved/error feedback |
| [DMP-105](#dmp-105) | Lists | P2 | SOURCE-BUG | Older requests can overwrite newer search/store results |
| [DMP-106](#dmp-106) | Customers | P2 | PARTIAL | Customer picker only loads and searches the first server page |
| [DMP-107](#dmp-107) | API | P2 | PARTIAL | No default request timeout or structured retry/backoff UX |
| [DMP-108](#dmp-108) | Financial operations | P1 | SOURCE-BUG | Storage cleanup error can hide the original checkout failure |
| [DMP-109](#dmp-109) | Cart UX | P2 | SOURCE-BUG | Clear-cart action has no confirmation or undo |
| [DMP-110](#dmp-110) | Navigation | P2 | REPRODUCED | Bottom navigation disappears on secondary main modules |
| [DMP-111](#dmp-111) | Touch UX | P2 | REPRODUCED | Price editor touch target is approximately 20 px high |
| [DMP-112](#dmp-112) | Accessibility | P2 | PARTIAL | Input labels and icon controls lack consistent accessible names |
| [DMP-113](#dmp-113) | Native layout | P2 | UNVERIFIED | Bottom safe areas are not handled consistently outside tabs |
| [DMP-114](#dmp-114) | Native layout | P2 | UNVERIFIED | Price/customer/signature sheets lack verified keyboard avoidance |
| [DMP-115](#dmp-115) | Accessibility | P2 | UNVERIFIED | Large text and small-screen acceptance covers too little |
| [DMP-116](#dmp-116) | Feedback | P2 | SOURCE-BUG | Error and cancellation feedback uses a success presentation |
| [DMP-117](#dmp-117) | Loading UX | P2 | PARTIAL | Lists conflate initial loading, empty and failed states |
| [DMP-118](#dmp-118) | Time handling | P2 | PARTIAL | Business timestamps use device timezone instead of a consistent store timezone |
| [DMP-119](#dmp-119) | Motion/performance | P2 | UNVERIFIED | No native animation, Reduce Motion or large-list performance evidence |
| [DMP-120](#dmp-120) | Brand/release | P2 | PARTIAL | Launcher and adaptive icons still reference template assets |
| [DMP-121](#dmp-121) | Receipt display | P3 | SOURCE-BUG | HTML escaping is applied to a native header string |
| [DMP-122](#dmp-122) | Quality | P1 | PARTIAL | Test suite lacks real API-contract and non-fixture coverage |
| [DMP-123](#dmp-123) | Desktop/web quality | P2 | REPRODUCED | Document-share browser regression expects the obsolete domain |
| [DMP-124](#dmp-124) | Platform administration | P2 | CONDITIONAL | Login-throttle ban recovery is distinct from account status |
| [DMP-125](#dmp-125) | Platform administration | P2 | CONDITIONAL | Global support Telegram settings and delivery test |
| [DMP-126](#dmp-126) | Quality | P2 | ABSENT | Mobile checks are not part of the repository CI workflow |
| [DMP-127](#dmp-127) | Dependencies | P2 | UNVERIFIED | Expo toolchain has unresolved high-severity audit entries |
| [DMP-128](#dmp-128) | Maintenance | P3 | PARTIAL | Unused prototype code and navigation dependencies remain |
| [DMP-129](#dmp-129) | Shared platform boundary | P1 | SHARED-BLOCKER | Production retail POS is intentionally closed pending fiscal integration |
| [DMP-130](#dmp-130) | Preview consistency | P2 | SOURCE-BUG | Synthetic data and mutations diverge across mobile screens |
| [DMP-131](#dmp-131) | Accessibility | P3 | SOURCE-BUG | Logout icon uses the same color as its button background |

## Detailed findings

<a id="dmp-001"></a>
### DMP-001 — Terms acceptance and policy gate

Area: **Auth** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop ProtectedRoute redirects users with terms_accepted=false to AcceptTerms; legal documents can be opened and accepted before business access.

**Mobile difference and consequence:** Mobile UserProfile omits terms_accepted and RootNavigator checks only Boolean(user); no acceptance route or API call exists.

**Source evidence:** `frontend/ilbi/src/App.jsx:38`; `frontend/ilbi/src/pages/AcceptTerms.jsx:64`; `mobile-app/src/navigation/RootNavigator.tsx:16`; `mobile-app/src/features/auth/AuthContext.tsx:24`.

**Required verification / completion condition:** Sign in as a user who has not accepted current terms; require a blocking acceptance screen and verify the persisted server result.

<a id="dmp-002"></a>
### DMP-002 — Password reset, invitation onboarding and resume

Area: **Auth** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop SetupAccount handles reset/invitation verification, OTP resend, password confirmation and resumable flows; Login offers recovery.

**Mobile difference and consequence:** Mobile login offers username/password and OTP only; no reset-password/setup-account route, invitation token handler or recovery request exists.

**Source evidence:** `frontend/ilbi/src/pages/SetupAccount.jsx:250`; `frontend/ilbi/src/pages/Login.jsx:269`; `frontend/ilbi/src/api/client.js:282`; `mobile-app/src/features/auth/LoginScreen.tsx:21`.

**Required verification / completion condition:** Open an invitation/reset link from email or Telegram on Android/iOS, complete recovery, reject expired tokens and resume interrupted verification.

<a id="dmp-003"></a>
### DMP-003 — Account profile, avatar and password management

Area: **Auth** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Profile edits personal fields, uploads/removes avatar, changes password and requests password recovery.

**Mobile difference and consequence:** Settings only displays account/store names and logout; there is no profile form, avatar transfer or password change API.

**Source evidence:** `frontend/ilbi/src/pages/Profile.jsx:75`; `frontend/ilbi/src/pages/Profile.jsx:124`; `frontend/ilbi/src/pages/Profile.jsx:146`; `mobile-app/src/features/settings/SettingsScreen.tsx:103`.

**Required verification / completion condition:** Edit profile, upload/delete an avatar, change a password, and verify behavior after refresh and relogin.

<a id="dmp-004"></a>
### DMP-004 — Remembered login with native credential protection

Area: **Auth** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop Login uses remembered-login helpers and Electron protected login credentials with a forget action.

**Mobile difference and consequence:** Mobile only stores access/refresh tokens; there is no opt-in remembered username/credential management. This does not justify storing plaintext passwords.

**Source evidence:** `desktop/ilbi/preload.cjs:30`; `desktop/ilbi/login-credentials.cjs:1`; `frontend/ilbi/src/pages/Login.jsx:73`; `mobile-app/src/api/storage.ts:1`.

**Required verification / completion condition:** Define the mobile remember-login policy, verify OS-backed protection and account-specific forget behavior without retaining another user’s secret.

<a id="dmp-005"></a>
### DMP-005 — Account/session recovery UI

Area: **Auth** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Desktop AuthProvider exposes sessionError and ProtectedRoute renders SessionRecovery; business UI is not presented as ready when profile verification fails.

**Mobile difference and consequence:** Mobile initializes into loading/login or an existing user but has no distinct recoverable session-error screen or retry/reauth contract. Token clearing does not notify AuthProvider. In logout, clearTokens is awaited before setUser(null); a secure-storage removal error can leave that stale user shell visible after in-memory tokens were cleared.

**Source evidence:** `frontend/ilbi/src/App.jsx:40`; `frontend/ilbi/src/components/auth/SessionRecovery.jsx:1`; `mobile-app/src/features/auth/AuthContext.tsx:69`; `mobile-app/src/api/client.ts:41`.

**Required verification / completion condition:** Simulate expired refresh, offline profile lookup and reconnect; show recoverable status without losing drafts or leaving a stale authenticated shell.

<a id="dmp-006"></a>
### DMP-006 — Explicit multi-store choice and consistent store switching

Area: **Stores** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Desktop TenantContext restores a permitted selection and TenantSwitcher exposes a regular store control; Layout has a separate no-active-store gate.

**Mobile difference and consequence:** Mobile auto-selects tenants[0] when no saved match; only sidebar has a picker, while the Home store chip has no action. Initial multi-store intent is not collected. Zero permitted stores, suspended stores and removed membership also lack a distinct actionable no-store state before business screens.

**Source evidence:** `frontend/ilbi/src/context/TenantContext.jsx:16`; `frontend/ilbi/src/components/layout/TenantSwitcher.jsx:1`; `mobile-app/src/features/auth/AuthContext.tsx:84`; `mobile-app/src/features/home/HomeScreen.tsx:83`.

**Required verification / completion condition:** Use two stores with different stock/prices; require an explicit initial choice, switch from the visible store chip and verify all contexts/drafts follow the choice.

<a id="dmp-007"></a>
### DMP-007 — Role/permission-aware navigation and action guards

Area: **Permissions** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Desktop navigation hides role-specific sections and business pages derive action access from user/tenant permissions; admin routes use RoleProtectedRoute.

**Mobile difference and consequence:** Mobile exposes the same menu to everyone and protects routes only by authentication; no permission checks precede cart/customer/payment actions. Backend authorization remains necessary.

**Source evidence:** `frontend/ilbi/src/components/layout/navigation.js:23`; `frontend/ilbi/src/App.jsx:51`; `mobile-app/src/navigation/DrawerContent.tsx:45`; `mobile-app/src/navigation/RootNavigator.tsx:18`.

**Required verification / completion condition:** Test owner, restricted cashier and platform_admin; forbidden features must not be offered, deep links must be guarded, and server 403 must remain visible.

<a id="dmp-008"></a>
### DMP-008 — Dashboard periods, custom dates and detailed analytics

Area: **Analytics** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Dashboard supports analytics periods/filters, charts and detailed business summaries through analyticsApi.

**Mobile difference and consequence:** Home hardcodes period=today and renders only sales total, sale count, debt and recent sales. No chart, custom range, previous-period or detailed breakdown UI exists.

**Source evidence:** `frontend/ilbi/src/pages/Dashboard.jsx:113`; `frontend/ilbi/src/components/dashboard/RevenueCostAnalyticsChart.jsx:1`; `mobile-app/src/features/home/HomeScreen.tsx:39`.

**Required verification / completion condition:** Compare the same store/day/week/custom range and chart values against the backend, including zero sales and restricted cost visibility.

<a id="dmp-009"></a>
### DMP-009 — Dedicated sales list, server filters and pagination

Area: **Sales history** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Sales loads paginated server history with filters, details, receipt and invoice actions.

**Mobile difference and consequence:** No sales-history route exists. Home loads a small recent list; its Barchasi action navigates to the cart instead of a history view.

**Source evidence:** `frontend/ilbi/src/pages/Sales.jsx:1`; `mobile-app/src/navigation/useAppNavigation.ts:4`; `mobile-app/src/features/home/HomeScreen.tsx:179`.

**Required verification / completion condition:** Create more than one page of test sales; filter by dates/customer/status/payment and open a sale outside the latest five.

<a id="dmp-010"></a>
### DMP-010 — Full sale cancellation and reason

Area: **Sales history** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Sales opens a cancellation dialog and submits a reason to the full-sale void endpoint.

**Mobile difference and consequence:** Mobile has no void route/action, authorization prompt, reason entry or post-cancellation stock/cash/debt refresh.

**Source evidence:** `frontend/ilbi/src/pages/Sales.jsx:197`; `frontend/ilbi/src/api/client.js:677`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:1`.

**Required verification / completion condition:** Cancel a permitted completed sale; verify reason, server status, stock/debt/cash impact and denial for an unauthorized cashier.

<a id="dmp-011"></a>
### DMP-011 — Partial item cancellation and returned quantities

Area: **Sales history** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop supports item-level cancellation with quantity/reason and reloads the updated sale.

**Mobile difference and consequence:** Receipt maps quantity/unit_price only and no sale-item void operation exists. Partial-return state is not represented.

**Source evidence:** `frontend/ilbi/src/pages/Sales.jsx:231`; `frontend/ilbi/src/api/client.js:683`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:53`.

**Required verification / completion condition:** Void part of a multi-quantity line, reject excess return quantities and render the resulting remaining/returned totals correctly.

<a id="dmp-012"></a>
### DMP-012 — Partner/wholesale price mode

Area: **POS** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** POS persists isPartnerSale, chooses price_partner, adjusts only unchanged default prices and sends is_partner_sale.

**Mobile difference and consequence:** Cart holds defaultPrice/unitPrice only; catalog omits partner-price selection and checkout never sends is_partner_sale.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:84`; `frontend/ilbi/src/pages/POS.jsx:167`; `frontend/ilbi/src/pages/POS.jsx:286`; `mobile-app/src/features/cart/CartContext.tsx:6`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:69`.

**Required verification / completion condition:** Toggle partner mode, preserve a negotiated exception, submit once and verify saved partner status and invoice semantics.

<a id="dmp-013"></a>
### DMP-013 — Live stock revalidation before accepting payment

Area: **POS** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop checkout reloads variants by cart IDs and current settings, rejects unavailable/insufficient quantities before opening payment.

**Mobile difference and consequence:** Mobile cart does not retain stock limits and Checkout immediately posts existing items without current-stock/settings lookup. Backend errors may still prevent bad writes, but the pre-payment guard is missing.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:382`; `mobile-app/src/features/cart/CartContext.tsx:6`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:62`.

**Required verification / completion condition:** Sell the last unit from another terminal, then attempt checkout from the stale cart; block payment and explain the changed stock.

<a id="dmp-014"></a>
### DMP-014 — Non-UZS item handling and currency safety

Area: **POS** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **1**.

**Desktop/backend behavior:** Desktop POS explicitly rejects variants whose currency is not UZS; the USD calculator is informational.

**Mobile difference and consequence:** Mobile CatalogVariant omits currency, adds every result to a UZS-labelled cart and posts unit prices without checking product currency. A USD variant can be displayed/interpreted as so‘m.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:201`; `frontend/ilbi/src/pages/POS.jsx:388`; `mobile-app/src/features/catalog/CatalogScreen.tsx:23`; `mobile-app/src/features/catalog/CatalogScreen.tsx:81`.

**Required verification / completion condition:** Return a USD-priced variant from the real catalog API; mobile must reject it for UZS POS or implement an explicitly approved conversion workflow.

<a id="dmp-015"></a>
### DMP-015 — USD exchange calculator with current tenant rate

Area: **POS** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop has an informational USD calculator using tenant usd_rate and clear separation from posted POS sale currency.

**Mobile difference and consequence:** Mobile has no rate-loading currency hook, calculator or approved conversion display. It must not infer that desktop permits USD POS sales.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:73`; `frontend/ilbi/src/pages/POS.jsx:723`; `frontend/ilbi/src/hooks/useTenantCurrency.js:1`; `mobile-app/src/features/cart/CartScreen.tsx:38`.

**Required verification / completion condition:** Load the current rate, calculate payment/change examples without silently modifying the posted UZS sale, and show a missing-rate state.

<a id="dmp-016"></a>
### DMP-016 — Tax-inclusive/exclusive totals and settings expectation

Area: **POS** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** POS calculates line tax using receipt settings and includes expected_tax_settings to detect a settings change between preview and posting.

**Mobile difference and consequence:** Mobile sums quantity × price and posts no expected_tax_settings. It never retrieves current receipt tax settings, so its total/change can diverge from authoritative totals.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:332`; `frontend/ilbi/src/pages/POS.jsx:498`; `frontend/ilbi/src/utils/receiptTax.js:1`; `mobile-app/src/features/cart/CartContext.tsx:129`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:69`.

**Required verification / completion condition:** Test VAT included, VAT added, non-VAT and changed-settings cases; displayed total, cash sufficiency and change must match the accepted sale.

<a id="dmp-017"></a>
### DMP-017 — Expiry/batch warning at checkout

Area: **POS** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** POS reads expired_batches from refreshed variants and warns about expired inventory during payment.

**Mobile difference and consequence:** Mobile does not represent batch expiry metadata and has no expired/soon-to-expire warning.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:376`; `frontend/ilbi/src/pages/POS.jsx:398`; `mobile-app/src/features/catalog/CatalogScreen.tsx:23`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:62`.

**Required verification / completion condition:** Return a variant with an expired batch and verify an actionable warning before sale confirmation; follow the actual backend policy rather than inventing a hard block.

<a id="dmp-018"></a>
### DMP-018 — Real camera barcode scanning

Area: **POS** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** CameraBarcodeScanner obtains camera input, decodes barcodes and resolves exact lookup across the whole catalog.

**Mobile difference and consequence:** Cart Scan/Skanerlash controls only navigate to Tovar; expo-camera is installed but never used by a scanner component.

**Source evidence:** `frontend/ilbi/src/components/common/CameraBarcodeScanner.jsx:1`; `frontend/ilbi/src/pages/POS.jsx:431`; `mobile-app/src/features/cart/CartScreen.tsx:151`; `mobile-app/package.json:13`.

**Required verification / completion condition:** On real Android/iOS, grant/deny camera, scan repeatedly without duplicate adds, scan an unknown code and release the camera on dismissal/background.

<a id="dmp-019"></a>
### DMP-019 — Server pagination and exact barcode lookup

Area: **Catalog** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Desktop catalog/POS use paginated requests and exact lookup/barcode queries so a result beyond page one is reachable.

**Mobile difference and consequence:** Mobile requests the default first page only, filters it locally and has no next-page loader. Its secondary product_name/barcode filter may discard a server match that was found by SKU/variant name.

**Source evidence:** `frontend/ilbi/src/hooks/usePaginatedList.js:1`; `frontend/ilbi/src/pages/POS.jsx:431`; `mobile-app/src/features/catalog/CatalogScreen.tsx:62`; `mobile-app/src/features/catalog/CatalogScreen.tsx:94`.

**Required verification / completion condition:** Seed more products than one API page; locate a later-page SKU/barcode/variant name and add the exact matching variant.

<a id="dmp-020"></a>
### DMP-020 — Category tree and category administration

Area: **Catalog** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Catalog loads categories, parent/category currency constraints, creates/edits/deletes categories and uses category filters.

**Mobile difference and consequence:** Mobile has only flat variant search; no category list, parent tree, CRUD form or category filter exists.

**Source evidence:** `frontend/ilbi/src/pages/Catalog.jsx:485`; `frontend/ilbi/src/pages/Catalog.jsx:764`; `frontend/ilbi/src/pages/Catalog.jsx:853`; `mobile-app/src/features/catalog/CatalogScreen.tsx:48`.

**Required verification / completion condition:** Create parent/child categories, reject invalid hierarchy/currency, filter products and enforce management permissions.

<a id="dmp-021"></a>
### DMP-021 — Product and variant creation/editing

Area: **Catalog** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Catalog creates products with variants and edits product/variant fields with validation. Form coverage also includes SKU/code/barcode, unit, currency/category compatibility, minimum/partner/recommended prices and fiscal MXIK/package metadata.

**Mobile difference and consequence:** Mobile lists and adds existing variants only; no creation/editing endpoint or form is present. This is separate from the working current-sale unit-price editor.

**Source evidence:** `frontend/ilbi/src/pages/Catalog.jsx:641`; `frontend/ilbi/src/pages/Catalog.jsx:921`; `frontend/ilbi/src/api/client.js:519`; `mobile-app/src/features/catalog/CatalogScreen.tsx:48`.

**Required verification / completion condition:** Create a product and several variants, edit names/units/SKU without changing historical receipts and verify read-only cashier behavior.

<a id="dmp-022"></a>
### DMP-022 — Persistent product prices and minimum-price policy

Area: **Catalog** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop has a global variant-price editor and category/product minimum-price inputs; catalog changes are separate from negotiated sale prices.

**Mobile difference and consequence:** Mobile has no persistent catalog price management and does not use price_min when validating a negotiated price. Backend enforcement must be checked independently. Default mobile pricing uses price_recommended || 0, unlike desktop’s fallback to price_min; a zero recommended price can therefore enter the cart despite a positive minimum.

**Source evidence:** `frontend/ilbi/src/pages/Catalog.jsx:798`; `frontend/ilbi/src/pages/Catalog.jsx:810`; `mobile-app/src/features/catalog/CatalogScreen.tsx:30`; `mobile-app/src/features/cart/CartScreen.tsx:67`.

**Required verification / completion condition:** Change an authorized catalog price, preserve old receipt prices, and test current-sale overrides at/under the allowed minimum.

<a id="dmp-023"></a>
### DMP-023 — Archive, restore and delete product lifecycle

Area: **Catalog** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Catalog supports archived listings, archive/unarchive and guarded deletion of products/categories/variants.

**Mobile difference and consequence:** Mobile has no archived view or product lifecycle actions.

**Source evidence:** `frontend/ilbi/src/pages/Catalog.jsx:551`; `frontend/ilbi/src/pages/Catalog.jsx:834`; `frontend/ilbi/src/pages/Catalog.jsx:1024`; `mobile-app/src/features/catalog/CatalogScreen.tsx:48`.

**Required verification / completion condition:** Archive and restore a product, retain historical transactions, reject deletion with dependent data and hide unavailable choices in POS.

<a id="dmp-024"></a>
### DMP-024 — Product images, thumbnails and gallery management

Area: **Catalog** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Desktop product UI includes actual image gallery navigation and image upload/deletion APIs.

**Mobile difference and consequence:** Mobile cart/catalog render a parcel emoji placeholder; imageUrl exists in CartItem but is not rendered. No image upload/gallery path exists. Tiny thumbnails must remain compact as the owner requested.

**Source evidence:** `frontend/ilbi/src/pages/Catalog.jsx:93`; `frontend/ilbi/src/api/client.js:540`; `mobile-app/src/features/cart/CartContext.tsx:17`; `mobile-app/src/features/cart/CartScreen.tsx:224`; `mobile-app/src/features/catalog/CatalogScreen.tsx:145`.

**Required verification / completion condition:** Load real/failing/missing images, keep cart thumbnails at the approved small size, and ensure image loading does not reflow or block a long cart.

<a id="dmp-025"></a>
### DMP-025 — Spreadsheet product import with preview/commit

Area: **Catalog** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** CatalogImportModal/SpreadsheetImportModal download a template, upload a sheet, preview row validation and commit a chosen import.

**Mobile difference and consequence:** Mobile has no document picker/import/template/preview/commit workflow.

**Source evidence:** `frontend/ilbi/src/components/common/CatalogImportModal.jsx:1`; `frontend/ilbi/src/components/common/SpreadsheetImportModal.jsx:1`; `frontend/ilbi/src/api/client.js:495`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** Import valid and invalid files in an authorized account, display row errors before commit and prevent duplicate commits on retry.

<a id="dmp-026"></a>
### DMP-026 — Product barcode generation and label printing

Area: **Catalog** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** ProductLabelsModal/ProductToolsModal generate barcode data and printable labels, with configurable quantities and label layout.

**Mobile difference and consequence:** Mobile scanner-like icons do not generate labels and there is no barcode/label API, label preview or print/export workflow.

**Source evidence:** `frontend/ilbi/src/components/common/ProductLabelsModal.jsx:1`; `frontend/ilbi/src/components/common/ProductToolsModal.jsx:1`; `frontend/ilbi/src/utils/productLabels.js:1`; `mobile-app/src/features/catalog/CatalogScreen.tsx:48`.

**Required verification / completion condition:** Generate a barcode, print/export selected label quantities and scan the resulting code back into the correct product.

<a id="dmp-027"></a>
### DMP-027 — Real stock list, movements and reconciliation

Area: **Inventory** · Priority: **P1** · Classification: **MOCK-ONLY** · First found in pass **1**.

**Desktop/backend behavior:** Inventory loads server stock, movement history and stock detail, with adjustment reason and real balances.

**Mobile difference and consequence:** InventoryScreen is a canonical local array; real mode is gated. Preview adjustments change React state only and cannot establish inventory parity.

**Source evidence:** `frontend/ilbi/src/pages/Inventory.jsx:149`; `frontend/ilbi/src/pages/Inventory.jsx:191`; `frontend/ilbi/src/pages/Inventory.jsx:300`; `mobile-app/src/features/inventory/InventoryScreen.tsx:42`; `mobile-app/src/features/inventory/InventoryScreen.tsx:91`.

**Required verification / completion condition:** Load server stock, apply a permitted adjustment with reason, verify movement/audit entries and reject stale/unauthorized changes.

<a id="dmp-028"></a>
### DMP-028 — Rapid multi-line stock intake

Area: **Inventory** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** RapidStockIntakeModal handles supplier, variants, quantities, prices, batch/expiry data, tax/settings expectation, request key and durable drafts.

**Mobile difference and consequence:** No mobile intake form, multi-row draft or /inventory/intake/batch/ request exists.

**Source evidence:** `frontend/ilbi/src/components/inventory/RapidStockIntakeModal.jsx:449`; `frontend/ilbi/src/api/client.js:606`; `mobile-app/src/features/inventory/InventoryScreen.tsx:1`.

**Required verification / completion condition:** Receive several variants with batch/cost/supplier fields, recover an interrupted draft and confirm stock/cost only after server acknowledgement.

<a id="dmp-029"></a>
### DMP-029 — Customer return, supplier return and write-off

Area: **Inventory** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Inventory has separate customer-return, supplier-return and write-off operations with their own payloads/reasons.

**Mobile difference and consequence:** The single local stock-adjustment sheet does not implement these distinct business operations or their accounting semantics.

**Source evidence:** `frontend/ilbi/src/pages/Inventory.jsx:219`; `frontend/ilbi/src/pages/Inventory.jsx:246`; `frontend/ilbi/src/pages/Inventory.jsx:273`; `mobile-app/src/features/inventory/InventoryScreen.tsx:75`.

**Required verification / completion condition:** Execute each operation independently, validate quantity and reason, inspect stock/cost impact and verify that the wrong endpoint cannot substitute for it.

<a id="dmp-030"></a>
### DMP-030 — Batch stock, suppliers, expiry and protected costs

Area: **Inventory** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** StockBatchesPanel lists received/expiry dates, batch codes, quantities, supplier details and permission-dependent cost data, with expiry filters.

**Mobile difference and consequence:** Mobile InventoryItem has no batch identities/dates/suppliers and preview fabricates cost as 80% of sale price. Real module is gated.

**Source evidence:** `frontend/ilbi/src/components/inventory/StockBatchesPanel.jsx:10`; `frontend/ilbi/src/components/inventory/BatchSelector.jsx:1`; `mobile-app/src/features/inventory/InventoryScreen.tsx:31`; `mobile-app/src/features/inventory/InventoryScreen.tsx:49`.

**Required verification / completion condition:** Inspect several batches for one variant, filter expired/soon/unknown and confirm supplier/cost fields disappear for restricted staff.

<a id="dmp-031"></a>
### DMP-031 — Inter-store transfer dispatch, receipt, return and discrepancy

Area: **Inventory** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** TenantTransfersPanel manages request-key dispatch, same-owner automatic delivery, recipient actual quantities, mismatch reasons, return shipments and closing discrepancies.

**Mobile difference and consequence:** Mobile has no transfer model, screens or endpoints. This must not be reduced to incrementing/decrementing two local numbers.

**Source evidence:** `frontend/ilbi/src/components/inventory/TenantTransfersPanel.jsx:1`; `frontend/ilbi/src/api/client.js:637`; `mobile-app/src/features/inventory/InventoryScreen.tsx:1`.

**Required verification / completion condition:** Test same-owner transfer, external receipt, partial receipt, discrepancy and physical return with both tenant views and permission checks.

<a id="dmp-032"></a>
### DMP-032 — Deficit view and low-stock operational workflow

Area: **Inventory** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Inventory queries deficits and displays operational low-stock counts; Services can send a low-stock report.

**Mobile difference and consequence:** Mobile only filters a fixed local minStock array. It cannot show authoritative shortages or trigger the report.

**Source evidence:** `frontend/ilbi/src/pages/Inventory.jsx:139`; `frontend/ilbi/src/api/client.js:631`; `frontend/ilbi/src/pages/Services.jsx:216`; `mobile-app/src/features/inventory/InventoryScreen.tsx:73`.

**Required verification / completion condition:** Create a genuine below-threshold variant, verify the aggregate and filtered list and test notification/report actions with permissions.

<a id="dmp-033"></a>
### DMP-033 — Authoritative customer list and balance summaries

Area: **Customers** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Debts loads paginated counterparties with backend summaries for debts, credits and settled customers.

**Mobile difference and consequence:** CustomersScreen initializes fixtures in preview or [] in real mode and never performs a GET list request; only customer creation is wired. debt_amount/sales_count display assumptions are not the real balance contract. The actual serializer emits debt_balance_uzs/debt_balance_usd and last_payment, not the fixture debt_amount/sales_count fields.

**Source evidence:** `frontend/ilbi/src/pages/Debts.jsx:90`; `frontend/ilbi/src/pages/Debts.jsx:269`; `mobile-app/src/features/customers/CustomersScreen.tsx:52`; `mobile-app/src/features/customers/CustomersScreen.tsx:71`; `backend/api/v1/sales/serializers.py:15`.

**Required verification / completion condition:** Load existing real customers without creating one, paginate/search, and compare UZS/USD debt/credit summaries against server aggregates.

<a id="dmp-034"></a>
### DMP-034 — Customer editing, deletion, notes, code and due date

Area: **Customers** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Desktop counterparties carry note, target_tenant_code and debt_due_date; edit/delete lifecycle uses server APIs.

**Mobile difference and consequence:** Mobile creation accepts name/phone only and has no edit/delete API or metadata fields.

**Source evidence:** `frontend/ilbi/src/pages/Debts.jsx:110`; `frontend/ilbi/src/api/client.js:703`; `mobile-app/src/features/checkout/CustomerPickerSheet.tsx:85`; `mobile-app/src/features/customers/CustomersScreen.tsx:71`.

**Required verification / completion condition:** Create a customer with note/code/default due date, edit allowed fields, reject invalid/dependent deletion and preserve historical sale identity.

<a id="dmp-035"></a>
### DMP-035 — Customer purchase and payment ledger

Area: **Customers** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop customer detail loads paginated purchases, debt sales and payment records with summaries.

**Mobile difference and consequence:** Mobile names/phone cards have no authoritative sales/payment tabs or customer statement; receipt navigation alone is not a ledger.

**Source evidence:** `frontend/ilbi/src/pages/Debts.jsx:92`; `frontend/ilbi/src/pages/Debts.jsx:145`; `frontend/ilbi/src/api/client.js:714`; `mobile-app/src/features/customers/CustomersScreen.tsx:1`.

**Required verification / completion condition:** Open one customer with several purchases/payments/returns and reconcile the displayed balance to the transaction history.

<a id="dmp-036"></a>
### DMP-036 — Spreadsheet customer import

Area: **Customers** · Priority: **P2** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** CounterpartyImportModal downloads a template, previews and commits a customer import.

**Mobile difference and consequence:** Mobile has no customer file import workflow or import endpoints.

**Source evidence:** `frontend/ilbi/src/components/common/CounterpartyImportModal.jsx:1`; `frontend/ilbi/src/api/client.js:699`; `mobile-app/src/features/customers/CustomersScreen.tsx:1`.

**Required verification / completion condition:** Import customers with duplicate/invalid phones and balance-related fields; inspect preview and retry commit safely.

<a id="dmp-037"></a>
### DMP-037 — Real debt filters and collection

Area: **Debts** · Priority: **P1** · Classification: **MOCK-ONLY** · First found in pass **1**.

**Desktop/backend behavior:** Desktop debt list and payment forms use current server balances and refresh related customer records after a payment.

**Mobile difference and consequence:** DebtsScreen is gated in real mode and its debtors/due statuses are fixture constants. A POST exists in the preview-only screen, but no actual debt-list integration does.

**Source evidence:** `frontend/ilbi/src/pages/Debts.jsx:154`; `frontend/ilbi/src/pages/Debts.jsx:178`; `mobile-app/src/features/debts/DebtsScreen.tsx:34`; `mobile-app/src/features/debts/DebtsScreen.tsx:121`.

**Required verification / completion condition:** Load real overdue/soon/future debt, make a partial payment and verify the server-confirmed remaining amount after navigation and restart.

<a id="dmp-038"></a>
### DMP-038 — Payment currency, cash/card, branch and note

Area: **Debts** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **1**.

**Desktop/backend behavior:** Desktop debt collection submits currency, payment_type, branch_id, note and an idempotency key.

**Mobile difference and consequence:** Mobile preview payment posts only amount/currency=UZS/idempotency_key, has no cash/card/branch/note controls and strips decimals with parseInt.

**Source evidence:** `frontend/ilbi/src/pages/Debts.jsx:178`; `backend/api/v1/sales/serializers.py:133`; `mobile-app/src/features/debts/DebtsScreen.tsx:77`.

**Required verification / completion condition:** Record cash and card debt payments in UZS/USD and a chosen branch, including a decimal amount; verify ledger/cashbox attribution.

<a id="dmp-039"></a>
### DMP-039 — Customer credit refund and payment correction

Area: **Debts** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop detects negative balance/customer credit and uses the correction endpoint to refund the chosen amount/currency/payment channel with a reason.

**Mobile difference and consequence:** Mobile assumes debts are positive, removes zero balances and has no credit/refund/correction UI or API call.

**Source evidence:** `frontend/ilbi/src/pages/Debts.jsx:207`; `frontend/ilbi/src/pages/Debts.jsx:228`; `frontend/ilbi/src/api/client.js:725`; `mobile-app/src/features/debts/DebtsScreen.tsx:98`.

**Required verification / completion condition:** Create overpayment/return credit, issue a partial refund with the correct payment channel and verify remaining credit and cash impact.

<a id="dmp-040"></a>
### DMP-040 — Open shift and current-register status

Area: **Cashbox** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop queries current shift and opens with separate opening_cash_uzs/opening_cash_usd; layout reflects shift status.

**Mobile difference and consequence:** Mobile has no shift route, current-shift request, opening-cash form or register status; Reports is not a cashbox implementation.

**Source evidence:** `frontend/ilbi/src/pages/Shifts.jsx:171`; `frontend/ilbi/src/pages/Shifts.jsx:179`; `frontend/ilbi/src/api/client.js:770`; `mobile-app/src/features/reports/ReportsScreen.tsx:33`.

**Required verification / completion condition:** Open a shift, prevent incompatible duplicate opening and show the current cashier/register and expected opening values.

<a id="dmp-041"></a>
### DMP-041 — Close shift, counted cash and discrepancy explanation

Area: **Cashbox** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop closes a real shift with shift_id, counted UZS/USD cash, discrepancy_reason and staff_notes, then opens the server report.

**Mobile difference and consequence:** Mobile prints a local report sample without closing any shift or recording counted cash/discrepancy.

**Source evidence:** `frontend/ilbi/src/pages/Shifts.jsx:193`; `mobile-app/src/features/reports/ReportsScreen.tsx:69`; `mobile-app/src/features/reports/ReportsScreen.tsx:40`.

**Required verification / completion condition:** Close an actual test shift with a mismatch, require reason as appropriate and confirm the report is created once by the server.

<a id="dmp-042"></a>
### DMP-042 — Cash expenses/income and reusable categories

Area: **Cashbox** · Priority: **P1** · Classification: **ABSENT** · First found in pass **1**.

**Desktop/backend behavior:** Desktop creates expense/income records with currency, category/source and note; locally saved category lists are tenant-specific.

**Mobile difference and consequence:** No mobile cash expense/income request, list, form or category/source management exists.

**Source evidence:** `frontend/ilbi/src/pages/Shifts.jsx:228`; `frontend/ilbi/src/pages/Shifts.jsx:272`; `frontend/ilbi/src/api/client.js:777`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** Record income and expense, verify expected cash changes, currency and reason, and preserve store-specific category preferences.

<a id="dmp-043"></a>
### DMP-043 — Historical Z-reports and share/print layouts

Area: **Cashbox** · Priority: **P1** · Classification: **MOCK-ONLY** · First found in pass **1**.

**Desktop/backend behavior:** Desktop loads paginated real reports, opens detail and supports ShiftReportSlip/ZReportModernView.

**Mobile difference and consequence:** Mobile today/week/month values are hardcoded and real mode is gated; the local Z-HISOBOT PDF is not a saved shift-close report.

**Source evidence:** `frontend/ilbi/src/pages/Shifts.jsx:68`; `frontend/ilbi/src/pages/Shifts.jsx:316`; `frontend/ilbi/src/components/common/ShiftReportSlip.jsx:1`; `mobile-app/src/features/reports/ReportsScreen.tsx:40`.

**Required verification / completion condition:** Open an older closed shift, compare all cash/debt/refund/expense fields and share/print the same authoritative saved report.

<a id="dmp-044"></a>
### DMP-044 — Incoming/outgoing B2B transaction lists

Area: **B2B** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop B2BTransactions presents inbox/outgoing lists with status/search/pagination and invoice access.

**Mobile difference and consequence:** Mobile has no B2B route, transaction model, inbox/outgoing API or status UI.

**Source evidence:** `frontend/ilbi/src/pages/B2BTransactions.jsx:68`; `frontend/ilbi/src/api/client.js:731`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** Send a test B2B sale between two permitted stores and reconcile both lists and invoice access.

<a id="dmp-045"></a>
### DMP-045 — Accept B2B with destination product/category mapping

Area: **B2B** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop resolves exact barcode/currency/unit matches, requires category mapping where needed and submits accepted quantities.

**Mobile difference and consequence:** No mobile accept form, mapping/quantity validation or accept endpoint exists.

**Source evidence:** `frontend/ilbi/src/pages/B2BTransactions.jsx:95`; `frontend/ilbi/src/pages/B2BTransactions.jsx:133`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** Accept mapped and unmapped lines, verify target stock/product creation and reject cross-currency/unit mistakes.

<a id="dmp-046"></a>
### DMP-046 — Reject, receive return and close B2B discrepancy

Area: **B2B** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop distinguishes rejecting a shipment, receiving returned goods and closing discrepancies with their own reasons/endpoints.

**Mobile difference and consequence:** Mobile exposes none of the rejection/return/discrepancy transitions. These are not ordinary cart deletion or stock adjustment.

**Source evidence:** `frontend/ilbi/src/pages/B2BTransactions.jsx:168`; `frontend/ilbi/src/pages/B2BTransactions.jsx:196`; `frontend/ilbi/src/pages/B2BTransactions.jsx:246`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** Exercise rejected and partially returned shipments; verify accepted/rejected/returned/pending quantities and final discrepancy history.

<a id="dmp-047"></a>
### DMP-047 — Hire, edit, invite and lifecycle management

Area: **Team** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Employees supports hire, edit, resend activation invitation, fire, block/unblock, archive/restore and reason tracking.

**Mobile difference and consequence:** No employee list, lifecycle UI or employee API is implemented on mobile. Owner/admin scope must be explicit.

**Source evidence:** `frontend/ilbi/src/pages/Employees.jsx:129`; `frontend/ilbi/src/pages/Employees.jsx:172`; `frontend/ilbi/src/pages/Employees.jsx:192`; `mobile-app/src/navigation/DrawerContent.tsx:45`.

**Required verification / completion condition:** As owner manage an employee through activation, restriction and termination without deleting historical transactions; cashier must not see management actions.

<a id="dmp-048"></a>
### DMP-048 — Granular permission editor and role presets

Area: **Team** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** EmployeePermissionsSelector loads choices, offers categories/full access/presets and sends selected permission IDs.

**Mobile difference and consequence:** Mobile has no permission editor or permission catalog lookup; UserTenant.permissions is merely a type field.

**Source evidence:** `frontend/ilbi/src/components/employees/EmployeePermissionsSelector.jsx:281`; `frontend/ilbi/src/components/employees/rolePresets.js:1`; `mobile-app/src/features/auth/AuthContext.tsx:14`.

**Required verification / completion condition:** Assign a narrow preset, customize individual permissions, refresh a cashier session and verify permitted actions and hidden confidential fields.

<a id="dmp-049"></a>
### DMP-049 — Owner store creation and seller-profile binding

Area: **Stores** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** MyTenants lists owned stores, creates seller profiles/stores, updates profiles and binds a seller profile to a store.

**Mobile difference and consequence:** Mobile can select an existing store but cannot create/configure one or bind its seller identity.

**Source evidence:** `frontend/ilbi/src/pages/MyTenants.jsx:54`; `frontend/ilbi/src/pages/MyTenants.jsx:72`; `frontend/ilbi/src/pages/MyTenants.jsx:130`; `mobile-app/src/features/auth/AuthContext.tsx:174`.

**Required verification / completion condition:** Create and configure a permitted owner store, bind its seller profile and observe it in store selection without leaking another owner’s store.

<a id="dmp-050"></a>
### DMP-050 — Platform overview, account status and identity recovery

Area: **Platform administration** · Priority: **P2** · Classification: **CONDITIONAL** · First found in pass **2**.

**Desktop/backend behavior:** Platform dashboard/accounts expose global overview, identity recovery and account-status operations using skipTenant calls.

**Mobile difference and consequence:** Mobile accepts platform_admin in UserProfile but lacks the dedicated administrative experience. Owner must decide whether mobile supports this role or explicitly excludes it.

**Source evidence:** `frontend/ilbi/src/pages/PlatformAccounts.jsx:1`; `frontend/ilbi/src/api/platform.js:14`; `frontend/ilbi/src/components/common/IdentityRecoveryModal.jsx:1`; `mobile-app/src/features/auth/AuthContext.tsx:31`.

**Required verification / completion condition:** If supported, test admin-only overview/account identity/status while store commercial data stays restricted; otherwise provide a clear role-not-supported screen.

<a id="dmp-051"></a>
### DMP-051 — Tenant administration, ownership transfer and activation

Area: **Platform administration** · Priority: **P2** · Classification: **CONDITIONAL** · First found in pass **2**.

**Desktop/backend behavior:** Tenants supports store creation/editing, activation/deactivation, resend-owner invitation and ownership transfer APIs.

**Mobile difference and consequence:** Mobile has no administrative tenant management; these are conditional admin capabilities, not normal cashier requirements.

**Source evidence:** `frontend/ilbi/src/pages/Tenants.jsx:63`; `frontend/ilbi/src/pages/Tenants.jsx:91`; `frontend/ilbi/src/api/client.js:423`; `mobile-app/src/navigation/DrawerContent.tsx:45`.

**Required verification / completion condition:** Decide scope; if enabled, require admin authorization, appropriate confirmation and audit evidence for each ownership/status transition.

<a id="dmp-052"></a>
### DMP-052 — Seller verification decisions and validity

Area: **Platform administration** · Priority: **P2** · Classification: **CONDITIONAL** · First found in pass **2**.

**Desktop/backend behavior:** SellerProfileReviews filters review state, requires rejection reason and future expiry for approval and posts the decision.

**Mobile difference and consequence:** Mobile has no seller-review queue, review form or validity/status model.

**Source evidence:** `frontend/ilbi/src/pages/SellerProfileReviews.jsx:73`; `frontend/ilbi/src/pages/SellerProfileReviews.jsx:80`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** If admin mobile is supported, approve/reject with validation, then verify expiry/revocation affects sale eligibility exactly as the backend dictates.

<a id="dmp-053"></a>
### DMP-053 — Store currency settings and automatic CBU rate

Area: **Settings** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Services loads current tenant settings, supports manual USD rate or automatic CBU rate and persists through tenant API.

**Mobile difference and consequence:** Mobile Settings only changes app theme/runtime server URL; no tenant currency/rate settings endpoint is loaded or saved.

**Source evidence:** `frontend/ilbi/src/pages/Services.jsx:56`; `frontend/ilbi/src/pages/Services.jsx:92`; `frontend/ilbi/src/pages/Services.jsx:157`; `mobile-app/src/features/settings/SettingsScreen.tsx:35`.

**Required verification / completion condition:** Switch manual/automatic rates in an authorized account, handle absent CBU data and propagate updates to calculators without changing historical transactions.

<a id="dmp-054"></a>
### DMP-054 — Receipt identity, layout and tax configuration

Area: **Settings** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** ReceiptSettingsPanel/Services manage store identity, footer/phone, paper width, tax regime/mode/rate and receipt display fields.

**Mobile difference and consequence:** Mobile cannot load/edit these settings; ReceiptScreen generates a separate simplified HTML document.

**Source evidence:** `frontend/ilbi/src/components/common/ReceiptSettingsPanel.jsx:1`; `frontend/ilbi/src/pages/Services.jsx:224`; `mobile-app/src/features/settings/SettingsScreen.tsx:35`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:66`.

**Required verification / completion condition:** Edit authorized receipt/tax settings, preview a new sale and verify old receipts retain their saved snapshot rather than new settings.

<a id="dmp-055"></a>
### DMP-055 — Telegram destination, notification preferences and test

Area: **Settings** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Services configures telegram_group_id, sale/debt notifications and report destinations and sends an explicit test message.

**Mobile difference and consequence:** Mobile has no tenant Telegram/notification preferences or test action. Audit did not send any real message.

**Source evidence:** `frontend/ilbi/src/pages/Services.jsx:60`; `frontend/ilbi/src/pages/Services.jsx:188`; `mobile-app/src/features/settings/SettingsScreen.tsx:35`.

**Required verification / completion condition:** With an authorized test destination, save preferences and exercise explicit test success/error; do not send messages as a side effect of opening settings.

<a id="dmp-056"></a>
### DMP-056 — Scheduled and on-demand daily/shift/low-stock reports

Area: **Settings** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Services configures report times, daily/weekly/monthly low-stock schedule, web/Telegram targets and manual report actions.

**Mobile difference and consequence:** Mobile report periods are fixtures and no schedule/target configuration or send-report request exists.

**Source evidence:** `frontend/ilbi/src/pages/Services.jsx:62`; `frontend/ilbi/src/pages/Services.jsx:202`; `frontend/ilbi/src/pages/Services.jsx:216`; `mobile-app/src/features/reports/ReportsScreen.tsx:40`.

**Required verification / completion condition:** Configure and read back each schedule/target; use isolated delivery tests and distinguish scheduled sends from generated local previews.

<a id="dmp-057"></a>
### DMP-057 — Authenticated and guest help conversations

Area: **Support** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** HelpLauncher/Support support guests and signed-in users, conversation lists/history and text replies; login has a separately scoped guest session.

**Mobile difference and consequence:** Mobile has no help launcher, support route, guest session token, conversation or send-message API.

**Source evidence:** `frontend/ilbi/src/api/support.js:8`; `frontend/ilbi/src/api/support.js:41`; `frontend/ilbi/src/components/support/HelpLauncher.jsx:195`; `mobile-app/src/navigation/DrawerContent.tsx:45`.

**Required verification / completion condition:** Open help before/after login, preserve the correct conversation ownership and verify another account cannot see the previous account’s messages.

<a id="dmp-058"></a>
### DMP-058 — Attachments, voice, stickers and multilingual support UI

Area: **Support** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop support accepts image paste/upload, voice recording/playback/speed and stickers, with support translations.

**Mobile difference and consequence:** Mobile has no support media picker/recorder/player or support language handling. Microphone permission cannot be inferred from a web preview.

**Source evidence:** `frontend/ilbi/src/components/support/HelpLauncher.jsx:267`; `frontend/ilbi/src/components/support/VoiceRecorder.jsx:1`; `frontend/ilbi/src/components/support/VoicePlayer.jsx:1`; `frontend/ilbi/src/components/support/translations.js:1`.

**Required verification / completion condition:** Send allowed image/voice/sticker samples in a test conversation, deny microphone/media permissions and verify cancellation/background cleanup.

<a id="dmp-059"></a>
### DMP-059 — Operator inbox and customer/tenant profile actions

Area: **Support** · Priority: **P2** · Classification: **CONDITIONAL** · First found in pass **2**.

**Desktop/backend behavior:** Support operator mode exposes inbox/action workflows and CustomerProfileModal permits authorized customer/account/tenant changes. Inbox actions include claim, close/reopen and read-through tracking; replies are constrained by operator assignment.

**Mobile difference and consequence:** No operator support scope or customer-profile tools exist on mobile; decide admin/operator support before porting.

**Source evidence:** `frontend/ilbi/src/api/support.js:42`; `frontend/ilbi/src/components/support/CustomerProfileModal.jsx:44`; `frontend/ilbi/src/components/support/CustomerProfileModal.jsx:104`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** If supported, restrict operator actions, verify message ownership and audit account/store status changes with an explicit reason.

<a id="dmp-060"></a>
### DMP-060 — Real notification inbox, unread count and actions

Area: **Notifications** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Layout loads new/older notifications, marks one/all read, deletes one/all and opens parsed detail/actions.

**Mobile difference and consequence:** Home bell has no onPress and permanently draws a red dot. No notification request, unread state or list exists.

**Source evidence:** `frontend/ilbi/src/components/layout/Layout.jsx:101`; `frontend/ilbi/src/components/layout/Layout.jsx:153`; `frontend/ilbi/src/components/notifications/NotificationParser.js:1`; `mobile-app/src/features/home/HomeScreen.tsx:86`.

**Required verification / completion condition:** Receive test notification types, paginate older messages, mark/read/delete and deep-link to the right record/store without a fabricated unread badge.

<a id="dmp-061"></a>
### DMP-061 — Global search, favorites and quick tools

Area: **Workspace** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** WorkspaceSearch queries pages/business objects; WorkspaceTools provides quick tools and favorite shortcuts; workspace mode is persisted.

**Mobile difference and consequence:** Sidebar search filters menu labels only, not products/customers/sales. No global workspace search, favorites or quick tools exist. A desktop-style full workspace layout need not be copied.

**Source evidence:** `frontend/ilbi/src/components/workspace/WorkspaceSearch.jsx:15`; `frontend/ilbi/src/components/workspace/WorkspaceTools.jsx:49`; `frontend/ilbi/src/context/WorkspaceContext.jsx:11`; `mobile-app/src/navigation/DrawerContent.tsx:59`.

**Required verification / completion condition:** Search a sale/customer/product across more than one page, open it in the correct context and test mobile-appropriate shortcuts without losing the current cart.

<a id="dmp-062"></a>
### DMP-062 — Reminders, assignment, due dates and completion

Area: **Workspace** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Reminders loads members and reminder pages, creates assigned/due tasks and updates/deletes/completes them.

**Mobile difference and consequence:** Mobile has no reminder model, assignment picker, task list, create/update/delete requests or reminder notifications.

**Source evidence:** `frontend/ilbi/src/components/workspace/Reminders.jsx:34`; `frontend/ilbi/src/components/workspace/Reminders.jsx:47`; `frontend/ilbi/src/api/workspace.js:6`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** Create an assigned reminder, edit its due time, complete/reopen/delete with permissions and verify the same task on desktop/mobile.

<a id="dmp-063"></a>
### DMP-063 — Unified activity timeline and change snapshots

Area: **History** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** History combines sales, inventory, catalog, finance, team/settings events; supports periods, custom dates, details and before/after fields.

**Mobile difference and consequence:** No mobile activity/history route, endpoint or snapshot viewer exists. Recent sales alone cannot replace this timeline.

**Source evidence:** `frontend/ilbi/src/pages/History.jsx:22`; `frontend/ilbi/src/pages/History.jsx:81`; `frontend/ilbi/src/api/client.js:796`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** Filter each event category/date, view actor/time and old/new values, open linked receipts and respect cost/permission visibility.

<a id="dmp-064"></a>
### DMP-064 — Audit journal with filters and detail

Area: **History** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Audit lists server audit records by action/tenant/page with detailed payloads and explicit loading/error recovery.

**Mobile difference and consequence:** Mobile has no audit endpoint or journal UI; local success toasts are not an audit trail.

**Source evidence:** `frontend/ilbi/src/pages/Audit.jsx:21`; `frontend/ilbi/src/api/client.js:800`; `mobile-app/src/navigation/DrawerContent.tsx:45`.

**Required verification / completion condition:** As an authorized owner/admin inspect representative catalog, price, employee, cashbox and settings events; restricted staff must be denied.

<a id="dmp-065"></a>
### DMP-065 — Sale-linked A4 invoice with authoritative rows

Area: **Documents** · Priority: **P1** · Classification: **MOCK-ONLY** · First found in pass **2**.

**Desktop/backend behavior:** InvoiceA4Modal renders the chosen sale/customer/store/cashier and transaction-specific invoice title, rows, tax and amount-in-words.

**Mobile difference and consequence:** DocumentsScreen uses fixed document records and hardcoded sample invoice content; there is no mapping from the selected real sale to an actual A4 invoice. Real mode is gated.

**Source evidence:** `frontend/ilbi/src/components/common/InvoiceA4Modal.jsx:396`; `mobile-app/src/features/documents/DocumentsScreen.tsx:48`; `mobile-app/src/features/documents/DocumentsScreen.tsx:250`; `mobile-app/src/features/documents/DocumentsScreen.tsx:128`.

**Required verification / completion condition:** Open invoices for cash/card/debt/partner/B2B sales with different items and verify the selected saved transaction drives every amount/identity field.

<a id="dmp-066"></a>
### DMP-066 — Sender and receiver signatures with persisted document identity

Area: **Documents** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **2**.

**Desktop/backend behavior:** Desktop captures sender and receiver in separate steps and restores signatures using a tenant+sale key in local storage. This is local persistence, not proof of server-synced legal signing.

**Mobile difference and consequence:** Mobile has one local SVG signature path and signed flag only; navigation/remount discards it, no sender/receiver identities or timestamp persistence exists.

**Source evidence:** `frontend/ilbi/src/components/common/InvoiceA4Modal.jsx:409`; `frontend/ilbi/src/components/common/InvoiceA4Modal.jsx:421`; `mobile-app/src/features/documents/DocumentsScreen.tsx:90`; `mobile-app/src/features/documents/DocumentsScreen.tsx:95`.

**Required verification / completion condition:** Capture both roles, cancel/clear independently, reopen/restart and verify the correct signature is bound to the correct store and document; define server sync separately.

<a id="dmp-067"></a>
### DMP-067 — Actual document PDF/share action

Area: **Documents** · Priority: **P1** · Classification: **MOCK-ONLY** · First found in pass **2**.

**Desktop/backend behavior:** Desktop/web ShareDocumentButton prepares the visible invoice/receipt including inline images/signatures and saves an actual PDF through native or browser export.

**Mobile difference and consequence:** Mobile Documents Ulashish onPress only displays Ulashish oynasi ochildi. It neither generates nor shares any file, even in design preview. Receipt PDF code does not implement document sharing.

**Source evidence:** `frontend/ilbi/src/components/common/ShareDocumentButton.jsx:63`; `frontend/ilbi/src/utils/documentShare.js:27`; `mobile-app/src/features/documents/DocumentsScreen.tsx:405`.

**Required verification / completion condition:** Share a signed A4 invoice, verify an actual readable file with the same rows/signatures, and distinguish cancellation/error from successful file creation.

<a id="dmp-068"></a>
### DMP-068 — Saved receipt snapshot, taxes and product identifiers

Area: **Receipts** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **2**.

**Desktop/backend behavior:** ReceiptSlip uses receipt_snapshot, tax summary and item MXIK/package/barcode/code/unit fields, plus sale state and seller information.

**Mobile difference and consequence:** ReceiptScreen maps only productName/quantity/unitPrice; it does not render saved tax regime/rate, subtotal/tax, product identifiers, fiscal state or receipt snapshot. Its exported HTML also uses plain ilbi.uz text instead of the authentic in-app SVG logo, so onscreen and printed/PDF branding are not equivalent.

**Source evidence:** `frontend/ilbi/src/components/common/ReceiptSlip.jsx:1`; `frontend/ilbi/src/components/common/ReceiptTaxSummary.jsx:1`; `frontend/ilbi/src/components/common/ReceiptItemCodes.jsx:1`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:53`.

**Required verification / completion condition:** Compare a historical tax-bearing receipt with different current settings; amounts, identifiers, status and fiscal/non-fiscal labels must match the saved sale. Compare actual logo and configured store identity across screen, print and PDF.

<a id="dmp-069"></a>
### DMP-069 — Thermal 58/80 mm format and configurable printer output

Area: **Receipts** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **2**.

**Desktop/backend behavior:** Desktop receipt UI selects/persists 58mm or 80mm and print/PDF helpers explicitly set paper dimensions and layout.

**Mobile difference and consequence:** Mobile Print.printToFileAsync/printAsync receives generic HTML; no paper-width selector or actual thermal page dimensions are set. A 320px body is not 58/80mm verification.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:2229`; `frontend/ilbi/src/components/common/ReceiptSlip.jsx:77`; `frontend/ilbi/src/utils/documentShare.js:30`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:66`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:116`.

**Required verification / completion condition:** Inspect exported physical page width and print long receipts on both paper sizes without clipping, excess A4 margins or lost totals.

<a id="dmp-070"></a>
### DMP-070 — Real QR/barcode and public receipt viewing

Area: **Receipts** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **2**.

**Desktop/backend behavior:** Desktop generates scannable QR/barcode, exposes token URLs and has public /r/:token and /receipt/:token pages.

**Mobile difference and consequence:** Mobile deliberately removed the decorative QR but has not implemented a real QR/barcode, public receipt route, or universal/app-link receipt handler. Copying an opaque link is only a partial capability.

**Source evidence:** `frontend/ilbi/src/pages/PublicReceiptView.jsx:1`; `frontend/ilbi/src/components/common/ReceiptSlip.jsx:1`; `frontend/ilbi/src/App.jsx:129`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:57`; `mobile-app/src/app`.

**Required verification / completion condition:** Scan a generated receipt QR, open it while logged out and from another device, handle revoked/invalid tokens and avoid leaking unrelated customer data.

<a id="dmp-071"></a>
### DMP-071 — Rotate/revoke public receipt share token

Area: **Receipts** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop Sales rotates a sale receipt token and refreshes the selected receipt.

**Mobile difference and consequence:** Mobile copy link uses the existing token only; no rotation action, confirmation or invalidated-link behavior exists.

**Source evidence:** `frontend/ilbi/src/pages/Sales.jsx:174`; `frontend/ilbi/src/api/client.js:670`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:150`.

**Required verification / completion condition:** Rotate a test receipt token; old URL must fail and new URL must work consistently on desktop, browser and mobile.

<a id="dmp-072"></a>
### DMP-072 — Permanent file saving and genuine file viewing

Area: **Receipts** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **2**.

**Desktop/backend behavior:** Desktop uses a native save dialog; browser uses an actual download; canceled saves are reported separately.

**Mobile difference and consequence:** Mobile only has a temporary print-to-file URI and invokes Sharing. The PDFni ulashish control shares a file rather than viewing it; no permanent user-selected save/download path is implemented.

**Source evidence:** `desktop/ilbi/document-sharing.cjs:29`; `frontend/ilbi/src/utils/documentPDF.js:4`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:116`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:223`.

**Required verification / completion condition:** Create a PDF, save it to a user-visible destination, reopen it after app restart and verify distinct save/open/share cancellation/error states.

<a id="dmp-073"></a>
### DMP-073 — Excel/CSV exports of business lists

Area: **Exports** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop business screens use ExcelExportButton/export endpoints for filtered business data.

**Mobile difference and consequence:** Mobile has no spreadsheet download/export control, blob/file pipeline or export permission handling.

**Source evidence:** `frontend/ilbi/src/components/common/ExcelExportButton.jsx:1`; `backend/api/v1/exports.py:1`; `mobile-app/src/api/client.ts:154`; `mobile-app/src/navigation/useAppNavigation.ts:4`.

**Required verification / completion condition:** Export the same active filters/tenant on both clients, verify all pages and columns and ensure confidential costs are omitted for restricted users.

<a id="dmp-074"></a>
### DMP-074 — Real help/legal documentation and certificate printing

Area: **Documentation** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Documentation fetches document list/content, renders Markdown/images, supports authorized editing and certificate printing.

**Mobile difference and consequence:** DocumentsScreen is a sample invoice/signature UI; it does not implement the separate help/legal documentation route or document API. These meanings of Hujjatlar must not be conflated.

**Source evidence:** `frontend/ilbi/src/pages/Documentation.jsx:144`; `frontend/ilbi/src/pages/Documentation.jsx:176`; `frontend/ilbi/src/pages/Documentation.jsx:195`; `mobile-app/src/features/documents/DocumentsScreen.tsx:48`.

**Required verification / completion condition:** Open help and legal content, follow internal links/images, verify editing is role-limited and distinguish help documents from sale invoices.

<a id="dmp-075"></a>
### DMP-075 — Usable offline data store and business write journal

Area: **Offline** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop embeds a local Django/PostgreSQL runtime and sync protocol; permitted reads/writes can use the prepared local store.

**Mobile difference and consequence:** Mobile persists a cart and retry key only. There is no local business database, offline catalog/ledger cache or complete write journal; legacy outbox enqueue/replay is blocked intentionally. Mobile needs an appropriate storage design, not a copied PostgreSQL binary.

**Source evidence:** `desktop/ilbi/runtime.cjs:1`; `backend/apps/desktop_sync/local.py:1`; `mobile-app/src/features/sync/outbox.ts:21`; `mobile-app/src/features/cart/CartContext.tsx:74`.

**Required verification / completion condition:** Prepare data online, disconnect/restart, perform allowed offline work and reconnect; preserve audit/stock/account identity without duplicate server writes.

<a id="dmp-076"></a>
### DMP-076 — Offline enrollment, account grants and credential expiry

Area: **Offline** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop prepares a tenant/device, grants account access and validates credential/security expiry before offline unlock.

**Mobile difference and consequence:** Mobile has no offline preparation, signed account/device grant, offline credential policy or revoke/expiry enforcement. A cached access token is not an offline authorization scheme.

**Source evidence:** `backend/apps/desktop_sync/grants.py:1`; `backend/apps/desktop_sync/account_access.py:1`; `backend/apps/desktop_sync/device_credentials.py:1`; `mobile-app/src/features/auth/AuthContext.tsx:94`.

**Required verification / completion condition:** If mobile offline is in scope, test enrollment, expiry, revoked user/device and offline reconnect with retained pending records.

<a id="dmp-077"></a>
### DMP-077 — Automatic reconnect synchronization with ordered dependencies

Area: **Offline** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop worker wakes and replays dependent operations with server receipts/revisions and status handling.

**Mobile difference and consequence:** Mobile has no connectivity observer, scheduled worker/background sync or dependency graph; SyncBanner defaults isOffline=false and calls a blocked legacy sender. Full-source search also shows SyncBanner is never imported or mounted by the application, so its explanatory UI is not actually reachable.

**Source evidence:** `backend/apps/desktop_sync/worker.py:1`; `backend/apps/desktop_sync/protocol.py:1`; `mobile-app/src/features/sync/SyncBanner.tsx:15`; `mobile-app/src/features/sync/outbox.ts:34`.

**Required verification / completion condition:** Reconnect after offline customer→sale→payment operations; send in dependency order once, survive interruption and reconcile accepted server results.

<a id="dmp-078"></a>
### DMP-078 — Sync center, progress, priority and retry controls

Area: **Offline** · Priority: **P2** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop SyncCenter exposes operation progress, server-confirmation waiting, priority ordering, retry eligibility and blocking reasons.

**Mobile difference and consequence:** Mobile banner offers no real sync center/details; manual action is hidden behind false && and processQueue never sends. No per-operation progress/reason/priority exists.

**Source evidence:** `frontend/ilbi/src/components/sync/SyncCenter.jsx:1`; `backend/apps/desktop_sync/desktop_api.py:84`; `mobile-app/src/features/sync/SyncBanner.tsx:94`; `mobile-app/src/features/sync/outbox.ts:34`.

**Required verification / completion condition:** Inspect pending/processing/blocked/failed/accepted states, prioritize one dependency-safe operation and distinguish transport progress from server confirmation.

<a id="dmp-079"></a>
### DMP-079 — Uncertain result reconciliation and journal migration

Area: **Offline** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **2**.

**Desktop/backend behavior:** Desktop tracks accepted operations/object mappings and has dependency-aware retry/visibility; existing local data is retained across updates.

**Mobile difference and consequence:** Mobile stores one fingerprint/key per operation scope, blocks a changed payload, and preserves an owner-less legacy queue without any reconciliation/migration UI. Users cannot resolve an unknown result through the app.

**Source evidence:** `backend/apps/desktop_sync/models.py:1`; `backend/apps/desktop_sync/local.py:1`; `mobile-app/src/api/financialIdentity.ts:4`; `mobile-app/src/features/sync/outbox.ts:21`.

**Required verification / completion condition:** Drop a reply after the server commits, restart, resolve the original operation by identity and safely migrate old records without blindly replaying another account’s work.

<a id="dmp-080"></a>
### DMP-080 — Session auto-lock and background privacy

Area: **Security** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop SessionLock implements durable lock state, activity/idle timeout and security controls, with a guarded session UI.

**Mobile difference and consequence:** Mobile has no AppState/privacy overlay, idle lock, unlock screen or durable lock policy; authenticated screens remain available while tokens stay loaded.

**Source evidence:** `desktop/ilbi/session-lock.cjs:1`; `desktop/ilbi/preload.cjs:33`; `frontend/ilbi/src/components/sync/DesktopSessionGuard.jsx:1`; `mobile-app/App.tsx:14`; `mobile-app/src/navigation/RootNavigator.tsx:8`.

**Required verification / completion condition:** Background the app with customer/receipt details open, inspect task-switcher exposure, wait through timeout and require an authorized unlock without losing drafts.

<a id="dmp-081"></a>
### DMP-081 — Encrypted backup, restore and pending-work preservation

Area: **Offline** · Priority: **P1** · Classification: **ABSENT** · First found in pass **2**.

**Desktop/backend behavior:** Desktop Backups performs protected create/restore, owner reauthorization, runtime quiescence and draft/pending-work preservation.

**Mobile difference and consequence:** Mobile has no backup/restore/recovery policy for cart/journal data or verification of OS backup behavior. Do not transplant raw desktop database files to mobile.

**Source evidence:** `desktop/ilbi/backups.cjs:1`; `desktop/ilbi/application.cjs:345`; `desktop/ilbi/draft-backup.cjs:1`; `mobile-app/src/features/cart/CartContext.tsx:74`.

**Required verification / completion condition:** Define supported mobile backup/recovery, test restart/reinstall/device-loss scenarios and ensure private pending transactions cannot be restored into another account/store.

<a id="dmp-082"></a>
### DMP-082 — Connect to an existing local primary register

Area: **Offline** · Priority: **P2** · Classification: **CONDITIONAL** · First found in pass **2**.

**Desktop/backend behavior:** Desktop pairing gives an expiring single-use code, matching confirmation marks, per-register keys and owner-controlled revoke/rejoin.

**Mobile difference and consequence:** Mobile cannot pair to the primary register or use its offline LAN store. Decide whether phones must act as secondary registers; native TLS/discovery/storage must be designed if so.

**Source evidence:** `desktop/ilbi/pairing-manager.cjs:1`; `desktop/ilbi/preload.cjs:5`; `frontend/ilbi/src/components/sync/DesktopSecurityPanel.jsx:1`; `mobile-app/src/features/settings/SettingsScreen.tsx:35`.

**Required verification / completion condition:** If mobile LAN-register mode is approved, test claim/owner confirmation, wrong network, expiry, revoked device and primary-host sleep/restart.

<a id="dmp-083"></a>
### DMP-083 — Installed mobile package, updates and data migration

Area: **Release** · Priority: **P1** · Classification: **UNVERIFIED** · First found in pass **2**.

**Desktop/backend behavior:** Desktop packaging targets Windows/Linux and provides verified-manifest download/update helpers that preserve pending data.

**Mobile difference and consequence:** Mobile has JavaScript exports only; no accepted Android/iOS install/signing/update/rollback/migration evidence. Electron updater code itself is desktop-specific and should not be copied.

**Source evidence:** `desktop/ilbi/package.json:17`; `desktop/ilbi/updater.cjs:1`; `mobile-app/app.json:1`; `mobile-app/package.json:57`.

**Required verification / completion condition:** Install signed development/release builds on actual Android/iOS, upgrade with a draft/pending operation and verify compatible data migration and rollback/error handling.

<a id="dmp-084"></a>
### DMP-084 — Telegram bot connection onboarding is missing

Area: **Auth** · Priority: **P1** · Classification: **ABSENT** · First found in pass **3**.

**Desktop/backend behavior:** Desktop checks telegram_linked, presents TelegramConnectionGate and polls telegram-status before sending OTP when the account is not linked.

**Mobile difference and consequence:** Mobile ignores telegram_linked, has no bot link/contact-sharing gate or status polling and moves directly to an OTP entry screen. New/unlinked accounts cannot complete the intended onboarding path.

**Source evidence:** `frontend/ilbi/src/pages/Login.jsx:156`; `frontend/ilbi/src/components/auth/TelegramConnectionGate.jsx:1`; `backend/api/v1/accounts/views/admin_login.py:126`; `mobile-app/src/features/auth/AuthContext.tsx:138`.

**Required verification / completion condition:** Use an unlinked account, open the real bot, share contact and continue automatically after confirmation; handle expired tickets and denied contact linking.

<a id="dmp-085"></a>
### DMP-085 — Initial OTP is never requested by mobile login

Area: **Auth** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** For linked accounts desktop immediately calls sendTelegramOtp after receiving login_ticket, then shows the OTP screen.

**Mobile difference and consequence:** Mobile login sets loginStep=otp without calling sendOtp; the screen claims a code was sent even though only manual Kodni qayta yuborish triggers the send request.

**Source evidence:** `frontend/ilbi/src/pages/Login.jsx:160`; `mobile-app/src/features/auth/AuthContext.tsx:138`; `mobile-app/src/features/auth/LoginScreen.tsx:32`; `mobile-app/src/features/auth/LoginScreen.tsx:124`.

**Required verification / completion condition:** On the first password-success response verify exactly one initial OTP send request occurs and the UI says sent only after its acknowledgement.

<a id="dmp-086"></a>
### DMP-086 — OTP validity, resend cooldown and expired-ticket recovery

Area: **Auth** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **3**.

**Desktop/backend behavior:** Desktop validates the six-character contract, displays a resend timer, returns to credentials when the login ticket expires and handles Telegram disconnection.

**Mobile difference and consequence:** Mobile accepts four/five characters locally despite a six-character serializer, has no resend cooldown/ticket-expiry reset or back-to-credentials action. A bad/expired ticket leaves the user in the OTP branch.

**Source evidence:** `backend/api/v1/accounts/serializers.py:248`; `frontend/ilbi/src/pages/Login.jsx:186`; `mobile-app/src/features/auth/LoginScreen.tsx:48`; `mobile-app/src/features/auth/LoginScreen.tsx:64`.

**Required verification / completion condition:** Reject incomplete/non-numeric input locally as applicable, respect retry/expiry data and return to a usable credential/contact step without restarting the app.

<a id="dmp-087"></a>
### DMP-087 — Membership permission metadata is overwritten by a thinner response

Area: **Auth** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** The /auth/me/ serializer returns membership is_owner/permissions. /tenants/my/ returns id/name/public_code/address/is_active/seller_profile, not membership permissions. Desktop keeps membership context.

**Mobile difference and consequence:** fetchProfile assigns profile.tenants = tenants from /tenants/my/, discarding the existing permission/ownership metadata. Optional fields in UserTenant then hide the contract mismatch.

**Source evidence:** `backend/api/v1/accounts/serializers.py:68`; `backend/api/v1/tenants/serializers.py:76`; `mobile-app/src/features/auth/AuthContext.tsx:69`.

**Required verification / completion condition:** Load a restricted employee and owner fixture matching actual serializers, merge store metadata without discarding membership permissions, and assert resulting guards.

<a id="dmp-088"></a>
### DMP-088 — Partially initialized profile becomes an authenticated session

Area: **Auth** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** Desktop blocks its protected application on an unresolved/error session verification state.

**Mobile difference and consequence:** Mobile fetchProfile calls setUser before awaiting /tenants/my/. If that second request fails, Boolean(user) is already true while activeTenant is absent or old; login reports failure yet the business shell may open.

**Source evidence:** `frontend/ilbi/src/App.jsx:38`; `mobile-app/src/features/auth/AuthContext.tsx:69`; `mobile-app/src/features/auth/AuthContext.tsx:198`; `mobile-app/src/navigation/RootNavigator.tsx:18`.

**Required verification / completion condition:** Resolve /auth/me/ successfully then fail tenant discovery; do not expose a misleading ready session or attach requests to a prior tenant.

<a id="dmp-089"></a>
### DMP-089 — Variant parent-product ID mapping differs from backend

Area: **Catalog** · Priority: **P2** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** ProductVariantOutputSerializer emits the parent product under product.

**Mobile difference and consequence:** CatalogVariant requires product_id and handleAddToCart uses product.product_id, while preview fixtures invent that field. Real variants therefore create cart metadata with undefined productId, concealed by design data. Checkout still posts variantId, so this alone does not prove a failed sale.

**Source evidence:** `backend/api/v1/catalog/serializers.py:102`; `mobile-app/src/features/catalog/CatalogScreen.tsx:23`; `mobile-app/src/features/catalog/CatalogScreen.tsx:81`; `mobile-app/src/dev/preview.ts:14`.

**Required verification / completion condition:** Render/add a fixture copied from the real serializer, verify productId mapping and reject structurally invalid records before persistence.

<a id="dmp-090"></a>
### DMP-090 — Per-sale debt due-date selection and payload

Area: **Checkout** · Priority: **P1** · Classification: **ABSENT** · First found in pass **3**.

**Desktop/backend behavior:** Desktop checkout has DebtDueDateField, derives a customer default and sends debt_due_date only for debt sales.

**Mobile difference and consequence:** Mobile checkout offers cash/card/debt but has no due-date control and never includes debt_due_date. This is separate from customer-profile metadata editing.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:107`; `frontend/ilbi/src/pages/POS.jsx:498`; `frontend/ilbi/src/pages/POS.jsx:1792`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:69`.

**Required verification / completion condition:** Choose a default/custom/no due date for nasiya, save it, and verify overdue/soon classification from the accepted sale rather than a fixed sample.

<a id="dmp-091"></a>
### DMP-091 — Decimal prices and payments are changed into different amounts

Area: **Money input** · Priority: **P1** · Classification: **REPRODUCED** · First found in pass **3**.

**Desktop/backend behavior:** Desktop PriceInput preserves decimal money; backend unit_price accepts two decimals and quantity accepts three.

**Mobile difference and consequence:** Mobile price editor and cash/debt parsers remove every non-digit then parseInt: 11.50 becomes 1150, -5 becomes 5 and 1,25 becomes 125. Isolated parser probes reproduce this transformation; whole-number fixture tests miss it.

**Source evidence:** `frontend/ilbi/src/components/common/PriceInput.jsx:79`; `backend/api/v1/sales/serializers.py:237`; `mobile-app/src/features/cart/CartScreen.tsx:67`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:59`; `mobile-app/src/features/debts/DebtsScreen.tsx:79`.

**Required verification / completion condition:** Implement an explicit locale/decimal policy, preserve cents, reject negative/invalid strings and verify displayed, posted and calculated amounts are identical.

<a id="dmp-092"></a>
### DMP-092 — Fractional quantity entry and precise line display

Area: **Cart** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **3**.

**Desktop/backend behavior:** Desktop POS has a direct quantity field, unit-aware three-decimal formatting and cent-rounded line/tax calculations.

**Mobile difference and consequence:** Mobile exposes only +1/-1 in a context menu. Context can store fractional values, but no usable weight/length quantity editor exists; displayed line totals use raw multiplication while the cart total rounds cents.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:148`; `frontend/ilbi/src/pages/POS.jsx:254`; `mobile-app/src/features/cart/CartScreen.tsx:266`; `mobile-app/src/features/cart/CartScreen.tsx:295`; `mobile-app/src/features/cart/CartContext.tsx:130`.

**Required verification / completion condition:** Sell 0.125 kg at a two-decimal price, validate unit/precision and ensure every rounded line sums exactly to the shown grand total.

<a id="dmp-093"></a>
### DMP-093 — Confirmed change uses the earlier local total, not accepted server total

Area: **Checkout** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** Authoritative sale totals may reflect receipt tax settings; desktop obtains settings before payment and snapshots the accepted result.

**Mobile difference and consequence:** Mobile computes change before POST and stores that old value next to result.total_amount. If the server accepts a different total, the confirmation can display the server total with an inconsistent cash/change pair.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:396`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:59`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:77`.

**Required verification / completion condition:** Return a confirmed total different from the pre-submit local total; reconcile or require confirmation before clearing the cart, and assert received minus accepted total equals shown change.

<a id="dmp-094"></a>
### DMP-094 — Payment draft survives neither navigation nor process restart

Area: **Checkout** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **3**.

**Desktop/backend behavior:** Desktop stores payment method, received amounts, selected customer and debt due date in account-scoped drafts.

**Mobile difference and consequence:** Mobile cart/customer persist, but Checkout paymentMethod and cashReceivedStr exist only in component state. Leaving/restarting resets the tender context even while a pending retry identity survives.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:95`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:53`; `mobile-app/src/api/financialIdentity.ts:4`.

**Required verification / completion condition:** Begin checkout, enter tender/method, background/restart and recover the correct user/store draft without resubmitting an uncertain operation.

<a id="dmp-095"></a>
### DMP-095 — Card/debt receipts are labeled as cash

Area: **Receipts** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** Desktop ReceiptSlip derives payment presentation from sale.payment_type and authoritative receipt state.

**Mobile difference and consequence:** Mobile receipt HTML and screen unconditionally show Naqd and Qaytim. Checkout attaches cashReceived/change even when paymentMethod is card or debt, so a non-cash receipt can contain misleading cash values.

**Source evidence:** `frontend/ilbi/src/components/common/ReceiptSlip.jsx:1`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:77`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:96`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:288`.

**Required verification / completion condition:** Complete card and debt sales after previously entering cash; verify receipt/payment labels and absence of fabricated tender/change fields in screen, print and PDF.

<a id="dmp-096"></a>
### DMP-096 — Invalid/missing sale ID waits forever without an actionable error

Area: **Receipts** · Priority: **P2** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** Desktop public/detail views distinguish loading, invalid/not-found and retry/error states.

**Mobile difference and consequence:** If receipt has no saleRecord and saleId is absent/non-numeric, the effect never requests anything and the UI permanently says receipt data is loading. Fetch failures also have no retry action.

**Source evidence:** `frontend/ilbi/src/pages/PublicReceiptView.jsx:1`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:44`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:156`.

**Required verification / completion condition:** Open /receipt with missing, malformed, deleted and unauthorized IDs; stop loading, show the appropriate error/back/retry state and never reuse another sale.

<a id="dmp-097"></a>
### DMP-097 — Route-parameter changes do not reset the loaded receipt/PDF state

Area: **Receipts** · Priority: **P2** · Classification: **UNVERIFIED** · First found in pass **3**.

**Desktop/backend behavior:** A receipt detail view should be bound to the currently requested saved sale and reset document artifacts when that identity changes.

**Mobile difference and consequence:** saleRecord initializes once; the effect only fetches when !saleRecord. If the router reuses the component for a different saleId, the previous sale/pdfUri/pdfReady/share mode remain. Native router reuse and current user paths need a runtime reproduction.

**Source evidence:** `mobile-app/src/features/receipts/ReceiptScreen.tsx:40`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:44`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:60`.

**Required verification / completion condition:** Reuse the same receipt route instance with another ID, including back/forward/deep links; assert sale/PDF/share state resets before the new identity is shown.

<a id="dmp-098"></a>
### DMP-098 — Declared binary response handling returns text instead of a file

Area: **API** · Priority: **P2** · Classification: **REPRODUCED** · First found in pass **3**.

**Desktop/backend behavior:** Desktop request handles responseType=blob for templates/exports and downstream code receives actual binary data.

**Mobile difference and consequence:** Mobile RequestOptions advertises blob/text, but request always parses JSON or text by Content-Type and ignores responseType. An isolated %PDF response probe returns a string, not Blob.

**Source evidence:** `frontend/ilbi/src/api/client.js:247`; `mobile-app/src/api/client.ts:154`; `mobile-app/src/api/client.ts:210`.

**Required verification / completion condition:** Request PDF/XLSX/image and text responses with explicit responseType; preserve binary bytes, filenames and error handling.

<a id="dmp-099"></a>
### DMP-099 — Runtime API-origin changes retain the current authorization

Area: **API** · Priority: **P1** · Classification: **REPRODUCED** · First found in pass **3**.

**Desktop/backend behavior:** Desktop uses a locked official server policy; mobile Settings signs out before applying a new endpoint.

**Mobile difference and consequence:** The exported setApiBaseUrl itself neither signs out nor invalidates the session. Login’s live server field calls it directly on every edit. A synthetic probe confirms an existing Bearer token is subsequently attached to another configured origin.

**Source evidence:** `desktop/ilbi/runtime.cjs:8`; `mobile-app/src/api/client.ts:7`; `mobile-app/src/features/auth/LoginScreen.tsx:174`; `mobile-app/src/features/settings/SettingsScreen.tsx:45`.

**Required verification / completion condition:** Keep development endpoint changes behind a deliberate policy, validate complete URLs and clear/invalidate prior-origin sessions before any request to the next origin. No real endpoint was contacted by the probe.

<a id="dmp-100"></a>
### DMP-100 — Server identity is absent from draft and financial-intent keys

Area: **Persistence** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** Desktop pins its server/store identity; independent environments must not share business drafts or operation identities by coincidental numeric IDs.

**Mobile difference and consequence:** Mobile permits changing the API server, but cart and financial keys include only userId/tenantId/operation. Test and production servers with matching numeric IDs share drafts and pending fingerprints on the same installation.

**Source evidence:** `mobile-app/src/api/client.ts:7`; `mobile-app/src/features/cart/CartContext.tsx:76`; `mobile-app/src/api/financialIdentity.ts:6`; `mobile-app/src/features/settings/SettingsScreen.tsx:45`.

**Required verification / completion condition:** Use two isolated backend origins with equal user/store IDs; require separate drafts/journals or a safe origin-change migration, never automatic cross-origin submission.

<a id="dmp-101"></a>
### DMP-101 — Concurrent submissions get different retry identities

Area: **Financial operations** · Priority: **P1** · Classification: **REPRODUCED** · First found in pass **3**.

**Desktop/backend behavior:** A financial identity must be created atomically for one pending user/store operation; retries must join the same identity rather than race.

**Mobile difference and consequence:** withFinancialIdentity is a read-then-write sequence with no shared lock/transaction. Two concurrent calls for identical payload/scope both read no record and generate different keys. Synthetic probe produced synthetic-key-1 and synthetic-key-2. UI ref guards cover one Checkout instance only.

**Source evidence:** `mobile-app/src/api/financialIdentity.ts:4`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:42`.

**Required verification / completion condition:** Call the helper concurrently from two clients/instances sharing persistence, simulate crash between identity creation and POST and verify one stable operation identity.

<a id="dmp-102"></a>
### DMP-102 — A transient cart restore failure can overwrite the saved draft

Area: **Persistence** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** Recoverable storage failures should preserve persisted business work and show a retry state; empty-cart replacement must be deliberate.

**Mobile difference and consequence:** CartProvider catches getItem/JSON errors, then sets ready=true with [] in real mode. The persistence effect subsequently writes that empty draft to the same key, replacing data after a failed read/parse.

**Source evidence:** `frontend/ilbi/src/hooks/useAccountDraft.js:1`; `mobile-app/src/features/cart/CartContext.tsx:84`; `mobile-app/src/features/cart/CartContext.tsx:98`.

**Required verification / completion condition:** Make getItem fail once while a nonempty draft exists; verify no write replaces it, show a recoverable error and restore successfully on retry.

<a id="dmp-103"></a>
### DMP-103 — Saved cart records have no schema validation or migration

Area: **Persistence** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **3**.

**Desktop/backend behavior:** Desktop draft helpers include scoped/legacy-owner recovery behavior. Neither client is assumed to have fully validated every historical draft schema; the mobile release must explicitly tolerate old/corrupt persisted records.

**Mobile difference and consequence:** Mobile accepts any draft.items array and any truthy customer object without validating quantities/prices/IDs, version, numeric types or tenant ownership. Invalid records can create NaN totals or stale product/customer references.

**Source evidence:** `frontend/ilbi/src/utils/accountDrafts.js:1`; `mobile-app/src/features/cart/CartContext.tsx:85`; `mobile-app/src/features/cart/CartContext.tsx:91`; `mobile-app/src/features/cart/CartContext.tsx:129`.

**Required verification / completion condition:** Load old-schema, corrupt, string-number, negative/NaN and unknown-variant drafts; migrate or quarantine safely and require authoritative validation before sale.

<a id="dmp-104"></a>
### DMP-104 — Cart mutation has no readiness/saved/error feedback

Area: **Persistence** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **3**.

**Desktop/backend behavior:** Business UI must distinguish a loaded draft from an unready or unsaved draft and report persistence failures truthfully.

**Mobile difference and consequence:** CartProvider exposes no ready/saving/error state; mutation is ignored when previous.scope differs, yet Catalog always toasts that a product was added. Save failures only console.warn, so the UI can imply work was retained when it was not.

**Source evidence:** `mobile-app/src/features/cart/CartContext.tsx:98`; `mobile-app/src/features/cart/CartContext.tsx:105`; `mobile-app/src/features/catalog/CatalogScreen.tsx:81`.

**Required verification / completion condition:** Delay hydration or fail setItem, tap Add immediately and verify a blocked/retryable state or confirmed save status rather than an unconditional success toast.

<a id="dmp-105"></a>
### DMP-105 — Older requests can overwrite newer search/store results

Area: **Lists** · Priority: **P2** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** Desktop usePaginatedList uses abort/generation/request identity guards for paginated loading.

**Mobile difference and consequence:** Mobile Catalog debounces starting requests but does not cancel/identify in-flight queries; an older successful response can overwrite a newer one. Old catch handlers in Catalog/Home can also set error/empty state after a newer tenant request succeeds. API generation rejection alone does not guard component catch mutations.

**Source evidence:** `frontend/ilbi/src/hooks/usePaginatedList.js:1`; `mobile-app/src/features/catalog/CatalogScreen.tsx:62`; `mobile-app/src/features/home/HomeScreen.tsx:39`.

**Required verification / completion condition:** Resolve query A after query B and fail an old store request after the new store succeeds; the current results/error state must remain attached to the current request.

<a id="dmp-106"></a>
### DMP-106 — Customer picker only loads and searches the first server page

Area: **Customers** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **3**.

**Desktop/backend behavior:** Desktop checkout uses server-debounced, paginated counterparty search and retains a selected row outside the current page.

**Mobile difference and consequence:** CustomerPickerSheet fetches one unfiltered default page, then filters it locally with no server search or pagination. Existing later-page customers appear absent, encouraging duplicate creation.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:100`; `mobile-app/src/features/checkout/CustomerPickerSheet.tsx:57`; `mobile-app/src/features/checkout/CustomerPickerSheet.tsx:71`.

**Required verification / completion condition:** Select an existing customer outside page one by name/phone, preserve the current selection while searching and avoid duplicate creation.

<a id="dmp-107"></a>
### DMP-107 — No default request timeout or structured retry/backoff UX

Area: **API** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **3**.

**Desktop/backend behavior:** Desktop list/recovery components use abort signals and explicit retry handling; OTP/support respect retry metadata.

**Mobile difference and consequence:** Mobile core requests have no default deadline and most callers pass no signal. The client discards Retry-After and refresh failures lose status/data, so loading may hang or rate-limit recovery may be generic. Synthetic refresh-401 probe confirms error.status is absent despite cleared tokens.

**Source evidence:** `frontend/ilbi/src/hooks/usePaginatedList.js:1`; `frontend/ilbi/src/pages/Login.jsx:186`; `mobile-app/src/api/client.ts:120`; `mobile-app/src/api/client.ts:194`; `mobile-app/src/api/client.ts:218`.

**Required verification / completion condition:** Simulate a stalled connection, refresh rejection and 429; cancel/deadline safely, preserve an uncertain sale identity, expose retry timing and return to a consistent session UI.

<a id="dmp-108"></a>
### DMP-108 — Storage cleanup error can hide the original checkout failure

Area: **Financial operations** · Priority: **P1** · Classification: **SOURCE-BUG** · First found in pass **3**.

**Desktop/backend behavior:** An unsuccessful business request must keep its original error visible and must not report completion or discard unresolved intent after a storage exception.

**Mobile difference and consequence:** Checkout catch awaits confirmFinancialIdentity for selected 4xx responses before setError. If removeItem rejects there, the handler rejects out of catch, skips the original error message and relies on finally only. A storage failure during success confirmation also turns an accepted sale into an unresolved result without reconciliation UI.

**Source evidence:** `mobile-app/src/features/checkout/CheckoutScreen.tsx:74`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:80`; `mobile-app/src/api/financialIdentity.ts:17`.

**Required verification / completion condition:** Inject removeItem failure after a 400 and after a confirmed 201; keep the primary outcome visible, preserve operation evidence and offer reconciliation instead of an unhandled rejection.

<a id="dmp-109"></a>
### DMP-109 — Clear-cart action has no confirmation or undo

Area: **Cart UX** · Priority: **P2** · Classification: **SOURCE-BUG** · First found in pass **4**.

**Desktop/backend behavior:** Desktop handleClearCart asks for confirmation before resetting the cart/payment draft.

**Mobile difference and consequence:** Mobile Tozalash directly calls clearCart; an accidental tap immediately removes items/customer and the persistence effect saves the empty draft. There is no undo.

**Source evidence:** `frontend/ilbi/src/pages/POS.jsx:301`; `mobile-app/src/features/cart/CartScreen.tsx:113`; `mobile-app/src/features/cart/CartContext.tsx:123`.

**Required verification / completion condition:** Tap clear with a populated draft; require explicit confirmation or a durable undo and verify cancellation does not alter the saved draft.

<a id="dmp-110"></a>
### DMP-110 — Bottom navigation disappears on secondary main modules

Area: **Navigation** · Priority: **P2** · Classification: **REPRODUCED** · First found in pass **4**.

**Desktop/backend behavior:** Desktop Layout retains common navigation while business modules change. The owner explicitly asked to keep quick bottom navigation alongside the mobile sidebar.

**Mobile difference and consequence:** Mobile documents/inventory/customers/reports/settings are Drawer siblings of the tabs group, not screens inside the tab scaffold. Their main lists do not retain the same visible bottom navigation. Full-screen receipt/checkout may legitimately differ. The actual Docker browser probe confirmed the Documents page’s retained tablist has visibility=false and 0×0 bounds, compared with five tabs in Cart.

**Source evidence:** `frontend/ilbi/src/components/layout/Layout.jsx:389`; `mobile-app/src/app/(app)/_layout.tsx:6`; `mobile-app/src/navigation/BottomTabNavigator.tsx:8`.

**Required verification / completion condition:** From each main sidebar module verify direct Bosh/Tovar/Savdo/Qarz/Menyu access under the approved navigation contract, while preserving intentional full-screen document/checkout states.

<a id="dmp-111"></a>
### DMP-111 — Price editor touch target is approximately 20 px high

Area: **Touch UX** · Priority: **P2** · Classification: **REPRODUCED** · First found in pass **4**.

**Desktop/backend behavior:** The approved mobile master specifies practical targets around 44 logical points (48 on Android where suitable) without enlarging the tiny product thumbnail.

**Mobile difference and consequence:** Browser inspection of the actual milk unit-price control measured about 61.66 × 20 px. priceEditBtn has only 3px vertical padding and no hitSlop. Compact appearance currently reduces the practical tapping area. Native dimensions still need device verification.

**Source evidence:** `branding/mobile-concepts/v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md:317`; `mobile-app/src/features/cart/CartScreen.tsx:241`; `mobile-app/src/features/cart/CartScreen.tsx:589`.

**Required verification / completion condition:** Measure interactive bounds on native Android/iOS and expand touch area without overlapping adjacent price/quantity actions or replacing small cart images with large cards.

<a id="dmp-112"></a>
### DMP-112 — Input labels and icon controls lack consistent accessible names

Area: **Accessibility** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **4**.

**Desktop/backend behavior:** Desktop common inputs/dialogs provide labels and keyboard/focus semantics; the mobile master requires understandable accessible controls.

**Mobile difference and consequence:** Mobile Input renders a separate Text label without binding an accessibilityLabel/labelledBy to TextInput. Many icon-only controls have no name. The cart browser probe found both rendered inputs with null aria-label; some price/cash/header controls already have explicit labels and should be retained.

**Source evidence:** `mobile-app/src/components/ui/Input.tsx:37`; `mobile-app/src/components/ui/Input.tsx:62`; `mobile-app/src/features/cart/CartScreen.tsx:88`; `mobile-app/src/components/ui/ScreenHeader.tsx:59`.

**Required verification / completion condition:** Use VoiceOver/TalkBack and keyboard/switch navigation to identify every field/icon, selected tab, validation error and modal close action in a sensible order.

<a id="dmp-113"></a>
### DMP-113 — Bottom safe areas are not handled consistently outside tabs

Area: **Native layout** · Priority: **P2** · Classification: **UNVERIFIED** · First found in pass **4**.

**Desktop/backend behavior:** Mobile bottom actions must remain reachable above Android gesture navigation/iPhone home indicator; browser phone frames do not model OS insets.

**Mobile difference and consequence:** Root SafeAreaView excludes bottom; tabs explicitly use insets, but Checkout sticky actions, Receipt actions and generic BottomSheet use fixed padding without bottom-inset handling. Actual overlap must be checked on native runtimes.

**Source evidence:** `mobile-app/App.tsx:17`; `mobile-app/src/navigation/BottomTabNavigator.tsx:9`; `mobile-app/src/components/ui/BottomSheet.tsx:110`; `mobile-app/src/features/checkout/CheckoutScreen.tsx:370`.

**Required verification / completion condition:** Test devices with gesture/home indicators, landscape/modal transitions and keyboard open/closed; essential actions must stay above the safe area.

<a id="dmp-114"></a>
### DMP-114 — Price/customer/signature sheets lack verified keyboard avoidance

Area: **Native layout** · Priority: **P2** · Classification: **UNVERIFIED** · First found in pass **4**.

**Desktop/backend behavior:** Login and Checkout already use KeyboardAvoidingView; reusable form sheets need equivalent reachable-action behavior.

**Mobile difference and consequence:** BottomSheet has a fixed 90% maximum and normal View body, with no keyboard/inset integration or general scroll container. Price autofocus and customer creation can obscure Apply/Select on short native screens; browser-only interaction does not prove this works.

**Source evidence:** `mobile-app/src/components/ui/BottomSheet.tsx:30`; `mobile-app/src/components/ui/BottomSheet.tsx:110`; `mobile-app/src/features/cart/CartScreen.tsx:389`; `mobile-app/src/features/checkout/CustomerPickerSheet.tsx:123`.

**Required verification / completion condition:** Open numeric/text keyboards on short Android/iPhone screens and large text; scroll to apply/create/select, dismiss safely and preserve typed values.

<a id="dmp-115"></a>
### DMP-115 — Large text and small-screen acceptance covers too little

Area: **Accessibility** · Priority: **P2** · Classification: **UNVERIFIED** · First found in pass **4**.

**Desktop/backend behavior:** The master requires font scaling, small screens and no disappearance of essential financial data/actions.

**Mobile difference and consequence:** Current browser test checks documentElement width on Home at 320px, not the populated cart, checkout, drawer, signature, document or report views under enlarged fonts. Fixed column ratios/one-line names need native scaled-text testing.

**Source evidence:** `branding/mobile-concepts/v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md:316`; `mobile-app/src/features/cart/CartScreen.tsx:532`; `mobile-app/tests/preview.browser.mjs:80`.

**Required verification / completion condition:** Exercise every main and modal state at small width/large OS font size, including long names and large amounts, without clipping totals or hiding apply/pay actions.

<a id="dmp-116"></a>
### DMP-116 — Error and cancellation feedback uses a success presentation

Area: **Feedback** · Priority: **P2** · Classification: **SOURCE-BUG** · First found in pass **4**.

**Desktop/backend behavior:** Desktop toast calls distinguish error/warning/success and document save helpers separate canceled actions from failed ones.

**Mobile difference and consequence:** Mobile Toast defaults to success with a check icon; Receipt and Debts pass error text without a type override. Receipt print/share catch paths also label all exceptions as cancellation, hiding actual technical failures.

**Source evidence:** `mobile-app/src/components/ui/Toast.tsx:23`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:125`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:129`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:170`; `mobile-app/src/features/debts/DebtsScreen.tsx:132`.

**Required verification / completion condition:** Trigger export, share, payment and clipboard failures plus user cancellation; require correct severity, accessible announcement and specific retryable error details.

<a id="dmp-117"></a>
### DMP-117 — Lists conflate initial loading, empty and failed states

Area: **Loading UX** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **4**.

**Desktop/backend behavior:** Desktop usePaginatedList/recovery components expose loading, errors, retry and pagination independently.

**Mobile difference and consequence:** Mobile Catalog starts at [], has no initial loading indicator or empty-result explanation, and shows raw errors without an explicit retry button. Customer picker similarly starts with an empty list while loading. Pull-to-refresh is not sufficient first-load guidance.

**Source evidence:** `frontend/ilbi/src/hooks/usePaginatedList.js:1`; `frontend/ilbi/src/components/common/RecoveryNotice.jsx:1`; `mobile-app/src/features/catalog/CatalogScreen.tsx:56`; `mobile-app/src/features/checkout/CustomerPickerSheet.tsx:57`.

**Required verification / completion condition:** Delay a first response, return an empty result, fail it and retry; display distinct stable states without implying missing products/customers while a request is still pending.

<a id="dmp-118"></a>
### DMP-118 — Business timestamps use device timezone instead of a consistent store timezone

Area: **Time handling** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **4**.

**Desktop/backend behavior:** Desktop History explicitly formats business dates in Asia/Tashkent. Reporting and due dates must use an agreed business timezone.

**Mobile difference and consequence:** Mobile Home/Receipt/new Date formatting relies on the device timezone and preview debt dates are literal strings. A device traveling across midnight can show different business dates from desktop/backend. This is not a claim that every desktop screen already normalizes all timezones.

**Source evidence:** `frontend/ilbi/src/pages/History.jsx:33`; `mobile-app/src/features/home/HomeScreen.tsx:52`; `mobile-app/src/features/home/HomeScreen.tsx:72`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:208`.

**Required verification / completion condition:** Set devices to different timezones near midnight and compare receipt, report period and due-date labels using the configured business timezone.

<a id="dmp-119"></a>
### DMP-119 — No native animation, Reduce Motion or large-list performance evidence

Area: **Motion/performance** · Priority: **P2** · Classification: **UNVERIFIED** · First found in pass **4**.

**Desktop/backend behavior:** Desktop uses visible polling/reduced-motion-aware workspace behavior; the mobile master requires responsive large lists and Reduce Motion support.

**Mobile difference and consequence:** Mobile has browser navigation evidence and uses FlatList (positive), but no native performance measurements, large data fixture acceptance or explicit reduced-motion tests. BottomSheet always requests slide animation. Installed animation libraries do not prove smoothness.

**Source evidence:** `frontend/ilbi/src/context/WorkspaceContext.jsx:52`; `branding/mobile-concepts/v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md:824`; `mobile-app/src/components/ui/BottomSheet.tsx:48`; `mobile-app/src/features/cart/CartScreen.tsx:218`.

**Required verification / completion condition:** Measure real Android/iPhone scrolling/price editing/navigation with large legal datasets and OS Reduce Motion; record frame stalls/memory and keep input responsive.

<a id="dmp-120"></a>
### DMP-120 — Launcher and adaptive icons still reference template assets

Area: **Brand/release** · Priority: **P2** · Classification: **PARTIAL** · First found in pass **4**.

**Desktop/backend behavior:** Desktop packaging uses actual ILBI icon resources and the mobile design requires authentic brand assets.

**Mobile difference and consequence:** In-app SVG logos exist, but app.json still points to Expo-generated icon/adaptive foreground/background/monochrome assets and favicon. No accepted native launch/splash identity evidence exists.

**Source evidence:** `desktop/ilbi/package.json:65`; `mobile-app/app.json:7`; `mobile-app/app.json:14`; `mobile-app/src/components/brand/IlbiLogo.tsx:1`.

**Required verification / completion condition:** Install the app and verify launcher/adaptive/monochrome icon, launch screen and light/dark startup all use the approved ILBI identity.

<a id="dmp-121"></a>
### DMP-121 — HTML escaping is applied to a native header string

Area: **Receipt display** · Priority: **P3** · Classification: **SOURCE-BUG** · First found in pass **4**.

**Desktop/backend behavior:** HTML export should escape inserted text, while React Native Text already renders strings as text.

**Mobile difference and consequence:** Receipt ScreenHeader title interpolates escapeHtml(receipt_number). A receipt number containing & or another escaped character is shown with literal HTML entities, unlike the original value. This is a display defect, not an injection claim.

**Source evidence:** `mobile-app/src/features/receipts/ReceiptScreen.tsx:59`; `mobile-app/src/features/receipts/ReceiptScreen.tsx:164`.

**Required verification / completion condition:** Render a synthetic receipt number containing &, quotes and angle brackets; native header should show the exact plain text while exported HTML remains escaped.

<a id="dmp-122"></a>
### DMP-122 — Test suite lacks real API-contract and non-fixture coverage

Area: **Quality** · Priority: **P1** · Classification: **PARTIAL** · First found in pass **4**.

**Desktop/backend behavior:** Desktop/frontend have tests covering document export, API/session behavior and numerous workflow helpers, though tests alone do not prove all functionality.

**Mobile difference and consequence:** The 31 mobile tests pass but many are fixture arithmetic; checkout mocks request/identity/auth/cart. Preview fabricates fields and cannot detect actual serializer mismatches, tax/fiscal/permissions failures, native exports or offline recovery.

**Source evidence:** `mobile-app/tests/checkout.test.tsx:8`; `mobile-app/tests/debts.test.tsx:20`; `mobile-app/src/dev/preview.ts:14`; `mobile-app/tests/preview.browser.mjs:55`; `backend/api/v1/catalog/serializers.py:102`.

**Required verification / completion condition:** Add serializer-shaped contract fixtures and isolated end-to-end cases for every P1 flow, then verify actual native/backend behavior rather than raising a pass percentage from static samples.

<a id="dmp-123"></a>
### DMP-123 — Document-share browser regression expects the obsolete domain

Area: **Desktop/web quality** · Priority: **P2** · Classification: **REPRODUCED** · First found in pass **4**.

**Desktop/backend behavior:** Current documentShare uses https://ilbi.uz and the browser test exercises real generated PDF/download behavior with synthetic content.

**Mobile difference and consequence:** The existing document-share browser test fails at line 102 because it still expects new-dev.site for the public copied link. Actual output is https://ilbi.uz/r/<token>. This is a stale desktop/web test expectation, not evidence that the new production link is wrong. Assertions after that line did not execute.

**Source evidence:** `frontend/ilbi/tests/documentShare.browser.mjs:102`; `frontend/ilbi/src/utils/documentShare.js:1`; `frontend/ilbi/src/pages/PublicReceiptView.jsx:1`.

**Required verification / completion condition:** Update the test fixture/expected canonical origin in a later implementation task and rerun the entire browser suite; keep the audit’s observed failure until then.

<a id="dmp-124"></a>
### DMP-124 — Login-throttle ban recovery is distinct from account status

Area: **Platform administration** · Priority: **P2** · Classification: **CONDITIONAL** · First found in pass **5**.

**Desktop/backend behavior:** Dashboard includes authApi.unban(target_user_id) for platform-admin recovery of the login-throttle/device/account ban state.

**Mobile difference and consequence:** Mobile has neither an admin unban action nor a recovery path explaining this distinction; generic login error is the only outcome. Blocking/unblocking an employee is a different workflow.

**Source evidence:** `frontend/ilbi/src/pages/Dashboard.jsx:192`; `frontend/ilbi/src/api/client.js:337`; `backend/api/v1/accounts/views/unban.py:35`; `mobile-app/src/features/auth/LoginScreen.tsx:32`.

**Required verification / completion condition:** If mobile admin is supported, recover a permitted throttled user with audit evidence; deny self-unban/unauthorized access and distinguish retry delay from disabled membership.

<a id="dmp-125"></a>
### DMP-125 — Global support Telegram settings and delivery test

Area: **Platform administration** · Priority: **P2** · Classification: **CONDITIONAL** · First found in pass **5**.

**Desktop/backend behavior:** PlatformSettings loads/saves/tests platform-level support Telegram settings through /support/settings/telegram endpoints.

**Mobile difference and consequence:** Mobile has no equivalent admin support configuration. This is separate from a store’s normal sale/debt/report Telegram preferences.

**Source evidence:** `frontend/ilbi/src/components/platform/PlatformSettings.jsx:23`; `frontend/ilbi/src/api/platform.js:20`; `mobile-app/src/features/settings/SettingsScreen.tsx:35`.

**Required verification / completion condition:** Decide admin mobile scope; if included, restrict access, mask sensitive configuration and distinguish saving settings from an explicitly requested test send.

<a id="dmp-126"></a>
### DMP-126 — Mobile checks are not part of the repository CI workflow

Area: **Quality** · Priority: **P2** · Classification: **ABSENT** · First found in pass **5**.

**Desktop/backend behavior:** Repository workflows validate backend/frontend/deployment and package desktop targets.

**Mobile difference and consequence:** No workflow references mobile-app validation, Expo export or native acceptance. Passing the existing CI therefore does not establish mobile correctness or enforce its required lint/type/test gates.

**Source evidence:** `.github/workflows/ci.yml:24`; `.github/workflows/desktop-linux.yml:1`; `.github/workflows/desktop-windows.yml:1`; `mobile-app/package.json:47`.

**Required verification / completion condition:** Add an SDK-compatible mobile validation job in an implementation task and prove a deliberate mobile type/test failure blocks the required check; native jobs need separately documented credentials/runtimes.

<a id="dmp-127"></a>
### DMP-127 — Expo toolchain has unresolved high-severity audit entries

Area: **Dependencies** · Priority: **P2** · Classification: **UNVERIFIED** · First found in pass **5**.

**Desktop/backend behavior:** A releasable package needs an assessed dependency/tooling baseline; desktop/frontend and mobile are separate dependency graphs.

**Mobile difference and consequence:** Fresh npm audit --omit=dev reports five high entries: expo, @expo/cli, @expo/code-signing-certificates, node-forge and zod. The proposed automated fix is an incompatible Expo 44 downgrade. This is a tooling advisory result, not proof of an exploitable native runtime flaw.

**Source evidence:** `mobile-app/package.json:12`; `mobile-app/package-lock.json:1`; `mobile-app/docs/MOBILE_REVIEW.md:36`.

**Required verification / completion condition:** Resolve or explicitly assess the advisories using a compatible supported SDK/toolchain, re-run the audit and native/export tests; do not force an old SDK merely to zero the count.

<a id="dmp-128"></a>
### DMP-128 — Unused prototype code and navigation dependencies remain

Area: **Maintenance** · Priority: **P3** · Classification: **PARTIAL** · First found in pass **5**.

**Desktop/backend behavior:** Desktop and mobile use different navigation systems and should maintain a clear supported implementation surface.

**Mobile difference and consequence:** Mobile lint currently reports 57 warnings, largely unused imports/state/prototype branches. Direct @react-navigation packages remain declared even though app navigation migrated to Expo Router; dormant types/adapters add confusion. No lint errors were found.

**Source evidence:** `mobile-app/package.json:8`; `mobile-app/src/navigation/types.ts:1`; `mobile-app/src/navigation/useAppNavigation.ts:18`; `mobile-app/src/features/sync/SyncBanner.tsx:94`.

**Required verification / completion condition:** Remove confirmed unused code/dependencies after checking native/router requirements, keep the actual routes authoritative and achieve an intentional lint baseline without suppressing meaningful rules.

<a id="dmp-129"></a>
### DMP-129 — Production retail POS is intentionally closed pending fiscal integration

Area: **Shared platform boundary** · Priority: **P1** · Classification: **SHARED-BLOCKER** · First found in pass **5**.

**Desktop/backend behavior:** SaleService._assert_seller_ready and create-sale validation require seller readiness; in this repository it explicitly rejects retail POS when settings.DEBUG is false because fiscal-provider/OFD integration is not ready. The service also limits a receipt to 100 distinct variant rows.

**Mobile difference and consequence:** This limitation affects the shared business backend, not just mobile. A successful synthetic/debug checkout does not prove desktop or mobile production retail readiness. No production configuration/write was tested. Do not remove the gate merely to make a demo succeed.

**Source evidence:** `backend/apps/sales/services/sale_service.py:125`; `backend/apps/sales/services/sale_service.py:136`; `backend/apps/sales/services/sale_service.py:141`; `frontend/ilbi/src/content/desktop-guide.uz.md:115`; `mobile-app/src/dev/preview.ts:42`.

**Required verification / completion condition:** Implement and verify the intended fiscal-provider business workflow and seller readiness in an isolated environment before production acceptance; retain the protective gate until those requirements are met, and test the 100-line limit without confusing it with performance fixtures.

<a id="dmp-130"></a>
### DMP-130 — Synthetic data and mutations diverge across mobile screens

Area: **Preview consistency** · Priority: **P2** · Classification: **SOURCE-BUG** · First found in pass **6**.

**Desktop/backend behavior:** Even a synthetic design preview should use one coherent set of customer/product/sale identities so a cross-screen workflow can be checked meaningfully. Real desktop workflows read a shared backend.

**Mobile difference and consequence:** Mobile Customers INITIAL_CUSTOMERS gives Ali/id=1 a 320,000 debt; Debts CANONICAL_DEBTS and preview API customer id=1 use 230,000. Customer names for other IDs differ too. Preview debt payment only changes one screen and its API stub does not update shared balances; documents remain a separate fixed list after checkout. This is a demo consistency defect, not proof that real server balances were changed.

**Source evidence:** `mobile-app/src/features/customers/CustomersScreen.tsx:39`; `mobile-app/src/features/debts/DebtsScreen.tsx:34`; `mobile-app/src/dev/preview.ts:21`; `mobile-app/src/dev/preview.ts:62`; `mobile-app/src/features/documents/DocumentsScreen.tsx:48`.

**Required verification / completion condition:** Use one synthetic source for shared identities and mutations; after checkout/payment/create-customer, verify Home, customer details, debt list, receipt and documents agree or clearly label an intentionally static storyboard.

<a id="dmp-131"></a>
### DMP-131 — Logout icon uses the same color as its button background

Area: **Accessibility** · Priority: **P3** · Classification: **SOURCE-BUG** · First found in pass **7**.

**Desktop/backend behavior:** A destructive action needs a readable icon/label in both themes; the approved compact UI still needs contrast.

**Mobile difference and consequence:** Settings passes LogOut color=colors.danger into Button variant=danger. Button sets its background to colors.danger, so the icon blends into the background. The text is white and remains readable; the defect is specifically the icon contrast.

**Source evidence:** `mobile-app/src/features/settings/SettingsScreen.tsx:222`; `mobile-app/src/components/ui/Button.tsx:51`; `mobile-app/src/components/ui/Button.tsx:88`.

**Required verification / completion condition:** Inspect destructive buttons in both themes and disabled/loading states; use the intended contrasting foreground for icons and preserve an accessible action name.

## What is already present — do not regress it

- A shared React Native/TypeScript mobile codebase, Expo Router routes, authentic in-app SVG brand components, light/dark/system theme, a sidebar and five bottom tabs exist.
- A compact cart, negotiated current-sale price, item counts, canonical cent-rounded total, customer picker/create subset and basic cash/card/debt checkout are present. Do not confuse this with global catalog price editing.
- Failed checkout no longer fabricates a receipt or clears the cart; a confirmed sale ID is required. Existing tests cover this boundary.
- User/store-scoped cart restoration and ordinary identical-payload retry identity exist. The newly recorded failure/race/origin cases limit that implementation; they do not erase the verified subset.
- Existing token-generation protection prevents an old 401 from logging out a new account and lets a refresh retry its own request. The remaining session initialization/storage/error UX issues are separate.
- Receipt items/totals are loaded from the selected sale, decorative fake QR/fixed item summaries were removed, Clipboard actually copies and failed PDF generation no longer reports ready.
- Legacy offline queue records are retained with unsafe replay disabled. Temporary-cache cleanup no longer deletes financial intents/drafts. Do not re-enable blind replay to make a sync icon work.
- Docker phone preview and source-driven live refresh were verified in the previous implementation review. This audit’s additional browser probe was read-only with explicit synthetic data; it did not mutate real accounting.
- Previous fabricated sale/debt/customer/PDF success paths are historical fixes, not new open defects to count again. Preserve them and extend real contract/failure coverage.

## Validation run during this audit

| Check | Observed result | Meaning / limit |
| --- | --- | --- |
| Desktop `npm test` | 39 tests: 34 passed, 5 skipped, 0 failed | Default unit/helper checks only. Native Windows/Linux installed-runtime checks were skipped, not passed. |
| Frontend `npm test` | 67 passed, 0 failed | Default helper/source tests; not every business flow. |
| Mobile `npm run typecheck` | Passed | Static typing; broad `any`/fixtures still conceal contract mistakes. |
| Mobile `npm run lint` | 0 errors, 57 warnings | Warnings are recorded, not hidden. |
| Mobile `npm test` | 9 suites, 31 tests passed | Does not establish real serializer/native/fiscal/offline parity. |
| Frontend `npm run test:document-share` | FAILED at obsolete-domain assertion, line 102 | Earlier PDF/width/signature/QR/download assertions executed before this failure; later public-receipt download/final checks did not run. Do not label the whole suite passed. |
| Isolated API/persistence/parser probes | Executed with synthetic data, mocked fetch and in-memory storage | Reproduced text instead of Blob, retained cross-origin authorization, missing refresh error status, two concurrent retry keys and decimal/sign stripping. No external endpoint or real token used. |
| Actual mobile Docker browser probe | Loaded synthetic preview, cart and Documents; no browser errors observed | Price target ~61.66×20 px; two inspected inputs had no aria-label; Documents tablist was invisible/0×0 while Cart had five tabs. Not native acceptance. |
| `npm audit --omit=dev` (mobile) | Five high entries, no critical/moderate/low entries in this report | CLI/tooling advisory result; automatic proposal is an incompatible Expo 44 downgrade and was not applied. |
| Native tools | `adb`, `emulator`, `xcodebuild` absent from PATH | No native phone/emulator tests performed. |
| Real deployed backend, production accounting and fiscal integration | Not executed | Source boundary identified; no real sale, payment, message, pairing, backup restore or production deployment was performed. |
| Audited source hashes and evidence references | All indexed source hashes unchanged; all cited paths/line ranges exist | This task produced a Markdown audit, without changing application behavior. |

The browser probes used an isolated Chrome profile. Temporary inspection scripts/logs were kept under `/tmp/ilbi-parity-*`; the observations and outcomes needed for this handoff are embedded below, so those temporary files are not required to understand the report. Historical screenshots/test logs in `mobile-app/docs/evidence/` belong to the earlier development review unless explicitly stated otherwise.

### Isolated reproduction observations

```json
[
  {
    "probe": "responseType=blob",
    "observedType": "string",
    "isBlob": false
  },
  {
    "probe": "setApiBaseUrl retains authorization",
    "observed": {
      "url": "https://other.invalid/api/v1/probe/",
      "auth": "Bearer synthetic-token"
    }
  },
  {
    "probe": "refresh 401 error metadata",
    "status": null,
    "message": "Tokenni yangilashda xatolik yuz berdi.",
    "accessCleared": true
  },
  {
    "probe": "concurrent retry identities",
    "keys": [
      "synthetic-key-1",
      "synthetic-key-2"
    ],
    "distinct": 2
  },
  {
    "probe": "mobile amount parser witness",
    "inputs": [
      {
        "input": "11.50",
        "parsed": 1150
      },
      {
        "input": "-5",
        "parsed": 5
      },
      {
        "input": "1,25",
        "parsed": 125
      }
    ]
  }
]
```

### Mobile browser observations

```json
{
  "cart": {
    "priceButtonWidth": 61.65625,
    "priceButtonHeight": 20,
    "inputLabels": [
      null,
      null
    ],
    "hasBottomTabs": 5
  },
  "documents": {
    "tabLists": [
      {
        "visible": false,
        "width": 0,
        "height": 0,
        "top": 0
      }
    ],
    "text": "DIZAYN PREVIEW · Sun’iy ma’lumotlar · Haqiqiy savdo emas\nDemo\nDo'kon egasi\nDemo do‘kon\n›\nBosh sahifa\nKassa\nTovarlar\nOmbor\nMijozlar\nQarzlar\nHujjatlar\nHisobotlar\nSozlamalar\nChiqish\nKo'rinish\nTizim\nKunduz\nTun\nHujjatlar\nBarchasi\nFaktura\nDalolatnoma\nFaktura #1043\nImzo kutilmoqda\nAli Valiyev\n160 000 so'm\n24.10.2026\nFaktura #1042\nImzolangan\nAziz Karimov\n245 000 so'm\n23.10.2026\nQabul dalolatnomasi #1041\nBotir Ahmedov\n320 000 so'm\n22.10.2026\nFaktura #1040\nImzolangan\nMalika Xolova\n118 500 so'm\n20.10.2026\nFaktura #1039\nImzo kutilmoqda\nSardor Nurmatov\n75 000 so'm\n18.10.2026"
  },
  "browserErrors": []
}
```

## Reverse-check matrix for acceptance planning

| Axis | Cases checked against the source/records | Remaining execution gate |
| --- | --- | --- |
| Roles | Owner; restricted employee; platform_admin; guest support; no current store; removed/suspended membership | Real role-based API/native E2E is still required. |
| Network/session | Initial login; unlinked Telegram; expired OTP/refresh; stalled request; 403/429; overlapping searches; old-session responses; server-origin change | Execute using isolated backend/network controls; do not infer from unit pass count. |
| Persistence | Hydration, save failure, corrupt/old schema, restart, account/store/origin switch, concurrent retry creation, unknown result and legacy records | Transaction journal/migrations/OS storage lifecycle remain open. |
| Money/stock | Integer/decimal amount, fractional units, partner/minimum price, UZS-only POS, VAT included/excluded, stale stock/expiry, server total changes, cash/card/debt, refunds/voids | Compare with authoritative server records and fiscal/stock policy. |
| Business breadth | Catalog→stock intake→sale→receipt→customer/debt→cashbox→report; B2B/transfers; employees/stores/settings; support/history | Missing modules are described individually; implement one verified vertical slice at a time. |
| Documents | Receipt vs invoice vs help/legal docs; sender/receiver signatures; public token/rotation; 58/80mm/A4; save/view/share/cancel/error | Actual native files/share sheets/printers and authoritative content are unverified. |
| UI/runtime | Main navigation, small target, labels, dark/light, safe area, keyboard, large text, reduced motion, large lists, background/lock/update | Browser evidence covers only the named probes; real devices and accessibility services remain necessary. |

## Recommended implementation order

1. Repair P1 contract/data issues first: Telegram/OTP/session/tenant metadata, origin isolation, decimal parsing, stock/tax expectations, authoritative confirmation/change and durable financial identity/reconciliation. Keep production fiscal safeguards intact.
2. Complete one real test-backend vertical slice: login → explicit valid store → paginated catalog/customer lookup → price/quantity → confirmed checkout → saved receipt with correct payment/tax/state. Exercise failure and uncertain-response cases before the next slice.
3. Complete customer/debt ledgers, actual cashbox/shifts/reports, inventory/batches/returns/transfers and sales history/voids with permissions.
4. Complete real invoice/signature/PDF/share/public receipt behavior, then approved owner/admin/team/settings/support/history/workspace scope. Desktop-only installer/helper code is not a mobile requirement.
5. Design native offline journal, backup/recovery and optional LAN-register mode deliberately; do not turn the blocked legacy queue back on. Test Android and iOS behavior, lifecycle, accessibility and migration separately.
6. Add mobile CI/contract coverage, resolve/assess toolchain advisories, finish release branding/signing and run acceptance on actual devices. Re-run this comparison after each feature slice; append new evidence and close only the specific verified records.

## Complete indexed desktop/web API surface

**158 declaration call sites are indexed below; this is not a count of distinct endpoints, implemented mobile features or passing tests.** Overloads, dynamic root dispatchers and repeated calls are retained so no declaration disappears from the inventory. Support root is `/support/inbox/`, `/support/conversations/` or `/support/guest/` according to role/authentication. Table status summarizes the relevant mobile workflow, not whether an endpoint exists on the backend.

| # | Declaration / source | Endpoint expression | Mobile correspondence | Records |
| ---: | --- | --- | --- | --- |
| 1 | `adminLogin` · `frontend/ilbi/src/api/client.js:258` | `` '/auth/admin-login/' `` | PARTIAL | DMP-084, DMP-085, DMP-086 |
| 2 | `telegramStatus` · `frontend/ilbi/src/api/client.js:264` | `` '/auth/admin-login/telegram-status/' `` | PARTIAL | DMP-084, DMP-085, DMP-086 |
| 3 | `sendTelegramOtp` · `frontend/ilbi/src/api/client.js:270` | `` '/auth/admin-login/send-otp/' `` | PARTIAL | DMP-084, DMP-085, DMP-086 |
| 4 | `verifyOtp` · `frontend/ilbi/src/api/client.js:276` | `` '/auth/admin-login/verify-otp/' `` | PARTIAL | DMP-084, DMP-085, DMP-086 |
| 5 | `passwordResetRequest` · `frontend/ilbi/src/api/client.js:284` | `` '/auth/password-reset/request/' `` | ABSENT | DMP-002 |
| 6 | `changePasswordWithOld` · `frontend/ilbi/src/api/client.js:291` | `` '/auth/password-reset/change-with-old/' `` | ABSENT | DMP-002 |
| 7 | `passwordResetVerify` · `frontend/ilbi/src/api/client.js:297` | `` '/auth/password-reset/verify/?token=' + encodeURIComponent(token) `` | ABSENT | DMP-002 |
| 8 | `passwordResetConfirm` · `frontend/ilbi/src/api/client.js:300` | `` '/auth/password-reset/confirm/' `` | ABSENT | DMP-002 |
| 9 | `passwordResetResume` · `frontend/ilbi/src/api/client.js:306` | `` '/auth/password-reset/resume/' `` | ABSENT | DMP-002 |
| 10 | `getProfile` · `frontend/ilbi/src/api/client.js:311` | `` '/auth/me/' `` | PARTIAL | DMP-088, DMP-087 |
| 11 | `updateProfile` · `frontend/ilbi/src/api/client.js:314` | `` '/auth/profile/' `` | ABSENT | DMP-003 |
| 12 | `changePassword` · `frontend/ilbi/src/api/client.js:320` | `` '/auth/change-password/' `` | ABSENT | DMP-003 |
| 13 | `uploadAvatar` · `frontend/ilbi/src/api/client.js:326` | `` '/auth/profile/avatar/' `` | ABSENT | DMP-003 |
| 14 | `deleteAvatar` · `frontend/ilbi/src/api/client.js:332` | `` '/auth/profile/avatar/' `` | ABSENT | DMP-003 |
| 15 | `unban` · `frontend/ilbi/src/api/client.js:337` | `` '/auth/unban/' `` | CONDITIONAL ADMIN | DMP-124 |
| 16 | `acceptTerms` · `frontend/ilbi/src/api/client.js:343` | `` '/auth/accept-terms/' `` | ABSENT | DMP-001 |
| 17 | `getDocsList` · `frontend/ilbi/src/api/client.js:349` | `` '/docs/' `` | ABSENT | DMP-074 |
| 18 | `getDoc` · `frontend/ilbi/src/api/client.js:350` | `` `/docs/?doc=${encodeURIComponent(docKey)}` `` | ABSENT | DMP-074 |
| 19 | `updateDoc` · `frontend/ilbi/src/api/client.js:352` | `` '/docs/' `` | ABSENT | DMP-074 |
| 20 | `getDashboard` · `frontend/ilbi/src/api/client.js:367` | `` `/analytics/dashboard/${q}` `` | PARTIAL | DMP-008 |
| 21 | `getEmployeePermissions` · `frontend/ilbi/src/api/client.js:372` | `` `/tenants/${tenantId}/employees/permissions/` `` | ABSENT | DMP-048 |
| 22 | `getMyTenants` · `frontend/ilbi/src/api/client.js:373` | `` '/tenants/my/' `` | PARTIAL | DMP-006, DMP-087 |
| 23 | `createMyTenant` · `frontend/ilbi/src/api/client.js:374` | `` '/tenants/my/' `` | ABSENT | DMP-049 |
| 24 | `bindMyTenantSellerProfile` · `frontend/ilbi/src/api/client.js:378` | `` `/tenants/my/${tenantId}/seller-profile/` `` | ABSENT | DMP-049 |
| 25 | `getSellerProfiles` · `frontend/ilbi/src/api/client.js:382` | `` '/tenants/seller-profiles/' `` | ABSENT | DMP-049 |
| 26 | `getSellerProfilesForReview` · `frontend/ilbi/src/api/client.js:390` | `` `/tenants/seller-profiles/review/${query.size ? `?${query}` : ''}` `` | CONDITIONAL ADMIN | DMP-052 |
| 27 | `reviewSellerProfile` · `frontend/ilbi/src/api/client.js:392` | `` `/tenants/seller-profiles/${id}/review/` `` | CONDITIONAL ADMIN | DMP-052 |
| 28 | `getTransferTargets` · `frontend/ilbi/src/api/client.js:396` | `` '/tenants/current/transfer-targets/' `` | ABSENT | DMP-031 |
| 29 | `createSellerProfile` · `frontend/ilbi/src/api/client.js:397` | `` '/tenants/seller-profiles/' `` | ABSENT | DMP-049 |
| 30 | `updateSellerProfile` · `frontend/ilbi/src/api/client.js:401` | `` `/tenants/seller-profiles/${id}/` `` | ABSENT | DMP-049 |
| 31 | `getTenants` · `frontend/ilbi/src/api/client.js:407` | `` `/tenants/${query ? `?${query}` : ''}` `` | CONDITIONAL ADMIN | DMP-051 |
| 32 | `createTenant` · `frontend/ilbi/src/api/client.js:410` | `` '/tenants/' `` | CONDITIONAL ADMIN | DMP-051 |
| 33 | `resendOwnerInvite` · `frontend/ilbi/src/api/client.js:414` | `` `/tenants/${id}/resend-owner-invite/` `` | CONDITIONAL ADMIN | DMP-051 |
| 34 | `updateTenant` · `frontend/ilbi/src/api/client.js:418` | `` `/tenants/${id}/` `` | CONDITIONAL ADMIN | DMP-051 |
| 35 | `changeOwner` · `frontend/ilbi/src/api/client.js:423` | `` `/tenants/${id}/change-owner/` `` | CONDITIONAL ADMIN | DMP-051 |
| 36 | `activateTenant` · `frontend/ilbi/src/api/client.js:432` | `` `/tenants/${id}/activate/` `` | CONDITIONAL ADMIN | DMP-051 |
| 37 | `deactivateTenant` · `frontend/ilbi/src/api/client.js:436` | `` `/tenants/${id}/deactivate/` `` | CONDITIONAL ADMIN | DMP-051 |
| 38 | `hireEmployee` · `frontend/ilbi/src/api/client.js:440` | `` `/tenants/${tenantId}/employees/hire/` `` | ABSENT | DMP-047, DMP-048 |
| 39 | `getEmployees` · `frontend/ilbi/src/api/client.js:446` | `` `/tenants/${tenantId}/employees/${query ? `?${query}` : ''}` `` | ABSENT | DMP-047, DMP-048 |
| 40 | `updateEmployee` · `frontend/ilbi/src/api/client.js:449` | `` `/tenants/${tenantId}/employees/${employeeId}/` `` | ABSENT | DMP-047, DMP-048 |
| 41 | `resendEmployeeInvite` · `frontend/ilbi/src/api/client.js:451` | `` `/tenants/${tenantId}/employees/${employeeId}/resend-invite/` `` | ABSENT | DMP-047, DMP-048 |
| 42 | `setEmployeeBlocked` · `frontend/ilbi/src/api/client.js:453` | `` `/tenants/${tenantId}/employees/${employeeId}/account-status/` `` | ABSENT | DMP-047, DMP-048 |
| 43 | `archiveEmployee` · `frontend/ilbi/src/api/client.js:455` | `` `/tenants/${tenantId}/employees/${employeeId}/` `` | ABSENT | DMP-047, DMP-048 |
| 44 | `restoreEmployee` · `frontend/ilbi/src/api/client.js:457` | `` `/tenants/${tenantId}/employees/${employeeId}/restore/` `` | ABSENT | DMP-047, DMP-048 |
| 45 | `fireEmployee` · `frontend/ilbi/src/api/client.js:459` | `` `/tenants/${tenantId}/employees/fire/` `` | ABSENT | DMP-047, DMP-048 |
| 46 | `getCurrentTenant` · `frontend/ilbi/src/api/client.js:465` | `` `/tenants/current/${q}` `` | ABSENT | DMP-053, DMP-054 |
| 47 | `updateCurrentTenant` · `frontend/ilbi/src/api/client.js:472` | `` `/tenants/current/${q}` `` | ABSENT | DMP-053, DMP-054 |
| 48 | `testTelegram` · `frontend/ilbi/src/api/client.js:478` | `` '/tenants/current/test-telegram/' `` | ABSENT | DMP-055 |
| 49 | `sendDailyReportNow` · `frontend/ilbi/src/api/client.js:483` | `` '/tenants/current/send-report-now/' `` | ABSENT | DMP-056 |
| 50 | `sendLowStockReportNow` · `frontend/ilbi/src/api/client.js:488` | `` '/tenants/current/send-low-stock-report-now/' `` | ABSENT | DMP-056 |
| 51 | `getImportTemplate` · `frontend/ilbi/src/api/client.js:495` | `` '/catalog/import/template/' `` | ABSENT | DMP-025 |
| 52 | `previewImport` · `frontend/ilbi/src/api/client.js:496` | `` '/catalog/import/preview/' `` | ABSENT | DMP-025 |
| 53 | `commitImport` · `frontend/ilbi/src/api/client.js:497` | `` `/catalog/import/${id}/commit/` `` | ABSENT | DMP-025 |
| 54 | `generateBarcode` · `frontend/ilbi/src/api/client.js:499` | `` `/catalog/variants/${id}/barcode/${params?.force ? '?force=true' : ''}` `` | ABSENT | DMP-026 |
| 55 | `getCategories` · `frontend/ilbi/src/api/client.js:503` | `` '/catalog/categories/' `` | ABSENT | DMP-020 |
| 56 | `createCategory` · `frontend/ilbi/src/api/client.js:505` | `` '/catalog/categories/' `` | ABSENT | DMP-020 |
| 57 | `updateCategory` · `frontend/ilbi/src/api/client.js:510` | `` `/catalog/categories/${id}/` `` | ABSENT | DMP-020 |
| 58 | `deleteCategory` · `frontend/ilbi/src/api/client.js:515` | `` `/catalog/categories/${id}/` `` | ABSENT | DMP-020 |
| 59 | `createProduct` · `frontend/ilbi/src/api/client.js:519` | `` '/catalog/products/' `` | ABSENT | DMP-021 |
| 60 | `getProduct` · `frontend/ilbi/src/api/client.js:523` | `` `/catalog/products/${id}/` `` | ABSENT | DMP-021 |
| 61 | `updateProduct` · `frontend/ilbi/src/api/client.js:525` | `` `/catalog/products/${id}/` `` | ABSENT | DMP-021 |
| 62 | `deleteProduct` · `frontend/ilbi/src/api/client.js:530` | `` `/catalog/products/${id}/` `` | ABSENT | DMP-021 |
| 63 | `archiveProduct` · `frontend/ilbi/src/api/client.js:534` | `` `/catalog/products/${id}/archive/` `` | ABSENT | DMP-023 |
| 64 | `unarchiveProduct` · `frontend/ilbi/src/api/client.js:538` | `` `/catalog/products/${id}/unarchive/` `` | ABSENT | DMP-023 |
| 65 | `uploadProductImage` · `frontend/ilbi/src/api/client.js:542` | `` `/catalog/products/${productId}/images/` `` | ABSENT | DMP-024 |
| 66 | `deleteProductImage` · `frontend/ilbi/src/api/client.js:547` | `` `/catalog/products/${productId}/images/${imageId}/` `` | ABSENT | DMP-024 |
| 67 | `createVariant` · `frontend/ilbi/src/api/client.js:552` | `` `/catalog/products/${productId}/variants/` `` | ABSENT | DMP-021 |
| 68 | `getVariants` · `frontend/ilbi/src/api/client.js:562` | `` `/catalog/variants/${qs ? `?${qs}` : ''}` `` | PARTIAL | DMP-019, DMP-089 |
| 69 | `updateVariant` · `frontend/ilbi/src/api/client.js:565` | `` `/catalog/variants/${id}/` `` | ABSENT | DMP-022 |
| 70 | `archiveVariant` · `frontend/ilbi/src/api/client.js:570` | `` `/catalog/variants/${id}/archive/` `` | ABSENT | DMP-023 |
| 71 | `unarchiveVariant` · `frontend/ilbi/src/api/client.js:574` | `` `/catalog/variants/${id}/unarchive/` `` | ABSENT | DMP-023 |
| 72 | `getSuppliers` · `frontend/ilbi/src/api/client.js:580` | `` '/inventory/suppliers/' `` | ABSENT | DMP-030 |
| 73 | `getBatches` · `frontend/ilbi/src/api/client.js:581` | `` `/inventory/batches/?${new URLSearchParams(params)}` `` | ABSENT | DMP-030 |
| 74 | `getStock` · `frontend/ilbi/src/api/client.js:589` | `` `/inventory/stock/${qs ? `?${qs}` : ''}` `` | MOCK-ONLY | DMP-027 |
| 75 | `getStock` · `frontend/ilbi/src/api/client.js:593` | `` `/inventory/stock/${q}` `` | MOCK-ONLY | DMP-027 |
| 76 | `getStockDetail` · `frontend/ilbi/src/api/client.js:596` | `` `/inventory/stock/${variantId}/` `` | MOCK-ONLY | DMP-027 |
| 77 | `getMovements` · `frontend/ilbi/src/api/client.js:604` | `` `/inventory/movements/?${query}` `` | MOCK-ONLY | DMP-027 |
| 78 | `batchStockIntake` · `frontend/ilbi/src/api/client.js:607` | `` '/inventory/intake/batch/' `` | ABSENT | DMP-028 |
| 79 | `adjustStock` · `frontend/ilbi/src/api/client.js:612` | `` '/inventory/adjust/' `` | MOCK-ONLY | DMP-027 |
| 80 | `customerReturn` · `frontend/ilbi/src/api/client.js:617` | `` '/inventory/customer-return/' `` | ABSENT | DMP-029 |
| 81 | `supplierReturn` · `frontend/ilbi/src/api/client.js:622` | `` '/inventory/supplier-return/' `` | ABSENT | DMP-029 |
| 82 | `writeOff` · `frontend/ilbi/src/api/client.js:627` | `` '/inventory/write-off/' `` | ABSENT | DMP-029 |
| 83 | `getDeficits` · `frontend/ilbi/src/api/client.js:633` | `` `/inventory/deficits/${q}` `` | ABSENT | DMP-032 |
| 84 | `getTransfers` · `frontend/ilbi/src/api/client.js:637` | `` '/inventory/transfers/' `` | ABSENT | DMP-031 |
| 85 | `createTransfer` · `frontend/ilbi/src/api/client.js:639` | `` '/inventory/transfers/' `` | ABSENT | DMP-031 |
| 86 | `acceptTransfer` · `frontend/ilbi/src/api/client.js:644` | `` `/inventory/transfers/${id}/receive/` `` | ABSENT | DMP-031 |
| 87 | `returnTransfer` · `frontend/ilbi/src/api/client.js:649` | `` `/inventory/transfers/${id}/return/` `` | ABSENT | DMP-031 |
| 88 | `closeTransferDiscrepancy` · `frontend/ilbi/src/api/client.js:654` | `` `/inventory/transfers/${id}/close-discrepancy/` `` | ABSENT | DMP-031 |
| 89 | `getSales` · `frontend/ilbi/src/api/client.js:667` | `` `/sales/?${query}` `` | PARTIAL | DMP-009, DMP-068 |
| 90 | `getSaleDetail` · `frontend/ilbi/src/api/client.js:669` | `` `/sales/${id}/` `` | PARTIAL | DMP-009, DMP-068 |
| 91 | `rotateReceiptToken` · `frontend/ilbi/src/api/client.js:670` | `` `/sales/${id}/receipt-token/rotate/` `` | ABSENT | DMP-071 |
| 92 | `getPublicReceipt` · `frontend/ilbi/src/api/client.js:672` | `` `/sales/public/receipt/${encodeURIComponent(token)}/` `` | ABSENT | DMP-070 |
| 93 | `createSale` · `frontend/ilbi/src/api/client.js:674` | `` '/sales/' `` | PARTIAL | DMP-013, DMP-016, DMP-090 |
| 94 | `voidSale` · `frontend/ilbi/src/api/client.js:679` | `` `/sales/${saleId}/void/` `` | ABSENT | DMP-010 |
| 95 | `voidSaleItem` · `frontend/ilbi/src/api/client.js:685` | `` `/sales/items/${saleItemId}/void/` `` | ABSENT | DMP-011 |
| 96 | `getCounterparties` · `frontend/ilbi/src/api/client.js:691` | `` `/sales/counterparties/?${queryString(typeof params === 'string' ? { search: params } : params)}` `` | PARTIAL | DMP-106 |
| 97 | `createCounterparty` · `frontend/ilbi/src/api/client.js:695` | `` '/sales/counterparties/' `` | PARTIAL | DMP-034 |
| 98 | `getCounterpartyImportTemplate` · `frontend/ilbi/src/api/client.js:699` | `` '/sales/counterparties/import/template/' `` | ABSENT | DMP-036 |
| 99 | `previewCounterpartyImport` · `frontend/ilbi/src/api/client.js:700` | `` '/sales/counterparties/import/preview/' `` | ABSENT | DMP-036 |
| 100 | `commitCounterpartyImport` · `frontend/ilbi/src/api/client.js:701` | `` `/sales/counterparties/import/${id}/commit/` `` | ABSENT | DMP-036 |
| 101 | `getCounterparty` · `frontend/ilbi/src/api/client.js:702` | `` `/sales/counterparties/${id}/` `` | ABSENT | DMP-034, DMP-033 |
| 102 | `updateCounterparty` · `frontend/ilbi/src/api/client.js:704` | `` `/sales/counterparties/${id}/` `` | ABSENT | DMP-034, DMP-033 |
| 103 | `deleteCounterparty` · `frontend/ilbi/src/api/client.js:709` | `` `/sales/counterparties/${id}/` `` | ABSENT | DMP-034, DMP-033 |
| 104 | `getCounterpartySales` · `frontend/ilbi/src/api/client.js:715` | `` `/sales/counterparties/${counterpartyId}/sales/${qs ? '?' + qs : ''}` `` | ABSENT | DMP-035 |
| 105 | `getCounterpartyPayments` · `frontend/ilbi/src/api/client.js:717` | `` `/sales/counterparties/${id}/payments/?${queryString(typeof params === 'object' ? params : { page: params })}` `` | ABSENT | DMP-035 |
| 106 | `recordDebtPayment` · `frontend/ilbi/src/api/client.js:721` | `` `/sales/counterparties/${counterpartyId}/payments/` `` | MOCK-ONLY | DMP-037, DMP-038 |
| 107 | `correctDebtPayment` · `frontend/ilbi/src/api/client.js:726` | `` `/sales/counterparties/${counterpartyId}/payments/correct/` `` | ABSENT | DMP-039 |
| 108 | `getB2BInbox` · `frontend/ilbi/src/api/client.js:731` | `` `/sales/b2b/inbox/?${queryString(params)}` `` | ABSENT | DMP-044 |
| 109 | `acceptB2B` · `frontend/ilbi/src/api/client.js:733` | `` `/sales/b2b/${saleId}/accept/` `` | ABSENT | DMP-045 |
| 110 | `rejectB2B` · `frontend/ilbi/src/api/client.js:738` | `` `/sales/b2b/${saleId}/reject/` `` | ABSENT | DMP-046 |
| 111 | `receiveB2BReturn` · `frontend/ilbi/src/api/client.js:743` | `` `/sales/b2b/${saleId}/returns/receive/` `` | ABSENT | DMP-046 |
| 112 | `closeB2BReturnDiscrepancy` · `frontend/ilbi/src/api/client.js:748` | `` `/sales/b2b/${saleId}/returns/close-discrepancy/` `` | ABSENT | DMP-046 |
| 113 | `getNotifications` · `frontend/ilbi/src/api/client.js:753` | `` `/sales/notifications/?${queryString(params)}` `` | ABSENT | DMP-060 |
| 114 | `markAllNotificationsRead` · `frontend/ilbi/src/api/client.js:754` | `` '/sales/notifications/read-all/' `` | ABSENT | DMP-060 |
| 115 | `markNotificationRead` · `frontend/ilbi/src/api/client.js:756` | `` `/sales/notifications/${id}/read/` `` | ABSENT | DMP-060 |
| 116 | `clearAllNotifications` · `frontend/ilbi/src/api/client.js:760` | `` '/sales/notifications/' `` | ABSENT | DMP-060 |
| 117 | `deleteNotification` · `frontend/ilbi/src/api/client.js:764` | `` `/sales/notifications/${id}/` `` | ABSENT | DMP-060 |
| 118 | `openShift` · `frontend/ilbi/src/api/client.js:770` | `` '/cashbox/shift/open/' `` | ABSENT | DMP-040 |
| 119 | `getCurrentShift` · `frontend/ilbi/src/api/client.js:771` | `` `/cashbox/shift/current/?${queryString(typeof params === 'object' ? params : {})}` `` | ABSENT | DMP-040 |
| 120 | `closeShift` · `frontend/ilbi/src/api/client.js:773` | `` '/cashbox/shift/close/' `` | ABSENT | DMP-041 |
| 121 | `getExpenses` · `frontend/ilbi/src/api/client.js:777` | `` `/cashbox/expenses/?${queryString(params)}` `` | ABSENT | DMP-042 |
| 122 | `createExpense` · `frontend/ilbi/src/api/client.js:779` | `` '/cashbox/expenses/' `` | ABSENT | DMP-042 |
| 123 | `getIncome` · `frontend/ilbi/src/api/client.js:783` | `` `/cashbox/income/?${queryString(params)}` `` | ABSENT | DMP-042 |
| 124 | `createIncome` · `frontend/ilbi/src/api/client.js:785` | `` '/cashbox/income/' `` | ABSENT | DMP-042 |
| 125 | `getReports` · `frontend/ilbi/src/api/client.js:789` | `` `/cashbox/reports/?${queryString(typeof params === 'object' ? params : { page: params })}` `` | MOCK-ONLY | DMP-043 |
| 126 | `getReportDetail` · `frontend/ilbi/src/api/client.js:792` | `` `/cashbox/reports/${id}/` `` | MOCK-ONLY | DMP-043 |
| 127 | `getHistory` · `frontend/ilbi/src/api/client.js:796` | `` `/audit/history/?${queryString(params)}` `` | ABSENT | DMP-063 |
| 128 | `getHistoryDetail` · `frontend/ilbi/src/api/client.js:797` | `` `/audit/history/${encodeURIComponent(source)}/${id}/?${queryString(params)}` `` | ABSENT | DMP-063 |
| 129 | `getLogs` · `frontend/ilbi/src/api/client.js:808` | `` `/audit/logs/${qs ? `?${qs}` : ''}` `` | ABSENT | DMP-064 |
| 130 | `(transport dispatcher)` · `frontend/ilbi/src/api/platform.js:4` | `` path `` | TRANSPORT HELPER | DMP-098, DMP-107 |
| 131 | `overview` · `frontend/ilbi/src/api/platform.js:14` | `` '/platform/overview/' `` | CONDITIONAL ADMIN | DMP-050 |
| 132 | `supportUnread` · `frontend/ilbi/src/api/platform.js:15` | `` '/platform/support-unread/' `` | CONDITIONAL ADMIN | DMP-050 |
| 133 | `accounts` · `frontend/ilbi/src/api/platform.js:16` | `` '/platform/accounts/?' + new URLSearchParams(params) `` | CONDITIONAL ADMIN | DMP-050 |
| 134 | `identity` · `frontend/ilbi/src/api/platform.js:17` | `` `/platform/accounts/${id}/identity/` `` | CONDITIONAL ADMIN | DMP-050 |
| 135 | `recoverIdentity` · `frontend/ilbi/src/api/platform.js:18` | `` `/platform/accounts/${id}/identity/` `` | CONDITIONAL ADMIN | DMP-050 |
| 136 | `setAccountStatus` · `frontend/ilbi/src/api/platform.js:19` | `` `/platform/accounts/${id}/status/` `` | CONDITIONAL ADMIN | DMP-050 |
| 137 | `supportSettings` · `frontend/ilbi/src/api/platform.js:20` | `` '/support/settings/telegram/' `` | CONDITIONAL ADMIN | DMP-125 |
| 138 | `saveSupportSettings` · `frontend/ilbi/src/api/platform.js:21` | `` '/support/settings/telegram/' `` | CONDITIONAL ADMIN | DMP-125 |
| 139 | `testSupportTelegram` · `frontend/ilbi/src/api/platform.js:22` | `` '/support/settings/telegram/test/' `` | CONDITIONAL ADMIN | DMP-125 |
| 140 | `(transport dispatcher)` · `frontend/ilbi/src/api/support.js:45` | `` root + path `` | TRANSPORT HELPER | DMP-098, DMP-107 |
| 141 | `(transport dispatcher)` · `frontend/ilbi/src/api/support.js:46` | `` root + path `` | TRANSPORT HELPER | DMP-098, DMP-107 |
| 142 | `list` · `frontend/ilbi/src/api/support.js:48` | `` query `` | ABSENT | DMP-057, DMP-058 |
| 143 | `create` · `frontend/ilbi/src/api/support.js:49` | `` '' `` | ABSENT | DMP-057, DMP-058 |
| 144 | `detail` · `frontend/ilbi/src/api/support.js:50` | `` `${id}/` `` | ABSENT | DMP-057, DMP-058 |
| 145 | `action` · `frontend/ilbi/src/api/support.js:51` | `` `${id}/` `` | ABSENT / OPERATOR CONDITIONAL | DMP-059 |
| 146 | `messages` · `frontend/ilbi/src/api/support.js:52` | `` `${id}/messages/${query}` `` | ABSENT | DMP-057, DMP-058 |
| 147 | `send` · `frontend/ilbi/src/api/support.js:53` | `` `${id}/messages/` `` | ABSENT | DMP-057, DMP-058 |
| 148 | `image` · `frontend/ilbi/src/api/support.js:54` | `` `${id}/messages/${messageId}/image/` `` | ABSENT | DMP-057, DMP-058 |
| 149 | `voice` · `frontend/ilbi/src/api/support.js:55` | `` `${id}/messages/${messageId}/voice/` `` | ABSENT | DMP-057, DMP-058 |
| 150 | `customerProfile` · `frontend/ilbi/src/api/support.js:56` | `` `${id}/customer/` `` | ABSENT / OPERATOR CONDITIONAL | DMP-059 |
| 151 | `updateCustomerProfile` · `frontend/ilbi/src/api/support.js:57` | `` `${id}/customer/` `` | ABSENT / OPERATOR CONDITIONAL | DMP-059 |
| 152 | `overview` · `frontend/ilbi/src/api/workspace.js:4` | `` '/workspace/overview/' `` | ABSENT | DMP-061, DMP-008 |
| 153 | `search` · `frontend/ilbi/src/api/workspace.js:5` | `` `/workspace/search/?q=${encodeURIComponent(query)}` `` | ABSENT | DMP-061, DMP-008 |
| 154 | `reminders` · `frontend/ilbi/src/api/workspace.js:6` | `` `/workspace/reminders/?completed=${completed}&page=${page}` `` | ABSENT | DMP-062 |
| 155 | `members` · `frontend/ilbi/src/api/workspace.js:7` | `` '/workspace/members/' `` | ABSENT | DMP-062 |
| 156 | `createReminder` · `frontend/ilbi/src/api/workspace.js:8` | `` '/workspace/reminders/' `` | ABSENT | DMP-062 |
| 157 | `updateReminder` · `frontend/ilbi/src/api/workspace.js:9` | `` `/workspace/reminders/${id}/` `` | ABSENT | DMP-062 |
| 158 | `deleteReminder` · `frontend/ilbi/src/api/workspace.js:10` | `` `/workspace/reminders/${id}/` `` | ABSENT | DMP-062 |

## Audited source index and snapshot

This manifest indexes the targeted frontend source tree, desktop root modules, mobile source tree, backend v1 API and desktop-sync source. Assets, CSS-only files, generated dependencies, migrations and tests are not part of the numeric source-line total; relevant tests/configuration/design files are cited separately. “Indexed” means discovered, fingerprinted and included in the systematic scans; it does not claim every line received an independent runtime or formal verification. Detailed findings identify the semantic evidence actually used.

Indexed files: **328**. Indexed source lines: **73,105**. Source hashes were rechecked after the comparison and had not changed.

| Source file | Lines | SHA-256 prefix |
| --- | ---: | --- |
| `frontend/ilbi/src/App.jsx` | 208 | `528c94b18a51e633` |
| `frontend/ilbi/src/api/client.js` | 810 | `60b7186ccf6c1b7d` |
| `frontend/ilbi/src/api/platform.js` | 23 | `d8152bf8d5b64814` |
| `frontend/ilbi/src/api/support.js` | 59 | `3e76888fc44a86c3` |
| `frontend/ilbi/src/api/workspace.js` | 11 | `8ff4394aa91c7787` |
| `frontend/ilbi/src/components/auth/SessionRecovery.jsx` | 21 | `1d924a97e3a219ea` |
| `frontend/ilbi/src/components/auth/TelegramConnectionGate.jsx` | 154 | `c84d5a634e058fa5` |
| `frontend/ilbi/src/components/common/AppLoadingScreen.jsx` | 65 | `fed15e7471a2c2ac` |
| `frontend/ilbi/src/components/common/CameraBarcodeScanner.jsx` | 218 | `0a2977a583135b8f` |
| `frontend/ilbi/src/components/common/CatalogImportModal.jsx` | 26 | `e674ba9c27c34606` |
| `frontend/ilbi/src/components/common/ConfirmDialog.jsx` | 371 | `6272ee311d45768b` |
| `frontend/ilbi/src/components/common/CounterpartyImportModal.jsx` | 29 | `9da5f12c43b04b78` |
| `frontend/ilbi/src/components/common/CustomDatePicker.jsx` | 711 | `601444218a910a2d` |
| `frontend/ilbi/src/components/common/CustomSelect.jsx` | 632 | `b32fe86bea78b44f` |
| `frontend/ilbi/src/components/common/DebtDueDateField.jsx` | 17 | `ab0000c1b00f8f3b` |
| `frontend/ilbi/src/components/common/ExcelExportButton.jsx` | 36 | `df6c5ed7c2361cc1` |
| `frontend/ilbi/src/components/common/FiscalMetadataFields.jsx` | 42 | `01bf8f39495680e7` |
| `frontend/ilbi/src/components/common/IdentityRecoveryModal.jsx` | 52 | `b30e37cde72e0b7a` |
| `frontend/ilbi/src/components/common/IlbiIntroAnimation.jsx` | 88 | `d005c3dadc82b736` |
| `frontend/ilbi/src/components/common/IlbiLoader.jsx` | 18 | `dbc2714ef928026e` |
| `frontend/ilbi/src/components/common/IlbiLogo.jsx` | 61 | `27063fc023ac6b74` |
| `frontend/ilbi/src/components/common/InvoiceA4Modal.jsx` | 1027 | `561dfb0105be74db` |
| `frontend/ilbi/src/components/common/Modal.jsx` | 153 | `d2c494f7a842ffaa` |
| `frontend/ilbi/src/components/common/Pagination.jsx` | 185 | `851df4e0aba14a44` |
| `frontend/ilbi/src/components/common/PhoneInput.jsx` | 188 | `c8e8291cca0d2976` |
| `frontend/ilbi/src/components/common/PriceInput.jsx` | 200 | `e56378f4fcfcb46d` |
| `frontend/ilbi/src/components/common/ProductLabelsModal.jsx` | 292 | `e5044e2ca908b48f` |
| `frontend/ilbi/src/components/common/ProductToolsModal.jsx` | 295 | `2af7bff4419b2beb` |
| `frontend/ilbi/src/components/common/ReceiptItemCodes.jsx` | 9 | `a1ef69b54f8f7190` |
| `frontend/ilbi/src/components/common/ReceiptSettingsPanel.jsx` | 421 | `754032d9f4b41730` |
| `frontend/ilbi/src/components/common/ReceiptSlip.jsx` | 696 | `c80f18983ea4098e` |
| `frontend/ilbi/src/components/common/ReceiptTaxSummary.jsx` | 22 | `bfed4d5b8a985569` |
| `frontend/ilbi/src/components/common/RecoveryNotice.jsx` | 18 | `8319514a2cce317d` |
| `frontend/ilbi/src/components/common/RemoteTenantSelect.jsx` | 42 | `49519370eb50d829` |
| `frontend/ilbi/src/components/common/RemoteVariantSelect.jsx` | 50 | `2fab7f36f37fa51c` |
| `frontend/ilbi/src/components/common/ShareDocumentButton.jsx` | 92 | `7a5d80c72217d778` |
| `frontend/ilbi/src/components/common/ShiftReportSlip.jsx` | 356 | `a29ce432aec14dd6` |
| `frontend/ilbi/src/components/common/SpreadsheetImportModal.jsx` | 486 | `d6b33ad2f4bcabb2` |
| `frontend/ilbi/src/components/common/ZReportModernView.jsx` | 626 | `75ed2d904874256f` |
| `frontend/ilbi/src/components/common/ilbi/dotBounce.js` | 47 | `949ab6f80b505005` |
| `frontend/ilbi/src/components/common/ilbi/dotMotion.js` | 45 | `66e769eb5b2680a0` |
| `frontend/ilbi/src/components/common/ilbi/loader.js` | 24 | `7d863c4b36f217f7` |
| `frontend/ilbi/src/components/common/ilbi/logo.js` | 91 | `50dbfb0cd1694eab` |
| `frontend/ilbi/src/components/common/ilbi/math.js` | 29 | `d02cdbebb88f722b` |
| `frontend/ilbi/src/components/dashboard/MiniVisualizers.jsx` | 508 | `77ae01d1695e7388` |
| `frontend/ilbi/src/components/dashboard/RevenueCostAnalyticsChart.jsx` | 1334 | `8e832d84401c7184` |
| `frontend/ilbi/src/components/docs/DocImage.jsx` | 100 | `7a0f5dbbe14085b1` |
| `frontend/ilbi/src/components/docs/MarkdownViewer.jsx` | 500 | `e5b12f209145c753` |
| `frontend/ilbi/src/components/employees/EmployeePermissionsSelector.jsx` | 994 | `09b8c5b55ee3b40a` |
| `frontend/ilbi/src/components/employees/rolePresets.js` | 207 | `f0d9f0c3ded73242` |
| `frontend/ilbi/src/components/inventory/BatchSelector.jsx` | 46 | `5e30defd47b199a5` |
| `frontend/ilbi/src/components/inventory/RapidStockIntakeModal.jsx` | 1535 | `955309b3c9b5249c` |
| `frontend/ilbi/src/components/inventory/StockBatchesPanel.jsx` | 99 | `585dc68d57249c36` |
| `frontend/ilbi/src/components/inventory/TenantTransfersPanel.jsx` | 463 | `47fa45253dc7845b` |
| `frontend/ilbi/src/components/landing/ProductCarousel.jsx` | 632 | `d34017fc9ce66f81` |
| `frontend/ilbi/src/components/landing/carouselScenes.js` | 88 | `773b5c86b5299874` |
| `frontend/ilbi/src/components/layout/Header.jsx` | 385 | `04a51756b897ec14` |
| `frontend/ilbi/src/components/layout/Layout.jsx` | 689 | `406b133fcf3a4402` |
| `frontend/ilbi/src/components/layout/Sidebar.jsx` | 390 | `39afe8c8a3bf266a` |
| `frontend/ilbi/src/components/layout/TenantSwitcher.jsx` | 55 | `fbf8266550dd8fb2` |
| `frontend/ilbi/src/components/layout/WorkspaceNavbar.jsx` | 469 | `53b594636e702320` |
| `frontend/ilbi/src/components/layout/WorkspaceSwitch.jsx` | 15 | `41e34a709b9f552d` |
| `frontend/ilbi/src/components/layout/navigation.js` | 137 | `bda7a9d4eb7dd5f2` |
| `frontend/ilbi/src/components/notifications/FloatingNotificationToast.jsx` | 311 | `52628389f531c2f1` |
| `frontend/ilbi/src/components/notifications/NotificationCard.jsx` | 541 | `57277e13fddc2740` |
| `frontend/ilbi/src/components/notifications/NotificationParser.js` | 223 | `f1fce04155d4fc9d` |
| `frontend/ilbi/src/components/platform/PlatformSettings.jsx` | 61 | `eab74a85dc5c2fda` |
| `frontend/ilbi/src/components/support/CustomerProfileModal.jsx` | 573 | `5514476da798182b` |
| `frontend/ilbi/src/components/support/HelpLauncher.jsx` | 793 | `03ad77baae1c3779` |
| `frontend/ilbi/src/components/support/StickerPicker.jsx` | 107 | `9ef01f1012aed57c` |
| `frontend/ilbi/src/components/support/VoicePlayer.jsx` | 226 | `9bf56e95cc2f03b2` |
| `frontend/ilbi/src/components/support/VoiceRecorder.jsx` | 241 | `425d7ba87f12e57b` |
| `frontend/ilbi/src/components/support/polling.js` | 64 | `a0bbd09736dececd` |
| `frontend/ilbi/src/components/support/translations.js` | 63 | `0d2dc98f3ccebe5d` |
| `frontend/ilbi/src/components/sync/DesktopAccess.jsx` | 18 | `95c591c071cc4299` |
| `frontend/ilbi/src/components/sync/DesktopSecurityPanel.jsx` | 68 | `4d427adfe6e46f7c` |
| `frontend/ilbi/src/components/sync/DesktopSessionGuard.jsx` | 47 | `ea64db94d35f7f30` |
| `frontend/ilbi/src/components/sync/DesktopUpdateNotice.jsx` | 32 | `351334f5a8673496` |
| `frontend/ilbi/src/components/sync/SyncCenter.jsx` | 182 | `7ec1a7c032861e64` |
| `frontend/ilbi/src/components/sync/desktopApi.js` | 18 | `8499317c4b29ceea` |
| `frontend/ilbi/src/components/workspace/CompactSalesChart.jsx` | 41 | `8b5d277d1ba475f0` |
| `frontend/ilbi/src/components/workspace/Reminders.jsx` | 199 | `ca1b51cbe9abce1d` |
| `frontend/ilbi/src/components/workspace/WorkDesktop.jsx` | 634 | `8cd3a2dfa8192dd8` |
| `frontend/ilbi/src/components/workspace/WorkspaceSearch.jsx` | 155 | `c029a8cc067bd25e` |
| `frontend/ilbi/src/components/workspace/WorkspaceTools.jsx` | 93 | `6a5bca8461db30bb` |
| `frontend/ilbi/src/context/AuthProvider.jsx` | 201 | `e8e1667452906fbc` |
| `frontend/ilbi/src/context/ConfirmContext.jsx` | 111 | `6f0530d8aaefe6f1` |
| `frontend/ilbi/src/context/TenantContext.jsx` | 69 | `9be1f0a5f300325a` |
| `frontend/ilbi/src/context/ThemeContext.jsx` | 35 | `8edceb2097a87507` |
| `frontend/ilbi/src/context/ToastContext.jsx` | 109 | `adc79c8b6e2060f4` |
| `frontend/ilbi/src/context/WorkspaceContext.jsx` | 66 | `ddba34d6019ddc8c` |
| `frontend/ilbi/src/context/authContext.js` | 11 | `ec7fd8b49378697e` |
| `frontend/ilbi/src/hooks/useAccountDraft.js` | 40 | `d7f7d0a193dd8116` |
| `frontend/ilbi/src/hooks/useAccountDraftFile.js` | 30 | `218eff2d4e7999bf` |
| `frontend/ilbi/src/hooks/useAuth.js` | 10 | `898e6e4d5bbeaa1e` |
| `frontend/ilbi/src/hooks/useCarouselPlayback.js` | 84 | `c464f5db62a7a81d` |
| `frontend/ilbi/src/hooks/useLandingMotion.js` | 161 | `8ae7bce35a624451` |
| `frontend/ilbi/src/hooks/usePaginatedList.js` | 52 | `d7db67de2b5231bd` |
| `frontend/ilbi/src/hooks/usePersistedState.js` | 76 | `a6173c19af696a74` |
| `frontend/ilbi/src/hooks/useSelectPopover.js` | 93 | `f816564e160717f1` |
| `frontend/ilbi/src/hooks/useTenantCurrency.js` | 25 | `6f9bdf79d9fd636a` |
| `frontend/ilbi/src/hooks/useWorkspaceAction.js` | 24 | `cbd9fc827d103f36` |
| `frontend/ilbi/src/main.jsx` | 77 | `a715eaba9a7f785e` |
| `frontend/ilbi/src/pages/AcceptTerms.jsx` | 545 | `ba92ba7a2a4cb1e0` |
| `frontend/ilbi/src/pages/Audit.jsx` | 303 | `79fef94cf4c20643` |
| `frontend/ilbi/src/pages/B2BTransactions.jsx` | 1171 | `471d5155881fd864` |
| `frontend/ilbi/src/pages/Catalog.jsx` | 2857 | `c1c34c1a028b3cdb` |
| `frontend/ilbi/src/pages/Dashboard.jsx` | 1598 | `c7f9fb38cbfa8396` |
| `frontend/ilbi/src/pages/Debts.jsx` | 1685 | `a41100faa4c14d35` |
| `frontend/ilbi/src/pages/DesktopGuide.jsx` | 39 | `19c10dfa655399d7` |
| `frontend/ilbi/src/pages/Documentation.jsx` | 626 | `3a06c46bb2f2bd1f` |
| `frontend/ilbi/src/pages/Downloads.jsx` | 483 | `deceb82edef788eb` |
| `frontend/ilbi/src/pages/Employees.jsx` | 525 | `9e14dacab3bc3c6e` |
| `frontend/ilbi/src/pages/History.jsx` | 195 | `86fcf44d9a035898` |
| `frontend/ilbi/src/pages/Inventory.jsx` | 1739 | `09dc9dcb4b9c6158` |
| `frontend/ilbi/src/pages/Landing.jsx` | 1192 | `35e9a26e9edf8767` |
| `frontend/ilbi/src/pages/Login.jsx` | 1148 | `efaa48b3ce0efe03` |
| `frontend/ilbi/src/pages/MyTenants.jsx` | 965 | `fc5f7996f01b4e69` |
| `frontend/ilbi/src/pages/POS.jsx` | 2367 | `39a3ba642634cebe` |
| `frontend/ilbi/src/pages/PlatformAccounts.jsx` | 69 | `4c23e00cf213fccb` |
| `frontend/ilbi/src/pages/PlatformDashboard.jsx` | 29 | `4e6301c5be2f17af` |
| `frontend/ilbi/src/pages/Profile.jsx` | 974 | `97270b7ad650edb3` |
| `frontend/ilbi/src/pages/PublicReceiptView.jsx` | 360 | `7acd6397d699155a` |
| `frontend/ilbi/src/pages/Sales.jsx` | 1323 | `c6b6a25cf38966af` |
| `frontend/ilbi/src/pages/SellerProfileReviews.jsx` | 272 | `f87c590bc51ae41a` |
| `frontend/ilbi/src/pages/Services.jsx` | 1385 | `eaa3a1dbb047d46a` |
| `frontend/ilbi/src/pages/SetupAccount.jsx` | 815 | `b12f7da6467b7105` |
| `frontend/ilbi/src/pages/Shifts.jsx` | 1370 | `dc1481bf353cda51` |
| `frontend/ilbi/src/pages/Support.jsx` | 896 | `a368ac71942ff1e5` |
| `frontend/ilbi/src/pages/Tenants.jsx` | 797 | `be4167c2bd7c0092` |
| `frontend/ilbi/src/utils/accountDrafts.js` | 47 | `fa478a00387fb7d0` |
| `frontend/ilbi/src/utils/barcodeReader.js` | 86 | `5bc4995a9d6cde6f` |
| `frontend/ilbi/src/utils/brandStorage.js` | 168 | `b0f2c5f9eadb17a0` |
| `frontend/ilbi/src/utils/cameraScanner.js` | 101 | `2fe464d5091931b5` |
| `frontend/ilbi/src/utils/desktopSession.js` | 30 | `0b32ecde270d8f5d` |
| `frontend/ilbi/src/utils/documentPDF.js` | 63 | `b603d7192734e5ba` |
| `frontend/ilbi/src/utils/documentShare.js` | 76 | `3fb9fa04791c6848` |
| `frontend/ilbi/src/utils/downloadFile.js` | 10 | `ae4d35f5e8767787` |
| `frontend/ilbi/src/utils/downloads.js` | 14 | `c8a498a3e8dcfd31` |
| `frontend/ilbi/src/utils/draftFiles.js` | 25 | `5886d6e35c080d1a` |
| `frontend/ilbi/src/utils/numberFormat.js` | 50 | `d5bca9b8a9d91be5` |
| `frontend/ilbi/src/utils/numberToWordsUzbek.js` | 92 | `ecc901464865d94f` |
| `frontend/ilbi/src/utils/ownerInvitation.js` | 17 | `5b10982187c72ab1` |
| `frontend/ilbi/src/utils/phoneFormat.js` | 53 | `ba2f9b29f66ccf69` |
| `frontend/ilbi/src/utils/productLabels.js` | 152 | `3abcc1d0c66db3bc` |
| `frontend/ilbi/src/utils/receiptTax.js` | 28 | `794d2cd09eba1cc7` |
| `frontend/ilbi/src/utils/rememberedLogin.js` | 81 | `410d20ab5244739f` |
| `frontend/ilbi/src/utils/requestKey.js` | 11 | `67637088e44c4419` |
| `frontend/ilbi/src/utils/visiblePolling.js` | 33 | `f27f10449fe021b9` |
| `frontend/ilbi/src/utils/workspace.js` | 35 | `f6ece36fe7b8a8dd` |
| `desktop/ilbi/application.cjs` | 500 | `126087b276ef9ad5` |
| `desktop/ilbi/apply-linux-update.py` | 32 | `d5cdbca606a6d68a` |
| `desktop/ilbi/backups.cjs` | 136 | `1a65317835c815a3` |
| `desktop/ilbi/build-info.cjs` | 12 | `2972260a1b0af738` |
| `desktop/ilbi/build-linux.cjs` | 43 | `08eaeddc0ef05b79` |
| `desktop/ilbi/build.cjs` | 55 | `41e32f6d6545010e` |
| `desktop/ilbi/document-sharing.cjs` | 57 | `d7d1176b7abeec19` |
| `desktop/ilbi/draft-backup.cjs` | 16 | `f31807c1e6250780` |
| `desktop/ilbi/linux-update-helper.cjs` | 53 | `a86d0944c5cb18a1` |
| `desktop/ilbi/login-credentials.cjs` | 53 | `5869bab89014977f` |
| `desktop/ilbi/main.cjs` | 4 | `1f6774b9dd9f340f` |
| `desktop/ilbi/pairing-manager.cjs` | 94 | `cc81e2c4004903b4` |
| `desktop/ilbi/pairing.cjs` | 38 | `f630b459156fbc4f` |
| `desktop/ilbi/preload.cjs` | 44 | `f3809ca220644ecf` |
| `desktop/ilbi/proxy.cjs` | 29 | `00cf2443f5b96689` |
| `desktop/ilbi/runtime.cjs` | 110 | `fa2fffa0525926e6` |
| `desktop/ilbi/services.cjs` | 49 | `f5bb4c7f14eef324` |
| `desktop/ilbi/session-lock.cjs` | 42 | `fdd3a12ae28ff775` |
| `desktop/ilbi/setup.html` | 29 | `89f963a518a9f6fa` |
| `desktop/ilbi/setup.js` | 49 | `a620f84f5162967b` |
| `desktop/ilbi/update-helper-preload.cjs` | 5 | `c1277f151ed091ae` |
| `desktop/ilbi/update-window.js` | 22 | `450aaaf52b25d851` |
| `desktop/ilbi/update.html` | 6 | `4306c61685aa8631` |
| `desktop/ilbi/updater.cjs` | 105 | `91e3acfff3f1f121` |
| `mobile-app/src/api/client.ts` | 231 | `afb299bdc8be6b24` |
| `mobile-app/src/api/financialIdentity.ts` | 19 | `e01dfa260d3300b0` |
| `mobile-app/src/api/storage.ts` | 16 | `cc982b857deda0d4` |
| `mobile-app/src/app/(app)/(tabs)/_layout.tsx` | 1 | `916d5764c6384482` |
| `mobile-app/src/app/(app)/(tabs)/cart.tsx` | 1 | `47a82c1b771a8f3e` |
| `mobile-app/src/app/(app)/(tabs)/debts.tsx` | 1 | `327ad5ab92d22a7c` |
| `mobile-app/src/app/(app)/(tabs)/index.tsx` | 1 | `1bd702ada39c910e` |
| `mobile-app/src/app/(app)/(tabs)/menu.tsx` | 2 | `0a69dfc99811735d` |
| `mobile-app/src/app/(app)/(tabs)/products.tsx` | 1 | `77cca4d1fca55ee4` |
| `mobile-app/src/app/(app)/_layout.tsx` | 14 | `46126516e55990c6` |
| `mobile-app/src/app/(app)/customers.tsx` | 1 | `0ea8e9b3f3efdef0` |
| `mobile-app/src/app/(app)/documents.tsx` | 1 | `86dc9de785e37c07` |
| `mobile-app/src/app/(app)/inventory.tsx` | 1 | `2fb9a848afd8808a` |
| `mobile-app/src/app/(app)/reports.tsx` | 1 | `c505f568094fe3b2` |
| `mobile-app/src/app/(app)/settings.tsx` | 1 | `a6d881301500e64e` |
| `mobile-app/src/app/_layout.tsx` | 1 | `a8890293f54756b7` |
| `mobile-app/src/app/checkout.tsx` | 1 | `8d6834dbdf6ce679` |
| `mobile-app/src/app/index.tsx` | 6 | `9e0242be2c40ccab` |
| `mobile-app/src/app/login.tsx` | 1 | `0b82268da1053e00` |
| `mobile-app/src/app/receipt.tsx` | 1 | `f922fd4b41297d99` |
| `mobile-app/src/components/brand/IlbiLogo.tsx` | 77 | `900f962bdee3011e` |
| `mobile-app/src/components/brand/IlbiMark.tsx` | 50 | `c65a04a0e2ca64a9` |
| `mobile-app/src/components/ui/Badge.tsx` | 84 | `08489a25a0a3c625` |
| `mobile-app/src/components/ui/BottomSheet.tsx` | 142 | `4badac92c409ef66` |
| `mobile-app/src/components/ui/Button.tsx` | 139 | `58ff7adf513581e4` |
| `mobile-app/src/components/ui/Input.tsx` | 132 | `1d24082de8484f97` |
| `mobile-app/src/components/ui/ScreenHeader.tsx` | 170 | `a3dc60aa461eb899` |
| `mobile-app/src/components/ui/Toast.tsx` | 126 | `32a3226fd3b50590` |
| `mobile-app/src/dev/preview.ts` | 64 | `290df67f33ea20f0` |
| `mobile-app/src/features/auth/AuthContext.tsx` | 221 | `8f4dda7fcda7a236` |
| `mobile-app/src/features/auth/LoginScreen.tsx` | 264 | `405ddecc1cf9d3f7` |
| `mobile-app/src/features/cart/CartContext.tsx` | 134 | `d0080f86f07d5241` |
| `mobile-app/src/features/cart/CartScreen.tsx` | 762 | `fbcbd6c676547cb7` |
| `mobile-app/src/features/catalog/CatalogScreen.tsx` | 237 | `8e6625e5baad0bfb` |
| `mobile-app/src/features/checkout/CheckoutScreen.tsx` | 599 | `82822060301f5cd7` |
| `mobile-app/src/features/checkout/CustomerPickerSheet.tsx` | 332 | `3dd52e230ddc710f` |
| `mobile-app/src/features/customers/CustomersScreen.tsx` | 400 | `112cafafcb27fbbf` |
| `mobile-app/src/features/debts/DebtsScreen.tsx` | 485 | `11181686fd955b7a` |
| `mobile-app/src/features/documents/DocumentsScreen.tsx` | 786 | `590c703720569d68` |
| `mobile-app/src/features/home/HomeScreen.tsx` | 410 | `b5d81ba61df4aafd` |
| `mobile-app/src/features/inventory/InventoryScreen.tsx` | 388 | `61b4931cd5372dce` |
| `mobile-app/src/features/receipts/ReceiptScreen.tsx` | 636 | `0d12b756e1925efe` |
| `mobile-app/src/features/reports/ReportsScreen.tsx` | 396 | `05278b4f5d8911b6` |
| `mobile-app/src/features/settings/SettingsScreen.tsx` | 317 | `b04c7ffa32c356f8` |
| `mobile-app/src/features/sync/SyncBanner.tsx` | 144 | `63af89c98406afa0` |
| `mobile-app/src/features/sync/outbox.ts` | 35 | `1f5100036a6c13ee` |
| `mobile-app/src/navigation/BottomTabNavigator.tsx` | 23 | `0aa27a62035623b2` |
| `mobile-app/src/navigation/DrawerContent.tsx` | 419 | `b12085b24ced5f49` |
| `mobile-app/src/navigation/RootNavigator.tsx` | 22 | `5e0c96fdc5f81b8b` |
| `mobile-app/src/navigation/types.ts` | 24 | `af0fc5be3d72d94e` |
| `mobile-app/src/navigation/useAppNavigation.ts` | 42 | `0fa9e20ed9c77e9c` |
| `mobile-app/src/theme/ThemeContext.tsx` | 58 | `40d90deef413147b` |
| `mobile-app/src/theme/tokens.ts` | 148 | `3c20a8e14009e997` |
| `backend/api/v1/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/accounts/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/accounts/serializers.py` | 316 | `8b5f68884bcf00a4` |
| `backend/api/v1/accounts/urls.py` | 68 | `41243379b5d985be` |
| `backend/api/v1/accounts/views/__init__.py` | 9 | `06ac6186d7053f41` |
| `backend/api/v1/accounts/views/admin_login.py` | 227 | `2b40733b12770009` |
| `backend/api/v1/accounts/views/complete_profile.py` | 39 | `eeee98f4ef769c90` |
| `backend/api/v1/accounts/views/docs_views.py` | 233 | `81be028a714fca15` |
| `backend/api/v1/accounts/views/employee_management_views.py` | 132 | `41bf496451ca6131` |
| `backend/api/v1/accounts/views/employee_views.py` | 154 | `3e59618b7a2687ad` |
| `backend/api/v1/accounts/views/misc.py` | 119 | `942d47f654f339ba` |
| `backend/api/v1/accounts/views/password_reset.py` | 276 | `c4560709c1ddf433` |
| `backend/api/v1/accounts/views/platform_views.py` | 228 | `3262c66b8d9c4320` |
| `backend/api/v1/accounts/views/profile_views.py` | 161 | `0973817b992db4bd` |
| `backend/api/v1/accounts/views/terms_views.py` | 44 | `64ea188a58fc5c81` |
| `backend/api/v1/accounts/views/token_refresh.py` | 29 | `2fef64149a24125d` |
| `backend/api/v1/accounts/views/unban.py` | 61 | `c647e30186b60dbf` |
| `backend/api/v1/analytics/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/analytics/urls.py` | 7 | `d0427ea98c42574f` |
| `backend/api/v1/analytics/views/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/analytics/views/dashboard_views.py` | 63 | `f765430ae63cf569` |
| `backend/api/v1/audit/__init__.py` | 1 | `0536bab467e67a1e` |
| `backend/api/v1/audit/history_views.py` | 135 | `f53b1dcdd5be42bb` |
| `backend/api/v1/audit/serializers.py` | 29 | `1eec985fa60cf2c0` |
| `backend/api/v1/audit/urls.py` | 10 | `eb97b0b459ccbda8` |
| `backend/api/v1/audit/views.py` | 86 | `bbd440683e703272` |
| `backend/api/v1/cashbox/serializers.py` | 125 | `fe89b4aff96a5e67` |
| `backend/api/v1/cashbox/urls.py` | 21 | `72141fa41aff87b5` |
| `backend/api/v1/cashbox/views/cashbox_views.py` | 212 | `84d4d8f51bc8afa1` |
| `backend/api/v1/catalog/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/catalog/serializers.py` | 250 | `ce3d3c656fcd1a6e` |
| `backend/api/v1/catalog/urls.py` | 43 | `f2a1a91ba3c27dd1` |
| `backend/api/v1/catalog/views/__init__.py` | 14 | `360055df5766b1a5` |
| `backend/api/v1/catalog/views/_base.py` | 47 | `51a81f57f594f144` |
| `backend/api/v1/catalog/views/category_views.py` | 120 | `32c0d6144e2b5148` |
| `backend/api/v1/catalog/views/import_views.py` | 114 | `ba4e9bbee88a69c7` |
| `backend/api/v1/catalog/views/label_views.py` | 60 | `f2f8f7f80b6e6c6c` |
| `backend/api/v1/catalog/views/product_views.py` | 564 | `2ea8d6c2051039b1` |
| `backend/api/v1/exports.py` | 279 | `f30f9751ff901f70` |
| `backend/api/v1/internal/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/internal/shop/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/internal/shop/serializers.py` | 59 | `f6caaf8cf8e01ce9` |
| `backend/api/v1/internal/shop/urls.py` | 19 | `202de44aca0d1b63` |
| `backend/api/v1/internal/shop/views.py` | 63 | `f15021d875cc868c` |
| `backend/api/v1/inventory/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/inventory/serializers.py` | 245 | `c1182e74c37233b5` |
| `backend/api/v1/inventory/urls.py` | 42 | `bc124c518683614a` |
| `backend/api/v1/inventory/views/__init__.py` | 9 | `ba426fad77d9d90e` |
| `backend/api/v1/inventory/views/_base.py` | 9 | `c9f068b61b04aa98` |
| `backend/api/v1/inventory/views/batch_views.py` | 130 | `1401d5dd6b474c4e` |
| `backend/api/v1/inventory/views/movement_views.py` | 165 | `58377e0babbf1bcd` |
| `backend/api/v1/inventory/views/stock_views.py` | 132 | `77737a304fc9cd69` |
| `backend/api/v1/inventory/views/transfer_views.py` | 118 | `79e6fb899844ebbe` |
| `backend/api/v1/sales/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/sales/serializers.py` | 418 | `8c9eeddcf8031e80` |
| `backend/api/v1/sales/urls.py` | 84 | `55c229aaf8209ae8` |
| `backend/api/v1/sales/views/_base.py` | 5 | `fcf3204fb7a851cf` |
| `backend/api/v1/sales/views/b2b_views.py` | 152 | `42f993812443a63b` |
| `backend/api/v1/sales/views/counterparty_views.py` | 262 | `600430f16a62dcac` |
| `backend/api/v1/sales/views/import_views.py` | 111 | `fb6284cd96ca291c` |
| `backend/api/v1/sales/views/notification_views.py` | 107 | `77e9fc5613bf758d` |
| `backend/api/v1/sales/views/sale_views.py` | 241 | `1b58f70a929f94c8` |
| `backend/api/v1/support/__init__.py` | 1 | `01ba4719c80b6fe9` |
| `backend/api/v1/support/serializers.py` | 211 | `beec31f2a1d03850` |
| `backend/api/v1/support/settings_views.py` | 99 | `30389f1722469ab4` |
| `backend/api/v1/support/urls.py` | 47 | `f4648483e05b82a2` |
| `backend/api/v1/support/views.py` | 600 | `ffa9ba43ed3604d1` |
| `backend/api/v1/tenants/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/tenants/currency_serializers.py` | 54 | `3157e4aa4ae81a8c` |
| `backend/api/v1/tenants/serializers.py` | 360 | `a62af4b429337b5a` |
| `backend/api/v1/tenants/urls.py` | 64 | `4b02ea2af4ccc1b8` |
| `backend/api/v1/tenants/views.py` | 654 | `f13c4c1c08c062fc` |
| `backend/api/v1/tg_bot/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/api/v1/tg_bot/serializers.py` | 45 | `c8266e3d24a4ee5d` |
| `backend/api/v1/tg_bot/urls.py` | 7 | `af52e3bebd27e208` |
| `backend/api/v1/tg_bot/views.py` | 20 | `a8f537f091e20753` |
| `backend/api/v1/urls.py` | 20 | `6b3265374d451bb3` |
| `backend/api/v1/workspace.py` | 271 | `0af1f79eba0d2ad2` |
| `backend/apps/desktop_sync/__init__.py` | 0 | `e3b0c44298fc1c14` |
| `backend/apps/desktop_sync/account_access.py` | 400 | `d7badd4884ed213a` |
| `backend/apps/desktop_sync/apps.py` | 14 | `93961e92be45de24` |
| `backend/apps/desktop_sync/authentication.py` | 47 | `c85d7627de6faf3d` |
| `backend/apps/desktop_sync/cloud.py` | 212 | `8966c1624a3d7f55` |
| `backend/apps/desktop_sync/desktop_api.py` | 103 | `c486d9a1fbab58c7` |
| `backend/apps/desktop_sync/device_credentials.py` | 107 | `7d5f933b5f221097` |
| `backend/apps/desktop_sync/files.py` | 105 | `2a1d4906aa22bee6` |
| `backend/apps/desktop_sync/grants.py` | 100 | `652b3a49920efd2d` |
| `backend/apps/desktop_sync/local.py` | 160 | `2ca7f29d108bd7a1` |
| `backend/apps/desktop_sync/middleware.py` | 273 | `b01f1a66ed5fe9c5` |
| `backend/apps/desktop_sync/models.py` | 97 | `5dbbe937dc1620be` |
| `backend/apps/desktop_sync/pairing.py` | 188 | `cf20a50be6e6e94e` |
| `backend/apps/desktop_sync/protocol.py` | 210 | `826394b812cecbef` |
| `backend/apps/desktop_sync/revisions.py` | 41 | `4e59e744af39d746` |
| `backend/apps/desktop_sync/security.py` | 310 | `4c7232befb61362e` |
| `backend/apps/desktop_sync/serializers.py` | 48 | `8a9efad3fc7bccef` |
| `backend/apps/desktop_sync/server_policy.py` | 23 | `6e73bf483059d5e4` |
| `backend/apps/desktop_sync/snapshots.py` | 204 | `821d644d895896d7` |
| `backend/apps/desktop_sync/transport.py` | 145 | `9861da016b928391` |
| `backend/apps/desktop_sync/urls.py` | 31 | `66b49c6f8e20a489` |
| `backend/apps/desktop_sync/views.py` | 267 | `075b58b84a3845d3` |
| `backend/apps/desktop_sync/worker.py` | 213 | `a3ab8f2e8e581076` |

## Scope decisions and non-equivalences

- This is not a pixel-copy request. Preserve the approved mobile interaction design, tiny cart images, prominent current-sale price, authentic logo, monochrome themes, sidebar and quick navigation while reproducing business behavior.
- Public landing/download/install-guide surfaces may remain web/deep-link destinations. Mobile public receipt opening is separately recorded because it is a customer document workflow.
- Do not assume every platform-admin/operator workflow must ship in the cashier app. Seven records are conditional role/product scope; they still belong in the full desktop inventory.
- Do not port Electron/NSIS/Linux helpers, bundled PostgreSQL/Python, Windows paths or desktop IPC directly. Mobile needs platform-appropriate equivalents where the business capability is approved.
- Desktop signatures currently include local persistence; no server-synced cryptographic signing or legal validity is claimed. Desktop backup encryption does not imply automatic encryption of live database files.
- Current desktop POS is explicitly UZS-only. USD calculator/debt/stock/cashbox fields and historical unreachable split-currency comments do not prove that ordinary USD POS is supported.
- Current backend sale payment choices are cash/card/debt. Disabled mixed-payment UI is not an implemented desktop/mobile feature and requires an approved backend contract before activation.
- A successful design-preview transaction is synthetic and does not bypass the backend’s seller/fiscal readiness or production gate. Native JS bundle export is not an installed APK/IPA or device test.
- No percentage of completeness is assigned: the features have different roles, impact, implementation depth and unverified paths. Raw counts are an inventory of grouped findings, not a measured defect probability or proof that everything else works.

## Resume instructions for an AI

Read this file’s inventory and repeat-pass ledger first. Open the exact source references and the detailed records for the feature being changed. Treat `CONDITIONAL` and `UNVERIFIED` differently from a reproduced failure, and preserve the already-fixed safety behavior. Use the master design prompt and the latest explicit owner instructions for mobile presentation. Record tests with their actual scope, including skips/failures. After fixing a record, repeat desktop → mobile and mobile → desktop comparisons for that workflow and add new evidence; do not mark the entire app complete because fixtures, typecheck or the phone-shaped web preview pass.

Companion documents: [mobile development guide](../README.md), [previous implementation review](MOBILE_REVIEW.md), [verified mobile progress](MOBILE_PROGRESS.md), [design entry point](../../branding/mobile-concepts/README.md), [English master design/implementation prompt](../../branding/mobile-concepts/v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md). This audit is the single consolidated parity backlog; companion files are background context, not a substitute for its individual records.

## Implementation discovery — real sales response contract

The original synthetic mobile adapter returned a single sale object. `SaleListCreateView.post` actually returns `SaleOutputSerializer(..., many=True)`: an array. A real isolated PostgreSQL/Django APIClient regression now generates `tests/contracts/backend.json` from catalog, tenant settings, account profile, customers, sale creation and receipt detail. Retail checkout explicitly accepts one UZS receipt from the array and retains ambiguous responses for reconciliation. The synthetic adapter now follows that same creation response shape. This is part of DMP-122; the historical baseline above is preserved.

Regenerate deliberately with `cd backend && ILBI_WRITE_MOBILE_CONTRACTS=1 .venv/bin/python -m pytest apps/sales/tests/test_mobile_contracts.py -q`, then run mobile `tests/backendContracts.test.ts`. Normal pytest runs compare the current response shapes with the saved contract. Only isolated test DB identities and a local nonfiscal test override are used; production fiscal readiness is unchanged.
