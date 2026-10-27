# Mobile cashbox and shifts — 2026-10-27

Status: **source/API tested; production deployment and native acceptance pending**. The owner's existing emulator and application data were untouched. Platform1.4.0 / mobile1.0.0 marketing versions remain unchanged.

The sidebar's **Kassa va smena** opens the actual current shift, opening and expected UZS/USD cash, cash/card/debt sales, collected debts, refunds, additional income and expenses. Income/expense lists use actual server pagination. Shift opening carries the last report identifier; cash entries carry the observed open-shift identifier; closing carries the exact shift and counted cash. Forms attach local and backend errors to their input fields. Close forms reread changed totals and require another explicit confirmation. Historical Z-report read/share remains in Reports.

Each operation has a per-dialog UUID and durable original-key journal. The client proves `/cashbox/capabilities/` before writing: old servers remain readable with write controls withheld. Backend `CashboxMutationReceipt` atomically binds the key to actor, tenant, kind and normalized payload under the existing tenant→shift lock order. A duplicate returns the saved result before stale-shift validation; changed actor/payload is rejected. Optional fields preserve legacy web/desktop behavior.

The client verifies the original acknowledgement, actor/store, exact amount/currency or opening/closing counts before local confirmation. Unknown results freeze the original payload and retain the journal; a later 4xx cannot reject an earlier unknown write. A server-accepted/local-storage failure offers a local-only acknowledgement retry. Completed callbacks cannot start another operation. Shared Sync uses the original payload/key. Reusable income sources and expense categories, including custom names and removal, are stored per server/account/store on the device, matching the desktop's local preference behavior.

Actual checks:

- **45 mobile tests / four suites passed:** durable identity, cashbox commands, actual screen interactions and active-store permission routing. Covers old-server gating, mismatched key/actor/store/amount/currency, unknown-result replay, exact cents, local-only acknowledgement, blank counted cash/red fields, frozen drafts, queued completed callback and category isolation.
- **12 actual PostgreSQL tests passed:** current existing cashbox tests plus keyed income/expense/open/close, exact USD replay once, same-key concurrency, stale shift/report rejection, changed payload/actor, legacy callers, tenant isolation and receipt-failure rollback. Closing rollback preserves the open shift and unlinked income and removes its report/inbox/outbox effects.
- Whole-mobile TypeScript and strict cashbox/navigation ESLint passed. Ruff passed for cashbox serializers/URLs/views, schema, new mutation service/test/migration. A broader initial cashbox lint also found pre-existing old-migration/model/report-format line-length issues; it is not reported as a clean whole-backend lint.
- Exact transcripts: [cashbox evidence](evidence/cashbox-2026-10-27/).

Apply cashbox migration0006 and deploy the capability/API before enabling writes. Verify counted close, receipts/sharing, permissions and interrupted-network/restart recovery on the rebuilt signed Android/iOS app against that server. These source/database checks do not assert those native or production checks passed. Full desktop report layouts/printer adapters and additional register-list filter controls remain separate parity work.
