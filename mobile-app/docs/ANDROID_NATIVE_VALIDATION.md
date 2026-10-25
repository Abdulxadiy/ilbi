# Installed Android validation — 2026-10-25

This is an actual CNG-generated debug APK, installed on a dedicated API 36 x86_64 emulator with KVM. The APK was generated from `de09805`; the runtime JavaScript includes the keyboard correction `a9ae2ee`. Mobile version `1.0.0`, Android build number `1` and platform version `1.4.0` remain unchanged. It is not a signed store release, an ARM device check or an iOS build.

APK SHA-256: `ed6d89d81a1089fd2aa3a72a826f1ddc8a69396bc469fad2379c2623c227de38`.

The APK/SDK/AVD/generated Android project remain outside Git under `/mnt/storage/.cache/ilbi-native-tools/`. The executable APK is `build/de09805/mobile-app/android/app/build/outputs/apk/debug/app-debug.apk`. CNG was invoked with `npx expo prebuild --platform android --no-install` in an isolated archive checkout, with the matching installed dependencies. No native project was handwritten.

Verified outcomes:

- Actual launch, approved logo/theme and five navigation tabs, at a 720×1280 Android display with density 320.
- Actual soft keyboard: change the current-sale price to 11,500, enter fractional quantity 0.125, restore quantity 2. The test exposed and fixed checkout's missing absolute keyboard offset. It now excludes touch targets under the Android IME region.
- A real app process stop/restart preserved the scoped negotiated cart draft.
- Explicit synthetic checkout confirmed 160,000 total against 200,000 received and displayed 40,000 change. Reading the actual native Expo SQLite database verified WAL, exactly one confirmed synthetic intent and no remaining sale lock. No real server financial operation was sent.
- Actual Expo Print produced a one-page, 32,061-byte temporary PDF. `pdfinfo` parsed it and `pdftotext` confirmed the total/cash/change. It currently uses Letter paper. Thermal formats, permanent saving and reopening after restart remain separate findings.
- Actual Android Sharing opened the OS chooser for that PDF; the chooser was canceled without selecting a recipient.
- Actual OS camera deny/grant dialogs, a visible virtual-camera preview and Android's active camera client registry. The client disappeared after backgrounding (1.99 seconds observed), returned on resume and disappeared after dismissal (1.45 seconds observed). This is emulator camera lifecycle evidence, not physical barcode decoding or an iOS claim.
- APK manifest inspection confirmed CAMERA permission and absence of RECORD_AUDIO. The barcode scanner uses a virtual scene, never a host webcam.

Evidence is in [evidence/android](evidence/android/), [android-native-regression.txt](evidence/android-native-regression.txt), [android-checkout-keyboard.png](evidence/android-checkout-keyboard.png) and [keyboard-browser.txt](evidence/keyboard-browser.txt). The last file records the full host/Chrome regression after the keyboard fix, including Fast Refresh, categories, product/variant lifecycle, exact lookup, persistent tabs, dark mode, negotiated pricing and synthetic checkout. Earlier Docker evidence remains valid for its named checkpoint; the host reboot stopped Docker, and daemon startup requires a system password unavailable to the agent. Later API checks ran against a fresh, separate user-owned PostgreSQL cluster on loopback, not a production database.

## Repeat the native input regression

Start the explicit synthetic Metro server in `mobile-app` with `EXPO_PUBLIC_DESIGN_PREVIEW=1 npm run dev:docker` (the script also runs directly on the host). Start a dedicated emulator, install the debug APK and configure `ANDROID_HOME`. Run `ILBI_ANDROID_TEST_SERIAL=emulator-5556 python tests/android.native.py`. Optional `ILBI_NATIVE_EVIDENCE_DIR` selects the screenshots/XML folder. The driver refuses physical-device serials and verifies the design-data banner before editing or checkout. An empty synthetic cart can be repopulated using the app's explicit test fixture control; pending financial records are never deleted to reset a run.

This machine's private emulator is `ILBI_PARITY_API_36` under `/mnt/storage/.cache/ilbi-native-tools/avd`. To open it as a visible phone window, set `ANDROID_HOME` to the SDK directory above and `ANDROID_AVD_HOME` to that AVD directory, then run `$ANDROID_HOME/emulator/emulator -avd ILBI_PARITY_API_36 -port 5556 -gpu swiftshader -memory 1024 -cores 2`. Run `adb -s emulator-5556 reverse tcp:8081 tcp:8081`, then `adb -s emulator-5556 shell am start -n uz.ilbi.mobile/.MainActivity`. Metro Fast Refresh updates the running native app. Only one instance of this AVD may run at once. The headless validation instance was stopped after testing.

## Build limits and remaining acceptance

The 768 MiB Gradle attempt failed in D8 with Java heap exhaustion. A host reboot interrupted the first larger attempt. The completed build used JDK 17, Gradle 9.4.1, one worker, x86_64 only, and `-Xmx1536m -XX:MaxMetaspaceSize=384m -XX:+UseSerialGC -XX:ActiveProcessorCount=2`, with in-process Kotlin compilation. The final build succeeded in four minutes. Failed/interrupted attempts are not passing evidence.

Development logs show a Reanimated dependency-list warning from navigation animation hooks. The native test closes the visible LogBox using its normal close button; the warning is not suppressed in application code. No native frame-rate, Reduce Motion or large-list performance claim is made. Physical Android/iOS, accessibility services, full large-text coverage, release signing, fiscal readiness, upstream dependency advisories and the remaining business parity items remain governed by the live audit.
