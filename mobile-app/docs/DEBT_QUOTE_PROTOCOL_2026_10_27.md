# Authoritative debt-payment quote protocol — 2026-10-27

Status: backend **TESTED_CODE**. Deploy the API before enabling this path in a mobile build. No accounting policy or legacy customer-credit behavior was changed.

## Why this protocol is needed

USD payment can legitimately repay USD debt first and then repay UZS debt using the receiving store's actual rate. Comparing the payment only with `debt_balance_usd` incorrectly blocks that existing business operation. A client-side amount/balance comparison also cannot stop another device from paying the same debt between preview and commit.

The backend now shares one allocation helper between preview and commit. It keeps the original Decimal conversion/rounding and correction policy. A new mobile request opts into a locked balance/rate snapshot and **no new customer credit** by supplying `expected_quote`. Existing clients omitting it may still intentionally create customer credit.

## Read a quote

`GET /api/v1/sales/counterparties/<id>/payments/quote/?amount=5&currency=USD&payment_type=cash`

Optional query field: `branch_id` for an authorized active receiving store under the same owner. The API requires `sales.record_debt_payment` for the debt's store and receiving store. The counterparty must belong to the active tenant. It returns HTTP 200 and `Cache-Control: no-store` on success.

The response contains:

| Field | Meaning |
| --- | --- |
| `protocol` | Exactly `ilbi-debt-payment-quote-v1`. |
| `actor_id`, `tenant_id`, `counterparty_id`, `branch_id` | Actor, debt's store, customer and receiving store. |
| `amount`, `currency`, `payment_type` | Normalized two-place amount, UZS/USD, cash/card. |
| `balances` | Original signed `UZS` and `USD` balances, as exact two-place strings. |
| `applied` | Exact amount applied to each debt currency. |
| `remaining` | Projected signed balances after this payment. |
| `exchange_rate` | Exact six-place rate actually used for conversion, or null if no conversion is needed. |
| `exchange_rate_source`, `exchange_rate_date` | `manual`/`cbu` and applicable ISO date; empty/null when no conversion is used. |
| `creates_credit` | Whether this payment would make either customer-credit balance more negative. An existing credit in another currency alone does not make this true. |
| `expected_quote` | Opaque 64-character lowercase hexadecimal HMAC binding the allocation, actor, stores, customer, amount/channel and current balances/rate. Never construct or change it on the client. |

Example: UZS debt `100000.00`, USD debt `0.00`, receiving-store rate `13000.000000`, payment USD `5.00` results in `applied={UZS:"65000.00",USD:"0.00"}`, `remaining={UZS:"35000.00",USD:"0.00"}` and `creates_credit=false`.

The GET takes only database read locks in the existing tenant→counterparty order. It never creates a payment, shift, notification or report and never calls the threshold/delivery path. It does not guarantee that a shift remains open until the eventual POST; the commit still checks the actual open shift.

## Commit the original confirmed quote

POST to the existing `/api/v1/sales/counterparties/<id>/payments/` with the usual amount, currency, payment type, optional receiving branch/note and original `idempotency_key`, plus the quote's `expected_quote`.

Supplying `expected_quote` requires an idempotency key. It applies only to normal positive debt payments, not the correction endpoint. The server checks the guarded request under its existing target-tenant→counterparty→shift transaction locks. A changed balance/rate or projected new credit rejects the request before any payment/balance mutation. These business rejections use the existing HTTP 400/detail error contract. Invalid/missing input receives field validation errors.

Original-key replay is checked **before** current balances, rate and open-shift eligibility. Thus a response lost after committing can be recovered with the exact original body/token/key even after the balance falls, the rate changes or that shift closes. The persisted request fingerprint binds the quote, actor and original amount/currency/channel/branch/note. Reusing the key with another payload, quote or actor is rejected.

A successful guarded response retains the existing saved payment fields and adds:

```json
{
  "payment_operation": {
    "protocol": "ilbi-debt-payment-quote-v1",
    "idempotency_key": "the-original-request-key",
    "expected_quote": "the-original-64-character-token",
    "actor_id": 1,
    "tenant_id": 1,
    "counterparty_id": 5,
    "branch_id": 1
  }
}
```

The strings above are documentation placeholders. The client must validate this acknowledgement against the persisted original request, then validate the saved payment's actor, customer, amount/currency/channel/branch and actual conversion fields before confirming its local financial intent.

Do not regenerate a quote/token/key when replaying a pending unknown-result intent. Do not mark that original intent rejected merely because a later replay fails. If a server accepted the operation but local acknowledgement persistence failed, retry the local acknowledgement instead of posting another payment. New dialogs require distinct draft IDs; completed callbacks retain their original key. An older server without the quote protocol must not receive an unguarded fallback payment, because older serializers can silently ignore unknown POST fields.

## Actual verification

The focused frozen-environment run passed **83 real Django/PostgreSQL ORM/API tests**: the new quote suite plus existing debt service, exchange-rate and core mobile API suites. Tests cover exact USD→UZS allocation and USD-first allocation, manual/CBU/receiving-branch rates, no-effect GET, stale balance/rate rejection, no-new-credit versus legacy intentional credit, another-currency existing credit, original replay after rate/balance/shift changes, changed payload/token/actor, foreign tenant/staff permissions and both same-key and distinct-key concurrency. Existing legacy credit/correction and conversion tests passed.

Ruff passed for the debt service and new quote test module. Evidence is in [backend tests](evidence/debt-quote-2026-10-27/backend-tests.txt) and [service/test lint](evidence/debt-quote-2026-10-27/ruff.txt). Shared API files retain pre-existing broad formatting findings; that broader lint is not reported as passed. No emulator, deployment, live delivery or marketing-version changes were made by this backend checkpoint.
