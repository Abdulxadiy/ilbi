import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser/chrome.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, browser;
const qaDirectory = process.env.ILBI_DOCUMENT_QA_DIR || await mkdtemp(join(tmpdir(), 'ilbi-document-qa-'));
const downloadDirectory = join(qaDirectory, 'web-downloads');
try {
  await mkdir(downloadDirectory, { recursive: true });
  server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: join(qaDirectory, 'vite-cache'), optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'lucide-react', 'qrcode', 'html2canvas', 'jspdf', '@zxing/library'] }, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen(); browser = await launchBrowser({ width: 1200, height: 1000 });
  await browser.call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory });
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}/tests/browser/documentShare.html` });
  const wait = async expression => { for (let i=0;i<600;i++) { if(await browser.evaluate(expression)) return; await delay(30); } throw Error('Timeout: '+expression+'\n'+browser.errors.join('\n')); };
  const downloadedPDF = async (filename, destination) => {
    for (let i=0;i<600;i++) {
      try {
        const bytes = await readFile(join(downloadDirectory, filename));
        assert.equal(bytes.subarray(0,5).toString(), '%PDF-'); assert(bytes.length>1000);
        const target = join(qaDirectory, destination); await rename(join(downloadDirectory,filename),target);
        return execFileSync('pdfinfo',[target],{encoding:'utf8'});
      } catch (failure) { if(failure.code!=='ENOENT')throw failure; }
      const alert = await browser.evaluate(`document.querySelector('dialog[open] [role="alert"]')?.textContent`);
      if(alert)throw Error(alert);
      await delay(30);
    }
    throw Error('PDF download did not finish: '+filename);
  };
  const assertPDFQRCode = async filename => {
    const target = join(qaDirectory,filename);
    execFileSync('pdftoppm',['-scale-to','1600','-png','-singlefile',target,target]);
    const dataURL='data:image/png;base64,'+(await readFile(target+'.png')).toString('base64');
    assert.equal(await browser.evaluate(`shareQA.decodeQR(${JSON.stringify(dataURL)})`),'https://ilbi.uz/r/'+'A'.repeat(43));
  };
  const click = text => browser.evaluate(`(()=>{const dialog=[...document.querySelectorAll('dialog[open]')].at(-1);const button=[...(dialog||document).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Button not found: '+${JSON.stringify(text)});button.click();})()`);
  const close = async () => {
    const count = await browser.evaluate(`(()=>{const dialogs=document.querySelectorAll('dialog[open]');const count=dialogs.length;dialogs[count-1].dispatchEvent(new Event('cancel',{cancelable:true}));return count;})()`);
    await wait(`document.querySelectorAll('dialog[open]').length < ${count}`);
  };
  const openReceipt = () => browser.evaluate(`document.querySelector('#qa-receipt-actions button').click()`);
  await wait(`Boolean(window.shareQA)&&Boolean(document.querySelector('#share-qa-receipt img[src^="data:image/png"]'))`);
  await openReceipt(); await wait(`document.querySelector('dialog[open] textarea')?.value.startsWith('https://ilbi.uz/r/')`);
  await click('Havolani nusxalash'); await wait('shareQA.copied.length===1');
  assert.equal((await browser.evaluate('shareQA.copied[0]')).includes('127.0.0.1'), false);
  await click('PDF faylini saqlash'); await wait('shareQA.exports.length===1');
  const receipt = await browser.evaluate('shareQA.exports[0]');
  assert.equal(receipt.widthMm,58); assert(receipt.heightMm>30); assert.match(receipt.html,/11[\s,]?500/);assert.match(receipt.html,/35[\s,]?000/);assert.match(receipt.html,/QQS/);assert.match(receipt.html,/data:image\/png;base64,/);assert.match(receipt.html,/<svg/);assert.doesNotMatch(receipt.html,/<button|<script|fonts\.googleapis/);
  await close(); await browser.evaluate(`shareQA.setWidth('80mm')`); await wait(`document.querySelector('#share-qa-receipt').dataset.paperWidth==='80mm'`);
  await openReceipt(); await click('PDF faylini saqlash'); await wait('shareQA.exports.length===2');
  assert.equal(await browser.evaluate('shareQA.exports[1].widthMm'),80);
  await close(); await browser.evaluate('shareQA.pending=true'); await openReceipt();
  await wait(`document.querySelector('dialog[open]').innerText.includes('Sinxronlashdan keyin')`);
  assert.equal(await browser.evaluate(`Boolean(document.querySelector('dialog[open] textarea'))`),false);
  await click('PDF faylini saqlash'); await wait('shareQA.exports.length===3');
  await close(); await browser.evaluate('shareQA.pending=false;shareQA.offline=true'); await openReceipt();
  await wait(`document.querySelector('dialog[open]').innerText.includes('tekshirib bo‘lmadi')`);
  await click('PDF faylini saqlash'); await wait('shareQA.exports.length===4');
  await close(); await browser.evaluate('shareQA.offline=false;shareQA.web()'); await openReceipt();
  await click('Ilova orqali ulashish'); assert.equal(await browser.evaluate('shareQA.shares.length'),1);
  await browser.evaluate('shareQA.cancelShare=true');await click('Ilova orqali ulashish');
  assert.equal(await browser.evaluate(`Boolean(document.querySelector('dialog[open] [role="alert"]'))`),false);
  await browser.evaluate('shareQA.failCopy=true'); await click('Havolani nusxalash');
  await wait(`Boolean(document.querySelector('dialog[open] [role="alert"]'))`);
  assert.doesNotMatch(await browser.evaluate(`document.querySelector('dialog[open]').innerText`),/nusxalandi/);
  await click('PDF faylini yuklab olish');
  const webReceiptInfo = await downloadedPDF(receipt.filename,'web-receipt-80.pdf');
  assert.match(webReceiptInfo,/Pages:\s+1/);assert.match(webReceiptInfo,/Page size:\s+226\.7/);
  await assertPDFQRCode('web-receipt-80.pdf');
  await wait(`document.querySelector('dialog[open]').innerText.includes('yuklab olindi')`);
  assert.equal(await browser.evaluate('shareQA.prints'),0);
  await browser.resize(390,900);await delay(50);
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  assert.equal(await browser.evaluate(`(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()`),true);
  await close();await browser.evaluate(`shareQA.setWidth('58mm')`);await openReceipt();await click('PDF faylini yuklab olish');
  assert.match(await downloadedPDF(receipt.filename,'web-receipt-58.pdf'),/Page size:\s+164\.4/);
  await assertPDFQRCode('web-receipt-58.pdf');
  await close();await browser.resize(1200,1000);await browser.evaluate('shareQA.renameCurrentIdentity();shareQA.desktop();document.querySelector("#qa-open-invoice").click()');
  await wait(`document.querySelectorAll('#printable-invoice-a4 .invoice-signatures-block img').length===2`);
  await click('Ulashish');await click('PDF faylini saqlash');await wait('shareQA.exports.length===5');
  const invoice = await browser.evaluate('shareQA.exports[4]');
  assert.match(invoice.html,/Sinov kassir/);assert.match(invoice.html,/Sinov mijoz/);assert.match(invoice.html,/Sinov do‘koni/);assert.doesNotMatch(invoice.html,/Changed current/);
  assert.equal(invoice.format,'invoice');assert.equal(invoice.widthMm,210);assert.match(invoice.html,/INV-1043/);assert.equal((invoice.html.match(/<img/g)||[]).length,2);assert.doesNotMatch(invoice.html,/<button|<script/);
  await close();await browser.evaluate('shareQA.web()');await click('Ulashish');await click('PDF faylini yuklab olish');
  const webInvoiceInfo = await downloadedPDF(invoice.filename,'web-invoice-a4.pdf');
  assert.match(webInvoiceInfo,/Pages:\s+1/);assert.match(webInvoiceInfo,/Page size:\s+595\.28 x 841\.89/);
  await wait(`document.querySelector('dialog[open]').innerText.includes('yuklab olindi')`);await close();
  await browser.evaluate(`(()=>{const tbody=document.querySelector('#printable-invoice-a4 tbody'),row=tbody.firstElementChild;for(let i=0;i<75;i++){const clone=row.cloneNode(true);clone.firstElementChild.textContent=i+3;tbody.insertBefore(clone,tbody.lastElementChild);}})()`);
  await click('Ulashish');await click('PDF faylini yuklab olish');
  const longInvoiceInfo = await downloadedPDF(invoice.filename,'web-invoice-multiple-pages.pdf');
  assert.match(longInvoiceInfo,/Pages:\s+[3-9]/);
  const report = await browser.evaluate(`shareQA.prepareSharedDocument({elementId:'share-qa-z-report',title:'ILBI Z-Hisobot 7',paperWidth:'58mm'})`);
  assert.match(report.html,/Z - HISOBOT/);assert.match(report.html,/35[\s,]?000/);
  await browser.evaluate(`shareQA.saveSharedDocument({elementId:'share-qa-z-report',title:'ILBI Z-Hisobot 7',paperWidth:'58mm'})`);
  assert.match(await downloadedPDF(report.filename,'web-z-report.pdf'),/Page size:\s+164\.4/);
  await browser.evaluate(`(()=>{const slip=document.createElement('div');slip.id='qa-short-receipt';slip.textContent='Qisqa chek';document.body.append(slip);return shareQA.saveSharedDocument({elementId:slip.id,title:'Qisqa chek',paperWidth:'80mm'});})()`);
  assert.match(await downloadedPDF('Qisqa chek.pdf','web-short-receipt.pdf'),/Page size:\s+226\.7[\d]* x 85\.0/);
  if(process.env.ILBI_DOCUMENT_QA_DIR){await mkdir(process.env.ILBI_DOCUMENT_QA_DIR,{recursive:true});await writeFile(`${process.env.ILBI_DOCUMENT_QA_DIR}/documents.json`,JSON.stringify([receipt,await browser.evaluate('shareQA.exports[1]'),invoice,report]));}
  await browser.evaluate('shareQA.web();shareQA.failCopy=false;shareQA.setPublicView(true)');
  await wait(`Boolean(document.querySelector('#public-receipt-document'))`);await click('Ulashish');await click('Havolani nusxalash');
  await wait('shareQA.copied.length===2');assert.match(await browser.evaluate('shareQA.copied[1]'),/^https:\/\/ilbi\.uz\/r\//);
  await close();await click('PDF yuklab olish');
  assert.match(await downloadedPDF(receipt.filename,'web-public-receipt.pdf'),/Pages:\s+1/);
  assert.deepEqual(browser.errors,[]);
  console.log('PASS document sharing: public links, pending/offline receipts, clipboard failure, canceled native share, direct web PDF downloads (58/80 mm, signed A4, multiple pages, public receipt), tax/QR preservation and mobile layout.');
} finally { if(browser)await browser.close();if(server)await server.close();if(!process.env.ILBI_DOCUMENT_QA_DIR)await rm(qaDirectory,{recursive:true,force:true}); }
