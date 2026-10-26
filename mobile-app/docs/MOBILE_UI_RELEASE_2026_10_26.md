# Mobile UI change verification — 2026-10-26

The owner supplied new mobile changes and requested separate meaningful commits, GitHub push and verification of server delivery. The running emulator must remain untouched so the owner can observe an actual update offer later.

## Manual theme controls

The app now defaults to light mode, offers explicit light/dark choices in Settings and the sidebar, and migrates a saved legacy `system` preference to light. `toggleTheme` is available through the theme context. The owner-supplied theme test exercises the initial state and switching to dark.

Verification against the changed working tree: TypeScript passed; strict ESLint passed; all 41 Jest suites / 237 tests passed. A trailing blank line at the end of the new test was removed for `git diff --check`.

These are source/component checks. No ADB command, emulator install, app restart, app-data reset or native interaction is used for this release task. Native appearance and the owner's update-offer observation are not recorded as passed.

## Compact workspace controls

Home uses separate compact metric badges and grouped quick-action icons. The cart groups customer selection and wholesale controls in a single card and adjusts search/scanner spacing. Catalog actions and filters are horizontal chips next to the search/scanner controls, with active filter styling. Existing permission checks and API operations remain in the supplied changes.

The same full-working-tree TypeScript, strict lint and 237-test run covers these changes. `git diff --check` passes. No emulator action was used to validate the layout; the owner is retaining the old installed binary to observe the later update flow.

## Deployment facts observed before publication

- Source branch: `refactor/ilbi-backend-layout`. At the beginning of this task it was 35 commits ahead of `main`; `main` was `2d799dd5596a92fb6a0e3be6cf51a2a018c88e2d`.
- The actual server's recorded backend/frontend/bot image tags match that `main` commit. Both the server file and public HTTPS `/downloads/releases.json` had `mobile: null`.
- Production deploy listens to successful CI workflow runs for `main`, accepts push/manual-CI events, and rechecks that the tested commit is still `main`. A feature-branch PR CI run does not deploy production.
- The latest pre-task feature PR CI (`40210504038`) was red in the mobile and mobile-dependency-security jobs, while backend/frontend/production-edge passed. Local passing tests do not make this GitHub run green.
- Current production deployment builds web/backend/bot images and Windows/Linux packages. It has no Android APK build/upload/feed activation step. GitHub source push alone cannot replace installed mobile code or publish a native update.
- Installed Android build 1 can offer a same-marketing-version build 2 after a genuine signed APK and its higher native build are published in the official feed. The implemented notice requires a signed-in account and foreground native app, checks on entry/foreground and periodically, and offers a dismissible reminder once per account/build/business day. It is an in-app reminder, not a phone OS push or silent APK installation.

Platform `1.4.0` is separate from mobile `1.0.0`. The owner explicitly selected **only the new mobile APK**, leaving the platform branch unmerged and its deployed images unchanged.

## CI preview startup correction

The failed mobile job in run `40210504038` stopped before browser checks: Compose required `backend/.env`, but the clean runner only copied the root example. The mobile CI preparation now copies backend and bot examples as well, because Compose validates all declared `env_file` paths even when starting only the mobile service.

An isolated clean-checkout simulation using only the committed Compose file and the three example env files passed `docker compose --profile mobile config --quiet`. No service or emulator was started by that probe. All three existing deploy-handoff tests passed, preserving main-only/superseded-commit guards. The separate dependency-security job remains a real gate; it was not suppressed by this startup correction.

## Android update candidate

Only Android's native `versionCode` advances from 1 to 2, so the installed build 1 can recognize an actual newer package. Marketing version remains `1.0.0`, iOS build remains `1`, platform remains `1.4.0`. The update must use the established certificate and application ID; the earlier build-1 APK is retained as historical evidence and is never relabeled.

The source change prepares a candidate; it is not proof that a build finished or the server feed was published. The owner's running emulator must remain unchanged. Only the signed APK and mobile feed are authorized for this publication.

After the metadata change, actual local signing/SDK preflight, TypeScript, strict ESLint and all 237 tests passed again. Native APK assembly and public server acceptance are separate subsequent checks.

## Rejected stale-bundle candidate and build correction

The first build-2 assembly completed in 9m 36s and passed native identity/signature checks, but a further payload comparison caught an unchanged Hermes bundle. Its APK SHA-256 was `b9fa935dc6987e61f0aa56f83107fa49bf327cf8249fddc880b8a6dd5f23c845`; it was never published or installed. The generated source map still referenced the first build's `standalone-b7kgja0f` copy, and its source contents did not include the supplied new theme/layout. The rejected candidate and its manifest were moved out of deliverable `dist/`.

The installed SDK 58 CLI disables Gradle's requested Metro cache reset under `CI=1`. The isolated CNG copies shared node_modules transforms; cached Expo Router context paths selected an older copy. A project-local Metro transform store, file-map directory and root-specific cache version now isolate these copies. The builder additionally compares all bundled application source-map contents with actual files and checks that the source-verified generated Hermes payload is exactly the one packaged into the APK. The manifest records bundle/source hashes, and standalone verification rejects old/unbound records or changed source.

The guard rejects the actual failed candidate as stale `src/theme/ThemeContext.tsx`. A fresh isolated Metro Android export contains the new theme/cart/catalog markers, and all 112 mapped application source files match the current tree. Six focused regression tests cover stale contexts, packaged-payload mismatch, legacy/mutated records, generated Router context entries and path traversal; all 20 mobile Python checks pass. These export/source checks are not an emulator test or a successful final APK publication.

## Browser preview resource correction

The full isolated host browser regression passed against a separate source copy and ports 8091/8092, including its source refresh/restoration. The owner's emulator and original Home source were not used for that probe. GitHub run `40305510360` then completed the functional assertions but failed its final clean-browser-log assertion because `/favicon.ico` returned HTTP 500 through Metro's image middleware in the slim container.

The preview proxy now serves the existing ILBI PNG directly at `/favicon.ico`. A real HTTP probe against the isolated proxy confirmed 200, `image/png`, and an exact hash match with the asset. No error assertion was removed or ignored. This is a host preview-server change; the native app's source/payload does not change and its verified APK does not need another rebuild for this route.

## Published signed APK — completed

The corrected full CNG/Gradle build completed in 8m 6s. The final APK is `1.0.0` / Android build `2`, application ID `uz.ilbi.mobile`, ARM64 and x86_64, signed with the original certificate. Its actual packaged Hermes payload is bound to 112 verified application source files and includes the new theme/cart/catalog controls. Source commit: `19183bb7c4d10a43840bd5156d2b77c7aaeef433`. Later preview-server/documentation commits do not change the native runtime.

- APK size: 75,723,829 bytes.
- APK SHA-256: `30d86bcca424fdf70246982d3a4389646453828028ec338dcf69f16489ae8adb`.
- Packaged Hermes SHA-256: `9fb6b5852a7a1b1d7ff092c720ae4897706a4005b897aa0ed579cc93a0f0e59a`.
- Public certificate SHA-256: `09fc04394dfd3d8e63abe97a0b71f066ced06a90cd7e94773705f1efae2cd756`.
- [Actual published APK](https://ilbi.uz/downloads/mobile/19183bb7c4d10a43840bd5156d2b77c7aaeef433/ILBI-1.0.0-android-2.apk).

The standalone verifier passed, including native identity/signature, alignment, actual bundle/source hashes and current-runtime comparison. The genuine exporter and an isolated activation against the real previous server feed passed. The APK and metadata were uploaded to private server staging; only after transfer completion and server hash verification was the immutable APK path exposed and the official mobile feed atomically activated.

The public HTTPS feed equals the verified release metadata. A full curl download returned HTTP 200, all 75,723,829 bytes and the exact APK SHA-256 above. An earlier streaming probe did not establish a full-body match; the completed download is the passing evidence. Server-side bytes/hash independently matched. Windows/Linux feed objects were preserved exactly; the recorded web/backend/bot image tags still point to platform source `2d799dd5596a92fb6a0e3be6cf51a2a018c88e2d`. Main was not merged or deployed. Server desktop activation code matches the reviewed local code and preserves mobile metadata on later desktop releases.

A source-level check parsed the actual public feed: installed Android identity `1.0.0`/build `1` receives candidate build `2`, while build `2` receives no newer candidate. This is not an observation on the owner's device. No emulator/ADB action, app installation, restart or data reset was performed during this task. The owner will observe the in-app notice and approve installation themselves.

Public evidence is in `evidence/ui-release-2026-10-26/`: native manifest, standalone verifier output, server activation, published feed and completed-download verification. The native marketing version stays `1.0.0`, iOS build `1`, platform `1.4.0`. The outstanding dependency audit (five high entries involving existing node-forge/Zod tooling dependencies) remains reported; it was not disabled or solved by a forced Expo downgrade. This preview APK publication does not claim full production/native business acceptance.

[GitHub CI run 40307768394](https://github.com/Abdulxadiy/ilbi/actions/runs/40307768394) confirms the corrected mobile job passed, along with backend, frontend, production-edge, bot, automation and the separate platform dependency check. The mobile dependency-security job remains red, so the overall run is not described as green. Desktop build jobs are skipped for this PR branch. Later evidence-only commits do not change the APK runtime or its recorded source commit.
