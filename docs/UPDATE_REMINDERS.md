# Download and update reminders

The owner wants desktop and mobile users running an older release to receive a reminder on their first signed-in use each day, with an update action. Adding the mobile client does not change the platform version. Platform `1.4.0`, mobile `1.0.0` and native build `1` are unchanged in this implementation.

## Desktop — implemented and checked, 2026-10-25

The installed desktop updater still checks the official public release feed, verifies immutable official URLs, size and SHA-256, and preserves its existing save/pause/install safeguards. The renderer shows its reminder only after account authentication. A dismissed reminder stays dismissed across login, renderer remount and application restart for that business day. The next Tashkent calendar day permits a new reminder; a different offered build can also be announced that day. Foreground/focus changes re-evaluate the day. The existing updater checks automatically and is also checked after login or reconnection.

Reminder state contains only account ID, installed version/build, offered build and day. If local browser storage is unavailable, an in-memory fallback prevents repetition during that runtime without breaking login. Persistence across a restart cannot be promised when storage is unavailable. Guests do not see this reminder. Nothing downloads or installs until the user chooses the existing update action.

The official updater now identifies the exact offered build in its status. New fixes at the same platform version still trigger the daily policy and are described as new fixes, without inventing a platform version bump.

Verified: all 70 frontend unit tests; all 8 desktop updater tests; the actual Chrome notice harness covering dismissal, same-day remount/login suppression, next-day reappearance, guest exclusion, progress, retry, success, light/dark layouts and subscription cleanup. The production frontend build passed. Changed frontend files passed lint without warnings; the repository-wide lint command still reports preexisting warnings elsewhere. This does not claim a fresh packaged Windows/Linux installer or native OS notification delivery was executed for this change.

## Mobile and public download integration

This is the next implementation slice. It will use the installed native binary's version/build, the same official public release feed and platform-specific download actions. No unsigned/debug APK or nonexistent App Store URL is to be advertised as a published release. Package signing/publication and available download artifacts must remain explicit.
