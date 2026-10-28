# Mobile support — 2026-10-25

Support opens from the fixed **Qo‘llab-quvvatlash** item above the sidebar's appearance controls. It uses a dedicated page; there is no floating chat button. The five normal bottom tabs stay available for signed-in business users. The login page also offers private guest support.

The page uses the existing backend support API, including real UUID conversation identifiers, account-wide conversation lists, cursor-based history, text replies, read-through tracking and confirmed close/reopen actions. New conversations require name, subject, text and explicit consent; Uzbek/Russian/English selects the requested reply language. Configured phone/Telegram contacts come from support metadata. This does not claim all interface text has been translated.

Guest credentials are generated with native random bytes and acknowledged by SecureStore before requests can use them. Credentials are scoped to the selected server, supplied in a private header and kept out of routes. Web guest credentials live only in runtime memory; a full browser reload loses that guest identity. Signed-in reads use the account scope, while new requests may carry the explicitly selected store. Origin/account/store changes discard the old view and reject stale replies. The server independently enforces ownership.

Each create/send uses a stable client UUID. An uncertain failure preserves its original payload for an exact retry; a polled acknowledgement unlocks the composer. Requests do not overlap on a timer, respect Retry-After and stop on screen blur/background. Older and newer cursor pages merge by message ID. The composer and send button fit above the real Android soft keyboard at 360×640 logical pixels.

Platform administrators use the operator inbox API. Reply controls require a claimed conversation assigned to that operator; another operator's conversation is read-only. Claim/close/reopen actions require confirmation. Customer/account/store profile controls remain DMP-059 work. Image/voice/sticker indicators and existing reply previews can appear in history, but upload, playback, full media viewing, selecting a reply and translated UI remain DMP-058 work.

## Verification

All 222 mobile tests, TypeScript and strict ESLint passed. The full host/Chrome phone regression passed, including guest/account ownership across logout/login; the installed API 36 Android driver also passed. The real PostgreSQL support module passed all 19 tests. Automated and runtime results are recorded in [evidence](evidence/README.md). Feature tests isolate Router and mock transport; they are not native or live-service acceptance. The backend wire fixture comes from actual Django serializers, with a separate PostgreSQL test verifying private ownership, idempotency, operator replies, read-through and complete cursor history. Backend notification delivery is mocked; these checks send no operator/Telegram notifications.

The native driver is [android.support.py](../tests/android.support.py). It accepts only a dedicated emulator serial and verifies the explicit synthetic preview banner before entering data. It drives the actual installed APK, soft keyboard, native SecureStore and route transitions. Its synthetic API is separate from the real backend contract tests; this is not a native-to-live-server end-to-end claim. The APK digest, native configuration and build instructions are in [ANDROID_NATIVE_VALIDATION.md](ANDROID_NATIVE_VALIDATION.md). No native module or app/platform version changes were needed for this JavaScript feature.

```bash
# Start the explicit synthetic host preview before either UI test.
EXPO_PUBLIC_DESIGN_PREVIEW=1 npm run dev:docker

# In separate terminals:
ANDROID_HOME=/path/to/sdk ILBI_ANDROID_TEST_SERIAL=emulator-5556 python tests/android.support.py
MOBILE_PREVIEW_TEST_RUNTIME=Host npm run test:preview
npm test -- --silent
npm run typecheck
npx eslint . --max-warnings 0

# From backend/ against isolated test infrastructure:
.venv/bin/python -m pytest apps/support/tests/test_support.py -q
```

The native run exposed a real logout loop: both the root entry and business tabs map to `/`, so an implicit protected-route fallback repeatedly chose the old business route. The business route group now supplies `redirectTo={sessionEntry(user, activeTenant)}`. This preserves authorization gates and directs a revoked session to login. The driver verifies logout, guest help and login again; application errors are not suppressed.

Earlier attempts also found test-driver problems: a clipped label was mistaken for its input, Android Back dismissed a form, and an already-open modal hid the preview banner. The driver now targets actual focused EditText controls, scrolls the form rather than sending an ambiguous Back, and closes a preexisting modal before checking the banner. Failed attempts are not passing evidence. Existing upstream Reanimated development warnings remain visible in logs; they are separate from the resolved application error.

iOS, physical-device testing, native accessibility services, release performance, push/background notifications and real operator delivery remain unverified. Support media and customer-profile parity remain explicit audit findings.
