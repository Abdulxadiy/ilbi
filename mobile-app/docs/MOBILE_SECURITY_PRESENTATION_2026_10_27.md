# Mobile credential presentation — 2026-10-27

The owner identified the Downloads screen as the place showing SHA256. That value is the APK's public integrity checksum, not a password hash. Ordinary download cards now show platform, version/build, size and the download action without a raw digest. Release-feed validation, native updater verification, artifact manifests and signing identity are retained.

## Security boundaries

- HTTP failures are sanitized before constructing `ApiError.message` and `.data`. Request-local password/token values are masked even if a malformed server response echoes them without a recognizable key. The values are not attached to an Error, persisted or logged. Successful authentication responses and outgoing credentials are unchanged.
- Shared system alerts, retry errors, toasts, validation fields and accessibility error hints mask recognizable credential hashes, JWTs, authorization values and private debug dumps. Editable password fields retain useful validation guidance and red error states.
- History detail rendering also redacts legacy credential-shaped audit fields. Public checksum/certificate fields, financial amounts and valid operation/idempotency identifiers remain intact. The display boundary does not change original requests, saved financial payloads or immutable audit records.
- The normal Sync list no longer prints a full internal operation key. Original keys, payloads, scope checks and reconciliation remain available internally.

This is a defensive display boundary, not a claim that every arbitrary free-text string can be classified as a secret. Chat messages, product names and ordinary business content are not globally rewritten. The separate backend review records the confirmed support guest-verifier exposure and protected-edit fixes; it did not establish an ordinary account password/hash disclosure.

## Executed checks

The assembled mobile source passed **507 tests across 61 suites**, whole-project TypeScript and zero-warning ESLint. Regression tests exercise known request-secret echoes, raw credential error dictionaries, secure-input accessibility hints, historical nested credential rows, public checksums, 64-character financial IDs and unchanged successful credential exchange. All fixture credentials are synthetic.

Actual isolated host-Chrome login and financial-flow evidence is recorded with the assembled readiness checks. These browser checks use synthetic data and do not constitute native device or production-server acceptance. The owner's existing emulator and installed app were not accessed or modified.
