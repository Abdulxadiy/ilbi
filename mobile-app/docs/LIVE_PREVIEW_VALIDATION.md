# Interactive computer preview — 2026-10-25

The owner wants to inspect and improve the mobile design live on the computer after trying the APK. This setup does not claim to resolve the design or remaining business parity findings.

## Start and use

- Host Metro and the phone-frame proxy: VS Code/Cursor **Tasks: Run Task → ILBI mobile: live preview (computer)**. No Docker daemon is required. The equivalent command is in the mobile README.
- Browser phone: `http://localhost:8082/preview`. Use **Simple Browser: Show** in VS Code/Cursor and split the editor to keep it beside the code, or open it in a normal browser.
- Native Android: the dedicated `ILBI_PARITY_API_36` AVD, visible window, installed debug app `uz.ilbi.mobile`, emulator port 5556. Existing AVD data is retained. Launch details are in `ANDROID_NATIVE_VALIDATION.md`.
- Both surfaces use the current application source through Metro and explicitly labeled synthetic data. `EXPO_PUBLIC_DESIGN_PREVIEW=1`, fake update offer disabled. Do not confuse these records with actual shop accounting.
- Save a React screen/style file to refresh the running app. Keep the preview process active. A standalone release APK continues using its embedded bundle; native module/configuration changes require a new native build.

## Session evidence

Runtime results are recorded in `evidence/live-preview/session.txt`. The scope is actual Android launch, click navigation and live source refresh, alongside the browser phone frame. Screenshots capture the restored normal source. No production login, sale, payment or support message is required for this setup. Existing saved carts/journals must not be cleared to prepare a preview.

The actual session passed Home → Sales → Home navigation on Android, browser sidebar navigation with five business tabs, a temporary Home label change through Fast Refresh on both surfaces, and restoration of the original source. Browser errors and the current Android process's ReactNativeJS/AndroidRuntime error logs were empty. TypeScript, strict ESLint, the parsed IDE task's launch path/synthetic flags and `git diff --check` also passed. Platform version verification remains `1.4.0`.

The IDE task changes the launch workflow only. Application runtime, dependencies, signing identity and platform/mobile versions remain unchanged. Design corrections can now be reviewed incrementally in the running app, following implement → test → record → advance.
