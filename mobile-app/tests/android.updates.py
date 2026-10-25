"""Actual native identity, daily persistence and download UI with the explicit update fixture.

Start Metro with EXPO_PUBLIC_DESIGN_PREVIEW=1 EXPO_PUBLIC_UPDATE_PREVIEW=1.
Requires the new target build to be unannounced for this preview account/day.
No real package, operator notification or financial operation is submitted.
"""
from pathlib import Path
import re
import runpy

ui = runpy.run_path(str(Path(__file__).with_name('android.native.py')))
adb, tree, texts, tap, wait, shot = [ui[key] for key in ('adb', 'tree', 'texts', 'tap', 'wait_text', 'shot')]


def run():
    try:
        adb('shell', 'am', 'start', '-W', '-n', ui['PACKAGE'] + '/.MainActivity')
        wait('DIZAYN PREVIEW')
        wait('Ilovani yangilang')
        ui['dismiss_debug_warning']()
        root = tree()
        assert 'Sizda v1.0.0 (1). Yangisi: v1.0.0 (2).' in texts(root)
        shot('01-native-version-reminder')
        tap('Yangilash')
        wait('Dizayn rejimida haqiqiy paket yuklanmaydi.')
        shot('02-explicit-preview-block')
        tap('Yangilanish eslatmasini bugunga yopish')
        assert 'Ilovani yangilang' not in texts(tree())
        adb('shell', 'am', 'force-stop', ui['PACKAGE'])
        adb('shell', 'am', 'start', '-W', '-n', ui['PACKAGE'] + '/.MainActivity')
        root = wait('Bugungi holat')
        ui['dismiss_debug_warning']()
        assert 'Ilovani yangilang' not in texts(root), 'Reminder repeated after a real same-day process restart.'
        shot('03-persisted-day')
        tap('Menyu', tab=True)
        tap('Yuklab olish')
        wait('Android uchun ILBI')
        shot('04-platform-downloads')
        tap('Yuklamalar bo‘limi: Yangilanish')
        root = wait('Sizdagi versiya: v1.0.0 · 1')
        assert 'Yangi versiya mavjud: v1.0.0 · 2' in texts(root)
        for label in ['Bosh', 'Tovar', 'Savdo', 'Qarz', 'Menyu']:
            assert any(n.get('content-desc') == label for n in root.iter('node')), label
        shot('05-update-details')
        tap('Menyu', tab=True)
        tap('Qo‘llab-quvvatlash')
        wait('ILBI bo‘yicha yordam')
        tap('Menyu', tab=True)
        tap('Chiqish', scroll=True)
        wait('Tizimga kirish')
        tap('Yuklab olish', scroll=True)
        root = wait('Android uchun ILBI')
        assert 'Ilovani yangilang' not in texts(root)
        shot('06-public-downloads')
        logs = adb('logcat', '-d', '-s', 'ReactNativeJS')
        assert not re.search(r' E ReactNativeJS:|Maximum update depth', logs), logs[-4000:]
        print('PASS: actual installed APK identity v1.0.0/build 1; explicit synthetic build-2 reminder; preview cannot open/install a package; same-day dismissal survives force-stop/restart; download/update tabs preserve five business tabs; public downloads at login; sidebar support retained. No financial records deleted.')
        print('Next-day policy is separately verified with controlled-clock component tests. No real package update, Apple runtime or public release is claimed.')
    except BaseException:
        shot('failure')
        raise


if __name__ == '__main__':
    run()
