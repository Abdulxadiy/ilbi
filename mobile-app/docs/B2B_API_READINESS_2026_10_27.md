# B2B mobile API readiness — 2026-10-27

Status: source and actual backend/API checks passed; production deployment and native acceptance remain pending. This is the DMP-044–046 slice. It does not close the separate team-management findings DMP-047–048.

## Implemented behavior

The mobile B2B screen reads actual incoming/outgoing transactions, searches receipt/store names, filters status and paginates. Incoming history can include resolved transfers without changing the legacy inbox's default pending-only behavior. An authenticated detail endpoint permits only the source or destination store. Incoming output omits source employee, customer contact and cost fields; outgoing output keeps the existing request-sensitive sale serializer.

Each saved document shows original quantity, accepted quantity, pending physical return, received return, discrepancy closure, currency and authoritative total/refund/net values. PDF sharing rereads the permitted saved transaction immediately before export, escapes user text, checks account/store scope again before opening the OS share sheet, and uses the original currency.

Acceptance supports fractional quantities and explicit destination mapping into an existing variant or a new product category. Mapping endpoints require `sales.manage_b2b` and return only local active IDs, names, currency and unit; they do not require unrelated catalogue permissions or expose prices. Existing-variant choices are filtered by source currency and unit. Once a line has been partially accepted, the server retains its original destination variant.

Rejecting a transfer creates a physical-return obligation; it does not restore sender stock immediately. The source store can acknowledge the quantity physically received. An active owner can close missing-return discrepancies with a required reason; this performs the existing financial correction without inventing a stock receipt. The existing prohibition on generic B2B sale cancellation remains enforced. Creating a new partner-store/customer link is a separate customer-management workflow; this slice does not claim to implement that missing editor.

## Durable mutation contract

The client verifies `GET /sales/b2b/capabilities/` before creating an intent or sending a write. Unsupported/old servers receive no B2B mutation. Each dialog has an immutable UUID and a durable `b2b:<kind>:<draft UUID>` operation. The original command/key survives unknown network outcomes and uses a separate B2B family lock; a completed dialog returns its original result rather than creating another operation.

New requests carry `operation_id`; return/closure requests also supply that same key through the existing `idempotency_key` domain contract. Existing desktop/web payloads remain valid. A unique `B2BMutationReceipt` is bound to the actual actor, store, sale, kind and complete request fingerprint. The wrapper acquires tenant locks in the same sorted tenant→sale order as the domain services. Receipt and stock/debt/inbox changes share one transaction. A conflicting actor/payload/sale cannot reuse a key; failed writes leave no receipt.

The client confirms local storage only after matching the server's actor, tenant, sale, kind, key and return-resource acknowledgement. If the server accepted the request but local acknowledgement failed, the dialog retries only the local write. A rejection while reconciling an unknown original result cannot erase the pending intent. Sync retries use the exact saved payload/key and current permissions. The discrepancy owner restriction is checked again before server replay. Financial state is reread rather than optimistically changed.

Typed B2B inbox links now open this module with a saved sale ID; an incoming transaction does not go through the source-only ordinary receipt route. Arbitrary external notification URLs remain rejected. Changed notification sale IDs, server, user or store reset the visible B2B screen.

## Actual verification

- **33 actual isolated PostgreSQL ORM/API/service cases passed**: nine new mobile B2B cases plus 24 existing B2B API/service cases. These include simultaneous identical-key acceptance, exact 1.250 kg acceptance/replay, completed acceptance replay, distinct intentional partial requests, changed payload/actor conflict, receipt-failure rollback of stock and notifications, physical-return/closure debt effects once, scoped resolved history and detail, and mapping fields without price leakage.
- **23 mobile cases / three suites passed**: 13 command/model cases, four component flows and six inbox cases. Component checks exercise actual feature code with isolated mock transport: scoped list/detail requests, exact red controls, category mapping, required reject reason and local-only acknowledgement retry.
- Whole-app TypeScript and strict lint for the B2B source, preview fixture and tests passed. Ruff passed for the new backend B2B source and tests. These are actual executed source/contract checks, not native OS acceptance.

Evidence: [evidence/b2b-api-2026-10-27](evidence/b2b-api-2026-10-27/). Test environment uses the committed frozen Django 6.1.2 dependencies and a dedicated local PostgreSQL test database. No production store, real financial transaction or owner's emulator was used.

## Activation and acceptance still required

Deploy the additive backend APIs and `sales.0021_b2bmutationreceipt` before enabling the mobile mutation path. Sidebar/Router and Sync integration are checked with the final assembled application. The development preview's `DEMO-B2B-6101` incoming and `DEMO-B2B-6201` outgoing records are explicitly synthetic, opt-in fixtures and never fallback data for a failed live API.

The final isolated browser pass, signed APK execution, two permitted real test stores, OS PDF sharing and actual FCM-to-B2B tap flow remain separate acceptance gates until executed and recorded. In that environment reconcile both stores' quantities, debt balances, status and saved document after acceptance, reject, physical receipt and missing-return closure. Preserve the owner's installed application while testing.

Matching primary Expo SDK 58 documentation was consulted before API use: [Router](https://docs.expo.dev/versions/v58.0.0/sdk/router/), [Crypto](https://docs.expo.dev/versions/v58.0.0/sdk/crypto/), [Print](https://docs.expo.dev/versions/v58.0.0/sdk/print/), [Sharing](https://docs.expo.dev/versions/v58.0.0/sdk/sharing/).
