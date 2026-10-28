# Shared web/desktop form validation and automatic 2FA — 2026-10-27

## Scope and implementation

The desktop package builds its renderer with `npm --prefix ../../frontend/ilbi run build`; web and desktop therefore consume the same frontend validation code. Platform version remains `1.4.0`. This slice does not change authentication policy, backend permissions, financial calculations, request idempotency, native desktop startup pages, production deployment or an emulator.

`frontend/ilbi/src/utils/formValidation.js`, installed once from `main.jsx`, handles native required/type/pattern/range errors throughout the renderer. Invalid fields get a red border and focus ring plus an accessible inline Uzbek message. Existing inline field styles cannot hide the error. Required text containing only spaces is rejected; passwords are not trimmed. Correcting an input clears its old field error. PhoneInput now validates a complete Uzbek telephone number when supplied, while optional empty telephone fields remain valid. PriceInput refreshes its error state after formatted amounts change.

Canonical business fields named `code` or `message` remain field errors (including nested variant codes); only response-envelope metadata is excluded. Unit and actual browser regressions cover a rejected catalogue article code.

The API client reads field dictionaries from the actual backend's `error.details` envelope and legacy/plain field maps. Only mutation responses with HTTP 400/422 are considered. It associates the request with an active/recent submitted form and matching submitted field values, and applies errors only to that form's unchanged matching controls. A later edit or newer submission invalidates the old error result. Logout/tenant changes clear old feedback, and the client verifies the current authentication generation and tenant before reporting an API field error. GETs, unrelated mutations, permission/network errors and general business errors do not invent a bad field.

More than 120 core controls have explicit API-field metadata, including catalogue create/edit/pricing/fiscal fields, employee and store forms, profile/password, debt payments/refunds, inventory, receipt/settings and support/account forms. CustomSelect and CustomDatePicker associate their real submitted controls with visible, focusable error targets. Required catalogue categories and inventory variant selectors now participate in native form validation. Local password-confirmation mismatches and non-positive debt/refund amounts also mark the actual field. Form snapshots remain in request memory; this controller does not write passwords or form values to storage.

The login OTP input submits automatically when its sixth digit is entered or pasted. A synchronous in-flight guard prevents duplicate verification from overlapping automatic/manual submits. Wrong codes receive a red input with an inline rejection; editing clears that rejection. Five digits do not submit, failed attempts do not loop, manual retry remains available, and a new ticket/resend resets the automatic-attempt guard. The original server-controlled 24-hour second-factor exemption, OTP validity, resend limits and Telegram binding remain unchanged. Credential rejection highlights the two credential inputs together without identifying which secret was wrong.

## Actual verification

Run commands from `frontend/ilbi/`:

| Check | Actual result |
| --- | --- |
| `npm test` | 78 passed, 0 failed/skipped |
| `npm run lint` | Passed with existing warnings; not a zero-warning claim |
| `npm run build` | Production renderer build passed |
| `npm run test:validation` | Passed native/API feedback, custom controls, HTML-as-text, stale edits/submissions, unrelated-request and tenant boundaries; web and desktop-bridge OTP cases |
| `npm run test:auth-session` | Passed existing login/session/draft/privacy checks, including daily MFA exemption, expired second factor, account/store isolation and no automatic financial operation |
| `npm run test:catalog-fiscal` | Passed actual catalogue create/edit JSON/multipart forms, validation, saved/cleared fiscal fields and receipt regressions |
| `npm run test:selections` | Passed custom-select geometry, focus/pointer/keyboard, narrow/landscape layouts, intake/inventory/catalogue/B2B workflows |
| `git diff --check` for this slice | Passed |

The new validation browser command is included in the frontend GitHub CI step. Browser fixtures use synthetic API responses and fresh headless profiles. The desktop OTP case uses the existing in-memory bridge double, **not an Electron executable test**. No real OTP, email, account password change or financial transaction was sent to production.

During development, the first browser probe exposed missing focus/blur events in an inactive headless target; the test now brings that target forward and explicitly enables CDP focus emulation. The fixture's missing favicon was replaced with a data favicon. A later lint run caught a helper declaration-order error, fixed by reordering the helper. No validation assertion or security gate was removed to pass these checks.

Actual passing transcripts are in [evidence/web-desktop-validation-2026-10-27](evidence/web-desktop-validation-2026-10-27/).

## Limits to retain

This is shared renderer acceptance, not production server/native-device acceptance. General business errors lacking field information remain existing summary/toast messages; the code does not guess a field. Ambiguous nested errors, omitted payload fields and values transformed into a different business representation are not attached to an unrelated control. Those paths need an explicit field association if their API later supplies actionable field feedback. Native desktop setup/enrolment HTML is separate from the shared application renderer and was not modified or accepted here. This slice does not certify every business workflow or resolve other mobile production gates.

## Read-only mobile dependency review requested by the parent task

A snapshot after adding Expo notifications reported four high audit entries: Expo/CLI propagation, `node-forge@1.4.0` and `zod@3.25.76`. No mobile package or lockfile was changed by this review.

The official registry now publishes `node-forge@1.4.1`; its [upstream changelog](https://raw.githubusercontent.com/digitalbazaar/forge/v1.4.1/CHANGELOG.md) explicitly fixes CVE-2026-85393. That patch fits the installed CLI's `^1.4.0` requirement. A targeted compatible lock refresh and subsequent audit/export/preflight are recommended; the parent owns execution and final audit evidence.

The [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) names `4.6.6` as patched. Registry inspection found stable Zod 3 still at `3.25.76`, and every published Expo CLI 58.x through `58.1.15` declares `^3.25.76`. A forced Zod 4 override would cross the upstream major-version contract. No verified SDK-58-compatible Zod patch was found; do not downgrade Expo or suppress the audit to claim production readiness. The parent may record newer evidence separately.
