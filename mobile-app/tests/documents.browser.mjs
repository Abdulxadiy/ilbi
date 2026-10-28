/** Actual HTML/PDF rendering in an isolated Chrome profile; no native/provider acceptance. */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { launchBrowser } from '../../frontend/ilbi/tests/browser/chrome.mjs';

const require = createRequire(import.meta.url);
require('ts-node').register({ skipProject: true, transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'Node', ignoreDeprecations: '6.0', target: 'es2022' } });
const { documentHtml, parseDocumentSale } = require('../src/features/receipts/documentModel.ts');
const contract = JSON.parse(await readFile(new URL('./contracts/documents.json', import.meta.url), 'utf8'));
const output = resolve(process.env.ILBI_DOCUMENT_EVIDENCE || '/tmp/ilbi-document-render');
await mkdir(output, { recursive: true });
const browser = await launchBrowser({ width: 794, height: 1123 });
const results = [];
async function render(name, sale, format, widthMm = 210, screenshot = false) {
  const html = documentHtml(sale, format);
  await writeFile(join(output, name + '.html'), html);
  await browser.resize(Math.ceil(widthMm * 96 / 25.4), 1123);
  const { frameTree } = await browser.call('Page.getFrameTree');
  await browser.call('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  await browser.evaluate('document.fonts.ready.then(() => true)');
  assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, name + ' overflow');
  assert.equal(await browser.evaluate('document.querySelectorAll("script,iframe,link,img[src^=http]").length'), 0);
  const pdf = await browser.call('Page.printToPDF', { printBackground: true, preferCSSPageSize: format === 'a4', paperWidth: widthMm / 25.4, paperHeight: 297 / 25.4, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  const file = join(output, name + '.pdf');
  await writeFile(file, Buffer.from(pdf.data, 'base64'));
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
  const text = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });
  assert.match(text, /Saved <store>/); assert.match(text, /Fiskal\s+chek\s+emas/);
  assert.ok(!text.includes('Changed current store') && !text.includes('Changed catalog'));
  const pageSize = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/), pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]);
  assert.ok(pageSize, info);
  assert.ok(Math.abs(Number(pageSize[1]) - widthMm * 72 / 25.4) < 1, info);
  assert.ok(pages > 0);
  if (screenshot) {
    const shot = await browser.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  results.push({ name, format, width_mm: widthMm, pdf_width_points: Number(pageSize[1]), pages, contains_saved_identity: true, fiscal_label: 'nonfiscal', no_overflow: true });
  return { text, pages };
}
try {
  for (const [name, raw] of Object.entries(contract.sales)) {
    const sale = parseDocumentSale(raw, raw.id);
    const { text } = await render(name + '-a4', sale, 'a4', 210, name === 'debt_returned');
    assert.ok(text.includes('274,40') && text.includes('29,40'), name + ' authoritative amounts');
    for (const line of raw.items) { assert.ok(text.includes(line.product_sku)); assert.ok(text.includes(line.product_barcode)); }
    if (name === 'debt_returned') assert.ok(text.includes('246,40') && text.includes('0.250'));
  }
  const base = parseDocumentSale(contract.sales.debt_returned, contract.sales.debt_returned.id);
  for (const width of [58, 80]) await render('thermal-' + width, { ...base, receipt_snapshot: { ...base.receipt_snapshot, receipt_paper_width: width + 'mm' } }, 'receipt', width, true);
  // Explicit synthetic stress case built from a validated source; not another API transaction.
  const many = { ...base, items: Array.from({ length: 400 }, (_, index) => ({ ...base.items[index % 2], id: 100000 + index, product_name: 'Stress line ' + (index + 1) })) };
  const long = await render('synthetic-400-lines-a4', many, 'a4');
  assert.ok(long.pages > 5); assert.ok(long.text.includes('Stress line 400'));
  assert.ok(long.text.lastIndexOf('246,40') > long.text.indexOf('Stress line 400'), 'final totals retained after last row');
  assert.deepEqual(browser.errors, []);
  await writeFile(join(output, 'result.json'), JSON.stringify({ boundary: 'Actual Chrome HTML/PDF rendering of scoped API fixtures plus explicitly synthetic stress rows; not Android/iOS file, printer, signature or fiscal acceptance', results }, null, 2) + '\n');
  console.log('PASS: selected-sale A4, 58/80mm PDF widths, escaped saved identities, tax/returns/codes and 400-row multipage totals in isolated Chrome.');
} finally { await browser.close(); }
