# Backend-only activation

`deploy_mobile_backend.py` activates an already loaded, reviewed backend image. It does not pull/tag images, publish an APK, merge a branch, modify Compose/frontend/bot/version files, or copy/print backend credentials. Run it as the owner of `/srv/ilbi/.env.production` and the private backup files, with Docker access.

The operator must first verify the exact CI artifact/config ID and OCI revision, restore a recent encrypted backup into isolated Docker resources, and rehearse the candidate's migrations there. An immutable repository rename is allowed through the explicit reviewed image reference/config ID; the image is never retagged to match the old repository.

Create an owner-only JSON report from the **actual** rehearsal results, outside `/srv/ilbi`:

```json
{
  "image": "ghcr.io/owner/ilbi/backend:sha-<40-character-reviewed-commit>",
  "image_id": "sha256:<64-character-CI-Docker-config-ID>",
  "previous_image": "ghcr.io/owner/previous-repository/backend:sha-<40-character-current-commit>",
  "archive": "/srv/ilbi-backups/<actually-restored-archive>.tar.gpg",
  "archive_sha256": "<actual-archive-SHA256>",
  "restored": true,
  "migrations_verified": true
}
```

The report is an explicit operator handoff, not automatically generated proof. Do not set success flags before performing the rehearsal. Both report and archive must be regular, owner-only files. The supplied hash is compared to the archive's actual bytes.

Run the read-only preflight first; replace every placeholder with the reviewed values:

```bash
python3 /srv/ilbi/ops/deploy_mobile_backend.py --root /srv/ilbi \
  --image '<exact-reviewed-CI-image-ref>' \
  --expected-current-image '<exact-current-image-ref>' \
  --expected-image-id 'sha256:<exact-CI-config-ID>' --plan
```

Run the same command with `--activate --rehearsal-report /absolute/private/rehearsal.json` instead of `--plan` only after the rehearsal is complete. `--log-directory` can select an owner-only directory outside `/srv/ilbi`; its default is `~/.local/share/ilbi-deployments`.

Activation holds the existing `.operations.lock`, repeats drift checks, stops currently running backend writers and bot, and calls the existing encrypted backup tool for a fresh final snapshot. It atomically changes only `ILBI_BACKEND_IMAGE` in the root environment file (mode 0600). A named/labelled one-off container runs migrations with a 10s lock timeout and 120s statement timeout. Only originally running backend services are recreated with `--no-deps`; the unchanged bot container resumes if it was running. The helper checks backend health and image IDs and preserves initially stopped services.

On failure, the helper stops only its own migration container and known writer services, restores the previous loaded backend image reference, and restores prior running states. **It retains additive schema/migration records and all backups.** It never restores a database backup over newer business transactions or reverses/drops receipt tables. If rollback cannot complete, it stops with a controlled message requiring operator attention; inspect private logs and actual container state before further actions.

Root deployment work still owns public HTTP/API readiness checks, Nginx configuration checks, private FCM activation and delivery acceptance, and APK publication. Local safety tests use synthetic files and a Docker model; they do not constitute a live deployment or actual native/push acceptance.
