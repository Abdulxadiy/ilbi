import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser/chrome.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const artifacts = await mkdtemp(join(tmpdir(), 'ilbi-desktop-guide-'));
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/downloads/releases.json' || path === '/api/v1/support/guest/') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(path === '/downloads/releases.json' ? { schema: 1, windows: null, linux: null, mobile: null } : {}));
      return;
    }
    if (path.startsWith('/api/') || path.startsWith('/desktop/')) { response.writeHead(503); response.end(); return; }
    const file = extname(path) ? resolve(dist, '.' + path) : join(dist, 'index.html');
    assert(file.startsWith(dist));
    let body = await readFile(file);
    if (extname(file) === '.png') await new Promise(ok => setTimeout(ok, 1500));
    // The packaged desktop removes remote font links, so this test does the same.
    if (extname(file) === '.html') body = Buffer.from(body.toString().replace(/<link\b[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/g, ''));
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }[extname(file)];
    response.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }); response.end(body);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await launchBrowser({ width: 390, height: 900 });
  await browser.call('Network.setBlockedURLs', { urls: ['https://*'] });
  const wait = async expression => {
    for (let i = 0; i < 300; i++) { if (await browser.evaluate(expression)) return; await new Promise(ok => setTimeout(ok, 40)); }
    throw Error('Guide check timed out: ' + expression);
  };
  await browser.call('Page.navigate', { url: origin + '/download' });
  await wait('Boolean(document.querySelector("#panel-updates")) && !document.querySelector(".ilbi-loading")');
  assert.equal(await browser.evaluate('document.querySelector("#tab-updates").getAttribute("aria-selected")'), 'true');
  await browser.evaluate('document.querySelector("#tab-downloads").click()');
  await wait('Boolean(document.querySelector(".downloads-linux-guide")) && !document.querySelector(".ilbi-loading")');
  await browser.evaluate('document.querySelector(".downloads-linux-guide").scrollIntoView();document.querySelector(".downloads-linux-guide").click()');
  await wait('Boolean(document.getElementById("7-linux-uchun-batafsil-qollanma")) && !document.querySelector(".ilbi-loading")');
  await wait('document.getElementById("7-linux-uchun-batafsil-qollanma").getBoundingClientRect().top >= 0 && document.getElementById("7-linux-uchun-batafsil-qollanma").getBoundingClientRect().top < innerHeight / 2');
  assert.equal(await browser.evaluate('[...document.querySelectorAll(".doc-focus-trigger img")].every(image=>Number(image.getAttribute("width"))>0&&Number(image.getAttribute("height"))>0)'), true);
  await browser.evaluate('Promise.all([...document.querySelectorAll(".doc-focus-trigger img")].map(image=>{image.loading="eager";return image.decode()}))');
  assert.equal(await browser.evaluate('document.getElementById("7-linux-uchun-batafsil-qollanma").getBoundingClientRect().top >= 0 && document.getElementById("7-linux-uchun-batafsil-qollanma").getBoundingClientRect().top < innerHeight / 2'), true);
  await browser.resize(1440, 1000);
  await browser.call('Page.navigate', { url: origin + '/desktop-guide#7-linux-uchun-batafsil-qollanma' });
  await wait('Boolean(document.getElementById("7-linux-uchun-batafsil-qollanma")) && !document.querySelector(".ilbi-loading")');
  await wait('document.getElementById("7-linux-uchun-batafsil-qollanma").getBoundingClientRect().top >= 0 && document.getElementById("7-linux-uchun-batafsil-qollanma").getBoundingClientRect().top < innerHeight / 2');
  await browser.call('Page.navigate', { url: origin + '/desktop-guide' });
  await wait('document.querySelector("h1")?.textContent === "ILBI ilovasini sozlash"');
  await wait('!document.querySelector(".ilbi-loading")');
  assert.equal(await browser.evaluate('document.querySelectorAll(".desktop-guide-toc a").length'), 7);
  assert.equal(await browser.evaluate('document.querySelector(".desktop-guide-article").textContent.includes("Arch Linux uchun qadamlar") && document.querySelector(".desktop-guide-article").textContent.includes("bash install.sh")'), true);
  assert.equal(await browser.evaluate('document.querySelectorAll(".doc-focus-trigger img").length'), 7);
  await browser.evaluate('Promise.all([...document.querySelectorAll(".doc-focus-trigger img")].map(img=>{img.loading="eager";return img.decode()}))');
  assert.equal(await browser.evaluate('[...document.querySelectorAll(".doc-focus-trigger img")].every(img=>img.naturalWidth>0&&!img.src.includes("undefined"))'), true);
  await browser.evaluate('document.querySelector(".doc-focus-trigger").click()');
  await wait('Boolean(document.querySelector("dialog[open]"))');
  await browser.evaluate('document.querySelector("dialog[open] button[aria-label=Kattalashtirish]").click()');
  assert.equal(await browser.evaluate('Boolean(document.querySelector("dialog[open] img.is-zoomed"))'), true);
  await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait('!document.querySelector("dialog[open]")');
  await writeFile(join(artifacts, 'guide-desktop.png'), Buffer.from((await browser.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await browser.resize(390, 844);
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  await writeFile(join(artifacts, 'guide-mobile.png'), Buffer.from((await browser.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await browser.evaluate('document.querySelector(".desktop-guide-toc a:last-of-type").click()');
  await wait('document.querySelector(".desktop-guide-article h2:last-of-type").getBoundingClientRect().top < innerHeight');
  await browser.call('Page.reload');
  await wait('document.querySelectorAll(".doc-focus-trigger img").length===7');
  await browser.evaluate('Promise.all([...document.querySelectorAll(".doc-focus-trigger img")].map(img=>{img.loading="eager";return img.decode()}))');
  assert.deepEqual(browser.errors, []);
  console.log(JSON.stringify({ passed: true, scenarios: ['built guide without cloud/backend', 'all seven bundled images', 'image zoom and Escape', 'seven section anchors with detailed Linux instructions last', 'mobile download-to-guide link while images load slowly', 'direct Linux link without image layout jumps', 'mobile layout', 'reload without internet'], artifacts }));
} finally { await browser?.close(); await new Promise(ok => server.close(ok)); }
