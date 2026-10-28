import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser } from './browser/chrome.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const evidence = new URL('../../../docs/evidence/ui-security-2026-10-27/', import.meta.url);
let server, browser;
try {
  await mkdir(evidence, { recursive: true });
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: 'node_modules/.vite-security-qa', logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await launchBrowser({ width: 1280, height: 1000 });
  async function wait(expression) { for (let i = 0; i < 150; i++) { if (await browser.evaluate(`Boolean(${expression})`)) return; await pause(100); } throw Error('Timeout: ' + expression); }
  async function visit(mode) { await browser.call('Page.navigate', { url: origin + '/tests/browser/securityPages.html?mode=' + mode }); }
  async function click(label) { await browser.evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(node => node.innerText.trim() === ${JSON.stringify(label)}); if (!button) throw Error('Missing button'); button.click(); })()`); await pause(50); }
  async function fill(field, value) { await browser.evaluate(`(() => { const node = document.querySelector('[data-api-field="${field}"]'); node.focus(); node.select(); })()`); await browser.call('Input.insertText', { text: value }); }
  await visit('guest'); await wait("document.body.innerText.includes('Guest customer')");
  assert.equal(await browser.evaluate("document.body.innerText.includes('a'.repeat(64))"), false);
  assert.equal(await browser.evaluate("document.body.innerText.includes('Mehmon kaliti')"), false);
  let shot = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('support-guest.png', evidence), Buffer.from(shot.data, 'base64'));
  await visit('user'); await wait("document.body.innerText.includes('Original User')");
  await click('Tahrirlash');
  assert.equal(await browser.evaluate("Boolean(document.querySelector('[data-api-field=role],[data-api-field=email]'))"), false);
  assert.equal(await browser.evaluate("[...document.querySelectorAll('button')].some(node => ['Bloklash','Faollashtirish','Do‘konni to‘xtatish','Do‘konni yoqish'].includes(node.innerText.trim()))"), false);
  await fill('first_name', 'Updated contact'); await fill('contact_phone', '+998901112233'); await click('Saqlash');
  await wait('securityQA.patches.length === 1');
  const patch = await browser.evaluate('securityQA.patches[0]');
  assert.deepEqual(Object.keys(patch).sort(), ['first_name', 'last_name', 'contact_phone', 'tenant_name', 'tenant_address'].sort());
  assert.equal(patch.first_name, 'Updated contact');
  await click('Hisobni xavfsiz boshqarish'); await wait("document.querySelector('#route').textContent === '/accounts'");
  assert.equal(await browser.evaluate('securityQA.patches.length'), 1);
  await visit('profile'); await wait("[...document.querySelectorAll('button')].some(node => node.innerText.trim()==='Parolni O‘zgartirish')");
  await click('Parolni O‘zgartirish'); await wait('document.querySelector("#current-password")?.closest("dialog").open');
  await fill('old_password', 'SyntheticOldSecret!12'); await fill('new_password', 'SyntheticNewSecret!23');
  await browser.evaluate('document.querySelector("#current-password").nextElementSibling.click();document.querySelector("#new-password").nextElementSibling.click()');
  await wait('document.querySelector("#current-password").type === "text" && document.querySelector("#new-password").type === "text"');
  await click('Bekor qilish'); await wait('!document.querySelector("#current-password").closest("dialog").open');
  await click('Parolni O‘zgartirish'); await wait('document.querySelector("#current-password").closest("dialog").open');
  assert.equal(await browser.evaluate('[...document.querySelectorAll("#current-password,#new-password,#confirm-password")].every(node=>node.value===""&&node.type==="password")'), true);
  shot = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('password-modal-reset.png', evidence), Buffer.from(shot.data, 'base64'));
  await visit('audit'); await wait("document.body.innerText.includes('Diff ko‘rish')"); await click('Diff ko‘rish');
  await wait("document.body.innerText.includes('[yashirilgan]')");
  for (const secret of ['plain-secret', 'synthetic-password', 'a'.repeat(64)]) assert.equal(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(secret)})`), false);
  assert.equal(await browser.evaluate("document.body.innerText.includes('12345.67') && document.body.innerText.includes('42')"), true);
  await visit('crash'); await wait("document.body.innerText.includes('Kutilmagan xatolik yuz berdi')");
  assert.equal(await browser.evaluate("document.body.innerText.includes('synthetic-crash-password') || document.body.innerText.includes('a'.repeat(64))"), false);
  assert.equal(await browser.evaluate("Boolean(document.querySelector('pre'))"), false);
  shot = await browser.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(new URL('safe-recovery.png', evidence), Buffer.from(shot.data, 'base64'));
  assert(!browser.errors.some(error => /synthetic-crash-password|plain-secret|a{64}/.test(error)));
  console.log('PASS: guest verifier absent, support PATCH allowlist/security routing, audit redaction and safe crash recovery in real Chrome.');
} finally { await browser?.close(); await server?.close(); }
