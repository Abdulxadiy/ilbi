import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser/chrome.mjs';
let server, browser;
try {
  server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'error',server:{host:'127.0.0.1',port:0}}); await server.listen();
  browser=await launchBrowser({width:1440,height:1000});
  const wait=async expression=>{for(let i=0;i<200;i++){if(await browser.evaluate(expression))return;await new Promise(ok=>setTimeout(ok,40))}throw Error(expression)};
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${server.httpServer.address().port}/tests/browser/updates.html`});
  await wait('Boolean(document.querySelector(".desktop-update-notice"))');
  for(const [width,theme] of [[1440,'light'],[1440,'dark'],[390,'light'],[390,'dark']]){
    await browser.resize(width,900);await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    assert(await browser.evaluate('(()=>{const box=document.querySelector(".desktop-update-notice").getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&document.querySelector(".desktop-update-notice>.btn").getBoundingClientRect().height>=40})()'));
  }
  await browser.evaluate('document.querySelector(".desktop-update-close").click()');
  await wait('!document.querySelector(".desktop-update-notice")');
  await browser.evaluate('updateQA.send({phase:"available"});updateQA.render()');
  await new Promise(ok=>setTimeout(ok,200));
  assert.equal(await browser.evaluate('Boolean(document.querySelector(".desktop-update-notice"))'),false,'Reload/login on the same day must not repeat a dismissed reminder');
  await browser.evaluate('updateQA.now+=86400000;window.dispatchEvent(new Event("focus"))');
  await wait('Boolean(document.querySelector(".desktop-update-notice"))');
  await browser.evaluate('updateQA.render(null)');
  await wait('!document.querySelector(".desktop-update-notice")');
  await browser.evaluate('updateQA.render(1)');
  await new Promise(ok=>setTimeout(ok,200));
  assert.equal(await browser.evaluate('Boolean(document.querySelector(".desktop-update-notice"))'),false);
  await browser.evaluate('updateQA.now+=86400000;window.dispatchEvent(new Event("focus"))');
  await wait('Boolean(document.querySelector(".desktop-update-notice"))');
  await browser.evaluate('document.querySelector(".desktop-update-notice>.btn").click()');
  await wait('document.querySelector("progress")?.value===42');
  assert.equal(await browser.evaluate('updateQA.calls'),1);
  assert.equal(await browser.evaluate('Boolean(document.querySelector(".desktop-update-notice>.btn"))'),false);
  await browser.evaluate('updateQA.send({phase:"error",bytes:200,message:"Internet uzildi. Qayta urinib ko‘ring."})');
  await wait('document.querySelector(".desktop-update-notice>.btn")?.textContent.includes("Qayta")');
  await browser.evaluate('document.querySelector(".desktop-update-notice>.btn").click()');
  assert.equal(await browser.evaluate('updateQA.calls'),2);
  await browser.evaluate('updateQA.send({phase:"updated",message:"ILBI yangilandi."})');
  await wait('document.querySelector(".desktop-update-heading strong").textContent==="ILBI yangilandi"');
  await browser.evaluate('document.querySelector(".desktop-update-close").click()');
  await wait('!document.querySelector(".desktop-update-notice")');
  await browser.evaluate('updateQA.unmount()');
  assert.equal(await browser.evaluate('updateQA.listeners.size'),0);
  assert.deepEqual(browser.errors,[]);
  console.log('PASS desktop update notice: daily outdated reminder, same-day dismissal across remount/login, next-day reminder, guest exclusion, available/download/progress/retry/success, light/dark/mobile and subscription cleanup.');
}finally{await browser?.close();await server?.close()}
