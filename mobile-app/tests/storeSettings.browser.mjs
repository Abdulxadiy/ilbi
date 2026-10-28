import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { launchBrowser } from '../../frontend/ilbi/tests/browser/chrome.mjs';

const base = process.env.MOBILE_PREVIEW_TEST_URL || 'http://127.0.0.1:8082';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let attempt = 0; ; attempt++) {
  try { if ((await fetch(base + '/healthz')).ok) break; } catch {}
  if (attempt >= 120) throw Error('Metro did not become ready');
  await pause(500);
}
const browser = await launchBrowser({ width: 1180, height: 1000 });
const evidence = new URL('../docs/evidence/store-settings-2026-10-27/', import.meta.url);
const doc = "document.querySelector('#app')?.contentDocument";
const waitFor = async (expression, label, attempts = 140) => {
  for (let i = 0; i < attempts; i++) {
    if (await browser.evaluate(`Boolean(${doc}?.body && (${expression}))`)) return;
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
    const input = [...${doc}.querySelectorAll('input,textarea')].find(node => node.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!input) throw Error('Input missing: ' + ${JSON.stringify(label)});
    input.focus(); input.select();
  })()`);
  await browser.call('Input.insertText', { text: value });
}
try {
  await mkdir(evidence, { recursive: true });
  await browser.call('Page.navigate', { url: base + '/preview' });
  await waitFor(`${doc}?.body?.innerText.includes('Bugungi holat')`, 'isolated preview home', 600);
  await click('Menyu', 'tab');
  await click('Sozlamalar');
  await click('Do‘kon va chek sozlamalari');
  await waitFor(`${doc}.querySelector('textarea[aria-label="Chek pastidagi matn"]')?.value === 'Xaridingiz uchun rahmat!'`, 'actual loaded receipt preferences');
  await fill('Chek pastidagi matn', 'Chrome <snapshot> footer');
  await click('Bo‘limni saqlash');
  await waitFor(`${doc}.body.innerText.includes('Ushbu bo‘lim sozlamalari serverda tasdiqlandi.')`, 'receipt section acknowledged');
  await click('Sozlama bo‘limi: Hisobot jadvali', 'radio');
  await click('Kamaygan tovarlar hisoboti davri: Haftada bir marta', 'radio');
  await fill('Hafta kuni (1–7)', '8');
  await click('Bo‘limni saqlash');
  await waitFor(`${doc}.querySelector('input[aria-label="Hafta kuni (1–7)"]')?.getAttribute('aria-invalid') === 'true'`, 'invalid schedule input marked red');
  const invalid = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('schedule-invalid.png', evidence), Buffer.from(invalid.data, 'base64'));
  await fill('Hafta kuni (1–7)', '7');
  await fill('Kunlik hisobot vaqti', '21:35');
  await click('Bo‘limni saqlash');
  await waitFor(`${doc}.body.innerText.includes('Ushbu bo‘lim sozlamalari serverda tasdiqlandi.')`, 'schedule section acknowledged');
  await click('Sozlama bo‘limi: Do‘kon va chek matni', 'radio');
  assert.equal(await browser.evaluate(`${doc}.querySelector('textarea[aria-label="Chek pastidagi matn"]').value`), 'Chrome <snapshot> footer');
  await click('Serverdan qayta yuklash');
  await click('Qayta yuklashni tasdiqlash');
  await waitFor(`${doc}.querySelector('textarea[aria-label="Chek pastidagi matn"]')?.value === 'Chrome <snapshot> footer'`, 'persisted independent receipt section after reload');
  await click('Sozlama bo‘limi: Hisobot jadvali', 'radio');
  assert.equal(await browser.evaluate(`${doc}.querySelector('input[aria-label="Kunlik hisobot vaqti"]').value`), '21:35:00');
  await click('Sozlama bo‘limi: Valyuta va kurs', 'radio');
  await click('CBU dollar kursidan avtomatik foydalanish', 'switch');
  await click('Bo‘limni saqlash');
  await waitFor(`${doc}.body.innerText.includes('Serverdagi amaldagi USD kursi: 12950.123456 UZS')`, 'automatic rate read-back');
  await fill('Hisoblash summasi', '1');
  await waitFor(`${doc}.body.innerText.includes('Hisob-kitob namunasi: 12950.12 UZS')`, 'exact official-rate conversion');
  const currency = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('currency-cbu.png', evidence), Buffer.from(currency.data, 'base64'));
  await click('Menyu', 'tab');
  await click('Hujjatlar');
  await waitFor(`${doc}.body.innerText.includes('Chek #DEMO-')`, 'saved sales documents');
  await click('Chekni ochish');
  await waitFor(`${doc}.body.innerText.includes('Xaridingiz uchun rahmat!')`, 'old receipt retains original saved footer');
  assert.equal(await browser.evaluate(`${doc}.body.innerText.includes('Chrome <snapshot> footer')`), false);
  assert.ok(await browser.evaluate(`Boolean(${doc}.querySelector('[aria-label="Saqlangan chek: 58mm"]'))`));
  const receipt = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('saved-receipt-snapshot.png', evidence), Buffer.from(receipt.data, 'base64'));
  assert.deepEqual(browser.errors, []);
  console.log('PASS: real Chrome section settings, red schedule field, independent persistence, CBU conversion and immutable saved receipt');
} finally { await browser.close(); }
