# AI handoff: build and verify the ILBI Android APK

Read this first when continuing the owner's build task. It is an executable handoff, not a claim that every business feature is complete.

## Current scope

- Android APK now; iOS/IPA later.
- Phone notifications are **discussion only** until the owner starts implementation. Their intended scope covers the whole platform; Z reports, chat and B2B were examples. Do not install notification/Firebase modules, alter the backend or send test pushes from a proposal document.
- Platform `1.4.0`, mobile `1.0.0`, Android code `2`, iOS build `1`. Android code 2 is the UI update candidate for existing build-1 installations. Do not bump marketing/platform versions for build tooling or documentation.
- First accepted standalone APK: `dist/android/ILBI-1.0.0-android-1.apk`, source `6ac80b1b5b955587837ec5f58cd4ab690a90cca2`. The current UI update needs `dist/android/ILBI-1.0.0-android-2.apk` built from its recorded source commit; do not relabel the old binary as build 2.
- For the 2026-10-26 update task, leave every running emulator and its installed build unchanged. Artifact/source verification and server staging must not install, restart, inspect through ADB, clear data or otherwise drive the emulator. The owner will observe the update offer themselves.
- `android-signing-public.json` pins the existing public certificate. Private signing material is outside Git under the owner's `~/.local/share/ilbi-signing/mobile/`.
- No phone push transport is configured. Support polling and in-app update reminders already exist.

Read `../AGENTS.md`, `AGENTS.md`, `docs/ILOVANI_YIGISH_UZ.md`, `docs/MOBILE_UPDATES_VALIDATION.md` and the live parity audit. The required sequence is **implement → test → record actual evidence → advance**.

## Exact workflow

Commands run inside `mobile-app/`, not the parent repository:

```bash
cd /mnt/storage/Codes/Projects/Backend/ilbi/mobile-app
test -f package.json
node --version
```

React Native 0.88 requires Node `^22.13.0`, `^24.3.0` or `>=26.0.0`. Use npm and the committed lockfile. Run `npm ci` when dependencies are absent or the lockfile changed. Running `npx expo` in the parent directory may download another CLI and fail to find the app.

Check prerequisites and the existing artifact:

```bash
npm run build:apk:check
npm run verify:apk:local
```

The first checks available dependencies, Java/SDK tools, mobile versions and the established signing identity without building. The second verifies the actual APK signature, identity, size/hash, bundled JavaScript, ABIs and runtime-source changes without reading private passwords.

If verification passes and the app runtime is unchanged, the existing APK is current. Do not claim it was newly rebuilt. Documentation and host npm helper commands do not require a new application binary. New/edited app files, assets, routes, native dependencies or relevant configuration require a new build; untracked runtime files are also detected.

When a fresh APK is required:

```bash
npm run typecheck
npx eslint . --max-warnings 0
npm test -- --silent
npm run build:apk:local
npm run verify:apk:local
```

The builder generates an isolated CNG project outside Git, embeds real-backend JavaScript, signs with the existing key and verifies the result. On this configured computer it needs no Android Studio GUI, Expo cloud login or Docker. It never installs, deletes phone/app data or publishes remotely.

Outputs are `dist/android/ILBI-<version>-android-<code>.apk` and `android-build-manifest.json`. Verification selects the filename from that manifest. Deliver the APK directly; the owner does not want ZIP archives. Do not commit binaries or generated native projects.

## Failure handling

- Stop at a failed exit code, fix it, rerun the affected check and record the actual result. Do not invent a passed native/remote check.
- If a build manifest says `sourceModified: true`, do not clear that flag or rewrite its commit to force a pass. Commit the verified runtime work and rebuild with real provenance. If a shallow checkout lacks the original commit, obtain the known repository history or report source verification unavailable.
- SDK location can come from `ANDROID_HOME`/`ANDROID_SDK_ROOT`; Java from `JAVA_HOME`, or explicit `--android-sdk`/`--jdk`. The owner's existing SDK cache is a convenience, not a portable requirement. Use complete stable build tools.
- If the established key is missing, restore that key. Do not create a replacement, borrow a debug key, edit the public certificate pin or request passwords in chat. Finish independent work and identify the missing local record/path.
- `npm run prepare:signing` creates protected, ignored EAS credentials from the existing local record. Never print credential JSON, private records, passwords or an environment dump.
- Preserve the owner's financial, fiscal, account/store, permission and pending-work safeguards. Do not uninstall or clear a financial app to make a test pass.
- Do not force-upgrade/downgrade Expo or suppress the existing dependency-security gate to hide unrelated advisories. SDK changes need matching official documentation and their own validation.
- If a future approved Firebase implementation declares `expo.android.googleServicesFile`, update isolated source copying to include only that validated client configuration. A service-account private key never belongs in APK assets. The current builder intentionally excludes arbitrary root JSON and `.env` files.

## Runtime acceptance and delivery

Artifact verification is not a device test. Historical evidence names exact artifacts/source commits. The genuine release opened login/downloads/native identity on a fresh API 36 x86_64 emulator with Metro stopped. ARM64 libraries are present; physical ARM64 and iOS are not accepted.

Use a dedicated emulator. `tests/android.release.py` requires the genuine release and stopped Metro. `tests/android.updates.py` uses a clearly labeled synthetic offer and cannot prove a real package upgrade. ADB drivers reject physical-device serials by default. Record each runtime and its actual limits.

Split meaningful verified commits and push to the current branch, as the owner requested. Do not automatically merge main, publish tags, upload secrets, activate a server feed, build IPA or send real notifications as a side effect of this APK task.

For later notification planning, read [the discussion](docs/PUSH_NOTIFICATIONS_DISCUSSION.md). For user-facing build instructions, read [the Uzbek guide](docs/ILOVANI_YIGISH_UZ.md).
