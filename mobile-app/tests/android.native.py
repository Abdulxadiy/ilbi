"""Drive an installed debug app on a dedicated Android emulator using real UI input.

Requires the explicit design-preview Metro server. Never selects a physical device,
never grants host camera access and never submits a real API financial operation.
"""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

SERIAL = os.environ.get('ILBI_ANDROID_TEST_SERIAL', 'emulator-5556')
if not re.fullmatch(r'emulator-\d+', SERIAL):
    raise SystemExit('This synthetic native regression only accepts a dedicated emulator serial.')
SDK = os.environ.get('ANDROID_HOME', '')
ADB = str(Path(SDK) / 'platform-tools/adb') if SDK else shutil.which('adb')
if not ADB:
    raise SystemExit('Set ANDROID_HOME or put adb in PATH.')
OUT = Path(os.environ.get('ILBI_NATIVE_EVIDENCE_DIR', '/tmp/ilbi-native-regression'))
OUT.mkdir(parents=True, exist_ok=True)
PACKAGE = 'uz.ilbi.mobile'
steps = []


def adb(*args, binary=False):
    result = subprocess.run([ADB, '-s', SERIAL, *args], check=True, capture_output=True, timeout=45)
    return result.stdout if binary else result.stdout.decode('utf-8', errors='replace')


def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/ilbi-native-test.xml')
    return ET.fromstring(adb('exec-out', 'cat', '/sdcard/ilbi-native-test.xml'))


def texts(root):
    return '\n'.join(n.get('text', '') + ' ' + n.get('content-desc', '') for n in root.iter('node'))


def wait_text(value, timeout=35):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        root = tree()
        if value in texts(root):
            return root
        time.sleep(0.4)
    raise AssertionError('Native text missing: ' + value + '\n' + texts(root)[-5000:])


def bounds(node):
    values = list(map(int, re.findall(r'\d+', node.get('bounds', ''))))
    return values if len(values) == 4 else [0, 0, 0, 0]


def keyboard_top():
    if 'mInputShown=true' not in adb('shell', 'dumpsys', 'input_method'):
        return None
    windows = adb('shell', 'dumpsys', 'window', 'windows')
    for section in windows.split('Window #'):
        if 'InputMethod}' in section.splitlines()[0]:
            match = re.search(r'touchable region=SkRegion\(\((\d+),(\d+),(\d+),(\d+)\)\)', section)
            if match:
                return int(match.group(2))
    raise AssertionError('An active IME has no measurable touch region.')


def tap(label, tab=False, scroll=False):
    for _ in range(5 if scroll else 1):
        root = tree()
        nodes = [n for n in root.iter('node') if n.get('text') == label or n.get('content-desc') == label]
        nodes = [n for n in nodes if bounds(n)[2] > bounds(n)[0] and bounds(n)[3] > bounds(n)[1]]
        ceiling = keyboard_top()
        if ceiling is not None:
            nodes = [n for n in nodes if bounds(n)[1] < ceiling and bounds(n)[3] <= ceiling]
        nodes.sort(key=lambda n: (n.get('content-desc') != label, -bounds(n)[1] if tab else 0))
        if nodes:
            x1, y1, x2, y2 = bounds(nodes[0])
            # A development-only dependency LogBox can cover tab icons; labels remain tappable.
            adb('shell', 'input', 'tap', str((x1 + x2) // 2), str(y2 - 18 if tab else (y1 + y2) // 2))
            time.sleep(0.5)
            return
        if scroll:
            views = [bounds(n) for n in root.iter('node') if n.get('scrollable') == 'true' and bounds(n)[3] > bounds(n)[1]]
            x1, y1, x2, y2 = views[-1] if views else bounds(next(root.iter('node')))
            if ceiling is not None:
                y2 = min(y2, ceiling - 4)
            adb('shell', 'input', 'swipe', str(x2 - 10), str(y1 + (y2 - y1) * 3 // 4), str(x2 - 10), str(y1 + (y2 - y1) // 4), '300')
    raise AssertionError('Native control missing: ' + label + '\n' + texts(root)[-5000:])


def dismiss_debug_warning():
    root = tree()
    boxes = [n for n in root.iter('node') if 'Open debugger to view warnings' in n.get('content-desc', '')]
    if boxes:
        x1, y1, x2, y2 = bounds(boxes[0])
        adb('shell', 'input', 'tap', str(x2 - (y2 - y1) // 2), str((y1 + y2) // 2))
        time.sleep(0.5)


def enter(label, value):
    root = tree()
    node = next(n for n in root.iter('node') if n.get('content-desc') == label and n.get('class') == 'android.widget.EditText')
    current = node.get('text', '')
    tap(label)
    adb('shell', 'input', 'keyevent', '123')
    if current:
        adb('shell', 'input', 'keyevent', *(['67'] * min(len(current) + 2, 40)))
    if not re.fullmatch(r'[0-9.,]+', value):
        raise ValueError('This regression only enters controlled numeric test values.')
    adb('shell', 'input', 'text', value)
    time.sleep(0.5)


def shot(name):
    root = tree()
    (OUT / (name + '.xml')).write_text(ET.tostring(root, encoding='unicode'))
    (OUT / (name + '.png')).write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
    steps.append(name)
    (OUT / 'steps.json').write_text(json.dumps(steps, indent=2) + '\n')
    return root


def run():
    try:
        adb('reverse', 'tcp:8081', 'tcp:8081')
        adb('shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1')
        adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
        for _ in range(2):
            if 'DIZAYN PREVIEW' in texts(tree()):
                break
            adb('shell', 'input', 'keyevent', '4')
        wait_text('DIZAYN PREVIEW')
        adb('shell', 'am', 'force-stop', PACKAGE)
        adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
        wait_text('DIZAYN PREVIEW')
        wait_text('Bugungi holat')
        dismiss_debug_warning()
        shot('01-home')
        tap('Savdo', tab=True)
        if "+ 10 ta kanonik tovarlarni yuklash (Test ma'lumot)" in texts(tree()):
            tap("+ 10 ta kanonik tovarlarni yuklash (Test ma'lumot)")
        wait_text('Sut 1 L: sotuv narxi')
        tap('Sut 1 L: sotuv narxi')
        wait_text('Yangi sotuv narxi')
        enter('Yangi sotuv narxi', '11500')
        shot('02-price-keyboard')
        tap("Qo'llash", scroll=True)
        root = wait_text('Sut 1 L: sotuv narxi')
        price = next(n for n in root.iter('node') if n.get('content-desc') == 'Sut 1 L: sotuv narxi')
        assert '11500' in re.sub(r'\s', '', texts(price)), texts(price)
        tap('Sut 1 L: miqdorni o‘zgartirish')
        enter('Yangi miqdor', '0.125')
        tap('Miqdorni qo‘llash', scroll=True)
        wait_text('0,125')
        shot('03-fraction')
        tap('Sut 1 L: miqdorni o‘zgartirish')
        enter('Yangi miqdor', '2')
        tap('Miqdorni qo‘llash', scroll=True)
        adb('shell', 'am', 'force-stop', PACKAGE)
        adb('shell', 'am', 'start', '-W', '-n', PACKAGE + '/.MainActivity')
        wait_text('DIZAYN PREVIEW')
        dismiss_debug_warning()
        tap('Savdo', tab=True)
        root = wait_text('Sut 1 L: sotuv narxi')
        price = next(n for n in root.iter('node') if n.get('content-desc') == 'Sut 1 L: sotuv narxi')
        assert '11500' in re.sub(r'\s', '', texts(price)), 'Draft did not survive a real Android process restart.'
        shot('04-restored-cart')
        tap("To'lovga o'tish")
        wait_text('Mijoz berdi')
        enter('Mijoz berdi', '200000')
        shot('05-checkout-keyboard')
        tap('Savdoni yakunlash', scroll=True)
        root = wait_text('Demo savdo yakunlandi')
        compact = re.sub(r'\s', '', texts(root))
        assert '160000' in compact and '40000' in compact, compact
        shot('06-confirmed-sale')
        print('PASS: installed Android debug app; home, real keyboard price edit, fractional quantity, persisted draft after process restart, synthetic checkout and authoritative change. No physical camera/iOS/release claim.')
    except BaseException:
        try:
            shot('failure')
        except Exception:
            pass
        raise


if __name__ == '__main__':
    run()
