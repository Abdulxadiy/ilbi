# P00 — legacy B2B inbox destination

The sale service emits `b2b_transfer_request` with `/b2b`. The native target resolver now accepts that exact alias alongside `/sales/b2b/inbox/`. It continues to require a recognized B2B event type and keeps arbitrary links blocked. The real notification screen applies selected-membership permissions and navigates only after mark-read acknowledges success.

Before the change, the producer-shaped target and screen regressions reproduced three failures (seven other checks passed). After the fix, **524 tests in62 suites passed**, with TypeScript and strict source/test ESLint passing. See `checks.json` and the preserved red-phase log. These are component/domain checks using controlled API responses, not installed-phone or live-notification delivery evidence.

The existing emulator, production events, APK5 and versions were untouched. Native/release and push-delivery acceptance remain open in the permanent audit.
