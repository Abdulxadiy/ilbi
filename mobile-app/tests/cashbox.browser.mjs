import assert from 'node:assert/strict';
import { startPreview } from './previewHarness.mjs';
const { browser, doc, waitFor, click, fill, screenshot } = await startPreview('cashbox-2026-10-27');
try {
  await click('Menyu', 'tab'); await click('Kassa va smena');
  await waitFor(`${doc}.body.innerText.includes('Smena ochiq · #21')`, 'actual shift response');
  await screenshot('cashbox-current');
  await click('Smenani yopish'); await click('Smenani yopishni tasdiqlash');
  await waitFor(`${doc}.querySelectorAll('input[aria-invalid=true]').length===2`, 'both counted cash fields red');
  await screenshot('cashbox-close-fields');
  await click('Smenani yopishni yopish');
  await click('Kassaga kirim'); await fill('Kassa summasi', '12,50'); await click('USD');
  await fill('Kirim manbasi', 'Isolated QA cash'); await click('Kassaga kirimni tasdiqlash');
  await waitFor(`${doc}.body.innerText.includes('Kassa amali serverda tasdiqlandi.')`, 'original-key cash income');
  await waitFor(`${doc}.body.innerText.includes('Isolated QA cash')`, 'actual saved cash list');
  await screenshot('cashbox-income-saved');
  assert.deepEqual(browser.errors, []);
  console.log('PASS: isolated cashbox current shift, red counted-cash fields, exact USD income and authoritative list reread. Synthetic preview; no native/production cash changed.');
} finally { await browser.close(); }
