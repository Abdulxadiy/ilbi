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
    for (let i = 0; i < 200; i++) { if (await browser.evaluate(expression)) return; await delay(40); }
    throw Error('Timeout: ' + expression + '\n' + await browser.evaluate('JSON.stringify([...document.querySelectorAll("input")].map(field=>({id:field.id,value:field.type==="password"?"[redacted]":field.value,invalid:field.getAttribute("aria-invalid"),message:field.validationMessage})))') + '\n' + browser.errors.join('\n'));
  }
  async function open(path, auth) {
    const browser = await launchBrowser({ width: 1180, height: 980, reducedMotion: true }); browsers.push(browser);
    await browser.call('Page.bringToFront');
    await browser.call('Emulation.setFocusEmulationEnabled', { enabled: true });
    await browser.call('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
    if (auth) await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${installAuthFixture.toString()})(${JSON.stringify(auth)})` });
    await browser.call('Page.navigate', { url: base + path });
    return browser;
  }
  async function fill(browser, selector, value) {
    await browser.evaluate(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); field.focus(); Object.getOwnPropertyDescriptor(field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  }
  async function release(browser) {
    // These tests intentionally exercise 400/401 responses from isolated fixtures.
    const unexpected = browser.errors.filter(error => !error.includes('ERR_BLOCKED_BY_CLIENT') && !/^Failed to load resource: the server responded with a status of (400|401) /.test(error) && !/^(400|401) http:\/\/127\.0\.0\.1:\d+\/api\/v1\/(validation-fixture\/|auth\/admin-login\/verify-otp\/)/.test(error));
    assert.deepEqual(unexpected, []);
    await browser.close(); browsers.splice(browsers.indexOf(browser), 1);
  }

  const form = await open('/tests/browser/formValidation.html');
  await wait(form, 'Boolean(document.querySelector("#core-form"))');
  await form.evaluate('document.querySelector("#core-form").requestSubmit()');
  assert.equal(await form.evaluate('validationQA.requests.length'), 0);
  assert.equal(await form.evaluate('document.querySelector("#email").getAttribute("aria-invalid")'), 'true');
  assert.equal(await form.evaluate('document.querySelector("#price").getAttribute("aria-invalid")'), 'true');
  assert.equal(await form.evaluate('document.querySelector("[aria-label=Category]").getAttribute("aria-invalid")'), 'true');
  await fill(form, '#email', 'invalid');
  assert.equal(await form.evaluate('document.querySelector("#email").nextElementSibling.textContent'), 'Email manzilini to‘g‘ri kiriting.');
  await fill(form, '#email', 'seller@example.com');
  await fill(form, '#price', '12');
  await fill(form, '#phone', '+99890');
  await form.evaluate('document.querySelector("#phone").blur()');
  await wait(form, 'document.querySelector("#phone").getAttribute("aria-invalid")==="true"');
  await fill(form, '#phone', '+998901234567');
  await fill(form, 'select[data-api-field=category_id]', '1');
  await wait(form, 'document.querySelectorAll("[data-validation-invalid]").length===0');
  await form.evaluate('validationQA.errors={email:["Email band."],category_id:["Kategoriya yopilgan."],date_of_birth:["Sanani tekshiring."]};document.querySelector("#core-form").requestSubmit()');
  await wait(form, 'document.querySelectorAll("[data-validation-invalid]").length===3');
  assert.equal(await form.evaluate('document.querySelector("#email").getAttribute("aria-invalid")'), 'true');
  assert.equal(await form.evaluate('document.querySelector("[aria-label=Category]").getAttribute("aria-invalid")'), 'true');
  // The error attribute appears before the border's CSS transition paints.
  await wait(form, 'getComputedStyle(document.querySelector("#email")).borderColor===getComputedStyle(document.querySelector("#email").nextElementSibling).color');
  assert.equal(await form.evaluate('getComputedStyle(document.querySelector("#email")).borderColor===getComputedStyle(document.documentElement).getPropertyValue("--border-card").trim()'), false);
  assert.ok(await form.evaluate('document.body.innerText.includes("Email band.")&&document.body.innerText.includes("Sanani tekshiring.")'));
  console.log('PASS shared forms: native required/email/price/phone validation, custom select focus/red target, backend email/category/date inline errors.');

  await form.evaluate('validationQA.errors={code:["Artikul takrorlangan."]};document.querySelector("#core-form").requestSubmit()');
  await wait(form, 'document.querySelector("#code").getAttribute("aria-invalid")==="true"');
  assert.equal(await form.evaluate('document.querySelector("#code").nextElementSibling.textContent'), 'Artikul takrorlangan.');
  await fill(form, '#code', 'ITEM-2');
  assert.equal(await form.evaluate('document.querySelector("#code").hasAttribute("aria-invalid")'), false);
  console.log('PASS canonical catalogue code rejection is mapped to the real field, not discarded as envelope metadata.');

  await fill(form, '#qa-password', 'PlainSecret!23');
  await form.evaluate('validationQA.message="Rejected ‹PlainSecret!23›";validationQA.errors={new_password:["Server echo: PlainSecret!23"]};document.querySelector("#core-form").requestSubmit()');
  await wait(form, 'document.querySelector("#qa-password").getAttribute("aria-invalid")==="true"');
  assert.equal(await form.evaluate('document.body.innerText.includes("PlainSecret!23")'), false);
  assert.equal(await form.evaluate('document.querySelector("#qa-password").nextElementSibling.textContent'), 'Server echo: [yashirilgan]');
  assert.equal(await form.evaluate('[validationQA.lastFailure.message,validationQA.lastFailure.stack,JSON.stringify(validationQA.lastFailure.data)].some(value=>value.includes("PlainSecret!23"))'), false);
  await fill(form, '#qa-password', '');
  await form.evaluate('validationQA.message=""');
  console.log('PASS password field remains highlighted without echoing its entered secret in validation text.');

  await fill(form, '#email', 'changed@example.com');
  await form.evaluate('validationQA.errors={email:["<img src=x onerror=alert(1)>"]};document.querySelector("#core-form").requestSubmit()');
  await wait(form, 'document.querySelector(".field-error")?.textContent==="<img src=x onerror=alert(1)>"');
  assert.equal(await form.evaluate('document.querySelectorAll("img").length'), 0);
  await fill(form, '#email', 'pending@example.com');
  await form.evaluate('validationQA.hold=true;validationQA.errors={email:["Old response"]};document.querySelector("#core-form").requestSubmit()');
  await wait(form, 'validationQA.pending.length===1');
  await fill(form, '#email', 'edited@example.com');
  await form.evaluate('validationQA.hold=false;validationQA.pending.shift()()');
  await delay(150);
  assert.equal(await form.evaluate('document.querySelector("#email").hasAttribute("aria-invalid")'), false);

  await form.evaluate('validationQA.hold=true;validationQA.errors={email:["Earlier submission"]};document.querySelector("#core-form").requestSubmit()');
  await wait(form, 'validationQA.pending.length===1');
  await form.evaluate('validationQA.errors={email:["Latest submission"]};document.querySelector("#core-form").requestSubmit()');
  await wait(form, 'validationQA.pending.length===2');
  await form.evaluate('validationQA.pending.splice(1,1)[0]()');
  await wait(form, 'document.querySelector(".field-error")?.textContent==="Latest submission"');
  await form.evaluate('validationQA.hold=false;validationQA.pending.shift()()');
  await delay(150);
  assert.equal(await form.evaluate('document.querySelector(".field-error").textContent'), 'Latest submission');
  await fill(form, '#email', 'unrelated@example.com');
  await form.evaluate('document.querySelector("#unrelated").focus();document.querySelector("#unrelated").click()');
  await delay(150);
  assert.equal(await form.evaluate('document.querySelector("#email").hasAttribute("aria-invalid")'), false);
  await form.evaluate('validationQA.errors={email:["Old account"]};document.querySelector("#core-form").requestSubmit()');
  await wait(form, 'document.querySelectorAll(".field-error").length===1');
  await form.evaluate('window.dispatchEvent(new Event("tenant_changed"))');
  assert.equal(await form.evaluate('document.querySelectorAll(".field-error").length'), 0);
  console.log('PASS source/request boundaries: HTML is plain text, edited fields ignore late errors, latest submission wins, unrelated writes cannot mark a form, tenant changes clear old errors.');
  await release(form);

  for (const desktop of [false, true]) {
    const browser = await open('/login', { saved: false, desktop });
    await wait(browser, 'Boolean(document.querySelector("#username"))&&!document.querySelector(".ilbi-intro[open]")');
    await browser.evaluate('document.querySelector("#login-form").requestSubmit()');
    assert.equal(await browser.evaluate('document.querySelector("#username").getAttribute("aria-invalid")'), 'true');
    assert.equal(await browser.evaluate('authQA.requests.some(row=>row.path.endsWith("/admin-login/"))'), false);
    await fill(browser, '#username', 'session_test'); await fill(browser, '#password', 'synthetic-password');
    await browser.evaluate('document.querySelector("#login-form").requestSubmit()');
    await wait(browser, 'Boolean(document.querySelector("#otp-code"))');
    await fill(browser, '#otp-code', '111111');
    await wait(browser, 'document.querySelector("#otp-code")?.getAttribute("aria-invalid")==="true"');
    assert.equal(await browser.evaluate('authQA.requests.filter(row=>row.path.endsWith("/verify-otp/")).length'), 1);
    assert.ok(await browser.evaluate('document.querySelector("#otp-error").textContent.includes("Invalid OTP")'));
    assert.equal(await browser.evaluate('Boolean(localStorage.getItem("ilbi_access_token"))'), false);
    await delay(200);
    assert.equal(await browser.evaluate('authQA.requests.filter(row=>row.path.endsWith("/verify-otp/")).length'), 1);
    await fill(browser, '#otp-code', '12345');
    assert.equal(await browser.evaluate('document.querySelector("#otp-error")'), null);
    assert.equal(await browser.evaluate('authQA.requests.filter(row=>row.path.endsWith("/verify-otp/")).length'), 1);
    await browser.evaluate(`(() => { const field=document.querySelector('#otp-code'); const form=field.closest('form'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'123456');field.dispatchEvent(new Event('input',{bubbles:true}));form.requestSubmit();form.requestSubmit(); })()`);
    await wait(browser, 'Boolean(document.querySelector(".sidebar"))');
    assert.equal(await browser.evaluate('authQA.requests.filter(row=>row.path.endsWith("/verify-otp/")).length'), 2);
    console.log(`PASS ${desktop ? 'desktop bridge renderer' : 'web'} OTP: sixth digit auto-verifies, bad code is red/inline, five digits do not submit, correction succeeds, overlapping submit does not duplicate.`);
    await release(browser);
  }
} finally {
  for (const browser of browsers) await browser.close();
  if (server) await server.close();
}
