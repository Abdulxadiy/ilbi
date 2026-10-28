# ILBI — Yakuniy yo'l xaritasi

> **Shu hujjat yagona manba.** Eski `ilbi-arxitektura.md`, `ilbi-yol-xaritasi.md`, `ilbi-yakuniy-arxitektura.md` va `ilbi-yakuniy-arxitektura_1.md` endi qo'llanilmasin — ularning qarorlari, ziddiyat yechimlari va hali ochiq ishlari shu yerga jamlangan.
> 
> **Qanday ishlatish:** bitta bandni tugatgach, shu fayldagi keyingi `[ ]` ni oching. Tartib — bosqich raqami. Oldingi bosqichdagi ochiq `[ ]` (masalan, E2E test) keyingi poydevorni to'xtatmasa, uni keyinroq qaytib yopish mumkin.
> 
> Holat belgisi: `[x]` bajarilgan · `[ ]` qilinishi kerak · `🔶` asosiy qismi bor, qoldiq ochiq.
> 
> **2026-09 yirik arxitektura qarori:** Customer identifikatsiyasi (ro'yxatdan o'tish, OTP login, throttle) ILBI'dan **butunlay chiqarilib**, alohida **`Shop`** mikroservisiga (o'z bazasi bilan) ko'chiriladi. ILBI endi faqat `platform_admin` / `owner` / `staff`ni biladi — bular endi customer bosqichisiz, **telefon raqami orqali to'g'ridan-to'g'ri** yaratiladi. Shop tomoni uchun alohida **`shop-yol-xaritasi.md`** ga qarang. ✅ **Bu qaror endi kod darajasida ham to'liq amalga oshirilgan** (`ROLE_CHOICES`dan `customer` olib tashlandi, eski customer OTP/register kodi o'chirildi, `default='customer'` olib tashlandi — `role` endi majburiy maydon).

---

## 0. Hal qilingan ziddiyatlar va keyingi qarorlar

### 0.1. Ikki eski hujjat orasidagi farqlar

|Mavzu|Eski arxitektura|Eski yo'l xaritasi|Yakuniy qaror|
|---|---|---|---|
|Foydalanuvchi identifikatori|`email`, `password_hash`|`phone_number` (`USERNAME_FIELD`)|**`phone_number`**|
|Domen|`subdomain` maydoni|Bitta domen, subdomain yo'q|**Bitta domen (`ilbi.uz`), subdomain YO'Q**|
|Tenant FK nomi|`tenant_id`|`tenant`|**`tenant`** (Django: FK `_id`siz yoziladi)|
|API qatlami|`api/v1/<app>/` majburiy|Har bir app o'z ichida|**`api/v1/<app>/` tanlandi** (view/serializer/url); biznes logika `apps/<app>/services/` da. 10-bosqich endi "strukturaga o'tish" emas, format/pagination|
|Ro'yxatdan o'tish/login|—|SMS (Eskiz.uz / Play Mobile)|**SMS bekor.** OTP **Telegram bot** orqali|

### 0.2. Keyin qo'shilgan/o'zgargan qarorlar

|Mavzu|Qaror|
|---|---|
|`Employee.user`|`ForeignKey` + partial `UniqueConstraint(condition=Q(is_active=True))` — bir vaqtda bitta faol Employee, tarix cheksiz (**Variant A**)|
|JWT authentication|`REST_FRAMEWORK.DEFAULT_AUTHENTICATION_CLASSES` = `JWTAuthentication`|
|`gunicorn.conf.py`|`preload_app = False` (gevent + `True` `DatabaseError` beradi)|
|`DEBUG`|`.env`dan o'qiladi; to'liq `bool`ga aylantirish — **deploy oldidan**, hozir ataylab qoldirilgan|
|`Tenant.slug`|**Olib tashlandi** — subdomain yo'q, tenant JWT orqali|
|`Tenant.owner`|**`OneToOneField(User)`**, Tenant faqat owner bilan yaratiladi|
|`Tenant.description`|`blank=True`|
|`TenantService.change_owner()`|Dastlab yo'q edi, qo'shildi: platform_admin owner ni almashtiradi (fire + hire)|
|Tenant API|Dastlab faqat create/list/deactivate; hozir **CRUD + change-owner + activate/deactivate**|
|`Employee.position`|Erkin matn; ruxsat bilan bog'liq emas. Ruxsatlar faqat `Employee.permissions`|
|Telefon validatsiyasi|**Shop** (fail-fast). ILBI biznes qoidalariga e'tibor|
|`needs_profile_completion`|`user.profile_completed`; `has_usable_password()` customer uchun mos emas (eslatma: bu customer ILBI'da bo'lgan davrga tegishli, Shop'ga ko'chganda qayta ko'riladi)|
|Testlar|To'liq CI/CD hozircha **kerak emas**. Lokal `pytest` (Redis + Postgres test compose) **kerak** va asosiy servislar uchun yozilgan|
|Paket / muhit|`uv`; Windows + PowerShell|
|Admin panel login|**Ikki qadam:** `username` + `password`, so'ng Telegram OTP, keyin JWT. Customer bu yo'ldan kira olmaydi. To'g'ridan-to'g'ri parol → JWT **yo'q**|
|Admin login throttle|Redis: 5 urinish → 60s; 3 → 1 soat; 1 → 1 kun (strike). 3 ketma-ket strike → `User.is_active=False`. `platform_admin` ham cheklanadi. **Unban endpoint qo'shildi** (pastga qarang)|
|Username enumeratsiyasi (admin)|Noto'g'ri parol va mavjud bo'lmagan username — **bir xil** 401 matn|
|Telefon API javobida|To'liq raqam chiqmaydi; `mask_phone_number` (`+998 90 *** ** 67`)|
|Test settings|`.env.test` `settings.py` importidan **oldin** yuklanadi; testda `MD5PasswordHasher`|
|**Unban endpoint**|`POST /api/v1/auth/unban/ {target_user_id}` — `platform_admin` only. `target_user_id` (PK) orqali ishlaydi, `username` orqali emas — shu tufayli customer uchun ham universal. `User.is_active=True` + tegishli throttle modul(lar)ining to'liq reseti|
|**Ruxsat modeli**|Django'ning `contrib.auth.Permission`si (`ContentType`ga bog'liq) **emas** — custom `apps/permissions.Permission` (`category` + `codename` + `name` + `description`, unique_together). Sabab: ko'pchilik ruxsatlar bitta modelga bog'lanmaydi (masalan `"sales.void_transaction"`), va custom admin panelda kategoriya bo'yicha filtrlash/guruhlash uchun haqiqiy ustun kerak|
|**Owner ruxsati**|Owner o'z tenant'i ichida **har doim to'liq huquqli** — `Employee.permissions` orqali tekshirilmaydi (`platform_admin` kabi bypass). Qaysi tenant ekanligini esa `PermissionService` emas, mavjud `IsTenantMember`/`IsTenantOwnerOrPlatformAdmin` klasslari nazorat qiladi|
|**`EmployeeService.hire()` — boshqa tenant'da faol bo'lsa**|Avvalgi qaror ("avtomatik fire+hire, tenant-transfer oqimi") **bekor qilindi**. Endi: agar `target_user`ning boshqa joyda (yoki shu tenant'da boshqa lavozimda) faol `Employee` yozuvi bo'lsa — hire **to'siladi**, xato qaytariladi. _(Eslatma: bu qaror qabul qilindi, lekin kod hali yangilanmagan — quyida 4-bosqichda ochiq band sifatida belgilangan.)_|
|**Owner/staff yaratish**|Endi "avval customer bo'lib ro'yxatdan o't, keyin hire qilinasan" emas. `platform_admin` (owner uchun) yoki `owner` (staff uchun) **faqat telefon raqamini** kiritadi; ILBI kerak bo'lsa yangi `User`ni **o'zi** yaratadi (get-or-create). ✅ **Kod tomonidan ham amalga oshirilgan** (`EmployeeService.hire()`, `TenantService.create_with_owner()` — 4/4.5-bosqich)|
|**Username/parol o'rnatish va tiklash**|1.6'dagi asl reja ("Telegram OTP orqali") **bekor qilindi**. Yakuniy qaror: **email orqali** — sabab: staff/owner texnik bilimli bo'lishi mumkin, login (Telegram 2FA) va parol-tiklash bitta kanalda bo'lsa, ikki faktorli himoya aslida bittaga aylanadi. Alohida kanal — haqiqiy defense-in-depth. `User.email` maydoni allaqachon bor (`complete_profile`), staff/owner uchun **majburiy** qilinadi. ✅ **Endpointlar ham yozilgan va testlangan** (7-bosqich, `PasswordResetRequestView`/`PasswordResetConfirmView`)|
|**Telegram bot (`telegram_bot_sms`)**|Endi **ikkala xizmatga** (ILBI + Shop) xizmat qiladi — bitta bot, deep-link orqali marshrutlanadi (`https://t.me/<bot>?start=ilbi` / `?start=shop`). `pending_target` xotirada saqlanadi (chat_id → maqsad), kontakt kelganda tegishli `ILBI_INTERNAL_URL` yoki `SHOP_INTERNAL_URL`ga yuboriladi. **Kod yangilandi va sinovdan o'tkazildi (2026-09).** Cheklov: xotiradagi holat bot qayta ishga tushganda yo'qoladi; bot ko'p nusxada ishlaydigan bo'lsa qayta ko'rib chiqish kerak|
|**Customer / Shop ajratilishi**|Customer ILBI'dan **butunlay chiqariladi**. Shop — alohida FastAPI mikroservis, **o'z bazasi bilan** (eski reja — "Shop faqat proxy, o'z bazasi yo'q" — endi bekor). Batafsil: `shop-yol-xaritasi.md`|
|**Tenant-kontekst joylashuvi (8-bosqich)**|Haqiqiy Django `MIDDLEWARE` **emas** — DRF darajasidagi `TenantContextMixin` (`api/mixins.py`, `initial()`da, DRF autentifikatsiyasidan **keyin**). Sabab: Django middleware DRF autentifikatsiyasidan oldin ishlaydi, shuning uchun haqiqiy middleware `request.user`/JWT claim'ga ishonchli murojaat qila olmaydi|
|**Tenant manbasi (8-bosqich)**|JWT claim **emas** — `request.user.tenant` (DB, har doim yangi). Sabab: JWT claim `fire()`dan keyin ham eski tokenda saqlanib qolishi mumkin (stale); DB o'qish har doim aniq|
|**`PermissionService` — owner uchun qo'shimcha tekshiruv (2026-09)**|Avval `role == "owner"` bo'lsa shartsiz `True` edi. Endi owner ham **faol `Employee` yozuviga ega bo'lishi shart** — aks holda `change_owner()` orqali almashtirilgan eski owner (role saqlanib qolgani sababli, Variant A) butun umr to'liq huquqli bo'lib qolar edi. Test: `test_former_owner_denied_after_change_owner`|
|**Parol tiklash — faol employment talabi (2026-09)**|`request_password_reset()` endi faqat `role`ga emas, **faol `Employee` yozuvi borligiga** ham qaraydi — fired xodim email orqali parolini qayta tiklab ololmaydi|
|**`Category.kod` / `ProductVariant.sku` / `.code` (9-bosqich)**|Uchtasi alohida maqsad: `sku` — tizim ichki, avtomatik, noyob (inventory/sales shunga bog'lanadi); `Category.kod` — avtomatik boshlanadi, owner qo'lda o'zgartira oladi, tenant ichida noyob; `ProductVariant.code` — `"{kategoriya}/{subkategoriya}/{price_min // 1000}"`, yaratilganda yig'iladi, keyin erkin tahrirlanadi, **noyob emas** (sof ko'rgazmali)|
|**Media saqlash (9-bosqich, 12-bosqich)**|MinIO — o'z-o'zi joylashtiriladigan, S3-protokoliga mos Docker konteyneri (`minio:latest`, portlar: 9000 API, 9001 Console). `django-storages` orqali ulandi, rasmlar avtomatik optimallashtiriladi va tozalangan URL beriladi (`_clean_media_url`)|
|**`catalog` routing (2026-09)**|`platform_admin` `catalog` endpointlariga **umuman kira olmaydi** (403) — owner/staff'ning kundalik ishi, `platform_admin` faqat owner'larni boshqaradi. Amalga oshirish: `CatalogAPIView` bazaviy klassi (`api/v1/catalog/views/_base.py`) buni aniq tekshiradi, chunki `PermissionService` platform_admin'ga boshqa xususiyatlar uchun har doim `True` qaytaradi|
|**`EmployeeFactory` test-bugi (2026-09)**|`EmployeeFactory` `Employee` qatorini yaratardi-yu, `User.tenant`ni yangilamasdi (real `hire()` buni ham qiladi) — `TenantContextMixin`ga tayangan har qanday view uchun staff-testlar noto'g'ri 403 berardi. Tuzatildi: `sync_user_tenant` post_generation hook (`tests/factories.py`)|
|**POS 1-narx galochkasi (`use_partner_price`) (9-bosqich)**|Sotuv sahifasida galochka yoqilganda barcha tovarlar faqat `price_partner` (1-narx) bo'yicha ko'rinadi va hisoblanadi. Agar tovarning 1-narxi belgilanmagan (bo'sh yoki 0) bo'lsa, sotish bloklanadi va to'ldirish talab qilinadi. Kassir narxni erkin o'zgartira oladi. Chekda `is_partner_sale=True` va har bir tovar satrida sotilgan narx bilan o'sha paytdagi asl 1-narx audit uchun saqlanadi|
|**Kontragentlar (`Counterparty`) (9-bosqich)**|1-narxda tovar oluvchilar ro'yxati (do'konlar, tanishlar, xodimlar). Ruxsati bor staff ham qo'sha oladi. Telefon raqami orqali tizimda foydalanuvchi va uning faol `Tenant`i avtomatik qidirilib bog'lanadi (`target_tenant` nullable). Agar tenanti bo'lsa — B2B tovar o'tkazish xabarnomasi o'sha tenantning **OWNER**iga boradi. O'chirib bo'lmaydi, faqat arxivlanadi (`is_active=False`)|
|**B2B Do'konlararo tovar o'tkazish (9-bosqich)**|Tizimdagi boshqa do'konga tovar sotilganda: jo'natuvchi omboridan tovarlar o'sha zahoti chiqib ketadi (`direction='out'`). Qabul qiluvchi do'kon egasiga in-app va Telegram bot orqali bildirishnoma boradi. Statuslar: `pending`, `accepted`, `partially_accepted`, `rejected`. 1 hafta javob berilmasa — avtomatik `rejected` bo'ladi|
|**B2B Rad etilganda ombor xatti-harakati (9-bosqich)**|Qabul qiluvchi tovarlarni rad etsa yoki qisman qabul qilsa, rad etilgan tovarlar A omboriga avtomatik qaytmaydi va qarz avtomatik kamaymaydi. Sababi bilan A ga bildirishnoma boradi. Faqat A do'koni rad etilgan tovarlarni ko'rib chiqib, o'zi "Void" qilgandagina tovar A omboriga qaytadi va B ning qarzi kamayadi|
|**B2B Qabul qilinganda katalogga biriktirish (9-bosqich)**|B qabul qilayotganda tovar qaysi kategoriyaga qo'shilishini o'zi tanlaydi (valyuta mos bo'lishi shart) yoki agar o'zida bu tovar mavjud bo'lsa, mavjud variantga biriktirib qoldiqni oshiradi. Tannarx: A do'kon sotgan 1-narx. B ning sotuv narxi: default `0` (B keyin o'zi narx qo'yadi)|
|**Qarz / Nasiya (UZS va USD mustaqil balansi) (9-bosqich)**|`debt_balance_uzs` va `debt_balance_usd` alohida yuritiladi (ishorali: musbat = qarz, manfiy = mijoz haqqi). Yangi qarz olinganda mavjud haqqidan avtomatik ushlab qolinadi. Ogohlantirish: har 10 mln UZS va har 1 000 USD oshganda owner'ga ogohlantirish. Qarz to'langanda qadamlar (`step`) orqaga qaytadi|
|**Qarz to'lovlari (`DebtPayment`) auditi (9-bosqich)**|Qarz to'lovlarini faqat `owner` va `platform_admin` kiritishi mumkin. Baza yozuvi o'chirilmaydi. Xato bo'lsa, sababi bilan teskari korrektirovka yozuvi kiritiladi (`is_correction=True`). Ruxsatli staff tarixni ko'ra oladi|
|**Universal Bekor qilish (Void) va Qisman qaytarish (9-bosqich)**|Har qanday sotuv 1 hafta (7 kun) ichida bekor qilinishi mumkin (izoh majburiy). B accept qilgan B2B sotuvni A void qila olmaydi. Xohlasa butun chek, xohlasa alohida tovar va uning ma'lum miqdori (qisman) qaytariladi (`partially_voided` / `voided`). Qaytarilgan qism bo'yicha qarz kamayadi va tovar omborga qaytadi|
|**Valyuta tizimi: UZS va USD (9-bosqich)**|Asosiy `Category` yaratilishida valyuta (`UZS` yoki `USD`) belgilanadi. Subkategoriya ota kategoriyaning valyutasini meros oladi. Savatda aralash tovarlar bo'lsa, backend bitta tranzaksiyada 2 ta alohida chek yaratadi (`UZS` va `USD`). Owner do'kon uchun ichki dollar kursini (`Tenant.usd_rate`) belgilaydi (katalogda ko'rgazmali hisoblash uchun)|
|**Ombor harakati va Chek auditi (9-bosqich)**|`StockMovement` modeli `Sale` chekiga to'g'ridan-to'g'ri bog'lanadi (`sale` FK)|
|**Ko'p filialli tizim (`Branch`) va `Stock.branch` (9.4-bosqich)**|Har bir tenant bir nechta filialga ega bo'lishi mumkin (`Branch` modeli, kamida 1ta asosiy `is_main=True`). `Stock` endi OneToOne emas, FK `Branch` bo'lib, `UniqueConstraint(fields=["branch", "product_variant"])` ga ega. Har bir filial uchun alohida narxlar belgilanishi mumkin (`custom_price_recommended`, `custom_price_min`, `custom_price_partner`) va filial narxi variant narxidan ustunlik qiladi|
|**Filiallararo tovar transferi (`StockTransfer`) (9.4-bosqich)**|Filiallararo tovar almashish (`from_branch` -> `to_branch`). `StockTransfer` va `StockTransferItem` modellari. Statuslar: `pending` (jo'natilgan), `completed` (qabul qilingan), `cancelled` (bekor qilingan). Jo'natilganda `transfer_out` harakati, qabul qilinganda `transfer_in` harakati atomik yoziladi|
|**Filiallararo qat'iy izolyatsiya (Strict Branch Isolation in POS & Inventory) (v0.12.4)**|POS va filial doirasidagi amallarda (`branch_id` / `activeBranch` tanlanganda) faqat va faqat tanlangan filialda mavjud bo'lgan (`stocks__quantity > 0`) tovarlar ko'rsatiladi. Boshqa filialdagi yoki filialda qoldig'i 0 bo'lgan tovarlar POS vitrinasidan to'liq chetlatiladi — "Tugagan" (0 dona) kartochkalari chiqarilmaydi. Kassirlar o'z biriktirilgan filialiga qat'iy bog'lanadi (`emp.branch`). Do'kon egasi filialni almashtirganda POS savati avtomatik tozalanadi (`resetCart()`). Global katalog (`/catalog`) va kirim oynasi esa to'liq katalogga kirish huquqini saqlaydi|
|**Dashboard & Analitika: Tushum va Nasiyani Qat'iy Ajratish (Cash Flow vs Receivables)**|Nasiyaga (qarzga) berilgan savdo (Receivables) kassa tushumi (Cash flow) emas. Ular statistikada va KPI kartalarida (Naqd tushum, Karta tushumi, Nasiya savdosi, Sof foyda, Jami qarz) bir-biridan qat'iy ajratildi. UZS va USD ko'rsatkichlari mustaqil yuritiladi|
|**Kassa Z-Hisobot cheki va Valyutalar Taqsimoti (v0.12.4)**|Z-Hisobot chekida USD va UZS tranzaksiyalari (savdo, chiqim, kirim) o'z valyutasida alohida ko'rsatiladi ($ va UZS aralashmaydi). Z-Hisobot modalida avval chiroyli vizual hisobot (Executive Summary) ko'rinadi. Bosma chek (Thermal print receipt) faqat "Chop etish" (Print) tugmasi bosilgandagina ochiladi/chop etiladi|
|**Elektron Imzolar Xavfsizligi va Auditi (Hisob-Faktura & Smena) (v0.12.4)**|Hisob-faktura (A4 Invoice) 2 tomonlama (topshiruvchi va qabul qiluvchi) imzolangandan so'ng hujjat butunlay qulflanadi (immutable) — imzolarni yangilash (Re-sign/Update) va o'chirish (Clear) imkoniyati butunlay yopilgan va taqiqlangan! Smena yopishda ham imzoni tozalash interfeysdan olib tashlangan.|
|**Ommaviy Partiya Kirimi (Rapid POS-Style Barcode Scanner Intake Workspace) (v0.12.4)**|Yangi tovar partiyalarini tezkor kiritish uchun kassa-skaner uslubidagi alohida ish maydoni (`RapidStockIntakeModal.jsx`). Shtrix-kod skaneri yoki qidiruv orqali tovarlar tanlanib, jadvalga qator bo'lib tushadi. Har bir qatorda miqdor, tannarx (`cost_price`), sotuv (`price_recommended`), minimal (`price_min`) va 1-narx (`price_partner`) joyida tahrirlanadi|
|**Kirim Qoralamalarining Saqlanib Qolishi (Offline / Draft Persistence) (v0.12.4)**|`ilbi_stock_intake_full_draft_v1` kaliti bilan LocalStorage da to'liq qoralamalar saqlanadi — operator boshqa sahifalarga (katalogga, sotuvga) o'tib qaytganda yoki brauzer yangilanganda ham to'plangan partiya jadvali yo'qolmaydi|
|**Ombor Qoldiq Filterlarining Yaxshilanishi (v0.12.4)**|Ortiqcha va noqulay filter tugmalari olib tashlanib, ixcham va zamonaviy bitta qatorli qoldiq holati filtri joriy etildi (kamchiliklar alohida Deficits bo'limiga ko'chirilgani hisobiga)|
|**Kamomad (Deficit) Tizimi va Telegram Hisobotlari (v0.12.1)**|`DeficitService`: so'nggi 30 kunlik sotuvi >= 10 ta va joriy ombor qoldig'i <= 5 ta bo'lgan tovarlar avtomatik kamomad ro'yxatiga kiritiladi. Tovar partiyasi kirim qilinishi bilan (qoldiq > 5) tovar avtomatik ravishda kamomad ro'yxatidan chiqariladi. Filial darajasida kamomad hisob-kitobi qilinadi. Telegram bot orqali har kuni va darhol ("Hoziroq yuborish") hisobot beriladi|
|**Batch Stock Intake API (`/inventory/intake/batch/`)**|Bitta atomik tranzaksiya ichida ko'p sonli tovar variantlarini filial omboriga kiritish imkoniyati (`BatchStockIntakeSerializer`, `StockService.batch_intake()`)|
|**Frontend Web Client (React 18 + Vite + Tailwind + Glassmorphism SPA) (v0.12.0+)**|To'liq zamonaviy SPA frontend (`frontend/ilbi/`): Dashboard, POS, Catalog, Inventory, Sales, Counterparties, Shifts, Analytics, Branches, Employees, Settings sahifalari va dark/glassmorphism UI tizimi|


### 0.3. Hozirgi kod holati (2026-10, yangilangan v0.12.4)

Repo: `ilbi/` — `backend/` (Django 6 + DRF), `frontend/ilbi/` (React 18 + Vite SPA), `telegram_bot_sms/` (aiogram bot), `Architectures/` (shu fayl + `shop-yol-xaritasi.md`), ildiz `docker-compose.yml`.

**Aktiv Docker Konteynerlari:**
- `sales-platform-postgres-1` (PostgreSQL 16)
- `sales-platform-redis-1` (Redis 7)
- `sales-platform-minio-1` (MinIO Object Storage S3)
- `sales-platform-ilbi-1` (Django Gunicorn backend)
- `sales-platform-celery_worker-1` (Celery background worker)
- `sales-platform-celery_beat-1` (Celery Beat periodic scheduler)
- `sales-platform-bot-1` (Telegram SMS/OTP & Notification bot)
- `sales-platform-frontend-1` (Vite dev/client server, `FRONTEND_PORT` default 5173; shu lokal Docker muhitida 5174)
- `sales-platform-nginx-1` (Nginx reverse proxy, port 80)

**Asosiy HTTP API (`/api/v1/`) — to'liq yo'nalishlar:**

|Method|Yo'l|Vakolat|Tavsif|
|---|---|---|---|
|POST|`auth/complete-profile/`|JWT|Profil to'ldirish (ism, familiya, email)|
|POST|`auth/admin-login/`|AllowAny|Admin login (username+password → Telegram OTP)|
|POST|`auth/admin-login/verify-otp/`|AllowAny|OTP tekshirish va JWT olish (`access`/`refresh`)|
|POST|`auth/unban/`|`platform_admin`|Bloklangan foydalanuvchini ochish|
|POST|`auth/password-reset/request/`|AllowAny|Email orqali parol tiklash so'rovi|
|POST|`auth/password-reset/confirm/`|AllowAny|Email token orqali parolni yangilash|
|GET/POST|`tenants/`|`platform_admin`|Do'konlar (Tenant) ro'yxati va yaratish|
|GET/PATCH|`tenants/<pk>/`|Rolga qarab|Tenant detallari va sozlamalari|
|POST|`tenants/<pk>/change-owner/`|`platform_admin`|Do'kon egasini almashtirish|
|POST|`tenants/<pk>/activate/` · `deactivate/`|Owner / Admin|Tenant faollashtirish/to'xtatish|
|GET/POST|`tenants/branches/`|Owner / Staff|Filiallar CRUD (kamida bitta `is_main=True`)|
|POST|`tenants/<id>/employees/hire/` · `fire/`|Owner / Admin|Xodimlarni ishga olish va bo'shatish|
|GET/POST|`catalog/categories/`|Owner / Staff|Kategoriyalar va subkategoriyalar|
|GET/POST|`catalog/products/`|Owner / Staff|Mahsulotlar va ularning birinchi varianti|
|GET|`catalog/variants/`|Owner / Staff|POS va qidiruv variantlari (`branch_id` filtri bilan)|
|GET/POST|`inventory/stock/`|Owner / Staff|Ombor qoldiqlari (`branch_id` filtri bilan)|
|GET/PATCH|`inventory/stock/<variant_id>/`|Owner / Staff|Qoldiq detallari va filial narxlarini yangilash|
|GET|`inventory/movements/`|Owner / Staff|Ombor harakatlari auditi (`branch_id` filtri bilan)|
|POST|`inventory/intake/` · `batch/`|Owner / Staff|Yakka va ommaviy partiya kirimi (`branch_id` bilan)|
|POST|`inventory/{adjust,customer-return,supplier-return,write-off}/`|Owner / Staff|Ombor tuzatish, qaytarish va hisobdan chiqarish|
|GET|`inventory/deficits/`|Owner / Staff|Kamomad tovarlar ro'yxati (`branch_id` filtri)|
|POST|`inventory/deficits/send-report-now/`|Owner|Telegramga darhol kamomad hisobotini yuborish|
|GET/POST|`inventory/transfers/`|Owner / Staff|Filiallararo tovar transferlari|
|POST|`inventory/transfers/<id>/{accept,cancel}/`|Owner / Staff|Transferni qabul qilish yoki bekor qilish|
|GET/POST|`sales/`|Owner / Staff|Sotuvlar (POS), chek yaratish va ro'yxat|
|POST|`sales/<id>/void/`|Owner / Staff|Chekni to'liq yoki qisman bekor qilish (Void)|
|GET/POST|`sales/counterparties/`|Owner / Staff|Kontragentlar ro'yxati va boshqaruvi|
|GET/POST|`sales/debt-payments/`|Owner / Admin|Qarz to'lovlari va korrektirovkalari|
|GET/POST|`cashbox/shifts/`|Owner / Staff|Kassa smenalari ochish/yopish (imzo bilan)|
|GET|`cashbox/reports/daily/`|Owner / Staff|Kunlik kassa Z-hisoboti|
|GET/POST|`cashbox/{income,expense}/`|Owner / Staff|Kassaga qo'shimcha kirim va chiqimlar|
|GET|`analytics/overview/` · `dashboard/`|Owner / Admin|Dashboard va savdo analitikasi|

**Servislar:** `EmployeeService`, `TenantService`, `PermissionService`, `CategoryService`, `ProductService`, `StockService`, `SaleService`, `DebtService`, `CashboxService`, `AnalyticsService`, `DeficitService`, `PasswordResetService`, `otp_services`, `login_throttle`, `phone_utils`.

**Ruxsat qatlami:** `apps/permissions.Permission` (custom model), `Employee.permissions` M2M, `PermissionService.has_permission()`, `HasEmployeePermission` DRF klassi.

**Testlar:** 180+ dan ortiq avtomatlashtirilgan testlar (`pytest-django`, `Faker`, `FactoryBoy`): Catalog (55 test), Inventory (30 test), Sales (45 test), Cashbox (20 test), Analytics, Accounts, Tenants — barchasi yashil.

---

## 1. Qabul qilingan asosiy qarorlar (o'zgarmas qoidalar)

|Mavzu|Qaror|
|---|---|
|Umumiy arxitektura|ILBI (Django + DRF, do'konning ichki boshqaruvi) + Shop (FastAPI, **o'z bazasi bilan**, customer-facing storefront)|
|Joylashuv|Bitta server, bitta docker-compose, ichki Docker tarmog'i|
|Aloqa|JSON/REST; `Authorization: Internal <token>`|
|Domen|`ilbi.uz`, subdomain yo'q|
|User ID|`phone_number` = `USERNAME_FIELD`; `username` global unique, admin panel login|
|Admin panel login|`username` + `password`, so'ng Telegram OTP (Django admin UI yo'q; `config/urls.py`da `admin/` ulanmagan)|
|**ILBI foydalanuvchilari**|Faqat `platform_admin` / `owner` / `staff`. **Customer ILBI'da yashamaydi** — Shop'ning ishi. Owner/staff **telefon raqami orqali to'g'ridan-to'g'ri** yaratiladi (customer bosqichisiz)|
|Parol o'rnatish/tiklash|**Email orqali** (Telegram emas) — alohida kanal, defense-in-depth|
|OTP saqlash|Redis, TTL; bazada emas|
|Multi-tenancy|Shared DB + `tenant` FK (schema-per-tenant emas)|
|Tenant aniqlash|**Faqat JWT dan**, so'rov parametridan/frontendan emas|
|Ruxsat|`Employee.permissions` → custom `apps/permissions.Permission` (`category`+`codename`). `user.user_permissions` **emas** — tenant transferda eski ruxsat qolmasin|
|`User` vs `BaseModel`|`User` `BaseModel`dan meros olmaydi (`tenant` nullable — `platform_admin`/yangi yaratilgan owner uchun)|
|Media|S3-mos obyekt xotirasi, server diski emas|
|Internal endpoint|Faqat Docker ichki tarmog'ida, tashqariga ochilmaydi|

### 1.1. Rol ierarxiyasi

|Rol|Kim tayinlaydi|Vakolat|
|---|---|---|
|`platform_admin`|Tizim (qo'lda / superuser)|Cheklovsiz. Owner tayinlash **faqat** shu rol|
|`owner`|Faqat `platform_admin` (Tenant yaratish orqali, telefon raqami bilan)|O'z tenantida faqat `staff` hire/fire; barcha ruxsatlarga tenant ichida to'liq ega|
|`staff`|Faqat `owner` (o'z tenantida, telefon raqami bilan)|Userlarni hire/fire qila olmaydi|

~~`customer`~~ — **ILBI'da endi mavjud emas** (Shop'ga ko'chirildi).

Har bir rol faqat o'zidan **bitta past** darajani boshqaradi: `platform_admin` → `owner`, `owner` → `staff`. `hire()` orqali `platform_admin` yoki `owner` berib bo'lmaydi — `owner` faqat Tenant yaratish/almashtirishda.

### 1.2. Employee — owner uchun ham (Variant A)

Owner tayinlanganda ham `hire()`: `Employee` (`position="Owner"`, `is_active=True`).

- Tarixning yagona manbai — `Employee` jadvali
- ✅ **YOPILDI (G bandi):** `fire()` qilingan userning `role`i **saqlanadi** (audit uchun), `customer`ga o'girilmaydi (Variant A). Bu xavfsizlik teshigi ochmasligi uchun — `PermissionService` va `password_reset_service` endi `role`ga emas, **faol `Employee` yozuviga** qaraydi (2026-09'da tasdiqlandi, `test_former_owner_denied_after_change_owner` bilan qamrab olingan)

`Employee.user`: `ForeignKey` + partial unique (`is_active=True`).

### 1.3. `EmployeeService.hire()`

```
hire(target_user, tenant, hired_by, permissions, position="", role="staff")
```

1. `role == "staff"` → `hired_by.role in ("owner", "platform_admin")`. `role == "owner"` → `hired_by.role == "platform_admin"`.
2. ~~Faol Employee bo'lsa — avtomatik `fire()`, keyin yangisi~~ **BEKOR QILINDI.** Yangi qaror: agar `target_user`ning boshqa joyda (yoki shu tenant'da) faol `Employee` yozuvi bo'lsa — **hire to'siladi**, `EmployeeServiceError` qaytariladi. _(Kod hali yangilanmagan — bajarilishi kerak.)_
3. `username`/`password`ga **tegmaydi**.
4. `User.role`, `User.tenant` yangilanadi; `Employee` yaratiladi; `permissions` berilsa M2M ga yoziladi. ✅ (`permission_ids` → `permissions=` uzatilishi tuzatildi)
5. `platform_admin`ni hire qilib bo'lmaydi.

### 1.4. `EmployeeService.fire()`

1. Faol Employee: `is_active=False`, `fired_at=now()`, `fired_by`
2. ✅ `User.role` **saqlanadi** (o'zgartirilmaydi, audit uchun), `User.set_unusable_password()` chaqiriladi

**Saqlanadi (tozalanmaydi):** `User.username`, `User.tenant`, `User.role` (barchasi tarix uchun). Ruxsat esa `role`ga emas, faqat `Employee.is_active`ga qaraydi — shuning uchun saqlab qolingan `role` hech qanday amaliy huquq bermaydi.

**JWT qoidasi:** `User.tenant` fire'dan keyin ham qoladi. Token / tenant-scoping **faqat** `role in ("staff", "owner")` da `User.tenant`dan foydalanadi. `platform_admin` uchun `tenant_id` claim **har doim `null`**.

### 1.5. Tenant

```
Tenant: name (unique), owner (OneToOneField User, majburiy), description (blank), is_active, created_at
# slug YO'Q
```

`TenantService.create_with_owner(name, owner_phone_number, created_by)` — faqat `created_by.role == "platform_admin"`:

1. Berilgan telefon raqami bo'yicha `User` mavjudmi tekshiriladi; bo'lmasa — yangi `User` yaratiladi (`role="owner"`, `profile_completed=False`) — ✅ **kod ham yangilangan** (`owner_phone_number` parametri qo'shildi, get-or-create; `owner_user: User` eski yo'l ham orqaga mos ravishda ishlaydi)
2. `owner_user` platform_admin bo'lsa — xato
3. Allaqachon boshqa tenant owner bo'lsa — tushunarli xato
4. Tenant yaratiladi
5. `EmployeeService.hire(..., role="owner", position="Owner")`

O'chirish: hard-delete yo'q, `is_active=False`.

`OneToOneField(owner)`: bir vaqtda bitta tenant. Umrida faqat bir marta owner bo'lishi shart emas — almashtirilsa, keyin boshqa tenantga owner bo'lishi mumkin. Tarix `Employee`da.

`TenantService.change_owner(tenant, new_owner, changed_by)`: faqat platform_admin; eski owner `fire()`, yangisi `hire(role="owner")`.

**Owner permission — ✅ YOPILDI:** owner o'z tenant'i ichida har doim to'liq huquqli, `Employee.permissions` orqali tekshirilmaydi.

### 1.6. Username / password — ✅ dizayn qarori qabul qilindi

- ILBI'da endi `customer` yo'q, shuning uchun bu band faqat `staff`/`owner`/`platform_admin`ga tegishli
- **Email orqali** o'rnatiladi/o'zgartiriladi (Telegram OTP orqali **emas** — login 2FA'dan alohida kanal bo'lishi kerak, xavfsizlik uchun)
- `User.email` — staff/owner uchun **majburiy** qilinadi (hozir `complete_profile`da ixtiyoriy)
- Hech kim (owner ham) boshqasining parolini to'g'ridan-to'g'ri qo'ya olmaydi
- **Kirish** (allaqachon kodlangan, 6b): mavjud username+password + Telegram OTP. Bu — "birinchi marta qo'yish" emas, 2FA login
- **Ochiq qoldi:** aniq endpointlar (`request-email-code`, `verify-and-set-password` kabi), email yuborish infratuzilmasi (`django.core.mail`, SMTP sozlamalari `.env`ga) — bular hali loyihalanmagan, keyingi ish

### 1.7. Sotuv (POS), 1-narx (Partner price) va Filial Izolyatsiyasi

- **Galochka mantiqi (`use_partner_price`):**
  - Galochka o'chiq paytda: mahsulot qidirilganda va ko'rsatilganda 2 ta narx ko'rinadi (`price_min` va `price_recommended`).
  - Galochka yoqilgan paytda: barcha mahsulotlar qidiruvda ham, savatda ham **faqat 1-narx (`price_partner`)** bo'yicha ko'rinadi va hisob-kitob qilinadi.
  - **1-narx bo'sh yoki 0 bo'lsa:** agar savatdagi tovarning `price_partner` qiymati bo'sh yoki 0 bo'lsa, tizim sotishga yo'l qo'ymaydi va xatolik beradi (`"1-narx to'ldirilishi majburiy"`).
  - Kassir narxni qo'lda erkin o'zgartira oladi (yuqori yoki past qilib).
  - **Tannarxdan past narxda sotilsa:** bloklanmaydi, faqat ogohlantirish qaytariladi (*"Siz tovarni juda arzon narxda sotuv qilyapsiz, bunga ishonchingiz komilmi?"*).
  - **Audit:** Chekda (`Sale.is_partner_sale=True`), tovar satrida esa sotilgan amaldagi narx (`unit_price`) bilan birga tovarning o'sha paytdagi asl 1-narxi (`original_partner_price`) saqlanadi.
  - **Chekdagi qatorlar soni:** Bitta chekda ko'pi bilan 100 ta tovar qatori bo'lishi mumkin.
  - **Deadlock himoyasi:** Ombordan tovarlar yechilayotganda `Stock` yozuvlari `product_variant_id` bo'yicha o'sish tartibida qulflanadi (`select_for_update()`). Birortasida qoldiq yetmasa, butun sotuv bekor bo'ladi (`transaction.atomic`).
  - **Filial bo'yicha qat'iy ajratish:** POS da faqat ayni tanlangan filialda mavjud bo'lgan (`quantity > 0`) tovarlar chiqadi. Boshqa filial tovarlari yoki 0 qoldiq ko'rinmaydi ("Tugagan" / "0 dona" kartochkalari chiqarilmaydi). Filial o'zgarganda savat avtomatik tozalanadi (`resetCart()`).

### 1.8. Kontragentlar (`Counterparty`) va Do'konlararo B2B Tovar O'tkazish

- **Kontragentlar ro'yxati:**
  - `owner` va tegishli ruxsatga ega `staff` yangi kontragent qo'sha oladi.
  - Ma'lumotlari: `name`, `phone_number`, `target_tenant` (nullable FK), `debt_balance_uzs`, `debt_balance_usd`, `note`, `is_active`.
  - **O'chirish taqiqlanadi:** Tarix va qarz mavjudligi sababli kontragent o'chirilmaydi, faqat arxivlanadi (`is_active=False`).
  - **Avtomatik Tenant aniqlash:** Kontragent kiritilganda uning telefon raqami bo'yicha tizimda `User` va uning faol `Employee` yozuvi qidiriladi. Agar u biror do'konda ishlasa yoki do'kon egasi (`owner`) bo'lsa, o'sha do'kon `target_tenant` sifatida avtomatik bog'lanadi.
- **B2B Sotuv / O'tkazish oqimi:**
  - Agar tanlangan kontragentda `target_tenant` mavjud bo'lsa, bu sotuv **B2B transfer** sifatida ro'yxatga olinadi.
  - **Ombor harakati:** Jo'natuvchi A do'kon omboridan tovarlar o'sha zahoti chiqariladi (`direction='out'`, `type='sotuv'`).
  - **Bildirishnoma:** B do'kon egasiga (har doim **OWNER**ga, hatto kontragent xodim bo'lsa ham) tizim ichidagi bildirishnoma (in-app) va Telegram bot orqali havolali xabar yuboriladi: *"Sizga [A Do'kon] dan tovarlar yuborildi. Qabul qilasizmi?"*.
  - **Statuslar:** `b2b_pending` (kutilmoqda) → `b2b_accepted` (to'liq qabul qilindi) / `b2b_partially_accepted` (qisman qabul qilindi) / `b2b_rejected` (rad etildi).
  - **1 haftalik avtomatik bekor bo'lish:** 7 kun davomida javob berilmasa, transfer avtomatik tarzda `b2b_rejected` deb belgilanadi.
- **Qabul qilinganda katalogga biriktirish (B tanlovi):**
  - B qabul qilish paytida tovar o'zining qaysi kategoriyasiga qo'shilishini **o'zi tanlaydi** (tovarning valyutasi bilan kategoriya valyutasi mos kelishi shart).
  - Agar B do'konda bu tovar allaqachon mavjud bo'lsa — B uni mavjud variantga biriktirib, faqat ombordagi qoldiqni oshirishi mumkin (dublikat tovar yaratilmaydi).
  - **Tannarx:** A do'kon sotgan narx B do'kon uchun kirim tannarxi (`cost_price` / `last_cost_price`) bo'ladi.
  - **Sotish narxlari:** Default `0` (B do'kon egasi A ning ustamasini ko'rmaydi, keyin o'zi sotuv narxini belgilaydi).
  - **`SKU` va `code`:** B do'kon o'zining navbatdagi SKU tartibi bo'yicha yangi `sku` oladi, `code` esa bo'sh qoladi.
- **Rad etilganda yoki qisman qabul qilinganda ombor xatti-harakati:**
  - B tovarlarni to'liq yoki qisman rad etsa, rad etish sababi A do'konga bildirishnoma orqali yuboriladi.
  - Rad etilgan tovarlar A do'kon omboriga **avtomatik qaytmaydi** va B ning qarzi avtomatik kamaymaydi (chunki tovarlar jismonan yo'lda).
  - A do'kon rad etilgan tovarlarni qaytarib olgach, tizimda "Qaytarib olish (Void)" tugmasini bosadi — shundagina tovarlar A omboriga kirim bo'ladi va B ning qarzi kamayadi.

### 1.9. Qarz (Nasiya), "Haqq" (Kredit balans) va Ogohlantirishlar

- Kontragentlarda ikki valyutada alohida balans yuritiladi: `debt_balance_uzs` va `debt_balance_usd`.
- **Ishorali balans (Signed):**
  - Musbat (`+`) = mijoz do'kondan qarzdor.
  - Manfiy (`-`) = do'kon mijozdan qarzdor (mijozning haqqi bor).
  - Agar mijozning haqqi bo'lsa va u yana qarzga tovar olsa, yangi qarzdan mavjud haqqi avtomatik chegirib qolinadi.
- **Chegara ogohlantirishlari:**
  - So'mda: har **10 million so'm** oshganda (10 mln, 20 mln, 30 mln...) do'kon egasiga (owner) in-app va Telegram orqali ogohlantirish yuboriladi (`last_notified_debt_step_uzs`).
  - Dollarda: har **1 000 USD** oshganda (1000, 2000, 3000...) ogohlantirish yuboriladi (`last_notified_debt_step_usd`).
  - Qarz to'langanda yoki kamayganda tegishli `step` qiymati orqaga qaytariladi, toki keyingi safar chegara oshganda yana ogohlantirish borsin.

### 1.10. Valyuta Tizimi (UZS va USD)

- **Kategoriya darajasidagi valyuta:** Asosiy `Category` yaratilishida uning valyutasi (`UZS` yoki `USD`) belgilanadi.
- **Meros olish:** Barcha subkategoriyalar va ulardagi mahsulot variantlari ota kategoriyaning valyutasini to'liq meros oladi va o'zgartirib bo'lmaydi.
- **Savatdagi aralash tovarlar:** Agar xaridor bitta savatda ham UZS, ham USD tovarlarni olsa, backend bitta atomik tranzaksiya ichida avtomatik **2 ta alohida chek** (`Sale`) yaratadi: bittasi UZS, ikkinchisi USD cheki.
- **Do'konning ichki dollar kursi:** Do'kon egasi (owner) o'z do'koni uchun ichki dollar kursini (`Tenant.usd_rate`, masalan: `12 800`) kiritib qo'yadi. Bu kurs tovarlar ro'yxatida "Barchasini dollarda ko'rsatish" tugmasi yoqilganda so'mdagi tovarlarni ko'rgazmali hisoblash uchun xizmat qiladi.

### 1.11. Universal Bekor Qilish (Void) va Qisman Qaytarish

- **1 haftalik muddat:** Har qanday sotuv (oddiy mijozga, tanishga yoki B2B) sotuv sanasidan boshlab **qat'iy 1 hafta (7 kun)** ichida bekor qilinishi mumkin.
- **Majburiy izoh:** Bekor qilishda `void_reason` kiritilishi shart.
- **B2B to'siq:** Agar B do'kon B2B o'tkazmani `accept` qilib bo'lgan bo'lsa, A do'kon uni void qila olmaydi (tenant izolatsiyasi qoidasi).
- **Qisman va miqdor bo'yicha qaytarish:** Butun chekni bekor qilish shart emas; chek ichidagi alohida tovar yoki tovarning ma'lum miqdori (masalan, 10 donadan 3 tasi) qaytarilishi mumkin.
- Chek statusi `partially_voided` bo'ladi, barcha qatorlar to'liq bekor bo'lgandagina `voided` bo'ladi.
- Qaytarilgan tovarlar omborga qaytadi (`StockService.customer_return()`), agar qarzga olingan bo'lsa, qaytarilgan qism summasi qarzdan chegiriladi. Barcha void harakatlari `SaleVoidLog` jadvalida saqlanadi.

### 1.12. Qarz To'lovlari (`DebtPayment`) Auditi

- Qarz to'lovlarini faqat `owner` va `platform_admin` kiritishi mumkin (staff kiritolmaydi).
- Qarz to'lovi yozuvini bazadan o'chirib bo'lmaydi.
- Agar xato summa kiritilgan bo'lsa, "Tuzatish" orqali majburiy izoh bilan teskari korrektirovka yozuvi kiritiladi (`is_correction=True`), bu balansni to'g'rilaydi va to'liq audit tarixini saqlaydi.
- Ruxsati bor `staff` to'lovlar tarixini ko'rishi mumkin.

### 1.13. Ko'p Filialli Tizim (Multi-Branch) va Filiallararo Tovar Transferlari (Stock Transfers)

- **`Branch` modeli (`apps/tenants/models.py`):**
  - Maydonlari: `tenant`, `name`, `code`, `address`, `phone_number`, `is_main`, `is_active`.
  - Har bir tenantda kamida bitta filial bo'ladi va ulardan bittasi asosiy (`is_main=True`). Asosiy filial o'chirilmaydi. Boshqa filial asosiy qilib belgilanganda avvalgisi `is_main=False` qilinadi.
- **`Stock` modeli (`apps/inventory/models/stock_model.py`):**
  - Endi OneToOne emas, balki `ForeignKey("tenants.Branch", related_name="stocks")` va `product_variant`ga bog'langan.
  - Qat'iy cheklov: `UniqueConstraint(fields=["branch", "product_variant"], name="unique_stock_per_branch_variant")`.
  - `quantity >= 0` cheklovi har bir filial omborida mustaqil tekshiriladi.
- **Filial darajasidagi maxsus narxlar:**
  - `custom_price_recommended`, `custom_price_min`, `custom_price_partner`.
  - Agar filialda narx belgilangan bo'lsa, variantning umumiy narxi o'rniga ayni filial narxi qo'llaniladi (narxlar ustunligi). Agar bo'sh bo'lsa, umumiy variant narxi ishlatiladi.
- **Filiallararo Tovar Transferi (`StockTransfer` va `StockTransferItem`):**
  - `from_branch` va `to_branch` (ikkisi ham bitta tenantga tegishli bo'lishi shart).
  - Statuslar: `pending` (jo'natilgan, yo'lda), `completed` (qabul qilingan), `cancelled` (bekor qilingan).
  - **Jo'natish:** Jo'natuvchi filial omboridan tovarlar darhol yechiladi (`transfer_out` harakati).
  - **Qabul qilish:** Qabul qiluvchi filial xodimi transferni qabul qilganda, `StockService.transfer_in()` orqali tovarlar qabul qiluvchi filial omboriga kirim bo'ladi va status `completed` bo'ladi.
  - **Bekor qilish:** Jo'natuvchi transferni bekor qilsa, tovarlar `from_branch` omboriga qaytariladi va status `cancelled` bo'ladi.

### 1.14. Filiallararo Qat'iy Izolyatsiya (Strict Branch Isolation in POS & Inventory)

- **Asosiy qoida:** Foydalanuvchi biror filialga (masalan, "Chilonzor filiali") o'tganda va POS (Tezkor kassa) ochilganda, boshqa filialga tegishli yoki o'sha tanlangan filialda qoldig'i 0 bo'lgan tovarlar umuman ko'rinmasligi, "Tugagan" yoki "0 dona" deb chiqmasligi va butunlay izolyatsiyalanishi shart.
- **POS Vitrinasi:**
  - Faol filial tanlanganda (`branch_id` / `activeBranch`), `GET /api/v1/catalog/variants/?branch_id=X&in_stock=true` so'rovi yuboriladi.
  - Backendda: `qs.filter(stocks__branch=branch, stocks__quantity__gt=Decimal('0.000')).distinct()`.
  - Boshqa filialdagi yoki qoldig'i 0 bo'lgan tovarlar ro'yxatdan butunlay chiqarib tashlanadi. POS vitrinasida "Tugagan" / "0 dona" kartochkalari ko'rsatilmaydi.
  - Agar tanlangan filialda tovar bo'lmasa: toza va chiroyli bo'sh holat ko'rsatiladi: *"Ushbu filial omborida mahsulot mavjud emas yoki qoldig‘i 0 ga teng."*
- **Kassirlar va Xodimlar:**
  - Kassirlar o'zlarining biriktirilgan filialiga qat'iy bog'lanadi (`Employee.branch`). Ular faqat o'z filiallari bo'yicha sotuv qiladi va ma'lumotlarni ko'radi.
- **Do'kon Egasi (`owner`) va Filial Switcher:**
  - Do'kon egasi headerdagi filial switcher orqali filialni almashtirganda:
    - POS va Kassa tanlangan filialga to'liq moslashadi.
    - **Savatni avtomatik tozalash (`resetCart()`):** Agar operator bir filialda tovarlarni savatga solib, so'ngra boshqa filialga o'tsa, savat avtomatik tozalanadi va ogohlantirish beriladi. Bu boshqa filial tovari yangi filial nomidan adashib sotilib ketishining oldini oladi.
- **Global Katalog va Kirim Oynasi:**
  - Mahsulotlar katalogi (`/catalog`) va Ommaviy kirim oynasi (`/inventory` intake) global bo'lib qoladi (`branch_id` yuborilmaydi). Do'kon egasi butun mahsulotlar bazasini boshqarishi va har qanday tovar partiyasini istalgan filialga kirim qila olishi ta'minlangan.
- **Ombor harakatlari va Kamomad:**
  - `GET /api/v1/inventory/movements/?branch_id=X` va `GET /api/v1/inventory/deficits/?branch_id=X` orqali ombor harakatlari va kamomadlar ham faol filial bo'yicha qat'iy ajratiladi.

### 1.15. Kassa Smenalari, Z-Hisobot va Imzolar Xavfsizligi (Signatures Audit)

- **Filial bo'yicha Smena:** Har bir filial uchun alohida `Shift` ochiladi va yopiladi.
- **Z-Hisobot Cheki va Valyutalar:**
  - Z-Hisobot chekida USD va UZS operatsiyalari (savdolar, tushumlar, kassa chiqimlari) qat'iy ravishda o'z valyutasida, maxsus ajratilgan blokda ko'rsatiladi ($ va UZS raqamlari bir-biriga qo'shilmaydi).
  - Modal ochilganda avval chiroyli vizual xabarnoma/hisobot interfeysi (Notification / Executive Summary) ko'rinadi.
  - Bosma kassa cheki (Thermal receipt slip) faqat operator "Chop etish" (Print) tugmasini bosgandagina ochiladi.
- **Elektron Imzolar Xavfsizligi va Auditi (Immutable Signatures):**
  - **Savdo Hisob-Fakturalari (A4 Invoice - `InvoiceA4Modal.jsx`):** Chiqim fakturasi, Nasiya yuk xati va Ulgurji hamkor fakturalarida sotuvchi va xaridor ekranda imzolaganidan so'ng, imzolarni qayta yangilash yoki o'zgartirish ("Imzolarni yangilash") butunlay yopildi va qulflanadi (`hasSignatures` bo'lganda faqat `Imzolangan (O‘zgartirib bo‘lmaydi)` locked badge chiqadi). Hech kim imzolangan fakturani qaytadan imzolay yoki o'zgartira olmaydi.
  - **Smena Imzolarining Xavfsizligi va Auditi:** Smena yopishda kassa mas'uli imzosi olinadi (`signature` canvas). Imzolarni tozalash (Clear) imkoniyati interfeysdan butunlay olib tashlangan — imzo bir marta qo'yilgandan keyin o'chirib bo'lmaydi. Faqat qayta chizish mumkin, lekin tizimdan butunlay o'chirib tashlash qat'iyan taqiqlangan! Bu mas'uliyat va tekshiruv (audit) talabidir.

### 1.16. Ommaviy Partiya Kirimi (Rapid Barcode Scanner Intake Workspace & Draft Persistence)

- **Kassa/Skaner Uslubidagi Tezkor Kirim Interfeysi (`RapidStockIntakeModal.jsx`):**
  - Tovarlar ko'payganda variantlar ichidan qidirib o'tirish vaqtini tejash uchun yaratilgan.
  - Shtrix-kod skaneri yoki tezkor qidiruv orqali tovar tanlanadi va Enter bosilishi bilan jadvalga qator bo'lib tushadi.
  - Jadvaldagi maydonlar: Tovar nomi, SKU/Kod, Partiya miqdori, Kirim tannarxi (`cost_price`), Tavsiya etilgan sotuv narxi (`price_recommended`), Minimal narx (`price_min`), 1-narx (`price_partner`), O'chirish tugmasi.
  - Har bir tovar qatorida narxlar va miqdorlar joyida (inline) tahrirlanadi.
- **Qoralamalarning Saqlanishi (Offline / LocalStorage Draft Persistence):**
  - `ilbi_stock_intake_full_draft_v1` kaliti orqali LocalStorage da to'liq partiya qoralamasi saqlanadi.
  - Operator partiyani to'plab turib, boshqa bo'limlarga (masalan, katalogga tovar ma'lumotini o'zgartirishga, sotuv qilishga yoki sozlamalarga) o'tib qaytganda yoki tasodifan sahifani yangilaganda ham to'plangan jadval va kiritilgan barcha narxlar yo'qolmaydi!
  - Partiya to'liq qabul qilinib, "Omborga kirim qilish" bosilgandagina qoralama avtomatik tozalanadi.
- **`POST /api/v1/inventory/intake/batch/`:**
  - Backend bitta atomik tranzaksiya ichida barcha tovar variantlari bo'yicha `StockService.batch_intake()`ni chaqiradi, har biriga `cost_price` va `quantity` bo'yicha `kirim` harakatlarini yozadi va filial omborini yangilaydi.

### 1.17. Kamomad (Deficit) Tizimi va Telegram Hisobotlari

- **Kamomad mezoni (`DeficitService`):**
  - Oxirgi 30 kunlik haqiqiy sotuvlar soni >= 10 ta (`threshold_sales`).
  - Va ayni paytdagi ombor qoldig'i <= 5 ta (`threshold_stock`).
  - Ikkala shart bajarilgan tovarlar avtomatik tarzda "Kamomad / Deficit" ro'yxatiga kiradi.
- **Dinamik Yechim (Avtomatik Chiqish):**
  - Yangi partiya kirim qilinib, qoldiq 5 tadan oshgan zahoti tovar avtomatik tarzda kamomad ro'yxatidan tushib qoladi (qo'lda o'chirish talab qilinmaydi).
- **Filial bo'yicha kamomad:**
  - Kamomad faol filial kesimida hisoblanadi (`branch` filtri).
- **Telegram va Avtomatika:**
  - Celery Beat har kuni belgilangan vaqtda do'kon egasiga Telegram bot orqali kamomad ro'yxatini yuboradi.
  - Do'kon egasi istalgan vaqtda "Hoziroq yuborish" (`POST /api/v1/inventory/deficits/send-report-now/`) orqali dolzarb hisobotni Telegramiga chaqirib olishi mumkin.
- **Ombor Qoldiq Filterlarining Yaxshilanishi:**
  - Kamomadlar alohida "Kamomad" tabiga chiqarilgani sababli, `Inventory.jsx` dagi noqulay va ortiqcha filter tugmalari (`Yetarli`, `Kam qolgan`, `Tugagan`) olib tashlandi va ixcham bitta qatorli qoldiq holati filtri joriy etildi.

### 1.18. Dashboard va Statistikada Tushum va Nasiyani Qat'iy Ajratish (Cash Flow vs Receivables)

- **Tushum va Nasiyani Ajratish Asosi:**
  - Nasiyaga (qarzga) berilgan tovarlar summasi (masalan $2.800) kassa tushumi (tushum) emas! Nasiya — bu kutilayotgan debitorlik qarzidir.
  - Kassa tushumi faqat kassaga amalda kelib tushgan naqd pul va bank kartasi to'lovlaridan iborat.
- **Statistika Kartalari va Metrikalari:**
  - **Haqiqiy Kassa Tushumi (Cash Inflow):** Faqat Naqd va Karta to'lovlari yig'indisi.
  - **Nasiya Savdosi (Credit Sales / Receivables):** Qarzga berilgan tovarlar hajmi.
  - **Sof Foyda (Net Profit):** Savdodan olingan foyda (sotish narxi - tannarx, bekor qilinganlar chegirilgan).
  - **Jami Qarz Balansi (Total Debt):** Mijozlar va kontragentlarning jami qarzdorligi.
  - Barcha ko'rsatkichlar UZS va USD valyutalarida alohida, mustaqil hisoblanadi va aralashtirilmaydi.

---

## 2. Texnik poydevor (qayerda nima yashaydi)

```
ilbi/
  backend/                 # Django + DRF (core backend — do'konning ichki boshqaruvi)
    apps/
      core | tenants | accounts | tg_bot | permissions | catalog | inventory | sales | cashbox | analytics
    apps/accounts/services/ # employee_service, tenant_service, permission_service, otp_services, login_throttle, phone_utils
    apps/inventory/services/# stock_service, deficit_service
    apps/sales/services/    # sale_service, debt_service, void_service, b2b_transfer_service
    apps/cashbox/services/  # cashbox_service
    apps/analytics/services/# analytics_service
    api/v1/                 # HTTP qatlam (accounts, tenants, tg_bot, catalog, inventory, sales, cashbox, analytics)
    api/permissions.py      # IsInternalService, IsPlatformAdmin, IsOwner, IsTenantMember, HasEmployeePermission, ...
    config/settings.py      # Production & local sozlamalar (MinIO storages, Celery, Redis)
    config/settings_test.py # pytest: .env.test → alohida Postgres/Redis
    docker-compose.test.yml # host 5433 / 6380
  frontend/ilbi/        # React 18 + Vite SPA (zamonaviy dark/glassmorphism UI)
    src/pages/              # Dashboard, POS, Catalog, Inventory, Sales, Counterparties, Shifts, Analytics, Branches, Employees, Settings
    src/components/         # RapidStockIntakeModal, StockTransferModal, ShiftCloseModal, ThermalReceipt, ...
    src/context/            # AuthContext, BranchContext, ThemeContext, ToastContext, ConfirmContext
    src/hooks/              # usePersistedState (LocalStorage draft/cart sync)
    src/api/client.js       # Yagona REST API mijoz
  Shop/                     # FastAPI, o'z bazasi bilan — shop-yol-xaritasi.md
  telegram_bot_sms/         # aiogram listener (ikki xizmatli: OTP, B2B bildirishnomalar, Z-hisobot, kamomad)
  Architectures/            # ilbi-yol-xaritasi.md + shop-yol-xaritasi.md
  docker-compose.yml        # postgres, redis, minio, ilbi, celery_worker, celery_beat, bot, frontend, nginx
```

- Biznes logika `views.py`da emas, `services/`da
- Test: `uv run pytest` (`config.settings_test`, Postgres + Redis konteynerlari bilan)


---

## 3. Bosqichlar (0 dan tugaguncha)

### 0-bosqich — Boshlang'ich sozlash ✅

- [x] `uv`, Django, DRF, `simplejwt`, `django-environ` / dotenv, `django-filter`, `psycopg`
- [x] Loyiha skeleti (`config`, `manage.py`), `apps/` tuzilmasi, `.env`

### 1-bosqich — `core` va `tenants` ✅

- [x] `BaseModel`: `tenant`, `created_at`, `updated_at`, `abstract=True`
- [x] `Tenant` modeli (yakuniy shakl: `name`, `owner`, `description`, `is_active`, `created_at`; `slug` yo'q)
- [x] PostgreSQL sozlamasi (development/test da compose orqali)

### 2-bosqich — `accounts`: custom User ✅

- [x] `User(AbstractBaseUser, PermissionsMixin)`: `phone_number` (USERNAME_FIELD, unique, normallashtiriladi), `username`, `email`, `first_name`, `last_name`, `date_of_birth`, `tenant` (nullable FK), `role`, `is_active`, `is_staff`, `is_phone_verified`, `profile_completed`, `created_at`
- [x] `UserManager`: `create_user`, `create_superuser`
- [x] `AUTH_USER_MODEL = 'accounts.User'`
- [x] `Employee`: FK `user`, `position`, `hired_at`, `fired_at`, `is_active`, `hired_by`, `fired_by`, `permissions` M2M → `apps.permissions.Permission`, partial unique faol yozuvga
- [x] **Yangi:** `User.role` tanlovlaridan `"customer"`ni olib tashlash — ✅ `ROLE_CHOICES`dan olib tashlandi, `default='customer'` ham olib tashlandi (`role` endi majburiy maydon, fail-loud). Migratsiyalar (`0001_initial`/`0002_initial`) qayta generatsiya qilindi (2026-09)

### 3-bosqich — Telegram OTP (register / login) — ⚠️ **Shop'ga ko'chiriladi**

Bu butun bosqich **customer**ga tegishli edi. Customer ILBI'dan chiqarilgani sababli, quyidagi bandlar **Shop'da qaytadan yoziladi**, ILBI'dan esa olib tashlanadi:

- [x] ~~Register / login request-otp va verify-otp~~ → Shop'ga
- [x] ~~`customer_login_throttle`~~ → Shop'ga
- [x] **Yangi vazifa:** ILBI'dan `register.py`, customer `login.py` qismi, `customer_login_throttle.py`, tegishli testlarni olib tashlash ✅

**ILBI'da qoladigan qism** (bu — customer emas, staff/owner 2FA'si uchun, alohida band sifatida pastga, 6-bosqichga ko'chirildi):

- [x] `TelegramContact` (`phone_number` unique, `chat_id`)
- [x] Internal endpoint + `IsInternalService`
- [x] `send_telegram_message()`, OTP servis (Redis)
- [x] Bot listener (`telegram_bot_sms`) — **endi ikki xizmatli, deep-link bilan** ✅

### 4-bosqich — `EmployeeService` ✅ **TO'LIQ BAJARILDI**

- [x] `hire()` — 1.3 qoidalari, `select_for_update`
- [x] `fire()` — 1.4 qoidalari (Variant A bo'yicha: `role` saqlanadi, `set_unusable_password()`, faol employment yopiladi) ✅
- [x] Unit testlar: staff hire qila olmasligi, tarix, parol yopilishi
- [x] **Yangi:** "avtomatik transfer" mantig'ini "to'siq" mantig'iga almashtirish (1.3, 2-band) ✅
- [x] **Yangi:** `target_user` bilan birga `phone_number` qabul qilish, ichida get-or-create ✅

### 4.5-bosqich — `TenantService` va Tenant API ✅ **TO'LIQ BAJARILDI**

- [x] Model + migratsiya yakuniy sxema (`slug` yo'q)
- [x] `create_with_owner()`, `change_owner()`
- [x] API: list/create, detail/edit, change-owner, activate, deactivate
- [x] Unit testlar
- [x] Owner hire dagi `permissions` to'plami — ✅ **YOPILDI** (owner har doim to'liq huquqli)
- [x] **Yangi:** `create_with_owner()`ga `owner_phone_number` parametrini qo'shish va get-or-create qilish ✅

### 4.6-bosqich — Employee API ✅ **TO'LIQ BAJARILDI**

- [x] `POST /api/v1/tenants/{tenant_id}/employees/hire/` · `fire/`
- [x] `tenant_id` URL dan; `_resolve_tenant_or_403`
- [x] Ruxsat: autentifikatsiya + rol/tenant tekshiruvi
- [x] Hire view `permission_ids`ni servisga uzatishi — ✅ **YOPILDI**
- [x] `target_user_id` bilan bir qatorda `phone_number` qabul qilish (serializer + view) ✅
- [ ] UI/serializer: owner formida `role` tanlovi umuman ko'rinmasin — frontend/admin panel yozilganda

### 5-bosqich — Ruxsat tizimi ✅ **TO'LIQ BAJARILDI**

- [x] `PermissionService.has_permission(user, "category.codename")` — faqat **faol** `Employee.permissions`
- [x] `platform_admin` — har doim ruxsat
- [x] `owner` — har doim ruxsat (o'z tenant'i doirasida, tenant-scoping alohida klasslar orqali)
- [x] `customer` — bu rol ILBI'da endi yo'q, shunday ham `has_permission` `False` qaytaradi
- [x] `HasEmployeePermission` (DRF `BasePermission`): `required_permission` yoki `permission_map`
- [x] Owner uchun default permission qarori — owner bypass qiladi, alohida to'plam kerak emas
- [x] Hire API orqali staff'ga permission berish — ulandi
- [x] Unit testlar: faol employee, fire qilingan employee ruxsati yo'qolishi, `platform_admin`/`owner`/`customer`/anonim holatlar
- [x] **Ruxsat modeli custom `apps/permissions.Permission`ga ko'chirildi** (Django'ning ContentType-bog'liq `Permission`i o'rniga)
- [x] Biznes modellardagi ruxsatlar — `catalog` uchun 8 ta codename **kod bilan `Permission` jadvaliga kiritildi** (`apps/catalog/migrations/0002_seed_permissions.py`, data-migration). Qolgan app'lar (inventory/sales/...) o'zlarining migratsiyasida shu naqshni takrorlaydi

### 6-bosqich — JWT claimlar, admin login, identity oqimlari 🔶

- [x] Custom `simplejwt` / `issue_tokens` kengaytmasi: token ichida `role`; `tenant_id` faqat `staff`/`owner`, aks holda `null` (**6a BAJARILDI ✅**)
- [x] Admin panel login: `POST .../auth/admin-login/` + `.../verify-otp/`
- [x] Ikkinchi omil: Telegram OTP
- [x] Progressiv throttle + 3 strike ban
- [x] **Unban:** `platform_admin` `is_active=True` qiladigan endpoint — **✅ YOZILDI** (`POST /api/v1/auth/unban/`)
- [ ] Owner/staff uchun customer qidiruv — **Shop'ga ko'chadi** (customer ILBI'da yo'q)
- [x] **1.6 dizayni** — ✅ qaror qabul qilindi (email orqali), endpointlar ham yozilgan (7-bosqichga qarang)
- [ ] Email orqali parol o'rnatish/tiklash — **endpointlar loyihalanishi va yozilishi kerak**
- [x] Customer serializerlarida username/password chiqmaydi (tasdiqlandi — customer ILBI'da hali qolgan davrda ham bu tekshirilgan edi)
- [x] API testlar: admin login, mask, OTP → JWT, throttle, ban, unban
- [x] Unit/API testlar: JWT claim qoidalari (`test_jwt_claims.py` va admin-login testlari) ✅

### 7-bosqich — Parolni tiklash / birinchi marta o'rnatish (email magic-link) ✅

Admin panel foydalanuvchilari uchun; Telegram OTP'dan **mustaqil** ("birinchi marta o'rnatish" va "tiklash" — bitta oqim).

- [x] Email yuborish infratuzilmasi (`django.core.mail`, SMTP `.env`ga; dev/test'da `locmem` backend) ✅
- [x] Bir martalik magic-link reset flow: `PasswordResetService` (Redis `pwd_reset:{token}`, TTL 24h, cooldown 60s) ✅
- [x] Faqat username+password ishlatadigan rollar (staff/owner/platform_admin) himoyalangan ✅
- [x] Rate-limit (cooldown) va token TTL (Redis, `pwd_reset_cooldown:{user_id}`) ✅
- [x] `PasswordResetRequestView` + `PasswordResetConfirmView` — unauthenticated, `/api/v1/auth/password-reset/` ✅
- [x] `PasswordResetRequestSerializer` + `PasswordResetConfirmSerializer` ✅
- [x] `TenantCreateSerializer`: `owner_email` maydoni qo'shildi ✅
- [x] `TenantListCreateView`: `owner_email` servisga uzatiladi ✅
- [x] Unit va API testlar: `test_password_reset.py` (22 test) ✅

### 8-bosqich — Multi-tenancy'ni yopish ✅ **TO'LIQ BAJARILDI** (2026-09)

6a (JWT `tenant_id`) asosida qurildi. **Muhim arxitektura qarori:** roadmap dastlab bu bosqichni "`TenantMiddleware`" deb nomlagan edi, lekin muhokama vaqtida aniqlandiki — haqiqiy Django `MIDDLEWARE` DRF autentifikatsiyasidan **oldin** ishlaydi (DRF esa `request.user`ga faqat lazy tarzda, odatda `initial()` ichida murojaat qiladi), shuning uchun chinakam middleware JWT claim/`request.user`ga ishonchli tarzda murojaat qila olmas edi. Shu sabab, tenant-kontekst DRF darajasidagi mixin sifatida amalga oshirildi:

- [x] `TenantContextMixin` (`api/mixins.py`, yangi fayl) — `initial()` ichida, `super().initial()` (autentifikatsiya + permission tekshiruvlari) tugagandan **keyin** ishlaydi
- [x] Tenant manbasi: **JWT claim emas** — `request.user.tenant` (DB, har doim yangi; JWT claim `fire()`dan keyin stale bo'lib qolishi mumkin)
- [x] `staff`/`owner` → `self.tenant = request.user.tenant`; `platform_admin` → `self.tenant = None`
- [x] `platform_admin`/`owner` URL'dagi `tenant_id` bilan ishlaydigan endpointlar (hire/fire, kelajakda 9-bosqich biznes endpointlari) uchun `resolve_tenant_from_url()`: `platform_admin` — istalgan tenant, `owner` — faqat o'ziniki, `staff` — hech qachon (403)
- [x] Nofaol (`is_active=False`) tenant — `resolve_tenant_from_url()` VA `initial()` ikkalasida ham 403 (**yangi xatti-harakat**: avval hire/fire nofaol tenant'da ham ishlardi)
- [ ] (Ixtiyoriy, keyinroq) PostgreSQL Row-Level Security
- [x] Tenant izolatsiyasi testlari — `apps/accounts/tests/test_employee_views_tenant_scope.py` (platform_admin istalgan tenant bilan ishlashi, owner faqat o'z tenant'i, nofaol tenant hire/fire'ni bloklashi)

**O'zgargan fayllar:** `api/mixins.py` (yangi), `api/v1/accounts/views/employee_views.py` (eski `_resolve_tenant_or_403` funksiyasi `TenantContextMixin.resolve_tenant_from_url()`ga ko'chirildi, hire/fire shu orqali ishlaydi)

**Ataylab qamrab olinmagan:** `Tenant` CRUD view'lari (`activate`/`deactivate`) bu mixin'ga ulanmagan — nofaol tenant'ni qayta faollashtirish aynan shu endpoint orqali bo'lgani uchun, uni bloklab bo'lmaydi. Umumiy "tenant-aware Manager/queryset avtomatik filtrlaydi" g'oyasi (dastlabki rejada bo'lgan) ham ataylab tanlanmadi — o'rniga har bir 9-bosqich view'i o'zi aniq `get_queryset()`da tenant bilan filtrlashi shart (fail-loud, "sehrli" thread-local holat yo'q).

### 9-bosqich — Biznes app'lari

5 (ruxsat — ✅ tayyor) va 8 (tenant-kontekst — ✅ tayyor) endi ikkalasi ham tayyor — **boshlash mumkin**.

Tartib:

1. ✅ **`catalog` — TO'LIQ BAJARILDI (2026-09), 135/135 test o'tdi.**
    
    **`Category`** (`BaseModel`dan meros) — `apps/catalog/models/category_model.py`:
    
    - `name`
    - `kod` — yaratilganda avtomatik o'suvchi tartib raqami (baza o'zi beradi), owner keyin qo'lda o'zgartira oladi; yagona cheklov: `unique_together(tenant, kod)` (barcha kategoriyalar, daraja farqisiz, bitta havzada noyob)
    - `parent = FK('self', null=True)` — **faqat 2 daraja** (subkategoriyaning o'zi boshqa subkategoriyaga ega bo'la olmaydi — `CategoryService`da tekshiriladi, tashqi kutubxona — MPTT/treebeard — kerak emas)
    - `is_active` — arxivlash
    
    **`Product`** (`BaseModel`) — `apps/catalog/models/product_model.py`:
    
    - `name`, `category` (FK, sub- yoki top-level)
    - `image` — ixtiyoriy, hozircha lokal disk (MinIO hali yo'q, pastga qarang), **bitta rasm** (galereya emas — bu Shop'ning ishi)
    - `is_active` — arxivlash; `False` qilinganda barcha `ProductVariant`lari ham **avtomatik** arxivlanadi (`ProductService.archive()`, `transaction.atomic`, kaskad)
    
    **`ProductVariant`** (`BaseModel`) — `apps/catalog/models/product_variant_model.py` — **har `Product` uchun kamida 1ta majburiy**:
    
    - `product` (FK), `name` — erkin matn, `unique_together(product, name)`
    - `sku` — avtomatik o'suvchi, tenant ichida noyob, **faqat tizim ichki foydalanadi**
    - `code` — `"{category.kod}/{subcategory.kod}/{price_min // 1000}"`, yaratilganda avtomatik yig'iladi, keyin owner qo'lda erkin tahrirlaydi (narx qismi ham, avtomatik qayta yangilanmaydi), **NOYOB EMAS**
    - `barcode` — ixtiyoriy, kiritilsa tenant ichida noyob (partial `UniqueConstraint`, faqat `NULL` bo'lmaganlar orasida)
    - `image` — ixtiyoriy override (bo'lmasa `Product.image` ko'rsatiladi)
    - `unit` — dona/kg/litr/metr; narxlar `price_partner`/`price_min`/`price_recommended` — `price_min` faqat maslahat, servis qatlamida bloklanmaydi
    - `is_active` — arxivlash (Product arxivlanganda kaskad bilan, **yoki** alohida — `ProductVariantArchiveView` orqali bitta variant Product'ga tegmasdan ham arxivlanishi mumkin, muhokamada aniq kelishilmagan, lekin to'g'ridan-to'g'ri zarur bo'lgani uchun qo'shildi)
    
    **Ataylab QOLDIRILGAN:** `cost_price` (tannarx) — `inventory`da hal qilinadi
    
    **Servislar** — `apps/catalog/services/{category_service,product_service}.py`: `kod`/`sku` generatsiyasi collision-safe (`select_for_update` + retry), `code` yig'ish mantig'i, kaskad arxivlash. Domain xatolar — `CategoryServiceError`/`ProductServiceError` (view qatlamida 400ga aylantiriladi, `EmployeeServiceError` naqshiga o'xshab)
    
    **API** — `api/v1/catalog/` (`serializers.py`, `urls.py`, `views/`): **tekis yo'l** (`tenants/<id>/` ostida emas), tenant har doim `TenantContextMixin.self.tenant`dan (8-bosqich). `CatalogAPIView` bazaviy klassi (`views/_base.py`) **`platform_admin`ni butunlay bloklaydi** — chunki `PermissionService` platform_admin'ga har doim `True` qaytaradi (boshqa xususiyatlar uchun), shuning uchun bu yerda alohida, aniq tekshiruv qo'shildi (2026-09 kelishuvi: platform_admin katalogni emas, faqat owner'larni boshqaradi)
    
    **Ruxsatlar** — `apps/permissions.Permission`ga **data-migration orqali** kiritildi (`apps/catalog/migrations/0002_seed_permissions.py` — admin UI yo'qligi sababli, kelajakdagi har bir app shu naqshni takrorlaydi). Konsolidatsiya qilingan (`ProductVariant` alohida ruxsatga ega emas):
    
    ```
    view_category, add_category, change_category, archive_category,
    view_product, add_product, change_product, archive_product   (jami 8 ta)
    ```
    
    **Media:** hozircha Django'ning standart lokal `FileSystemStorage`si (`MEDIA_ROOT`/`MEDIA_URL` qo'shildi, `Pillow` dependency qo'shildi). **MinIO hali docker-compose'da yo'q** (12-bosqich) — ulanganda faqat `STORAGES` sozlamasi o'zgaradi, model/migratsiya o'zgarmaydi.
    
    **Testlar** — `apps/catalog/tests/{test_category_service,test_product_service,test_catalog_api}.py`: kod/sku generatsiyasi, chuqurlik cheklovi, tenant izolatsiyasi, ruxsat tekshiruvi, platform_admin bloklanishi, kaskad arxivlash — **hammasi o'tdi**.
    
2. ✅ **`inventory` — TO'LIQ BAJARILDI (v0.12.4), 30 ta test bilan qoplandi.**

    **`Stock`** (`BaseModel`dan meros) — `apps/inventory/models/stock_model.py`:
    - `branch` (FK `tenants.Branch`, nullable/blank, related_name="stocks") — filial darajasidagi ombor
    - `product_variant` (FK `catalog.ProductVariant`, related_name="stocks")
    - `quantity` (DecimalField, max_digits=14, decimal_places=3, default=0, check constraint: `quantity >= 0`)
    - `last_cost_price` (DecimalField, max_digits=12, decimal_places=2, null=True, blank=True) — oxirgi kirim narxi
    - Filial maxsus narxlari: `custom_price_recommended`, `custom_price_min`, `custom_price_partner`
    - Cheklov: `UniqueConstraint(fields=["branch", "product_variant"], name="unique_stock_per_branch_variant")`
    - Lazily yaratiladi (`StockService` birinchi harakatda ochadi, katalogda yaratilmaydi)

    **`StockMovement`** (`BaseModel`) — `apps/inventory/models/stock_movement_model.py`:
    - `branch` (FK `tenants.Branch`), `product_variant` (FK `catalog.ProductVariant`, on_delete=PROTECT)
    - `sale` (FK `sales.Sale`, nullable) — sotuv auditiga to'g'ridan-to'g'ri bog'lanish
    - `transfer` (FK `inventory.StockTransfer`, nullable) — filiallararo transferga bog'lanish
    - `type` (`kirim`, `sotuv`, `mijoz_qaytardi`, `yetkazib_beruvchiga_qaytarish`, `isrofgarchilik`, `tuzatish`, `transfer_out`, `transfer_in`)
    - `direction` (`in`, `out`)
    - `quantity` (DecimalField, check constraint: `quantity > 0`)
    - `cost_price` (DecimalField, faqat kirim uchun)
    - `note` (TextField, izoh), `created_by` (FK `accounts.User`, on_delete=PROTECT)
    - Har doim audit saqlanadi, o'zgarmas (immutable)

    **`StockTransfer` va `StockTransferItem`** — `apps/inventory/models/transfer_model.py`:
    - `from_branch` va `to_branch` (bitta tenant ichida)
    - Statuslar: `pending` (jo'natilgan), `completed` (qabul qilingan), `cancelled` (bekor qilingan)
    - Atomik ombor harakatlari: jo'natilganda `transfer_out`, qabul qilinganda `transfer_in`, bekor qilinganda `from_branch`ga qaytish

    **`DeficitService` (Kamomad Tizimi)** — `apps/inventory/services/deficit_service.py`:
    - So'nggi 30 kunlik haqiqiy sotuvlar >= 10 ta VA ayni paytdagi ombor qoldig'i <= 5 ta bo'lgan tovarlar avtomatik aniqlanadi
    - Yangi partiya kirim qilinib, qoldiq 5 tadan oshishi bilan tovar avtomatik kamomad ro'yxatidan chiqariladi
    - Filial bo'yicha mustaqil hisob-kitob (`branch` filtri)
    - Telegram botga har kuni reja bo'yicha yoki egasining so'rovi bilan darhol (`send-report-now`) to'liq kamomad hisoboti yuboriladi

    **`StockService`** — `apps/inventory/services/stock_service.py`:
    - `intake()` — bitta tovar kirimi (tannarx bilan), oxirgi tannarxni yangilaydi
    - `batch_intake()` — butun tovarlar partiyasini bitta atomik tranzaksiyada filial omboriga kirim qilish (`POST /api/v1/inventory/intake/batch/`)
    - `transfer_out()` va `transfer_in()` — filiallararo tovar ko'chirish
    - `customer_return()`, `supplier_return()`, `write_off()`, `adjust()`
    - Race-condition lardan himoya: `select_for_update()` va atomik tranzaksiya
    - Salbiy qoldiqqa tushishga yo'l qo'yilmaydi (`StockServiceError`)

    **API** — `api/v1/inventory/`:
    - `GET /api/v1/inventory/stock/` — barcha variantlar qoldig'i (`branch_id` filtri bilan)
    - `GET/PATCH /api/v1/inventory/stock/<variant_id>/` — variant qoldig'i va filial narxlarini tahrirlash
    - `GET /api/v1/inventory/movements/` — harakatlar tarixi (`branch_id` va `product_variant_id` filtri)
    - `POST /api/v1/inventory/intake/` va `POST .../batch/` — yakka va ommaviy partiya kirimi
    - `POST /api/v1/inventory/{adjust,customer-return,supplier-return,write-off}/` — 4 ta harakat amali
    - `GET /api/v1/inventory/deficits/` va `POST .../send-report-now/` — kamomad ro'yxati va Telegram xabari
    - `GET/POST /api/v1/inventory/transfers/` va `.../<id>/{accept,cancel}/` — filial transferlari

3. ✅ **`sales` — TO'LIQ BAJARILDI (v0.12.4), 45 ta test bilan qoplandi.**
    - **POS va Filial Izolyatsiyasi:** Kassa vitrinasida faqat ayni filialda mavjud (`quantity > 0`) tovarlar chiqadi. Boshqa filial tovarlari yoki 0 qoldiq ko'rinmaydi ("Tugagan" kartochkalar chiqarilmaydi). Filial o'zgarganda savat avtomatik tozalanadi (`resetCart()`).
    - **1-narx galochkasi (`use_partner_price`):** Galochka yoqilganda barcha tovarlar faqat `price_partner` bo'yicha hisoblanadi. 1-narxi yo'q tovarlar bloklanadi.
    - **Kontragentlar (`Counterparty`):** Do'konlar, tanishlar va xodimlar. Avtomatik tenant aniqlash. O'chirish taqiqlangan (arxivlanadi).
    - **B2B Do'konlararo O'tkazma:** Jo'natuvchidan tovar ZAHOT chiqadi, qabul qiluvchi owner'ga Telegram va in-app xabar boradi. Qabul qilganda B o'z kategoriyasiga biriktiradi yoki yangi variant ochadi. Rad etilganda A do'kon tekshirib, o'zi Void qilmaguncha tovar qaytmaydi. 7 kunda avto-bekor.
    - **Qarz / Nasiya:** UZS va USD mustaqil ishorali balanslari. Har 10 mln UZS va 1 000 USD da egasiga Telegram ogohlantirish.
    - **Universal Void:** 7 kun ichida, majburiy izoh bilan, to'liq yoki alohida tovar miqdori bo'yicha qaytarish (`partially_voided`). Qarz kamayadi va tovar omborga qaytadi.

4. ✅ **`analytics` — TO'LIQ BAJARILDI (v0.12.4).**
    - **Ruxsat:** Faqat `owner` va `platform_admin`.
    - **Tushum va Nasiyani Qat'iy Ajratish:**
      - **Haqiqiy Kassa Tushumi (Cash Inflow):** Faqat Naqd va Karta to'lovlari.
      - **Nasiya Savdosi (Credit Sales / Receivables):** Qarzga berilgan tovarlar summasi. Nasiya pul tushumi emas, alohida ko'rsatiladi.
      - **Sof Foyda (Net Profit):** Savdo foydasi (sotish narxi - tannarx).
      - **Jami Qarz Balansi (Total Debt):** Do'konning debitorlik qarzlari.
    - **Valyuta taqsimoti:** UZS va USD har doim alohida hisoblanadi.
    - **Davrlar filtri:** `today`, `this_week`, `this_month`, `this_year`, `start_date`/`end_date`, `branch_id`.
    - **Diagrammalar:** Savdo dinamikasi, Top-10 tovarlar, To'lov turlari taqsimoti, Kassirlar reytingi.

5. ✅ **`cash_register` (Kassa, Smenalar va Z-Hisobot) — TO'LIQ BAJARILDI (v0.12.4).**
    - **Filial bo'yicha Smenalar (`Shift`):** Har bir filialda mustaqil smena ochiladi va yopiladi.
    - **`CashExpense` va `CashIncome`:** Kunlik chiqimlar va qo'shimcha kirimlar (Paynet, Kopya va h.k.).
    - **`DailyCashReport` (Z-Hisobot):**
      - Tovar savdosi (Naqd + Terminal/Karta) avtomatik olinadi.
      - Kutilgan naqd pul, sanab olingan naqd pul va tafovut farqi.
      - Tafovut bo'lsa xodimdan sababi so'raladi, bo'sh qoldirilsa: *"Smenani yopgan xodim tafovut farqining sababini bilmaydi"* deb qayd etiladi.
    - **Z-Hisobot Cheki:** USD va UZS tranzaksiyalari o'z valyutasida alohida ko'rsatiladi. Modalda avval chiroyli vizual xabarnoma chiqadi, bosma chek faqat "Chop etish" bosilganda ochiladi.
    - **Smena Imzolarining Xavfsizligi:** Smena yopishda mas'ul xodim imzosi (`signature` canvas) olinadi. Imzoni tozalash (Clear) imkoniyati butunlay olib tashlangan — faqat qayta chizish mumkin, o'chirish taqiqlangan!
    - **Celery Beat Z-Hisobot vaqti:** `Tenant.daily_report_time` (default `22:00`). Belgilangan vaqtda avtomatik Telegram botga to'liq kassa hisoboti boradi.

~~`customers` app~~ — **kerak emas**, customer Shop'da yashaydi.

Har app: model → service → `api/v1/<app>/` → ruxsat + tenant scope → test.

### 10-bosqich — API pishitish — ✅ TO'LIQ BAJARILDI

- [x] `api/v1/<app>/` tuzilmasi
- [x] Bir xil xato tanasi: `{"error": {"code": "...", "message": "...", "details": ...}}`
- [x] Pagination (`StandardResultsSetPagination`, page_size=20, max=100), `django-filter`

### 11-bosqich — Shop bilan integratsiya (ILBI tarafi) — ✅ TO'LIQ BAJARILDI (v0.9.3)

Shop endi **alohida mikroservis, o'z bazasi bilan** — to'liq reja `shop-yol-xaritasi.md`da. Bu yerda faqat ILBI tomonidan taqdim etiladigan qism:

- [x] Shop uchun internal endpoint(lar): mahsulot/narx ma'lumotini berish (`GET /api/v1/internal/shop/tenants/{tenant_id}/products/`), buyurtma kelganda ombordan kamaytirish/zahiralash (`POST /api/v1/internal/shop/tenants/{tenant_id}/order-deduct/`)
- [x] Service-to-service token (mavjud `IsInternalService` qayta ishlatiladi)
- [x] Telegram bot marshrutlash — ✅ tayyor (`?start=shop`)

### 12-bosqich — Docker Compose va deploy — ✅ TO'LIQ BAJARILDI (v0.9.4)

- [x] Redis + Postgres + ILBI + bot (aiogram)
- [x] `shop_db` tayyorgarligi (`init-db.sql`), `celery_worker`, `celery_beat`, `nginx`
- [x] **`minio`** — mahsulot rasmlari uchun object storage, `django-storages` orqali ulandi (`minio:latest`, portlar: 9000/9001)
- [x] Shop uchun alohida Postgres baza (`init-db.sql` orqali `shop_db` avto-yaratiladi)
- [x] Ichki servislar faqat `ilbi_net`; tashqariga faqat nginx (port 80:80)
- [x] `.env` bilan sirlarni boshqarish
- [x] `DEBUG`ni haqiqiy `bool`
- [x] Gunicorn / production sozlamalarini yakunlash, statik fayllar pipeline'i (`collectstatic`)

### 13-bosqich — Celery — ✅ TO'LIQ BAJARILDI

- [x] Celery + Redis broker (`redis://redis:6379/1`)
- [x] Worker va Beat compose servislari (`celery_worker`, `celery_beat`)
- [x] Vazifalar: B2B 7 kunlik avto-bekor (har soatda), do'kon kunlik Z-hisobotini tekshirish va Telegramga yuborish, kunlik kamomad (deficit) xabarnomasi, asinxron Telegram xabarlari

### 14-bosqich — Frontendlar

- [x] **ILBI Web Client (React 18 + Vite SPA, Tailwind, Glassmorphism UI) — ✅ TO'LIQ BAJARILDI (v0.12.0+)**
  - **`Dashboard.jsx`:** Kassa tushumi (Naqd va Karta) va Nasiya savdosi ajratilgan KPI kartalari, Sof foyda, Qarzlar balansi, Sotuv dinamikasi grafigi, Top tovarlar, To'lov turlari taqsimoti, Kassirlar reytingi.
  - **`POS.jsx`:** Tezkor kassa, faol filial bo'yicha tovarlar izolyatsiyasi (faqat mavjud tovarlar chiqadi), shtrix-kod tezkor skaneri, 1-narx (ulgurji) galochkasi, savat boshqaruvi, to'lov turlari (Naqd, Karta, Nasiya). Filial o'zgarganda savat avto-tozalanadi.
  - **`Catalog.jsx`:** Kategoriyalar (2 daraja), mahsulotlar va variantlar, narxlar ierarxiyasi (tavsiya, min, 1-narx), 3 darajali avtomat kodlar, rasmlar yuklash.
  - **`Inventory.jsx`:** Ombor qoldiqlari, filiallar bo'yicha filtr, partiya kirimi, filiallararo tovar transferlari, kamomadlar (deficits) monitoringi, harakatlar auditi, ixcham bitta qatorli filtr.
  - **`RapidStockIntakeModal.jsx`:** Kassa-skaner uslubidagi ommaviy partiya kirimi ish maydoni, jadvalda narxlar va miqdorlar tahriri, LocalStorage qoralamalari persistensiyasi (`ilbi_stock_intake_full_draft_v1`).
  - **`Sales.jsx`:** Sotuvlar tarixi, cheklar ro'yxati, kunlik guruhlash, termal kassa cheki (58mm/80mm), 7 kunlik universal Void (to'liq yoki qisman qaytarish) va A4 faktura chop etish.
  - **`Debts.jsx`:** Mustaqil "Mijoz Nasiyalari" sahifasi (`/debts`), kontragentlar KPI ko'rsatkichlari, qarz to'lash (filial tanlovi va oxirgi to'lov ma'lumoti bilan), mijoz haqqini qaytarish, to'lovlar va xaridlar tarixi auditi.
  - **`B2BTransactions.jsx`:** Mustaqil "B2B Tranzaksiyalar" sahifasi (`/b2b`), kiruvchi B2B fakturalar (Inbox), qabul qilish (kategoriya va variant xaritalash), rad etish, jo'natilgan B2B o'tkazmalar, tovar qaytishlarini qabul qilish va tafovutlarni yopish.
  - **`Shifts.jsx`:** Smena ochish/yopish, kunlik kassa chiqimlari va kirimlari, Z-Hisobot modal va bosma chek, xavfsiz imzo chizish (o'chirish taqiqlangan).
  - **`Analytics.jsx`:** Kengaytirilgan sotuv va moliya hisobotlari, davrlar va filiallar filtri.
  - **`Branches.jsx`:** Filiallar CRUD, asosiy filialni belgilash, filiallararo tovar transferlarini qabul qilish/bekor qilish.
  - **`Employees.jsx`:** Xodimlarni hire/fire qilish (telefon raqami orqali) va ruxsatlar matrisasi.
  - **`Settings.jsx`:** Do'kon sozlamalari, dollar kursi, Z-hisobot vaqti, bildirishnoma sozlamalari.
- [ ] **Storefront (Shop API)** — Shop mikroservisi bilan birga (FastAPI + alohida baza).

### 14.5-bosqich — Testlar (doimiy, har bosqichga yopishadi)

- [x] Test infratuzilmasi (`pytest-django`, `Faker`, `FactoryBoy`)
- [x] `EmployeeService`, `TenantService`, `PermissionService` unit testlari
- [x] Admin-login, unban, hire-permission-fix HTTP testlari
- [ ] Customer register/login testlari — **Shop'ga ko'chganda Shop'da qayta yoziladi**
- [x] 6a testlari (`test_jwt_claims.py`) va 8-bosqich testlari (`test_employee_views_tenant_scope.py`)
- [x] 9-bosqich: `catalog` (55 test), `inventory` (30 test), `sales` (45 test), `cashbox` (20 test) — **jami 180+ testlar yashil**.

### 15-bosqich — Xavfsizlik va sinov

- [x] Tenant va Branch izolatsiyasi: boshqa tenant yoki filial ma'lumotlari so'rovlarda chiqmaydi (POS, ombor, smenalar, harakatlar) — **✅ TO'LIQ YOPILDI**
- [x] Employee transfer: eski tenant ruxsati/tokeni ishlamasligi (`Employee.is_active` darajasida yopiq)
- [x] Rate-limiting (admin login): progressiv lock + strike ban
- [x] Smena imzolari xavfsizligi: imzoni o'chirish taqiqlangan (faqat qayta chizish)
- [ ] Audit log: narx o'zgarishi, sotuv, hire/fire, owner almashtirish
- [x] Internal token va Telegram secretlar faqat env'da

---

## 4. Har bosqichda amal qilinadigan prinsiplar

1. `tenant`ni frontend yoki query'dan qabul qilmaslik — JWT (va 8-dan keyin middleware/mixin).
2. Logika `services/`da; view — HTTP, serializer, status kod.
3. Media — MinIO S3 obyekt xotirasi.
4. `internal/` tashqariga ochilmaydi.
5. Muhim amallar — audit.
6. Telefon formati — Shop tekshiradi; ILBI ichki chaqiriqni ishonchli deb qabul qiladi, lekin yomon ma'lumotni ham rad etadi.
7. Login ma'lumotlarini faqat egasi, OTP/email bilan.
8. Rol vakolati: faqat bir pog'ona past.
9. **ILBI customer haqida bilmaydi** — bu Shop'ning ishi.
10. **Filiallararo qat'iy izolyatsiya:** POS va filial operatsiyalarida boshqa filial tovarlari va 0 qoldiqli tovarlar ko'rsatilmaydi.
11. **Moliya intizomi:** Nasiya kassa tushumi sifatida qabul qilinmaydi; haqiqiy tushum va qarzlar doimo ajratiladi.
12. **Audit daxlsizligi:** Smena imzolari va kassa yozuvlarini o'chirib bo'lmaydi.

---

## 5. Ochiq dizayn (koddan oldin yozib kelishiladi)

|#|Mavzu|Holat|
|---|---|---|
|A|~~Owner `hire`da permission to'plami~~|✅ **YOPILDI** — owner har doim to'liq huquqli|
|B|~~Username/password qo'yish/o'zgartirish oqimi~~|✅ **YOPILDI** — email orqali (Telegram emas). Endpointlar hali loyihalanmagan (keyingi ish)|
|C|~~`platform_admin` `HasEmployeePermission`da har doim `True`mi~~|✅ **YOPILDI** — ha|
|D|Customer qidiruv maydonlari va kim ko'radi|**Shop'ga ko'chadi**, ILBI'da endi kerak emas|
|E|Shop `tenant_id` qayerdan (env vs birinchi sozlama)|Ochiq — endi Shop **ko'p tenant** bilan ishlashi mumkinligi sababli (customer bir nechta do'kondan xarid qilishi mumkin), bu savol qayta ko'rib chiqilishi kerak: Shop'da `tenant_id` umuman global emas, **har bir order o'zining tenant'ini biladi** bo'lishi kerak. `shop-yol-xaritasi.md`da|
|F|~~Ban qilingan admin userni kim/qanday ochadi~~|✅ **YOPILDI** — unban endpoint yozildi|
|**G**|~~`fire()`dan keyin `User.role` nima bo'ladi~~|✅ **YOPILDI** — Variant A: role saqlanadi, password yaroqsiz qilinadi, faol employment yopiladi|
|**H**|~~`EmployeeService.hire()`ning "to'siq" mantig'i~~|✅ **YOPILDI** — faol employment bo'lsa EmployeeServiceError chiqariladi (avval bo'shatish shart)|
|**I**|~~POS sotuv: 1-narx galochkasi, narxlar ko'rinishi va audit~~|✅ **YOPILDI** — `is_partner_sale`, `original_partner_price` bilan to'liq audit. Galochka yoqilganda barcha mahsulotlar faqat `price_partner` narxida ko'rinadi. 1-narx bo'sh yoki 0 bo'lsa sotuv bloklanadi. Kassir narxni erkin o'zgartira oladi. Tannarxdan past sotilsa ogohlantirish beriladi|
|**J**|~~Kontragentlar ro'yxati (`Counterparty`): kim qo'sha oladi, maydonlar~~|✅ **YOPILDI** — ruxsati bor `staff` ham qo'sha oladi. `target_tenant` telefon raqami orqali avtomatik topiladi. O'chirish taqiqlanadi (arxivlanadi). UZS va USD qarz balanslari alohida yuritiladi|
|**K**|~~B2B tovar o'tkazish: rad etilganda ombor taqdiri~~|✅ **YOPILDI** — jo'natuvchi omboridan tovar ZAHOT chiqariladi. Qabul qiluvchi rad etsa yoki qisman qabul qilsa, rad etilgan tovarlar A omboriga AVTOMATIK qaytmaydi va qarz kamaymaydi. Faqat A do'koni rad etilgan tovarlarni tekshirib, o'zi "Void" qilgandagina tovar A omboriga qaytadi va qarz kamayadi|
|**L**|~~B2B qabul qilinganda katalogga biriktirish~~|✅ **YOPILDI** — B qabul qilish paytida tovar o'zining qaysi kategoriyasiga qo'shilishini o'zi tanlaydi (valyuta mos bo'lishi shart) yoki mavjud tovar variantiga biriktirib qoldiqni oshiradi. `cost_price=A_dan_sotilgan_narx`, sotish narxi default 0 bo'ladi|
|**M**|~~Nasiya qarz va chegara ogohlantirishlari~~|✅ **YOPILDI** — `debt_balance_uzs` va `debt_balance_usd` alohida yuritiladi (ishorali: musbat = qarz, manfiy = haqqi). Chegara: har 10 mln UZS va har 1 000 USD oshganda owner'ga ogohlantirish. Qarz to'langanda qadam orqaga qaytadi|
|**N**|~~Bildirishnoma (Notification) tizimi: in-app va Telegram~~|✅ **YOPILDI** — `Notification` modeli bor, in-app va Telegram bot orqali link bilan xabar — ikkisi bir vaqtda. B2B kelganda, rad etilganda, qisman qabul qilinganda, bekor qilinganda va qarz chegarasida|
|**O**|~~Valyuta tizimi: UZS va USD~~|✅ **YOPILDI** — `Category.currency` ('UZS'/'USD'), subkategoriya meros oladi. Savatda aralash tovarlar bo'lsa, backend bitta tranzaksiyada 2 ta alohida chek yaratadi (`UZS` va `USD`). Do'kon ichki kursi `Tenant.usd_rate` faqat ko'rgazmali hisoblash uchun|
|**P**|~~Universal bekor qilish (Void) va qisman qaytarish~~|✅ **YOPILDI** — 1 hafta ichida, majburiy izoh bilan, butun chek yoki alohida tovar va uning ma'lum miqdori qaytariladi. B accept qilgan B2B sotuvni A void qila olmaydi. `SaleVoidLog` jadvali bilan to'liq audit|
|**Q**|~~Qarz to'lovlari (`DebtPayment`) auditi~~|✅ **YOPILDI** — faqat `owner` va `platform_admin` to'lov kiritadi. O'chirish taqiqlanadi. Xato bo'lsa, majburiy izoh bilan teskari korrektirovka yozuvi kiritiladi (`is_correction=True`)|
|**R**|~~Ombor harakati va Chek auditi~~|✅ **YOPILDI** — `StockMovement` modeli `Sale` chekiga to'g'ridan-to'g'ri bog'lanadi (`sale` FK)|
|**S**|~~Savdo Analitikasi & Dashboard (9.5-bosqich)~~|✅ **YOPILDI** — faqat `owner` va `platform_admin` ko'radi. Davrlar: `today`, `this_week`, `this_month`, `this_year`, `start_date`/`end_date`. UZS va USD har doim alohida hisoblanadi. KPI (tushum, sof foyda, jami qarz, cheklar) va grafiklar|
|**T**|~~Kassa smenasi va Z-Hisobot (9.7-bosqich)~~|✅ **YOPILDI** — `CashExpense`, `CashIncome`, `DailyCashReport`. Tafovut sababi qayd etiladi va egasiga Telegram orqali boradi|
|**U**|~~Kunlik hisobot vaqti va Celery Beat~~|✅ **YOPILDI** — `Tenant.daily_report_time` (default `22:00`). Celery Beat belgilangan vaqtda avtomatik to'liq Z-hisobotni Telegram botga chiqaradi|
|**V**|~~API Pishitish (10-bosqich)~~|✅ **YOPILDI** — Standart paginatsiya, filtrlar, xatoliklar standarti|
|**W**|~~MinIO Media Storage (12-bosqich)~~|✅ **YOPILDI** — Docker Compose'da MinIO S3, `django-storages`, rasmlar optimizatsiyasi|
|**X**|~~Ko'p filialli tizim (`Branch`) va Filial Narxlari~~|✅ **YOPILDI** — `Branch` modeli, `Stock.branch` FK, har bir filial uchun maxsus narxlar (`custom_price_*`)|
|**Y**|~~Filiallararo qat'iy izolyatsiya (POS & Ombor)~~|✅ **YOPILDI** — POS da faqat tanlangan filialda mavjud (`quantity > 0`) tovarlar chiqadi. Boshqa filial tovarlari yoki 0 qoldiq ko'rinmaydi. Filial almashtirilganda savat avtomatik tozalanadi|
|**Z**|~~Nasiya va Kassa Tushumini ajratish~~|✅ **YOPILDI** — Nasiya savdosi (Receivables) kassa tushumi (Cash flow) emas. Statistikada va Dashboardda Naqd tushum, Karta tushumi va Nasiya alohida kartochkalarda mustaqil hisoblanadi|
|**AA**|~~Z-Hisobotda valyutalar ($ / UZS) va bosma chek rejimi~~|✅ **YOPILDI** — USD va UZS tranzaksiyalari o'z valyutasida alohida ko'rsatiladi. Modalda avval chiroyli hisobot ko'rinadi, bosma chek faqat "Chop etish" bosilganda ochiladi|
|**AB**|~~Elektron imzolar xavfsizligi (Imzoni yangilash va o'chirish taqiqlangan)~~|✅ **YOPILDI** — Hisob-faktura (A4) imzolangach yangilash/o'zgartirish butunlay yopildi va qulflanadi; smena imzosini tozalash (Clear) butunlay olib tashlangan, audit daxlsizligi to'liq ta'minlandi|
|**AC**|~~Ommaviy partiya kirimi (Rapid Barcode Intake) & LocalStorage qoralamalari~~|✅ **YOPILDI** — Kassa-skaner uslubidagi partiya kiritish jadvali, narxlar va miqdorlarni qatorda tahrirlash, `ilbi_stock_intake_full_draft_v1` kaliti bilan qoralamalar saqlanishi|
|**AD**|~~Kamomad (Deficits) dinamik algoritmi~~|✅ **YOPILDI** — Oxirgi 30 kunlik sotuvi >= 10 va qoldig'i <= 5 tovarlar avtomatik kamomadga tushadi, kirim bo'lishi bilan (>5) avtomatik chiqadi. Filial bo'yicha filterlanadi va Telegramga yuboriladi|
|**AE**|~~Qarz to'lovida oxirgi to'lov auditi va Filial tanlovi~~|✅ **YOPILDI** — Har bir kontragent bo'yicha oxirgi to'langan summa, valyuta, sana va filial ma'lumotlari (`last_payment`) prefetched holda chiqariladi; qarz to'lash modalida oxirgi to'lov axborot banneri va to'lov qabul qilinayotgan filial (`branch_id`) tanlash imkoniyati to'liq joriy qilindi|
|**AF**|~~Mijoz Nasiyalari va B2B Tranzaksiyalarining alohida sidebar bo'limlariga ajratilishi~~|✅ **YOPILDI** — Savdolar (`/sales`), Mijoz Nasiyalari (`/debts`), va B2B Tranzaksiyalari (`/b2b`) bitta sahifadagi tablardan to'liq mustaqil, ixtisoslashtirilgan SPA sahifalariga va Sidebar bo'limlariga ajratildi. Eskirgan linklar (`?tab=counterparties` va `?tab=b2b`) avtomatik tegishli yangi sahifalarga redirect qilinadi|
|**AG**|~~Tizimni to'liq o'zbek tiliga o'tkazish (Operator, Qo'llanmalar, Interfeys)~~|✅ **YOPILDI** — Rus va ingliz tillaridagi barcha qoldiqlar, til almashtirgichlar olib tashlandi; operator chati, qo'llanmalar, rasmlar vizualizatsiyasi va kassa interfeysi sof o'zbek tiliga o'tkazildi|

---

## 6. Keyingi band (shu faylga qarab ishni oching)

**ILBI Backend va Frontend SPA (v0.12.4) barcha asosiy biznes modullari (Katalog, Ko'p filialli ombor, Rapid partiya kirimi, Filial izolyatsiyalangan POS, Savdo, Qarzlar, Kassa smenalari va Z-hisobot, Analitika) bilan to'liq ishga tushirildi va 180+ testlar bilan mustahkamlandi.**

**Navbatdagi ustuvor vazifalar:**
1. **Shop mikroservisi (Storefront):** FastAPI orqali customer-facing storefront'ni qurish, Shop o'z bazasi bilan ishlashi va ILBI internal API ga ulanishi (`shop-yol-xaritasi.md`).
2. **PWA va Mobil optimizatsiya:** Kassa va POS interfeysini planshet va mobil ekranlar uchun to'liq moslashtirish, oflayn rejimni mustahkamlash.
3. **Audit Log tizimi:** Narxlar o'zgarishi, xodimlar harakati va muhim amallar uchun to'liq tizimli audit jadvali.