# Mobil APK va server deploy tartibi

Web/backend deploy va telefondagi ilova yangilanishi alohida jarayonlar. Server APK faylini va uning versiya ma’lumotini tarqatadi. Telefonda yangi kod APK yangilanishi o‘rnatilganda ishlaydi.

## Branchlar va avtomatik deploy

Hozir mobil ishlar `refactor/ilbi-backend-layout` branchida. Ushbu branchga push ochiq PR orqali CI tekshiruvlarini boshlaydi, lekin production deploy faqat `main`dagi muvaffaqiyatli CI’dan keyin ishlaydi. Deploy oldidan tekshirilgan commit hali ham `main`ning oxirgi commiti ekani qayta tekshiriladi.

`main`ga birlashtirish ushbu branchdagi backend/desktop o‘zgarishlarini ham qamrab oladi. Shu sabab mobil APK’ni chiqarish butun branchni productionga birlashtirishni talab qilmaydi: tekshirilgan APK’ni alohida nashr qilish mumkin. 2026-10-26 vazifasida egasi **faqat yangi mobil APK** chiqarilishini tanladi; platformaning amaldagi image’lari o‘zgartirilmaydi.

Amaldagi GitHub production workflow Windows/Linux paketlari va web/backend/bot image’larini chiqaradi. Android APK’ni avtomatik yig‘ish, imzolash, yuklash va mobil feed’ni faollashtirish unga hali ulanmagan. Faqat `git push` qilish yangi APK nashr etilganini anglatmaydi. Keyingi avtomatlashtirish alohida mobil release workflow va himoyalangan imzolash credential’lari bilan tashkil etilishi kerak.

## Yangi APK chiqarish ketma-ketligi

1. Ilova o‘zgarishlarini tekshiring, mazmunli commitlarga ajrating va push qiling.
2. Android `versionCode`ni oldingi tarqatilgan build’dan oshiring. Oddiy yangilanish uchun mobil marketing versiyasi yoki butun platforma versiyasini oshirish shart emas. Hozirgi nomzod: mobil `1.0.0`, Android build `2`; platforma `1.4.0`, iOS build `1`.
3. `mobile-app/` ichida preflight, TypeScript, qat’iy lint va tegishli testlarni bajaring. `npm run build:apk:local` bilan mavjud doimiy kalitda mustaqil APK yig‘ing. `npm run verify:apk:local` bilan haqiqiy paket va uning manbasini tekshiring.
4. `mobile-app/scripts/export_downloads.py` orqali tasdiqlangan APK’ni o‘zgarmas `/downloads/mobile/<source-commit>/...apk` yo‘liga stage qiling. Manifestdagi haqiqiy source commit’dan foydalaning; keyingi hujjat commitini binarning manbasi deb ko‘rsatmang.
5. Oldingi rasmiy feed bilan alohida katalogda activation sinovini bajaring. Windows/Linux/iOS metama’lumotlari saqlanishini tekshiring.
6. APK va stage qilingan feed’ni serverga uzating, serverdagi fayl hajmi/SHA-256 ni tekshiring. `ops/activate_mobile_downloads.py` mavjud feed’ga faqat mobil yangilanishni atomik qo‘shadi. To‘liq backend/web deploy bu ish uchun kerak emas.
7. Ommaviy HTTPS feed va APK’ni qayta yuklab, build, manba, imzo izi, hajm va to‘liq SHA-256 ni tekshiring. Eski desktop ma’lumotlarini solishtiring. Shundan keyingina “serverga chiqdi” deb belgilang.

Private imzolash kaliti APK bilan serverga uzatilmaydi. Android application ID va imzolash identity’si oldingi o‘rnatmaga mos qoladi. Yangi APK uchun imzolash kalitini yangidan yaratmang.

## Eski ilovada qanday eslatma chiqadi?

O‘rnatilgan APK rasmiy `https://ilbi.uz/downloads/releases.json` ro‘yxatini o‘qiydi. Android build `1` uchun shu mobil versiyadagi build `2` ham yangi yangilanish hisoblanadi.

- Hisobga kirilgan haqiqiy Android/iOS ilovasida ishlaydi. Brauzer va Expo Go o‘rnatilgan ILBI binary’si sifatida qabul qilinmaydi.
- Ilova faol holatga qaytganda va hisobga kirilganda ro‘yxat tekshiriladi; faol sessiyada odatda har 15 daqiqada qayta tekshiradi. “Yuklab olish → Yangilanish” ichida qo‘lda tekshirish ham bor.
- Yuqorida **“Ilovani yangilang”** va **“Yangilash”** tugmasi chiqadi. Eslatma hisob, o‘rnatilgan build, taklif qilingan build va Toshkent ish kuniga bog‘langan; yopilgan taklif o‘sha kuni takror bezovta qilmaydi.
- “Yangilash” rasmiy APK havolasini brauzerda ochadi. Android o‘rnatishni foydalanuvchi tasdig‘i bilan yakunlaydi. Sahifa ochilishining o‘zi o‘rnatish muvaffaqiyati emas.
- Bu ilova ichidagi eslatma. Telefonning tizim bildirishnomalari paneliga fon push yuborish alohida, hali ulanmagan imkoniyat.

O‘rnatilgan APK yangi commit chiqqan zahoti o‘z kodini avtomatik almashtirmaydi. Hozir EAS Update / `expo-updates` orqali OTA tarqatish ham sozlanmagan. Metro Fast Refresh development build uchun ishlaydi; u foydalanuvchilarga APK yangilanishini tarqatish bilan bir xil jarayon emas.

2026-10-26 chiqarishining aniq tekshiruvlari: [mobile UI release dalillari](../mobile-app/docs/MOBILE_UI_RELEASE_2026_10_26.md). Bunda egasining emulatori o‘zgartirilmaydi; eslatmani egasi o‘zi kuzatadi.

Rasmiy ma’lumot: [Android versiyalash](https://developer.android.com/studio/publish/versioning), [Expo SDK 58 versionCode](https://docs.expo.dev/versions/v58.0.0/config/app/#versioncode).
