# ILBI ilovasini o‘zingiz yig‘ish: Android APK va iPhone

Android Studio majburiy emas. Android uchun APK’ni Expo EAS serverida yoki o‘z kompyuteringizda terminal orqali yig‘ishingiz mumkin. iPhone uchun EAS ishlatsangiz, Linux/Windows kompyuteringizdan ham build yuborasiz; mahalliy iOS build va iPhone simulatori uchun macOS hamda Xcode kerak.

Ushbu loyiha Expo SDK 58 va React Native’dan foydalanadi. Loyiha papkasi:

```bash
cd /mnt/storage/Codes/Projects/Backend/ilbi/mobile-app
npm ci
```

Bu buyruqlarni `ilbi/` yoki eski `Sales-Platform/` papkasidan emas, aynan `mobile-app/` ichidan bajaring.

## 1. Android APK — Android Studio’siz, Expo serverida

Kompyuterda Node.js 22.13+/24.3+/26, npm, internet va Expo akkaunti bo‘lishi yetarli. Android SDK/Android Studio bu usul uchun kerak emas. APK’ni o‘zingizning telefoningizga o‘rnatish uchun Google Play akkaunti ham shart emas. Yig‘ishni Expo serveri bajaradi. [Expo APK qo‘llanmasi](https://docs.expo.dev/build-reference/apk/).

Bir marta Expo akkauntingizga kiring va loyihani ulang:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
```

`init` loyihangizga haqiqiy EAS project ID’ni yozadi. O‘zingizga tegishli Expo akkaunti/tashkilotini tanlang. Bu platforma versiyasini yangilamaydi. Hozir bu loyihada sizning Expo akkauntingizga bog‘lash bajarilmagan; men sizning nomingizdan Expo/Apple akkauntiga kirmadim.

Android’ning doimiy imzolash kaliti ushbu kompyuterda tayyorlangan. EAS uchun mahalliy credential faylini yarating:

```bash
npm run prepare:signing
```

Keyin APK yig‘ing:

```bash
npx eas-cli@latest build --platform android --profile apk
```

Tugagach terminalda APK yuklab olish havolasi chiqadi. Uni telefonda ochib APK’ni yuklab oling va o‘rnating. Android brauzerga o‘rnatish ruxsatini so‘rasa, o‘sha tizim oynasidagi ko‘rsatmaga amal qiling. Bu mustaqil build: keyin Metro serverini ochiq saqlash talab qilinmaydi.

`eas.json` ichidagi `apk` profili **APK**, `play-store` esa **AAB** chiqaradi. AAB Google Play uchun; uni APK singari to‘g‘ridan-to‘g‘ri bosib telefonga o‘rnata olmaysiz.

```bash
# Google Play’ga topshiriladigan paket kerak bo‘lsa:
npx eas-cli@latest build --platform android --profile play-store
```

## 2. Android APK — shu kompyuteringizda, terminalda

Mahalliy yig‘ish uchun Java, Android SDK, build-tools, platform/NDK va Node.js kerak. Android Studio ularni o‘rnatishning qulay usuli; SDK’ni terminaldan o‘rnatsangiz ham bo‘ladi. Ushbu kompyuterda kerakli SDK va Java 17 tayyorlangan. Android emulatori build uchun shart emas; u ilovani sinash uchun kerak.

Tayyor buyruq:

```bash
npm run build:apk:local
```

Skript quyidagilarni bajaradi:

1. Manba kodning nusxasidan alohida ish papkasida Expo CNG orqali Android loyihasini yaratadi.
2. JavaScript’ni ichiga joylab, mustaqil release APK yig‘adi.
3. APK’ni sizning mavjud doimiy kalitingiz bilan imzolaydi.
4. Ilova ID’si, versiya/build, imzo, `debuggable` holati va APK alignment’ini tekshiradi.
5. Natijani `mobile-app/dist/android/` ichiga yozadi.

Natija:

```text
dist/android/ILBI-1.0.0-android-1.apk
dist/android/android-build-manifest.json
```

Asosiy repozitoriydagi `android/` yoki `ios/` fayllarini qo‘lda yozish/o‘zgartirish talab qilinmaydi. Skript mavjud savat, hisob yoki telefon ma’lumotlarini o‘chirmaydi. U qurilmaga avtomatik o‘rnatmaydi va serverga paket jo‘natmaydi.

Boshqa kompyuterda SDK/JDK joylashuvi boshqacha bo‘lsa:

```bash
npm run build:apk:local -- --android-sdk /path/to/Android/Sdk --jdk /path/to/jdk-17
```

Standart APK `arm64-v8a` va `x86_64` uchun yig‘iladi. Faqat zamonaviy ARM64 telefon uchun kichikroq APK kerak bo‘lsa:

```bash
npm run build:apk:local -- --architectures arm64-v8a
```

Birinchi build Gradle/SDK komponentlarini yuklashi mumkin. Faqat debug APK yaratib, uni yakuniy o‘rnatuvchi deb tarqatmang: u Metro’ga bog‘liq bo‘lishi yoki boshqa imzolash kalitidan foydalanishi mumkin. Tayyor skript bu holatni tekshiradi.

## 3. Imzolash kaliti — keyingi yangilanishlar uchun

Siz Android ilovasini hali tarqatmaganingizni tasdiqladingiz. Shu sabab birinchi doimiy kalit yaratildi. Ushbu kompyuterda:

```text
/home/abdulxadiy/.local/share/ilbi-signing/mobile/ilbi-mobile-release.p12
/home/abdulxadiy/.local/share/ilbi-signing/mobile/signing-credentials.json
```

Bu papka faqat egasiga ochiq; kalit va parol fayli Git’dan tashqarida. Parollar terminalga chiqarilmaydi. `prepare:signing` kerakli ma’lumotni mahalliy `credentials.json` ga yozadi; u ham Git’dan chiqarilgan va `0600` ruxsati bilan yaratiladi. [Expo mahalliy credentials hujjati](https://docs.expo.dev/app-signing/local-credentials/).

**Ikkala faylni xavfsiz joyga zaxiralang.** Boshqa kompyuterda ham yangi kalit yaratish o‘rniga shu kalitni tiklang. APK tarqatilgandan keyin keyingi paketlar aynan shu imzolash identity’si bilan chiqishi kerak. `credentials.json`, `.p12` va parol faylini commit/push qilmang.

## 4. iPhone uchun yig‘ish

iPhone APK o‘rnatmaydi; unga Apple tomonidan imzolangan iOS paketi kerak. iOS build’ni EAS bulutda bajarishi mumkin, shuning uchun bu usulda o‘z kompyuteringiz Mac bo‘lishi shart emas. Haqiqiy iPhone uchun distributsiya sertifikati/provisioning va Apple Developer akkaunti talab qilinadi. [Expo iOS build hujjati](https://docs.expo.dev/build/setup/).

### O‘z iPhone’ingizda sinash

Expo loyihasini yuqoridagi `login` va `init` bilan ulaganingizdan keyin:

```bash
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile ios-test
```

`device:create` iPhone’ni ro‘yxatdan o‘tkazish bo‘yicha havola beradi. Uni o‘sha iPhone’da ochib ko‘rsatmalarni bajaring. EAS Apple akkauntingiz va signing/provisioning bo‘yicha so‘raydi. Bu ichki sinov build’i ro‘yxatga kiritilgan qurilmalarda ishlaydi; oddiy IPA faylini istalgan iPhone’ga nusxalash yetarli emas. [Haqiqiy iOS qurilmasini ro‘yxatdan o‘tkazish](https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/).

### TestFlight yoki App Store

```bash
npx eas-cli@latest build --platform ios --profile ios-store
npx eas-cli@latest submit --platform ios --profile ios-store --latest
```

Apple akkaunti/App Store Connect va kerakli ruxsatlarni o‘zingiz taqdim etasiz. Build’ni topshirish va uni App Store’da hammaga chiqarish alohida bosqichlar; TestFlight qayta ishlashi va App Store tekshiruvi ham bor. [Expo iOS submit hujjati](https://docs.expo.dev/submit/ios/).

Mac’da simulator uchun alohida profil ham tayyor:

```bash
npx eas-cli@latest build --platform ios --profile ios-simulator
```

Simulator build’i haqiqiy iPhone uchun mo‘ljallanmagan. Linux’dagi Android emulatori iPhone simulatorining o‘rnini bosmaydi. Bu sessiyada iOS build, Apple sertifikati va haqiqiy iPhone tekshiruvi bajarilmadi.

## 5. Versiya va yangilanishlar

Hozir platforma `1.4.0`, mobil ilova `1.0.0`, Android `versionCode: 1`, iOS `buildNumber: "1"`. EAS profillari versiyani avtomatik ko‘tarmaydi.

Keyingi mobil paketni tarqatishda Android `versionCode`’ni va kerak bo‘lsa iOS `buildNumber`’ni oldingidan oshiring. Masalan, mobil versiya `1.0.0` bo‘lib qolgan holda native build `2` bo‘lishi mumkin. Bu butun platformaning ichki tizimini yangi versiyaga ko‘tarish degani emas. Google/Apple’ga yangi build topshirishda bir xil native build raqamini qayta ishlatmang.

Yangi rasmiy paket feed’da paydo bo‘lganda eski o‘rnatilgan build’dagi foydalanuvchi har kuni birinchi kirishda yangilash eslatmasini oladi. Bugunga yopilgan eslatma o‘sha kuni takrorlanmaydi. “Yangilash” Android’da rasmiy yuklama/Google Play’ni, iPhone’da App Store/TestFlight’ni ochadi. O‘rnatishni operatsion tizimning o‘zi yakunlaydi.

## 6. Telefon bildirishnomalari qanday ishlaydi?

Ilova ikki xil tizim bildirishnomasi bilan ishlashi mumkin:

| Tur | Kim boshlaydi | Misol |
| --- | --- | --- |
| Mahalliy bildirishnoma | Ilova telefonda oldindan belgilaydi; vaqti kelganda OS ko‘rsatadi | Qarz to‘lov sanasi yoki eslatma |
| Push bildirishnoma | Server Expo Push/Android FCM/iOS APNs orqali yuboradi | Operator javobi, boshqa kassadagi yangi savdo |

Mahalliy eslatma uchun har safar serverga murojaat qilish shart emas. Serverdagi yangi hodisani ilova yopiq paytda yetkazish uchun push infratuzilmasi kerak. Foydalanuvchi ruxsati, OS sozlamalari va tarmoq yetkazishga ta’sir qiladi; ilova JavaScript’i yopiq holatda doim ishlab turadi deb hisoblanmaydi. [Expo Notifications SDK 58](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/) va [bildirishnomalar ishlash tartibi](https://docs.expo.dev/push-notifications/what-you-need-to-know/).

**Joriy ILBI holati:** `expo-notifications`, telefon push-token ro‘yxati va Android/iOS push credential’lari hali ulanmagan. Bosh sahifadagi qo‘ng‘iroq tugmasi ham hozir faol emas. Yangilanish eslatmasi hozir ilova ichida chiqadi; telefonning bildirishnomalar paneliga yuborish alohida qolgan ish. Demak, imkoniyat bor, ammo bu build’da tayyor telefon push tizimi bor deb hisoblamang. DMP-060 auditda ochiq qoladi.

Push qo‘shilganda development/standalone native build bilan tekshiriladi. Expo Go Android’da remote push’ni sinash uchun yetarli emas. Tokenlar foydalanuvchi/qurilmaga bog‘lanishi va hisobdan chiqqanda oldingi hisobga tegishli xabarlarni yetkazmasligi kerak; FCM/APNs server kalitlari mobil kod ichiga joylanmaydi.

## 7. Build oldidan va keyin

```bash
npm run typecheck
npx eslint . --max-warnings 0
npm test -- --silent
```

APK’ni o‘zingiz o‘rnating va kirish, savat, klaviatura, hujjat/chek, sidebar, yordam va yangilanish oynalarini tekshiring. APK yig‘ilganining o‘zi barcha biznes modullari tugaganini bildirmaydi. Joriy ilova sinov bosqichida; bajarilgan tekshiruvlar va qolgan ishlar [parity audit](DESKTOP_MOBILE_PARITY_AUDIT.md), [Android tekshiruvi](ANDROID_NATIVE_VALIDATION.md) va [yordam tekshiruvi](SUPPORT_MOBILE_VALIDATION.md) ichida yozilgan.
