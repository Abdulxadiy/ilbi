# Lightsail serverini boshqarish

2026-10-23 holati: Ubuntu 24.04, 4 GB RAM, 2 GB swap. Ilova `/srv/ilbi`da.
Backend, frontend, PostgreSQL, Redis, Celery worker/beat va Telegram bot ishga tushirilgan.
Eski baza va media ko‘chirilmagan. Asosiy production domeni **`ilbi.uz`**.
Backend va frontendning asosiy manzili serverdagi `.env.production`ning `PUBLIC_HOST`
qiymatidan olinadi. Faqat shu aniq production domeni ruxsat etilgan.

2026-10-23 tekshiruvida `https://ilbi.uz/` haqiqiy TLS tekshiruvi bilan HTTP 200 qaytardi.
Sertifikat faqat asosiy domenni qamrab oladi.
Frontend ommaviy 80/443 portlarida ishlayapti; backend readiness `ready`.

Boshlang‘ich o‘rnatma `1.0.0` edi. Avtodeploy GHCR’dagi `sha-<commit>` imagelarini ishlatadi;
oxirgi sog‘lom chiqarishning uchta image manzili `/srv/ilbi/.deployed-images`da saqlanadi.
2026-10-23 domen o‘tishida backend production sozlamasi va Nginx konfiguratsiyasi
shu amaldagi GHCR imagelari ustiga kichik mahalliy qatlam qilib qo‘llandi:
`ilbi-domain-backend:20261023` va `ilbi-domain-frontend:20261023-hardened`.
Domen o‘tishi uchun `1.3.6` desktop/server chiqarishi tayyorlandi. Keyingi standart CD
chiqarishi ushbu manba sozlamalarini ham o‘z ichiga olishi kerak.
Versiya va o‘zbekcha release notes manbada boshqariladi. Main uchun CI Windows/Linux
paketlarini mahalliy operatsion tizimlarda tekshiradi; CD sog‘lom ilovadan keyin paketlar,
versiya tagi va GitHub Release’ni nashr qiladi.

## SSH va holat

Arch terminalidan mavjud SSH kalitingiz bilan `ubuntu@3.106.193.2`ga ulaning.
Bir nechta SSH kaliti agentga qo‘shilgan bo‘lsa, `ssh -o IdentitiesOnly=yes -i KALIT_YOLI ubuntu@3.106.193.2` ishlating.
Server ichida:

```bash
cd /srv/ilbi
./ops/compose.sh ps
./ops/compose.sh exec -T --interactive=false ilbi python -B healthcheck.py
./ops/compose.sh logs --tail 100 ilbi
```

Main avtomatik deploy jarayoni Compose faylini almashtirishdan oldin `ops/prepare_backend_layout.py /srv/ilbi --apply`ni bajaradi. U eski `/srv/ilbi/ilbi/.env.production` faylidan `/srv/ilbi/backend/.env.production`ga aynan nusxa oladi, yangi faylni600 ruxsatida saqlaydi va eski nusxani saqlab qoladi. Faqat mavjud yopiq fayllar o‘qiladi; symbolic link, ochiq ruxsat yoki ikki xil mavjud konfiguratsiya bo‘lsa, fayllarni o‘zgartirmasdan to‘xtaydi. Takroriy deploy bir xil nusxani qayta yozmaydi. `--apply`siz buyruq faqat holatni tekshiradi. Compose servis nomlari va ma’lumotlar volume’lari saqlanadi. `docker-compose.mobile-push.yml` oldin alohida faollashtirilgan bo‘lsa, `ops/compose.sh` uni keyingi deploylarda ham qo‘llaydi; bu ish pushni o‘z-o‘zidan yoqmaydi.

Maxfiy fayllar: `.env.production`, `backend/.env.production`, `telegram_bot_sms/.env.production`.
Ularning mazmunini Git, issue yoki chatga yubormang. Parollar yangi yaratilgan;
mavjud Telegram bot va SMTP ulanishi saqlangan.

## Birinchi administrator

Serverdagi interaktiv SSH terminalida:

```bash
cd /srv/ilbi
./ops/compose.sh exec ilbi python manage.py createsuperuser
```

O‘zingizning shaxsiy Telegram chat ID, telefon raqami, username va kuchli parolni kiriting.
`@ilbi_bot`ga `/start` yuboring. Parolni chat yoki buyruq qatori argumentiga yozmang.
Production demo login o‘chiq. 2026-10-20 tekshiruvida administrator mavjudligi tasdiqlandi;
shu serverda uni qayta yaratish kerak emas. Haqiqiy 2FA login DNS/HTTPS yoqilgach operator tomonidan tekshiriladi.
Yo‘l `./ops/compose.sh` — `./ops.compose.sh` emas.

## Xavfsizlik tekshiruvi

2026-10-19 tekshiruvida:

- Tashqaridan faqat SSH porti ochiq topildi; 5432, 6379, 8000 va Docker API portlariga ulanish bo‘lmadi.
  Domen ishga tushguncha 80/443 faqat loopback’da qoladi.
- UFW yoqildi: kiruvchi ulanishlar odatda rad etiladi, 22/80/443ga ruxsat bor; IPv6 qoidalari ham mavjud.
  [Docker e’lon qilgan portlar UFW’ni chetlab o‘tishi mumkin](https://docs.docker.com/engine/network/packet-filtering-firewalls/), shuning uchun Compose’da faqat frontend
  portlari e’lon qilinadi va bu chegara test bilan tekshiriladi.
- SSH’da root, parol, keyboard-interactive, agent forwarding va X11 o‘chirildi.
  Local forwarding saqlangan. Sozlama: `ssh-hardening.conf` → `/etc/ssh/sshd_config.d/00-ilbi-hardening.conf`.
- Maxfiy `.env` va backup kalitlari `600`, kalit/backup kataloglari `700`.
- Barcha faol xizmatlarda `no-new-privileges` bor; backend, Celery va botda barcha Linux capabilities olib tashlangan.
  Backend/Celery UID `1000`, bot UID `10001` bilan ishlaydi. Media/static va docs shu UIDga yozishga moslangan;
  Celery beat jadvali alohida `celery_beat_data` volume’da saqlanadi.
- OS security yangilanishlari o‘rnatildi; avtomatik reboot o‘chirilgan. Kernel yangilanishlari operator rebootini talab qiladi.
  Shu tekshiruvda server kernel `7.0.0-1014-aws` bilan qayta yuklandi: xizmatlar avtomatik qaytdi,
  readiness, HTTPSning yopiq tekshiruvi, SSH va UFW qayta tasdiqlandi. Pending reboot qolmadi.
- Botdagi `multidict` 6.7.1 → 6.9.1 va `urllib3` 2.7.0 → 2.8.0 yangilandi:
  auditda topilgan to‘rtta advisory bartaraf etildi. Backendning 55 va botning 21 runtime paketi,
  frontendning production dependency auditi yakunida ma’lum advisory qolmadi.
- Login/OTP, tenant ruxsatlari, media va ichki servis bo‘yicha 79 ta test o‘tdi.
  HTTPS aktivatsiyasi sertifikatni avval yopiq ulanishda tekshiradi; xatoda ommaviy binding bekor qilinadi.
  Botning kontakt xavfsizligi uchun 13 ta test ham o‘tdi.
- Ko‘rilgan dastlabki real servis loglarida ERROR/CRITICAL topilmadi, konteynerlarning restart soni 0 edi.

Bu natija tekshirilgan konfiguratsiya, testlar va shu kundagi advisory bazasiga tegishli.
Internetdan HTTPS tekshirildi. Haqiqiy administrator/2FA oqimi operator tomonidan tekshiriladi.
Kunlik avtomatik data backup, muntazam tashqi nusxa va xatolik/sertifikat alertlari hali yoqilmagan.

## Domen almashtirish va HTTPS

`ilbi.uz` hozir ommaviy HTTPS bilan ishlaydi. Quyidagi tartib yangi domenni ulash uchun qo‘llanadi.
Yangi sertifikat ommaviy bindingdan oldin yopiq HTTPS ulanishida tekshiriladi.

1. Lightsail **Networking**da Static IPv4 biriktirilganini tekshiring. Hozirgi IP `3.106.193.2`.
   Yangi Static IP boshqacha bo‘lsa, `.env.production`dagi `EXPECTED_PUBLIC_IPV4` va GitHub
   production muhitidagi `DEPLOY_HOST`ni ham yangilang.
2. `ilbi.uz` DNS panelida (Ahost, `rdns1.ahost.uz`, `rdns2.ahost.uz`, `rdns3.ahost.uz`) quyidagi yozuv bo‘lsin:

| Type | Host/Name | Value | TTL |
| --- | --- | --- | --- |
| A | `@` | `3.106.193.2` | `300` yoki panel defaulti |

   Static IP o‘zgargan bo‘lsa, Value uchun yangi IP ishlatiladi.
   Ishlamaydigan AAAA yozuvi qolmasin; domen NS delegatsiyasi ham ishlashi kerak.
   `www` hozir alohida sozlanmagan.
3. Lightsail firewall’da TCP **80** va **443**ni oching.
4. DNS tarqalishini serverdagi `dig` bilan tekshiring:

```bash
dig +short @1.1.1.1 A ilbi.uz
dig +short @1.1.1.1 AAAA ilbi.uz
```

A javobi yakuniy Static IPv4 bo‘lsin. IPv6 frontend hali yoqilmagani uchun AAAA javobi bo‘sh bo‘lishi kerak.
5. DNS tayyor bo‘lgach, serverda:

```bash
cd /srv/ilbi
./ops/enable_https.sh
```

Skript DNSni tekshiradi, Let's Encrypt sertifikatini oladi va frontendni ommaviy portlarga chiqaradi.
Sertifikatning ishonch zanjiri va domeni avval private frontend orqali tekshiriladi.
DNS, sertifikat yoki yakuniy HTTPS xatosida dastlabki binding tiklanadi.
Certbot timer va pre/deploy/post hook’lar keyingi yangilanishlarni bajaradi.
Standalone tekshiruv vaqtida frontend qisqa muddat to‘xtaydi; boshqa xizmatlar ishlashda qoladi.
Let's Encrypt sertifikati olingach, avtomatik yangilanishni tekshiring:

```bash
sudo certbot renew --dry-run
systemctl status certbot.timer --no-pager
curl -I https://ilbi.uz
```

`.env.production`da `PUBLIC_HOST=ilbi.uz` belgilangan. `enable_https.sh` yangi sertifikatni
olib, backend, Celery va frontendning domen sozlamalarini birga yangilaydi.
Alias ishlatilmaydi; HTTPS va CSRF faqat `ilbi.uz` uchun sozlangan.

### ilbi.uz va Resend uchun o‘tish shartlari

2026-10-23 kuni NS delegatsiyasi hamda A, DKIM, DMARC va Resend CNAME yozuvlari
ommaviy DNS’da tasdiqlandi. Operator Resend’da domen Verified ekanini bildirdi.
Resend SMTP orqali `ILBI <noreply@ilbi.uz>`dan bitta haqiqiy sinov xati yuborildi;
operator xat yetib kelganini tasdiqladi. Shu yuboruvchi backend va Celery uchun saqlandi.

Ahost DNS yozuvlari:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `3.106.193.2` |
| TXT | `resend._domainkey` | Resend bergan to‘liq DKIM qiymati |
| TXT | `_dmarc` | `v=DMARC1; p=none;` |

`send` va `rsend` CNAME yozuvlari Resend’ning aynan shu domen uchun ko‘rsatgan
qiymatlarida saqlanadi. Oldindan noma’lum bo‘lgan o‘chirilgan MX/TXT/CNAME yozuvlari
taxmin bilan tiklanmaydi; pochta qabul qilish ishlatilsa, uning provayderi yozuvlari alohida tekshiriladi.

`backend/.env.production`da `DEFAULT_FROM_EMAIL="ILBI <noreply@ilbi.uz>"` belgilangan.
Mavjud SMTP host `smtp.resend.com`, port `587`, username `resend`, STARTTLS va kalit
saqlanadi. Email havolalari Compose’dagi `PUBLIC_HOST` orqali hosil bo‘ladi;
backend bilan birga Celery worker va beat ham qayta yaratilishi kerak.

Desktop va backend rasmiy serveri `https://ilbi.uz` bilan qat’iy belgilangan.
Oldingi rasmiy versiyaning shifrlangan sozlamasi faqat mahalliy tarzda yangi manzilga
ko‘chiriladi; eski serverga so‘rov yuborilmaydi va eski manzil tarmoq uchun ruxsat etilmaydi.
Eski paket o‘rniga yangi `1.3.6` paketini `https://ilbi.uz/download` orqali o‘rnating.
Qurilma ma’lumotlar papkasi, kalitlari va `device.vault` faylini o‘chirmang.

2026-10-23 qo‘shimcha xavfsizlik tekshiruvi:

- Nginx `.env`, `.git` va boshqa yashirin yo‘llarni, jumladan `/downloads/` ichida ham 404 bilan rad etadi;
  mavjud sintetik maxfiy fayllar bilan alohida TLS sinovi o‘tdi. Nginx versiyasi javobdan olib tashlandi.
- Asosiy domen uchun HTTPS, login/download sahifalari, autentifikatsiyasiz API 401,
  ichki servis API 403 va texnik schema 404 tashqi ulanish orqali tasdiqlandi.
- Begona Host rad etiladi; begona Origin uchun CORS ruxsati berilmaydi.
  HTTP faqat doimiy `https://ilbi.uz` manziliga yo‘naltiriladi.
- Tashqaridan 22/80/443 ochiq; 5432/6379/8000/9000/9001/2375/2376ga ulanish bo‘lmadi.
  SSH root, password, keyboard-interactive, agent va X11 forwarding o‘chiq.
- HTTPS/proxy/aktivatsiya va production sozlamalari testlari o‘tdi.
  Login/API rate-limit, parallel workerlar va soxta headerlar bo‘yicha yana 9 ta test o‘tdi.
  Backend, desktop va bot uchun locklangan Python dependency auditi hamda frontend production
  npm auditi ma’lum zaiflik topmadi.
- Django deployment tekshiruvida ERROR yo‘q. HSTS includeSubDomains va preload barcha
  subdomenlar uchun alohida qaror talab qilgani sababli yoqilmadi.
- `certbot renew --cert-name ilbi.uz --dry-run` muvaffaqiyatli o‘tdi;
  pre/post hook’lar frontendni to‘xtatib, sog‘lom holatda qayta ishga tushirdi. Certbot timer enabled/active.

## Zaxira va tiklash

Qo‘lda yoki CD yangilanishidan oldin:

```bash
cd /srv/ilbi
./ops/backup.sh
```

Bu yozuvchi xizmatlarni qisqa muddat to‘xtatib, DB, mahalliy media va hujjatlarni shifrlaydi;
oldin ishlagan xizmatlar xatoda ham qayta yoqiladi. PostgreSQL va Redis to‘xtatilmaydi.
Backup/deploy parallel ishlashiga `.operations.lock` yo‘l qo‘ymaydi.

- Serverdagi arxivlar: `/srv/ilbi-backups/`, faqat egasiga ochiq.
- Serverdagi sozlama va kalit: `/etc/ilbi-backup/`, faqat egasiga ochiq.
- Arch’dagi nusxalar: `~/.local/share/ilbi-production/backups/`.
- Arch’dagi kalit: `~/.local/share/ilbi-production/keys/data-backup.passphrase`.
- Arch’dagi maxfiy sozlamalar nusxasi: `~/.local/share/ilbi-production/secrets/`.

Birinchi arxiv serverdan Arch’ga ko‘chirildi. Keyingi nusxalar uchun tashqi uzatish va kunlik jadval
hali yoqilmagan; CD har yangilanishdan oldin serverda nusxa oladi. Eski arxivlar avtomatik o‘chirilmaydi.
Server diski yo‘qolishidan himoya qilish uchun yangi arxivlarni ham boshqa qurilmaga ko‘chiring.
Kalitni arxiv bilan birga ommaviy joyga yuklamang.

To‘liq tiklash yo‘riqnomasi: [DATA_BACKUP_RESTORE_UZ.md](../docs/DATA_BACKUP_RESTORE_UZ.md).
2026-10-19 dagi dastlabki arxiv tekshirildi va alohida, tarmoqsiz PostgreSQL konteyneriga tiklandi;
sxema va bo‘sh foydalanuvchilar bazasi tasdiqlandi, sinov resurslari tozalandi.

## CI/CD holati

CI backend va frontend testlariga qo‘shimcha ravishda HTTPS chegarasi, aktivatsiya xatolari
va backupdan keyingi qayta ishga tushirishni tekshiradi.

`deploy.yml` muvaffaqiyatli **main CI** natijasidan keyin uchta `linux/amd64` production imagelarini
GitHub’da yig‘ib, GHCR’ga `sha-<commit>` bilan joylaydi. Serverda pull → shifrlangan backup →
migratsiya/start → healthcheck bajariladi. Serverda har safar build qilish talab etilmaydi.
Ilova ichida tahrirlanadigan `docs/` CD orqali ustidan yozilmaydi.

GitHub’da `production` muhiti va maxsus SSH kaliti sozlangan:

- Secrets: `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`.
- Muhit variables: `DEPLOY_HOST`, `DEPLOY_USER`.
- Repo variable: **`DEPLOY_ENABLED=true`** — avtomatik deploy yoqilgan.

Lokal saqlash GitHub’ga avtomatik yuborilmaydi. Tayyor kodni main’ga push qilish CI’ni boshlaydi; kunlik chiqarish navbati yo‘q. Boshqarish: [automation/README.md](../automation/README.md).
CI Windows runner’da paketni yig‘adi, o‘rnatib ichki servisni tekshiradi va o‘chirib ko‘radi.
Deploy shu CI artifactidagi installer hajmi/SHA256/native sinovini tekshiradi,
installer faylini `/srv/ilbi/desktop/downloads/<commit>/`ga yuboradi.
Ilova healthcheck’i o‘tgach release feed atomik yangilanadi. Oxirgi uch installer
saqlanadi; oldingi havolalar navbatdagi yangilanish vaqtida buzilmaydi.
GitHub’dagi eski Windows artifactlari deploydan keyin tozalanadi, qolganlari 1 kun saqlanadi.
Backend/frontend imagelari ham aynan shu commitdan yig‘iladi.
PR va muvaffaqiyatsiz CI serverni yangilamaydi. Tag yoki GitHub Release deploy triggeri emas.
Docker builddan oldin ham, serverga o‘tishdan oldin ham commit hali main ekanligi tekshiriladi;
kech tugagan eski CI yangi chiqarishning ustidan yozmaydi.
Favqulodda to‘xtatish: repo variable `DEPLOY_ENABLED=false`.

Image yuklashda ishlatiladigan GHCR token serverga stdin orqali uzatiladi;
vaqtinchalik Docker credential katalogi SSH sessiyasi tugaganda o‘chiriladi.
Deploy SSH kaliti shaxsiy EC2 kalitidan alohida; serverdagi yozuvga `restrict` qo‘yilgan.

Yangilanish xatoda qolsa, `.env.production.previous` va backup saqlanadi.
Avtomatik schema rollback bajarilmaydi: migratsiya mosligini tekshirib, avvalgi image yoki ajratilgan
tiklash nusxasi orqali operator qaror qiladi. `down -v` va umumiy `docker system prune --volumes` ishlatmang.

## Tekshirilgan imkoniyat chegarasi

Yuklamasiz xizmatlar taxminan 700 MB RAM ishlatdi. Bu ko‘p foydalanuvchidagi tezlik kafolati emas.
Haqiqiy admin/2FA, email yetkazilishi va biznes oqimlari alohida sinovdan o‘tkaziladi.
Koddagi mavjud retail POS production cheklovi saqlangan: fiskal integratsiya tayyor bo‘lmaguncha
haqiqiy retail savdo bloklanadi. Serverni joylash bu cheklovni olib tashlamaydi.
