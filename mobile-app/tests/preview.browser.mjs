import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { launchBrowser } from '../../frontend/ilbi/tests/browser/chrome.mjs';

const base = process.env.MOBILE_PREVIEW_TEST_URL || 'http://127.0.0.1:8082';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let attempt = 0; ; attempt++) {
  try { if ((await fetch(base + '/healthz')).ok) break; } catch {}
  if (attempt >= 120) throw Error('Metro did not become ready');
  await pause(500);
}
const browser = await launchBrowser({ width: 1180, height: 1000 });
const sourcePath = new URL('../src/features/home/HomeScreen.tsx', import.meta.url);
const evidence = new URL('../docs/evidence/', import.meta.url);
const marker = 'Bugungi holat · LIVE QA';
let changed = false;
const doc = "document.querySelector('#app').contentDocument";
const waitFor = async (expression, label) => {
  for (let i = 0; i < 140; i++) {
    if (await browser.evaluate(expression)) return;
    await pause(150);
  }
  const failure = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('web-failure.png', evidence), Buffer.from(failure.data, 'base64'));
  console.error('Browser errors', browser.errors);
  throw Error('Timed out: ' + label + '; route/body: ' + await browser.evaluate(`document.querySelector('#app').contentWindow.location.pathname + ' / ' + ${doc}.body.innerText.slice(0,1800)`));
};
async function click(label, role) {
  // React Native modal/drawer transitions move targets before their animation settles.
  await pause(400);
  const point = await browser.evaluate(`(() => {
    const d = ${doc};
    const nodes = [...d.querySelectorAll(${JSON.stringify(role ? '[role="' + role + '"]' : 'button,[role="button"],a,[tabindex="0"]')})];
    const node = nodes.find(el => {
      if (el.innerText?.trim() !== ${JSON.stringify(label)} && el.getAttribute('aria-label') !== ${JSON.stringify(label)}) return false;
      if (el.closest('[aria-hidden="true"],[inert]')) return false;
      el.scrollIntoView({ block: 'center' });
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && el.contains(d.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    });
    if (!node) throw Error('Button not found: ' + ${JSON.stringify(label)} + '; candidates: ' + nodes.map(el => el.innerText).join('|'));
    node.scrollIntoView({ block: 'center' });
    const rect = node.getBoundingClientRect(), frame = document.querySelector('#app').getBoundingClientRect();
    return { x: frame.x + rect.x + rect.width / 2, y: frame.y + rect.y + rect.height / 2 };
  })()`);
  await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}
async function fill(label, value) {
  await pause(400);
  await browser.evaluate(`(() => {
    const input = [...${doc}.querySelectorAll('input')].find(node => node.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!input) throw Error('Input missing: ' + ${JSON.stringify(label)});
    input.focus(); input.select();
  })()`);
  await browser.call('Input.insertText', { text: value });
}
try {
  await browser.call('Page.navigate', { url: base + '/preview' });
  await waitFor(`${doc}?.body?.innerText.includes('Bugungi holat')`, 'home screen');
  assert.ok(await browser.evaluate(`${doc}.body.innerText.includes('DIZAYN PREVIEW')`));
  await mkdir(evidence, { recursive: true });
  const shot = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('web-phone-preview.png', evidence), Buffer.from(shot.data, 'base64'));
  await click('Tovar', 'tab');
  await click('Kategoriyalar');
  await waitFor(`${doc}.body.innerText.includes('Oziq-ovqat')`, 'category roots');
  await click('Yangi kategoriya');
  await fill('Kategoriya nomi', 'QA category');
  await click('Valyuta: USD', 'radio');
  await click('Kategoriyani saqlash');
  await waitFor(`!${doc}.querySelector('input[aria-label="Kategoriya nomi"]')`, 'parent saved');
  await click('QA category: ichki kategoriyalar');
  await click('Yangi kategoriya');
  await fill('Kategoriya nomi', 'QA child');
  await click('Kategoriyani saqlash');
  await waitFor(`!${doc}.querySelector('input[aria-label="Kategoriya nomi"]')`, 'child saved');
  await click('QA child: tovarlarni ko‘rish');
  await waitFor(`${doc}.body.innerText.includes('QA child: filtrni tozalash')`, 'category filter forwarded through Router');
  await click('QA child: filtrni tozalash');
  await click('Kategoriyalar');
  await click('QA child: tahrirlash');
  await click('Kategoriyani o‘chirish');
  await click('O‘chirishni tasdiqlash');
  await waitFor(`!${doc}.querySelector('input[aria-label="Kategoriya nomi"]')`, 'child deleted');
  await click('← Bosh kategoriyalar / QA category');
  await click('QA category: tahrirlash');
  await click('Kategoriyani o‘chirish');
  await click('O‘chirishni tasdiqlash');
  await waitFor(`!${doc}.querySelector('input[aria-label="Kategoriya nomi"]')`, 'parent deleted');
  assert.equal(await browser.evaluate(`${doc}.querySelectorAll('[role=tab]').length`), 5);
  await click('Savdo', 'tab');
  await waitFor(`${doc}.body.innerText.includes('Dona narxi')`, 'interactive cart');
  assert.ok(await browser.evaluate(`${doc}.querySelector('[aria-label="Sut 1 L: sotuv narxi"]').getBoundingClientRect().height >= 44`), 'Price edit target must be at least 44px high');
  await click('Sut 1 L: sotuv narxi');
  await waitFor(`${doc}.body.innerText.includes('Faqat shu savdo uchun')`, 'customer price sheet');
  await fill('Yangi sotuv narxi', '11500');
  await click("Qo'llash");
  await waitFor(`!${doc}.querySelector('input[aria-label="Yangi sotuv narxi"]')`, 'price sheet closes');
  await waitFor(`${doc}.querySelector('[aria-label="Sut 1 L: sotuv narxi"]').innerText.replace(/\\s/g, '').includes('11500')`, 'negotiated unit price applied');
  await click('Sut 1 L: miqdorni o‘zgartirish');
  await fill('Yangi miqdor', '0,125');
  await click('Miqdorni qo‘llash');
  await waitFor(`${doc}.querySelector('[aria-label="Sut 1 L: miqdorni o‘zgartirish"]').innerText.includes('0,125')`, 'fractional quantity applied');
  await click('Sut 1 L: miqdorni o‘zgartirish');
  await fill('Yangi miqdor', '2');
  await click('Miqdorni qo‘llash');
  await click('Menyu', 'tab');
  await waitFor(`${doc}.body.innerText.includes('Bosh sahifa')`, 'sidebar');
  await click('Tun');
  await click('Bosh sahifa');
  await waitFor(`${doc}.body.innerText.includes('Bugungi holat')`, 'home from drawer');

  for (const [label, path] of [['Hujjatlar', '/documents'], ['Ombor', '/inventory'], ['Mijozlar', '/customers'], ['Hisobotlar', '/reports'], ['Sozlamalar', '/settings']]) {
    await click('Menyu', 'tab');
    await waitFor(`${doc}.body.innerText.includes('Bosh sahifa')`, 'sidebar for ' + label);
    await click(label);
    await waitFor(`document.querySelector('#app').contentWindow.location.pathname.endsWith(${JSON.stringify(path)})`, 'opened module ' + label);
    await waitFor(`${doc}.querySelectorAll('[role=tab]').length === 5`, 'persistent bottom navigation in ' + label);
    assert.equal(await browser.evaluate(`[...${doc}.querySelectorAll('[role=tab]')].some(tab => tab.innerText.includes('Savdo'))`), true);
  }
  await click('Bosh', 'tab');
  await waitFor(`${doc}.body.innerText.includes('Bugungi holat')`, 'home after secondary modules');

  // Prove the mounted source reaches the browser through Metro's live update connection.
  const original = await readFile(sourcePath, 'utf8');
  assert.ok(original.includes('Bugungi holat'));
  await writeFile(sourcePath, original.replace('Bugungi holat', marker));
  changed = true;
  await waitFor(`${doc}.body.innerText.includes(${JSON.stringify(marker)})`, 'Fast Refresh after source save');
  const current = await readFile(sourcePath, 'utf8');
  await writeFile(sourcePath, current.replace(marker, 'Bugungi holat'));
  changed = false;
  await waitFor(`!${doc}.body.innerText.includes(${JSON.stringify(marker)})`, 'Fast Refresh after restoration');
  await browser.evaluate("const select = document.querySelector('#device'); select.value = '320,640'; select.dispatchEvent(new Event('change')); true");
  assert.ok(await browser.evaluate(`${doc}.documentElement.scrollWidth <= 320`), 'Small viewport must not overflow horizontally');
  await browser.evaluate("document.querySelector('#device').value = '390,844'; document.querySelector('#device').dispatchEvent(new Event('change')); true");
  await click('Savdo', 'tab');
  await click("To'lovga o'tish");
  await waitFor(`${doc}.body.innerText.includes('Mijoz berdi')`, 'checkout');
  await fill('Mijoz berdi', '200000');
  await click('Savdoni yakunlash');
  await waitFor(`${doc}.body.innerText.includes('Demo savdo yakunlandi')`, 'explicitly synthetic confirmation');
  const confirmation = await browser.evaluate(`${doc}.body.innerText`);
  assert.ok(confirmation.replace(/\s/g, '').includes('40000'), 'Confirmed change must be 40,000: ' + confirmation);
  await click('Chekni ochish');
  await waitFor(`${doc}.body.innerText.includes('Demo chek')`, 'saved demo receipt');
  const receiptShot = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('web-demo-receipt.png', evidence), Buffer.from(receiptShot.data, 'base64'));
  assert.deepEqual(browser.errors, []);
  console.log('PASS: Docker phone preview, parent/child category CRUD and Router filter, price negotiation, sidebar, persistent tabs across five secondary modules, dark theme, 320px viewport, live source refresh, demo checkout/change and saved receipt. Native Android/iOS are separate checks.');
} finally {
  if (changed) {
    const current = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, current.replace(marker, 'Bugungi holat'));
  }
  await browser.close();
}
