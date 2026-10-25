> Current implementation: [live parity ledger](docs/DESKTOP_MOBILE_PARITY_AUDIT.md). The mobile package is versioned separately from platform 1.4.0. Historical review documents describe the earlier prototype; consult the live ledger for implemented work and remaining native/server gates.

# ILBI mobile development

React Native + TypeScript, Expo SDK 58, Expo Router. Android and iOS share the feature code in `src/features/`. The app is a working UI prototype with partial API integration; it is **not ready for production acceptance**. Read [the review](docs/MOBILE_REVIEW.md) and [current progress](docs/MOBILE_PROGRESS.md) before continuing implementation.

Support opens from **Menyu → Qo‘llab-quvvatlash**, with the bottom navigation preserved. Guests can open it from login. Text conversations, consent, retry, history and close/reopen use the existing support API. See [support verification and remaining media/profile work](docs/SUPPORT_MOBILE_VALIDATION.md).

APK/iPhone builds: [O‘zbekcha batafsil yo‘riqnoma](docs/ILOVANI_YIGISH_UZ.md). EAS profiles are included, and `npm run build:apk:local` creates an isolated, owner-signed standalone Android APK. Native phone push notifications remain unimplemented; the guide distinguishes them from the existing in-app update reminder.

## Start the interactive phone preview in Docker

From the **repository root** (`ilbi/`):

```bash
docker compose --profile mobile up -d --build --no-deps mobile
```

Open **[http://localhost:8082/preview](http://localhost:8082/preview)**. It contains the actual React Native Web screens in an interactive phone frame. Select different screen sizes, click the app's controls, and save edits under `mobile-app/src/` to see Metro Fast Refresh. This command runs only the mobile service; it does not need a database or send real sales.

The default Docker mode is clearly labeled **DIZAYN PREVIEW**. Its records and transactions are synthetic. It cannot fall back to a real backend for an unsupported demo operation. Reloading resets the in-memory demo API, while the demo cart draft is stored in the browser. This preview is for layout and interaction checks, not durable accounting.

### Show it next to your code

In VS Code or Cursor, open the Command Palette, choose **Simple Browser: Show**, and enter `http://localhost:8082/preview`. Move the preview tab into the right editor group with **View: Split Editor Right**, or put a normal browser beside the IDE. Repository tasks **ILBI mobile: start preview**, **ILBI mobile: logs**, and **ILBI mobile: stop preview** are also available under **Tasks: Run Task**.

The phone frame is a browser preview, not an Android emulator or iPhone simulator. Native camera permissions, system PDF/share sheets, gesture behavior, keyboard interactions, secure storage, and device performance must be checked on actual native runtimes.

```bash
docker compose --profile mobile ps mobile
docker compose --profile mobile logs -f mobile
docker compose --profile mobile stop mobile
```

Metro uses port **8081**; the phone frame and same-origin API proxy use **8082**. The code bind mount enables live edits; the named `mobile_node_modules` volume keeps container dependencies separate from host dependencies. The entrypoint runs `npm ci` when manifests change. The image runs as the unprivileged `node` user. Ports bind to localhost by default. There is no production mobile image or APK/App Store release in this setup.

Change `MOBILE_METRO_PORT` or `MOBILE_PREVIEW_PORT` in the root `.env` if ports are occupied. If Metro's advertised port no longer matches, use the browser preview through the configured preview port; native discovery requires a matching reachable Metro address.

## Run against the local backend

Use a development/test database and set these variables in the root `.env`:

```dotenv
MOBILE_DESIGN_PREVIEW=0
```

Then run from the repository root:

```bash
docker compose --profile mobile up -d --build mobile
```

Without `--no-deps`, Compose starts Nginx and its backend/database dependencies. Browser calls to `/api/v1` go through the development proxy to Nginx. Log in with a test account. Existing backend configuration, permissions, OTP, and store selection still apply. All real-mode failures are errors, never a signal to substitute demo financial results. API calls exist but their complete contract and native flows still require verification; see the review.

`MOBILE_API_URL` overrides the public API base URL; it is not secret. Native code defaults to `https://ilbi.uz/api/v1` when no address is configured. Choose the intended test backend explicitly before signing in. Changing the server in Settings signs out first; that override lasts only for the current JavaScript runtime.

## Actual Android / iPhone development

Docker hosts Metro and the browser preview. The Android emulator runs on the host with Android Studio/SDK and hardware acceleration. An iOS simulator requires macOS/Xcode. Installed Android validation is recorded in [ANDROID_NATIVE_VALIDATION.md](docs/ANDROID_NATIVE_VALIDATION.md); its named checks do not imply physical-device or iOS acceptance.

For a host development session:

```bash
cd mobile-app
npm ci
# On a physical phone, use a reachable development machine LAN address, not localhost.
EXPO_PUBLIC_API_URL=http://192.168.1.50:8082/api/v1 npx expo start --lan
```

Stop the Docker mobile service first if it occupies 8081. Choose an Expo Go client compatible with SDK 58, or build a native development client when native modules require it. Install SDK packages with `npx expo install`, as required by [AGENTS.md](AGENTS.md). For an Android emulator use a reachable backend address such as `http://10.0.2.2:8082/api/v1`, subject to its networking and cleartext HTTP settings. Do not assume a browser pass proves a native pass.

To serve Metro from Docker to a phone on a trusted LAN, configure the root `.env` before recreating the container:

```dotenv
MOBILE_BIND_ADDRESS=0.0.0.0
MOBILE_DEV_HOST=192.168.1.50
MOBILE_API_URL=http://192.168.1.50:8082/api/v1
MOBILE_DESIGN_PREVIEW=1
```

Open `http://192.168.1.50:8081` using the appropriate Expo client. Both devices need access to the chosen host address and ports. The LAN option is not a public hosting configuration. Native connectivity has not been verified on a phone in this session.

Official references: [Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/), [Expo Router](https://docs.expo.dev/router/introduction/), [Fast Refresh](https://reactnative.dev/docs/fast-refresh), [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/), [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/).

## Checks and source map

```bash
cd mobile-app
npm run typecheck
npm run lint
npm test
# Requires the Docker preview above and Chrome/Chromium on the host:
npm run test:preview
```

The browser test uses the repository's existing Chrome driver, opens the actual app in the phone frame, checks price editing, synthetic checkout/change, saved receipt and navigation, and temporarily changes a Home label to verify live refresh, then restores it. Avoid editing that label while the test runs. Evidence goes into `docs/evidence/`; browser screenshots are not native acceptance evidence.

| Path | Purpose |
| --- | --- |
| `src/app/` | Expo Router route files and layouts |
| `src/features/` | Shared mobile screens, auth, cart and checkout logic |
| `src/api/` | API, secure storage and durable retry identity |
| `src/dev/preview.ts` | Explicit development-only synthetic API |
| `src/components/`, `src/theme/` | Brand, UI components and monochrome themes |
| `scripts/dev-server.mjs`, `preview/index.html` | Metro proxy, health check and interactive phone frame |
| `docs/MOBILE_REVIEW.md` | Verified findings, corrections and remaining work |
| `../branding/mobile-concepts/README.md` | Design handoff entry point and v1–v4 reference map |

Financial offline replay is deliberately disabled until account/store isolation and reconciliation are implemented and verified. Legacy queue records are retained. Pending retry identities and cart drafts are not disposable cache. Do not clear them to work around an uncertain transaction result.

The native regression at `tests/android.native.py` drives an installed debug APK on a dedicated Android emulator using ADB. It requires an explicit design-preview Metro server (`EXPO_PUBLIC_DESIGN_PREVIEW=1`), `ANDROID_HOME`, an installed `uz.ilbi.mobile` APK and `ILBI_ANDROID_TEST_SERIAL` (default `emulator-5556`). It refuses physical-device serials and checks the synthetic-data banner before editing or checkout. Run it with `python tests/android.native.py`; optional `ILBI_NATIVE_EVIDENCE_DIR` controls screenshots/XML output. APKs, SDKs, AVDs and generated native projects stay outside Git. Build generation must use Expo CNG, never handwritten `android/` or `ios/` directories.
