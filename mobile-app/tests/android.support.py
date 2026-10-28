"""Actual sidebar support/keyboard/session acceptance on a dedicated preview emulator.

Uses synthetic messages only. Run with the same ANDROID_HOME/serial/evidence
environment variables as android.native.py. Never contacts an operator.
"""
from pathlib import Path
import re
import runpy
import time

ui = runpy.run_path(str(Path(__file__).with_name('android.native.py')))
adb, tree, texts, tap, wait, shot = [ui[key] for key in ('adb', 'tree', 'texts', 'tap', 'wait_text', 'shot')]


def type_ascii(label, value, scroll=False):
    assert re.fullmatch(r'[A-Za-z0-9 ]+', value), 'Controlled synthetic input only.'
    tap(label, scroll=scroll, input_only=True)
    target = next(n for n in tree().iter('node') if n.get('content-desc') == label and n.get('class') == 'android.widget.EditText')
    assert target.get('focused') == 'true', 'The actual input must have focus before typing.'
    adb('shell', 'input', 'text', value.replace(' ', '%s'))
    time.sleep(0.4)


def acknowledged(value):
    root = wait(value)
    # An unsubmitted EditText value is not a server-acknowledged chat bubble.
    assert any(n.get('text') == value and n.get('class') == 'android.widget.TextView' for n in root.iter('node'))
    composer = next(n for n in root.iter('node') if n.get('content-desc') == 'Yordamga xabar')
    assert composer.get('text') in ('', 'Xabaringiz…'), composer.get('text')


def run():
    try:
        adb('reverse', 'tcp:8081', 'tcp:8081')
        adb('shell', 'am', 'start', '-W', '-n', ui['PACKAGE'] + '/.MainActivity')
        for _ in range(2):
            if 'DIZAYN PREVIEW' in texts(tree()):
                break
            adb('shell', 'input', 'keyevent', '4')
        wait('DIZAYN PREVIEW')
        adb('shell', 'am', 'force-stop', ui['PACKAGE'])
        adb('logcat', '-c')
        adb('shell', 'am', 'start', '-W', '-n', ui['PACKAGE'] + '/.MainActivity')
        wait('Bugungi holat')
        ui['dismiss_debug_warning']()
        tap('Menyu', tab=True)
        # Support stays visible above the fixed appearance controls at 360×640.
        tap('Qo‘llab-quvvatlash')
        wait('ILBI bo‘yicha yordam')
        shot('01-sidebar-support')
        tap('ILBI bo‘yicha yordam: yozishmalarni ochish')
        wait('Bu sinov yozishmasi.')
        type_ascii('Yordamga xabar', 'Native support check')
        root = tree()
        keyboard = ui['keyboard_top']()
        assert keyboard is not None
        geometry = {}
        for label in ('Yordamga xabar', 'Xabar yuborish'):
            node = next(n for n in root.iter('node') if n.get('content-desc') == label)
            geometry[label] = ui['bounds'](node)
            assert 0 < geometry[label][3] <= keyboard, (label, geometry[label], keyboard)
        shot('02-chat-keyboard')
        tap('Xabar yuborish')
        acknowledged('Native support check')
        shot('03-message-acknowledged')
        tap('Suhbatni yopish')
        tap('Tasdiqlash')
        wait('Davom etish uchun suhbatni qayta oching.')
        tap('Suhbatni qayta ochish')
        tap('Tasdiqlash')
        wait('Javob kutilmoqda')
        shot('04-reopened')
        tap('Menyu', tab=True)
        tap('Chiqish', scroll=True)
        wait('Tizimga kirish')
        tap('Qo‘llab-quvvatlash', scroll=True)
        root = wait('Hozircha murojaat yo‘q')
        assert 'Native support check' not in texts(root)
        assert 'ILBI bo‘yicha yordam' not in texts(root)
        shot('05-isolated-guest')
        tap('Yangi murojaat')
        type_ascii('Ismingiz', 'Native guest')
        type_ascii('Murojaat mavzusi', 'Guest native support', scroll=True)
        type_ascii('Birinchi xabar', 'Synthetic guest question', scroll=True)
        tap('Yordam uchun ma’lumotlarni yuborishga roziman', scroll=True)
        tap('Murojaat yuborish', scroll=True)
        wait('Synthetic guest question')
        type_ascii('Yordamga xabar', 'Guest followup')
        tap('Xabar yuborish')
        acknowledged('Guest followup')
        shot('06-guest-message')
        tap('Orqaga')
        wait('Guest native support')
        tap('Orqaga')
        wait('Tizimga kirish')
        tap('Demo ko‘rinishga kirish')
        wait('Bugungi holat')
        tap('Menyu', tab=True)
        tap('Qo‘llab-quvvatlash')
        root = wait('ILBI bo‘yicha yordam')
        assert 'Guest native support' not in texts(root)
        shot('07-owner-restored')
        logs = adb('logcat', '-d', '-s', 'ReactNativeJS')
        (ui['OUT'] / 'native.log').write_text(logs)
        assert not re.search(r' E ReactNativeJS:|Maximum update depth|ILBI_ROUTE_REPORT', logs), logs[-4000:]
        print('PASS: actual API 36 Android sidebar, owner and guest text acknowledgements, consent, close/reopen, logout/login isolation, composer/send above IME; keyboard top', keyboard, 'controls', geometry)
        print('Explicit synthetic API only; native SecureStore is real. No live operator delivery or iOS claim.')
    except BaseException:
        shot('failure')
        raise


if __name__ == '__main__':
    run()
