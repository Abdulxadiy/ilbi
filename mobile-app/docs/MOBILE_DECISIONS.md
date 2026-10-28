> Historical prototype/review record. Current implementation status and verification limits are recorded in the [live parity audit ledger](DESKTOP_MOBILE_PARITY_AUDIT.md).

# ILBI Mobile — Architecture & Design Decisions

Ushbu hujjatda ilova bo'yicha qabul qilingan arxitektura, dizayn va xavfsizlik qarorlari qayd etiladi.

---

Review update (2026-10-24): earlier decisions describe intended behavior, not proof of acceptance. See [MOBILE_REVIEW.md](MOBILE_REVIEW.md). Docker defaults to an explicit synthetic preview; unsafe legacy offline replay is disabled pending isolation and reconciliation. Android/iOS JS exports pass, while native runtime gates remain open.

### DEC-001: Loyiha joylashuvi
- **Qaror:** Foydalanuvchining bevosita ko'rsatmasiga asosan mobil ilova `mobile-app/` katalogida joylashtirildi.

### DEC-002: Texnologik stek
- **Qaror:** React Native (0.88), Expo SDK 58, TypeScript, Expo Router (Drawer + Bottom Tabs + Stack), Jest.
- **Asos:** Master spesifikatsiya talablariga to'liq mos keladi.

### DEC-003: Monoxrom dizayn va logotip
- **Qaror:**
  - Kunduzgi fon: `#F0EFEB`, Yuza: `#FFFFFF`, Matn: `#0B0909`.
  - Tungi fon: `#0B0909`, Yuza: `#171515`, Matn: `#F0EFEB`.
  - Moviy rang faqat logotip lentasida (`ilbi-mark.svg`) qo'llaniladi. Tugmalar, tablar va asosiy boshqaruv elementlari monoxrom bo'ladi.
  - Hujjatlar (A4 va kassa cheki) tungi rejimda ham oq qog'oz fonda (`#FFFFFF`) qora matn bilan ko'rsatiladi.

### DEC-004: Savat va narx boshqaruvi
- **Qaror:** Mijoz narxini o'zgartirish faqat joriy savatdagi qator uchun amal qiladi (`Faqat shu savdo uchun`). Global katalog narxi yoki tannarx o'zgarmaydi. Backendga `items[].unit_price` sifatida uzatiladi.

### DEC-005: Navigatsiya va Yon Menyu integratsiyasi
- **Qaror:** Pastki 5 ta menyu (`Bosh`, `Tovar`, `Savdo`, `Qarz`, `Menyu`). `Menyu` bosilganda chap tomondan ochiluvchi `Drawer` ochiladi (yuqori chap burchakdagi gamburger tugmasi bilan bir xil).

### DEC-006: Modal oqimlar va Native Stack integratsiyasi
- **Qaror:** To'lov (`CheckoutScreen`), Chek (`ReceiptScreen`) va hujjatlar almashinuvi alohida modal va stek qatlamida ochiladi. Bu foydalanuvchiga to'lov yakunlangach, toza holatda yana kassa yoki bosh sahifaga qaytish imkonini beradi.

### DEC-007: Oflayn outbox navbati va xavfsiz sinxronizatsiya
- **Qaror:** Tarmoq uzilganda moliyaviy operatsiyalar (savdo, qarz to'lovi) `idempotency_key` bilan birga `AsyncStorage`dagi mustahkam navbatga (`@ilbi_outbox_v1`) yoziladi. Tarmoq ulanganda avtomatik va qo'lda sinxronizatsiya orqali takrorlanishsiz (idempotent) serverga yetkaziladi.

### DEC-008: X-Tenant-ID va multi-tenancy xavfsizligi
- **Qaror:** API mijoz har bir so'rovga tanlangan do'konning `X-Tenant-ID` sarlavhasini avtomatik qo'shadi. Do'kon almashtirilganda mahalliy savat qoralamasi va keshlar ajratiladi (`ilbi_cart_draft:{userId}:{tenantId}`).

### DEC-009: Hujjatlarga qo'lda imzo chekish (PanResponder canvas)
- **Qaror:** Tashqi og'ir webviewlarsiz, React Native ning `PanResponder` mexanizmi yordamida teginish nuqtalari koordinatalari yig'ilib, SVG/Path orqali real vaqt rejimida silliq vektor chiziqlari bilan chiziladi va A4 hujjatiga muhrlanadi.
