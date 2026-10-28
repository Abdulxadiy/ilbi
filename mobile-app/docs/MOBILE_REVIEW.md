> Historical prototype/review record. Current implementation status and verification limits are recorded in the [live parity audit ledger](DESKTOP_MOBILE_PARITY_AUDIT.md).

# ILBI mobile implementation review

Review date: 2026-10-24. Scope: inspect the existing mobile code, run available checks, fix misleading financial success behavior, and provide Docker development with an interactive phone preview.

## Readiness conclusion

**The code is a substantial UI prototype with partial backend integration, not a completed mobile release.** The previous progress file claimed all phases 0–12 passed despite explicitly lacking native Android/iOS evidence. Its tests largely checked canonical fixture arithmetic. Those claims were withdrawn in `MOBILE_PROGRESS.md`.

The Docker phone preview is running at `http://localhost:8082/preview`. It renders the actual React Native Web components and accepts clicks. Metro live refresh was verified by changing source text and observing it update in the iframe, then restoring the source. This is useful for daily UI work beside the editor; it does not emulate Android or iOS system behavior.

## Findings addressed in this review

| Finding | Previous behavior | Current behavior and evidence |
| --- | --- | --- |
| P1: failed checkout reported as a completed sale | Any failed `/sales/` request produced a fabricated receipt ID and cleared the cart. | Failure stays visible and the cart is retained. Success requires a server-returned sale ID. Covered by `tests/checkout.test.tsx` and `tests/client.test.ts`. |
| P1: unconfirmed debt payments reduced the displayed balance | A swallowed request error was followed by local debt reduction. | Failed requests keep the balance. The unfinished real debt module is gated with an explicit integration message; its sample screen remains available in design preview. |
| P1: retries generated new financial identities | Repeating a request could use a new key. | A user/store/operation-scoped identity is persisted before submission and reused for the same payload. A changed payload with an uncertain prior result is blocked. Covered by `tests/financialIdentity.test.ts`. This is not a complete offline ledger. |
| P1: global outbox could replay another account/store's financial data | Legacy queue lacked account identity and its sender ignored recorded tenant context. | Legacy records are retained and cannot be transmitted, erased, or augmented through the unsafe API. New offline financial replay is disabled pending a complete implementation. Covered by `tests/outbox.test.ts`. |
| P1: cache cleanup deleted pending operations | Settings cleared the financial outbox. | Cleanup only removes `ilbi_cache:` keys. Cart drafts, retry identities and legacy queue records are preserved. |
| P1: cart hydration and scope were incomplete | Saved drafts were not restored; switching stores could save previous cart data into a new store. | Restore precedes persistence, writes are serialized per provider, and records are scoped to user and store. A completed cart also clears the selected customer. Covered by `tests/cartPersistence.test.tsx`. |
| P1: token refresh invalidated its own retry | Token rotation incremented session generation; retry failed the generation check. | Rotation preserves the session generation; login/logout/store changes invalidate old responses. An old 401 cannot clear a new session. Covered by `tests/client.test.ts`. |
| P1: a new server could receive an old server's credentials | Settings changed the base URL without signing out. | Validate the URL and sign out before changing the runtime endpoint. The override is explicitly session-only. |
| P1: sample financial records appeared after API errors | Home, catalog, customer picker and cart used fixture values or retained fabricated defaults in real mode. | Explicit development-only synthetic API and a visible preview banner. Real failures do not enable demo results. Home/catalog/picker accept empty responses and surface errors. Unfinished real reports/inventory/documents/debts are gated. |
| P2: customer creation invented IDs on failure | Catch blocks created a local customer as if the server had accepted it. | Server confirmation is required; errors remain visible and no fake customer is selected. |
| P2: PDF export claimed success after an error | Failed export marked the PDF ready; copy/share actions only displayed success text. | Export errors keep the PDF unavailable. Clipboard uses the actual copy API. Native sharing checks platform availability and requires an actual generated file. No invented public receipt link. |
| P2: receipt contents did not match the saved sale | Fixture products, extra fixed summary rows, fixed timestamp/amount/file size and decorative QR implied accurate receipt output. | Render saved sale items, totals and timestamps; remove fabricated summary/file size and QR. Cash/change are shown as unknown when unavailable. Actual QR and thermal printing remain unfinished. |
| P2: secure storage failures silently became volatile sessions | Native secure storage exceptions fell back to memory. | Native secure storage errors propagate; browser-only tokens remain memory-only. Native lifecycle testing is still required. |
| P2: mixed payment toggle suggested an unsupported feature | The switch did not affect the payload. | Disabled and labeled as unfinished. |
| Development tooling | No web dependencies, phone frame, Docker service or lint command. Routing also conflicted with the local Expo Router requirement. | Expo Router route files, SDK-matched web/router/clipboard/crypto dependencies, lint, Docker profile, phone frame and live-refresh browser test. |

## Remaining work, in priority order

1. **Native Android and iOS acceptance is open.** This Linux machine has no configured Android SDK/ADB/emulator and no macOS/Xcode. JavaScript/Hermes exports are not APK/IPA builds, device installs, signing checks, frame-rate measurements, or native runtime tests. Test on Android first, then on an iPhone or a macOS simulator. Test system back, safe areas, keyboard, gestures, secure storage, lifecycle and low-memory behavior.
2. **Real backend flows need end-to-end verification.** No production credentials or real financial writes were used in this review. Verify OTP, refresh failure UX, permission checks, empty/error/loading states, stock errors, pricing bounds, tenant switching, sale responses and debt due dates using an isolated test account/database. The existing API map is an initial map, not evidence of integration.
3. **Authentication and permissions are incomplete.** Multiple stores still default to the first available store. The Home store chip has no picker action, while the sidebar picker exists. The mobile client does not comprehensively gate every feature by permissions. Session expiration must update the UI consistently; a background storage error must not leave a misleading authenticated screen. Browser tokens intentionally disappear on reload.
4. **Implement a complete financial operation journal and reconciliation UI.** The retry key helper protects repeated identical submissions, but there is no status lookup, conflict-resolution screen, stable cross-restart demo API, account-scoped automatic sync, or verified offline replay. An unknown server result requires reconciliation; do not clear its saved identity to submit a different sale. Cross-process concurrency and storage-failure recovery are not verified. Legacy queued records need controlled migration/reconciliation, not blind replay or deletion.
5. **Documents, signatures, inventory and reports remain prototypes.** Preview screens mostly use local data/state. Document sharing, persistent signatures, authorized inventory adjustments and real report/Z-report generation still need API integration and native validation. Real mode shows an explicit integration-pending view for these modules. The customer management screen also lacks complete loading/pagination/detail integration.
6. **Finish receipt/export fidelity.** Implement true token-based QR rendering, authoritative receipt settings/snapshots, authentic logo in exported HTML, configured store headers, cash/card/debt labels, void/refund semantics, 58/80 mm printer formatting, actual PDF viewing/download behavior and tested system share sheets. The current HTML export is not verified thermal output. A generated file is temporary cache, not a proven permanent download. Browser native-export failure is shown honestly.
7. **Finish the UI interaction contract.** The barcode scanner controls currently navigate to the catalog; there is no camera scan implementation. Some buttons/chips remain placeholders, list pagination is incomplete, thumbnails are mostly placeholders, and quantity/price/accessibility/reduced-motion behavior needs broader interaction checks. No 60 FPS or low-end-device performance claim is supported.
8. **Release setup is unfinished.** App icons/splash still use template assets; package identifiers, native development/release profiles, signing and store distribution have not been accepted. Docker is a development service, not an app-store release pipeline.
9. **Dependency advisories require review.** `npm audit --omit=dev` reported five high-severity entries in the Expo CLI/tooling chain (`expo`, `@expo/cli`, `@expo/code-signing-certificates`, `node-forge`, `zod`). The suggested automatic fix downgraded Expo to SDK 44 and was not applied. Resolve with a compatible supported SDK/tooling update and recheck; this review does not establish exploitability in the native app. There are also 57 existing lint warnings, primarily unused prototype code/imports.

## Validation record

| Check | Result | Limit |
| --- | --- | --- |
| `npm run typecheck` | PASS | TypeScript only. |
| `npm run lint` | PASS: 0 errors, 57 warnings | Warnings remain; this is not a zero-warning codebase. |
| `npm test` | PASS: 9 suites, 31 tests | Includes regression checks plus original fixture tests. Navigation is mocked in unit tests; real browser navigation is checked separately. |
| `npx expo install --check` | PASS: dependencies up to date | SDK package compatibility, not security clearance. |
| `npx expo export --platform android ...` | PASS, Hermes bundle generated | No APK, emulator or device run. Temporary output outside the repo. |
| `npx expo export --platform ios ...` | PASS, Hermes bundle generated | No IPA, Xcode, simulator or device run. Temporary output outside the repo. |
| `docker compose --profile mobile config --quiet` | PASS | Existing environment files required by the full Compose model. |
| Docker image build and mobile-only start | PASS | Development image; existing backend/database services were not started for preview verification. |
| `/healthz` and container health | PASS | Metro availability. |
| `npm run test:preview` | PASS | Actual browser app: cart price 12,000 → 11,500 UZS, 160,000 UZS total, 200,000 UZS received → 40,000 UZS change, saved demo receipt, sidebar, dark-theme control, 320 px overflow check and source-driven live refresh. Synthetic preview data only. |
| Native runtime, camera, PDF/share, actual printer, real API accounting | NOT VERIFIED | Remain release gates. |

Evidence: [`evidence/web-phone-preview.png`](evidence/web-phone-preview.png) is a real browser capture of the running preview. Logs from this review are under `evidence/review-*`. Earlier `phase1_test_output.txt` and `full_test_suite_output.txt` are historical unit-test logs, not proof that every phase passed.

## Next implementation slice

Read [the development guide](../README.md), then reproduce the browser preview and tests. Establish an Android development runtime and an isolated backend test account. Verify login → explicit store choice → catalog → negotiated cart price → server-confirmed checkout → saved receipt, including failed and uncertain requests. Record actual evidence and resolve that slice's defects before enabling the next unfinished module. Use the [master prompt](../../branding/mobile-concepts/v4/ILBI_MOBILE_APP_MASTER_PROMPT_EN.md) for detailed gates.
