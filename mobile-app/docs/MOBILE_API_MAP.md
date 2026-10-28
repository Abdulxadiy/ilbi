> Historical prototype/review record. Current implementation status and verification limits are recorded in the [live parity audit ledger](DESKTOP_MOBILE_PARITY_AUDIT.md).

# ILBI Mobile — API Map & Backend Contracts

Initial API reference, checked against source only where stated. This is not proof of end-to-end integration; read [MOBILE_REVIEW.md](MOBILE_REVIEW.md).

## Asosiy Qoidalar
1. **Base URL:** `/api/v1` (Mobil uchun moslashuvchan konfiguratsiya qilinadi).
2. **Autentifikatsiya:** JWT Bearer token (`Authorization: Bearer <token>`).
3. **Tenant konteksti:** Ko'p do'konli rejimda `X-Tenant-ID: <tenant_id>` header yuboriladi.
4. **Idempotentlik:** Moliyaviy so'rovlar uchun JSON body ichida `idempotency_key` maydoni yuboriladi.

---

## Marshrutlar Ro'yxati (Endpoint Contracts)

| Funksiya | Metod va Marshrut | Parametrlar / Body | Javob (Response) |
| --- | --- | --- | --- |
| **Admin Login** | `POST /api/v1/auth/admin-login/` | `{ username, password }` | Demo bo'lsa tokenlar, aks holda `{ login_ticket, telegram_linked, phone_hint }` |
| **Send OTP** | `POST /api/v1/auth/admin-login/send-otp/` | `{ login_ticket }` | `{ otp_sent: true }` |
| **Verify OTP** | `POST /api/v1/auth/admin-login/verify-otp/` | `{ login_ticket, verification_code }` | `{ access, refresh }` |
| **Refresh Token** | `POST /api/v1/auth/token/refresh/` | `{ refresh }` | `{ access, refresh }` |
| **Current User** | `GET /api/v1/auth/me/` | — | `{ id, username, first_name, role, tenants, ... }` |
| **My Tenants** | `GET /api/v1/tenants/my/` | — | `[ { id, name, is_owner, permissions } ]` |
| **Current Tenant** | `GET /api/v1/tenants/current/` | `X-Tenant-ID` | `{ id, name, usd_rate, receipt_settings, ... }` |
| **Dashboard** | `GET /api/v1/analytics/dashboard/` | `period=today` | `{ kpi: { total_sales_uzs, sales_count, total_debt_uzs, ... }, overview, ... }` |
| **Catalog Variants** | `GET /api/v1/catalog/variants/` | `search, barcode, in_stock, category` | `{ count, results: [ { id, product_name, name, barcode, price_recommended, price_min, stock_quantity } ] }` |
| **Sales List** | `GET /api/v1/sales/` | `page, limit, status, date` | `{ count, results: [ SaleOutputSerializer ] }` |
| **Sale Detail** | `GET /api/v1/sales/{id}/` | — | `SaleOutputSerializer` (barcha items, narxlar, chek snapshot) |
| **Create Sale** | `POST /api/v1/sales/` | `{ items: [{ product_variant_id, quantity, unit_price }], payment_type, counterparty_id, debt_due_date, idempotency_key }` | Yaratilgan `SaleOutputSerializer` |
| **Public Receipt** | `GET /api/v1/sales/public/receipt/{token}/` | — | Chek ma'lumotlari (ommaviy QR orqali) |
| **Counterparties** | `GET /api/v1/sales/counterparties/` | `search, page` | `{ count, results: [ CounterpartyOutputSerializer ] }` |
| **Create Customer**| `POST /api/v1/sales/counterparties/`| `{ name, phone_number, note }` | `CounterpartyOutputSerializer` |
| **Customer Payments**| `POST /api/v1/sales/counterparties/{id}/payments/`| `{ amount, currency, note, idempotency_key }` | Yaratilgan to'lov hujjati |
| **Current Shift** | `GET /api/v1/cashbox/shift/current/` | — | `{ id, opened_at, is_closed }` |
