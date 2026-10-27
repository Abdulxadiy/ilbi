# AI handoff: build and verify the ILBI Android APK

Read this first when continuing the owner's build task. It is an executable handoff, not a claim that every business feature is complete.

## Current scope

- Android APK now; iOS/IPA later.
- Push foundation, SDK and installation APIs are implemented. The reviewed backend is deployed; sender credentials and actual phone delivery remain disabled/unverified. Do not enable push or upload the private sender key as a side effect of an APK publication. See `docs/PRODUCTION_ROLLOUT_2026_10_27.md`.
- Platform `1.4.0`, mobile `1.0.0`, Android code `5`, iOS build `1`. Build 5 is published and its full HTTPS bytes/hash and update feed are verified; earlier builds remain immutable. Keep marketing/platform versions unchanged. See `docs/MOBILE_UI_RELEASE_2026_10_27_BUILD5.md` for the latest actual status.
- First accepted standalone APK: `dist/android/ILBI-1.0.0-android-1.apk`, source `6ac80b1b5b955587837ec5f58cd4ab690a90cca2`. The currently published APK is `dist/android/ILBI-1.0.0-android-5.apk`, source `4ec8f4647fc5f9ed5bc789b7a60bb0f625c0b84c`; never relabel an old binary with a newer build number.
- Build 2 was published from source `19183bb7c4d10a43840bd5156d2b77c7aaeef433`; see `docs/MOBILE_UI_RELEASE_2026_10_26.md`. Build 3 was published from source `471c8be131ad6304025bf5b8f012f04a1556d522`; actual checks and limits are in `docs/MOBILE_UI_RELEASE_2026_10_27.md`. Its manifest binds the actual payload to 112 application sources. Build 4 was subsequently published from source `364017038bedcbe20b0974a86fa75aeec29cd5ea`; the current official feed points to build 5. A subsequent update needs a higher Android native build; never replace a published binary with different bytes.
- For the 2026-10-26 and 2026-10-27 update tasks, leave every running emulator and its installed build unchanged. Artifact/source verification and server staging must not install, restart, inspect through ADB, clear data or otherwise drive the emulator. The owner will observe the update offer themselves; do not assume which build they currently have installed.
- `android-signing-public.json` pins the existing public certificate. Private signing material is outside Git under the owner's `~/.local/share/ilbi-signing/mobile/`.
- Phone push delivery is not enabled on production. Support polling, inbox APIs and in-app update reminders exist. The update reminder does not require FCM.

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

The builder additionally audits the generated Hermes source map against the copied application source, verifies that exact payload is inside the APK, and records source-file digests plus the bundle hash. The standalone verifier checks those records against the current source. Do not fabricate these fields for an older artifact. The 2026-10-26 first build-2 attempt had a valid native identity but stale screens and was rejected before publication.

Keep `metro.config.cjs`: isolated CNG projects share dependencies, so their Router transforms and file-map caches must be isolated by project root. Expo SDK 58 disables the Gradle-requested cache reset when `CI=1`; native package metadata and a clean Git commit alone do not prove the bundled screens are current. Never clear an unrelated running emulator/app to fix bundling.

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
- The current Firebase client configuration is allowlisted and validated by the isolated source copier. A service-account private key never belongs in APK assets. Arbitrary root JSON and `.env` files are excluded.

## Runtime acceptance and delivery

Artifact verification is not a device test. Historical evidence names exact artifacts/source commits. The genuine release opened login/downloads/native identity on a fresh API 36 x86_64 emulator with Metro stopped. ARM64 libraries are present; physical ARM64 and iOS are not accepted.

Use a dedicated emulator. `tests/android.release.py` requires the genuine release and stopped Metro. `tests/android.updates.py` uses a clearly labeled synthetic offer and cannot prove a real package upgrade. ADB drivers reject physical-device serials by default. Record each runtime and its actual limits.

Split meaningful verified commits and push to the current branch, as the owner requested. Do not automatically merge main, publish tags, upload secrets, activate a server feed, build IPA or send real notifications as a side effect of this APK task.

For later notification planning, read [the discussion](docs/PUSH_NOTIFICATIONS_DISCUSSION.md). For user-facing build instructions, read [the Uzbek guide](docs/ILOVANI_YIGISH_UZ.md).
