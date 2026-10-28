# Mobile UI update — 2026-10-27

The owner requested meaningful separate commits, GitHub push and delivery of the new mobile APK to the existing server. Every emulator and installed app must remain untouched so the owner can observe the update offer. Only mobile APK/feed publication is authorized; no main merge or platform deployment.

## Login and password recovery — source checks passed

The supplied login illustration and full-width login layout are retained, including password visibility, support/download links and Telegram/OTP login. The supplied recovery sheet offers email-link requests, token confirmation and old-password recovery. Shared sheet sizing and the top-only application safe-area wrapper are included in this slice.

Review caught a real API mismatch: the request serializer accepts `login` or `email`, not the supplied `identifier`. The client now sends `login`. An account without email moves to the old-password form. Closing or switching recovery clears tokens/passwords, invalidates late responses and cancels delayed dismissal; a completed reset clears the old login password. Authentication and Telegram verification are not bypassed.

Actual local verification: TypeScript passed, strict ESLint passed and all 41 Jest suites / 243 tests passed. Nine login tests cover existing Telegram/OTP behavior, the recovery UI, exact backend payloads, server rejection, no-email handling, password length, and stale-response/secret cleanup. Initial lint reported four unused imports, which were removed. The asynchronous dismissal test initially awaited its deliberately pending network call; the corrected test uses a native-style press and passes without extending its timeout.

These are source/component checks, not production password-reset requests or native device acceptance. No production account password or email was changed.

## Dashboard and cart — source checks passed

The supplied dashboard uses four compact metric cards with navigation to sales, debts and stores. Sales shortcuts are disabled when that module is unavailable, preserving the existing navigation permission guard. The supplied empty cart now scrolls on small screens instead of hiding actions below the viewport. Existing sale/price operations remain intact.

The same actual TypeScript, strict ESLint and 243-test run covers this slice. Browser interaction and final APK/server verification are separate checks recorded below when completed.

## Build-3 preparation

The public feed and a read-only SSH check both initially advertised Android build 2, source `19183bb7c4d10a43840bd5156d2b77c7aaeef433`. Platform backend/frontend/bot images still point to `2d799dd5596a92fb6a0e3be6cf51a2a018c88e2d`. Only Android's native code advances to 3; mobile marketing version remains `1.0.0`, iOS build `1`, platform `1.4.0`.

The isolated host preview exposed a Metro file-map cache write warning: the custom per-project directory did not exist. Metro configuration now creates that directory before use while retaining isolated cache namespaces. Loading the real config confirmed the directory exists; strict ESLint passed. All 20 existing mobile build/source/publication Python checks passed. SDK/Java/dependency/original-signing-key preflight passed without any device query.

Matching SDK 58 references consulted before configuration work: [app config](https://docs.expo.dev/versions/v58.0.0/config/app/#versioncode) and [Metro config](https://docs.expo.dev/versions/v58.0.0/config/metro/).

This section prepares a candidate; it does not claim a completed native build, publication or emulator observation.

## Browser and CI acceptance

The full existing browser regression passed in an isolated source copy on ports 8093/8094 using a fresh headless Chrome profile and synthetic preview data. It exercised support/guest isolation, categories/products/variants, negotiated prices, persistent tabs/sidebar, dark theme, the 320px viewport, Fast Refresh, checkout/change and the saved receipt. The initial browser attempt stopped on a CDP timeout; a fresh run with step logging passed all original assertions, including the clean-browser-error assertion. No assertion was removed or ignored.

A separate browser probe passed the new illustrated login, recovery link request, token/new-password submission, delayed close and empty secret fields after reopening. All recovery traffic was synthetic preview traffic. The temporary host preview server was stopped using only its recorded PID/process group and matching working directory. The owner's emulator and normal development services were not driven or reset.

The actual deployed platform source is `2d799dd5596a92fb6a0e3be6cf51a2a018c88e2d`. Its `ilbi/api/v1/accounts/serializers.py` and `views/password_reset.py` exactly match the corresponding reorganized backend files in this branch. The new request/confirm/old-password contracts therefore match the deployed backend without a backend rollout. No real reset email or account password change was used as a probe.

[GitHub run 40450786683](https://github.com/Abdulxadiy/ilbi/actions/runs/40450786683), source `471c8be131ad6304025bf5b8f012f04a1556d522`, passed mobile, backend, frontend, production-edge, bot, automation and platform dependency checks. Desktop jobs were skipped for the PR. The separate mobile dependency audit still failed: five high entries involving the existing node-forge/Zod tooling dependencies. Its proposed Expo 44 downgrade was not applied; the audit gate was not suppressed. The overall CI run is therefore **not green**.

## Signed artifact — verified

The isolated native build succeeded in **14m 55s**, 616 tasks (588 executed, 28 up-to-date). Android package `uz.ilbi.mobile`, version `1.0.0`, native build `3`, ARM64 and x86_64, signed with the original release identity. Source commit `471c8be131ad6304025bf5b8f012f04a1556d522`, `sourceModified: false`.

- File: `dist/android/ILBI-1.0.0-android-3.apk`.
- Size: **76,190,829 bytes**.
- APK SHA-256: `5af126261d0119faf6a389502b3dc73947f286ea086a3d46b78f3fa8c93b576a`.
- Hermes SHA-256: `038aa19d4b8da7c04fd8bc2782ef1a7ceccdb123ea0c55f5bde074db97445d05`.
- Certificate SHA-256: `09fc04394dfd3d8e63abe97a0b71f066ced06a90cd7e94773705f1efae2cd756`.

The native identity, non-debug standalone mode, signature, alignment, ABIs, embedded payload, 112 bound application sources and current-runtime comparison all passed. The bundle differs from published build 2. The build shell has no alternate API override; the native default is the official ILBI backend. The real exporter and isolated activation against the actual prior server feed passed, preserving desktop/iOS metadata.

This verifies an artifact and source, **not a build-3 native installation or observed update notice**. No ADB/device query, emulator start/stop/install, app restart or data reset was performed. The owner retains their existing installation for observation.

## Server publication — completed

The verified APK and mobile metadata were transferred completely to private server staging. The server independently verified all bytes and SHA-256 before exposing the immutable APK and atomically activating the mobile feed. The previous feed was saved outside the public download directory. A subsequent read-only server check confirmed build 3, the exact file hash, a valid previous-feed backup, unchanged desktop metadata and unchanged backend/frontend/bot image records.

Published APK: [ILBI 1.0.0 Android build 3](https://ilbi.uz/downloads/mobile/471c8be131ad6304025bf5b8f012f04a1556d522/ILBI-1.0.0-android-3.apk).

The first public download was interrupted and was not counted as passed. A fresh full HTTPS download completed with HTTP 200, `application/octet-stream`, **76,190,829 bytes**, SHA-256 `5af126261d0119faf6a389502b3dc73947f286ea086a3d46b78f3fa8c93b576a`, matching the verified signed local APK. The real public feed matched the exported mobile metadata; Windows/Linux and any iOS metadata remained unchanged. Main was not merged, platform images were not deployed/restarted, and platform version remains `1.4.0`.

The current unmodified release consumer fetched and parsed the actual public HTTPS feed. Android installed-identity fixtures `1.0.0`/build `1` and build `2` each received candidate build `3`; fixture build `3` received no newer candidate. These are **source-level fixtures, not device observations**.

The installed app checks while signed in and active/on foreground entry, and periodically during an active session. Its in-app banner offers “Ilovani yangilang” / “Yangilash”; manual entry is **Menyu → Yuklab olish → Yangilanish → Yangilanishlarni tekshirish**. Dismissal is scoped to account, installed/offered build and business day. Opening the APK still requires Android installation approval. This publication does not configure background phone push or silently replace installed app code.

Actual records are under [evidence/ui-release-2026-10-27](evidence/ui-release-2026-10-27/): build manifest, standalone verifier output, browser transcripts, CI status, server activation/final check, public feed, full download and source-consumer results. Host browser screenshots show synthetic data: [dashboard](evidence/ui-release-2026-10-27/home.png), [login](evidence/ui-release-2026-10-27/login.png), [recovery](evidence/ui-release-2026-10-27/recovery.png). They are not screenshots of an upgraded native installation.

The owner must observe the existing emulator's notice/installation themselves; no emulator command, install, restart or reset was used. Native business acceptance and the existing five-high dependency audit remain explicit limits. Later evidence-only commits do not change the APK's recorded source `471c8be131ad6304025bf5b8f012f04a1556d522`.
