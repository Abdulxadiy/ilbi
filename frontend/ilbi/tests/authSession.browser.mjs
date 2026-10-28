import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser/chrome.mjs';
import { installAuthFixture } from './browser/authFixture.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server;
const browsers = [];
try {
  server = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)), plugins: [react()], logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  async function wait(browser, expression) {
    for (let i = 0; i < 200; i++) {
      try { if (await browser.evaluate(expression)) return; }
      catch (error) {
        if (!/Inspected target navigated or closed|Execution context was destroyed|Cannot find (?:default execution context|context with specified id)/.test(error.message)) throw error;
      }
      await delay(40);
    }
    throw Error('Timeout: ' + expression + '\n' + browser.errors.join('\n'));
  }
  async function open(path, options = {}) {
    const browser = await launchBrowser({ width: 1280, height: 900, reducedMotion: true });
    browsers.push(browser);
    await browser.call('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
    await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${installAuthFixture.toString()})(${JSON.stringify(options)})` });
    await browser.call('Page.navigate', { url: base + path });
    await wait(browser, 'document.querySelector("#root")?.children.length > 0');
    return browser;
  }
  async function release(browser) {
    assert.deepEqual(browser.errors.filter(error => !error.includes('ERR_BLOCKED_BY_CLIENT')), []);
    await browser.close(); browsers.splice(browsers.indexOf(browser), 1);
  }
  const clickText = (browser, text) => browser.evaluate(`(() => {
    const button = [...document.querySelectorAll('button,a,[role=button]')].find(node => node.textContent.trim() === ${JSON.stringify(text)});
    if (!button) throw Error('Missing button: ' + ${JSON.stringify(text)});
    button.click();
  })()`);
  async function openWidget(browser) {
    await wait(browser, 'Boolean(document.querySelector(".support-launcher"))');
    await browser.evaluate('window.dispatchEvent(new Event("open-support-widget"))');
    await wait(browser, 'Boolean(document.querySelector(".support-widget-window"))');
  }
  async function fill(browser, selector, value) {
    await browser.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  }
  async function signIn(browser) {
    await wait(browser, 'Boolean(document.querySelector("#username")) && !document.querySelector(".ilbi-intro[open]")');
    await fill(browser, '#username', 'session_test');
    await fill(browser, '#password', 'synthetic-password');
    await browser.evaluate('document.querySelector("#username").closest("form").requestSubmit()');
    await wait(browser, 'Boolean(document.querySelector("#otp-code"))');
    assert.equal(await browser.evaluate('Boolean(localStorage.getItem("ilbi_access_token") || sessionStorage.getItem("ilbi_access_token"))'), false, 'Password step alone must not grant access');
    if (await browser.evaluate('Boolean(window.ilbiDesktop)')) assert.equal(await browser.evaluate('authQA.credentialSaves'), 0, 'Do not remember credentials before successful OTP verification');
    await fill(browser, '#otp-code', '123456');
    // The sixth digit now starts verification without another submit click.
    await wait(browser, 'Boolean(document.querySelector(".sidebar"))');
  }

  const logout = await open('/profile', { guestHistory: true });
  await wait(logout, 'Boolean(document.querySelector(".sidebar"))');
  await openWidget(logout);
  await wait(logout, 'document.body.innerText.includes("PRIVATE_HISTORY_SENTINEL")');
  await logout.evaluate('document.querySelector("button[aria-label=Chiqish]").click()');
  await wait(logout, 'Boolean(document.querySelector("dialog[open]"))');
  await clickText(logout, 'Chiqish');
  await wait(logout, 'location.pathname === "/login"');
  await delay(250);
  assert.equal(await logout.evaluate('document.body.innerText.includes("PRIVATE_HISTORY_SENTINEL")'), false, 'Logout must remove private chat history immediately');
  assert.equal(await logout.evaluate('Boolean(localStorage.getItem("ilbi_access_token") || localStorage.getItem("inventra_access_token"))'), false);
  console.log('PASS logout clears private chat and both token namespaces');
  await release(logout);

  const offline = await open('/support', { profileFailure: true });
  await delay(1000);
  assert.equal(await offline.evaluate('Boolean(document.querySelector(".sidebar"))'), false, 'A cached profile without server validation must not open the private layout');
  assert.equal(await offline.evaluate('authQA.requests.some(r => r.path.includes("/support/inbox/"))'), false, 'Unverified sessions must not request private chats');
  console.log('PASS unverified/offline sessions do not expose private screens');
  await offline.evaluate('authQA.profileFailure = false');
  await clickText(offline, 'Qayta tekshirish');
  await wait(offline, 'Boolean(document.querySelector(".sidebar"))');
  console.log('PASS a failed session check can be retried without losing the saved session');
  await release(offline);

  const savedLogin = await open('/login', { guestHistory: true });
  await wait(savedLogin, 'Boolean(document.querySelector("#username"))');
  await openWidget(savedLogin);
  assert.equal(await savedLogin.evaluate('Boolean(localStorage.getItem("ilbi_access_token"))'), false);
  assert.equal(await savedLogin.evaluate('authQA.requests.some(r => r.authorized)'), false, 'Login must not send the old session to private APIs');
  assert.equal(await savedLogin.evaluate('document.body.innerText.includes("PRIVATE_HISTORY_SENTINEL") || document.body.innerText.includes("GUEST_HISTORY_SENTINEL")'), false);
  await savedLogin.evaluate(`document.querySelector('button[title="To‘liq sahifada ochish"]').click()`);
  await wait(savedLogin, 'location.pathname === "/support"');
  assert.equal(await savedLogin.evaluate('Boolean(document.querySelector(".sidebar"))'), false);
  console.log('PASS login clears old authentication and old chat capability; expand stays public');
  await release(savedLogin);

  const guest = await open('/login', { saved: false });
  await wait(guest, 'Boolean(document.querySelector("#username"))');
  await openWidget(guest);
  await guest.evaluate(`document.querySelector('button[title="To‘liq sahifada ochish"]').click()`);
  await wait(guest, 'location.pathname === "/support"');
  assert.equal(await guest.evaluate('Boolean(document.querySelector(".sidebar"))'), false);
  console.log('PASS expanding a guest chat never opens the private layout');
  await release(guest);

  const loginFlow = await open('/login', { saved: false });
  await signIn(loginFlow);
  console.log('PASS normal login requires the OTP step before authenticated navigation');

  const remembered = await open('/login', { saved:false, desktop:true });
  await signIn(remembered);
  assert.equal(await remembered.evaluate('authQA.credentialSaves'),1);
  assert.equal(await remembered.evaluate('JSON.stringify({...localStorage,...sessionStorage}).includes("synthetic-password")'),false);
  await remembered.evaluate('window.dispatchEvent(new Event("auth:logout"))');
  await wait(remembered, 'location.pathname==="/login" && document.querySelector("#username")?.value==="session_test" && document.querySelector("#password")?.value==="synthetic-password"');
  await remembered.evaluate('document.querySelector("#remember-me").click()');
  await wait(remembered,'window.ilbiDesktop.getSavedLogin("online").then(value=>value===null)');
  assert.equal(await remembered.evaluate('localStorage.getItem("ilbi_remember_me")'), 'false');
  console.log('PASS verified login remembers both fields; opt-out deletes native saved credentials without plaintext browser storage');
  await release(remembered);

  const daily = await open('/login', {saved:false,desktop:true,dailyMfa:true});
  await wait(daily,'Boolean(document.querySelector("#username"))&&!document.querySelector(".ilbi-intro[open]")');
  await fill(daily,'#username','session_test');await fill(daily,'#password','synthetic-password');
  await daily.evaluate('document.querySelector("#login-form").requestSubmit()');
  await wait(daily,'Boolean(document.querySelector(".sidebar"))');
  assert.equal(await daily.evaluate('authQA.requests.some(row=>/send-otp|verify-otp/.test(row.path))'),false);
  await daily.evaluate('authQA.idle=true;window.dispatchEvent(new Event("auth:logout"))');
  await wait(daily,'location.pathname==="/login"&&document.querySelector("#username")?.value==="session_test"&&document.body.innerText.includes("Saqlangan parolingiz o‘chirilmagan")');
  assert.equal(await daily.evaluate('document.querySelector("#password").value'), '');
  await fill(daily,'#password','synthetic-password');
  await daily.evaluate('document.querySelector("#login-form").requestSubmit()');
  await wait(daily,'Boolean(document.querySelector(".sidebar"))');
  assert.equal(await daily.evaluate('authQA.requests.some(row=>/send-otp|verify-otp/.test(row.path))'),false);
  await daily.evaluate('authQA.dailyMfa=false;window.dispatchEvent(new Event("auth:logout"))');
  await wait(daily,'location.pathname==="/login"&&Boolean(document.querySelector("#password"))');
  await fill(daily,'#password','synthetic-password');
  await daily.evaluate('document.querySelector("#login-form").requestSubmit()');
  await wait(daily,'Boolean(document.querySelector("#otp-code"))');
  assert.equal(await daily.evaluate('Boolean(localStorage.getItem("ilbi_access_token")||sessionStorage.getItem("ilbi_access_token"))'),false);
  console.log('PASS daily desktop password login skips repeated OTP; idle requires typing; expired second factor returns to OTP');
  await release(daily);

  const draft = await open('/pos', { role: 'owner' });
  await wait(draft, 'Boolean(document.querySelector(".glass-card.interactive"))');
  await draft.evaluate('document.querySelector(".glass-card.interactive").click()');
  await wait(draft, 'JSON.parse(localStorage.getItem("ilbi_account_draft:41:7:pos_cart") || "[]").length === 1');
  await clickText(draft, 'To‘lovga O‘tish');
  await wait(draft, 'Boolean(document.querySelector("dialog[open] form"))');
  await draft.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('dialog[open] input')];
    const input = inputs.find(e => e.value.replaceAll(/[^0-9]/g, '') === '10000');
    if (!input) throw Error('Payment amount input not found');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '12000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(draft, 'JSON.parse(localStorage.getItem("ilbi_account_draft:41:7:checkout_paid_uzs") || "null") === "12000"');
  await draft.evaluate('window.dispatchEvent(new Event("auth:logout"))');
  await wait(draft, 'location.pathname === "/login"');
  assert.equal(await draft.evaluate('document.body.innerText.includes("Qoralama mahsuloti")'), false);
  assert.equal(await draft.evaluate('JSON.parse(localStorage.getItem("ilbi_account_draft:41:7:pos_cart")).length'), 1);
  // Authenticate through the real form, then revisit POS without making a sale.
  await signIn(draft);
  await draft.evaluate(`document.querySelector('.sidebar a[href="/pos"]').click()`);
  await wait(draft, 'Boolean(document.querySelector(".glass-card.interactive"))');
  await clickText(draft, 'To‘lovga O‘tish');
  await wait(draft, 'Boolean(document.querySelector("dialog[open] form"))');
  assert.equal(await draft.evaluate(`[...document.querySelectorAll('dialog[open] input')].some(e => e.value.replaceAll(/[^0-9]/g, '') === '12000')`), true);
  assert.equal(await draft.evaluate('authQA.requests.some(r => r.method === "POST" && r.path === "/api/v1/sales/")'), false, 'Restoring a draft must not submit a sale');
  console.log('PASS actual POS cart and payment input survive logout/2FA with no automatic sale');

  await draft.evaluate(`document.querySelector('dialog[open]').dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))`);
  await wait(draft, '!document.querySelector("dialog[open]")');
  await clickText(draft, 'Birinchi do‘kon');
  await wait(draft, 'Boolean(document.querySelector("[role=listbox]"))');
  await draft.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role=option]')].find(e => e.textContent.includes('Ikkinchi do‘kon'));
    if (!option) throw Error('Second tenant not found');
    option.click();
  })()`);
  await wait(draft, 'localStorage.getItem("ilbi_active_tenant:41") === "8"');
  assert.equal(await draft.evaluate('JSON.parse(localStorage.getItem("ilbi_account_draft:41:7:pos_cart")).length'), 1);
  await clickText(draft, 'Ikkinchi do‘kon');
  await draft.evaluate(`([...document.querySelectorAll('[role=option]')].find(e => e.textContent.includes('Birinchi do‘kon'))).click()`);
  await wait(draft, 'localStorage.getItem("ilbi_active_tenant:41") === "7"');
  await clickText(draft, 'To‘lovga O‘tish');
  await wait(draft, 'Boolean(document.querySelector("dialog[open] form"))');
  console.log('PASS switching shops preserves each shop cart');

  await draft.evaluate(`document.querySelector('dialog[open]').dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true }))`);
  await draft.evaluate(`document.querySelector('.sidebar a[href="/catalog"]').click()`);
  await wait(draft, '[...document.querySelectorAll("button")].some(e => e.textContent.includes("Yangi Tovar"))');
  await clickText(draft, 'Yangi Tovar');
  await wait(draft, 'Boolean(document.querySelector("dialog[open] input[type=file]"))');
  await fill(draft, 'dialog[open] input', 'QORALAMA_MAHSULOTI');
  await draft.evaluate(`(() => {
    const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], 'draft-image.png', { type: 'image/png' }));
    const input = document.querySelector('dialog[open] input[type=file]');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(draft, `(async () => {
    const { draftFile } = await import('/src/utils/draftFiles.js');
    return (await draftFile('ilbi_account_draft:41:7:draft_product_image'))?.name === 'draft-image.png';
  })()`);
  await draft.evaluate('window.dispatchEvent(new Event("auth:logout"))');
  await wait(draft, 'location.pathname === "/login"');
  assert.equal(await draft.evaluate('document.body.innerText.includes("QORALAMA_MAHSULOTI") || document.body.innerText.includes("draft-image.png")'), false);
  await signIn(draft);
  await draft.evaluate(`document.querySelector('.sidebar a[href="/catalog"]').click()`);
  await wait(draft, '[...document.querySelectorAll("button")].some(e => e.textContent.includes("Yangi Tovar"))');
  await clickText(draft, 'Yangi Tovar');
  await wait(draft, 'document.querySelector("dialog[open] input")?.value === "QORALAMA_MAHSULOTI" && document.body.innerText.includes("draft-image.png")');
  console.log('PASS actual product form and attached image survive logout and authenticated restoration');

  await draft.evaluate(`(() => {
    window.dispatchEvent(new Event('auth:logout'));
    authQA.user = { ...authQA.user, id: 42, username: 'second_account' };
    const token = kind => 'fixture.' + btoa(JSON.stringify({ user_id: 42, exp: Date.now() / 1000 + 3600, token_type: kind })) + '.fixture';
    authQA.tokens = { access: token('access'), refresh: token('refresh') };
    localStorage.setItem('ilbi_active_tenant:42', '7');
  })()`);
  await wait(draft, 'location.pathname === "/login"');
  await signIn(draft);
  await draft.evaluate(`document.querySelector('.sidebar a[href="/pos"]').click()`);
  await wait(draft, 'Boolean(document.querySelector(".glass-card.interactive"))');
  assert.equal(await draft.evaluate(`([...document.querySelectorAll('button')].find(e => e.textContent.includes('To‘lovga O‘tish'))).disabled`), true, 'A second account in the same shop must receive an empty cart');
  await draft.evaluate(`document.querySelector('.sidebar a[href="/catalog"]').click()`);
  await wait(draft, '[...document.querySelectorAll("button")].some(e => e.textContent.includes("Yangi Tovar"))');
  await clickText(draft, 'Yangi Tovar');
  await wait(draft, 'Boolean(document.querySelector("dialog[open] input[type=file]"))');
  assert.equal(await draft.evaluate('document.querySelector("dialog[open] input").value'), '');
  assert.equal(await draft.evaluate('document.body.innerText.includes("draft-image.png")'), false);
  console.log('PASS another authenticated account in the same shop sees neither cart nor product/image drafts');

  // Cross-tab storage events must also revoke the already-rendered private UI.
  await loginFlow.evaluate(`(() => {
    for (const prefix of ['ilbi_', 'inventra_']) for (const suffix of ['access_token','refresh_token','user']) localStorage.removeItem(prefix + suffix);
    window.dispatchEvent(new StorageEvent('storage', { key: 'ilbi_access_token', newValue: null }));
  })()`);
  await wait(loginFlow, 'location.pathname === "/login"');
  assert.equal(await loginFlow.evaluate('Boolean(document.querySelector(".sidebar"))'), false);
  console.log('PASS logout in another tab hides private screens');

  for (const browser of browsers) assert.deepEqual(browser.errors.filter(error => !error.includes('ERR_BLOCKED_BY_CLIENT')), []);
} finally {
  for (const browser of browsers) await browser.close();
  if (server) await server.close();
}
