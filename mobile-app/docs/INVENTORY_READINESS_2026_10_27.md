# Mobile inventory readiness — 2026-10-27

Status: implemented and source-tested. Production backend migration/deployment and installed-device acceptance remain open.

## Implemented behavior

The existing Inventory screen reads authoritative stock, movement and batch endpoints. A compact action menu opens separate real operations rather than modifying local balances:

- Multi-line intake (1–100 variants), exact quantities/costs, common supplier, invoice number, notes, per-line batch code and expiry.
- Customer return, supplier return, write-off and inventory correction with an explicit reason, independent endpoints and optional actual batch selection.
- Store transfer dispatch, paged status-filtered transfer list/detail, actual receipt quantities, destination variant/category mapping, shortage reasons, physical return shipments, and source-owner discrepancy closure. The closure screen explains that closure does not physically return goods.
- Actual batch dates, expiry filters (all/expired/soon/unknown/valid), quantities, protected supplier/cost values. Missing protected fields are not fabricated.

Drafts persist in the existing account/store/server-scoped record store. A restored unknown operation keeps its original immutable draft and idempotency key. Input edits remain frozen while the original result is unknown. Confirmed drafts do not acquire a fresh key on duplicate completion. If the server accepted a write but local acknowledgement failed, a dedicated button retries only the local acknowledgement.

## Server protocol and compatibility

Additive inventory migration `0014_inventorymutationreceipt` stores an actor-bound, tenant-bound, operation/route/payload fingerprint and resource IDs inside the same transaction as each keyed mutation. Concurrent copies share one receipt. Failed operations and failed receipt completion roll back stock, batches and movements together. Replays serialize the original resources with the caller's **current** supplier/cost visibility; receipt rows do not store a permission-dependent serialized response.

`GET /inventory/operations/capabilities/` advertises `ilbi-inventory-idempotency-v1`. Mobile proves that capability before creating a new journal or sending stock-changing requests. An old server therefore receives no unsafe optimistic write. Legacy web/desktop requests without `idempotency_key` keep their existing service contract. `GET /inventory/operations/transfer-options/` exposes only permitted mapping data; other-store categories are hidden from staff.

The shared financial journal uses separate pending-operation locks for sale, inventory, void, cashbox and B2B domains. Unique inventory drafts permanently retain their original confirmed key. Existing Sync routing can reconcile inventory commands using their persisted payload and original key.

## Executed checks

- **61 actual PostgreSQL inventory ORM/API/service tests passed**, including 14 mobile protocol checks. Tests cover exact fractional quantities/cost/supplier, rollback, actor/payload conflicts, current permission redaction, same-owner delivery, staff partial receipt, discrepancy closure, physical returns, concurrent identical writes, and receipt-write failure rollback.
- **48 mobile tests passed across four suites**: inventory commands, forms/batch picker/expiry filters, shared financial identity, and core API screens. These are source-level tests with HTTP mocked in mobile tests; the backend checks above use actual Django ORM/API requests.
- Whole mobile TypeScript check and strict lint of owned inventory source/tests passed.

An initial broad backend run exposed an order-sensitive test fixture: migration rollback tests can leave older permission seeds without `inventory.view_supplier`. The new permission-redaction test now explicitly creates its required permission fixture, as existing supplier tests do. The full 61-test inventory rerun passed. Initial form tests also needed to await completed asynchronous validation before typing again; the final run has no React act warnings.

Evidence: [inventory-readiness-2026-10-27](evidence/inventory-readiness-2026-10-27/).

## Remaining acceptance

No production financial records were mutated. No owner emulator was installed, reset or controlled. No native Android/iOS inventory acceptance or production backend rollout is claimed here. Deficit report delivery, spreadsheet imports/exports and unrelated catalog/customer features retain their separate audit status. This document supplements the parity audit; it does not mark every inventory or platform finding complete.
