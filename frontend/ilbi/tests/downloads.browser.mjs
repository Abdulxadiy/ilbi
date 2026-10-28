import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser } from './browser/chrome.mjs';

const artifacts = await mkdtemp(join(tmpdir(), 'ilbi-downloads-ui-'));
let server, browser;
try {
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: 'node_modules/.vite-downloads-qa', logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await launchBrowser({ width: 1280, height: 1000 });
  await browser.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.downloadsQA={mode:sessionStorage.getItem('download-mode')||'published'};
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,options)=>{
      const path=new URL(input,location.origin).pathname;
      if(path==='/downloads/releases.json'){
        if(downloadsQA.mode==='offline')throw new TypeError('Offline');
        if(downloadsQA.mode==='missing')return new Response('',{status:404});
        if(downloadsQA.delay)await new Promise(resolve=>setTimeout(resolve,downloadsQA.delay));
        return new Response(JSON.stringify({schema:1,windows:{version:'1.2.0',url:'/downloads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ILBI-Setup-1.2.0-x64.exe',bytes:196124625,channel:'preview',sha256:'a'.repeat(64)},linux:downloadsQA.mode==='legacy'?null:{version:'1.2.0',url:'/downloads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ILBI-1.2.0-linux-x64.tar.gz',bytes:210000000,channel:'preview',sha256:'b'.repeat(64)},mobile:downloadsQA.mode==='mobile'?{android:{version:'1.0.0',buildNumber:'2',url:'/downloads/mobile/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ILBI-1.0.0-android-2.apk',bytes:42000000,sha256:'c'.repeat(64),channel:'preview'},ios:{version:'1.0.0',buildNumber:'1',url:'https://apps.apple.com/uz/app/ilbi/id123456789',channel:'preview'}}:null}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(sessionStorage.getItem('download-auth')==='true'){
        if(path==='/api/v1/auth/me/'){
          return new Response(JSON.stringify({id:1,username:'owner_test',role:'owner',first_name:'Do‘kon',last_name:'Egasi',terms_accepted:true,permissions:['*']}),{status:200,headers:{'Content-Type':'application/json'}});
        }
        if(path==='/api/v1/auth/token/refresh/'){
          const t='fixture.'+btoa(JSON.stringify({user_id:1,exp:Math.floor(Date.now()/1000)+7200,token_type:'access'}))+'.fixture';
          return new Response(JSON.stringify({access:t,refresh:t}),{status:200,headers:{'Content-Type':'application/json'}});
        }
        if(path.startsWith('/api/v1/support/'))return new Response(JSON.stringify({results:[],count:0,unread_total:0}),{status:200,headers:{'Content-Type':'application/json'}});
        if(path.includes('/notifications/'))return new Response(JSON.stringify({results:[],unread_count:0}),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(path.startsWith('/api/'))return new Response('{}',{status:401,headers:{'Content-Type':'application/json'}});
      return originalFetch(input,options);
    };
  ` });
  const wait = async expression => {
    for (let index = 0; index < 200; index++) {
      if (await browser.evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw Error('Timed out: ' + expression);
  };
  await browser.call('Page.navigate', { url: origin + '/' });
  await wait('Boolean(document.querySelector(".lp-nav a[href=\\\"/download\\\"]"))');
  await browser.evaluate('document.querySelector(".lp-nav a[href=\\\"/download\\\"]").click()');
  await wait('Boolean(document.querySelector(".downloads-button[href]"))');
  await wait('!document.querySelector(".ilbi-loading")');
  assert.equal(await browser.evaluate('location.pathname'), '/download');
  assert.equal(await browser.evaluate('document.querySelector(".downloads-button[href]").href'), origin + '/downloads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ILBI-Setup-1.2.0-x64.exe');
  assert.equal(await browser.evaluate('document.querySelector(".downloads-preview").textContent'), 'Sinov nusxasi');
  assert.equal(await browser.evaluate('document.querySelectorAll(".downloads-card button:disabled").length'), 2);
  assert.equal(await browser.evaluate('document.querySelector("[data-platform=linux] a.downloads-button").href'), origin + '/downloads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ILBI-1.2.0-linux-x64.tar.gz');
  assert.equal(await browser.evaluate('document.querySelector(".downloads-linux-install").textContent.includes("bash install.sh")'), true);
  assert.equal(await browser.evaluate('document.querySelector(".downloads-linux-install").lastElementChild.matches("a.downloads-linux-guide")'), true);
  assert.equal(await browser.evaluate('document.querySelector(".downloads-linux-guide").getAttribute("href")'), '/desktop-guide#7-linux-uchun-batafsil-qollanma');
  await writeFile(join(artifacts, 'downloads-desktop.png'), Buffer.from((await browser.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  assert.equal(await browser.evaluate('Boolean(document.querySelector(".downloads-checksum"))'), false);
  assert.equal(await browser.evaluate('document.body.innerText.includes("a".repeat(64)) || document.body.innerText.includes("b".repeat(64))'), false);
  await browser.resize(390, 844);
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  await writeFile(join(artifacts, 'downloads-mobile.png'), Buffer.from((await browser.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  for (const mode of ['missing', 'offline']) {
    await browser.evaluate(`sessionStorage.setItem('download-mode',${JSON.stringify(mode)});window.downloadBeforeReload=true`);
    await browser.call('Page.reload');
    await wait('!window.downloadBeforeReload&&Boolean(document.querySelector(".downloads-grid"))');
    await wait(mode === 'missing' ? 'document.querySelector(".downloads-card button")?.textContent.includes("hali ochilmagan")' : 'Boolean(document.querySelector(".downloads-notice button"))');
    assert.equal(await browser.evaluate('document.querySelectorAll(".downloads-button[href]").length'), 0);
  }
  for (const [width, theme] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [390, 'dark']]) {
    await browser.resize(width, 900);
    await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    const control = await browser.evaluate(`(() => {
      const button=document.querySelector('.downloads-notice .retry-button');
      const style=getComputedStyle(button), rect=button.getBoundingClientRect();
      return {height:rect.height,radius:parseFloat(style.borderRadius),fontMatches:style.fontFamily===getComputedStyle(document.body).fontFamily,overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    assert(control.height >= 40); assert(control.radius >= 8); assert(control.fontMatches); assert.equal(control.overflow, false);
    await writeFile(join(artifacts, `downloads-retry-${theme}-${width}.png`), Buffer.from((await browser.call('Page.captureScreenshot', {format:'png'})).data, 'base64'));
  }
  await browser.evaluate('downloadsQA.mode="published";downloadsQA.delay=500;document.querySelector(".downloads-notice .retry-button").click()');
  await wait('document.querySelector(".downloads-notice .retry-button")?.disabled && document.querySelector(".downloads-notice .retry-button")?.getAttribute("aria-busy") === "true"');
  await wait('Boolean(document.querySelector(".downloads-button[href]"))');
  assert.deepEqual(browser.errors, []);
  await browser.evaluate('sessionStorage.setItem("download-mode","legacy");window.downloadBeforeReload=true');
  await browser.call('Page.reload');
  await wait('!window.downloadBeforeReload&&Boolean(document.querySelector("[data-platform=linux] button:disabled"))');
  assert.equal(await browser.evaluate('document.querySelectorAll(".downloads-button[href]").length'), 1);

  await browser.evaluate('sessionStorage.setItem("download-mode","mobile");window.downloadBeforeReload=true');
  await browser.call('Page.reload');
  await wait('!window.downloadBeforeReload && Boolean(document.querySelector("[data-platform=android] a.downloads-button"))');
  assert.equal(await browser.evaluate('document.querySelector("[data-platform=android] a.downloads-button").getAttribute("href")'), origin + '/downloads/mobile/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ILBI-1.0.0-android-2.apk');
  assert.equal(await browser.evaluate('document.querySelector("[data-platform=ios] a.downloads-button").href'), 'https://apps.apple.com/uz/app/ilbi/id123456789');
  assert.equal(await browser.evaluate('document.querySelector("[data-platform=android]").textContent.includes("Yig‘ilma 2")'), true);
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  assert.equal(await browser.evaluate('document.querySelectorAll(".downloads-button[href]").length'), 4);

  // Authenticated in-app scenario: tabs navigation, check for updates, and tab switching
  await browser.evaluate(`
    const makeJwt = kind => 'fixture.' + btoa(JSON.stringify({ user_id: 1, exp: Math.floor(Date.now() / 1000) + 7200, token_type: kind })) + '.fixture';
    const access = makeJwt('access');
    const refresh = makeJwt('refresh');
    localStorage.setItem('ilbi_access_token', access);
    localStorage.setItem('ilbi_refresh_token', refresh);
    localStorage.setItem('ilbi_user', JSON.stringify({ id: 1, username: 'owner_test', role: 'owner', first_name: 'Do‘kon', last_name: 'Egasi', terms_accepted: true, permissions: ['*'] }));
    sessionStorage.setItem('download-auth', 'true');
    sessionStorage.setItem('download-mode', 'published');
    window.downloadBeforeReload = true;
  `);
  await browser.call('Page.reload');
  await wait('!window.downloadBeforeReload && Boolean(document.querySelector(".downloads-tabs-nav"))');
  assert.equal(await browser.evaluate('Boolean(document.querySelector("#tab-updates.active"))'), true);
  assert.equal(await browser.evaluate('Boolean(document.querySelector("#panel-updates"))'), true);
  assert.equal(await browser.evaluate('Boolean(document.querySelector(".updates-check-btn"))'), true);
  assert.equal(await browser.evaluate('Boolean(document.querySelector(".updates-switch-btn"))'), true);

  // Switch to downloads tab via switch banner button
  await browser.evaluate('document.querySelector(".updates-switch-btn").click()');
  await wait('Boolean(document.querySelector("#panel-downloads"))');
  assert.equal(await browser.evaluate('Boolean(document.querySelector("#tab-downloads.active"))'), true);
  assert.equal(await browser.evaluate('Boolean(document.querySelector(".downloads-grid"))'), true);

  // Switch back to updates tab via top tab pill
  await browser.evaluate('document.querySelector("#tab-updates").click()');
  await wait('Boolean(document.querySelector("#panel-updates"))');
  assert.equal(await browser.evaluate('Boolean(document.querySelector("#tab-updates.active"))'), true);

  // Trigger update check
  await browser.evaluate('document.querySelector(".updates-check-btn").click()');
  await wait('Boolean(document.querySelector(".updates-status-desc"))');

  console.log(JSON.stringify({ passed: true, scenarios: ['landing download link', 'anonymous download page', 'versioned Windows and Linux links', 'Linux installation guide', 'preview label', 'unpublished Android/iOS states', 'separate published Android/iOS links and mobile build', 'mobile layout', 'missing release', 'offline and retry', 'retry controls in light/dark desktop/mobile themes', 'disabled retry during request', 'older feed without Linux', 'authenticated in-app update checks', 'authenticated tab switching'], artifacts }));

} catch (error) {
  console.error('Browser errors:', browser?.errors);
  if (browser) console.error(await browser.evaluate('({body:document.body.innerText.slice(0,1500),url:location.href})'));
  throw error;
} finally { await browser?.close(); await server?.close(); }
