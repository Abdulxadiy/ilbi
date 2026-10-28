# ILBI testlarini ishga tushirish

Yangilangan: **2026-10-16**. Testlar PostgreSQL va Redis’ning alohida servislaridan foydalanadi; demo/dev bazasi bilan aralashtirmang.

## Muhit

Repo ildizidan:

```bash
docker compose -f backend/docker-compose.test.yml up -d
cd backend
uv sync --group dev
```

`config.settings_test` test konfiguratsiyasini yuklaydi. Standart PostgreSQL porti **5433**, Redis porti **6380**; kerak bo‘lsa `.env.test.example`dan `.env.test` yarating. Test sozlamalari production maxfiy kalitini va fayl saqlash xizmatlarini almashtiradi; email xotirada saqlanadi. Support tezlik cheklovlari ham test Redis’iga yo‘naltiriladi, ayrim testlar uni alohida xotira cache’i bilan almashtiradi.

## Buyruqlar

```bash
uv run pytest
uv run pytest apps/support/tests apps/accounts/tests/test_terms_and_docs_views.py -q
uv run pytest apps/sales/tests/test_sale_service.py -q
uv run pytest --cov=apps --cov-report=term-missing
```

`pytest.ini`da `--reuse-db` bor. Migratsiya yoki test bazasi eski bo‘lsa `uv run pytest --create-db` bilan yangilang. `@pytest.mark.slow` sinovlarni vaqtincha o‘tkazib yuborish uchun `-m 'not slow'` ishlatiladi. Oldingi hujjatdagi qat’iy “36 ta test” soni amaldagi to‘plamni ifodalamaydi.

`conftest.py` umumiy foydalanuvchi va tenant fixture’larini, `tests/factories.py` esa ma’lumot fabrikalarini beradi. Koddagi rol maydonini o‘zgartirishning o‘zi faol do‘kon a’zoligini yaratmaydi; vakolat testida kerakli `Employee` yozuvini ham yarating.

## JWT xavfsizlik versiyasi

Login oynasi va chat chegarasi uchun `uv run pytest apps/accounts/tests/test_login_security_boundary.py -q`: platform admini, egasi va xodimning to‘g‘ri paroli faqat login ticket beradi; ticket xususiy profil, chat, hisoblar va katalog APIlariga access token sifatida o‘tmaydi. Brauzerdagi haqiqiy login/OTP, chat kattalashtirish, logout va qoralama tiklash oqimlari `frontend/ilbi` ichida `npm run test:auth-session` bilan sun’iy javoblarda tekshiriladi.

```bash
uv run pytest apps/accounts/tests/test_token_version_validation.py apps/accounts/tests/test_token_revocation.py apps/accounts/tests/test_jwt_claims.py -q
```

Testlar sun’iy user va test kaliti bilan haqiqiy imzolangan JWTlarni haqiqiy API endpointlarga yuboradi. Access/refreshda yo‘q, null, boolean, float, string, ro‘yxat, obyekt va mos kelmagan versionlar `401` bo‘lishi kerak. Token payloadi o‘zgartirilgach qayta imzolanadi, shuning uchun faqat imzo xatosi sabab test o‘tib ketmaydi.

Joriy butun sonli version, yangilangan access token bilan APIga kirish, inactive/deleted user rad etilishi va haqiqiy parol almashtirishdan keyingi bekor qilish tekshiriladi. Parol almashtirilgach eski access/refresh va versionsiz tokenlar rad etiladi, yangi chiqarilgan tokenlar ishlaydi. Faqat ajratilgan test DB ishlatiladi; haqiqiy user sessiyalari yoki bazasi o‘zgartirilmaydi.

## Demo akkauntlarning productiondan ajratilishi

```bash
uv run pytest apps/accounts/tests/test_demo_mode.py apps/accounts/tests/test_demo_production_isolation.py -q
```

33 yangi regressiya holati va oldingi 15 demo tekshiruvi: uch rol, hozirgi/legacy demo guruhi, har bir flag o‘chirilishi, eski haqiqiy JWT access/refresh, yangi login, username/telefon o‘zgargan demo hisob, eski OTP ticketi, reset/taklif havolalari va oldingi parol bilan yangilash sinovdan o‘tadi. Productionda ular rad etilishi, oddiy haqiqiy hisob va yoqilgan lokal demo ishlashi kerak. UI preference/legacy ENV bo‘yicha demo adminning Telegram personal/group notificationlari ham tekshiriladi; yuborish mock qilinadi.

Faqat ajratilgan test PostgreSQL/Redis va sun’iy akkauntlar ishlatiladi. Sinov o‘z ticket/link kalitlarini tozalaydi; haqiqiy demo hisoblari, sessiyalar, env va tashqi Telegram/SMTP o‘zgartirilmaydi. Model/migratsiya o‘zgarishi kerak emas.

## Telegram 2FA shaxsiy chat himoyasi

Platforma adminining yangi ish muhiti:

```bash
uv run pytest apps/accounts/tests/test_platform_admin_workspace.py apps/accounts/tests/test_employee_management_api.py apps/support/tests apps/tg_bot/tests -q
```

Role isolation, admin paroli/egalik tasdig‘i, stale version, band telefon/chat, eski JWT/reset bekori, umumiy hisob blok/unblock, platforma auditining tenantga tushmasligi va sahifalangan qidiruv query chegarasi tekshiriladi. Support personal/group/both, o‘chirilgan tanlovning ENV fallbackni to‘xtatishi, post-commit enqueue va o‘qilmagan xabar counti ham sinovda. Parallel registrationda aynan bitta chat saqlanib, ikkinchi so‘rov nazoratli 400 bo‘lishi kerak.

Repo frontend katalogidan `node tests/platformAdmin.browser.mjs` haqiqiy Chrome’da yangi UI/formalarni sun’iy API bilan tekshiradi. Rasmlar `/tmp/ilbi-admin-*.png`ga yoziladi; maxfiy haqiqiy ma’lumot ishlatilmaydi. 390px mobile va light/dark tokenlari tekshiriladi. Bu sinov yangi migratsiyalarni haqiqiy serverga qo‘llamaydi va Telegram xabari yubormaydi.

```bash
uv run pytest apps/tg_bot/tests apps/accounts/tests/test_admin_login_views.py apps/accounts/tests/test_createsuperuser.py apps/accounts/tests/test_password_reset.py apps/accounts/tests/test_demo_mode.py apps/accounts/tests/test_branding.py apps/cashbox/tests/test_tasks.py apps/tenants/tests/test_tenant_services_api.py -q
```

`apps/tg_bot/tests/test_private_2fa.py` ichki HTTP ro‘yxatga olish, eski guruh/noto‘g‘ri kontakt uchun login/status/OTP, shaxsiy chatga qayta ulashdan keyingi haqiqiy OTP→JWT va OTP yuborish helperining yakuniy himoyasini tekshiradi. 32 bitdan katta shaxsiy IDlar ishlaydi; guruh/kanal, nol, noto‘g‘ri format va 52 bit chegarasidan tashqaridagi qiymatlar rad etiladi. Administrator yaratish buyrug‘i ham noto‘g‘ri chat uchun akkaunt yaratmaydi.

Faqat ajratilgan test PostgreSQL/Redis va sun’iy kontakt/ticket ishlatiladi; yangi test fixture’i o‘z OTP/ticket kalitlarini tozalaydi. Telegram yuborish va tashqi HTTP mock qilinadi, email xotiradagi backendda qoladi. Oddiy guruh hisobotlari umumiy Telegram senderi va mavjud kassa/sozlama testlarida ishlashda davom etishi tekshiriladi.

Bot handler testlari alohida Python 3.14/aiogram muhitida ishlaydi. Repo ildizidan:

```bash
telegram_bot_sms/.venv/bin/python -m unittest discover -s telegram_bot_sms/tests -p 'test_contact_handler.py' -v
```

Ular group/supergroup/channel, sender yo‘qligi, chat/sender mos kelmasligi, begona kontakt va valid shaxsiy ulanishni sinaydi. HTTP hamda Telegram javobi mock, tokenlar sun’iy; haqiqiy `.env` o‘qilmaydi va bot polling boshlanmaydi. Testlar ichida modulning in-memory flood holati har safar tozalanadi. [Telegram dialog IDlari](https://core.telegram.org/api/bots/ids) foydalanuvchi va guruh/kanal manzillari farqini tushuntiradi.

12-qadamdan boshlab shu moduldagi 12 test sekin HTTP kutishida boshqa haqiqiy bot handleri va boshqa kontakt ishlashini ham tekshiradi. `threading.Event` bilan sun’iy HTTP ushlab turiladi; boshqa handler javobi birinchi so‘rov tugashidan oldin tekshiriladi. Shu chatning takroriy so‘rovi cheklanadi. Connect/read timeout, ulanish va HTTP xatolarida umumiy xabar ham tekshiriladi. HTTP chaqiruvi `asyncio.to_thread` orqali bajariladi, mavjud `timeout=5` saqlanadi.

Cheklangan sinov muhitida asyncio’ning threadlar orasidagi mahalliy socket orqali uyg‘otishiga ruxsat kerak. Socket `send()`i taqiqlansa test qotib qolishi mumkin; HTTP mock bo‘lsa ham bu runtime talabi saqlanadi. Bu appning tashqi Telegram yoki DBga ulanishini talab qilmaydi.

## Profil rasmini xavfsiz saqlash

```bash
uv run pytest apps/accounts/tests/test_avatar_storage.py apps/accounts/tests/test_profile_views.py apps/core/tests/test_audit_regressions.py::test_avatar_rejects_html_and_reencodes_valid_images -q
```

Avatar sinovlari haqiqiy commit/rollback uchun transactional test DB va har testga alohida vaqtinchalik `FileSystemStorage` ishlatadi; model maydonining storage’i ham fixture orqali almashtiriladi. Haqiqiy media/MinIO ishlatilmaydi. Yangi fayl nomi avvalgi rasmni qayta yozmasligi uchun overwrite rejimi ham tekshiriladi.

Storage yozishidan oldingi/keyingi xato, DB yozuvi/commit xatosi, commit bajarilib javobi yo‘qolishi, commitdan keyingi cleanup xatosi, boshqa user bilan umumiy eski fayl, eskirgan request user va haqiqiy ikki PostgreSQL ulanishidagi parallel POST/POST hamda POST/DELETE tekshiriladi. Noto‘g‘ri fayl rad etilishi, WEBP/640px oqimi va takroriy DELETE ham saqlanadi. Eski fayl faqat commitdan keyin va DBda hech kimga bog‘lanmagan bo‘lsa o‘chiriladi.

DB va storage bitta atomar tizim emas: cleanup ishlamasa umumiy xabar logga yoziladi va ortiqcha fayl qolishi mumkin. Jarayon to‘xtashi yoki tashqi transaction rollbacki uchun avtomatik orphan tozalash/ishga qayta urinish vositasi bu qadamga kirmaydi.

## Production so‘rov cheklovlari

```bash
uv run pytest apps/core/tests/test_production_settings.py apps/core/tests/test_shared_throttles.py -q
```

Ushbu tekshiruv uchun Docker va oldindan mavjud `redis:7-alpine` image kerak. Sinov yangi vaqtinchalik Redisni tasodifiy `127.0.0.1` portida ochadi, diskka doimiy yozishni o‘chiradi va yakunda konteynerini tozalaydi. Amaldagi Redis yoki ilova bazasi ishlatilmaydi; DBga ulanishga urinish testda rad etiladi.

Chek uchun `60/minute`, do‘kon yaratish uchun `5/day` limiti haqiqiy production sozlamasini yuklagan alohida Python jarayonlarida tekshiriladi. Bir jarayonda limit to‘lsa, yangi jarayonda ham `429` va `Retry-After` olinishi kerak. Boshqa IP/owner mustaqilligi, vaqt oynasi o‘tganidan keyin qayta ruxsat, cheklangan ownerning do‘kon ro‘yxatini ochishi, support/login kalitlarining ajratilishi va Redis yo‘qligida lokal hisobga yashirin qaytmaslik ham tekshiriladi. Vaqt oynasi kutish bilan emas, test soatini siljitish bilan tekshiriladi.

Bu sinovlarda persistence handler va membership tekshiruvi almashtirilgan; haqiqiy view dispatch, DRF throttle, Redis va HTTP javob ishlaydi. Biznes ma’lumotlari va ruxsatlar tegishli sales/tenants/support/login API testlarida alohida tekshiriladi. Mavjud DRF algoritmi atomar emas; juda ko‘p bir vaqtdagi so‘rovlar uchun qat’iy kafolat deb qabul qilinmaydi.

## Production texnik API hujjatlari

```bash
uv run pytest apps/core/tests/test_api_docs_production.py apps/core/tests/test_production_settings.py -q
```

Yangi tekshiruvlar alohida jarayonlarda soxta maxfiy kalit bilan ishlaydi; dotenv o‘qish hamda DB/Redis ulanishlari bloklanadi. Productionda schema/Swagger/Redoc va slashsiz URLlar `404`, development/testda UI `200` qaytarishi tekshiriladi. Production sozlamasida `spectacular` command orqali OpenAPI yaratish va validatsiya ham tekshiriladi. Asosiy API, mahsulot qo‘llanmasi, support va readiness route’lari mavjudligi tekshiriladi.

Mavjud `apps/core/tests/test_docs.py` sxema va UI javoblarini test muhitida tekshiradi. Mahsulot qo‘llanmasining rol/ruxsat testlari `apps/accounts/tests/test_terms_and_docs_views.py`da. Ushbu modul har test uchun `tmp_path/docs`da sun’iy Markdownlar yaratadi va `monkeypatch` orqali faqat shu testdagi docs rootni almashtiradi. GET/PUT haqiqiy API orqali ishlaydi; yozish vaqtinchalik faylda tekshiriladi. Asl qo‘llanmani o‘zgartirish va keyin qaytarish amali olib tashlangan, tahrirlash testini tashlab ketish kerak emas.

```bash
uv run pytest apps/accounts/tests/test_terms_and_docs_views.py apps/core/tests/test_docs.py apps/support/tests/test_support.py::test_public_guides_exclude_private_manuals_and_images_are_real -q
```

Bu to‘plam ruxsat/tahrir sinovi bilan birga boshqa moduldagi ommaviy qo‘llanma va rasm o‘qilishini ham tekshiradi; testdagi docs root almashtirilishi keyingi modullarga tarqalmaydi. Test DB tranzaksiyasi haqiqiy disk faylini qaytarmaydi, shuning uchun ajratish aynan test fixture’ida bajarilgan. Ilovaning normal docs root qidiruvi o‘zgartirilmagan.

## Desktop workspace browser test

API/unit tests use the standard isolated test settings:

```bash
uv run pytest apps/core/tests/test_workspace.py -q
cd ../frontend/ilbi
npm test
```

The live browser suite needs a separate PostgreSQL database named **`ilbi_workspace_qa`**. Never point it at an application database. Create a local settings module outside the repository that imports `config.settings_test`, sets `DATABASES['default']` to this QA database, and uses locmem caches. Keep the existing test database separate. `tests/seed_workspace_browser.py` checks the exact database name before creating its synthetic shops/accounts, products, stock, sales and reminders. Each seed uses unique account/shop names. It writes short-lived synthetic session tokens to `/tmp/ilbi-workspace-seed.json` with owner-only file access.

From `backend/`, with the QA settings module available on `PYTHONPATH`:

```bash
DJANGO_SETTINGS_MODULE=workspace_qa_settings uv run python tests/seed_workspace_browser.py
DJANGO_SETTINGS_MODULE=workspace_qa_settings uv run python manage.py runserver 127.0.0.1:55441 --noreload
```

In another terminal:

```bash
cd frontend/ilbi
ILBI_WORKSPACE_SEED=/tmp/ilbi-workspace-seed.json ILBI_WORKSPACE_API=http://127.0.0.1:55441 npm run test:workspace
```

The suite uses Chrome and a temporary Vite server/profile. It clicks actual React pages against real Django endpoints and writes screenshots to a newly created `/tmp/ilbi-workspace-browser-*` directory. It verifies every sidebar route exists in the navbar; repeated animated switches retain the mounted form and POS cart; shift/notification requests are not duplicated; reminder data is reused; search opens products/customers/receipts; quick actions/imports work; reminders can be created/completed/deleted; calculator/favorites/reload, tenant/account/role isolation, desktop widths, mobile fallback and reduced-motion/no-View-Transitions behavior work. Existing modules beyond the six operational pages use navigation placeholders in this focused fixture; their own suites cover the full pages.

Stop the QA Django/PostgreSQL processes afterwards and remove the temporary token file when no longer needed. The seed does not send messages or create real transactions in an application database.

## Ilovaning tayyorligi

```bash
uv run pytest apps/core/tests/test_readiness.py apps/core/tests/test_production_settings.py -q
```

Docker va oldindan mavjud `postgres:16-alpine`, `redis:7-alpine` image’lari kerak. Sinov yangi sun’iy DB/Redis konteynerlarini faqat lokal portlarda, vaqtinchalik xotira storage bilan ochadi. Alohida WSGI jarayoni haqiqiy production sozlamasida ishlaydi, lekin faqat shu yangi xizmatlarga ulanadi; haqiqiy DB, env va Redis ishlatilmaydi. Yakunda o‘z jarayoni va konteynerlari tozalanadi.

Baza va Redis navbat bilan to‘xtatilganda HTTP `503`, qayta ishga tushgach `200` va healthcheck muvaffaqiyati tekshiriladi. Sinov DBsida jadval yaratilmagani va Redisga kalit yozilmagani ham tekshiriladi. Tashqi peer/soxta proxy headerlari rad etilishi, faqat GET/HEAD, xato tafsiloti va parolning javob/logga chiqmasligi, cache taqiqlanishi hamda HTTP checker noto‘g‘ri JSON/redirectni tayyor deb qabul qilmasligi tekshiriladi.

Repo ildizidan `python3 -m unittest discover -s tests/deployment -p 'test_https_edge.py' -v` production Compose start shartlarini va haqiqiy ajratilgan Nginxda readiness manzilining tashqaridan yopilganini tekshiradi. Bu test uchun avvalgi HTTPS image/OpenSSL talablari ham bajarilishi kerak.

## Production Nginx so‘rov cheklovlari

Repo ildizidan:

```bash
python3 -m unittest discover -s tests/deployment -p 'test_nginx_rate_limits.py' -v
```

Docker, OpenSSL va oldindan mavjud `nginx:alpine`, `python:3.12-slim` image’lari kerak. Testlar haqiqiy production shablonini ikki Nginx worker bilan, yangi vaqtinchalik tarmoq va TLS sertifikatida ishga tushiradi. Alohida sun’iy klientlar turli haqiqiy peer IP beradi; backend faqat echo/counter fixture. Ilova, haqiqiy DB/Redis/env yoki Telegram ishlatilmaydi, yakunda konteyner/tarmoq/sertifikatlar tozalanadi.

9 test login/kod/parol URLlarining umumiy limiti, query/slash/URL encoding bilan uni chetlab o‘tolmaslik, soxta IP headerlari, ikki workerning bitta hisoblagichi, boshqa IP va savdo API mustaqilligi, qisqa ko‘p kassirli so‘rovlar, ortiqcha API flood, kutgandan keyin tiklanish, JSON/`Retry-After`/xavfsizlik headerlari, rad etilgan so‘rovning backendga bormasligi va upstream `429` saqlanishini tekshiradi. HTTP redirect/ichki URLni yopish/TLS regressiyasi yuqoridagi 9 HTTPS/Compose testida qoladi. Bu sinov haqiqiy POS savdosi yoki internet miqyosidagi DDoS yuklama testi emas.

## Frontend

```bash
cd frontend/ilbi
npm ci
npm test
npm run lint
npm run build
```

Brauzer tekshiruvida akkauntlar va tashrif buyuruvchilar uchun alohida context ishlating. Yordam chati uchun mehmon murojaati, boshqa mehmonning kirishiga rad javobi, operator qabul qilishi, javob, rasm, sahifa yangilanganda tarix, mobil ko‘rinish va tillarni tekshiring.

## Servislarni to‘xtatish

```bash
docker compose -f backend/docker-compose.test.yml stop
```

Test servislaridagi ma’lumot vaqtinchalik. Uni haqiqiy mijoz ma’lumotlari yoki yagona zaxira nusxa uchun ishlatmang. Testlar soni va natijasini har bir o‘zgarishda haqiqiy ishga tushirish natijasi bilan qayd eting.
