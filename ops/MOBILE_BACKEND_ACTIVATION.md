# Backend-only activation

`deploy_mobile_backend.py` activates an already loaded, reviewed backend image. It does not pull/tag images, publish an APK, merge a branch, modify Compose/frontend/bot/version files, or copy/print backend credentials. Run it as the owner of `/srv/ilbi/.env.production` and the private backup files, with Docker access.

The operator must first verify the exact CI artifact, derive its **verified engine image ID**, check its OCI revision, restore a recent encrypted backup into isolated Docker resources, and rehearse the candidate's migrations there. An immutable repository rename is allowed through the explicit reviewed image reference/verified engine ID; the image is never retagged to match the old repository.

Image ID semantics depend on the Docker image store. A classic store can identify an image by its config digest; a containerd-backed store can expose the OCI manifest digest as `.Id`/`.Descriptor.digest`. These are different content-addressed objects and must be verified through their actual relationship. Before choosing `--expected-image-id`:

1. Verify the archive's SHA256 against the exact successful CI artifact.
2. Resolve the archive's OCI index/platform manifest and verify descriptor/blob hashes, the manifest's config reference and ordered layer chain. Validate the config's ordered `rootfs.diff_ids` against the extracted layers.
3. Compare the loaded image's configuration, OCI revision, user and ordered RootFS diff IDs with that verified archive. When the engine exposes the manifest digest, verify that its descriptor points to the already verified config/layers.
4. Supply the resulting **single exact engine ID derived from the archive**. Never copy an unexpected host `.Id` into the expected value solely to make a failed guard pass. Abort on any unexplained descriptor, config, layer, revision or loaded-ID mismatch.

The helper deliberately retains strict equality against the explicit expected ID; it does not accept a loose config-or-manifest allowlist and does not itself replace the operator's artifact verification.

Create an owner-only JSON report from the **actual** rehearsal results, outside `/srv/ilbi`:

```json
{
  "image": "ghcr.io/owner/ilbi/backend:sha-<40-character-reviewed-commit>",
  "image_id": "sha256:<64-character-verified-engine-image-ID>",
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
  --expected-image-id 'sha256:<exact-verified-engine-image-ID>' --plan
```

Run the same command with `--activate --rehearsal-report /absolute/private/rehearsal.json` instead of `--plan` only after the rehearsal is complete. `--log-directory` can select an owner-only directory outside `/srv/ilbi`; its default is `~/.local/share/ilbi-deployments`.

Activation holds the existing `.operations.lock`, repeats drift checks, stops currently running backend writers and bot, and calls the existing encrypted backup tool for a fresh final snapshot. It atomically changes only `ILBI_BACKEND_IMAGE` in the root environment file (mode 0600). A named/labelled one-off container runs migrations with a 10s lock timeout and 120s statement timeout. Only originally running backend services are recreated with `--no-deps`; the unchanged bot container resumes if it was running. The helper checks backend health and image IDs and preserves initially stopped services. After writer startup it retries the complete existing strict HTTP/dependency readiness probe for at most 60s, with 2s gaps and each command capped at 10s. The same bounded check applies after image rollback. A persistent failure still aborts activation or requires manual rollback attention; container-running status alone never passes readiness.

On failure, the helper stops only its own migration container and known writer services, restores the previous loaded backend image reference, and restores prior running states. **It retains additive schema/migration records and all backups.** It never restores a database backup over newer business transactions or reverses/drops receipt tables. If rollback cannot complete, it stops with a controlled message requiring operator attention; inspect private logs and actual container state before further actions.

Root deployment work still owns public HTTP/API readiness checks, Nginx configuration checks, private FCM activation and delivery acceptance, and APK publication. Local safety tests use synthetic files and a Docker model; they do not constitute a live deployment or actual native/push acceptance.

## Repeatable file-only CI image verification

Use `verify_mobile_backend_artifact.py` with the exact archive and metadata JSON downloaded from the successful, reviewed CI run. The metadata file is a trusted CI handoff; obtaining/authenticating that artifact and verifying any outer GitHub ZIP remain the operator's responsibility. Supply expected candidate/source/reference from the reviewed release, rather than reading them back from an untrusted file to satisfy the command.

```bash
python3 ops/verify_mobile_backend_artifact.py \
  --archive /absolute/staging/mobile-backend-image.tar.gz \
  --metadata /absolute/staging/mobile-backend-image.json \
  --expected-candidate-commit '<full-reviewed-candidate-commit>' \
  --expected-backend-source '<full-reviewed-backend-source-commit>' \
  --expected-image-reference 'ghcr.io/owner/ilbi/backend:sha-<full-reviewed-candidate-commit>' \
  --output /absolute/private/new-verified-identity.json
```

The verifier requires the current Docker export layout: one exactly tagged OCI manifest plus matching Docker compatibility metadata, linux/amd64, UID 1000, and raw uncompressed tar layers. It checks archive name/size/SHA against CI metadata; hashes every content-addressed blob; checks index→manifest→config, OCI revision/source, descriptor sizes, ordered layer hashes against config diff IDs, and Docker tag/final-layer mappings. JSON, member counts and total content sizes are bounded. Unsupported paths, extended headers, links, compressed-layer variants, ambiguous manifests and unexplained identity mismatches fail closed. It streams image bytes without extracting or loading them and outputs only selected identity data, never full Config/Env or credentials. `--output` creates a new owner-only file and refuses to overwrite an existing identity record.

The result separates `portable_config_digest`/`classic_expected_image_id` from `containerd_expected_image_id` (the verified exported OCI manifest). It records the published registry digest separately because re-exported manifest bytes can have a different digest. The verifier does not treat these digests as interchangeable and does not accept an arbitrary host ID.

Before live activation, separately compare the loaded host image's full Config and ordered RootFS diff IDs with the verified archive, including the engine's descriptor semantics. That operator check remains mandatory: a successful file-only result reports `loaded_host_verified:false`, `archive_extracted:false` and `server_modified:false`. Pass only the one archive-derived engine ID applicable to that verified host into the activation helper.
