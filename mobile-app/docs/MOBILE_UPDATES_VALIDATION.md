# Mobile downloads and update reminders — 2026-10-25

Downloads are available from the fixed sidebar and from login. Signed-in business users keep five bottom tabs, with separate Update/Download segments inside the page. Android, iPhone/iPad, Windows and Linux use their own version and availability information. Missing artifacts remain unavailable. The public web download page also has separate Android and iOS cards, including version/build, size, preview label and Android checksum.

`expo-application` reads the installed ILBI binary's application ID, version and native build. The code does not compare a mobile installation against the platform/web package version or a newer Metro/OTA manifest. Expo Go and web are not treated as installed ILBI binaries. Android update candidates require a newer native versionCode without marketing-version downgrade; same-version build updates are supported. iOS compares its own version/build.

The public official feed is fetched without the authenticated API client, account/tenant headers, cookies or redirects. Direct Android APKs require bounded size and SHA-256 metadata. Only official ILBI download paths or platform store URLs are accepted. A previously validated feed can remain available offline, with an explicit failed-check state rather than a false fresh success.

After login, an outdated install receives a dismissible update strip. Its claim is persisted per account, installed build, offered build and Tashkent business day. A second mount/restart does not repeat it that day. A new business day or offered build permits a reminder. Async claims are serialized and canceled account/background transitions do not consume unseen reminders. The action opens the official package/store flow; it neither silently installs nor reports installation success merely because a browser opened.

## Passing checks

Android and iOS Hermes exports also passed in real-backend mode (`evidence/updates-js-exports.txt`). These are JavaScript bundle checks, not an IPA or installed iOS test.

- All 236 mobile Jest checks, TypeScript and strict ESLint passed. Controlled-clock tests cover next-day foreground entry, remount suppression, account separation, offline metadata, Expo Go exclusion, correct native identity and exact update target. An explicit preview fixture cannot open a real download.
- The full host/Chrome phone regression passed, including sidebar downloads, separate platform cards, the Update segment, preserved bottom tabs and all prior support/catalog/checkout/Fast Refresh checks.
- All 71 web unit checks passed. The web download Chrome harness checks unpublished Android/iOS states, separate published APK/Apple links using explicit fixtures, mobile build display, 390px layout, legacy feeds, offline/retry, authenticated segments and existing desktop packages. The frontend production build and changed-file lint passed.
- Eight Python build/publisher checks passed, covering protected credential preparation, refusal to replace an established key, credential-free CNG source copying, wrong-commit/corrupt-package rejection, monotonic Android builds, signer continuity, idempotent activation and preserving desktop/iOS metadata. Seven existing desktop activation tests also passed.
- The actual compiled debug APK includes Expo Application 58.1.2, mobile `1.0.0`, native build `1`. APK SHA-256: `b3bec8342055ede398aa61b4ce65e8d972e6f06d30c859913449b5c169f409c4`. Its private CNG baseline is `d559160` with the new locked dependency/config copied before generation. Current feature JavaScript was served by explicit synthetic Metro.
- On installed API 36 Android, the actual native version/build produced a reminder against a clearly labeled synthetic build-2 offer. The preview update action was blocked before opening a package. Closing the strip survived a real force-stop/restart, and the download/update page showed native build 1, five business tabs, guest access at login and retained sidebar support. Final ReactNativeJS and Android crash buffers contained no application error. Evidence is under `evidence/updates-android/` and `evidence/updates-native.txt`.
- The actual debug APK was refused by the public exporter because it is debuggable. It was not advertised as an installable standalone release.

The first native driver attempt assumed the app was still foregrounded; it encountered the Android launcher and failed before interacting. The driver now starts the installed activity explicitly. To repeat the fresh-announcement scenario after a prior probe, only the synthetic account's reminder key was reset in its stopped AsyncStorage database, with every other record compared before/after. Financial databases were not modified. The subsequent driver ran without resets between dismissal and process-restart verification. Failed attempts are not passing evidence.

## Packaging and remaining gates

The owner confirmed Android has never been distributed. A persistent owner-only signing identity was created outside Git; subsequent user builds must retain it. `eas.json`, protected local credential preparation and the isolated local APK builder are documented in [ILOVANI_YIGISH_UZ.md](ILOVANI_YIGISH_UZ.md). The builder forces real backend mode, embeds JavaScript and checks the final signature/native metadata. The completed standalone release assembly/installation is recorded below; debug acceptance alone did not establish it. EAS/Apple login, cloud builds and iOS native acceptance have not been performed.

`scripts/export_downloads.py` inspects a genuine non-debug APK and pinned release certificate, then stages an immutable `/downloads/mobile/<commit>/...apk` artifact. `ops/activate_mobile_downloads.py` verifies the transferred artifact and atomically merges its metadata into the existing feed. Android's legacy alias remains for older pages. Desktop retention does not remove the separate mobile directory. No release is activated remotely by these tests.

Phone push notifications are still DMP-060 work. The in-app update strip does not establish FCM/APNs delivery. Existing fiscal, financial, production, physical-device, iOS and broader migration gates remain in the audit. Platform `1.4.0`, mobile `1.0.0`, Android code `1` and iOS build `1` remain unchanged; the simulated build-2 offer was never published.

## Actual signed standalone APK — completed

`npm run build:apk:local` completed a genuine CNG release build in 10m 17s from application source `6ac80b1b5b955587837ec5f58cd4ab690a90cca2`. The APK was re-signed using the owner's persistent PKCS12 identity and passed native version/application ID, non-debuggability, certificate, size/hash and alignment checks. It contains embedded Hermes JavaScript and both ARM64/x86_64 native libraries.

Artifact: `mobile-app/dist/android/ILBI-1.0.0-android-1.apk` (75,719,733 bytes). SHA-256: `772d4de6795c6abbf5e758eae4d6a5e06e0a4e7f88c2e8143c7af8137f110ee0`. Public signing-certificate SHA-256: `09fc04394dfd3d8e63abe97a0b71f066ced06a90cd7e94773705f1efae2cd756`. Signing secrets remain outside Git and are not contained in evidence.

The exact APK installed on a new, separate `ILBI_RELEASE_API_36` emulator. With Metro stopped and no reverse connection configured, real-mode login and public downloads opened, and the app read installed version 1.0.0/build 1. No design-data banner or demo-login action appeared. Package flags confirmed a non-debug release; native/JavaScript crash checks passed. No account login, support send or financial mutation was submitted. Both native emulators were stopped afterwards and the normal synthetic host preview was restored with the fake-update fixture disabled.

The genuine signed APK also passed the real exporter and activation in isolated local staging, retaining existing desktop metadata. Nothing was uploaded or activated on the public server. The 73 MB binary is generated/ignored, not committed. Evidence and public metadata are in `evidence/android-release/`. Physical ARM64, iOS, actual older-to-newer production migration, live operator delivery, fiscal readiness and remaining audit items are still separate gates.

After the successful build, the helper was tightened to capture Git provenance before source copying and retain the correctly named optional v4 signature sidecar. Eight Python setup/publisher checks and Python compilation passed after that small tooling correction; application JavaScript did not change. The first artifact's source remains the exact commit above.
