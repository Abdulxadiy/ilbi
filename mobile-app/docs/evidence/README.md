# Verification evidence

`implementation-*` records the current implementation checks. `review-*`, `phase1_*` and `full_test_suite_output.txt` are historical prototype/review outputs. A passing Android/iOS Hermes export is a JavaScript bundle check, not an installed native package test.

The current checkpoint has 176 passing Jest tests, strict ESLint with zero warnings, TypeScript checking, real isolated PostgreSQL/Django serializer/idempotency and receipt-tax checks, both native JavaScript exports and the interactive Docker phone regression. Current screenshots use explicit synthetic preview data.

The live audit ledger is authoritative for remaining work and external gates. Security findings are recorded separately in `../DEPENDENCY_SECURITY.md`; passing application tests does not resolve those findings.

Historical Docker/lint traces have terminal whitespace normalized for plain-text review. Their recorded outcomes are preserved.

- Resource mutation foundation (2026-10-25): `resource-invalidation-tests.txt` records 21 passing targeted checks across resource, pagination, client and checkout suites. New checks cover refresh after a confirmed related mutation, ignoring a response from an old store, denied writes, duplicate presses and an authentication change during a write. TypeScript and strict ESLint passed. These are automated code checks, not native runtime acceptance.

- DMP-020 (2026-10-25): category root/child browsing, server search/paging, currency inheritance, parent lookup recovery, explicit delete confirmation, permission-dependent controls and POS category filters. `category-tests.txt`: 14 targeted mobile checks passed, including a rejected deletion and failed parent fetch. `category-backend-tests.txt`: 36 isolated PostgreSQL category/catalog API/service tests passed, covering hierarchy and permissions. `category-browser.txt`: Docker/Chrome created a USD parent and child, followed the child filter through Router, deleted both and retained five tabs; other phone regressions passed. Strict ESLint and TypeScript passed. Native keyboard and screen reader acceptance remains separate.
