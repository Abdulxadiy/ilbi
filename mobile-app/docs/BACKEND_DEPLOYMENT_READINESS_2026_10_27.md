# Backend and mobile deployment readiness — 2026-10-27

**Current status: the approved backend and Android APK build4 rollout is complete; native and wider parity acceptance remain open.** Production backend/worker/beat run `ghcr.io/abdulxadiy/ilbi/backend:sha-f67d770fd404721d6117db1d7729cf0d09a771e7`, API source `d35ea11043affab1671172f42e27d367033232a1`. Its exact CI passed1,165 tests; all15 authenticated public-HTTPS GET checks passed after activation, all required mobile handlers are ready and no migrations remain. The legacy support contact-save envelope works without restoring protected identity edits. APK build4 remains publicly available from clean source3640170, with its complete77,531,797-byte HTTPS download verified; older APK/non-mobile feed entries were preserved.

The authoritative final record is [PRODUCTION_ROLLOUT_2026_10_27.md](PRODUCTION_ROLLOUT_2026_10_27.md), including the earlier unsuccessful attempt, safe image rollback, verified retry, compatibility follow-up and cleanup. Final candidate `f67d770` and its [manual CI run](https://github.com/Abdulxadiy/ilbi/actions/runs/40531758799) are **deployed and runtime-verified**. The APK bytes were unchanged by the server-only follow-up. PR3 remains unmerged; integrate its reviewed backend changes before the next ordinary main CD rollout.

Push remains disabled, the FCM sender key is absent from production, no live notification was sent and the owner's existing emulator remains untouched. Native device/FCM acceptance, the unresolved mobile toolchain advisory and advanced/fiscal parity gates remain open. Platform version is1.4.0 and mobile marketing version1.0.0. **The sections below retain the historical pre-approval inspection/preparation evidence and the reusable activation guidance; their “not deployed”, old-image and approval-pending statements describe those earlier checkpoints, not the current live state.**

## Historical production state — initial pre-approval inspection

Production is `/srv/ilbi`, with backend environment file `/srv/ilbi/ilbi/.env.production`. It has no application Git checkout to pull. The live Compose file retains the original `./ilbi` backend layout. Copying the feature branch's `./backend` Compose file onto it would point at the wrong environment path.

At that initial inspection, all three backend processes ran this existing image:

```text
ghcr.io/abdulxadiy/sales-platform/backend:sha-2d799dd5596a92fb6a0e3be6cf51a2a018c88e2d
```

The frontend and bot used that same commit under `sales-platform/frontend` and `sales-platform/bot`; those frontend/bot images are preserved by the later backend-only rollout. The initial Django check reported 6.1.2, matching the frozen dependencies used by the new tests. Backend readiness returned `ready`; Nginx configuration validation passed. Backend/worker/beat ran as UID/GID 1000. Worker concurrency was one, and a separate Celery beat process already ran.

At that historical checkpoint the push app, FCM configuration and push dispatch schedule were absent. Registration/revoke, safe sale/inventory/cashbox/B2B capability handlers, guarded debt quotes, the store-settings revision field and notification-detail **GET** were absent. The old detail URL resolved for other methods, so route resolution alone must not be treated as GET compatibility. Existing analytics, profile and current-store APIs were present. These initial route/migration observations were superseded by the successful rollout checks linked above; FCM remains disabled.

The initial applied migration heads included cashbox `0005`, inventory `0013`, sales `0019`, core `0016`, support `0003` and tenants `0014`. Historical sanitized evidence is [production-readonly.json](evidence/backend-deployment-readiness-2026-10-27/production-readonly.json).

Recheck without logging in, registering a device or writing to the server:

```bash
python3 ops/check_mobile_backend_readiness.py \
  --ssh-target ubuntu@3.106.193.2 \
  --identity-file /mnt/storage/Codes/aws_keys/ilbi-prod.pem
```

`--require-ready` returns a nonzero exit when the required mobile handlers are absent. The probe reads the migration table in a read-only database transaction and reports configuration booleans, never environment contents, credentials or tokens. It does not establish native delivery or authenticated business acceptance.

## Historical candidate preparation, without the layout refactor

`ops/prepare_mobile_backend_candidate.py` creates a separate local worktree from production commit `2d799dd5596a92fb6a0e3be6cf51a2a018c88e2d`. It overlays only committed backend `api/apps/config/tests` differences into the original `ilbi/` directory. The original frontend, bot, desktop, platform version, Dockerfile, entrypoint and dependency lock remain unchanged. Unknown runtime/dependency changes, deletions, symlinks and an existing destination cause an explicit failure. Uncommitted source, `.env` files and `firebase-keys` are never copied.

Run against the final verified source commit, using a new destination:

```bash
python3 ops/prepare_mobile_backend_candidate.py \
  --base 2d799dd5596a92fb6a0e3be6cf51a2a018c88e2d \
  --source 38aa63dccce8831ecf32b296f3a7e913980ec7cd \
  --destination /mnt/storage/.cache/ilbi-mobile-backend-candidate/review-38aa63dc
```

The generated `ops/mobile-backend-candidate.json` records immutable base/source commits and a SHA-256 for each overlaid backend file. Review `git diff` inside that worktree. Then run the actual backend suites from its `ilbi/` directory with the frozen test environment and a dedicated PostgreSQL test database. A candidate must be regenerated when source changes; do not label an older snapshot as final.

The reviewed pre-publication candidate was **`5719bc10d1978a9b2a1eba8ed7240fc19a20ea84`** on branch `mobile/backend-api-readiness-20261027`, in [PR #3](https://github.com/Abdulxadiy/ilbi/pull/3). It preserves the first reviewed candidate `9683b9745d8e901707dc37eb1f6a94a20f0b6b5e` and adds a separate security commit. Its immutable backend source is **`38aa63dccce8831ecf32b296f3a7e913980ec7cd`**. The local worktree retains its original historical directory name, `/mnt/storage/.cache/ilbi-mobile-backend-candidate/final-9a025e0c`; its commit and manifest, rather than that directory suffix, identify the source. Publication candidate `a91777a` changed only publication CI and retained the exact tested backend tree; subsequent candidate/runtime identities belong to the rollout record.

All **538 compared** committed backend files match the current source byte-for-byte; three deliberately retained nonruntime example/document files are excluded. The candidate overlays 78 changed backend files plus two public cross-client wire-contract fixtures. The security update changes ten backend files and the manifest relative to the first candidate. Frontend, desktop, bot, platform version, the base production Compose file, dependency lock, Dockerfile and entrypoint remain unchanged from the production base.

The normalized current candidate passed **1,147 actual non-Docker tests**, on isolated PostgreSQL and real volatile Redis 7.4.11, in one 64-second run. Exactly five Docker-dependent readiness/shared-throttle cases were explicitly deselected locally because this host has no running Docker daemon; they are not counted as local passes. Fatal-error Ruff, strict API schema validation and migration drift checks all exited successfully. The isolated Redis instance on port 56446 was then stopped; shared PostgreSQL and the owner's emulator were preserved.

The exact current candidate's [backend CI job](https://github.com/Abdulxadiy/ilbi/actions/runs/40506323968/job/122196421025) passed **all 1,152 backend tests** in 133.64 seconds, including all five Docker integration cases, plus frozen dependency setup, fatal-error Ruff and strict schema validation. The [candidate workflow](https://github.com/Abdulxadiy/ilbi/actions/runs/40506323968) succeeded: all six executed jobs passed; its two desktop platform jobs were skipped and are not counted as passes. This minimal candidate contains only public mobile wire fixtures, so its dependency/security result does not supersede the separate mobile runtime audit or native acceptance gates.

Current evidence is [security-candidate-local-checks.json](evidence/backend-deployment-readiness-2026-10-27/security-candidate-local-checks.json) and [security-candidate-ci.json](evidence/backend-deployment-readiness-2026-10-27/security-candidate-ci.json); the complete source manifest and local transcript are beside them. No CI result from an older commit is attributed to the current candidate.

The security update removes the internal support guest credential verifier from responses; constrains generic support edits to contact/store presentation fields; keeps protected identity/status changes in their existing secured workflows; sanitizes unexpected document/storage errors; and redacts credentials in new audit writes plus historical audit/history reads. Legacy `{field/key/label, value}` change records are covered. Public checksums, financial intent keys and benign security flags remain usable. The [backend security review](BACKEND_SECURITY_BOUNDARIES_2026_10_27.md) records the concrete findings; the download checksum itself was not a password hash.

### Historical baseline verification

The earlier backend source `9a025e0c5a475a8b9d667b7a768b6d457fe1852a` had 536 compared backend files, 72 changed backend overlays and two public fixtures. Its [backend CI job](https://github.com/Abdulxadiy/ilbi/actions/runs/40485416751/job/122125862461) passed **1,126 tests**, frozen dependency setup and strict API schema validation, including the five Docker cases. Other jobs in that source workflow failed; it is not reported as globally green. The first normalized candidate `9683b97` then passed its own [candidate workflow](https://github.com/Abdulxadiy/ilbi/actions/runs/40489385359): all six executed jobs passed, with the two platform desktop jobs skipped, not counted as passes.

The earlier local normalized snapshot passed 1,121 non-Docker cases in two runs: 1,082 initially and 39 remaining cases separately. Its original logs/manifests are retained as historical records rather than overwritten with the current candidate identity. Verification had resolved missing public wire fixtures, actual `settings_revision` fixture drift and a missing isolated Redis service. These earlier failures are not reported as successful checks. Official Redis source integrity was verified before the private-cache build; no privileged host service or production Docker was used.

Four preparation-tool tests passed: committed-source isolation and unchanged web, private-file exclusion, dependency-change rejection, existing-work preservation and deletion rejection. The test fixtures create temporary local Git repositories; they do not alter the application's commits.

The candidate additionally contains an optional-override-aware `ops/compose.sh`, the inactive FCM template and the read-only probe. The current repository's and production server's Compose wrappers are not changed by preparation. The candidate wrapper retains the original base Compose file and includes `docker-compose.mobile-push.yml` only after that activation file is separately staged. This prevents a later ordinary deployment from accidentally dropping an approved secret mount.

## Backend compatibility and migrations

The minimal backend change contains these new durable contracts:

| Slice | Migration / activation requirement |
| --- | --- |
| Push registry and outbox | `notifications.0001_initial`, `notifications.0002_pushevent_push_event_expand_idx`; migrate before new notification writers start |
| Safe sale returns | `sales.0020_sale_void_request`; optional keyed calls retain legacy web/desktop contracts |
| Safe inventory operations | `inventory.0014_inventorymutationreceipt`; capability proof precedes mobile writes |
| Safe cashbox operations | `cashbox.0006_cashboxmutationreceipt`; original shift/report guards and actor-bound replay |
| B2B operations | `sales.0021_b2bmutationreceipt`; preserve physical-return and owner-only discrepancy rules |
| Store settings | Actual `settings_revision` validation and optimistic section updates; no new database migration |
| Guarded debt payments | Actual cross-currency quote/commit protocol and locked no-new-credit guard; no new database migration |
| Support/workspace events | `core.0017_workspacereminder_due_notified_at`, `sales.0022_alter_notification_type`; 60-second due-reminder beat task |

The exact final `migrate --plan` is the authority. Review its SQL and forward dependencies; do not reverse financial receipt migrations during ordinary rollback. Existing rows and old client requests remain usable. New clients intentionally block unsafe writes when an old server lacks the capability contract.

The image entrypoint already runs `migrate --noinput` before Gunicorn. The existing deployment helper takes an encrypted backup with active writers stopped, resumes them, switches commit-pinned images and waits for health. Ensure all new web/worker/beat images use the same candidate before turning on push. An old worker can still create an ordinary inbox row during transition; no push backfill or exactly-once OS presentation is claimed.

## Historical pre-approval rollout plan — approval later granted and rollout executed

At this pre-approval planning checkpoint, the appropriate candidate image build context was the reviewed candidate worktree's **`ilbi/`**, target `production`. Its overlay was committed and pushed as `5719bc10d1978a9b2a1eba8ed7240fc19a20ea84`; the worktree was clean. No candidate image had yet been built/published and no tag was claimed at that checkpoint. The later publication/activation used the separately recorded `a91777a` image and exact digest. A release image must retain its reviewed candidate identity; do not label it as the old production commit or the mobile APK's separate source commit.

A backend-only rollout can use the existing `/srv/ilbi/ops/deploy_release.sh` with the new candidate backend image and the **currently deployed** frontend/bot references above. It accepts three commit-pinned GHCR references, backs up and checks health. This preserves the actual frontend/bot images instead of using the feature branch's unrelated platform layout. Preserve the current root Compose file and backend environment path. Review/install only the minimal candidate operations files; do not rsync the whole feature checkout onto production.

No new main merge is needed merely to publish an APK. The ordinary deployment workflow runs only after successful `main` CI, so pushing the mobile feature branch updates GitHub source, not the server or installed packages. APK publication, backend rollout and FCM activation are three distinct operations. The installed APK requires an explicit package update; GitHub pushes do not replace it.

The original plan required recording the three image references, public release feed, planned migrations and a verified encrypted backup/restore path before a live change, plus confirming candidate/rollback image access. The initial read-only inspection did not create a backup or test a restore. The later stopped-writer encrypted backups, isolated restore rehearsal and immutable image checks are recorded in the rollout document.

The original plan required post-rollout container readiness, Nginx, migration-head/method-handler checks and authenticated read-only profile/history/report/inbox/capability contracts; the successful activation and all 15 HTTPS checks are recorded separately. Use an authorized test account/store; do not create financial test transactions in an owner's live store as an incidental health check. Source/ORM tests are not a substitute for authenticated production checks.

## FCM secret and worker activation

The private key is currently outside Git at `/home/abdulxadiy/.local/share/ilbi-push/firebase-service-account.json`. It was not uploaded to the server. The public Android client configuration is included in the mobile source; the server private key must stay outside the image/build context, Git and public downloads.

The reviewed template is `ops/mobile_push.compose.yml`. After explicit activation authorization:

1. Stage the key at `/srv/ilbi-secrets/firebase-service-account.json` with a private parent directory and file mode `0600`, readable by container UID 1000. Verify project identity without printing contents.
2. Set the root Compose variable `ILBI_MOBILE_PUSH_ENABLED=False`. Stage the reviewed template through `/srv/ilbi/docker-compose.mobile-push.yml`, and use the candidate's override-aware wrapper. Backend and worker receive `FCM_PROJECT_ID=ilbi-80eb1` and `FCM_SERVICE_ACCOUNT_FILE=/run/ilbi-secrets/firebase-service-account.json` through a read-only bind mount with `create_host_path:false`. Beat needs the schedule, not the sender key. Keep the existing Django signing secret stable and identical in backend/worker so encrypted installation tokens remain readable.
3. Recreate only the approved backend/worker/beat services. Check that their images match, web/worker can read the mounted file, registration reports `delivery_enabled:false`, and the worker knows the dispatch task. Never print fully interpolated Compose/environment output, private JSON or provider tokens.
4. Install the rebuilt signed APK in an expressly approved isolated native test environment. Check explicit OS permission, native FCM token registration and account/store binding. The owner's existing emulator must remain untouched.
5. Only after the deployment/native gates pass, authorize enabling `ILBI_MOBILE_PUSH_ENABLED=True` and recreate the relevant services. Verify one expressly authorized test event through foreground/background/ordinary-closed delivery and tap, plus denial, mute, account/store change and logout cleanup. Do not claim delivery from OAuth or validation-only provider responses.

Push delivery reuses existing inbox events; it does not repeat sales, stock writes or reports. The task runs every 30 seconds and retries transient provider failures from a durable outbox. At least-once transport can race offline logout or retry presentation; generic lockscreen payloads omit private business/message text and taps reauthorize.

## Rollback

First disable push and stop the candidate worker/beat if its behavior is uncertain. Preserve the outbox/receipt tables and original financial intent keys. Restore the recorded old image references using the reviewed deployment procedure, then verify web/worker/beat and readiness. Retain additive tables; the old image ignores them and the mobile capability gates prevent unsafe fallback writes. Never restore the database over newer accepted customer transactions as an ordinary image rollback. A database restore requires its own explicit recovery decision and reconciliation.

The historical inspection/preparation represented above did not itself alter the server, merge branches, upload the private key, publish an image/APK or send a notification. The owner subsequently approved the backend/APK release, which was executed and verified as recorded in [PRODUCTION_ROLLOUT_2026_10_27.md](PRODUCTION_ROLLOUT_2026_10_27.md). Native device acceptance, actual FCM activation/delivery, the dependency advisory and advanced/fiscal parity gates remain open; the earlier deployment-approval gate is no longer pending.
