# Mobile UI change verification — 2026-10-26

The owner supplied new mobile changes and requested separate meaningful commits, GitHub push and verification of server delivery. The running emulator must remain untouched so the owner can observe an actual update offer later.

## Manual theme controls

The app now defaults to light mode, offers explicit light/dark choices in Settings and the sidebar, and migrates a saved legacy `system` preference to light. `toggleTheme` is available through the theme context. The owner-supplied theme test exercises the initial state and switching to dark.

Verification against the changed working tree: TypeScript passed; strict ESLint passed; all 41 Jest suites / 237 tests passed. A trailing blank line at the end of the new test was removed for `git diff --check`.

These are source/component checks. No ADB command, emulator install, app restart, app-data reset or native interaction is used for this release task. Native appearance and the owner's update-offer observation are not recorded as passed.
