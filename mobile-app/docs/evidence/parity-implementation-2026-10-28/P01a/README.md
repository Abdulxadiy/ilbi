# P01a — employee directory and permissions

Native owner/admin routes now provide tenant-scoped paginated search and active/inactive/archive filters, hiring, editable contact/profile/position, server-derived permission choices and seven presets plus all-assignable/clear controls. All mutations retain the real API authority. Owners use the explicit selected-tenant header; platform admins select a target tenant. The sidebar entry keeps employee work off the five quick tabs.

Fire, invitation, block/unblock, archive and restore require an explicit confirmation; reasons are required by their API contracts. Restore does not rehire. Invitation-dispatch failure is reported separately from successful hiring. Self/protected rows fail closed using server action flags; selected-account/store/server changes discard forms and late results. Uncertain/malformed write replies require an explicit successful directory refresh before another mutation. No account passwords, hash or opaque fields enter the directory model.

Verification: **544 mobile tests /63 suites**, TypeScript and strict source/test ESLint pass. **48 actual backend tests** pass against a new isolated PostgreSQL/Redis instance and in-memory mail (8 Django email-setting deprecation warnings). The contract test captures actual hire/list/edit/block/unblock/fire/archive/restore response shapes in `tests/contracts/employees.json`, consumed by mobile tests; thin hire/fire replies are covered. Ruff and diff checks pass.

An initial asynchronous screen test timed out because its awaited button helper waited for the deliberately delayed response. The test now starts the request, switches stores, then resolves the old response and verifies no old-form/success state appears. The final suite passes; no timeout was hidden by increasing its budget.

These are controlled component and real local database/API checks. Installed Android/iOS behavior, actual mailbox delivery and native screen acceptance remain open. P01b separately implements invitation/reset link onboarding. Production, versions and the existing emulator remain untouched.
