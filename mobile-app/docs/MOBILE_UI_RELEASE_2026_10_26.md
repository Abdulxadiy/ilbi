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

Platform `1.4.0` is separate from mobile `1.0.0`. The server publication scope is being clarified because the branch also contains backend/desktop changes. These observations are not a claim that those changes were merged or deployed.

## CI preview startup correction

The failed mobile job in run `40210504038` stopped before browser checks: Compose required `backend/.env`, but the clean runner only copied the root example. The mobile CI preparation now copies backend and bot examples as well, because Compose validates all declared `env_file` paths even when starting only the mobile service.

An isolated clean-checkout simulation using only the committed Compose file and the three example env files passed `docker compose --profile mobile config --quiet`. No service or emulator was started by that probe. All three existing deploy-handoff tests passed, preserving main-only/superseded-commit guards. The separate dependency-security job remains a real gate; it was not suppressed by this startup correction.

## Android update candidate

Only Android's native `versionCode` advances from 1 to 2, so the installed build 1 can recognize an actual newer package. Marketing version remains `1.0.0`, iOS build remains `1`, platform remains `1.4.0`. The update must use the established certificate and application ID; the earlier build-1 APK is retained as historical evidence and is never relabeled.

The source change prepares a candidate; it is not proof that a build finished or the server feed was published. The owner's running emulator must remain unchanged. The publication scope remains the pending clarification above.

After the metadata change, actual local signing/SDK preflight, TypeScript, strict ESLint and all 237 tests passed again. Native APK assembly and public server acceptance are separate subsequent checks.
