# ILBI — loyiha auditi, vazifalar va muhokamalar

**Dastlabki audit sanasi:** 2026-10-12. **So‘nggi yangilanish:** 2026-10-16.  
**Holat:** 1, 2.1, 3, 4, 5, 7, 8, 9, 10, 11, 12, kengaytirilgan 13, 14 va 15-qadamlarning qayd etilgan lokal ishlari bajarilgan. Production Nginx cheklovlari 18 TLS/Compose/rate-limit testidan o‘tgan. 15-qadamda production demo login/sessiya/link/notification chegaralari yopildi; 802 backend testi va alohida bitta slow test — jami 803 test o‘tdi. Haqiqiy serverga deploy qilinmagan. Fiskal integratsiya, 6-qadam va Cloudflare WAF/DDoS ulanishi keyinga qoldirilgan.
**Joriy ko‘rsatma:** foydalanuvchi demo xavfini “yopa hammasini” deb tuzatishni va uch himoyani birinchi o‘ringa qo‘yishni topshirdi. Aniqlashtirishda `ilbi.uz` hali sotib olinmagani (bron), Cloudflarega ulanmagani va production server yo‘qligini bildirdi; WAF/DDoS ulanishini hozircha keyinga qoldirishni ma’qulladi. Lokal demo himoyasi yakunlanadi; domen/server/DNS o‘zgartirilmaydi.

## 1. Tahlil chegarasi va mavjud holat

Backendning accounts, tenants, permissions, catalog, inventory, sales, cashbox, analytics, core va Telegram qismlari; frontend sahifalari, kontekstlar, API client va asosiy komponentlar; migratsiyalar, Docker, Nginx, CI, testlar tuzilishi va mavjud rejalar ko‘rib chiqildi. Kod tahlili diskdagi **joriy ishchi holat** bo‘yicha: avvaldan ko‘plab o‘zgartirilgan, o‘chirilgan va yangi fayllar bor.

- 301 ta Python fayli AST orqali o‘qildi: sintaksis xatosi topilmadi. Bu dastur ishlaganda xato bo‘lmasligini anglatmaydi.
- Frontendda 49 ta JS/JSX manba fayli bor. Sahifalardagi ma’lumot yuklash, saqlash, tenant tanlash va muhim amallar tekshirildi.
- Backendda 56 ta test moduli bor. Test manbalarida `ThreadPoolExecutor`, `threading`, `Thread(`, `transaction=True` yoki `TransactionTestCase` bilan parallel bajarish tekshiruvlari topilmadi.
- Ushbu auditda pytest, frontend build/lint, migratsiya yoki server ishga tushirilmadi. Ma’lumotlar bazasiga, xizmatlarga va ilova kodiga o‘zgartirish kiritilmadi.
- Mavjud hujjatlardagi `371/377 passed` kabi yozuvlar oldingi tekshiruvlarga tegishli; ular ushbu auditning natijasi emas.
- `ILBI_MASTER_PLAN.md` va `docs/OZBEKISTON_QONUNI_WALKTHROUGH.md`dagi oldingi qarorlar hisobga olindi. Quyidagi qaydlar ulardagi bajarilmagan ishlarni ham, hozirgi koddagi aniq kamchiliklarni ham ko‘rsatadi; oldingi qarorlar qayta tasdiqlangan deb yozilmadi.

Mavjud yaxshi asoslar: tenant headeri faol membership bilan serverda tekshiriladi; biznes APIlarining asosiy qismi tenant bilan cheklangan; Stock manfiy qoldiqdan DB constraint bilan himoyalangan; B2B qabul javobi alohida serializer ishlatadi; public receipt tasodifiy token va rotatsiyaga ega; B2B rad/expiry darhol stockni tiklamaydi; yangi B2B qaytish va tafovut yozuvlarida idempotency hamda miqdor constraintlari bor. Ushbu mexanizmlarni tuzatishlarda saqlash kerak.

## 2. Tartib va belgilash qoidasi

Ro‘yxat **bajarish qiyinligidan osoniga** tartiblangan. Bu ishga kirishish uchun xavf bo‘yicha navbat emas.

- **5/5:** bir nechta biznes oqimi, ma’lumot modeli yoki tashqi integratsiyani o‘zgartiradi.
- **4/5:** bir nechta modul va holatni muvofiqlashtirish kerak.
- **3/5:** chegaralangan modul, lekin API/DB/frontend kelishuvi yoki regressiya tekshiruvi kerak.
- **2/5:** kichikroq texnik o‘zgarish va aniq tekshiruvlar.
- **1/5:** kichik, sababi va kutiladigan natijasi aniq tuzatish.

**P0** — hisob, vakolat, maxfiylik yoki ishga tushirish uchun eng jiddiy muammo. **P1** — yuqori xavfli xato. **P2** — funksional yoki ishonchlilik kamchiligi. **P3** — texnik xizmat va hujjat yaxshilanishi.

Topilma turi: **kodda aniq** — sabab manbada ko‘rinadi; **shartli xavf** — ko‘rsatilgan vaziyatda yuz beradi, dinamik tasdiq hali yo‘q; **ochiq reja** — avval kelishilgan, hali tugallanmagan ish; **yaxshilash** — kodni yuritish yoki ishlashini yaxshilash taklifi.

| ID | Vazifa | Qiyinlik | Xavf | Holat |
|---|---|---:|---|---|
| AUD-01 | Fiskal savdo va sotuvchi tekshiruvini yakunlash | 5/5 | P0 | Qisman bajarildi; qolgan qismi keyinga qoldirildi |
| AUD-02 | Smena va kassa hisobini yaxlit qilish | 5/5 | P0 | Muhokama kutilmoqda |
| AUD-03 | Savdo bekori, qaytarish va asl chek summasini ajratish | 5/5 | P1 | Muhokama kutilmoqda |
| AUD-04 | Parallel amallarda yagona lock tartibi | 5/5 | P1 | Muhokama kutilmoqda |
| AUD-05 | POS va qarz to‘lovlarining idempotency himoyasi | 4/5 | P1 | Muhokama kutilmoqda |
| AUD-06 | B2B kontragentni aniq do‘kon va rozilik bilan bog‘lash | 4/5 | P1 | Muhokama kutilmoqda |
| AUD-07 | Ichki transferda tovar, birlik va tannarxni saqlash | 4/5 | P1 | Muhokama kutilmoqda |
| AUD-08 | Frontendda tenant almashtirishni to‘liq ishlatish | 4/5 | P0 | Muhokama kutilmoqda |
| AUD-09 | Login, OTP va urinish cheklovlarini bog‘lash | 4/5 | P1 | Muhokama kutilmoqda |
| AUD-10 | Parol tiklash tokenlarining hayot sikli | 4/5 | P1 | Muhokama kutilmoqda |
| AUD-11 | Profil va parol o‘zgarishlarining atomarligi | 4/5 | P1 | Muhokama kutilmoqda |
| AUD-12 | Filialdan tenantga migratsiya shartlari | 4/5 | P1 | Muhokama kutilmoqda |
| AUD-13 | Amallar va maydonlar bo‘yicha ruxsatlar | 3/5 | P0 | Muhokama kutilmoqda |
| AUD-14 | Tannarxni ko‘rish ruxsatini APIda qo‘llash | 3/5 | P1 | Muhokama kutilmoqda |
| AUD-15 | B2B qaytishlarini analitika va kamchilik hisobiga qo‘shish | 3/5 | P1 | Muhokama kutilmoqda |
| AUD-16 | Katalog tahriri va xato holatida rollback | 3/5 | P1 | Muhokama kutilmoqda |
| AUD-17 | Kategoriya valyutasi va narx chegaralari | 3/5 | P1 | Muhokama kutilmoqda |
| AUD-18 | Pul summalarini bir xil yaxlitlash | 3/5 | P1 | Muhokama kutilmoqda |
| AUD-19 | Paginatsiya, filtrlar va query validatsiyasi | 3/5 | P2 | Muhokama kutilmoqda |
| AUD-20 | Media va MinIO ulanishini yakunlash | 3/5 | P1 | Muhokama kutilmoqda |
| AUD-21 | Production deploy, TLS va ekspluatatsiya | 3/5 | P1 | Qisman bajarildi |
| AUD-22 | Hujjat versiyalari va rozilik dalili | 3/5 | P2 | Muhokama kutilmoqda |
| AUD-23 | Auditning to‘liqligi, tenant va IP aniqligi | 3/5 | P2 | Muhokama kutilmoqda |
| AUD-24 | Xodimni ishga olish va akkauntni faollashtirish | 3/5 | P1 | Muhokama kutilmoqda |
| AUD-25 | Katta frontend sahifalarini qismlarga ajratish | 3/5 | P3 | Muhokama kutilmoqda |
| AUD-26 | CI va regressiya tekshiruvlarini kuchaytirish | 2/5 | P1 | Qisman bajarildi: 9-qadam hujjat testi izolatsiyasi |
| AUD-27 | Avatar tekshiruvi va faylni xavfsiz almashtirish | 2/5 | P1 | Qisman bajarildi: 10-qadam fayl/DB tartibi va parallel so‘rovlar |
| AUD-28 | Saqlanadigan state hookidagi render sikli | 2/5 | P0 | Muhokama kutilmoqda |
| AUD-29 | Tashqi ta’sirlarni transactiondan keyin bajarish | 2/5 | P1 | Muhokama kutilmoqda |
| AUD-30 | Davriy hisobot va Telegram retry | 2/5 | P2 | Muhokama kutilmoqda |
| AUD-31 | JWT bekor qilish va frontend sessiya tiklanishi | 2/5 | P1 | Qisman bajarildi: 8-qadam token version tekshiruvi |
| AUD-32 | Telegram 2FA kontaktini xavfsiz qayta bog‘lash | 2/5 | P1 | 11–13 lokal bajarildi: private chat, async HTTP, konflikt va admin orqali tiklash |
| AUD-33 | Brauzer xotirasidagi parolni olib tashlash | 1/5 | P0 | Muhokama kutilmoqda |
| AUD-34 | Kassa yopishda aniqlanmagan owner o‘zgaruvchisi | 1/5 | P1 | Muhokama kutilmoqda |
| AUD-35 | Egasi o‘chirilgan do‘konini qayta yoqa olishi | 1/5 | P2 | Muhokama kutilmoqda |
| AUD-36 | HEAD/OPTIONS so‘rovlari uchun ruxsat xaritasi | 1/5 | P2 | Muhokama kutilmoqda |
| AUD-37 | Public chekda qaytarilgan va sof summa | 1/5 | P2 | Muhokama kutilmoqda |
| AUD-38 | README, eski nomlar va holat yozuvlari | 1/5 | P3 | Muhokama kutilmoqda |

## 3. Vazifalar tafsiloti

### AUD-01 — Fiskal savdo va sotuvchi tekshiruvini yakunlash

**5/5 · P0 · Ochiq reja.**

**Dalil:** `backend/apps/sales/services/sale_service.py:24,94`; `backend/apps/tenants/models.py:11`; `backend/apps/tenants/seller_profile_service.py`; mavjud walkthrough’dagi launch talablari.

Sotuvchi profili va muddati tekshiriladi, `DEBUG=False` bo‘lsa savdo ataylab rad etiladi. Fiskal adapter, provayder tasdiqlaydigan natija va xatolar, dalil hujjatlari, identifikatorlarni shifrlash va saqlash muddati hali yakunlanmagan. `tax_identifier` DBda oddiy `CharField`; javobda maskalash saqlashdagi shifrlash o‘rnini bosmaydi. Operator review API mavjud, lekin to‘liq tekshiruv interfeysi va dalil jarayoni yo‘q.

**Taklif:** avval kelishilgan sotuvchi/fiskal jarayonni provayder bilan moslab tugatish. Hozirgi production taqiqini faqat `DEBUG=True` bilan chetlab o‘tishni yechim deb qabul qilmaslik.

**Bajarildi mezoni:** provayder javobi, qayta urinish va takroriy so‘rovlar boshqarilgan; sotuvchi dalili va review jarayoni ishlaydi; production gate uchun haqiqiy integratsiya dalili mavjud. Bog‘liq: T2.8, fiskal launch vazifalari.

**Muhokama/qaror — 2026-10-12:** foydalanuvchi eng qiyin birinchi vazifani muhokama qilishni va joriy holat uchun yechim tavsiyasini so‘radi. Quyidagilar agent taklifi; hali foydalanuvchi tasdiqlagan qaror emas. **Bajarilish:** boshlanmagan.

#### AUD-01 uchun taklif etilgan yechim

1. **Fiskal provayder orqali integratsiya.** Amaldagi reyestrdagi virtual kassa yechimidan boshlash. Tanlash mezonlari: hujjatlashtirilgan API va sandbox, chek yaratish va holatini aniqlash, takroriy so‘rovdan himoya, asl chek bo‘yicha qisman/to‘liq refund, tenant/do‘kon kesimidagi ro‘yxat, MXIK/markirovka talablari va uzilishdagi ruxsat etilgan oqim. Bitta provayder adapterini to‘liq ishlatish; boshqa provayder uchun adapter chegarasini saqlash. ILBI+provayder integratsiyasi reyestr/tasdiq talabini qanday qoplashi Soliq/OFD/TXKM bilan yozma aniqlashtiriladi.
2. **Sotuvchi va do‘konning fiskal ulanishi alohida.** Mavjud SellerProfile rasmiy sotuvchi tekshiruvini ifodalaydi. Har tenant uchun alohida fiskal ulanish: tegishli sotuvchi, provayder, ro‘yxatdan o‘tgan kassa identifikatori, test/haqiqiy muhit, credential referensi va ishlash holati. Bir sotuvchining tasdiqlanishi uning har bir do‘kon kassasi avtomatik tayyor degani emas. Production savdo faqat faol membership + amaldagi seller tasdig‘i + tayyor fiskal ulanish + tegishli mahsulot/to‘lov shartlari bo‘lsa ochiladi. DEBUG savdoni yoqish tugmasi bo‘lmaydi.
3. **Minimal dalil bilan seller review.** Tekshiruv uchun zarur rasmiy ma’lumot yoki dalil referensi yig‘iladi; har bir ownerdan bir xil ortiqcha hujjat talab qilinmaydi. Operator kim, qachon, qaysi dalil asosida qaror qilganini saqlaydi. Shaxsiy identifikator/zarur fayllarga cheklangan kirish, shifrlash/kalit boshqaruvi va kelishilgan saqlash muddati qo‘llanadi. Muhim rekvizit o‘zgarsa qayta review holati ochiladi.
4. **Savdo va fiskal operatsiya yozuvlari alohida.** Checkout uchun barqaror operation ID va idempotency kaliti; mahsulot nomi, narx, soliq/MXIK va tender ma’lumotlari snapshotda saqlanadi. DB transaction ichida tekshirish, tovar rezervi va yuborish yozuvi yaratiladi; tarmoq so‘rovi pul/stock locklarini ushlab turmaydi. Fiskal javob keyingi transactionda bir marta qo‘llanadi. Olingan fiskal belgi/raqam/QR alohida saqlanadi; ILBI elektron nusxa tokeni bilan aralashtirilmaydi. Pul qabul qilingan bo‘lsa uning real holati ham saqlanadi, noaniq fiskal natija sabab o‘chirilmaydi.
5. **Uzilish va noaniq natijani boshqarish.** Tavsiya etilgan holatlar: tayyorlandi, yuborilmoqda, tasdiqlandi, aniq rad etildi, natija noma’lum. Timeout aniq rad etildi deb yozilmaydi. Noma’lum holatda operation ID bo‘yicha provayderdan natija olinadi; provayder shartnomasiga mos idempotent retry qilinadi. Stock/pulni yakunlash yoki rezervni bo‘shatish shu aniqlangan natijaga bog‘lanadi. Offline savdo faqat tanlangan yechimning rasmiy qo‘llab-quvvatlangan tartibi bo‘yicha.
6. **Mahsulotlar va qaytarishlar.** Provayder talab qiladigan MXIK, o‘lchov/soliq va markirovka ma’lumoti tayyorlanadi. Rasmiy ro‘yxat bo‘yicha naqd mumkin bo‘lmagan pozitsiyalar bloklanadi; aralash savat uchun avval kelishilgan ajratilgan chek oqimi provayder bilan moslanadi. Refund asl fiskal chek va tenderga bog‘lanadi; B2B va ichki transferlarning tegishli hujjat oqimlari alohida aniqlashtiriladi.

**Taklif etilgan bajarish ketma-ketligi:**

1. Provayderga beriladigan aniq talablar va ILBI integratsiya sxemasini tayyorlash; rasmiy API/sandbox va maqom aniqligi.
2. Lokal biznes asosi: AUD-05 idempotency, AUD-18 yaxlitlash, AUD-03 refund, AUD-02/04 pul/stock va transaction qoidalarini tegishli tasklar bilan muvofiqlashtirish. Seller review va tenant fiskal ulanish modeli.
3. Bitta provayder adapteri, yuborish/reconciliation jarayoni va interfeysda aniq holatlar.
4. Sandboxda muvaffaqiyat, rad etish, timeoutdan keyingi topilgan chek, parallel takroriy so‘rov, qisman refund, expiry va cheklangan MXIK savati uchun tekshiruvlar; so‘ng tashqi tasdiq bilan bitta do‘kon pilot.

**Qayta o‘qilgan rasmiy manbalar:**

- [Soliq qo‘mitasining 2024-06-21 izohi](https://gov.uz/oz/soliq/news/view/14527): reyestrdagi/integratsiyalangan yechimlar va ikkilamchi fiskal hisob haqidagi tushuntirish. Bu manbadan ILBI uchun avtomatik ruxsat olindi deb xulosa qilinmaydi.
- [2026-04-28 reyestr o‘zgarishi](https://gov.uz/oz/soliq/news/view/159141): provayder/kassa/TXKMning joriy maqomini tanlash vaqtida tekshirish zarurligi. Bog‘langan OFD virtual kassa reyestri sahifasi bu ko‘rib chiqishda timeout berdi; muayyan provayderning joriy reyestr maqomi tasdiqlanmadi va provayder tanlanmadi.
- [2026-04-03 MXIK va to‘lov shakli izohi](https://gov.uz/oz/soliq/news/view/149988): tegishli ro‘yxat uchun naqd cheklovi, aralash savatga ikki chek tavsiyasi.
- LexUZning umumiy 943-son sahifasida kelajakdagi 2026-10-22 tahriri ham ko‘rinadi. 2026-10-12 sanasi bilan alohida ochish muvaffaqiyatli bo‘lmadi; kelajakdagi o‘zgarish hozir amalda deb qabul qilinmadi.

**Ochiq muhokama:** do‘konlarda hozir ishlatilayotgan kassa/provayder bor-yo‘qligi; tanlanadigan yechimning rasmiy API shartnomasi va integratsiya maqomi. Taxminiy API endpoint yoki provayder kafolati yozilmadi.

#### 2026-10-16 — production tayyorgarligining 2-qadami: fiskal ulanish talablari

**Tasdiqlangan doira:** mavjud kod va rasmiy provayder talablarini tekshirish, ulanish yo‘lini tayyorlash. Foydalanuvchi **hali provayder tanlamaganini** bildirdi. Ushbu qism tayyor; fiskal integratsiya bajarildi deb belgilanmaydi. Ilova kodi, DB va haqiqiy konfiguratsiya o‘zgartirilmadi; provayderga chek yoki murojaat yuborilmadi.

**Joriy kod bilan tasdiqlangan bo‘shliqlar:**

| Qism | Hozirgi holat va kerakli o‘zgarish |
|---|---|
| Sotuvchi va do‘kon | `SellerProfile.fiscal_provider` oddiy matn. Har bir do‘konga tegishli kassa/muhit/credential referensi va ulanish tekshiruvi kerak. Seller review va `tenants.manage_settings` mavjudligi fiskal ulanish tayyorligini anglatmaydi. |
| Mahsulot rekvizitlari | `ProductVariant`da MXIK/IKPU va qadoq kodi yo‘q. `sku`, do‘konning mahsulot `code`i va shtrix-kod bu rekvizitlarning o‘rnini bosmaydi. Markirovka talab qilinadigan mahsulotlar uchun har bir sotilayotgan birlik kodlarini yig‘ish oqimi ham alohida kerak. |
| O‘zgarmas chek ma’lumoti | `Sale.receipt_snapshot` do‘kon/sotuvchi/soliq sozlamalarini saqlaydi. `SaleItem`da mahsulot nomi, birlik va fiskal rekvizitlar nusxasi yo‘q; serializer nom va birlikni hozirgi katalogdan oladi. Katalog tahriri o‘tgan savdodagi mahsulot ta’rifini o‘zgartirmasligi kerak. |
| QQS | Do‘kon darajasida soliq sozlamalari va satr summalari bor. Mahsulotga xos stavka/imtiyoz va provayder qabul qiladigan soliq kodlari hali moslanmagan. AOS va foyda solig‘i QQS maydoniga yuborilmaydi. |
| Nasiya | `DebtPayment` kontragentga bog‘langan, asl `Sale`larga taqsimot yo‘q. Keyingi to‘lov, qaytarish va boshqa do‘konda undirilgan qarzni tegishli asl hujjatlarga bog‘lash kerak; eski umumiy qarzga taxminiy chek bog‘lanmaydi. |
| Qaytarish | `SaleRefund` va `SaleVoidLog` mavjud, ammo tashqi fiskal operatsiya va asl provayder cheki bilan aloqa yo‘q. Qaytarilgan satrlar, soliq, real to‘lov turi va takroriy urinish bitta o‘zgarmas refund operatsiyasiga bog‘lanishi kerak. |
| Tashqi so‘rov | Fiskal adapter, yuborish navbati va natijani qayta tekshirish jarayoni yo‘q. `create_sale()` DB transaction ichida stock/qarzni darhol o‘zgartiradi; unga tarmoq chaqiruvini shunchaki qo‘shish mumkin emas. |
| Production cheklovi | `create_sale()` yangi savdoni `DEBUG=False`da rad etadi. `DebtService` va `VoidService` bu gate orqali o‘tmaydi; ularning fiskalga tegishli amallari ham ulanish holatini tekshirishi kerak. Eski savdo nusxalari avtomatik fiskal chek deb belgilanmaydi. |

**Ko‘rib chiqilgan ikki nomzod — yakuniy tanlov emas:**

| Nomzod | Rasmiy manbada ko‘rinadigan imkoniyat | Tanlashdan oldin ochiq masala |
|---|---|---|
| Uzum Fiscalization | Ochiq API, test muhiti, savdo/qaytarish va operation ID orqali chek havolasini olish bor. | Mustaqil ILBI kassalari, turli STIRlar va tashqi terminal to‘lovlari uchun shartlar; takroriy so‘rov kafolati; nasiya va qisman refund tartibi. [Rasmiy hujjat](https://developer.uzumbank.uz/en/fiscalization/). |
| E-POS Communicator | Provayder REST API, chek holati va asl chek bo‘yicha qisman/to‘liq qaytarishni taklif qiladi. | To‘liq API hujjati integrator loginini talab qildi; sandbox, idempotency, autentifikatsiya va ko‘p do‘konli ulanish shartnomasi olinishi kerak. Ochiq marketing misoli asosida adapter yozilmaydi. [Mahsulot tavsifi](https://epos.uz/uz/products/api), [integrator hujjatlari](https://docs.epos.uz/). |

Uzum hujjatida API kaliti, tiyindagi butun summalar, MXIK va qadoq kodi ko‘rsatilgan. Bo‘nak/nasiya rejimlari alohida kelishiladi; HTTP 202 yakuniy fiskal tasdiq deb qabul qilinmaydi. Test va production kalitlari ajratilgan. Bu imkoniyatlar har qanday ILBI sotuvchisi avtomatik ulanadi degani emas. [Uzum rasmiy API hujjati](https://developer.uzumbank.uz/en/fiscalization/).

**Spetsifikatsiyada aniqlashtiriladigan farqlar:** rasmiy [OpenAPI 0.0.2](https://developer.uzumbank.uz/en/redocusaurus/en_fiscalization.yaml) o‘qildi: unda `servers` yo‘q; endpointlarning hostini hujjatdagi test/production yo‘riqnomasidan olish kerak. Schema GET yo‘lini `/v2/receipt/{operation_id}/receipt_url` deb beradi, testing matnida boshqa tartib yozilgan. Matnda markirovka `labels`i talab qilinadi, lekin tekshirilgan `ReceiptDataItem` schemasida bu maydon yo‘q. Qaysi shartnoma amaldaligi provayder bilan tasdiqlanadi. Ayniqsa timeoutdan keyingi 404 qayta POST qilish xavfsizligini o‘zi kafolatlamaydi.

**Reyestr maqomi:** Soliq qo‘mitasining [2026-04-28 xabari](https://gov.uz/oz/soliq/news/view/159141) amaldagi reyestrni tekshirishni tavsiya qiladi. Uning OFD virtual kassa reyestriga havolasi bu tekshiruvda ham ochilmadi. Muayyan yechimning joriy reyestr maqomi yoki ILBI uchun ruxsat tasdiqlandi deb yozilmaydi; tanlangan provayderdan kassa nomi/versiyasi, reyestr dalili va ILBI bilan ishlash tartibi olinadi.

**Provayder bilan aniqlashtirish uchun tayyor savollar:**

1. ILBI orqali ko‘p egali, turli STIRli do‘konlarga ulanish mumkinmi? Har do‘kon/kassa qanday ro‘yxatdan o‘tadi, kimning nomida chek chiqadi va TXKM kim bo‘ladi?
2. Naqd hamda mavjud tashqi Uzcard/Humo terminali to‘lovlari alohida qo‘llanadimi? To‘lov va fiskalizatsiya APIlari qanday ajratilgan?
3. Amaldagi OpenAPI, sandbox va hisob ochish shartlari qanday? Sinovdan productionga o‘tish uchun qaysi tasdiqlar kerak?
4. Bir operation ID bilan takroriy so‘rov, boshqa payload, timeout, 202 va vaqtinchalik 404 qanday boshqariladi? Holatni so‘rash muddati, webhook imzosi va qayta urinish chegaralari qanday?
5. Nasiya savdosi, keyingi qarz to‘lovi va qisman/to‘liq refund asl hujjatga qanday bog‘lanadi? Offline rejim mavjud bo‘lsa rasmiy tartibi qanday?
6. MXIK/qadoq, kasr miqdor, QQS/imtiyoz, markirovka va naqd cheklangan tovarlar uchun tekshirish qoidalari qanday? API cheklovlari, yaxlitlash va chekdagi fiskal rekvizitlar tarkibi qanday?
7. Har kassa/chek uchun tarif, ulash xarajati, xizmat uzilishi va yordam shartlari qanday? ILBI interfeysi orqali ishlashning rasmiy maqomi qanday tasdiqlanadi?

Bu savollar hech kimga yuborilmadi; ular provayderdan olinadigan texnik/tashkiliy javoblar ro‘yxati.

**2.1 uchun dastlabki taklif (bajarilish natijasi quyida):** mahsulot variantiga ixtiyoriy MXIK va qadoq rekvizitlari; katalog API/formasida tahrirlash; yangi savdo satrida mahsulot nomi, birlik va shu rekvizitlarning o‘zgarmas nusxasi. O‘tgan savdolarga hozirgi katalog ma’lumotidan sun’iy tarix yozilmaydi; eski satrlar mavjud ko‘rinishi bilan o‘qiladi. Bu bosqich provayder chaqiruvi yoki production savdosini ochishni o‘z ichiga olmaydi.

- **Tegiladigan qismlar:** `apps/catalog/models/product_variant_model.py`, katalog serializer/service/formalari; `apps/sales/models/sale_item_model.py`, `sale_service.py`, savdo/public chek serializerlari; nullable maydonlar uchun migratsiyalar va tegishli testlar.
- **Qabul mezoni:** rekvizit kiritish/o‘qish va tenant ruxsati ishlaydi; katalog tahrirlanganda yangi savdoning saqlangan tavsifi o‘zgarmaydi; eski cheklar ochiladi; summa/QQS/refund xulqi saqlanadi; production gate testi o‘tadi.
- **So‘nggi alohida qismlar:** do‘kon fiskal ulanishi va ruxsatlar; mahsulot soliq/markirovka qoidalari; provayder shartnomasiga mos operatsiya/rezerv/yuborish/natijani tekshirish; nasiya/refund taqsimoti; adapter va sandbox sinovlari; yozma tashqi tasdiqdan so‘ng bitta do‘kon pilot. Har birining aniq doirasi bajarishdan oldin kelishiladi.

**Tekshiruv natijasi:** tegishli model/service/serializerlar statik o‘qildi, rasmiy sahifalar va ochiq OpenAPI tekshirildi. API kaliti, sandboxga haqiqiy so‘rov yoki yangi dastur kodi bo‘lmagani uchun integratsiya testi bajarilmadi. Ushbu yangilanish faqat audit hujjatiga tegishli.

#### 2026-10-16 — 2.1-qadam bajarildi: katalog rekvizitlari va chek mahsulot nusxasi

**Qaror:** foydalanuvchi 2.1 haqidagi savolga tanlovni agentga topshirdi; taklif etilgan 2.1 bajarildi. Provayder tanlash, haqiqiy fiskal so‘rov va production savdosini ochishga bu qaror tatbiq etilmadi.

- `ProductVariant.mxik` va `package_code` nullable/ixtiyoriy maydonlar. MXIK formati, qadoq kodi uzunligi va boshqaruv belgilari tekshiriladi. Kodlar matn ko‘rinishida saqlanadi; sonli JSON qiymati rad etiladi va boshidagi nollar saqlanadi. Bu format tekshiruvi kodning rasmiy katalogda mavjudligini tasdiqlamaydi.
- Mahsulot yaratish, birinchi/qo‘shimcha variant va mahsulot/variant PATCH APIlari yangi rekvizitlarni qabul qiladi. PATCHda yuborilmagan maydon saqlanadi, bo‘sh/null yuborilsa tozalanadi. Mavjud katalog ruxsatlari va tenant chegarasi qo‘llanadi.
- Katalogning yaratish/tahrirlash formalariga umumiy `FiscalMetadataFields` qo‘shildi; JSON va rasm bilan multipart yuborish ishlaydi. Oldin saqlangan, yangi maydonlari yo‘q qoralamalar ham ochiladi.
- Yangi `SaleItem.product_snapshot` savdo vaqtida mahsulot nomi, variant nomi, birlik, SKU, kod, shtrix-kod va fiskal rekvizitlarni saqlaydi. Savdo tafsiloti, public chek va B2B kirim serializerlari shu nusxadan o‘qiydi. Takroriy checkout oldingi nusxani qaytaradi; qaytarish uni yangilamaydi.
- Legacy satrda snapshot `NULL` qoladi: avvalgi nom/birlik ko‘rinishi saqlanadi, yangi MXIK/qadoq qiymatlari tarixga to‘qib yozilmaydi. Yangi savdoda bo‘sh qolgan rekvizit keyinchalik katalogdan to‘ldirib olinmaydi.
- `ReceiptItemCodes` saqlangan rekvizitlarni 58/80 mm va public chek nusxasida mavjud bo‘lsa ko‘rsatadi. Amaldagi soliq hisoblash, summa va production gate saqlandi.

**Migratsiyalar:** `catalog/0006_productvariant_mxik_productvariant_package_code.py`, `sales/0016_saleitem_product_snapshot.py`. Ajratilgan test bazasi va tekshirilgan lokal development Compose backendida qo‘llandi. Lokal bazadagi oldingi `ProductVariant`, `SaleItem` va `Sale` yozuvlarining yangi maydonlardan tashqari qiymatlari hamda soni oldin/keyin hash bilan bir xil chiqdi. Mavjud mahsulotlarga kod va eski savdo satrlariga snapshot yozilmadi. Production serverga deploy qilinmadi.

**Tekshiruvlar:**

- To‘liq ajratilgan backend pytest: **628 passed**, shu jumladan **17 yangi test**. Avvalgi Django email sozlamalari bo‘yicha deprecation ogohlantirishlari mavjud.
- `npm test`, frontend lint va production build muvaffaqiyatli. Lintdagi avvalgi ogohlantirishlar alohida ochiq; yangi komponentlar va yangi browser test lint tekshiruvi o‘tdi.
- `npm run test:catalog-fiscal`: haqiqiy React formalarida JSON/multipart yaratish/tahrirlash, boshidagi nollar, tozalash, eski qoralama, validatsiya va mobil maydonlar; 58/80 mm hamda public chekda saqlangan/legacy rekvizit ko‘rinishi tekshirildi. Haqiqiy bazaga test mahsuloti yoki savdo yozilmadi.
- `npm run test:receipts`: QQS rejimlari, AOS/foyda solig‘i, qog‘oz eni va chek sozlamalari regressiyasi o‘tdi.
- Django `check`, `makemigrations --check --dry-run`, OpenAPI `spectacular --validate --fail-on-warn` hamda yangi Python fayllari uchun Ruff tekshiruvi o‘tdi.
- Migratsiyadan so‘ng lokal API orqali **7 ta faol do‘kon katalogi** va mavjud legacy public chek GET bilan tekshirildi; barchasi ochildi, test mahsuloti/savdosi yaratilmagan.

**2.2 taklifi — ma’qullangan, keyingi qaror bilan keyinga qoldirilgan:** har do‘kon uchun fiskal ulanishning alohida yozuvi va **Xizmatlar & Sozlamalar**da sozlash oynasi; uni boshqarish uchun `tenants.manage_fiscal_connection` ruxsati. Bu bosqichda sotuvchi/provayder, test yoki production muhiti, ro‘yxatdan o‘tgan kassa rekviziti va tekshiruv holati boshqariladi. Ruxsat sotuvchi profilini rasmiy tasdiqlash yoki production savdosini ochish vakolatini bermaydi. Ulanish rekvizitlari o‘zgarsa tekshiruv yangilanadi; foydalanuvchi `tayyor/tasdiqlangan` holatini qo‘lda yoqa olmaydi. Haqiqiy adapter va tashqi tasdiq keyingi alohida ishda bo‘ladi; API siri public chek yoki oddiy do‘kon sozlamasi javobiga qo‘shilmaydi.

#### 2026-10-16 — fiskal ishlar keyinga qoldirildi

Foydalanuvchi 2.2ni ma’qullab, avval fiskal provayder, mavjud bank terminali va Uzum orqali ulanishni muhokama qilishni so‘radi. Keyin batafsil Markdown tayyorlash va fiskal yo‘nalishni vaqtincha o‘tkazib, boshqa production vazifalariga o‘tishni buyurdi. **Hali boshlanmagan 2.2 va haqiqiy integratsiya endi bajarilmay turadi; 2.1 natijasi saqlanadi.** Ishni davom ettirish alohida so‘raladi.

[Fiskal xizmat va Uzum qo‘llanmasi](FISKAL_UZUM_QOLLANMA_UZ.md) yaratildi: joriy holat, tushunchalar, murojaat matni, shartnoma oldi savollari, do‘kon rekvizitlari, rasmiy API haqida tekshirilgan qaydlar, qolgan texnik ishlar va qaytadan boshlash ro‘yxati bor. Uzum bilan shartnoma, API kaliti yoki reyestr tasdig‘i olingan deb belgilanmadi. Production POS cheklovi o‘zgartirilmadi; boshqa production tayyorgarligi davom etadi.

### AUD-02 — Smena va kassa hisobini yaxlit qilish

**5/5 · P0 · Kodda aniq va parallel bajarishda shartli xavf.**

**Dalil:** `backend/apps/cashbox/services/cashbox_service.py:78,186`; `backend/apps/cashbox/models.py`; `backend/apps/sales/models/debt_payment_model.py`.

Smena alohida identifikator bilan yuritilmaydi: oxirgi hisobot va `Sale.created_at`dan hisoblanadi. `close_shift()` transaction ichida, lekin smenani yopishni seriallashtiruvchi lock yo‘q. Ikki yopish so‘rovi bir xil tushum uchun ikki hisobot yaratishi mumkin. Hisoblangandan keyin qo‘shilgan kirim/chiqim keyingi umumiy `update()` bilan oldingi hisobga bog‘lanishi mumkin. Boshlang‘ich naqd, o‘tgan smenadan qolgan pul, real qarz to‘lovining tenderi va boshqa smenada bajarilgan refund alohida hisoblanmaydi.

**Taklif:** smena chegarasi va pul harakati yozuvini aniq belgilash; yopish, savdo va kirim/chiqimni bitta muvofiqlashtirilgan tartibga keltirish. Naqd, karta/bank, qarz kamayishi va mijoz krediti alohida tushuncha bo‘lsin.

**Bajarildi mezoni:** parallel yopishda bitta yakuniy hisobot; hisoblangan yozuvlar bilan bog‘langan yozuvlar bir xil; boshlang‘ich qoldiq, naqd qarz to‘lovi va turli smenadagi refund to‘g‘ri chiqadi. Bog‘liq: T5.2–T5.3, AUD-03/04/05.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-03 — Savdo bekori, qaytarish va asl chek summasini ajratish

**5/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/sales/services/void_service.py:38,117,173`; `backend/apps/sales/models/sale_model.py`; `backend/api/v1/inventory/views/movement_views.py`.

`void_sale_item()` asl `total_amount`ni kamaytiradi; `void_sale()` to‘liq bekor qilishda uni saqlaydi. `refunded_amount` retail voidda yangilanmaydi. Bir xil chek uchun ikki xil hisob qoidasi paydo bo‘lgan. Inventar mijoz qaytarishi esa asl sotuv va tender bilan majburiy bog‘lanmagan: omborni oshirib, savdo/qarzni o‘zgartirmasligi mumkin. Voidning 7 kunlik texnik chegarasi iste’molchi qaytarish jarayoniga ham aralashgan.

**Taklif:** avval kelishilganidek xato savdoni tuzatish, mijoz qaytarishi va jismoniy qabulni ajratish; asl summani o‘zgartirmaslik; refund/qarz/kreditni alohida yozuvda saqlash.

**Bajarildi mezoni:** 100 000 so‘mlik chekdan 20 000 qaytarilganda asl summa 100 000, qaytarilgan 20 000, sof 80 000; qisman va to‘liq qaytarish shu qoidaga amal qiladi; tovar va pul ikki marta qaytarilmaydi. Bog‘liq: T4.4–T4.5/T4.10.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-04 — Parallel amallarda yagona lock tartibi

**5/5 · P1 · Shartli xavf, kodda tartib farqi aniq.**

**Dalil:** `backend/apps/sales/services/sale_service.py:183,233`; `backend/apps/sales/services/b2b_transfer_service.py:481,657`; `backend/apps/inventory/services/stock_service.py:141`; `backend/apps/catalog/services/product_service.py:22`; `backend/apps/catalog/services/category_service.py:18`; `backend/apps/tenants/services.py:53`.

Savdo Stockni, keyin Counterpartyni lock qiladi; B2B qaytish Counterpartyni, keyin Stockni lock qiladi. Bir xil qoldiq va kontragentda ular o‘zaro kutishga tushishi mumkin. Batch kirim foydalanuvchi yuborgan tartibda ishlaydi. SKU/kod generatsiyasi mavjud qatorlarni lock qiladi, bo‘sh katalogda esa lock qiladigan qator yo‘q; birinchi parallel yaratishlar bir xil kod olishi mumkin. Tenant maksimumini `count()` bilan tekshirish parallel yaratishga chidamli emas.

**Taklif:** barcha tegishli servislar uchun yagona lock tartibi, bo‘sh to‘plamlar uchun barqaror lock va konfliktlarni boshqarish.

**Bajarildi mezoni:** savdo/qaytish, teskari tartibdagi batch kirim, bo‘sh katalog yaratish va tenant limiti uchun parallel tekshiruvlar o‘tadi; deadlock/unique konflikt foydalanuvchiga 500 bermaydi. Bog‘liq: reja §4.4/4.6, T4.12.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-05 — POS va qarz to‘lovlarining idempotency himoyasi

**4/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/sales/services/sale_service.py:74`; `backend/apps/sales/models/sale_model.py`; `frontend/ilbi/src/pages/POS.jsx:457`; `backend/apps/sales/services/debt_service.py:17`.

POS so‘rovi `idempotency_key` yubormaydi. Backendda kalit oddiy index, unique constraint yoki payload hash yo‘q. Mavjud savdoni izlash receipt lockidan oldin: ikki so‘rov bir vaqtda “yo‘q” deb topib, keyin navbat bilan ikkita savdo yaratishi mumkin. Shu kalit bilan boshqa savat yuborilsa ham eski savdo qaytadi. Qarz to‘lovi takroriy so‘rovda qarzni yana kamaytiradi.

**Taklif:** checkout/to‘lov urinishiga kalit berish; noaniq tarmoq xatosidan keyin aynan shu kalitni saqlash; DB himoyasi va payload mosligini tekshirish.

**Bajarildi mezoni:** javobi yo‘qolgan so‘rovni takrorlash yangi savdo/to‘lov yaratmaydi; parallel bir xil so‘rov bir marta hisoblanadi; o‘zgargan payload bir xil kalit bilan rad etiladi. Bog‘liq: T4.9/T4.11.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-06 — B2B kontragentni aniq do‘kon va rozilik bilan bog‘lash

**4/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/sales/services/counterparty_service.py:16,47`; `backend/api/v1/sales/serializers.py:38`.

Telefon raqami bilan User izlanib, uning birinchi faol do‘koni yoki xodimlik do‘koni avtomatik `target_tenant`ga aylanadi. Ko‘p do‘konli egada `.first()` qaysi do‘kon mo‘ljallanganini bilmaydi. Oddiy mijozni saqlash kutilmaganda B2B savdoga aylanishi mumkin. Manba tenantning o‘ziga bog‘lashdan ham shu servisda alohida himoya yo‘q.

**Taklif:** avval kelishilgan public tenant code va aniq tanlov/tasdiq oqimini qo‘llash; telefonni aloqa ma’lumoti sifatida ishlatish.

**Bajarildi mezoni:** oddiy kontragent yaratish B2B bog‘lanishni o‘zidan yaratmaydi; ko‘p tenantli ega, o‘z do‘koniga bog‘lash va boshqa sellerning tasdiqlashi tekshirilgan. Bog‘liq: T4.7/D-19.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-07 — Ichki transferda tovar, birlik va tannarxni saqlash

**4/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/inventory/services/transfer_service.py:40,86,257`; `backend/apps/sales/services/sale_service.py:212`.

Manzil varianti mahsulot/variant nomi bilan avtomatik tanlanadi; birlik va valyuta mosligi majburiy tekshirilmaydi. Masalan, nomi bir xil “kg” va “dona” qoldiqlari qo‘shilib ketishi mumkin. `_apply()` transfer qabulida `last_cost_price`ni olib o‘tmaydi: yangi manzil Stockida tannarx bo‘sh qoladi, keyingi savdoda 0 olinadi va foyda sun’iy oshadi. Qabul bosqichida dispatchdan keyin o‘zgargan seller bog‘lanishi ham qayta tekshirilmaydi.

**Taklif:** tovarni moslash mezonini birlik/valyuta bilan aniqlash; jo‘natilgan tannarxni qator snapshotida saqlash; qabul/qaytishdagi seller vakolatini kelishilgan siyosat bilan tekshirish.

**Bajarildi mezoni:** nomi bir xil, birligi/valyutasi boshqa tovarlar avtomatik qo‘shilmaydi; transferdan keyingi tannarx va foyda to‘g‘ri; keyinchalik seller o‘zgarsa pending transfer uchun aniq qoida bor. Bog‘liq: T1.10.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-08 — Frontendda tenant almashtirishni to‘liq ishlatish

**4/5 · P0 · Kodda aniq.**

**Dalil:** `frontend/ilbi/src/pages/Services.jsx:89,156`; `Sales.jsx:167`; `Dashboard.jsx:82`; `Audit.jsx:14`; `Employees.jsx:44`; `components/layout/Layout.jsx:94`; `src/api/client.js:115`.

Header almashtirilganda API client yangi tenantni yuboradi, lekin Services, Dashboard, Audit, notifications va Sales yuklashlarining ayrim dependencylarida active tenant yo‘q. Servicesda A do‘konining eski formasi ekranda qolib, saqlash B do‘koniga ketishi mumkin. Employees eski `user.tenant_id`ga tayanib, u bo‘lmasa `1`ni tanlaydi. Tez almashtirishda oldingi async javoblar yangi tenant stateini ham bosishi mumkin.

**Taklif:** yuklash va saqlashda aniq tenant kontekstini ishlatish; tenant o‘zgarishida eski ma’lumot/modalni yopish yoki yangilash; eski so‘rov javoblarini bekor qilish/inkor etish.

**Bajarildi mezoni:** A→B almashishda barcha biznes sahifalar yangilanadi; A formasi Bga saqlanmaydi; tenant tanlanmaguncha biznes so‘rovlar ketmaydi; tez almashish va bir nechta tab tekshirilgan. Bog‘liq: T2.6.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-09 — Login, OTP va urinish cheklovlarini bog‘lash

**4/5 · P1 · Kodda aniq.**

**Dalil:** `backend/api/v1/accounts/views/admin_login.py`; `backend/apps/accounts/services/otp_services.py:49`; `login_throttle.py:75,113`.

OTP tasdiqlashda parol bosqichi o‘tilganini bildiradigan bir martalik ticket yo‘q: username va telefon uchun saqlangan kod tekshiriladi. OTPni o‘qish va o‘chirish alohida Redis buyruqlari, parallel tasdiqlar ikkalasi ham muvaffaqiyatli bo‘lishi mumkin. Throttle username/telefon/email kirish matni bilan alohida yuradi, permanent ban esa faqat `username` bo‘yicha update qiladi. Shu accountning uch identifikatori himoyada bir xil subyekt hisoblanmaydi.

**Taklif:** parol bosqichini qisqa muddatli ticket bilan bog‘lash; OTP/ticketni atomar iste’mol qilish; account va IP cheklovlarini normalizatsiya qilish.

**Bajarildi mezoni:** ticketsiz ikkinchi bosqich rad etiladi; parallel OTPda bitta muvaffaqiyat; uch login shakli bir account uchun bir xil hisoblagichga ega. Bog‘liq: T7.1–T7.3.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

#### 2026-10-16 — Demo akkauntlarning production chegarasi tekshiruvi

**Dastlabki tahlil holati:** foydalanuvchi demo akkauntlar ochilganda xavfsizlik teshigi qolgan-qolmaganini tekshirishni so‘radi. Kod tahlili va ajratilgan sinov **BAJARILDI**; o‘sha tahlilda demo implementatsiyasi va haqiqiy akkauntlar o‘zgartirilmadi. Quyidagi xavf va probe o‘zgarishdan oldingi tarixiy dalil; tuzatish 15-qadamda.

**Mavjud himoya:** demo password-only login `DEBUG=True`, `LOCAL_DEMO_LOGIN_ENABLED=True`, demo username, sun’iy telefon va maxsus hozirgi/legacy guruhning birgalikdagi mosligini talab qiladi. Parol tekshiruvi, inactive user va faol membership talabi saqlanadi. Oddiy demo staffning boshqa tenant katalogiga kirishi `403`. Production sozlamasi debug/demo flaglarini rad etadi; Compose demo flagini `False` qiladi. `seed_demo_platform` HTTP endpoint emas: CLI, faqat bo‘sh DB va ikki dev flag bilan ishlaydi; xatoda transaction rollback bor. Parol manbadan olinadi, kodda universal yashirin parol topilmadi va bu tekshiruvda uning haqiqiy qiymati o‘qilmadi.

**Tasdiqlangan shartli xavf — P1:** demo login bergan JWT oddiy JWTdan ajratilmagan. `CustomJWTAuthentication` hamda refresh faqat faol user va token versionni tekshiradi; demo guruhiga production taqiqi yo‘q. Seed yaratadigan `demo_admin` haqiqiy `platform_admin`/superuser vakolatida. Agar demo user qatorlari va token imzolash kaliti productionga saqlab o‘tilsa, flaglarni o‘chirish avval berilgan sessiyani bekor qilmaydi. Bu parolsiz yangi login topildi degani emas: avval olingan, hali muddati tugamagan token zarur. Alohida production baza/kaliti ushbu token ko‘chishi shartini bartaraf etadi, lekin akkauntning o‘ziga production taqiqi ham kerak.

**Dinamik dalil:** vaqtinchalik pytest probe faqat `config.settings_test`, localhost:5433 va `test_...` DB shartlarini tekshirgach sun’iy demo admin va boshqa oddiy hisob yaratdi. Haqiqiy login endpointidan demo access/refresh olindi; so‘ng ikkala demo flagi o‘chirildi. Eski access bilan global hisoblar `200` (boshqa hisob ko‘rindi), eski refresh `200`, yangilangan access ham `200`. Test shu shartni namoyish qiladi; haqiqiy production serverdagi baza/kalit holati tekshirilmagan. Probe fayli avtomatik o‘chirildi, DB qatorlari test transactionida qaytarildi, token/kalit/parol logga chiqarilmadi. Mavjud demo + production settings testlari va probe: **43 passed, 8 oldingi email deprecation warnings, 4.66 s**.

**Tarixiy taklif:** productionda maxsus demo hisoblarini login, JWT access va refreshda qat’iy rad etish; demo o‘chirilganda eski sessiya bilan ham kirmasligini regressiya testida tekshirish. Foydalanuvchi keyin “yopa hammasini” deb tasdiqladi; yakuniy doira va natija quyida.

#### 2026-10-16 — 15-qadam: demo akkauntlarning production kirishini yopish

**Holat: LOKAL BAJARILDI.** Foydalanuvchi demo hisoblarini productionda, eski sessiya bo‘lsa ham, kiritmaslik taklifini tasdiqladi. Hisoblar o‘chirilmaydi; lokal demo ikkala dev flag yoqilganda ishlaydi.

**Yechim:** `DemoAccessService.is_blocked` hozirgi va legacy demo guruhini flaglardan mustaqil saqlanadigan belgi sifatida tekshiradi. `DEBUG` yoki `LOCAL_DEMO_LOGIN_ENABLED` o‘chiq bo‘lsa, ushbu belgi bor hisobga yangi login va JWT access/refresh `401`. User role, `is_active`, to‘g‘ri parol yoki aynan joriy `token_version` bu taqiqni chetlab o‘tmaydi. Username/telefonni oddiy ko‘rinishga o‘zgartirish ham belgi saqlanganda yordam bermaydi; faqat nom/prefiks sabab belgisiz haqiqiy hisob bloklanmaydi. Token chiqaruvchi umumiy helperda ham yakuniy guard bor.

**Qo‘shimcha kirish yo‘llari:** oldingi login ticketi Telegram status/send/verifyda rad etiladi, OTP yuborish yoki tekshirish chaqirilmaydi. Reset/taklif havolalari valid emas deb ko‘rsatiladi; confirm/resume yoki eski parol orqali yozuv yangilanmaydi. Bloklangan demo hisobga reset emaili/tokeni yaratilmaydi; public javob noma’lum hisobdagi umumiy shaklni saqlaydi. `verify` mavjud API shartiga ko‘ra `200 {valid:false}` beradi. Yordam Telegram tasklari ham shu demo adminning shaxsiy/guruh preference’larini, test navbatini va eski ENV telefonini qabul qiluvchi sifatida ishlatmaydi. Allaqachon navbatdagi task bajarilayotganda joriy siyosat qayta tekshiriladi.

**Tekshiruv:** yangi `test_demo_production_isolation.py`da 33 holat va oldingi 15 demo testi **48/48, 2.21 s** o‘tdi. Dastlab yangi testlarda reset API maydoni/statusi taxmini noto‘g‘ri edi (`identifier` o‘rniga tashqi `login`, invalid verify uchun `400` o‘rniga mavjud `200/valid:false`); test API shartiga moslashtirildi, API xatti-harakati o‘zgartirilmadi. Keng backend regressiyasi: **802 passed, 1 slow deselected, 16 oldingi email deprecation warnings, 41.12 s**. Ajratilgan `test_code_expires_after_ttl` keyin alohida **1 passed, 1.44 s**: jami barcha **803** test bajarildi. Django system check va OpenAPI validate/fail-on-warn o‘tdi. Yangi test/asosiy guard fayllariga Ruff check/format, eski tahrirlangan modullarga import va CI sintaksis/undefined-name tekshiruvi o‘tdi; eski modullardagi mavjud E402/E501/S110 signallari ommaviy qayta yozilmadi.

**Fayllar:** demo access service, CustomJWTAuthentication, token refresh, login view, token chiqarish helperi, login ticket/password reset xizmatlari, support tasklari, mavjud demo testlari, yangi izolyatsiya testlari va yo‘riqnomalar. Model/migratsiya, haqiqiy hisob/token versiyasi, secret/env yoki frontend o‘zgarmadi. Testlar sun’iy test DB/Redisda, Telegram/SMTP mock/xotirada; serverga deploy/restart qilinmadi. Release vaqtida backend va Celery worker yangilanishi kerak.

### AUD-10 — Parol tiklash tokenlarining hayot sikli

**4/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/accounts/services/password_reset_service.py:390,544,554`; `backend/api/v1/accounts/views/password_reset.py:41`; `backend/api/v1/accounts/serializers.py`.

Yangi reset so‘rovi avvalgi tokenni bekor qilmaydi. Tasdiqlashda token username validatsiyasidan oldin o‘chadi: band username tanlash havolani yaroqsiz qiladi. Token berilgandan keyin xodim bo‘shatilgan yoki account bloklangan bo‘lsa confirm bosqichida vakolat qayta tekshirilmaydi. Username mavjud accountda ham almashtiriladi, serializer izohi esa faqat birinchi o‘rnatishni va’da qiladi. Request view yuborish xatosi/cooldown natijasini e’tiborsiz qoldirib “yuborildi” deydi; `email_hint/has_email` esa ma’lum va noma’lum accountni farqlaydi.

**Taklif:** accountga tegishli bitta faol reset sikli, tokenni yakuniy muvaffaqiyatga mos iste’mol qilish, joriy membership/faollik tekshiruvi va bir xil tashqi javob siyosati.

**Bajarildi mezoni:** eski token yangi so‘rovdan keyin ishlamaydi; username xatosidan keyin qayta urinish mumkin; fire/ban eski linkni ishlatmaydi; yuborish muvaffaqiyatsiz bo‘lsa soxta muvaffaqiyat ko‘rsatilmaydi. Bog‘liq: T7.4.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-11 — Profil va parol o‘zgarishlarining atomarligi

**4/5 · P1 · Shartli parallel xavf va kodda aniq validatsiya bo‘shlig‘i.**

**Dalil:** `backend/api/v1/accounts/views/profile_views.py:24,128`; `complete_profile.py`; `backend/apps/accounts/services/password_reset_service.py:524,575`.

Profil tahriri `user.save()` bilan barcha ustunlarni eski instance’dan yozadi. Boshqa so‘rov parol/token_version/is_active ni o‘zgartirgach, kechroq tugagan profil so‘rovi eski qiymatlarni qayta yozishi mumkin. Parol yo‘llarida asosan uzunlik tekshiriladi, settingsdagi `AUTH_PASSWORD_VALIDATORS` qo‘llanmaydi. Emailni o‘zgartirishda qayta tasdiq yo‘q; reset email bo‘yicha `.first()` ishlatadi, email esa DBda unique emas.

**Taklif:** xavfsizlik o‘zgarishlarini transaction/lock bilan, oddiy profilni faqat tegishli `update_fields` bilan yozish; parol validatorlarini qo‘llash; emailga oid avval kelishilgan siyosatni bajarish.

**Bajarildi mezoni:** parallel profil PATCH parol resetini yoki banni qaytarmaydi; zaif parol rad etiladi; email orqali reset qaysi accountga tegishli ekanligi noaniq bo‘lmaydi. Bog‘liq: T7.6.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-12 — Filialdan tenantga migratsiya shartlari

**4/5 · P1 · Shartli xavf.**

**Dalil:** `backend/apps/inventory/migrations/0006_remove_branches_one_stock_per_variant.py`; `backend/apps/tenants/migrations/0008_remove_branch_model.py`; `0011_delete_branch_after_scope_removal.py`; accounts/sales/cashboxdagi branch removal migratsiyalari.

Migratsiya branch va eski transfer jadvallarini o‘chiradi, Stockni variant uchun `OneToOneField` qiladi. Ikki filialda bir variantning qoldig‘i mavjud bo‘lsa unique o‘zgarish bajarilmaydi. Eski branch, narx va tarixni alohida tenantga ko‘chirish `RunPython` bosqichi yo‘q.

**Audit davomida yangilangan dalil:** tashqi o‘zgarishda Branch o‘chirish `0008`dan yangi `0011`ga ko‘chirildi; accounts/cashbox/sales branch removal dependencylari va jadval mavjudligini tekshirish qo‘shildi. Avval kuzatilgan erta o‘chirish holati hisobotda hozirgi kodga mos yangilandi. Bu populated DBdagi ko‘p Stock qatori va tarixni tenantlarga ko‘chirish masalasini o‘zidan yopmaydi; toza va eski DB oqimlari hali ushbu auditda ishga tushirilmagan.

Mavjud master reja DBni disposable deb belgilagan. Shuning uchun eski ma’lumotni yo‘qotish hozirgi bo‘sh/test DB uchun o‘zidan alohida production zarar deb baholanmadi; muammo populated DB yoki mavjud ma’lumotni saqlash talabida yuz beradi.

**Taklif:** disposable DB bilan boshlash va ma’lumotni saqlab ko‘chirish holatlarini hujjatda aniq belgilash; kerak bo‘lsa oldinga yo‘nalgan ko‘chirish migratsiyasi va to‘g‘ri dependencylar.

**Bajarildi mezoni:** toza DB va ikki filialda qoldig‘i bor eski DB uchun kelishilgan strategiya tekshirilgan; mavjud tarix taqdiri ochiq yozilgan. Bog‘liq: T1.1/T1.6.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-13 — Amallar va maydonlar bo‘yicha ruxsatlar

**3/5 · P0 · Kodda aniq.**

**Dalil:** `backend/api/v1/cashbox/views/cashbox_views.py:20,51,96`; `backend/config/settings.py:147`; `backend/api/v1/catalog/views/product_views.py:73,293`; `backend/api/v1/tenants/views.py:326,347`.

Kassa view/base’da action permission yo‘q, REST defaults’da ham permission belgilanmagan. Membership bor xodim, alohida vakolatsiz, chiqim/kirim yozishi va smenani yopishi mumkin. Mahsulot yaratishdagi `initial_quantity` ombor kirimini faqat `catalog.add_product` bilan bajaradi. Variant archive endpointi `archive_product` o‘rniga `change_product` talab qiladi. Telegram test endpointi oddiy autentifikatsiyali staffga maxsus group ID berishga ruxsat beradi. Transfer target view platform admin uchun `self.tenant=None` holatini ishlovsiz qoldiradi.

**Taklif:** mavjud ruxsat katalogini har amal va maydon guruhiga qo‘llash; owner-only amallarni alohida saqlash; defaults’da xavfsiz rad etish.

**Bajarildi mezoni:** nol ruxsatli faol staff kassa yozuvini/smena yopishni bajara olmaydi; initial stock uchun tegishli ombor vakolati kerak; admin target so‘rovi 500 bermaydi. Bog‘liq: T3.1–T3.3.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-14 — Tannarxni ko‘rish ruxsatini APIda qo‘llash

**3/5 · P1 · Kodda aniq.**

**Dalil:** `backend/api/v1/sales/serializers.py:77`; `backend/api/v1/inventory/serializers.py:9,30`; sale/stock viewlarining serializer chaqiruvlari.

`sales.view_sale` bor xodimga `cost_price`, `inventory.view_stock` bor xodimga `last_cost_price` va movement `cost_price` qaytadi. `catalog.view_cost_price` alohida tekshirilmaydi; serializerlarda foydalanuvchi konteksti ham bu maqsadda berilmagan. Frontend ustunni yashirishi API javobidagi tannarxni himoya qilmaydi.

**Taklif:** tannarx maydonlarini serializer darajasida vakolatga qarab chiqarish; barcha javob yo‘llarini tekshirish.

**Bajarildi mezoni:** tannarx ruxsatisiz list/detail/create/void javoblarida cost maydoni yo‘q; ruxsatli staff va ownerda bor. B2B va public chekdagi mavjud whitelist saqlanadi. Bog‘liq: T3.5/D-08.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-15 — B2B qaytishlarini analitika va kamchilik hisobiga qo‘shish

**3/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/analytics/services/analytics_service.py:104,279`; `backend/apps/inventory/services/deficit_service.py:39`.

Analitika faol miqdorni faqat `quantity - voided_quantity` bilan hisoblaydi. B2Bning jismonan qaytgan va tafovuti yopilgan miqdorlari ayirilmaydi. Qisman qabul qilingan savdoning qolgan qismi return-pending bo‘lganda sale statusi butunlay hisobotdan chiqib ketadi; qabul qilingan qism ham yo‘qoladi. Deficit filtri yangi `b2b_partially_accepted` item statusini qamramaydi. Sana chegaralari UTC bo‘yicha, frontend esa brauzer mahalliy sanasidan foydalanadi.

**Taklif:** yangi miqdor bucketlari va kelishilgan hisobot semantikasini yagona hisobga keltirish; Tashkent kun chegaralarini ishlatish.

**Bajarildi mezoni:** qisman qabul + pending return + physical return + discrepancy closure ketma-ketligida tushum/foyda/deficit izchil; mahalliy yarim tunda bir xil sana ko‘rinadi. Bog‘liq: T5.1/T6.1.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-16 — Katalog tahriri va xato holatida rollback

**3/5 · P1 · Kodda aniq.**

**Dalil:** `backend/api/v1/catalog/views/product_views.py:73,105,141,179,242`.

Mahsulot + boshlang‘ich kirim yaratishda barcha exceptionlar transaction ichida ushlanib Response qaytariladi: mahsulot yaratilgach kirimda biznes xatosi bo‘lsa, tashqi transaction muvaffaqiyatli tugab, foydalanuvchi 400 ko‘rsa ham mahsulot qolishi mumkin. Product PATCH avval mahsulotni saqlaydi, keyin variantni; variant xatosi birinchi o‘zgarishni qaytarmaydi. Noto‘g‘ri `variant_id` bo‘lsa rad etish o‘rniga birinchi variant tahrirlanadi. Variant PATCHdagi save va narx auditi ham bitta transactionda emas.

**Taklif:** bog‘liq yaratish/tahrirni to‘liq atomar qilish; faqat kutilgan biznes xatolarini xavfsiz javobga aylantirish; aniq tanlangan variantni tekshirish.

**Bajarildi mezoni:** kirim/variant/audit xatosida yarim mahsulot yoki yarim tahrir qolmaydi; noto‘g‘ri variant ID bilan boshqa variant o‘zgarmaydi. Bog‘liq: servis qatlamiga oid reja qoidalari.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-17 — Kategoriya valyutasi va narx chegaralari

**3/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/catalog/services/category_service.py:122`; `backend/api/v1/catalog/views/product_views.py:147`; `backend/api/v1/catalog/serializers.py`.

Variant valyutasi kategoriyadan olinadi. Qoldig‘i va tarixi bor kategoriya UZS→USDga o‘zgartirilishi yoki mahsulot boshqa valyutadagi kategoriyaga ko‘chirilishi mumkin: narx va qoldiq qiymati konvertatsiyasiz boshqa birlikda talqin qilinadi. Oddiy katalog narx serializerlarida `min_value` yo‘q, manfiy narxlar saqlanishi mumkin.

**Taklif:** tarix/qoldiq bor tovarning valyutasini tasodifan o‘zgartirishdan himoya; manfiy narxni rad etish. B2Bdan yaratilgan variantdagi kelishilgan 0 narx holatini hisobga olish; advisory `price_min`ni savdoga taqiq qilib yubormaslik.

**Bajarildi mezoni:** tarixli kategoriya va product move valyutani yashirin o‘zgartirmaydi; manfiy narx rad etiladi. Bog‘liq: T9.7/D-21.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-18 — Pul summalarini bir xil yaxlitlash

**3/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/sales/services/sale_service.py:183,227`; `b2b_transfer_service.py:485,661`; reja §4.2.

`qty * unit_price` ikki xonaga yaxlitlanmasdan line va sale summasiga qo‘shiladi; DB saqlashda har ustun alohida yaxlitlanadi. Ikki qatorning har biri `0.333 × 0.05 = 0.01665` bo‘lsa, qatorlar 0.02+0.02=0.04, savdo jami esa 0.03 bo‘lishi mumkin. B2B qaytishda `quantize(0.01)` ishlatiladi, lekin rejalashtirilgan `ROUND_HALF_UP` aniq berilmagan; qismlarga bo‘lib qaytarishda ham yaxlitlash qoldig‘i boshqarilmaydi.

**Taklif:** yagona money helper, yaxlitlangan qatorlar yig‘indisi va qaytarishning kumulyativ summa qoidasi.

**Bajarildi mezoni:** fractional quantityda sale jami qatorlar yig‘indisiga teng; to‘liq qaytarishning yig‘ilgan qiymati asl qiymatga teng va undan oshmaydi. Bog‘liq: T4.9/reja §4.2.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-19 — Paginatsiya, filtrlar va query validatsiyasi

**3/5 · P2 · Kodda aniq.**

**Dalil:** `backend/api/v1/sales/views/sale_views.py:36`; inventory movement va cashbox list viewlari; `frontend/ilbi/src/pages/Sales.jsx:167,655`; `src/api/client.js`dagi list metodlari.

Ko‘p listlar `page` bo‘lmasa barcha qatorlarni qaytaradi; movement/cashbox/payment listlarining ayrimlari `page`ni umuman qo‘llamaydi. POS/katalog barcha variantni yuklab, frontendda filtrlab sahifalaydi. Sales esa serverdan 20 qator oladi, sana/to‘lov/status filtrlarini faqat shu sahifaga qo‘llaydi: boshqa sahifadagi mos sotuv “topilmadi” bo‘lishi mumkin. Raw sana va ID querylari serializer bilan validatsiya qilinmaydi; noto‘g‘ri format ayrim ORM yo‘llarida 500ga olib keladi. Bazi narx filtrlari noto‘g‘ri qiymatni jim tashlab ketadi.

**Taklif:** barcha ro‘yxatlarda bir xil paginatsiya shartnomasi; filtrlashni serverda paginatsiyadan oldin bajarish; query serializer va barqaror ordering.

**Bajarildi mezoni:** filtr butun natijani qamraydi, count/page mos; katta katalog to‘liq yuklanmaydi; noto‘g‘ri sana/ID 400 beradi. Bog‘liq: T3.7.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-20 — Media va MinIO ulanishini yakunlash

**3/5 · P1 · Konfiguratsiyaga bog‘liq xavf.**

**Dalil:** `backend/config/settings.py:229,242`; `docker-compose.yml:60`; `nginx/nginx.conf:43`; `frontend/ilbi/src/api/client.js:72`.

MinIO yoqilganda endpointning defaulti Docker ichidagi `http://minio:9000`. Shu host bilan chiqarilgan media URL tashqi brauzerda ochilmaydi; frontend faqat nginx/ilbi hostlarini moslaydi. Compose’da bucket yaratish va kerakli access policy bosqichi yo‘q. Nginx `/media/`ni doim lokal katalogdan beradi. Storage credentiallari xavfsiz bo‘lmagan defaultlarga ega; media/backup uchun to‘liq ekspluatatsiya oqimi ko‘rsatilmagan.

**Taklif:** tashqi URL, ichki endpoint, bucket yaratish, cheklangan credential va fayl hayot siklini bitta konfiguratsiyaga keltirish. Haqiqiy sirlarni hisobotga yozmaslik.

**Bajarildi mezoni:** lokal va MinIO rejimida upload→brauzerda ko‘rish ishlaydi; qayta deployda fayl saqlanadi; kerakli bucket/policy va backup/restore dalili bor. Bog‘liq: T9/production storage ishlari.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-21 — Production deploy, TLS va ekspluatatsiya

**3/5 · P1 · Ochiq reja va konfiguratsiyada aniq.**

**Dalil:** `docker-compose.yml`; `frontend/ilbi/Dockerfile`; `nginx/nginx.conf`; `backend/gunicorn.conf.py`; `backend/config/settings.py:39`; backend Dockerfile/entrypoint.

README production uchun ham development Compose’ni tavsiya qiladi. Frontend Vite dev server, 5173 port ochiq, Nginxda TLS/SPA build yo‘li yo‘q; host whitelistda `*` bor. Gunicorn reload default yoqilgan. Gevent bilan oddiy psycopg2 ishlatiladi, rejalashtirilgan psycogreen patch yo‘q. Buildlar `latest` va backendda frozen syncdan fallback syncga tayanadi. Worker/beat app startga tayanadi, migration tayyorligiga aniq signal yo‘q. Backup/restore, monitoring va readiness oqimi ham yakunlanmagan.

**Taklif:** production konfiguratsiyasi, frontend static build, TLS, aniq hostlar, takrorlanuvchi build va xizmatlarning tayyorlik signalini yakunlash.

**Bajarildi mezoni:** build artefakti Nginx orqali beriladi; HTTPS/host/secret talablari bajarilgan; DB kutishi workerning hamma so‘rovini to‘smasligi tekshirilgan; deployment va restore jarayoni yozilgan. Bog‘liq: T9.1–T9.5.

**Yangilanish — 2026-10-16, production tayyorgarligining 1-qadami:** foydalanuvchi faqat production konfiguratsiyasi, HTTPS/proxy, xavfsiz cookie va Gunicorn reload tuzatishini tasdiqladi. **AUD-21 qisman bajarildi; serverga deploy qilinmadi.**

- `config.settings_production` mahalliy `.env`ni o‘qimaydi; production uchun uchta `.env.production.example` tayyorlandi, haqiqiy `.env.production` fayllari Git’dan chiqarildi. Debug/demo, wildcard host va HTTP frontend origin bilan production ishga tushmaydi.
- Production Nginx 80→443 yo‘naltiradi, noma’lum Host/SNI’ni rad etadi, TLS sertifikatlarini read-only mount qiladi va mijoz yuborgan proxy headerlarini qayta yozadi. Regex location ichki API blokini chetlab o‘tmasligi uchun `^~ /api/v1/internal/` ishlatiladi.
- Django’da HTTPS proxy ishonchi, secure session/CSRF cookie’lari va canonical HTTPS redirect qo‘shildi. Ichki tokenli Docker HTTP ulanishi saqlandi. Production’da Gunicorn reload yoqilmaydi.
- HSTS canonical domen uchun dastlab 3600 soniya. Barcha subdomenlar tekshirilmaguncha `includeSubDomains` va browser preload yoqilmadi; `check --deploy`dagi shu ikki maslahat ogohlantirishi yashirilmagan.
- To‘liq backend tekshiruvi: **611 passed**; Compose va vaqtinchalik haqiqiy Nginx TLS/proxy tekshiruvlari: **9 passed**. Regressiya tekshiruvlari `tests/deployment/`da. Haqiqiy domen sertifikati, DNS va sertifikat yangilashni serverda tekshirish deploy bosqichida qoladi.
- Qolgan AUD-21 ishlari (deterministik image, startup/migratsiya ajratilishi, readiness, backup/restore va monitoring) bu tasdiqqa kirmaydi; keyingi alohida qarorlarni kutadi.

#### 2026-10-16 — production tayyorgarligining 3-qadami uchun taklif: ma’lumot zaxirasi va tiklash

**Holat:** foydalanuvchi sodda tushuntirishdan keyin **“Ha, tayyorla”** deb tasdiqladi. Quyidagi doiraning lokal implementatsiyasi va sun’iy tiklash sinovi bajarildi. Serverda faollashtirish, avtomatik jadval va tashqi nusxa alohida kelishiladi.

**Aniq dalillar:** `automation/README.md` va `scripts/install_backup_timer.py` faqat kodni GitHubga zaxiralashni tavsiflaydi. `scripts/commit_queue.py` media, maxfiy env/kalit va bazaga tegishli fayllarni chiqarib tashlaydi. Repoda production DB/media uchun `pg_dump`/tiklash skripti va tiklash sinovi topilmadi. Serverda tashqi backup tizimi bor-yo‘qligi bu tahlilda tekshirilmagan.

`docker-compose.prod.yml`da PostgreSQL 16, `postgres_data`, mahalliy `media_data`, ixtiyoriy `minio_data` va qayta tiklanadigan `static_data` bor. Support rasm/ovozlari DBning `BinaryField`larida saqlanadi; katalog/akkaunt rasmlari media storage’da. Administrator tahrirlaydigan Markdownlar bind-mounted `docs/` ichida. Shuning uchun DB nusxasining o‘zi barcha yuklangan fayl va o‘zgargan hujjatni qoplamaydi.

**Taklif etilgan 3-qadam doirasi:**

1. Asosiy PostgreSQL bazasini `pg_dump` bilan olish va alohida bazaga `pg_restore` qilish vositalari. Qo‘shimcha real ishlatilayotgan bazalar alohida aniqlanadi; `init-db.sql`dagi legacy `shop_db`ni o‘chirish bu doiraga kirmaydi. PostgreSQL hujjati dumpning DB ichidagi mos nusxani olish usulini tushuntiradi; bu media bilan avtomatik umumiy snapshot emas. [PostgreSQL 16 backup hujjati](https://www.postgresql.org/docs/16/backup-dump.html).
2. DB, mahalliy media va o‘zgaruvchan Markdownlar uchun bitta backup manifesti: vaqt, loyiha/release, tarkib, checksum va bajarilish holati. DB/media yozuvlarini muvofiqlashtirish sharti hujjatlashtiriladi. MinIO yoqilgan bo‘lsa mahalliy media nusxasi yetarli deb sukutda muvaffaqiyat qaytarilmaydi; bucket zaxirasi ham hal qilinishi kerak.
3. Arxivni cheklangan kirish bilan repo tashqarisida saqlash, shifrlash va maxfiy konfiguratsiyani alohida tiklash tartibi. Haqiqiy env va kalit GitHubga yuborilmaydi. Shifrdan ochish kaliti backupning yagona nusxasi yonida yagona joyda qoldirilmaydi.
4. Xato/qisman yozilgan nusxani tayyor deb e’lon qilmaslik; parallel ishga tushishni cheklash, tekshirilgan nusxalar uchun saqlash qoidasi va aniq restore yo‘riqnomasi. Jadval/retention va boshqa serverdagi saqlash manzili deployment sharoitiga ko‘ra kelishiladi.
5. Faqat sun’iy, ajratilgan test DB/media bilan nusxa olish → yangi ajratilgan joyga tiklash → ma’lumot va faylni solishtirish sinovi. Production bazasini ustidan tiklash, haqiqiy ma’lumotni tashqi xizmatga yuborish yoki production taymerini faollashtirish bu dastlabki tasdiqqa kirmaydi.

**Tegilishi rejalashtirilgan qismlar:** `scripts/`da DB/media backup/restore vositalari; `tests/deployment/`da ajratilgan tiklash sinovi; production runbook va sir qiymatlarisiz sozlash namunasi. Zarur bo‘lsa backup uchun alohida Compose servis/profile tayyorlanadi. Mavjud source-backup/commit-queue oqimi o‘zgartirilmaydi.

**Bajarildi mezoni:** yangi ajratilgan DB/media nusxasidan sintetik ma’lumot va fayllar to‘g‘ri tiklanadi; checksum va xato holatlari tekshiriladi; noto‘g‘ri production nishoniga tasodifiy restore rad etiladi; maxfiy qiymatlar logga chiqmaydi; serverdagi faollashtirish va boshqa joydagi nusxa bo‘yicha qolgan tashqi ishlar aniq ko‘rsatiladi. Haqiqiy server/offsite restore sinovisiz to‘liq production tiklash kafolati berilmaydi.

**Bajarilgan ish — 2026-10-16:**

- `scripts/data_backup.py`: PostgreSQL 16 custom dump + mahalliy media + hujjatlarni bitta manifestga yig‘ish; GnuPG AES-256 shifrlash; parolni yopiq tashqi fayldan FD orqali uzatish; arxivni qayta ochib checksum tekshirgandan keyin atomar e’lon qilish. Repo ichiga ma’lumot yozish, parallel nusxa olish va oldingi arxiv ustidan yozish rad etiladi.
- Yozuvchi Compose xizmatlari to‘xtatilgani tekshiriladi; vosita ularni o‘zi to‘xtatmaydi. MinIO aniqlansa mahalliy media bilan to‘liq nusxa deb muvaffaqiyat qaytarmaydi. Tashqi yozuvchilar va hujjat tahririni to‘xtatish operator mas’uliyati.
- Restore faqat yangi PostgreSQL konteyneri/volume va yangi katalogga bajariladi. Port ochilmaydi, tarmoq ulanmaydi, mavjud DBni nishon qilish parametri yo‘q. GnuPG yaxlitligi, barcha checksumlar va xavfsiz tar tarkibi DB yaratishdan oldin tekshiriladi. Xatoda faqat shu urinishning belgilangan resurslari tozalanadi.
- Sir qiymatlarisiz `ops/data-backup.example.json`, [operator yo‘riqnomasi](DATA_BACKUP_RESTORE_UZ.md), README havolalari va `.gitignore` himoyasi qo‘shildi. Mavjud commit-queue/source-backup o‘zgartirilmadi. Ilova modeli, real DB va haqiqiy envga tegilmadi.

**Tekshiruv:** yangi **11 backup testi** haqiqiy GnuPG va ajratilgan PostgreSQL 16 bilan o‘tdi. Sun’iy savdo summalari, qarz, binary support fayli, rasm/hujjat, bo‘sh katalog, foreign key va sequence tiklandi; manba o‘zgarmadi. Xato parol, shikastlangan arxiv, checksum, traversal/link, mavjud destination, pg_dump xatosi, parallel run, ishlayotgan writer va MinIO rad etilishi tekshirildi. Barcha deployment testlari birga: **20/20 passed, 15.030 s**; Ruff format/check va yangi hujjat havolalari/JSON tekshiruvi o‘tdi. Sinov resurslari tozalandi.

**Qolgan ishlar:** serverdagi real sozlamalar va xizmat oynasi; kalitning alohida nusxasi; boshqa serverga shifrlangan arxiv ko‘chirish va qayta yuklab tiklash; jadval, monitoring va retention; real ilova versiyasi bilan tiklash mashqi. `.env`, TLS kaliti, global DB rollari/qo‘shimcha bazalar va Redis/Celery navbati avtomatik arxivga kirmaydi. MinIO uchun alohida adapter kerak. Shu sabab AUD-21 umumiy holati hali **QISMAN BAJARILDI**.

#### 2026-10-16 — 4-qadam: mavjud so‘rov limitlarini umumiy hisoblash

**Holat:** foydalanuvchi **“Ha, 4-qadamni bajar”** deb tasdiqladi. Lokal implementatsiya va tegishli tekshiruvlar **BAJARILDI**; serverga deploy qilinmadi. Quyidagi dalil o‘zgarishdan oldingi holatni ifodalaydi.

**Dalil:** `backend/config/settings.py`da default cache `LocMemCache`; production sozlamasi uni almashtirmaydi. `PublicReceiptRateThrottle` ochiq chek uchun `60/minute`, `MyTenantsView` yangi do‘kon uchun `5/day` cheklovini DRF cache orqali hisoblaydi. Bir necha Gunicorn jarayoni yoki instance bilan hisoblagichlar alohida qoladi. Support throttle va loginning o‘z Redis mexanizmi bor; ular bilan bir xil muammo deb ko‘rsatilmaydi.

**Taklif doirasi:** production default cacheni mavjud Redisga alohida prefiks bilan ulash; mavjud limitlarning qiymati va tegishli API xatti-harakatini saqlash; ikki alohida jarayondan bitta hisob ko‘rinishini ajratilgan Redisda tekshirish. Haqiqiy serverga deploy alohida. Bu keskin parallel so‘rovlar uchun atomar throttle yoki to‘liq DDoS himoyasi kafolati emas; bunday kengayish alohida baholanadi.

**Qabul mezoni:** productionda ochiq chek va do‘kon yaratish urinishlari workerlar orasida umumiy ko‘rinadi; kutilgan `429` tekshiriladi; support, login va development/test muhitining ajratilishi buzilmaydi. Ilova kodi foydalanuvchi roziligidan keyin o‘zgartiriladi.

**Bajarildi:** `backend/config/settings_production.py`da default cache explicit `REDIS_URL` orqali `RedisCache`ga o‘tkazildi; canonical domen asosidagi production prefiksi support va login kalitlarini ajratadi. Redis ulanish/o‘qish timeoutlari 2 soniya. Bo‘sh, boshqa protokolli yoki noto‘g‘ri portli URL startda rad etiladi; xato xabarida credential qiymati ko‘rsatilmaydi. Redis ishlamasa lokal hisoblagichga yashirin qaytilmaydi. Base/development/test cache sozlamalari va support aliasi o‘zgarmadi. Mavjud `60/minute` va `5/day` limit qiymatlari saqlandi.

**O‘zgargan qismlar:** production settings; `backend/.env.production.example` izohi; kengaytirilgan `apps/core/tests/test_production_settings.py`; yangi `apps/core/tests/test_shared_throttles.py`; README va test yo‘riqnomasi. Haqiqiy `.env`, ilova DBsi, savdo/fiskal oqimi, frontend va server konfiguratsiyasi ishga tushirish orqali o‘zgartirilmadi.

**Tekshiruv:** production sozlamasini yuklaydigan mustaqil Python jarayonlari yangi vaqtinchalik Redisga ulandi. Chekda 60 va ownerda 5 urinishdan keyin boshqa yangi jarayonda ham `429`, `throttled`, `Retry-After` tasdiqlandi. Boshqa IP/ownerga ruxsat, vaqt oynasi tugashi, limit to‘lgan ownerning GET ro‘yxati, default/support/login kalitlari mustaqilligi, development/test lokal cache’i va Redis uzilishida fallback yo‘qligi tekshirildi. Bu integration testlarda DB ulanishi taqiqlangan, biznes handler va membership stub qilingan; ularning haqiqiy oqimi normal API regressiyalarida tekshirildi. Production settings/shared cache, tenants, sales API/receipt tax, support va admin login testlari birga: **116 passed, 22.94 s**. Ruff format/check o‘tdi. 8 ta avvaldan mavjud Django email sozlamalari deprecation ogohlantirishi bor.

**Chegara:** bu DRFning mavjud, atomar bo‘lmagan throttle algoritmini almashtirmaydi; keskin parallel so‘rovlarda nominal limitdan ortish ehtimoli qoladi. [DRF rasmiy hujjati](https://www.django-rest-framework.org/api-guide/throttling/) bu farqni tushuntiradi. Redis mavjudligi productionning ishlash sharti; domen/prefix va Redis manzili barcha worker/replicalarda bir xil bo‘lishi kerak. Haqiqiy serverga ulash alohida kelishiladi.

#### 2026-10-16 — 5-qadam: ilova tayyorligini tekshirish

**Holat:** foydalanuvchi **“Ha, 5-qadamni bajar”** deb tasdiqladi. Uzilishdan keyin **“continue”** bilan davom ettirishni so‘radi. Lokal implementatsiya va tegishli tekshiruvlar **BAJARILDI**; serverga deploy qilinmadi. Quyidagi dalil o‘zgarishdan oldingi holatga tegishli.

**Dalil:** `docker-compose.prod.yml`da PostgreSQL va Redis healthcheck bor, backend ilovada healthcheck yo‘q. Worker/beat/bot/frontend faqat `depends_on: [ilbi]` bilan konteynerning boshlanishini kutadi; ilovaning haqiqatan tayyorligini kutmaydi. `backend/entrypoint.sh` Gunicorndan oldin dependency sync, migratsiya, bucket va static tayyorgarligini bajaradi. URLlar va core manbalarida ilova DB/Redis tayyorligini tekshiradigan endpoint topilmadi.

**Taklif doirasi:** tashqariga ichki tafsilot bermaydigan tayyorlik tekshiruvi; PostgreSQL va Redis bilan ishlay olishini tekshirish; production backend healthcheck va bog‘liq xizmatlarni dastlabki startda `service_healthy` orqali kutdirish. Private tekshiruvning public edge orqali ochilmasligi saqlanadi. Alohida PostgreSQL/Redis uzilishi va qayta tayyor bo‘lishi sun’iy muhitda tekshiriladi. Migratsiyani alohida release-jobga ko‘chirish, avtomatik restart, tashqi monitoring/xabar yuborish va serverga deploy bu taklifga kirmaydi.

**Qabul mezoni:** tayyor bo‘lsa muvaffaqiyat, DB/Redis ishlamasa tayyor emas holati; xato javobida sirlar va traceback yo‘q; production bog‘liq xizmatlari backend tayyorligini kutadi. Docker health holati nosozlikni ko‘rsatadi, o‘zi ishlayotgan xizmatlarni avtomatik to‘xtatish/restart qilish kafolati berilmaydi.

**Bajarildi:** `backend/apps/core/readiness.py` va `api/v1/urls.py` orqali `GET/HEAD /api/v1/internal/health/ready/` qo‘shildi. Faqat haqiqiy loopback socket peer qabul qilinadi; soxta proxy headeri bunga ta’sir qilmaydi. Alohida, har safar yopiladigan PostgreSQL ulanishida `SELECT 1`, Redisga timeout va retry’siz `PING` yuboriladi. Tayyorlikda `200 {"status":"ready"}`, bog‘liqlik ishlamasa `503 {"status":"not_ready"}`; xato tafsiloti, credential yoki traceback qaytarilmaydi va logga yozilmaydi. Javob cache qilinmaydi. Tekshiruv ma’lumot yozmaydi.

`backend/healthcheck.py` standart Python orqali lokal HTTP endpointni tekshiradi: proxy va redirect ishlatmaydi, kichik kutilgan JSONni tekshiradi, faqat `ready`/`not ready` va exit 0/1 chiqaradi. Production Compose’da backend healthcheck: 15 soniya interval, 10 soniya timeout, 120 soniya start grace va 3 retry. Worker, beat, bot va frontend dastlabki Compose startida backend `service_healthy` bo‘lishini kutadi. Mavjud public Nginx bloklari saqlandi; yangi route public sxemaga kiritilmaydi. README va test yo‘riqnomasi yangilandi.

**Tekshiruv:** yangi `apps/core/tests/test_readiness.py`dagi **11 test, 7.52 s** o‘tdi. Alohida production WSGI jarayoni faqat yangi sun’iy PostgreSQL/Redisga ulanib, har bir xizmatni navbat bilan to‘xtatish/qayta yoqishda `200 → 503 → 200` va HTTP probe natijasini tasdiqladi. DBda ilova jadvali va Redisda kalit yaratilmagani tekshirildi. Peer/soxta header rad etilishi, GET/HEAD, POSTni rad etish, yopiq error/log, no-store, noto‘g‘ri JSON/redirect/katta javob sinovdan o‘tdi. Kengaytirilgan haqiqiy Nginx/TLS/Compose tekshiruvida **9 test, 2.629 s** o‘tdi: public readiness URL va kodlangan prefiks ham yopiq; dependency shartlari to‘g‘ri. Production settingsning 27 testi ham o‘tdi. Ruff format/check, Django system check va OpenAPI `--validate --fail-on-warn` o‘tdi; schema’da readiness yo‘q.

**Chegara:** health faqat DB/Redis tayyorligini bildiradi; to‘liq savdo, fiskal provayder, SMTP va barcha release shartlari sinovi emas. Ishlayotgan xizmatlar keyingi nosozlikda avtomatik to‘xtatilmaydi/restart qilinmaydi, tashqi xabar yuborilmaydi. [Compose rasmiy startup tartibi](https://docs.docker.com/compose/how-tos/startup-order/) dastlabki startdagi kutish shartini tushuntiradi. Migratsiya release-jobi va production serverda faollashtirish keyin alohida kelishiladi. Haqiqiy DB/env/xizmatlarga tegilmadi; sinov resurslari tozalandi. AUD-21 umumiy holati hali **QISMAN BAJARILDI**.

#### 2026-10-16 — 6-qadam uchun taklif: production paketlarini buildda tayyorlash

**Holat:** foydalanuvchi **“Hozircha o‘zgartirma”** deb javob berdi. Taklif **KEYINGA QOLDIRILDI**; ushbu ish uchun Dockerfile, entrypoint, paketlar, lock va Compose o‘zgartirilmadi. Qayta boshlash uchun yangi aniq tasdiq kerak.

**Dalil:** `backend/Dockerfile`da `uv sync --frozen --no-install-project || uv sync --no-install-project` bor: birinchi buyruq xatosida lockni o‘zgartira oladigan fallbackga o‘tiladi. Oxirgi `uv sync --frozen` dev paketlarini ham qo‘shadi. `backend/entrypoint.sh` Gunicorn har boshlanganida `uv sync --frozen --no-dev`ni yana bajaradi; paket tekshirish/o‘rnatish release buildidan runtimega ko‘chgan. Production Compose shu backend image’dan uch xizmatda foydalanadi. Development esa kod va alohida `.venv` volumeni mount qiladi, uni ehtiyotsiz umumiy o‘zgartirish buzishi mumkin.

**Taklif doirasi:** backend uchun alohida production build target; lock mos kelmasa aniq xato, versiyani qayta yechadigan fallback yo‘q; runtime’da faqat zarur production paketlari; production startupda `uv sync`ni bajarmaslik. Production Compose backend/worker/beat shu targetni ishlatadi. Developmentning mounted venv oqimi saqlanadi. Migratsiya va media/static tayyorlashni ajratish, dependency versiyalarini keng yangilash, image digestlarini pin qilish va serverga deploy bu qadamga kirmaydi.

**Qabul mezoni:** production image buildida faqat lockdagi kerakli paketlar o‘rnatiladi; har startda paket o‘rnatilmaydi; Gunicorn, Celery va healthcheck image ichida ishlaydi; buzilgan lock yashirin fallbackga olib kelmaydi; development oqimi saqlanadi. Faqat foydalanuvchi roziligidan keyin kod o‘zgartiriladi.

#### 2026-10-16 — 7-qadam: productionda ommaviy texnik API hujjatlarini yopish

**Holat:** foydalanuvchi **“Ha, 7-qadamni bajar”** deb tasdiqladi. Lokal implementatsiya va tegishli tekshiruvlar **BAJARILDI**; serverga deploy qilinmadi. **Turi:** production siyosatini aniqlashtirish/yaxshilash. Quyidagi dalil o‘zgarishdan oldingi holatga tegishli.

**Dalil:** `backend/config/urls.py` `/api/schema/`, `/api/docs/`, `/api/redoc/`ni barcha muhitlarda ro‘yxatdan o‘tkazadi. `SPECTACULAR_SETTINGS` serve permissionni almashtirmaydi; o‘rnatilgan drf-spectacular’da `SERVE_PERMISSIONS` defaulti `AllowAny`, `SERVE_PUBLIC=True`. Production edge bu yo‘llarni backendga uzatadi. Shu konfiguratsiya productionda ham dasturchilar uchun API sxemasi va sinov oynalariga login qilmasdan kirish imkonini beradi. Bu safar haqiqiy serverga so‘rov yuborilmadi; xulosa joriy kod va o‘rnatilgan kutubxona sozlamalari bo‘yicha.

**Taklif doirasi:** productionda ushbu uch texnik URLni o‘chirish; development va CLI orqali OpenAPI yaratishni saqlash. Ilovaning foydalanuvchi qo‘llanmalari `/docs`, support va biznes APIlari o‘z faoliyatini davom ettiradi. API amallari mavjud ruxsat tekshiruvlariga tayanadi; taklif texnik hujjatning ommaviy ko‘rinishiga tegishli. Ommaviy API integratsiyasi rejalashtirilsa, hujjatni kim ko‘rishi alohida belgilanadi.

**Qabul mezoni:** productionda uch texnik URL `404`; development/test muhiti va CLI schema validatsiyasi ishlaydi; mahsulot qo‘llanmasi va asosiy API route’lari saqlanadi. Foydalanuvchi tasdig‘idan keyin kod va tegishli testlar yoziladi; serverga deploy alohida.

**Bajarildi:** base settingsda `API_DOCS_ENABLED=True`, production settingsda qat’iy `False` belgilandi. Root URL konfiguratsiyasi schema/Swagger/Redoc route’larini faqat shu belgi yoqilganda qo‘shadi. Productionda UI import/route registratsiyasi bajarilmaydi; drf-spectacular runtime annotatsiyalari va CLI generatori saqlanadi. Foydalanuvchi `/docs` qo‘llanmasi va `/api/v1/docs/`, support, readiness va biznes API route’lari saqlandi. 6-qadamdagi paket/Dockerfile/entrypoint ishlariga tegilmadi.

**O‘zgargan fayllar:** `backend/config/settings.py`, `settings_production.py`, `urls.py`; yangi `backend/apps/core/tests/test_api_docs_production.py`; README, test yo‘riqnomasi va audit.

**Tekshiruv:** productionda uchta asosiy texnik URL, slashsiz ko‘rinishlar va schema format querysi `404`; development/testda Swagger/Redoc `200` va schema route’i mavjud. Production sozlamasi bilan CLI OpenAPI yaratish, validatsiya va fail-on-warn o‘tdi. Yangi subprocess testlarida dotenv o‘qish, DB/Redis ulanishlari taqiqlangan; kalit faqat sun’iy. Mavjud schema/UI hamda mahsulot qo‘llanmasi rol/ruxsat regressiyalari ajratilgan test DBda tekshirildi. **38 passed, 1 deselected, 11.94 s**; 8 ta avvaldan mavjud Django email deprecation ogohlantirishi bor. Deselected — repodagi haqiqiy Markdownni vaqtincha o‘zgartiradigan eski `test_docs_edit_only_platform_admin`; ushbu qadam uning fayl izolatsiyasini o‘zgartirmaydi. Yangi/tegishli kod uchun Ruff, base settings uchun CI sintaksis/undefined-name tekshiruvi o‘tdi.

**Chegara:** production sozlamasi ishlatilganda route’lar yopiladi; bu serverga avtomatik deploy emas. Keyinchalik tashqi integratsiya hujjati kerak bo‘lsa alohida kirish siyosati belgilanadi. Export qilingan schema fayli HTTP route yoqmasdan operator tomonidan yaratilishi mumkin.

#### 2026-10-16 — 14-qadam: production Nginx so‘rov cheklovlari

**Qaror:** foydalanuvchi Nginxda login/kod va odatiy API uchun alohida cheklovlarni tayyorlash va lokal sinovni “maqullayman” deb tasdiqladi. **Holat: LOKAL BAJARILDI** — implementatsiya va yakuniy regressiya o‘tdi. Serverga faollashtirish, Cloudflare/DNS va WAF bu doiraga kirmaydi.

**Dalil:** development `nginx/nginx.conf`da limitlar bor, ammo production Compose `frontend/ilbi/Dockerfile` orqali alohida `frontend/ilbi/nginx.prod.conf`ni ishlatadi; unda `limit_req` yo‘q edi. Ilovaning login/OTP va shared Redis/DRF cheklovlari allaqachon mavjud, qayta yozilmadi.

**Implementatsiya:** normalizatsiya qilingan `$uri` bo‘yicha ikki guruh; faqat haqiqiy socket peerining `$binary_remote_addr` manzili bilan kalit. Login, OTP send/verify, password reset request/verify/confirm/resume/change-with-old va change-password — o‘rtacha `60r/m`, `burst=30`; qolgan `/api/` — `60r/s`, `burst=120`. `nodelay` qisqa burstni darhol o‘tkazadi, bu qat’iy kalendar daqiqasi oynasi emas. Ikki bucket alohida: auth to‘lishi savdo allowance’ini sarflamaydi. Refresh, profil va Telegram-link status general bucketda. Statik/SPA/media API hisoblagichidan ajratilgan; ichki `/api/v1/internal` avvalgidek yopiq.

**Javob:** edge ortiqcha so‘rovni Django chaqiruvidan oldin `429` bilan qaytaradi. UI taniydigan `error.code/message/details` JSON, `no-store`, auth uchun `Retry-After: 2`, API uchun `1` va barcha xavfsizlik headerlari bor. Shu IPdan davom etayotgan trafik yana kutishni talab qilishi mumkin. Ilovaning o‘z `429` JSON/retry qiymatlari almashtirilmaydi. Workerlar bitta shared-memory bucketni ko‘radi; alohida Nginx instance’lari uchun umumiy global limit emas.

**Fayllar:** production Nginx shabloni, mavjud HTTPS testining qayta ishlatiladigan sun’iy fixture’i, yangi `tests/deployment/test_nginx_rate_limits.py`, README, test yo‘riqnomasi va shu audit. Haqiqiy env/DB/media yoki ilova biznes kodi o‘zgartirilmadi. Dockerfile/dependency/entrypoint va 6-qadamga tegilmadi.

**Tekshiruv:** haqiqiy Nginx `nginx -t`, ikki worker va vaqtinchalik TLS/echo backend bilan yangi 9 rate-limit testi hamda oldingi 9 HTTPS/Compose testi birga **18/18, 15.451 s** o‘tdi. Login/OTP/reset/encoding/slash/query, soxta header, boshqa peer IP, auth/API ajratilishi, 80 so‘rovli ko‘p kassir burst va 500 so‘rovli sun’iy API flood, umumiy worker budgeti, kutgandan keyin tiklanish, backendga bormagan rejectionlar va upstream `429` tekshirildi. Ruxsat etilgan POST method/body va proxy headerlari saqlandi. Ruff check/format (`backend/pyproject.toml`) va Markdown tekshiruvi o‘tdi. Vaqtinchalik konteyner/tarmoq/sertifikatlar tozalangani tekshirildi. Bu POS biznes/yuklama testi emas; backend faqat fixture.

**Qolgan tashqi ish:** real NAT/ko‘p kassir yuklamasida limitni kuzatish va zarur bo‘lsa moslash; Cloudflare/WAF/DDoS ulash alohida. Oldiga proksi qo‘yilsa faqat ishonchli proksi tarmoqlaridan real IP tiklash hamda originni chetlab kirishni yopish kerak; hozir ixtiyoriy `CF-Connecting-IP`/`X-Forwarded-For` ishonilmaydi. Lokal cheklov internet miqyosidagi DDoSdan to‘liq himoya kafolati emas. [Nginx rasmiy algoritmi](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html).

#### 2026-10-16 — WAF va DDoS ulanishini keyinga qoldirish

**Foydalanuvchi javobi:** `ilbi.uz` hali sotib olinmagan, faqat bron qilingan; Cloudflarega qo‘shilmagan, production server ham tayyor emas. Shu sabab tashqi ulanish hozircha to‘xtatiladi, loyihaning lokal tayyorgarligi davom etadi.

| So‘ralgan himoya | Hozirgi holat |
|---|---|
| Rate limiting | Ilova/Redis va production Nginx kodi tayyor; 18 edge testi o‘tgan. Production serverda hali ishga tushirilmagan. |
| WAF | Cloudflare akkaunt/domen ulanishi va qoidalar hali sozlanmagan; foydalanuvchi bilan keyinga qoldirildi. |
| DDoS | Cloudflare orqali trafikni himoyalash hali faollashtirilmagan; domen/server tayyor bo‘lganda qaytiladi. |

**Qaytilganda bajariladigan ish:** domenni Cloudflarega qo‘shish va web DNS yozuvini proksi orqali o‘tkazish; origin TLS sertifikatini tayyorlash va `Full (strict)`ni ishlatish; tanlangan tarifdagi WAF qoidalarini API/login/support bilan sinash; faqat ishonchli Cloudflare tarmoqlaridan real IP tiklash va originga to‘g‘ridan-to‘g‘ri kirishni yopish. Shundan keyin haqiqiy domenda WAF, IP hisoblanishi va origin chegarasi tekshiriladi. DNS/parol/token/serverga ushbu sessiyada o‘zgartirish qilinmadi.

Cloudflare DDoS himoyasi barcha tariflarda mavjud; bepul WAFda Free Managed Ruleset, kengroq qoidalar tarifga bog‘liq. Bu mavjudlik bizning domenimizda yoqilganini anglatmaydi. Rasmiy manbalar: [WAF imkoniyatlari](https://developers.cloudflare.com/waf/), [DDoS](https://developers.cloudflare.com/ddos-protection/), [originni himoyalash](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/).

### AUD-22 — Hujjat versiyalari va rozilik dalili

**3/5 · P2 · Kodda aniq va ochiq reja.**

**Dalil:** `backend/api/v1/accounts/views/docs_views.py:164,193`; `terms_views.py:24`; `backend/apps/accounts/models/user_model.py`.

Admin PUT amaldagi Markdownni ustidan yozadi; eski versiya saqlanmaydi. Userda bitta `terms_accepted` flag va vaqt/IP bor: qaysi hujjat, matn hash/versiya, til yoki rozilik turi qabul qilingani qayd etilmaydi. Matn o‘zgarganda qayta qabul mexanizmi yo‘q. Frontend acceptance gate bor, biznes APIlarda shu rozilik siyosati markaziy tekshirilmaydi.

**Taklif:** avval kelishilgan hujjat/rozilik versiyalarini va acceptance qaydini joriy qilish; fayl yozishni atomar va auditli qilish.

**Bajarildi mezoni:** eski hujjat va uning qabul dalili o‘qiladi; yangi majburiy versiya tegishli qayta qabulni ishga tushiradi; xizmat sharti va ixtiyoriy rozilik ajratilgan. Bog‘liq: T8.5/UZ-21.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-23 — Auditning to‘liqligi, tenant va IP aniqligi

**3/5 · P2 · Kodda aniq.**

**Dalil:** `backend/apps/core/services/audit_service.py:12,50,58`; `backend/api/v1/accounts/views/terms_views.py:12`; `backend/api/v1/catalog/views/product_views.py:141,242`; `backend/apps/sales/services/debt_service.py`.

Auditda kontekst bo‘lmasa egasining birinchi membershipi tanlanadi: ko‘p do‘konli egada hodisa noto‘g‘ri tenantga yozilishi mumkin. `X-Forwarded-For`ning chapdagi birinchi qiymati ishonchli proxy/format tekshiruvisiz olinadi; Nginx mavjud headerni qo‘shib yuboradi. Ayrim profil xatolari auditda jim yutiladi. Product PATCH orqali narx o‘zgartirish variant PATCHdagi price auditini chetlab o‘tadi; qarz to‘lovi uchun alohida action audit yo‘q.

**Taklif:** aniq tenant/global audit konteksti, ishonchli proxy qoidasi, IP validatsiyasi va bir amal uchun barcha API yo‘llarida bir xil audit.

**Bajarildi mezoni:** narx/to‘lov/auth o‘zgarishlari auditda to‘liq; soxta yoki noto‘g‘ri IP auditni 500ga olib kelmaydi; ko‘p tenantli egada hodisa to‘g‘ri joyga yoziladi. Bog‘liq: T7.7 va audit talablari.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-24 — Xodimni ishga olish va akkauntni faollashtirish

**3/5 · P1 · Kodda aniq.**

**Dalil:** `backend/api/v1/accounts/views/employee_views.py:27,40`; `backend/api/v1/accounts/serializers.py:118`; `frontend/ilbi/src/pages/Employees.jsx:24,70`.

Hire serializer emailni qabul qiladi, view uni `EmployeeService.hire()`ga uzatmaydi. Frontend email/permission tanlashni yubormaydi, yuborilgan first_name/last_name backend hire serializerida yo‘q. Yangi xodim uchun parol o‘rnatish xati va ishlash vakolatlari oqimi to‘liq emas. UI xodimlar ro‘yxatini ham maxsus endpointdan yuklamaydi; tenant list/current state bilan cheklangan. AUD-08dagi `tenant_id || 1` bunga qo‘shimcha xato.

**Taklif:** email, foydalaniladigan profil maydonlari, ruxsatlar, xodimlar ro‘yxati va birinchi parol o‘rnatishni bitta ishga olish jarayoni sifatida ulash.

**Bajarildi mezoni:** UI orqali yangi xodimni yaratish→email/taklif→parol→OTP→ruxsatli biznes amali ketma-ketligi ishlaydi; owner/admin o‘z vakolatida qoladi. Bog‘liq: T2.4/T3.2/T7.4.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-25 — Katta frontend sahifalarini qismlarga ajratish

**3/5 · P3 · Yaxshilash.**

**Dalil:** `frontend/ilbi/src/pages/Sales.jsx` — 3406 qator; Catalog — 2188; POS — 1770; Inventory — 1762; Services — 1584; Dashboard — 1505; `src/App.jsx:10`.

Sahifalar ma’lumot yuklash, biznes hisoblari, modal, hujjat chop etish va katta inline stillarni bir faylda ushlab turadi. App barcha sahifalarni boshlanishida import qiladi. Bu tenant/ruxsat o‘zgarishlarini izchil qo‘llash va xatoni ajratishni qiyinlashtiradi; barcha sahifa kodi birinchi yuklashga kiradi.

**Taklif:** muhokamadan keyin foydalanish holatlari bo‘yicha kichik komponent/hooklarga ajratish, umumiy formatter va route uchun lazy import. Dizaynni alohida topshiriqsiz o‘zgartirmaslik.

**Bajarildi mezoni:** tegishli funksional oqimlar saqlanadi; sahifalar mustaqil yuklanadi; murakkab state/tenant oqimlari alohida tekshiriladigan bo‘ladi. Bog‘liq: frontend texnik qarzi.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-26 — CI va regressiya tekshiruvlarini kuchaytirish

**2/5 · P1 · Kodda aniq.**

**Dalil:** `.github/workflows/ci.yml:24,25`; `backend/config/settings_test.py:37,39`; `backend/config/settings.py:33`; `backend/.gitignore`; test modullari va frontend package.json.

CI pytest envda `DJANGO_SECRET_KEY` yo‘q. Test settings asosiy settingsni import qilgandan keyin test secretni belgilaydi; asosiy settings esa avval secret yo‘qligidan exception ko‘taradi. `.env.test` repoda yo‘q/ignore qilingan; toza CI clone shu tartibda boshlanmaydi. Ruff `--exit-zero` bilan haqiqiy lint gate emas. Parallel stock/sale/shift/OTP tekshiruvlari manbalarda topilmadi, frontendda test scripti yo‘q. Oldingi testlar ayrim eski void xatti-harakatlarini hali tasdiqlaydi.

**Taklif:** test konfiguratsiyasini lokal .envga bog‘lamaslik; avval kelishilgan touched-file lint qoidasi yoki bosqichli gate; pul/vakolat/tenant bo‘yicha mazmunli regressiya va parallel testlar.

**Bajarildi mezoni:** lokal secretsiz toza clone CI ishlaydi; xavfli oqimlarga mos testlar bor; auditdagi eski xatti-harakatlar yangi talabga qarshi tekshiriladi. Testlarni ushbu auditda ishga tushirishga urinish bo‘lmadi. Bog‘liq: T0.2/T4.12.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

#### 2026-10-16 — 9-qadam: hujjat tahrirlash testini asl fayldan ajratish

**Holat:** foydalanuvchi **“Ha, 9-qadamni bajar”** deb tasdiqladi. Ushbu lokal tuzatish va tegishli tekshiruvlar **BAJARILDI**. Quyidagi dalil tuzatishdan oldingi holatga tegishli; AUD-26ning umumiy CI/test doirasi hali qisman ochiq.

**Dalil:** `apps/accounts/tests/test_terms_and_docs_views.py::test_docs_edit_only_platform_admin` haqiqiy `/api/v1/docs/`ga PUT yuborib, staff qo‘llanmasiga `updated_test_tag` qo‘shadi va faqat oxirgi qatorda qaytaradi. `docs_views._get_docs_root()` hostda repodagi `docs/`ni tanlaydi. Django test DB transactioni diskdagi Markdownni rollback qilmaydi. O‘rtadagi assertion yoki jarayon to‘xtashi asl qo‘llanmani test matni bilan qoldirishi mumkin. Shu sabab 7-qadamning o‘qish regressiyasida bu test alohida tashlangan edi.

**Taklif doirasi:** hujjat testlarini vaqtinchalik katalogdagi nusxa/sun’iy hujjatlar bilan ishlatish; faqat test ichida docs rootni almashtirish; staff/owner rad etilishi, admin tahriri va keyingi GET natijasi kabi mavjud ruxsat sinovlarini saqlash. Product runtime, real qo‘llanmalar, API huquqlari va serverda deploy o‘zgartirilmaydi.

**Qabul mezoni:** tahrirlash testi yana to‘liq ishga tushadi; diskka yozish faqat vaqtinchalik test katalogida bo‘ladi; repodagi asl hujjatlar hashlari testdan oldin/keyin bir xil qoladi; test jarayonidagi xato asl faylni tiklashga bog‘liq bo‘lmaydi. Amalga oshirish alohida foydalanuvchi tasdig‘idan keyin.

**Bajarildi:** `apps/accounts/tests/test_terms_and_docs_views.py`ga har test uchun `tmp_path/docs`da sun’iy hujjatlar yaratadigan fixture qo‘shildi. `monkeypatch` faqat shu testda `docs_views._get_docs_root`ni vaqtinchalik rootga yo‘naltiradi, keyin asl funksiyani qaytaradi. Tahrirlash testining yakuniy “asl faylni qaytarish” PUT amali olib tashlandi; GET/PUT haqiqiy view orqali bajariladi, yangi matn API javobida va vaqtinchalik disk faylida tekshiriladi. Staff/owner `403` va admin tahriri saqlandi. Ilova runtime fayllari va haqiqiy qo‘llanmalar o‘zgartirilmadi.

**Tekshiruv:** hujjat/rozilik moduli to‘liq, texnik schema/UI moduli va boshqa moduldagi ommaviy qo‘llanma/rasmlar testi birga **9 passed, 40.21 s**. Tahrirlash testi tashlanmadi. Testdan oldin va keyin repodagi **20 ta Markdown faylning SHA-256** qiymatlari bir xil chiqdi. Boshqa moduldagi haqiqiy ommaviy qo‘llanma/rasm o‘qilishi fixture override’i tarqalmaganini ham tekshirdi. Ruff format/check o‘tdi. Faqat ajratilgan test DB/Redis ishlatildi; 8 ta avvaldan mavjud Django email deprecation ogohlantirishi bor.

**O‘zgargan qismlar:** mavjud test moduli, `backend/README_TESTS.md` va ushbu audit. Yangi test funksiyasi qo‘shilmadi; mavjud sinov izolyatsiyasi tuzatildi. Serverga o‘rnatish yoki product runtime o‘zgarishi talab qilinmadi. Pytestning vaqtinchalik fayllari faqat sun’iy test matnini saqlaydi; asl hujjatni tiklashga tayanilmaydi.

### AUD-27 — Avatar tekshiruvi va faylni xavfsiz almashtirish

**2/5 · P0 · Validatsiya bo‘shlig‘i kodda aniq; brauzer ta’siri deployga bog‘liq.**

**Dalil:** `backend/api/v1/accounts/views/profile_views.py:68`; `backend/config/urls.py`dagi media serve; `nginx/nginx.conf`dagi `/media/`.

Upload to‘g‘ridan-to‘g‘ri `request.FILES['avatar']`ni modelga yozadi; serializer ImageField, fayl formati yoki hajm tekshiruvi yo‘q. Modelning ImageField nomi `save()` vaqtida fayl haqiqiy rasm ekanini tekshirmaydi. HTML/SVG kabi faol kontent media yo‘lida saqlanishi mumkin; u ilova originida ochilsa brauzerda script ishlash va storagega kirish xavfi bor. Eski avatar yangi fayl muvaffaqiyatli saqlanishidan oldin o‘chiriladi.

**Taklif:** tekshirilgan raster format, hajm/dimension limiti va xavfsiz qayta kodlash; yangi fayl saqlangach eskisini o‘chirish; media xizmatini faol kontentdan himoyalash.

**Bajarildi mezoni:** HTML/SVG/rasm bo‘lmagan va katta fayl rad etiladi; muvaffaqiyatsiz uploadda eski avatar saqlanadi. Bog‘liq: T9.7/image hardening.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

#### 2026-10-16 — 10-qadam uchun taklif: avatar xatosida eski faylni yo‘qotmaslik

**Holat:** foydalanuvchi **“Ha, 10-qadamni bajar”** deb tasdiqladi. Ushbu lokal tuzatish va tegishli tekshiruvlar **BAJARILDI**; serverga deploy qilinmadi. Quyidagi dalil tuzatishdan oldingi holatga tegishli. **Turi:** storage/DB xatosiga bog‘liq ma’lumot yo‘qotish xavfi.

**Amaldagi holat qayta tekshirildi:** yuqoridagi dastlabki “ImageField/formati tekshirilmaydi” qaydi hozirgi kodga mos emas: POST `AvatarUploadInputSerializer` va `optimize_image`dan foydalanadi; mavjud regression HTMLni rad etish va rasmni qayta kodlashni tekshiradi. Qolgan aniq muammo — fayl/DB o‘zgarishlari tartibi. Jadvaldagi joriy xavf shu qolgan masala uchun P1 qilib aniqlashtirildi; dastlabki P0 dalili tarixiy holatdir.

**Dalil:** `UserAvatarUploadView.post()` tekshirilgan yangi rasmni userga saqlashdan oldin `user.avatar.delete(save=False)` qiladi. Keyingi storage yoki `user.save(update_fields=["avatar"])` xatosida DB eski nomni saqlashi, eski fayl esa allaqachon yo‘qolgan bo‘lishi mumkin. DELETE ham faylni avval o‘chirib, DBdagi `avatar=None`ni keyin saqlaydi. Bu safar haqiqiy user rasmi, storage yoki serverda sinov qilinmadi; dalil joriy kod tartibidir.

**Taklif doirasi:** almashtirish/o‘chirishda DB va fayl holatini muvofiqlashtirish; DB tasdiqlangandan keyin eski faylni o‘chirish; muvaffaqiyatsiz yangi saqlashda eski fayl va DB nomini saqlash, yangi vaqtinchalik/orphan faylni imkon qadar tozalash; bir userdagi parallel o‘zgarishlarni muvofiqlashtirish. Mavjud rasm tekshiruvi va o‘lcham/format oqimi saqlanadi. Product/rasm uploadlarining boshqa modullari va real MinIOga ulanish bu kichik qadamga kirmaydi.

**Qabul mezoni:** yangi storage yoki DB yozuvi xatosida eski avatar saqlanadi; muvaffaqiyatda yangi rasm ko‘rinadi va eski fayl faqat commitdan keyin tozalanadi; DELETE xatosi ham mavjud rasmni yo‘qotmaydi. Sinovlar faqat sun’iy user, alohida test DB va vaqtinchalik/fake storage’da; haqiqiy serverga deploy alohida. Fayl storage va DB uchun umumiy atomar transaction kafolati berilmaydi; commitdan keyingi cleanup xatosi alohida boshqariladi.

**Bajarildi:** `apps/accounts/services/avatar_service.py::set_user_avatar` bir userning avatarini transaction va `select_for_update()` bilan yangilaydi. Eski nom autentifikatsiyada yuklangan instance’dan emas, lock ostida qayta o‘qilgan DB yozuvidan olinadi. Yangi WEBP UUID nom bilan saqlanadi; hatto overwrite storage’da ham eski fayl nomi qayta ishlatilmaydi. DB yozuvi tasdiqlangach `on_commit()` eski faylni faqat boshqa userga ham bog‘lanmagan bo‘lsa o‘chiradi. DELETE avval DB yozuvini tozalaydi, keyin shu callbackdan foydalanadi. Saqlash/commit xatosida yangi fayl imkon qadar tozalanadi; commit javobi noaniq bo‘lsa DBdagi joriy bog‘lanish tekshirilib, ishlatilayotgan yangi fayl o‘chirilmaydi. Cleanup xatosi saqlangan o‘zgarishni `500`ga aylantirmaydi; tafsilotsiz warning yoziladi.

**O‘zgargan qismlar:** yangi avatar service, `api/v1/accounts/views/profile_views.py`dagi avatar POST/DELETE, yangi `apps/accounts/tests/test_avatar_storage.py`, test yo‘riqnomasi va ushbu audit. Mavjud serializer, autentifikatsiya, image validatsiyasi va `optimize_image(..., max_dimension=640)` saqlandi. Model/migratsiya va boshqa upload oqimlari o‘zgarmadi.

**Tekshiruv:** yangi **19 ta test** haqiqiy commit/rollback, storage’ning yozishdan oldin/keyin xatosi, DB yozuvi va commit xatosi, commit bajarilib javob yo‘qolishi, cleanup xatosi, umumiy eski fayl, stale user va ikki alohida PostgreSQL ulanishidagi POST/POST hamda POST/DELETEni qopladi. Birinchi to‘plam **19 passed, 4.02 s**; profil/JWT/parol almashtirish hamda mavjud HTML/WEBP regressiyasi bilan **63 passed, 4.16 s**. Faqat 5433-portdagi ajratilgan test DB va vaqtinchalik lokal storage ishlatildi; test konfiguratsiyasi Redisni ham 6380-port bilan chekladi. Yangi fayllarning Ruff check/format tekshiruvi va Django system check o‘tdi. Profil viewdagi avvaldan mavjud parol-audit `except: pass` uchun `S110` shu qadamdan tashqarida qoldi; boshqa lint tekshiruvlari o‘tdi. 8 ta avvaldan mavjud Django email deprecation ogohlantirishi bor.

**Chegara:** DB va storage o‘rtasida umumiy transaction yo‘q. Storage o‘chirish ishlamasa, DB tekshirilmasa, jarayon uzilsa yoki kelajakdagi tashqi transaction keyin rollback qilinsa, ortiqcha yangi/eski fayl qolishi mumkin. Avtomatik orphan sweep/retry yoki real MinIO uzilish testi qo‘shilmadi. Tozalashda saqlanayotgan rasmni yo‘qotmaslik ustun qo‘yildi; logda manual cleanup kerakligi ko‘rinadi. Haqiqiy foydalanuvchi/rasm/MinIO va serverga tegilmadi. AUD-27ning kengroq media xizmatini himoyalash doirasi alohida ochiq.

### AUD-28 — Saqlanadigan state hookidagi render sikli

**2/5 · P0 · Koddan kelib chiqadigan xato.**

**Dalil:** `frontend/ilbi/src/hooks/usePersistedState.js:10,27,47`; `frontend/ilbi/src/pages/POS.jsx:54`.

Hook o‘qish effectida `defaultValue`ga bog‘langan; POS unga har renderda yangi `[]` beradi. Effect har safar yana ishlaydi va yangi array/JSON natijasini statega yozadi, keyingi renderni chaqiradi. Bu takroriy render va storage o‘qish/yozish sikliga olib keladi, savat tahririni ham qayta o‘qilgan qiymat bosishi mumkin. Tenant almashishida yangi kalitga eski state yozilishi uchun effect tartibi ham tekshirilishi kerak.

**Taklif:** default qiymatni barqaror saqlash; storage o‘qishini faqat kalit almashishiga bog‘lash; yangi kalit holati to‘liq yuklangach yozish.

**Bajarildi mezoni:** POS ochilganda render sikli yo‘q; savat qo‘shish/o‘chirish saqlanadi; route/refresh/tenant almashish boshqa tenant qoralamasini bosmaydi. Bog‘liq: T2.6.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-29 — Tashqi ta’sirlarni transactiondan keyin bajarish

**2/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/cashbox/services/cashbox_service.py:291`; `backend/apps/sales/services/debt_service.py:108`; `backend/apps/tenants/services.py:172`.

Telegram, Celery `.delay()` va SMTP dispatch DB transactioni tugamasdan chaqiriladi. Keyingi xatoda DB rollback bo‘lsa ham xabar/xat allaqachon ketgan bo‘lishi mumkin. Telegram kutish payti pul/stock locklari ushlab turiladi. Celeryga berilgan vazifa commitdan oldingi ma’lumotni o‘qishi mumkin.

**Taklif:** `transaction.on_commit()` yoki muhim yetkazishlar uchun kelishilgan outbox; tasklarga ID berish.

**Bajarildi mezoni:** rollback holatida tashqi xabar ketmaydi; commitdan keyin yuboriladi; tarmoq sekinligi pul locklarini ushlab turmaydi. Bog‘liq: reja §4.3.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-30 — Davriy hisobot va Telegram retry

**2/5 · P2 · Kodda aniq.**

**Dalil:** `backend/apps/cashbox/tasks.py:129`; `backend/apps/inventory/tasks.py`; `backend/apps/sales/tasks.py:22,30`; `backend/config/settings.py:140`.

Daily report 5 daqiqada tekshiriladi, `abs(minute-report_minute)<=5` bir hisobotni bir necha marta yuboradi; daily uchun yuborilgan-sana himoyasi yo‘q. Soat chegarasi va downtime uchun catch-up yo‘q. TIME_ZONE UTC bo‘lgani uchun interfeysdagi mahalliy vaqt bilan farq qiladi. Telegram sender xatoni `False`ga aylantiradi; taskdagi `autoretry_for=(Exception,)` ishga tushmaydi. Low-stockdagi sana checki taskni enqueue qilish bilan atomar emas.

**Taklif:** mahalliy reja va bir davrga bitta dispatch; atomar belgilash; retry qilinadigan xatoni task darajasida aniq ajratish.

**Bajarildi mezoni:** bitta rejalashtirilgan hisobot bir marta yuboriladi; vaqt chegarasi/downtime kelishilgancha ishlaydi; vaqtinchalik Telegram xatosi haqiqatan qayta urinadi. Bog‘liq: T5.1/T5.4.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-31 — JWT bekor qilish va frontend sessiya tiklanishi

**2/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/accounts/authentication.py:17`; `backend/config/settings.py`dagi SIMPLE_JWT; `backend/api/v1/accounts/urls.py:20`; `frontend/ilbi/src/context/AuthContext.jsx:8,35`; `src/api/client.js`dagi refresh.

`token_version` claimi yo‘q token revocation tekshiruvidan o‘tib ketadi; mos kelmasligi faqat claim mavjud bo‘lsa tekshiriladi. Refresh standart view orqali, rotation/blacklist sozlamalari yo‘q. Frontend sahifa qayta ochilganda access muddati tugagan bo‘lsa, hali valid refresh token borligiga qaramay barcha tokenni o‘chiradi. Revoked access uchun refresh yangi, lekin eski versionli access chiqarsa, qayta so‘rov 401 bo‘lishi va auth state to‘liq yangilanmasligi mumkin.

**Taklif:** majburiy version claim, refresh/revocation siyosati va startupda sessiyani tiklashni muvofiqlashtirish.

**Bajarildi mezoni:** versionsiz/revoked token rad etiladi; valid refresh bilan page reload sessiyani tiklaydi; revoked sessiya foydalanuvchiga aniq chiqishni beradi. Bog‘liq: T7.5/T7.9.

**Muhokama/qaror — 2026-10-16:** foydalanuvchi 8-qadamning token version tekshiruvini tasdiqladi. Ushbu qismi bajarildi; qolgan sessiya siyosati alohida baholanadi. Pastdagi dastlabki dalillar va eski kod qaydlari tarixiy holatni ifodalaydi.

#### 2026-10-16 — 8-qadam: token xavfsizlik versiyasini majburiy tekshirish

**Holat:** foydalanuvchi **“Ha, 8-qadamni bajar”** deb tasdiqladi. Lokal implementatsiya va tegishli tekshiruvlar **BAJARILDI**; serverga deploy qilinmadi. Quyidagi tahlil/dalil tuzatishdan oldingi holatga tegishli.

**Amaldagi kod qayta tekshirildi:** `issue_tokens()` access va refreshga `token_version` yozadi; hozirgi refresh endpoint `RevocableTokenRefreshView` bo‘lib, faol user va version mosligini tekshiradi. Dastlabki auditdagi “refresh standart view” qaydi endi amaldagi holatni ifodalamaydi. Access autentifikatsiyasida esa `if token_version is not None and ...` saqlangan: claim yo‘q yoki null bo‘lsa version tekshiruvi bajarilmaydi.

**Dalil:** haqiqiy imzo tekshiruvidan o‘tadigan, faqat sun’iy SECRET_KEY bilan yaratilgan access tokenlar va DB o‘rniga berilgan sun’iy user bilan qayta tekshirildi. User versioni 1 dan 2 ga oshirilgach, claimi yo‘q token `accepted`, version=1 token `rejected` bo‘ldi. Haqiqiy DB, user yoki token ishlatilmadi. Ushbu holat haqiqiy imzolangan, eski formatdagi tokenlarga tegishli. Hozirgi login orqali beriladigan versionli tokenlarda mavjud bekor qilish ishlaydi.

**Taklif doirasi:** access va refresh uchun version claimi mavjud, to‘g‘ri butun son va userning joriy versioniga teng bo‘lishini bir xil tekshirish. Yo‘q, null, noto‘g‘ri tur yoki eski version rad etiladi; odatdagi yangi tokenlar ishlaydi. Bunday eski sessiyada qaytadan login talab qilinadi. Logout siyosati, refresh rotation/blacklist, frontend sessiya tiklashini keng o‘zgartirish, real user versiyalarini ommaviy oshirish va serverga deploy bu qadamga kirmaydi.

**Qabul mezoni:** parol/token_version o‘zgarishidan keyin eski va versionsiz access/refresh rad etiladi, joriy versionli tokenlar ishlaydi; malformed claimlar rad etiladi; haqiqiy API oqimi faqat ajratilgan test DBda tekshiriladi. Bu bajarilsa ham AUD-31ning qolgan sessiya siyosati masalalari alohida qayta baholanadi.

**Bajarildi:** yangi `apps/accounts/token_validation.py::has_current_token_version` access autentifikatsiyasi va refresh serializerida bir xil qoida sifatida ishlatiladi. `type(version) is int` va userdagi joriy version bilan tenglik talab qilinadi. Yo‘q/null, boolean, float, string, list/object va mos kelmagan versionlar rad etiladi; JSON boolean/floatning Python integerga teng chiqishi endi tekshiruvni chetlab o‘tmaydi. Model ruxsat bergan joriy integer `0` ham saqlandi. Faol user, imzo va muddat tekshiruvlari mavjud SimpleJWT oqimida qoladi.

**O‘zgargan fayllar:** yangi `apps/accounts/token_validation.py`; `apps/accounts/authentication.py`; `api/v1/accounts/views/token_refresh.py`; yangi `apps/accounts/tests/test_token_version_validation.py`; README, test yo‘riqnomasi va audit. Real user versionlari oshirilmadi, model/migratsiya, logout/rotation yoki frontend o‘zgartirilmadi.

**Tekshiruv:** yangi **30 ta API testi** haqiqiy test imzosi bilan malformed/missing/mismatched access/refreshni, joriy 0/1/5 versionlarni, inactive/deleted userni, haqiqiy parol almashtirish va yangi token bilan qayta ishlashni qopladi. Birinchi JWT to‘plami 35/35 o‘tdi. Login, OTP, parol tiklash/profil, employee management, ban/unban, demo va revoked-refresh regressiyasi bilan birga **136 passed, 8.57 s**. Faqat ajratilgan test PostgreSQL/Redis va sun’iy kalit/user/token ishlatildi. Ruff format/check o‘tdi. 8 ta avvaldan mavjud Django email deprecation ogohlantirishi bor.

**Chegara:** serverda ushbu kod ishga tushirilgach, versionsiz/noto‘g‘ri formatli eski sessiyalarda qayta login talab qilinadi. Odatdagi joriy versionli tokenlar ishlaydi. Amaldagi frontendda startup refresh yo‘li allaqachon mavjudligi qayta o‘qishda ko‘rindi; dastlabki auditdagi frontend haqidagi barcha da’volar hozirgi kodga avtomatik ko‘chirilmaydi. Unga dinamik browser tekshiruvi bu qadamda bajarilmadi. AUD-31 umumiy sessiya/rotation/logout siyosati doirasi hali alohida baholashni talab qiladi.

#### 2026-10-16 — 16-qadam: login/chat maxfiyligi va hisobga bog‘langan qoralamalar

**Ruxsat:** foydalanuvchi login oynasidagi eski chatlar va kattalashtirish orqali ichki interfeysga o‘tishni tekshirish/tuzatishni so‘radi. Keyin `/login`da yangi kirish talab qilishni hamda savat, tugallanmagan to‘lov, mahsulot va kirim qoralamalarini shu brauzerda hisob + do‘kon bo‘yicha saqlashni aniq ma’qulladi. Taqdimot sahifasining kirish havolasiga tegilmasligi alohida aytildi.

**Takrorlangan xatolar:** (1) eski token va profil saqlanganda login sahifasi bilan autentifikatsiyalangan chat bir vaqtda ishlashi; (2) logoutdan so‘ng oldingi chat holati, ayniqsa brauzerda mehmon suhbati ham bo‘lsa, ekranda qolishi; (3) profilni serverda tekshirish uzilganda cached rol bilan ichki layout ochilishi. Maxsus Chrome testi tuzatishdan oldin 2- va 3-holatda yiqildi. Backendda parol-only login ticket bilan xususiy APIga kirish tasdiqlanmadi: yangi uch rol testi profil, shaxsiy/operator chat, global hisoblar va katalogda `401`ni tekshiradi.

**Tuzatildi:** login yo‘li oldingi brauzer autentifikatsiyasini tugatadi; odatiy hisob parol/OTP oqimidan o‘tadi. Saqlangan boshqa sahifa sessiyasi server profili tasdiqlanmaguncha shaxsiy interfeysni ochmaydi; tarmoq xatosida qayta tekshirish oynasi bor. Chat, toast va tasdiqlash oynalari sessiyalar orasida eski holatni olib o‘tmaydi. Kechikkan API/refresh javoblari, hatto o‘sha hisobga qayta kirilsa ham, eski sessiyani tiklamaydi yoki yangi sessiyani tugatmaydi. Boshqa tabdagi logout hisobga olinadi. Login yordami yangi mehmon kalitidan foydalanadi; kattalashtirish shu mehmon chatida qoladi. Eski mehmon va shaxsiy yozishmalar login oynasiga olinmaydi. Chatdagi yuborish/yuklash xatolari ko‘rinadi, polling xatosida backoff ishlaydi. Local demo istisnosi avvalgi ikki flag/group siyosatiga muvofiq; productionda u yopiq.

**Qoralamalar:** POS savati, narx turi, to‘lov usuli/summalari/mijoz tanlovi; yangi mahsulot/kategoriya, mahsulot rasmi; yig‘ma kirim, inventarizatsiya, mijoz/yetkazib beruvchi qaytarishi va hisobdan chiqarish maydonlari hisob/do‘konga ajratildi. Matn o‘zgarish hodisasidayoq saqlanadi; rasm IndexedDBga yoziladi. Do‘kon almashtirishdagi savatni noto‘g‘ri tozalash olib tashlandi. Qayta kirish savdo/to‘lovni avtomatik yubormaydi; muvaffaqiyatli saqlash yoki foydalanuvchi tanlagan tozalash qoralamani bo‘shatadi. Oldingi recovery nusxasi qayta tirilmasligi uchun bo‘sh marker saqlanadi.

**Eski ma’lumot va chegara:** avvalgi token subyekti bilan mos cached profil/do‘konlar mavjud bo‘lsa legacy qoralama faqat shu hisobga ko‘chiriladi; manba saqlanadi. Egasi noma’lum nusxa o‘chirilmaydi, keyingi hisobga berilmaydi. Bu brauzerdagi UI izolatsiyasi; localStorage/IndexedDB shifrlangan zaxira emas, qurilma/brauzer xotirasiga to‘g‘ridan-to‘g‘ri kirishni himoyalash yoki boshqa qurilmaga sinxronlash deb talqin qilinmaydi. Site data tozalansa qoralama yo‘qoladi, quota/storage xatosi UI orqali bildiriladi. Barcha boshqa mahsulot shakllariga saqlash avtomatik qo‘shilgani da’vo qilinmaydi.

**Tekshiruv:** mavjud backend to‘plami `802 passed, 1 slow deselected`, slow test alohida tegishli regressiyada o‘tdi; yangi 3 rol testi ham o‘tdi — jami 806 backend holati bajarildi, alohida buyruqlarda. Frontend unit testlari **56/56**. `npm run test:auth-session` haqiqiy App/Login/Support/POS/Catalog bilan sun’iy API javoblarida logout, offline retry, yangi OTP, shaxsiy chatdan ajralish, savat/to‘lov/mahsulot/rasmni tiklash va do‘kon almashtirishni tekshiradi. Kamera, fiscal katalog, chek sozlamalari, yorliqlar, platforma admini va landing browser to‘plamlari o‘tdi. Landingning vizual/interaktiv holatlari yangi vaqtinchalik buildda o‘tdi. Eski test login ochilganda token saqlanishini talab qilardi; foydalanuvchi tasdiqlagan yangi tartibga mos ravishda token tozalanishini tekshiradigan qilindi. Yangi builddagi login CTA, saqlangan sessiya va shartlar chegarasi alohida qayta tekshirildi; eski dist natijasi joriy kod dalili sifatida olinmadi. Frontend lint (mavjud ogohlantirishlar bilan), vaqtinchalik katalogdagi production build va yangi Python test Ruff tekshiruvi o‘tdi.

**Qolgan ishlar:** bu natija butun tizimda boshqa xato yo‘qligi yoki production tayyorligi kafolati emas. Fiskal blok, server/domen/WAF/DDoS ulanishi, Docker build kontekstiga media kirishi va keyinga qoldirilgan dependency/startup tozalashi oldingi qarorlarga binoan ochiq. Haqiqiy DB/env/media, foydalanuvchi ma’lumotlari va tashqi Telegram/emailga tegilmadi; deploy/commit qilinmadi.

### AUD-32 — Telegram 2FA kontaktini xavfsiz qayta bog‘lash

**2/5 · P1 · Kodda aniq va shartli xavf.**

**Dalil:** `telegram_bot_sms/main.py`dagi contact handler; `backend/api/v1/tg_bot/serializers.py:9`; `backend/apps/tg_bot/models.py`.

Kontakt egasi senderga mosligi tekshiriladi — bu foydali himoya. Biroq handler faqat private chat bilan cheklanmagan: o‘z kontaktini guruhda yuborish group chat IDni bog‘lashi va keyingi OTPni guruhga chiqarishi mumkin. Telefon update_or_create bilan almashtiriladi, chat_id esa unique; o‘sha Telegram account yangi telefon bilan qayta ulanganda IntegrityError ehtimoli bor. Qayta bog‘lash uchun eski chatga bildirish va audit yo‘q. Async handler ichida `requests.post()` ishlatilib bot event loopi bloklanadi.

**Taklif:** 2FA ulashni shaxsiy chatga cheklash; telefon/chatni atomar qayta bog‘lash, audit/bildirish; backend so‘rovini asinxron bajarish.

**Bajarildi mezoni:** guruh orqali OTP yo‘nalishi o‘zgarmaydi; telefon almashtirish 500 bermaydi; boshqa bot foydalanuvchilari backend javobini kutib qolmaydi. Bog‘liq: T7.8.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

#### 2026-10-16 — 11-qadam: 2FA faqat shaxsiy chatda

**Holat:** foydalanuvchi **“Ha, 11-qadamni bajar”** deb tasdiqladi. Ushbu lokal tuzatish va tegishli tekshiruvlar **BAJARILDI**; server/botga deploy qilinmadi. Quyidagi amaldagi holat/dalil tuzatishdan oldingi kodga tegishli. **Turi:** guruhga OTP yo‘nalishi uchun shartli xavf; regressiya faqat sun’iy kontaktlarda tekshirildi.

**Amaldagi holat:** `telegram_bot_sms/main.py::contact_handler` kontakt egasini sender bilan solishtiradi, ammo `message.chat.type`ni tekshirmaydi va `message.chat.id`ni backendga yuboradi. Ichki `TelegramContactSerializer.chat_id` oddiy `CharField`; `misc.get_current_telegram_contact()` telefon va joriy bot IDni tekshiradi, chat turini/IDni cheklamaydi. Demak, botga yetib kelgan guruhdagi tegishli kontakt ro‘yxatdan o‘tsa, keyingi OTP o‘sha guruh manziliga yo‘nalishi mumkin. Bu OTP parolning o‘rnini bosishi yoki haqiqiy kod oshkor bo‘lganining isboti emas.

**Dalil:** DB ulanishi bloklangan test sozlamasida faqat sun’iy telefon va `chat_id=-100000000001` bilan serializer `is_valid()` natijasi `True` bo‘ldi. Modelga yozilmadi, Telegram/APIga hech narsa yuborilmadi. [Telegram Bot API](https://core.telegram.org/bots/api#keyboardbutton) bo‘yicha `request_contact` tugmasi shaxsiy chatda ishlaydi; bu cheklov har qanday kelgan `message.contact`ni qabul qilayotgan handlerning o‘rnini bosmaydi. Guruhdan kontakt kelish ehtimoli bot huquqlari/Telegram yetkazishiga bog‘liq; mavjud ma’lumotda bunday yozuv borligi tekshirilmadi.

**Taklif doirasi:** kontakt ulashni botda faqat private chat, mavjud sender va o‘z kontaktiga ruxsat berish; ichki ro‘yxatga olish APIida shaxsiy chatga mos IDni tekshirish; OTP/status lookupda eski noto‘g‘ri/guruh manzilini bog‘langan kontakt deb qabul qilmaslik. Oddiy xabar/hisobot yuboruvchi umumiy Telegram senderini cheklamaslik: do‘kon guruh hisobotlari saqlanadi. Guruhga bog‘langan eski kontakt topilsa, shaxsiy chatda qayta ulash talab qilinadi; real kontaktlarni ommaviy o‘zgartirish/o‘chirish qilinmaydi.

**Qabul mezoni:** group/supergroup/channel yoki senderi yo‘q kontakt backendga ulanish so‘rovini yubormaydi; begona kontakt rad etiladi; valid private ulanish va OTP ishlaydi; eski guruh manziliga OTP yuborish chaqiruvi yo‘q; do‘konning oddiy guruh hisobotlari buzilmaydi. Barchasi sun’iy message/user/contact va mock Telegram yuborish bilan tekshiriladi. Telefon/chat qayta bog‘lashdagi unique konflikt, async HTTP, qo‘shimcha audit/bildirish va botni productionda qayta ishga tushirish keyingi alohida doira.

**Bajarildi:** bot contact handleri faqat `private` chat, mavjud oddiy user, musbat va senderga teng chat ID hamda o‘z kontaktini qabul qiladi; boshqa holatda backend chaqirilmaydi. `apps/tg_bot/identity.py::is_private_chat_id` backendda musbat ASCII raqamli, kanonik va 52 bitdan kichik user dialog ID formatini tekshiradi. Registration serializer va administrator yaratish buyrug‘i shu qoidani saqlashdan oldin qo‘llaydi. Login/parol o‘rnatishning umumiy contact lookupi noto‘g‘ri/eski guruh manzilini ulanmagan deb ko‘rsatadi; OTP yuborish helperi ham kod yaratish/Redisga yozishdan oldin manzilni qayta tekshiradi. Xabar shaxsiy chatda qayta ulash yo‘lini tushuntiradi. Umumiy Telegram senderi va do‘kon guruh sozlamalari o‘zgarmadi.

**ID qoidasining asosi:** [Telegram dialog ID hujjati](https://core.telegram.org/api/bots/ids) foydalanuvchi dialoglari musbat, guruh/kanal dialoglari manfiy bo‘lishini va IDlar 52 bitga sig‘ishini tushuntiradi. Formatni tekshirishning o‘zi telefon egasini isbotlamaydi: o‘z kontaktini va haqiqiy chat turini trusted bot tekshiradi; backend ichki service token talabini saqlaydi. Model/migratsiya yoki real kontaktlarni massaviy tozalash qo‘shilmadi.

**O‘zgargan qismlar:** bot `main.py`, backend `identity.py`, contact serializer, accounts `misc.py`, administrator yaratish buyrug‘i; yangi backend/bot test modullari; administrator testiga 3 salbiy holat va eski sun’iy `new-chat-123`ni haqiqiy formatdagi IDga almashtirish; test yo‘riqnomasi, bot README va ushbu audit.

**Tekshiruv:** yangi backend moduli **31 holat**, administrator yaratish uchun **3 yangi holat**, botning alohida Python 3.14/aiogram muhitida **8 test**. Botdagi subtestlar group/supergroup/channel, sender yo‘qligi, chat/sender mos kelmasligi va begona kontaktni ham qoplaydi. Birinchi backend to‘plami **59 passed, 1.72 s**. Parol tiklash, demo, email/OTP matni va guruh hisobot/sozlama regressiyalari bilan **125 passed, 3.77 s**; bot **8/8**, jami **133 tekshiruv**. Full OTP→JWT oqimi guruhdan shaxsiy chatga qayta ulangach o‘tdi; eski guruh uchun OTP/cooldown/ticket-sent holati yaratilmaydi. Ichki registration auth saqlandi. Faqat 5433 test PostgreSQL, 6380 test Redis, sun’iy message/contact/token, xotiradagi email va mock HTTP/Telegram ishlatildi. O‘zgargan Python fayllarida Ruff check, yangi testlarda format check, Django system check o‘tdi. Kengaytirilgan to‘plamda 16 ta avvaldan mavjud Django email deprecation ogohlantirishi bor.

**Chegara:** real guruh/Telegram API bilan sinov, kontaktlarni ommaviy o‘zgartirish, eski OTPlarni ommaviy bekor qilish va deploy qilinmadi. Oldin yuborilgan kodlar uchun mavjud 180 soniyalik TTL/verification siyosati o‘zgarmadi; ushbu qadam yangi kodning guruhga yuborilishini to‘sadi. Eski noto‘g‘ri kontaktlar kod olish uchun botning shaxsiy chatida qayta ulanadi. Chat/telefon unique konflikti va async HTTP uchun quyidagi/yangi alohida qarorlar kerak. AUD-32 umumiy doirasi qisman ochiq.

#### 2026-10-16 — 12-qadam: botning boshqa so‘rovlarini kutdirmaslik

**Holat:** foydalanuvchi **“Ha, 12-qadamni bajar”** deb tasdiqladi. Ushbu lokal tuzatish va tegishli tekshiruvlar **BAJARILDI**; bot/serverga deploy qilinmadi. Quyidagi dalil tuzatishdan oldingi holatga tegishli.

**Dalil:** `telegram_bot_sms/main.py::contact_handler` async bo‘lsa ham `requests.post(..., timeout=5)`ni to‘g‘ridan-to‘g‘ri bajaradi. Shu HTTP tugamaguncha polling jarayonining event loopi boshqa handler/timerlarni bajara olmaydi. Alohida bot Python muhitida barcha HTTP mock qilindi: backend javobiga sun’iy **120 ms** kutish qo‘yilganda, **20 ms**da bajarilishi kerak bo‘lgan boshqa timer **122 ms**dan keyin ishladi. Haqiqiy backend/Telegram, DB yoki `.env` ishlatilmadi; repo kodi bu probe uchun o‘zgartirilmadi. Bu prod latency o‘lchovi emas.

**Taklif doirasi:** kontakt registrationining blocking HTTP ishini event loopdan ajratish (mavjud requestsni threadga berish yoki mavjud async imkoniyat); timeout, ichki service auth, shaxsiy chat himoyasi, javob/xato matnlari va flood tekshiruvini saqlash. Dependency/lock/Docker/runtime install oqimiga tegilmaydi; 6-qadam keyinga qoldirilgan holatda qoladi. Telefon/chat qayta bog‘lash qoidasi o‘zgarmaydi, tashqi retry yoki deploy qo‘shilmaydi.

**Qabul mezoni:** sun’iy sekin backend kutayotganida boshqa coroutine vaqtida ishlaydi; valid private kontakt bir marta yuboriladi; HTTP xatosi foydalanuvchiga avvalgi umumiy xabarni beradi; guruh/begona kontakt yuborilmaydi; bot unit testlari haqiqiy tarmoqqa chiqmaydi. Production botni qayta ishga tushirish alohida kelishiladi.

**Bajarildi:** `telegram_bot_sms/main.py::contact_handler`dagi HTTP `await asyncio.to_thread(requests.post, ...)` orqali standart thread poolda bajariladi. Backendning javobini kutish event loopni band qilmaydi. URL, JSON, ichki auth header, `timeout=5`, `raise_for_status`, xato/muvaffaqiyat matni, shaxsiy chat va flood qoidalari saqlandi. Dependency/lock, Docker/entrypoint, backend biznes kodi va 6-qadamga tegilmadi.

**Tekshiruv:** `telegram_bot_sms/tests/test_contact_handler.py`ga **4 test** qo‘shildi; avvalgi 8 test bilan **12/12, 2.201 s** o‘tdi. Ikki sekin HTTP sinovi `threading.Event` bilan javobni ushlab turadi: birinchi request tugashidan oldin boshqa `/status` handleri hamda boshqa shaxsiy kontakt muvaffaqiyatli ishlashi tekshiriladi. Shu chatdagi parallel takroriy kontakt yangi HTTP chaqiruvini yubormaydi. Connect/read timeout, connection error va HTTP error foydalanuvchiga avvalgi umumiy xabarni beradi. Ikki sekin sinov eski blocking kodda FAIL bo‘lgani ko‘rildi; to‘g‘rilangach ikkalasi ham o‘tdi. Sun’iy HTTP/Telegram, soxta tokenlar, botning Python 3.14/aiogram muhiti ishlatildi; haqiqiy `.env`/Telegram/backend chaqiruvi yoki polling yo‘q. Ruff check va yangi test format check o‘tdi. Backend kodi o‘zgarmagani uchun avvalgi 125 backend testining natijasi tarixiy 11-qadam dalili bo‘lib qoldi; bu safar qayta ishlatilmadi.

**Sinov muhiti qaydi:** restricted sandbox mahalliy socket `send()`ini `PermissionError(1)` bilan rad etdi; asyncio thread callbacklari event loopni uyg‘ota olmay, ikki test jarayoni kutilishda qoldi. Faqat ushbu ishda boshlangan ikki test jarayoni to‘xtatildi va mahalliy uyg‘otish ruxsati bor muhitda shu mock testlar to‘liq o‘tkazildi. Bu avtomatik tasdiq rad javobi yoki production kodi xatosi emas. Vaqtinchalik jarayonlar qolmadi.

**Chegara:** Requests timeouti avvalgi connect/read cheklovi; yangi qat’iy umumiy deadline/retry mexanizmi qo‘shilmadi. Handler bekor qilinsa, workerda allaqachon boshlangan HTTP chaqiruvi tugashi mumkin. Load test, real backend latency, thread pool tuning va deploy bu qadamga kirmaydi. O‘zgargan fayllar: bot `main.py`, mavjud bot test moduli, bot README, `backend/README_TESTS.md` va ushbu audit. Haqiqiy kontakt/DB/media/env o‘zgarmadi.

#### 2026-10-16 — 13-qadam: Telegram konflikti va platforma adminining ish muhiti

**Holat:** foydalanuvchi avval rad xabari/yechimini aniqlashtirdi, so‘ng platforma admini uchun qo‘lda tiklash oynasi, yordam Telegram sozlamalari va barcha asosiy admin imkoniyatlarini interfeysga qo‘shishni bevosita buyurdi. Kengaytirilgan implementatsiya va lokal tekshiruvlar **BAJARILDI**. Quyidagi dastlabki dalil/taklif tarixiy; yakuniy doira pastda.

**Dalil:** `TelegramContact.phone_number` va `chat_id` alohida unique. `TelegramContactSerializer.save()` faqat telefon bo‘yicha `update_or_create()` qiladi, band chat ID bo‘yicha DB `IntegrityError`i ushlanmaydi. Bitta Telegram chatini boshqa telefon bilan yuborish registration endpointida **HTTP 500** berdi. Probe faqat localhost:5433dagi `test_..._test` bazasida sun’iy ikki telefon va bitta chat bilan bajarildi: avvalgi bog‘lanish saqlandi, yangi yozuv yaratilmagan va probe yaratgan qator transaction rollbackidan keyin yo‘qoldi. Telegram/Redis yoki haqiqiy kontaktlarga tegilmadi; ilova kodi bu probe uchun o‘zgartirilmadi. Bot hozir bunday holatni umumiy “serverga ulanish xatosi” deb ko‘rsatadi.

**Taklif doirasi:** band chatga qarshi aniq validation/error code va DB unique poygasiga ham ishlaydigan nazoratli `400/409` javob; botda shu holat uchun tushunarli xabar. Mavjud 2FA bog‘lanishi saqlanadi. Ushbu kichik qadam eski telefon yozuvini o‘chirib, chatni boshqa akkauntga avtomatik ko‘chirmaydi; bunday ko‘chirish/egalik siyosati alohida kelishiladi. Bir xil telefon/chatni takroriy ulash va odatdagi bo‘sh chatga ulash ishlaydi. 11-qadam shaxsiy chat qoidasi saqlanadi, ichki token talabi o‘zgarmaydi.

**Qabul mezoni:** yangi telefon yoki mavjud telefon uchun band chat yuborilganda 500 yo‘q; tegishli xato kodi/bot xabari bor; oldingi bog‘lanishlar o‘zgarmaydi va yarim yozuv qolmaydi. Parallel konflikt ham nazoratli qaytadi, boshqa DB nosozligi noto‘g‘ri “chat band” deb yashirilmaydi. Sinovlar faqat ajratilgan DB, sun’iy kontakt va mock bot HTTPda. Real foydalanuvchini qayta bog‘lash yoki deploy alohida ruxsatga qoladi.

**Yakuniy bajarilgan doira:**

- **Boshqaruv paneli:** tenantga bog‘liq savdo statistikasi o‘rniga umumiy hisob/do‘kon holati, kutayotgan yordam murojaatlari, sotuvchi tekshiruvi, so‘nggi audit va tezkor havolalar. Mavjud do‘kon, seller review, jamoa, yordam va audit amallari saqlandi.
- **Hisoblar & Kirish:** rol/holat bo‘yicha filtr, qidiruv, sahifalash, hisobning barcha do‘konlari va jamoaga o‘tish; do‘konga biriktirilmagan hisob ham ko‘rinadi. Hisoblar ro‘yxatida N+1 so‘rovlari bartaraf etildi; testda 20 ta qator uchun ko‘pi bilan 7 DB so‘rovi.
- **Login/Telegramni tiklash:** barcha hisoblar va xodimlar ro‘yxatidan ochiladigan alohida modal. Faqat platform admini, o‘z paroli, sabab va egalikni qo‘lda tekshirganlik tasdig‘i bilan. User/contacts transaction va lock ostida yangilanadi, stale telefon/version hamda begona telefon/chat rad etiladi. Telefon ko‘chirilganda shu hisobning eski Telegram qatori ko‘chadi; boshqa hisoblar birlashtirilmaydi. Eski access/refresh, parol havolalari, OTP va login limitlari bekor/tozalanadi. Savdo va membership IDlari saqlanadi. Yangi telefonni avtomatik telefon-verifikatsiyadan o‘tgan deb belgilamaydi.
- **Hisobni bloklash/ochish:** butun hisobga ta’sir qiluvchi alohida, parol/sabab talab etuvchi amal; adminni bu oynadan bloklab bo‘lmaydi. Hisobni o‘chirish yoki tarixni yo‘qotish qo‘shilmadi. Mavjud jamoa huquqlari, arxivlash, bo‘shatish va email taklifi o‘z oynasida qoldi.
- **Yordam Telegram bildirishnomalari:** Services’da platforma sozlamalari do‘kon sozlamalaridan alohida, do‘kon tanlash shart emas. Adminning joriy botga bog‘langan shaxsiy chati, manfiy IDli guruh yoki ikkalasi; yoqish/o‘chirish, saqlash va sinov navbati. DBda admin preference saqlanadi. Biror UI preference yaratilgach ENVdagi eski qabul qiluvchilar fallbacki to‘xtaydi; hali sozlanmagan o‘rnatishda avvalgi ENV rejimi saqlanadi. Yangi visitor xabari oldingi `on_commit → Celery` oqimi bilan yuboriladi; suhbat matni/rasm/token/ism Telegramga chiqmaydi, faqat yangi xabar haqida xabarnoma va autentifikatsiya talab qiluvchi suhbat havolasi boradi.
- **Qo‘ng‘iroqcha:** admin uchun savdo notification oynasi o‘rniga o‘qilmagan yordam xabarlari soni va murojaatlarga o‘tish. Bitta kichik count endpoint 20 soniyada, faqat ko‘rinadigan tabda, bir vaqtning o‘zida bitta so‘rov bilan so‘raladi.
- **Konflikt va audit:** band Telegram uchun nazoratli 400/error code va botda adminning aniq tiklash yo‘li. DB unique poygasi ham ushlanadi; boshqa DB xatosi noto‘g‘ri “chat band”ga aylantirilmaydi. Tiklash/notification auditlari tenantdan tashqari, platforma darajasida yoziladi — adminning tasodifiy do‘koniga tushmaydi. Ikki yangi audit amali interfeys filtriga qo‘shildi. Parol auditga yozilmaydi.
- **Ko‘rinish:** mavjud glass-card, button, modal, telefon inputi va light/dark tokenlari ishlatildi; yangi sahifalar responsive. Admin sarlavhalaridan keraksiz savdo matnlari va “Tenants” texnik yozuvi olindi. Egalar/xodimlarning biznes oynalari o‘chirilmagan.

**Tekshiruvlar:** 199 backend testi (5.39 s), 13 bot testi (2.056 s), 9 Node frontend test to‘plami (0.878 s) o‘tdi. Haqiqiy Chrome’da dashboard/sidebar, hisoblar, tiklash formasi/majburiy tasdiq/payload, notification save/test, light/dark, 390px mobile va modal overflow tekshirildi. Dastlabki brauzer testi selector yozuvida xato bo‘lib tuzatildi; keyingi testlar o‘tdi. Frontend lintidagi yangi `no-use-before-define` xatolari wrapper funksiyalarini to‘g‘ri joylashtirish bilan tuzatildi; yangi komponentlardagi sinxron effect state ogohlantirishlari ham bartaraf etildi. Yakuniy lint/build o‘tdi; loyihadagi qolgan avvaldan mavjud ogohlantirishlar bu qadamda ommaviy o‘zgartirilmadi. Backend yangi fayllari Ruff, Django system/schema tekshiruvlaridan o‘tkazildi. Backendda 8 ta avvaldan mavjud email deprecation ogohlantirishi bor.

**Migratsiya va ekspluatatsiya:** yangi `support/0003_supporttelegramsettings` va `core/0013_alter_auditlog_action` faqat ajratilgan test DBda tekshirildi. Server release vaqtida ular qo‘llanib, backend/Celery/bot yangi kod bilan ishga tushirilishi kerak; bu sessiyada haqiqiy serverga migrate/deploy/restart qilinmadi. `.env`, haqiqiy kontaktlar, chatlar va tashqi Telegram APIga tegilmadi. Sinov xabari uchun API 202 “navbatga qo‘yildi”ni qaytaradi; bu yetkazildi degani emas. Worker, botning guruh huquqlari va serverdagi token tayyor bo‘lishi zarur. Retry mavjud; aynan bir marta yetkazish/outbox kafolati qo‘shilmadi. Eskirgan resetlarni tozalash Redisdagi mavjud xizmatdan foydalanadi; DB/Redis uchun umumiy atomarlik va’da qilinmaydi.

**Fayllar:** accounts platform service/view/test/URL, support model/settings API/task/migratsiya, TG serializer/bot va bot testi, ikki audit choice/migratsiya; frontend platform API/dashboard/accounts/settings/recovery komponentlari, layout/sidebar/Employees/Services/Dashboard/Audit, browser fixture/sinov va qo‘llanmalar. Bir marta qo‘lda ko‘rsatilgan egalik tasdig‘i avtomatik shaxsni aniqlash tizimi emas; admin real tekshiruv uchun javobgar. Fiskal provayder, production POS gate, source backup/commit queue va keyinga qoldirilgan 6-qadam o‘zgarmadi.

### AUD-33 — Brauzer xotirasidagi parolni olib tashlash

**1/5 · P0 · Kodda aniq.**

**Dalil:** `frontend/ilbi/src/pages/Login.jsx:37,86,114`; `src/api/client.js:38`.

Remember me parolni Base64ga aylantirib `localStorage`ga yozadi. Base64 qayta ochiladigan kodlash; shifrlash emas. Logout `ilbi_remember_password`ni tozalamaydi. Brauzer storageiga kira oladigan script yoki shu qurilmadan foydalanuvchi parolni qayta o‘qiy oladi.

**Taklif:** parolni storagega yozmaslik; mavjud saqlangan parol kalitini tozalash; login nomi va remember/session siyosatini alohida yuritish.

**Bajarildi mezoni:** hech bir login/logout oqimi parolni local/session storagega yozmaydi; eski kalit tozalanadi. Bog‘liq: T7.9.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-34 — Kassa yopishda aniqlanmagan owner o‘zgaruvchisi

**1/5 · P1 · Kodda aniq.**

**Dalil:** `backend/apps/cashbox/services/cashbox_service.py:268,283`.

`owner` faqat `notify_web_reports=True` blokida aniqlanadi. Web notification o‘chirilgan, Telegram `personal/both` yoqilgan bo‘lsa, `owner.phone_number`ga kirishda `UnboundLocalError` yuz beradi va smena transactioni qaytadi.

**Taklif:** ownerni bildirishnoma sozlamalaridan mustaqil aniqlash.

**Bajarildi mezoni:** web notification o‘chiq + personal/both Telegram kombinatsiyalarida smena yopiladi.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-35 — Egasi o‘chirilgan do‘konini qayta yoqa olishi

**1/5 · P2 · Kodda aniq.**

**Dalil:** `backend/apps/accounts/services/tenant_context_service.py`; `backend/api/permissions.py:100`; `backend/api/v1/tenants/views.py:275`.

Activate view own ownerga ruxsat berishini aytadi, lekin kontekst faqat `tenant__is_active=True` membershipdan olinadi. O‘chirilgan do‘kon headeri rad etiladi yoki tenant None bo‘ladi; object permission ham shu faol kontekstga tayanadi. Egasi o‘zi deaktivatsiya qilgan do‘konini qayta yoqa olmaydi, admin kerak bo‘ladi.

**Taklif:** aktivatsiya uchun tenant egaligi va faol owner membershipni do‘kon is_active holatidan alohida tekshirish; boshqa biznes amallarining active gateini saqlash.

**Bajarildi mezoni:** egasi o‘z do‘konini qayta yoqadi; boshqa egaga ruxsat yo‘q; deaktiv do‘konda savdo ochilmaydi.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-36 — HEAD/OPTIONS so‘rovlari uchun ruxsat xaritasi

**1/5 · P2 · Koddan kelib chiqadigan xato.**

**Dalil:** `backend/api/permissions.py:160,163`; GET/POST/PATCH map ishlatadigan catalog/sales viewlari.

`permission_map`da request method yo‘q bo‘lsa `ImproperlyConfigured` ko‘tariladi. Maplarda odatda HEAD/OPTIONS yo‘q. DRF permission tekshiruvi handlerdan oldin bo‘lgani uchun oddiy metadata/HEAD yoki qo‘llanmaydigan method kutilgan javob o‘rniga 500ga aylanishi mumkin.

**Taklif:** HEAD uchun tegishli GET vakolati; OPTIONS va qo‘llanmaydigan metodlar uchun aniq, xavfsiz 200/403/405 siyosati.

**Bajarildi mezoni:** HEAD/OPTIONS/qo‘llanmaydigan metod permissionni chetlab o‘tmaydi va 500 bermaydi.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-37 — Public chekda qaytarilgan va sof summa

**1/5 · P2 · Kodda aniq.**

**Dalil:** `backend/api/v1/sales/serializers.py:265,284`; `frontend/ilbi/src/pages/PublicReceiptView.jsx:333`; `components/common/ReceiptSlip.jsx:440`.

Public serializer `refunded_amount/net_amount`ni va item qaytarish holatini chiqarmaydi; frontend faqat total ko‘rsatadi. B2B qaytishlarda asl jami saqlanib refund alohida yozilgani uchun public nusxa amaldagi sof qiymatni bermaydi. Public item javobida ichki item ID ham bor, avval kelishilgan whitelistda bunga ehtiyoj yo‘q.

**Taklif:** mijozga ko‘rinadigan total/refund/net va qator ma’lumotlarini kelishilgan whitelist bilan bir xil qilish; receipt chop etish ko‘rinishini ham moslash.

**Bajarildi mezoni:** qaytarilgan chekda uch summa to‘g‘ri; kassir/kontragent/tannarx maxfiyligi saqlanadi. Bog‘liq: T4.10/T4.13/AUD-03.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

### AUD-38 — README, eski nomlar va holat yozuvlari

**1/5 · P3 · Kod/hujjatda aniq.**

**Dalil:** `README.md:49,50,51`; `backend/config/urls.py`; `docker-compose.yml`; `frontend/ilbi/src/api/client.js`dagi branchId argumentlar; `components/layout/Layout.jsx`; master plan checkpoint va walkthrough logi.

README backendni localhost:8000 deydi, Compose backendga host port bermaydi; Swagger/Redoc yo‘llari haqiqiy `/api/docs/` va `/api/redoc/`ga mos emas. Audit davomida ikkala `.env.example`dagi eski insecure secret placeholderi tashqi o‘zgarishda bo‘sh qiymatga almashtirildi; startup baribir haqiqiy secretni talab qiladi, README quick startda uni yaratish/to‘ldirishning aniq qadami kerak. Qolgan branchId argumentlari ishlatilmaydi; ayrim matnlar eski filial/Z-hisobot nomlarini saqlagan. Reja checkpointidagi ochiq/yopiq ishlar keyingi walkthrough yozuvlari bilan bir xil emas, bir nechta qayd takrorlangan.

**Taklif:** ishga tushirish yo‘llari va env qadamlarini amaldagi konfiguratsiyaga moslash; eski argument/nomlarni tegishli task doirasida tozalash; tasdiqlangan eng so‘nggi natijani bitta joyda yuritish.

**Bajarildi mezoni:** yangi foydalanuvchi README bo‘yicha xizmatlarga kira oladi; ishlatilmaydigan branch API izlari qolmaydi; statuslar o‘zaro zid emas. Bog‘liq: T1.8/T1.9 va hujjat texnik qarzi.

**Muhokama/qaror:** hali yo‘q. **Bajarilish:** boshlanmagan.

**Qo‘shimcha dalil — 2026-10-16:** backup yo‘riqnomasi havolalarini tekshirishda asosiy README ichidagi avvaldan mavjud `REBRANDING_AUDIT_ILBI_UZ.md` havolasi nishoni topilmadi. Yangi backup havolalari to‘g‘ri; eski uzilgan havola ushbu 3-qadamda o‘zgartirilmadi.

## 4. Muhokama va bajarilish jurnali

| Sana | Tegishli vazifa | Muhokama yoki qaror | Natija |
|---|---|---|---|
| 2026-10-12 | Barcha AUD vazifalari | Foydalanuvchi butun loyihani tahlil qilish, kamchiliklarni qiyinidan osoniga tartiblash va qulay faylda saqlashni so‘radi. Hozir kodni o‘zgartirmaslikni aniq aytdi. Keyingi muhokamalar tegishli vazifalarga qo‘shiladi; ishlar keyinchalik birma-bir bajarilgach belgilab boriladi. | Audit va ushbu fayl tayyorlandi. Implementatsiya uchun joriy ko‘rsatma: kutish. |
| 2026-10-12 | AUD-12, AUD-38 | Auditning oxirida fayl hashlarini solishtirish tashqi o‘zgarishlarni ko‘rsatdi: tenants `0008` migratsiyasi, yangi `0011` migratsiyasi va ikkala `.env.example`. Ular ushbu audit tomonidan o‘zgartirilmadi; qayta o‘qilib tegishli topilmalar yangilandi. | Oldingi topilma tuzatilgan jihatlar qayd etildi. Migratsiya runtime tekshiruvi va qolgan README/data vazifalari ochiq. |
| 2026-10-12 | AUD-01 | Foydalanuvchi birinchi, eng qiyin vazifa uchun hozirgi holatga mos yechim tavsiyasini so‘radi. Provayder integratsiyasi, seller review, tenant fiskal ulanishi, idempotent operatsiya/rezerv, noaniq javobni aniqlash va refund bo‘yicha taklif tegishli bo‘limga qo‘shildi. Rasmiy Soliq manbalari qayta o‘qildi. | MUHOKAMADA. Taklif hali foydalanuvchi qarori emas; ilova kodi o‘zgartirilmadi. |
| 2026-10-16 | AUD-21 | Production tayyorgarligining 1-qadami alohida tasdiqlandi: HTTPS/proxy, secure cookie, Gunicorn reload va production env ajratilishi. Tafsilot va tekshiruvlar AUD-21da. | QISMAN BAJARILDI. 611 backend va 9 deployment testi o‘tdi; serverga deploy qilinmadi. |
| 2026-10-16 | AUD-01 | Production tayyorgarligining 2-qadami sifatida provayder/API talablarini aniqlash va ulanish yo‘lini tayyorlash tasdiqlandi. Foydalanuvchi hali provayder tanlamagan. Kod bo‘shliqlari, ikki nomzod, ochiq savollar va 2.1 taklifi yozildi. | Tayyorgarlik tayyor; integratsiya ochiq. Ushbu qadamda faqat hujjat yangilandi. 2.1 implementatsiyasi hali tasdiqlanmagan. |
| 2026-10-16 | AUD-01 | 2.1 bo‘yicha foydalanuvchi tanlovni agentga topshirdi. Katalog MXIK/qadoq rekvizitlari va yangi savdo satrida o‘zgarmas mahsulot nusxasi bajarildi; lokal nullable migratsiyalar qo‘llandi. | 2.1 BAJARILDI, AUD-01 QISMAN BAJARILDI. 628 backend testi, frontend unit/build/lint, ikki browser tekshiruvi va OpenAPI tekshiruvi o‘tdi. 2.2 taklifi alohida tasdiqni kutadi. |
| 2026-10-16 | AUD-01 | Foydalanuvchi 2.2ni ma’qullab, avval provayder va Uzum ulanishini muhokama qilishni so‘radi; so‘ng fiskal ishni vaqtincha keyinga qoldirib, batafsil MD va boshqa production bosqichiga o‘tishni buyurdi. | Fiskal qo‘llanma yaratildi. 2.2 va haqiqiy integratsiya boshlanmagan, keyinga qoldirildi; 2.1 saqlandi va production POS gate o‘zgarmadi. |
| 2026-10-16 | AUD-21 | Navbatdagi 3-qadam uchun repodagi backup oqimi tekshirildi: mavjud zaxira faqat source kodga tegishli; DB/media tiklash vositalari topilmadi. Aniq doira, fayllar va qabul mezoni yozildi. | Tahlil tayyor, backup implementatsiyasi alohida tasdiqni kutadi. Serverdagi tashqi backup holati tekshirilmagan. |
| 2026-10-16 | AUD-21 | Foydalanuvchi 3-qadamni “Ha, tayyorla” deb tasdiqladi. Shifrlangan DB/media/docs nusxasi, faqat yangi ajratilgan resursga restore, sozlama namunasi va yo‘riqnoma yaratildi. | 3-qadamning LOKAL TAYYORGARLIGI BAJARILDI: 11 yangi backup + 9 HTTPS/deployment testi, jami 20/20 o‘tdi. Haqiqiy server/timer/offsite yoqilmadi. |
| 2026-10-16 | AUD-21 | Keyingi 4-qadam taklifi: ochiq chek va yangi do‘konning cache hisoblagichlari production workerlarida umumiy Redisga o‘tkazilishi. Dalil va tekshiruv mezoni AUD-21da. | Faqat tahlil. Implementatsiya alohida tasdiqni kutadi. |
| 2026-10-16 | AUD-21 | Foydalanuvchi 4-qadamni tasdiqladi. Production default cache umumiy Redis va alohida production/domen prefiksiga o‘tkazildi; limitlar saqlandi. | LOKAL BAJARILDI. Mustaqil jarayonlar va vaqtinchalik Redis bilan HTTP cheklovlari, shu jumladan tegishli API regressiyalari: 116 test o‘tdi. Serverga deploy qilinmadi. |
| 2026-10-16 | AUD-21 | Keyingi 5-qadam uchun backend tayyorlik tekshiruvi va dependent xizmatlarning start shartlari tahlil qilindi. | Taklif tayyor, implementatsiya uchun alohida tasdiq kutiladi. |
| 2026-10-16 | AUD-21 | Foydalanuvchi 5-qadamni tasdiqladi va uzilishdan keyin davom ettirishni buyurdi. Loopback readiness endpoint, lokal HTTP probe va production health dependency shartlari qo‘shildi. | LOKAL BAJARILDI: 11 yangi readiness, 9 HTTPS/Compose va 27 production settings testi; Ruff, system check va OpenAPI tekshiruvi o‘tdi. Haqiqiy serverga tegilmadi. |
| 2026-10-16 | AUD-21 | 6-qadam uchun production build/dependency oqimi tekshirildi: unfrozen fallback, dev paketlari va runtime sync topildi. Productionni developmentdan ajratib tuzatish doirasi yozildi. | Taklif tayyor, implementatsiya uchun alohida tasdiq kutiladi. |
| 2026-10-16 | AUD-21 | Foydalanuvchi 6-qadamga “Hozircha o‘zgartirma” deb javob berdi. | KEYINGA QOLDIRILDI. Ushbu qadam kodi o‘zgartirilmadi; qayta boshlash uchun yangi tasdiq kerak. |
| 2026-10-16 | AUD-21 | Keyingi masala sifatida productionda texnik API schema/Swagger/Redoc ochiqligi kod va kutubxona defaultlari bo‘yicha tekshirildi. | 7-qadam taklifi yozildi. Faqat audit hujjati o‘zgardi; implementatsiya uchun alohida tasdiq kutiladi. |
| 2026-10-16 | AUD-21 | Foydalanuvchi 7-qadamni tasdiqladi. Productionda uch texnik API hujjat route’i yopildi; development/test va offline OpenAPI saqlandi. | LOKAL BAJARILDI: 38 test o‘tdi, haqiqiy Markdownni yozadigan 1 ta eski test tashlandi. Serverga deploy qilinmadi; 6-qadam keyinga qoldirilgan holatda. |
| 2026-10-16 | AUD-31 | Keyingi 8-qadam uchun access tokenning yo‘q version claimini qabul qilishi qayta tekshirildi; haqiqiy imzo va sun’iy user bilan tasdiqlandi. Refreshdagi mavjud yaxshilanish ham qayd etildi. | Faqat tahlil. Access/refresh claim tekshiruvini bir xil qat’iylashtirish alohida tasdiqni kutadi. |
| 2026-10-16 | AUD-31 | Foydalanuvchi 8-qadamni tasdiqladi. Access va refresh uchun majburiy, aynan integer va joriy token_version qoidasi bitta helperga yig‘ildi. | LOKAL BAJARILDI: 30 yangi API testi, tegishli auth/parol/login regressiyalari bilan jami 136 test o‘tdi. Haqiqiy sessiyalar o‘zgartirilmadi va serverga deploy qilinmadi. |
| 2026-10-16 | AUD-26 | 9-qadam uchun qo‘llanma tahrirlash testi tekshirildi: hozir asl Markdownni o‘zgartirib, oxirida qaytaradi. Vaqtinchalik test katalogi bilan ajratish taklifi yozildi. | Faqat tahlil. Kod o‘zgartirilmagan; alohida tasdiq kutiladi. |
| 2026-10-16 | AUD-26 | Foydalanuvchi 9-qadamni tasdiqladi. Hujjat testi har safar sun’iy vaqtinchalik fayllarga yo‘naltirildi; asl faylni oxirida qaytarish amali olib tashlandi. | BAJARILDI: tegishli 9 test o‘tdi, 20 ta asl Markdown hashi o‘zgarmadi. Faqat test va hujjat fayllari o‘zgardi. |
| 2026-10-16 | AUD-27 | Keyingi 10-qadam uchun avatar oqimi qayta o‘qildi: validatsiya mavjud, lekin POST/DELETE eski faylni DB yozuvidan oldin o‘chiradi. | Faqat tahlil. Eski avatarni xatoda saqlash taklifi alohida tasdiqni kutadi. |
| 2026-10-16 | AUD-27 | Foydalanuvchi 10-qadamni tasdiqladi. Avatar lock ostida yangilanadi, yangi fayl alohida nomlanadi va eski fayl faqat commitdan keyin tozalanadi; xatoda ishlatilayotgan fayl saqlanadi. | LOKAL BAJARILDI: 19 yangi test, tegishli profil/JWT regressiyalari bilan jami 63 test o‘tdi. Haqiqiy media/MinIO yoki serverga tegilmadi. |
| 2026-10-16 | AUD-32 | Keyingi 11-qadam uchun bot contact handler, registration serializer va OTP contact lookup qayta o‘qildi. Guruh chat IDsi sun’iy validatsiyadan o‘tdi. | Faqat tahlil. 2FAni shaxsiy chatga cheklash taklifi alohida tasdiqni kutadi; haqiqiy xabar/OTP yuborilmadi. |
| 2026-10-16 | AUD-32 | Foydalanuvchi 11-qadamni tasdiqladi. Private chat/sender/o‘z kontaktini tekshirish, registration/CLI va OTP lookup/sender uchun musbat user ID himoyasi qo‘shildi. | LOKAL BAJARILDI: 125 backend + 8 bot testi, jami 133 tekshiruv o‘tdi. Oddiy guruh hisobotlari ishlaydi; real Telegram/kontaktlar/deployga tegilmadi. |
| 2026-10-16 | AUD-32 | Keyingi 12-qadam uchun sinxron bot HTTP chaqiruvi sun’iy 120 ms kutish bilan tekshirildi; 20 ms timer 122 ms kechikishda bajarildi. | Faqat tahlil. Bot backendni kutganda boshqa so‘rovlarni to‘xtatmaslik alohida tasdiqni kutadi. |
| 2026-10-16 | AUD-32 | Foydalanuvchi 12-qadamni tasdiqladi. Bot registration HTTPsi asyncio thread poolga o‘tkazildi; boshqa buyruq/kontakt shu payt ishlaydi. | LOKAL BAJARILDI: 4 yangi, jami 12 bot testi o‘tdi; timeout/auth/flood/private qoidalari saqlandi. Dependency/deployga tegilmadi. |
| 2026-10-16 | AUD-32 | Keyingi 13-qadam uchun chat/telefon unique konflikti ajratilgan test DBda qayta tekshirildi: registration 500 qaytardi, sun’iy qator rollback qilindi. | Faqat tahlil. Oldingi ulanishni saqlagan holda tushunarli rad javobi va bot xabari alohida tasdiqni kutadi. |

| 2026-10-16 | AUD-32, admin muhiti | Foydalanuvchi login/Telegramni admin interfeysidan tiklash, yordam uchun shaxsiy/guruh Telegram sozlamalari va adminning umumiy ish muhitini kengaytirishni buyurdi. | LOKAL BAJARILDI: dashboard, hisoblar, parol/audit bilan tiklash va bloklash, notification sozlamalari/qo‘ng‘iroqcha; 199 backend, 13 bot, 9 frontend to‘plami va real Chrome UI sinovi o‘tdi. Migratsiyalar test DBda; deploy yo‘q. |
| 2026-10-16 | AUD-21 | Foydalanuvchi 14-qadam — production Nginx auth/API so‘rov limitlari va lokal sinovni tasdiqladi. | LOKAL BAJARILDI: alohida per-IP bucketlar, JSON 429 va Retry-After; ikki workerli haqiqiy Nginxda 18 test o‘tdi. Cloudflare/DNS/WAF/deploy faollashtirilmadi. |
| 2026-10-16 | AUD-09 | Qo‘shimcha topshiriq bilan demo login/seed/tenant chegarasi va eski sessiyalar tekshirildi. | TAHLIL BAJARILDI: bir xil DB/kalit saqlansa demo off eski admin JWT/refreshni rad etmaydi; sun’iy probeda 200/200/200. 43 demo/settings/probe testi o‘tdi. Demo tuzatishi va haqiqiy akkauntlarga o‘zgartirish tasdiqlanmagan. |
| 2026-10-16 | AUD-09 | Foydalanuvchi demo xavfini “yopa hammasini” deb tuzatishni topshirdi. | 15-qadam LOKAL BAJARILDI: demo login/eski JWT/ticket/reset/invitation va support notification chegaralari yopildi; 33 yangi izolyatsiya testi, 802 + 1 slow = jami 803 regressiya o‘tdi. Haqiqiy hisoblar va env o‘zgarmadi; deploy yo‘q. |
| 2026-10-16 | AUD-21 | Uch himoya holati aniqlashtirildi. Foydalanuvchi domen hali sotib olinmagani/Cloudflarega ulanmagani va server yo‘qligini bildirdi, ulanishni hozircha to‘xtatishga kelishildi. | Rate limiting lokal tayyor. WAF/DDoS KEYINGA QOLDIRILDI; domen/server tayyor bo‘lganda tashqi ulanish va tekshiruv bajariladi. Uchala ish tugallandi deb belgilanmadi. |

### Keyingi suhbatlarda yuritish tartibi

1. Muhokama tegishli `AUD-xx` bo‘limining **Muhokama/qaror** qismiga sana bilan yoziladi. Global jurnalga qisqa qaror va task ID qo‘shiladi.
2. Oldingi kelishilgan master plan/walkthrough qarori mavjud bo‘lsa unga havola beriladi; taxmin yangi tasdiq deb yozilmaydi. Ziddiyat muhokamada ochiq qayd etiladi.
3. Muhokama yakunida aniq yechim, tegiladigan fayllar, dependency va bajarildi mezoni yoziladi. Kod faqat o‘sha ish foydalanuvchi tomonidan alohida tasdiqlangach o‘zgartiriladi.
4. Bajarish so‘ralgach vazifa **BAJARILMOQDA** qilinadi; faqat ish va kelishilgan tekshiruvlar yakunlangach **BAJARILDI** bo‘ladi. Kod tayyor, tashqi provayder tasdig‘i qolgan vazifa **QISMAN BAJARILDI** bo‘ladi.
5. Bajarilgan task ostiga o‘zgargan fayllar, bajarilgan tekshiruv va natija, commit bo‘lsa uning identifikatori, qolgan cheklovlar yoziladi. Hali tekshirilmagan ish “bajarildi” qilinmaydi.

### Bajarilgan vazifa uchun yozuv namunasi

```text
Vazifa: AUD-xx
Muhokama/qaror: sana — kelishilgan aniq yechim
Holat: BAJARILDI / QISMAN BAJARILDI
O‘zgargan fayllar:
Tekshiruv: buyruq yoki amaliy ssenariy — haqiqiy natija
Commit: mavjud bo‘lsa
Qolgan ish/tashqi tasdiq: mavjud bo‘lsa
Yakunlangan sana:
```

**Joriy natija — 2026-10-16:** 15-qadamdagi demo production chegarasi lokal yopildi: 33 yangi izolyatsiya holatini o‘z ichiga olgan 802 backend testi va alohida slow TTL testi — jami 803 test o‘tdi. Oldingi 14-qadamdagi Nginx rate limiting 18 haqiqiy edge testidan o‘tgan, serverda hali yoqilmagan. WAF/DDoS domen/server yo‘qligi sabab foydalanuvchi bilan keyinga qoldirildi. Backend/Celery deploy, haqiqiy hisoblar/env, fiskal POS cheklovi va 6-qadamga tegilmadi. Oldingi ishlar dalillari tegishli bo‘limlarda saqlandi.
