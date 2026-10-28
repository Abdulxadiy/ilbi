# Mobile UI release — Android build 5, 2026-10-27

**Status: COMPLETE for the approved mobile-source commits and APK publication scope.** The owner requested meaningful separate commits, GitHub pushes and server publication, while preserving the existing emulator/installed app for their own update observation.

## Store and category UI

The owner's store-selection cards retain explicit store selection and access-refresh/logout actions. Category cards add a bottom-sheet action menu and retain parent navigation, product browsing and permission-gated editing. The existing gate/category tests and new selected-category action-menu regression passed in the actual Jest run (five targeted suites, 34 total tests including the image work); this is source-level UI coverage, not installed-device acceptance.

## Image upload corrections

The owner added SDK-compatible image selection, product/variant cards, avatar controls and sidebar avatars. Review found an unused icon that failed zero-warning ESLint and a product image action targeting gallery creation instead of main-image replacement. Main-image replacement now uses the existing multipart product PATCH without sending prices or variant fields. Picker/upload state is locked against duplicates and bound to the initiating authenticated account/server/store, with permission checks repeated before mutation. Profile upload/delete use the existing avatar endpoints. The image-picker plugin declares photo usage and blocks microphone access while preserving the scanner camera permission.

Targeted image tests cover the native multipart append arguments, denied access, cancellation, invalid selection, changed account/store during asynchronous selection, the product PATCH contract, avatar upload/delete and read-only catalog controls. The first test attempt incorrectly assumed Node's FormData had React Native's getParts method; it failed and was corrected to inspect actual append arguments. No native execution is claimed by these mocked selector/API tests.

## Assembled source checks

`npm ci` completed from the lockfile; TypeScript and zero-warning ESLint across src and tests passed. All **518 tests in 62 suites** passed; 26 Python build, signature/source-provenance, permission and publisher safeguard tests passed after the camera regression fix (24 passed before that additional guard). Selector/API tests are synthetic; no production account/photo mutation was used as a probe. The dependency advisory and native-device gates from the prior release remain explicit.

## Packaging and publication

Android versionCode advances from 4 to 5 so existing installations can identify a newer native package; the signing identity is retained. The corrected signed package was assembled and published, as verified below. Mobile marketing version remains 1.0.0; platform remains 1.4.0; iOS build remains 1. Published build 5 uses a new immutable URL; build 4 remains available unchanged. Existing APKs must remain byte-for-byte unchanged. No emulator/ADB interaction, main merge, frontend/backend/bot restart, push activation or iOS build is part of this UI publication.

## Camera permission rejection before publication

The first unpublished build-5 APK completed native assembly in 18m41s, but the final permission inspection caught CAMERA missing. The newly added image-picker cameraPermission:false blocks CAMERA globally, including expo-camera. This was an implementation error, corrected before any APK/feed publication. The false camera override was removed; microphone blocking remains. A fresh CNG generation now explicitly preserves CAMERA and blocks RECORD_AUDIO.

The shared signed-APK inspector/exporter now requires the configured camera and notification permissions and rejects any permission blocked in app.json. It actually rejects the first broken-camera APK. All 26 Python packaging/publisher/source tests, including two new native-permission regressions, passed. An initial supplemental native-class search also failed because R8 renames release classes; the exact release mapping linked ImagePickerModule to its verified final DEX descriptor. These failures are not passing native-device evidence. The existing emulator was never queried or changed.

## Accepted signed APK and actual public publication

The corrected clean source is **`4ec8f4647fc5f9ed5bc789b7a60bb0f625c0b84c`**, sourceModified:false. The private working directory from this task was reused with fresh CNG-generated native sources and the original builder's signing, source-map/bundle and final inspection pipeline. No generated native source was edited by hand, no release check was disabled and no manifest provenance was rewritten. The supplemental runner's source digest is retained in camera-rebuild-preflight.json.

The final native build passed in **14m19s**, with 617 actionable tasks (589 executed, 28 up-to-date), including release lint and assembleRelease. The first rejected package was never uploaded/published. Final package:

- Application: uz.ilbi.mobile; mobile 1.0.0; Android native build 5; ARM64 and x86_64.
- Artifact: `dist/android/ILBI-1.0.0-android-5.apk`, **77,749,484 bytes**.
- SHA-256: `0380da45c7da22a9b90f5ddc4a75a1380e4215bf1eb352090116cee98a40b175`.
- Established certificate: `09fc04394dfd3d8e63abe97a0b71f066ced06a90cd7e94773705f1efae2cd756`.
- Standalone verifier: signature, identity/build, alignment, embedded payload, ABIs and current source comparison passed. Real backend mode is retained.
- Actual APK permissions: CAMERA and POST_NOTIFICATIONS present; RECORD_AUDIO absent. The actual image-picker class and its ExponentImagePicker registration name are present in the final DEX, checked using the release R8 mapping. The public-input source allowlist and supplemental credential filename scan passed; the Firebase sender key was not copied/uploaded.

The real exporter and an isolated activation against the actual earlier server feed passed. Server activation at **2026-10-27 18:38:14 UTC** verified all transferred bytes before publishing the immutable package and atomically changing the Android feed plus legacy alias to build 5. It retained a private previous-feed backup, verified the previous APK hash was unchanged, preserved desktop/any iOS metadata, and compared every running platform container ID/image before and after: all unchanged. No backend/frontend/bot deployment or restart occurred.

[Download the accepted APK](https://ilbi.uz/downloads/mobile/4ec8f4647fc5f9ed5bc789b7a60bb0f625c0b84c/ILBI-1.0.0-android-5.apk).

A full public HTTPS download completed in36.16s: HTTP200, application/octet-stream, all77,749,484bytes and the exact signed local SHA-256. The public feed matched the exported metadata. Previous build4 remains available at its original URL and byte size. These are actual artifact/server checks, not a native installation.

## Update reminder and remaining limits

The unchanged release consumer fetched the actual public HTTPS feed. Installed Android identity fixtures1,2,3,4 each selected5; installed5 selected no update. The consumer source exactly matches the source inside published APK3 and APK4. No emulator/device identity was queried. Older real ILBI installs can check on signed-in foreground entry and every15minutes while active, or manually through Menyu → Yuklab olish → Yangilanish → Yangilanishlarni tekshirish. The reminder is inside the app, with dismissal scoped to account, installed/offered build and Tashkent business day. Android installation still requires the owner's action; a GitHub push does not silently replace installed code.

The isolated actual Chrome/Metro regression passed category/product CRUD, archive/restore/delete, negotiated-price isolation, sidebar/persistent tabs, dark mode,320px layout and Fast Refresh. Its source edit was restored and only its owned preview process was stopped. Screenshots are explicit synthetic browser previews, not screenshots of an upgraded native installation.

[Corrected-source CI](https://github.com/Abdulxadiy/ilbi/actions/runs/40559128158) passed all seven functional/platform dependency jobs, including mobile; two desktop jobs skipped. The separate mobile-dependency-security gate still fails on the existing three high Expo/CLI/Zod dependency entries. It was neither suppressed nor forced through an SDK downgrade. The overall CI is therefore not green; see DEPENDENCY_SECURITY.md. Channel remains preview.

No emulator/ADB query, app installation/restart/reset, real account/avatar mutation, financial write, live push, sender-key upload, iOS build or blanket parity completion is claimed. The existing emulator and its installed data were left for the owner to observe. Main was not merged; the separately documented reviewed-backend/main-deployment boundary still applies.

Evidence: [ui-release-build5-2026-10-27](evidence/ui-release-build5-2026-10-27/), including rejected-attempt history, clean signed manifest, native permission/class checks, corrected-source CI, local merge, server activation, full HTTPS download and source consumer results.
