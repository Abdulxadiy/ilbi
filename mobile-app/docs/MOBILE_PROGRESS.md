> Historical prototype/review record. Current implementation status and verification limits are recorded in the [live parity audit ledger](DESKTOP_MOBILE_PARITY_AUDIT.md).

# ILBI Mobile — Verified progress

Updated: 2026-10-24.

**Current status: UI prototype + partial API integration; release acceptance is open.** The earlier “ALL PHASES (0–12) PASSED” statement was unsupported and is withdrawn. Unit-test fixture checks do not establish native behavior, backend accounting, working signatures, thermal printing, or offline synchronization.

Read [MOBILE_REVIEW.md](MOBILE_REVIEW.md) for the complete review and [../README.md](../README.md) to run the app.

| Area | Verified status | Next gate |
| --- | --- | --- |
| Design references and brand/theme components | Source exists; browser preview renders | Compare all 18 states, touch targets, native typography and assets against v4 |
| Expo Router, bottom tabs and sidebar | Browser interaction verified | Android/iOS navigation and lifecycle |
| Interactive Docker phone preview | Running; source-driven live refresh verified | Daily browser checks; keep native acceptance separate |
| Authentication and tenant context | API code and refresh regression tests exist | Real OTP, explicit multi-store choice, permissions and session expiry UI |
| Home/catalog | Explicit demo mode separated from real API errors | Real response contracts, loading/pagination and camera scanner |
| Cart and sale price | Canonical arithmetic, draft restoration and user/store isolation tests pass | Native editing/keyboard, storage failure recovery and broader UI tests |
| Checkout | Failed request retains cart; confirmed response clears it; retry identity tests pass | Real test-backend accounting, stock/permissions and uncertain-result reconciliation |
| Receipts/PDF/share | Saved-sale rendering and honest export errors implemented | Native export/view/share, QR, receipt snapshots and 58/80 mm printer output |
| Documents/signatures | Preview prototype only; real mode gated | Persisted document/signature API and native validation |
| Debts/payments | Preview prototype; fake-success path removed; real mode gated | Real debt API and payment reconciliation |
| Inventory/reports | Preview prototype only; real mode gated | Authorized backend actions and real reporting |
| Offline/outbox | Unsafe replay disabled; old records retained | Account/store-scoped journal, recovery, reconciliation and verified replay |
| Native build/runtime | Android and iOS JS/Hermes exports pass | APK/IPA builds and actual Android/iOS execution remain unverified |

## Checks completed

- TypeScript: pass.
- Lint: 0 errors, 57 warnings (mainly unused prototype code/imports).
- Jest: 9 suites, 31 tests pass, including failure, retry identity, session isolation and cart persistence regressions.
- Expo dependency compatibility: pass.
- Android and iOS JavaScript/Hermes export: pass; this is not native runtime validation.
- Docker Compose validation, image build, mobile-only startup and health check: pass.
- Browser: actual phone-frame app, cart price editing, 160,000 UZS demo checkout, 40,000 UZS change, saved receipt, sidebar, dark-theme control, 320px overflow and live source refresh: pass.
- Native camera, keyboard/gestures, secure storage, PDF/share sheets, printer, device performance, real backend transactions and production release: not verified.
- Dependency audit: five high-severity Expo CLI/toolchain entries remain; no incompatible forced downgrade applied.

Evidence is in [evidence/](evidence/), including [the real browser screenshot](evidence/web-phone-preview.png). Historical unit logs are retained as history, not current acceptance proof.

## Resume from here

1. Read the review and reproduce the preview/test commands.
2. Set up Android SDK/emulator or a physical development phone.
3. Use an isolated backend account/database to verify login → store → catalog → cart price → checkout → saved receipt, including failures and uncertain responses.
4. Fix and verify that slice before enabling unfinished documents, debts, inventory, reports or offline replay.
5. Verify on iOS, then complete release branding/signing/distribution gates.
