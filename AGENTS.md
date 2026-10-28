# ILBI execution principle

Implement → test → record actual evidence → advance. The owner explicitly requires this sequence for every task. Finish the current slice's checks and resolve its failures before moving to the next slice. Never report skipped, failed, mocked-only, or unexecuted native/server checks as passed.

For the mobile parity work, use `mobile-app/docs/DESKTOP_MOBILE_PARITY_AUDIT.md` and its live implementation ledger. Keep evidence and external acceptance gates explicit; do not remove financial, fiscal, permission or data-preservation safeguards to make a test succeed. Preserve existing user changes. Read more-specific directory instructions before editing.

Keep the platform version unchanged while adding the mobile app; the mobile package has its own version. The owner prefers no version bump, or only a small patch when a bump is necessary. Do not treat mobile client work as a new platform release.

For this parity implementation, split verified work into meaningful commits and push increments to the current working branch. Do not combine the entire implementation into one large commit. Release tags and platform publication are separate actions.
