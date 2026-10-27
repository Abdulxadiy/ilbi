# Mobile UI release — Android build 5, 2026-10-27

Status: verification in progress; not yet a published release. The owner requested meaningful separate commits, GitHub pushes and server publication, while preserving the existing emulator/installed app for their own update observation.

## Store and category UI

The owner's store-selection cards retain explicit store selection and access-refresh/logout actions. Category cards add a bottom-sheet action menu and retain parent navigation, product browsing and permission-gated editing. The existing gate/category tests and new selected-category action-menu regression passed in the actual Jest run (five targeted suites, 34 total tests including the image work); this is source-level UI coverage, not installed-device acceptance.

## Image upload corrections

The owner added SDK-compatible image selection, product/variant cards, avatar controls and sidebar avatars. Review found an unused icon that failed zero-warning ESLint and a product image action targeting gallery creation instead of main-image replacement. Main-image replacement now uses the existing multipart product PATCH without sending prices or variant fields. Picker/upload state is locked against duplicates and bound to the initiating authenticated account/server/store, with permission checks repeated before mutation. Profile upload/delete use the existing avatar endpoints. The image-picker plugin declares photo usage and disables unnecessary microphone/camera permission additions.

Targeted image tests cover the native multipart append arguments, denied access, cancellation, invalid selection, changed account/store during asynchronous selection, the product PATCH contract, avatar upload/delete and read-only catalog controls. The first test attempt incorrectly assumed Node's FormData had React Native's getParts method; it failed and was corrected to inspect actual append arguments. No native execution is claimed by these mocked selector/API tests.

## Assembled source checks

`npm ci` completed from the lockfile; TypeScript and zero-warning ESLint across src and tests passed. All **518 tests in 62 suites** passed; 24 Python build, signature/source-provenance and publisher safeguard tests passed. Selector/API tests are synthetic; no production account/photo mutation was used as a probe. The dependency advisory and native-device gates from the prior release remain explicit.

## Packaging and publication

Android versionCode advances from 4 to 5 so existing installations can identify a newer native package; the signing identity is retained. Assembly/publication remain pending at this checkpoint. Mobile marketing version remains 1.0.0; platform remains 1.4.0; iOS build remains 1. A new immutable Android native build is required after published build 4. Existing APKs must remain byte-for-byte unchanged. No emulator/ADB interaction, main merge, frontend/backend/bot restart, push activation or iOS build is part of this UI publication.
