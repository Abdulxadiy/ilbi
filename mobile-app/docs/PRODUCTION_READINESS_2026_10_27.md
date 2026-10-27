# Mobile production-readiness work — 2026-10-27

**Status: IN PROGRESS.** This is an implementation/evidence ledger for the owner's latest request, not a declaration that the whole 131-finding parity backlog is complete. Follow implement → test → record → advance. The owner's existing emulator remains untouched. Platform marketing version stays `1.4.0`; mobile marketing version stays `1.0.0`.

## Approved login, automatic OTP and field errors

The owner-approved phone design is saved under `branding/mobile-concepts/login-3d/`. The actual screen uses a dedicated alpha-backed 3D checkout illustration (`assets/login-hero-3d.png`), not the phone mockup. Illustration and text enter once through opacity/translation; system reduced-motion preference bypasses movement. OTP/Telegram steps use a compact hero to keep the working form reachable.

Entering six digits submits OTP verification automatically. Partial input never submits, duplicate change events/presses share submission guards, invalid codes get a red field and inline error, editing clears that error, and manual retry remains available after a network failure. Network failures do not declare the code invalid. The backend's 24-hour/OTP policy is unchanged. Pending verification/credential responses cannot restore a cancelled login; AuthContext deduplicates verification calls and checks the login ticket/epoch/auth generation before committing credentials.

Shared `fieldErrors` understands the backend's `error.details`, flat DRF dictionaries and nested row paths. `useFormErrors` and `useApiAction.fields/clearField` expose these errors without mapping a global transport/permission failure to arbitrary fields. Input shows a red border/background, inline live error and `aria-invalid`; recovery forms and credentials use the same contract.

Actual checks for this slice: **31 tests passed** across login/auth/validation/resource suites; whole TypeScript and strict owned-file ESLint passed. During parallel core-screen work a legacy debt-fixture import briefly failed TypeScript; the core tests were synchronized with the real API model and the whole check then passed. This is source/component evidence; native installation, real OTP delivery and production acceptance are separate checks.

The animation uses stable state-initialized `Animated.Value` objects. Actual browser testing caught that the native `useAnimatedValue` export is unavailable in the installed React Native Web build, despite native/component checks passing. That implementation was replaced, 22 auth/login tests and strict animation lint passed, then the full browser regression passed including logout/login. The first cold Metro compile took 35 seconds and exceeded the former 21-second initial wait; only initial bundle/bootstrap gets a larger budget, while subsequent UI waits retain the existing short limit. No runtime-error assertion was suppressed.

## Business form validation — tested

Catalogue product/variant/category forms attach local and backend errors to exact text, price, unit, category and parent controls. Nested fields retain their paths; business fields named `code` are not confused with protocol metadata. The variant validator collects every invalid field before returning, preserving existing monetary/identifier rules. Cart quantity/negotiated-price editors and checkout cash/date inputs now turn red on rejection and clear their error when edited. Support conversation fields and consent use the same accessible feedback while preserving original client IDs and uncertain-send safeguards.

Actual checks: **42 tests passed** across eight catalogue/checkout/cart/support/validation suites; whole TypeScript and strict owned-file ESLint passed. An old product-editor assertion expected a single summary message; it was changed to assert the actual invalid price input and unaffected product-name input now that inline messages also exist. A misplaced import was reordered; strict lint then passed. Financial confirmation, idempotency, accepted-result persistence and unknown-result safeguards were retained.

The full existing host browser regression passed in an isolated source copy on ports 8095/8096: support/guest isolation, catalogue/category lifecycle, negotiated cart prices, 320px viewport, theme/sidebar/tabs, live refresh and synthetic checkout/change/receipt. It neither installed an APK nor sent a live financial request. A final snapshot after all push/native changes is checked separately before delivery.

SDK/API references consulted: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), [React Native Animated](https://reactnative.dev/docs/animated), [accessibility/reduced motion](https://reactnative.dev/docs/accessibilityinfo), [TextInput](https://reactnative.dev/docs/textinput).

## Parallel work and acceptance gates

- Web/desktop shared validation and OTP: `docs/WEB_DESKTOP_VALIDATION_2026_10_27.md` (repository root docs).
- Mobile core APIs/history/statistics/profile: `docs/CORE_API_READINESS_2026_10_27.md`.
- Notifications and direct-FCM foundation: `docs/NOTIFICATION_READINESS_2026_10_27.md`.
- Original complete parity inventory and live status: `docs/DESKTOP_MOBILE_PARITY_AUDIT.md`.

The owner is creating Firebase configuration/service credentials now. Do not invent a Firebase project ID or mark real phone push accepted without credentials, rebuilt native configuration and an authorized real delivery test. The previous standalone APK is build 3; it cannot contain this new source until a higher native build is produced and verified. Do not replace published build 3 with different bytes. Existing dependency advisories, fiscal/financial and external native/server acceptance gates must remain visible.
