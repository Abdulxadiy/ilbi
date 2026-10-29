// Exercise the actually installed application, without enrolling a cloud store.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { access, mkdir, readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { OFFICIAL_SERVER, freePort } = require('../runtime.cjs');
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const installed = Boolean(process.env.ILBI_DESKTOP_INSTALLED_EXE);
async function waitForExit(exited, timeout) {
  let timer;
  try { await Promise.race([exited, new Promise(ok => { timer=setTimeout(ok,timeout); })]); }
  finally { clearTimeout(timer); }
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  let sequence = 0;
  const waiting = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data), pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id); clearTimeout(pending.timer);
    message.error ? pending.fail(Error(JSON.stringify(message.error))) : pending.ok(message.result);
  });
  const call = (method, params = {}) => new Promise((ok, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); fail(Error('Installed UI request timed out: ' + method)); }, 30000);
    waiting.set(id, { timer, fail, ok });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, call, async evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } };
}

async function capture(page, name) {
  if (!process.env.ILBI_DESKTOP_QA_DIR) return;
  await mkdir(process.env.ILBI_DESKTOP_QA_DIR, { recursive: true });
  await writeFile(join(process.env.ILBI_DESKTOP_QA_DIR, name + '.png'), Buffer.from((await page.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
}

async function withInstalled(extraArguments, action) {
  const port = await freePort();
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  // The normal path deliberately supplies NO password-store override. It must
  // work through the same launcher and selection logic as a customer's app.
  const child = spawn(process.env.ILBI_DESKTOP_INSTALLED_EXE, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', ...extraArguments], { env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise(ok => child.once('exit', ok));
  let log = '', setup;
  child.stderr.on('data', data => { log = (log + data.toString()).slice(-5000); if (data.toString().includes('ILBI yopilishi:')) console.error(data.toString().trim()); });
  const sockets = [];
  const targets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  async function waitFor(operation, description = 'app UI') {
    for (let i = 0; i < 400; i++) { try { const value = await operation(); if (value) return value; } catch {} await pause(150); }
    throw Error(`Installed ${description} did not become ready: ${log}`);
  }
  async function page(target) { const value = await connect(target); sockets.push(value.socket); return value; }
  try {
    setup = await page(await waitFor(async () => (await targets()).find(item => item.type === 'page' && item.url.endsWith('/setup'))));
    await waitFor(() => setup.evaluate('document.readyState === "complete" && Boolean(document.querySelector("#guide")) && typeof window.ilbiDesktop?.openGuide === "function"'), 'setup document and native bridge');
    await action({ setup, waitFor, targets, page });
  } finally {
    if (setup && child.exitCode === null) await setup.evaluate('setTimeout(()=>window.close(),50);true').catch(() => {});
    // Normal shutdown drains in-flight cloud requests before stopping the DB.
    await waitForExit(exited, 90000);
    for (const socket of sockets) socket.close();
    if (child.exitCode === null) child.kill();
    await waitForExit(exited, 5000);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await waitForExit(exited, 5000); }
  }
  assert.equal(child.exitCode, 0, 'Installed app shuts down cleanly: ' + log);
}

async function releaseStatus(page) {
  return page.evaluate('fetch("/desktop/releases/",{headers:{Authorization:"Bearer disposable-test-token"}}).then(async response=>({status:response.status,...await response.json()}))');
}

function assertPublicFeed(value) {
  assert.equal(value.status, 200, JSON.stringify(value));
  assert.equal(value.origin, OFFICIAL_SERVER);
  assert.equal(value.release.schema, 1);
  // A first deployment has a valid empty feed until these native checks pass.
  // Package publication cannot be a prerequisite for testing that same package.
  let available = 0;
  for (const platform of ['windows', 'linux']) {
    if (value.release[platform]) {
      assert.match(value.release[platform].url, /^\/downloads\//);
      available++;
    }
  }
  // The public page includes published mobile clients alongside desktop ones.
  // Keep the exact link-count check as Android/iOS publication changes.
  const mobile = value.release.mobile;
  const android = mobile?.android || (mobile?.url ? mobile : null);
  if (android?.url) {
    assert.match(android.url, /^(?:\/downloads\/.*\.apk|https:\/\/play\.google\.com\/store\/apps\/details\?)/);
    available++;
  }
  if (mobile?.ios?.url) {
    assert.match(mobile.ios.url, /^https:\/\/(?:apps\.apple\.com|testflight\.apple\.com)\//);
    available++;
  }
  return available;
}

test('failed Linux secure storage stays retryable and public downloads still work', {
  skip: !installed || process.platform !== 'linux', timeout: 180000,
}, async () => {
  await withInstalled(['--password-store=basic'], async ({ setup, waitFor }) => {
    assertPublicFeed(await releaseStatus(setup));
    for (let attempt = 0; attempt < 2; attempt++) {
      await setup.evaluate('document.querySelector("#host>button").click()');
      await waitFor(() => setup.evaluate('document.querySelector("#status").classList.contains("is-error") && !document.querySelector("#host>button").disabled'), 'retryable secure-store error');
      const message = await setup.evaluate('document.querySelector("#status").textContent');
      assert.match(message, /Parollar omboriga ulanib bo‘lmadi/);
      assert.doesNotMatch(message, /Error invoking remote method|allaqachon sozlangan/);
      assert(await setup.evaluate('parseFloat(getComputedStyle(document.querySelector("#status")).borderRadius)>=8'));
      assert.equal(await setup.evaluate('document.querySelector("#status-guide").hidden'), false);
    }
    await assert.rejects(access(join(process.env.XDG_CONFIG_HOME, 'ILBI/device.vault')));
    const status = await setup.evaluate('fetch("/desktop/status/").then(async response=>({status:response.status,...await response.json()}))');
    assert.equal(status.status, 503); assert.equal(status.code, 'setup_required');
    assertPublicFeed(await releaseStatus(setup));
    await capture(setup, 'setup-secure-store-recovery');
  });
});

test('default installed launch opens downloads before setup, recovers a failed request and starts the encrypted store', {
  skip: !installed || !['win32', 'linux'].includes(process.platform), timeout: 240000,
}, async () => {
  await withInstalled([], async ({ setup, waitFor, targets, page }) => {
    assert.equal(await setup.evaluate('document.querySelector("#host>button").textContent === "Ishni boshlash" && !document.querySelector("#join-details").open && !document.querySelector("#server-settings") && !document.querySelector("input[name=server]")'), true);
    const available = assertPublicFeed(await releaseStatus(setup));
    await setup.evaluate('window.ilbiDesktop.openGuide()');
    const guide = await page(await waitFor(async () => (await targets()).find(item => item.type === 'page' && item.url.includes('/desktop-guide'))));
    await waitFor(() => guide.evaluate('document.querySelector("h1")?.textContent === "ILBI ilovasini sozlash" && !document.querySelector(".ilbi-loading")'), 'guide content');
    assert.equal(await guide.evaluate('document.querySelectorAll(".doc-focus-trigger img").length'), 7);
    for(const expression of ["window.ilbiDesktop.createPairing('synthetic-token')","window.ilbiDesktop.createBackup('synthetic-token')","window.ilbiDesktop.lockSession('synthetic-token')"]){
      const denied=await guide.evaluate(`(${expression}).then(()=>false,()=>true)`);assert.equal(denied,true,'A guide window cannot change register security');
    }
    await guide.evaluate('Promise.all([...document.querySelectorAll(".doc-focus-trigger img")].map(img=>{img.loading="eager";return img.decode()}))');
    await guide.evaluate('document.querySelector(".doc-focus-trigger").click()');
    await waitFor(() => guide.evaluate('Boolean(document.querySelector("dialog[open]"))'), 'enlarged guide image');
    await guide.evaluate('document.querySelector("dialog[open] button[aria-label=Yopish]").click()');
    await guide.evaluate('location.href="/download";true');
    await waitFor(() => guide.evaluate('Boolean(document.querySelector("#panel-updates")) && !document.querySelector(".ilbi-loading")'), 'default public updates before setup');
    assert.equal(await guide.evaluate('document.querySelector("#tab-updates").getAttribute("aria-selected")'), 'true');
    assert.equal(await guide.evaluate('document.querySelectorAll(".updates-platform-link").length'), 4);
    await guide.evaluate('document.querySelector("#tab-downloads").click()');
    await waitFor(() => guide.evaluate(`Boolean(document.querySelector(".downloads-grid")) && document.querySelectorAll(".downloads-button[href]").length === ${available} && !document.querySelector(".ilbi-loading")`), 'public downloads before store setup');
    await capture(guide, 'downloads-before-setup');
    await guide.call('Network.enable');
    await guide.call('Network.setBlockedURLs', { urls: ['*desktop/releases/*'] });
    await guide.call('Page.reload');
    await waitFor(() => guide.evaluate('Boolean(document.querySelector(".downloads-notice .retry-button")) && !document.querySelector(".ilbi-loading")'), 'download error with retry');
    assert(await guide.evaluate('parseFloat(getComputedStyle(document.querySelector(".downloads-notice .retry-button")).borderRadius)>=8'));
    assert.equal(await guide.evaluate('getComputedStyle(document.querySelector(".downloads-notice .retry-button")).fontFamily === getComputedStyle(document.body).fontFamily'), true);
    await capture(guide, 'downloads-retry');
    await guide.call('Network.setBlockedURLs', { urls: [] });
    await guide.evaluate('document.querySelector(".downloads-notice .retry-button").click()');
    await waitFor(() => guide.evaluate(`Boolean(document.querySelector(".downloads-grid")) && document.querySelectorAll(".downloads-button[href]").length === ${available} && !document.querySelector(".downloads-notice") && !document.querySelector(".ilbi-loading")`), 'download retry recovery');
    await setup.evaluate('window.ilbiDesktop.openGuide()');
    await waitFor(() => guide.evaluate('location.pathname === "/desktop-guide" && Boolean(document.querySelector(".desktop-guide-header button"))'), 'return from downloads to illustrated guide');
    await guide.evaluate('setTimeout(()=>document.querySelector(".desktop-guide-header button").click(),50);true');
    await waitFor(async () => !(await targets()).some(item => item.type === 'page' && item.url.includes('/desktop-guide')));
    // An injected input cannot replace the internal official destination.
    await setup.evaluate('document.querySelector("#host").insertAdjacentHTML("beforeend",\'<input type="hidden" name="server" value="https://evil.example">\');document.querySelector("#host>button").click()');
    await waitFor(() => setup.evaluate('location.pathname === "/login"'), 'default keyring selection and encrypted database setup');
    const status = await setup.evaluate('fetch("/desktop/status/").then(response=>response.json())');
    assert.equal(status.desktop, true); assert.equal(status.enrolled, false); assert.equal(status.server, OFFICIAL_SERVER);
    await new Promise((ok,fail)=>{
      const socket=require('node:net').connect({host:'127.0.0.1',port:49243});
      socket.once('connect',()=>{socket.destroy();fail(Error('A single-PC store must not expose a LAN listener'));});
      socket.once('error',error=>error.code==='ECONNREFUSED'?ok():fail(error));
    });
    await waitFor(() => setup.evaluate('document.readyState === "complete" && Boolean(document.querySelector("form")) && !document.querySelector(".ilbi-loading")'), 'login screen');
    const vault = await readFile(join(process.platform === 'linux' ? process.env.XDG_CONFIG_HOME : process.env.APPDATA, 'ILBI/device.vault'));
    assert.equal(vault.includes(Buffer.from(OFFICIAL_SERVER)), false);
    assert.equal(vault.includes(Buffer.from('https://evil.example')), false);
    await capture(setup, 'default-launch-login');
  });
});
