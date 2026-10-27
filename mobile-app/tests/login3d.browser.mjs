import assert from 'node:assert/strict';
import { startPreview } from './previewHarness.mjs';
const { browser, doc, waitFor, click, fill, screenshot } = await startPreview('production-readiness-2026-10-27');
try {
  await click('Menyu', 'tab'); await click('Chiqish');
  await waitFor(`${doc}.body.innerText.includes('Tizimga kirish')`, 'mobile-only approved login');
  await browser.evaluate('new Promise(resolve => setTimeout(resolve, 1200))');
  await screenshot('login-3d-actual');
  await click('Kirish');
  await waitFor(`${doc}.querySelectorAll('input[aria-invalid=true]').length===2`, 'both empty credential fields are red');
  await screenshot('login-field-errors-actual');
  await fill('Foydalanuvchi nomi yoki telefon', 'synthetic-preview-user');
  await waitFor(`${doc}.querySelectorAll('input[aria-invalid=true]').length===1`, 'editing clears only the edited credential error');
  assert.deepEqual(browser.errors, []);
  console.log('PASS: mobile-only transparent 3D login, completed entrance animation, empty-field validation and independent error clearing. No real login or emulator interaction.');
} finally { await browser.close(); }
