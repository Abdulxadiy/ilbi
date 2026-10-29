# Update/download entry validation — 2026-10-29

Owner requirement: opening the download screen should initially show **Yangilanish** on desktop and phone. Keep Android/iPhone downloads discoverable. Do not invent an unpublished iPhone package or report an installed-device test from a browser/component fixture.

## Native mobile source

- `DownloadsScreen` now defaults to Updates. An explicit `?tab=downloads` still selects Downloads. The Updates panel includes **Barcha ilovalarni ko‘rish**.
- Regression tests exercise the default selected tab, installed-version/candidate state, switching to actual Android release opening, unavailable iOS, and explicit Downloads deep links. The deep-link mock was corrected to target the router's actual Jest mock after the first full run caught the namespace-wrapper mismatch (728 passed, 1 failed).
- Final actual checks on the current main source: `npm run typecheck` passed; `node_modules/.bin/eslint . --max-warnings 0` passed; `npm test -- --silent`: **74 suites, 729 tests passed; no skipped tests**. Targeted updater suite: 6 passed. Logs: `/mnt/storage/.cache/ilbi-native-tools/download-default-2026-10-29/mobile-check-{0,1,2}.txt`.
- Existing concurrent back-navigation changes are preserved. Platform version remains 1.4.0 and mobile version 1.0.0.

## Acceptance limits

No new APK/IPA was built or published for this source change. The installed Android build 5 is unchanged, so its own download screen receives this change only with a future package. The owner's emulator was not queried, started, changed or reset. Native iPhone distribution and an installed-device test remain open; paid Apple membership is not yet available. This slice does not close the rest of the parity plan.
