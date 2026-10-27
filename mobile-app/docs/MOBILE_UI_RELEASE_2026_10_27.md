# Mobile UI update — 2026-10-27

The owner requested meaningful separate commits, GitHub push and delivery of the new mobile APK to the existing server. Every emulator and installed app must remain untouched so the owner can observe the update offer. Only mobile APK/feed publication is authorized; no main merge or platform deployment.

## Login and password recovery — source checks passed

The supplied login illustration and full-width login layout are retained, including password visibility, support/download links and Telegram/OTP login. The supplied recovery sheet offers email-link requests, token confirmation and old-password recovery. Shared sheet sizing and the top-only application safe-area wrapper are included in this slice.

Review caught a real API mismatch: the request serializer accepts `login` or `email`, not the supplied `identifier`. The client now sends `login`. An account without email moves to the old-password form. Closing or switching recovery clears tokens/passwords, invalidates late responses and cancels delayed dismissal; a completed reset clears the old login password. Authentication and Telegram verification are not bypassed.

Actual local verification: TypeScript passed, strict ESLint passed and all 41 Jest suites / 243 tests passed. Nine login tests cover existing Telegram/OTP behavior, the recovery UI, exact backend payloads, server rejection, no-email handling, password length, and stale-response/secret cleanup. Initial lint reported four unused imports, which were removed. The asynchronous dismissal test initially awaited its deliberately pending network call; the corrected test uses a native-style press and passes without extending its timeout.

These are source/component checks, not production password-reset requests or native device acceptance. No production account password or email was changed.

## Dashboard and cart — source checks passed

The supplied dashboard uses four compact metric cards with navigation to sales, debts and stores. Sales shortcuts are disabled when that module is unavailable, preserving the existing navigation permission guard. The supplied empty cart now scrolls on small screens instead of hiding actions below the viewport. Existing sale/price operations remain intact.

The same actual TypeScript, strict ESLint and 243-test run covers this slice. Browser interaction and final APK/server verification are separate checks recorded below when completed.
