# Mobile backend and APK rollout — 2026-10-27

Status: IN PROGRESS. The owner explicitly approved “Backend va APK’ni chiqarish”. This extends the earlier APK-only approval to the reviewed backend. It does not authorize enabling push or touching the existing emulator; neither has been done.

## Immutable inputs

- Backend source: `38aa63dccce8831ecf32b296f3a7e913980ec7cd`.
- Original tested candidate: `5719bc10d1978a9b2a1eba8ed7240fc19a20ea84`.
- Publication candidate: `a91777a0b7908898d9359b5e24c3f1df5e1cb1b7`; only the manual backend-publication CI workflow changed. Backend tree `8a499ff8d9d2a9ee741287c37621bb8e9006759e` is unchanged.
- Manual workflow: https://github.com/Abdulxadiy/ilbi/actions/runs/40509782773 . All seven executed jobs passed, including1,152 backend tests and the backend image build/export; two desktop jobs skipped.
- Image: `ghcr.io/abdulxadiy/ilbi/backend:sha-a91777a0b7908898d9359b5e24c3f1df5e1cb1b7`.
- APK: `ILBI-1.0.0-android-4.apk`, clean source `364017038bedcbe20b0974a86fa75aeec29cd5ea`,77,531,797bytes; established signer unchanged. Its artifact/source checks are in PRODUCTION_READINESS_2026_10_27.md.

The platform version remains1.4.0 and mobile marketing version1.0.0. The existing frontend, bot, desktop packages and base production Compose are outside this backend/APK rollout.

## Verification and preparation

The private CI Docker archive was downloaded through an expiring read-only artifact URL; no GitHub credential was copied to production. Archive SHA/size, all28 content-addressed blobs, ordered13 layers and the OCI revision were verified before use. Classic Docker reported config digest `sha256:d707f2133280fec7fe329e2cd0d23512467adb2e276873f1535a7a3faa56f111`; production Docker29/containerd reports OCI manifest digest `sha256:62102671c771f78d0f4499ec422f4efb1d5b79dd74030b5a72b4b0e3563c1249` as image ID. The exact archive index→manifest→config/layer relationship and full loaded Config/ordered RootFS equality were verified. The expected ID was derived from that archive; no mismatch guard was bypassed or image retagged.

A fresh encrypted stopped-writer backup was verified and restored into new PostgreSQL16 resources with network=none. The candidate applied all eight expected forward migrations to that isolated restore with bounded lock/statement timeouts. Sale, debt-payment, counterparty and stock-movement row counts and all decimal aggregate totals were unchanged. No live financial test write occurred.

The first isolated rehearsal used Docker --env-file, which preserves quoted values differently from Compose; an EMAIL_PORT parse failed before migration. The rehearsal was corrected to use Compose-resolved environment values in process memory, with database/network/push isolation overrides. No production environment file or credential was changed to make the check pass.

Read-only activation preflights caught missing legacy OCI label keys. The Go template was verified on the actual server for both old and target images before proceeding. The activation helper retains exact image/revision checks and checks that the old image remains cached.

## First activation attempt

The first live attempt took another fresh stopped-writer encrypted backup, applied the eight additive migrations, and started the reviewed backend/worker/beat. Immediate standalone readiness then returned “not ready”; the helper restored the previous backend image and writer running states. The same immediate readiness call after rollback also failed, so it reported manual attention. Subsequent real Docker and Compose checks returned “ready” and the old containers were healthy. Additive schema and accepted business data were retained; no database restore or reverse migration was performed.

This first attempt is not counted as a successful release. The first post-attempt route/HTTP checks correctly observed the restored old APIs. The exploratory HTTP harness also used unsupported week/month/year parameters; it was corrected to the actual mobile/API values this_week/this_month/this_year before final acceptance.

A bounded readiness retry is being verified before the next activation. Final runtime, authenticated HTTPS, publication and download evidence will be appended after those actions actually pass. The APK release feed still points to build3 at this checkpoint.

## Verified first successful activation and APK publication

The bounded-readiness helper passed26 local safety tests plus eight subtests. The retry activation completed successfully at15:19:26UTC. Backend, worker and beat run the exact reviewed a91777a image; the frontend and bot retain their original image and the bot container identity. A new stopped-writer encrypted backup was taken immediately before activation. All eight migration heads are applied, no migrations remain, all required mobile route/method handlers resolve, and the store settings revision exists. Push remains disabled and no sender key is configured on the server.

All **15 authenticated public-HTTPS GET checks passed**, covering profile, memberships, current settings, four actual analytics periods, history, sales, inbox, current shift and sale/inventory/cashbox/B2B capabilities. The check used a short-lived access token held only inside the application process, with an already active owner membership, without logging credentials/customer data or issuing financial writes. No user password, login, MFA policy or persisted session was changed. Nginx configuration validation passed. This is API/runtime evidence, not native device acceptance.

APK build4 was published at15:22:33UTC. The public feed and legacy Android alias both advertise4. A full public HTTPS download of all77,531,797bytes matched the signed artifact hash; the previous build3 link/size and non-mobile/iOS feed entries remain intact. The new public file is https://ilbi.uz/downloads/mobile/364017038bedcbe20b0974a86fa75aeec29cd5ea/ILBI-1.0.0-android-4.apk . The owner's emulator was not accessed or changed.

## Legacy web support compatibility follow-up

Final source review confirmed that the deployed old support editor always submits unchanged email and role alongside contact fields. The first strict allowlist intentionally closed unsafe identity edits but also rejected that legacy envelope. Backend source `d35ea11043affab1671172f42e27d367033232a1` now strips only exact unchanged public-profile echoes, supplied against trusted server-side conversation-user context, when at least one contact field is present. It still rejects any changed identity, status, password, unknown field, guest or context-free use before a partial save; it never writes email or role. Contact-only update_fields preserves concurrent security changes.158 actual PostgreSQL tests, including13 new regressions, passed; no migration is introduced.

This compatibility follow-up is being verified in a new immutable candidate/image before the final rollout is marked complete. The APK bytes/build and published feed do not change for this server-only correction.
