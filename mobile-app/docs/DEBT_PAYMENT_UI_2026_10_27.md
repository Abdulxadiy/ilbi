# Two-step debt payment UI — 2026-10-27

Status: **TESTED_CODE**, pending deployed API and installed-device acceptance. This checkpoint implements the UI for the [authoritative quote protocol](DEBT_QUOTE_PROTOCOL_2026_10_27.md); quote parsing and payment command/journal checks have their own tests and ownership.

The first action, **To‘lovni hisoblash**, reads the server quote without creating a financial intent or payment. The customer sees the actual amount applied to UZS and USD debt, remaining signed balances and the receiving store's exact conversion rate/source/date when conversion is used. USD can therefore repay UZS debt without an incorrect same-currency-only balance check. The second action, **To‘lovni tasdiqlash**, submits the confirmed quote token through the guarded payment command.

The receiving-store selector uses the current user's tenant memberships with `sales.record_debt_payment` permission and defaults to the active store. The server still checks the receiving store's owner, activity and permission. Amount, currency, payment channel, receiving store and note edits invalidate the visible quote and require a new calculation. No rate is guessed in the UI.

Each dialog retains its UUID and completion guard. Once a financial intent is recorded, the actual recorded payload, including its token, is frozen. Unknown-result retries use that original body and do not request a replacement quote. If the server has accepted the payment but local acknowledgement fails, retry is local-only. A synchronous accepted-record reference also protects callbacks queued before React updates the displayed button. Editing events queued before a submission are ignored while the operation is in flight or frozen. Closing a dialog invalidates queued callbacks for that dialog.

**16 rendered UI tests passed**. They cover read-only initial calculation, invalid amount/red input, USD 5 applied to UZS debt using an authoritative fixture, quote invalidation for all five editable fields, exact token/channel/branch/note submission, stale quote rejection, local-only acknowledgement retry including an old queued callback, frozen original-token retries, account changes and completed queued callbacks. The UI tests mock the quote DTO boundary; they do not duplicate accounting policy or claim that a mocked quote proves server correctness. The real quote/helper and PostgreSQL tests are recorded separately.

Whole-mobile TypeScript validation and strict scoped UI lint passed. Evidence: [UI tests](evidence/debt-payment-ui-2026-10-27/ui-tests.txt), [typecheck](evidence/debt-payment-ui-2026-10-27/typecheck.txt), [lint](evidence/debt-payment-ui-2026-10-27/lint.txt).

This checkpoint did not deploy an API, manipulate an emulator, make a real debt payment or claim native acceptance. Real Android/iOS confirmation/recovery and the deployed quote API remain release acceptance work.
