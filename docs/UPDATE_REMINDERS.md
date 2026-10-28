# Download and update reminders

The owner wants desktop and mobile users running an older release to receive a reminder on their first signed-in use each day, with an update action. Adding the mobile client does not change the platform version. Platform `1.4.0`, mobile `1.0.0` and native build `1` are unchanged in this implementation.

## Desktop — implemented and checked, 2026-10-25

The installed desktop updater still checks the official public release feed, verifies immutable official URLs, size and SHA-256, and preserves its existing save/pause/install safeguards. The renderer shows its reminder only after account authentication. A dismissed reminder stays dismissed across login, renderer remount and application restart for that business day. The next Tashkent calendar day permits a new reminder; a different offered build can also be announced that day. Foreground/focus changes re-evaluate the day. The existing updater checks automatically and is also checked after login or reconnection.

Reminder state contains only account ID, installed version/build, offered build and day. If local browser storage is unavailable, an in-memory fallback prevents repetition during that runtime without breaking login. Persistence across a restart cannot be promised when storage is unavailable. Guests do not see this reminder. Nothing downloads or installs until the user chooses the existing update action.

The official updater now identifies the exact offered build in its status. New fixes at the same platform version still trigger the daily policy and are described as new fixes, without inventing a platform version bump.

Verified: all 70 frontend unit tests; all 8 desktop updater tests; the actual Chrome notice harness covering dismissal, same-day remount/login suppression, next-day reappearance, guest exclusion, progress, retry, success, light/dark layouts and subscription cleanup. The production frontend build passed. Changed frontend files passed lint without warnings; the repository-wide lint command still reports preexisting warnings elsewhere. This does not claim a fresh packaged Windows/Linux installer or native OS notification delivery was executed for this change.

## Mobile and public download integration

The mobile implementation reads the installed binary with Expo Application, uses the official public release feed and persists daily claims per account/native build. Sidebar/login download pages preserve the business tabs and distinguish Android/iOS/Windows/Linux releases. The public web page has separate Android/iOS cards; a missing release remains unavailable.

All 236 mobile tests, strict lint/TypeScript, host/Chrome phone regression and actual installed API 36 native version/dismissal/restart/download checks passed. All 71 web tests, the download browser harness/build and eight isolated signing/publisher checks passed. Native acceptance used a clearly labeled synthetic build-2 offer; it did not install or publish that fake release. See [mobile validation](../mobile-app/docs/MOBILE_UPDATES_VALIDATION.md).

The owner confirmed Android has never been distributed. Its persistent signing identity is outside Git under `~/.local/share/ilbi-signing/mobile/`; the protected credential mapper and isolated APK builder reuse it. The build and EAS/iPhone procedures are in [the Uzbek guide](../mobile-app/docs/ILOVANI_YIGISH_UZ.md). EAS/Apple login and iOS native builds have not been performed. No unsigned/debug APK or nonexistent App Store URL is advertised as published.

Mobile staging and server activation preserve desktop and iOS metadata and keep immutable Android files under `/downloads/mobile/<commit>/`. These scripts do not upload automatically or bump platform versions. A later actual standalone build/installation is recorded separately. Native phone notifications remain DMP-060 work; this feature is an in-app update reminder.

The standalone Android release build and fresh-emulator smoke test subsequently passed with Metro stopped. The owner-signed `1.0.0`/build `1` APK is under `mobile-app/dist/android/`; its exact digest and source commit are recorded in the mobile validation document. Actual signed-artifact export/local staging activation passed, without public-server publication.
