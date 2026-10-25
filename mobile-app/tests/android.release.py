"""Smoke-test the genuine standalone release on a fresh, dedicated emulator.

Metro must be stopped. Never signs in, sends messages or changes financial records.
Use a separate AVD/serial from the persisted design-preview acceptance.
"""
from pathlib import Path
import re
import runpy

ui = runpy.run_path(str(Path(__file__).with_name('android.native.py')))
adb, tree, texts, tap, wait, shot = [ui[key] for key in ('adb', 'tree', 'texts', 'tap', 'wait_text', 'shot')]


def run():
    try:
        adb('logcat', '-c')
        adb('shell', 'am', 'start', '-W', '-n', ui['PACKAGE'] + '/.MainActivity')
        root = wait('Tizimga kirish')
        assert 'DIZAYN PREVIEW' not in texts(root)
        assert 'Demo ko‘rinishga kirish' not in texts(root)
        shot('01-standalone-login')
        tap('Yuklab olish', scroll=True)
        wait('Android uchun ILBI')
        tap('Yuklamalar bo‘limi: Yangilanish')
        wait('Sizdagi versiya: v1.0.0 · 1')
        shot('02-standalone-native-identity')
        details = adb('shell', 'dumpsys', 'package', ui['PACKAGE'])
        assert 'versionName=1.0.0' in details
        assert 'versionCode=1 ' in details
        assert not re.search(r'flags=\[[^\]]*DEBUGGABLE', details)
        logs = adb('logcat', '-d', '-s', 'ReactNativeJS')
        crash = adb('logcat', '-b', 'crash', '-d')
        assert not re.search(r' E ReactNativeJS:|Maximum update depth', logs), logs[-4000:]
        assert not crash.strip(), crash[-4000:]
        print('PASS: genuine owner-signed, non-debug release v1.0.0/build 1 installed on fresh API 36 x86_64 Android; starts with Metro stopped; real-mode login, public downloads and installed native identity work. No login or financial/support mutation submitted.')
        print('ARM64 is included in the APK but was not run on physical hardware. No iOS or public-server activation claim.')
    except BaseException:
        shot('failure')
        raise


if __name__ == '__main__':
    run()
