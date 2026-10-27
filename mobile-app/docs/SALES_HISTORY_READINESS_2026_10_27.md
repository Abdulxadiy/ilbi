# Sales history and cancellation readiness — 2026-10-27

Status: **TESTED_CODE**, pending migration/deployment and installed-device acceptance. This is an implementation checkpoint, not a claim that every desktop/mobile parity finding is closed.

## Implemented behavior

- The dedicated sales history screen uses authenticated, tenant-scoped backend pagination, search, status, payment type, UZS/USD and calendar-validated date filters. An authorized customer picker sends the selected customer ID; customer labels are not sent as query parameters. Opening a saved sale re-reads its details, remaining/refunded totals, item quantities and receipt data.
- Full cancellation and fractional item returns require the existing view/cancellation permissions and a nonempty reason. An ordinary return cannot process a B2B transfer. New partial returns re-read the available quantity before creating a journal entry. Existing seven-day/backend shift rules remain authoritative.
- Each return dialog has its own UUID. Its immutable local operation and original idempotency key survive unknown-result retries; a later intentional return opens another dialog. A completed dialog cannot create another return through a queued callback. Older fixed-ID journals remain readable by reconciliation.
- The client checks `/sales/capabilities/` before journalling or posting a cancellation. An older server leaves sales reads available and financial controls disabled. A response must acknowledge the original key, actor, tenant, sale, optional item, reason, quantity and result before the local intent can be confirmed.
- The additive `SaleVoidRequest` migration `sales.0020_sale_void_request` records an actor/payload-bound receipt in the same transaction as stock, refund and debt effects. Tenant-first row locking serializes same-key requests. Replay returns the original receipt even if the sale was subsequently fully returned; it never repeats financial effects.
- A response lost after a possible write stays pending. A later replay rejection cannot prove that the original request failed, so the pending journal is retained. If the server accepted a return but saving the local acknowledgement failed, the dialog retries only that local acknowledgement.
- The shared synchronization screen dispatches sale returns, inventory operations and cashbox operations to their verified domain reconciliation functions. It retains the original stored payload and key instead of constructing a replacement financial operation.

## Executed verification

- **28 mobile tests passed across four suites**: return commands, sales history/components, synchronization screen and actual durable-journal reconciliation. Coverage includes older-server gating, invalid dates/reason, exact `1.250` quantity, stale account/tenant acknowledgement, local acknowledgement failure, unresolved-result preservation, UUID/legacy journals, completed-dialog callbacks, immutable retry inputs and shared inventory/cashbox original-key routing.
- **33 actual Django/PostgreSQL tests passed**: `apps/sales/tests/test_mobile_sale_void.py`, `test_void_service.py` and `test_receipt_taxes.py`. These exercise actual ORM/service/API transactions, seven customer-filtered sales across four pages and opening the older detail, same-key concurrency, one stock/refund/debt effect, altered payload/actor rejection, tenant permissions, distinct intentional partial returns, replay after later full void and transaction rollback when receipt persistence fails.
- Whole-mobile TypeScript validation passed. Strict lint passed for the sales and shared-sync implementation/tests with zero warnings.
- Evidence: [mobile tests](evidence/sales-history-2026-10-27/mobile-tests.txt), [real backend tests](evidence/sales-history-2026-10-27/backend-tests.txt), [typecheck](evidence/sales-history-2026-10-27/typecheck.txt), [strict lint](evidence/sales-history-2026-10-27/lint.txt).

The first backend rerun used two nonexistent test filenames and collected no tests; the command was corrected to the actual filenames above before the successful run. An intermediate shared-sync test fixture used a numeric tenant scope where the client type requires a string; it was corrected before the final typecheck. These failed attempts are not counted as successful checks.

## Required release acceptance

Deploy the additive migration and capability API before enabling financial writes in the new client. Validate real full/partial returns, business permissions, interrupted network/restart recovery and receipt sharing on installed Android/iOS builds against the deployed API. The existing owner emulator and its app data were not modified for this checkpoint. No native cancellation acceptance or server deployment is claimed by these tests. Public receipt-token rotation and the remaining document/export parity requirements have their own outstanding acceptance work.
