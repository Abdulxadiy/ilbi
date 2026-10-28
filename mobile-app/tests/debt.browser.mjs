import assert from 'node:assert/strict';
import { createPreviewCore } from '../src/dev/previewCore.ts';
import { startPreview } from './previewHarness.mjs';

/** These checks exercise only the explicitly synthetic source handler, never a network API. */
function checkSyntheticFixture() {
  const fixture = (uzs = '100000.00', usd = '0.00') => {
    const customers = [{ id: 10, name: 'Synthetic debt customer', debt_balance_uzs: uzs, debt_balance_usd: usd }];
    const user = { id: 7, tenants: [{ id: 1 }, { id: 2 }] };
    const core = createPreviewCore({ user, customers, products: [], sales: new Map() });
    const call = (path, method = 'GET', body = {}) => { const result = core(new URL(path, 'http://design.invalid'), method, body); assert.equal(result.handled, true); return result.data; };
    const calculate = (amount = '5.00', currency = 'USD', extra = '') => call('/sales/counterparties/10/payments/quote/?amount=' + amount + '&currency=' + currency + '&payment_type=cash' + extra);
    return { customers, call, calculate };
  };
  const one = fixture(), before = JSON.stringify(one.customers), quote = one.calculate();
  assert.equal(JSON.stringify(one.customers), before, 'quote GET must not mutate financial state');
  assert.deepEqual(quote.applied, { UZS: '65000.00', USD: '0.00' }); assert.deepEqual(quote.remaining, { UZS: '35000.00', USD: '0.00' });
  assert.equal(quote.exchange_rate, '13000.000000'); assert.match(quote.expected_quote, /^[a-f0-9]{64}$/);
  assert.equal(one.calculate().expected_quote, quote.expected_quote, 'unchanged quote token must survive the command preflight reread');
  const body = { amount: '5.00', currency: 'USD', payment_type: 'cash', branch_id: 1, note: 'Synthetic source test', idempotency_key: 'synthetic-original-key', expected_quote: quote.expected_quote };
  const first = one.call('/sales/counterparties/10/payments/', 'POST', body);
  assert.deepEqual(first.payment_operation, { protocol: quote.protocol, actor_id: 7, tenant_id: 1, counterparty_id: 10, branch_id: 1, idempotency_key: body.idempotency_key, expected_quote: quote.expected_quote });
  assert.equal(one.customers[0].debt_balance_uzs, '35000.00');
  assert.deepEqual(one.call('/sales/counterparties/10/payments/', 'POST', body), first, 'original-key replay must return the original result');
  assert.equal(one.customers[0].debt_balance_uzs, '35000.00', 'an old completed dialog cannot deduct twice');
  assert.throws(() => one.call('/sales/counterparties/10/payments/', 'POST', { ...body, amount: '4.00' }), /boshqa to‘lov/);
  assert.equal(one.customers[0].debt_balance_uzs, '35000.00');
  const changed = fixture(), stale = changed.calculate(); changed.customers[0].debt_balance_uzs = '90000.00';
  assert.throws(() => changed.call('/sales/counterparties/10/payments/', 'POST', { ...body, expected_quote: stale.expected_quote }), /qoldig‘i yoki kurs o‘zgardi/);
  assert.equal(changed.customers[0].debt_balance_uzs, '90000.00');
  const over = fixture(), excessive = over.calculate('10.00'); assert.equal(excessive.creates_credit, true);
  assert.throws(() => over.call('/sales/counterparties/10/payments/', 'POST', { ...body, amount: '10.00', expected_quote: excessive.expected_quote }), /avans/);
  assert.equal(over.customers[0].debt_balance_uzs, '100000.00');
  const mixed = fixture('100000.00', '2.00').calculate(); assert.deepEqual(mixed.applied, { UZS: '39000.00', USD: '2.00' });
  const credited = fixture('-50.00', '10.00').calculate(); assert.equal(credited.creates_credit, false); assert.equal(credited.exchange_rate, null);
  assert.deepEqual(credited.remaining, { UZS: '-50.00', USD: '5.00' });
  const cent = fixture('1.00'), centQuote = cent.calculate('0.01', 'UZS');
  cent.call('/sales/counterparties/10/payments/', 'POST', { ...body, amount: '0.01', currency: 'UZS', expected_quote: centQuote.expected_quote });
  assert.equal(cent.customers[0].debt_balance_uzs, '0.99');
  const summary = cent.call('/sales/counterparties/?balance_status=debtors&page=1'); assert.equal(summary.summary.total_debt_uzs, '0.99');
  assert.equal(fixture().calculate('5.00', 'USD', '&branch_id=2').branch_id, 2);
  console.log('PASS: explicit synthetic quote is read-only; exact UZS/USD allocation, original-key replay, changed-body/stale/credit rejection, branch binding and cents preserve balances.');
}
checkSyntheticFixture();
if (process.argv.includes('--fixture-only')) process.exit(0);

const { browser, doc, waitFor, click, fill, screenshot } = await startPreview('debt-quote-2026-10-27');
const debtCard = `(() => { const d=${doc}; const cards=[...d.querySelectorAll('[role="button"][aria-label="To‘lov qabul qilish"]')].map(button=>button.parentElement); const card=cards.find(node=>[...node.children].some(child=>child.textContent==='Ali Valiyev')); return card?.innerText.replace(/\u00a0|\u202f/g,' '); })()`;
try {
  await click('Menyu', 'tab'); await click('Qarzlar');
  await waitFor(`${doc}.querySelector('input[aria-label="Mijoz qidirish (ism, telefon, STIR)"]') && ${debtCard}?.includes('Ali Valiyev')`, 'authoritative-shaped synthetic debt list');
  const initialCard = await browser.evaluate(debtCard);
  assert.ok(initialCard.includes('230 000 UZS / 0 USD'), 'initial Ali debt card: ' + JSON.stringify(initialCard));
  await click('To‘lov qabul qilish');
  await waitFor(`${doc}.querySelector('input[aria-label="To‘lov summasi"]')`, 'payment dialog');
  await fill('To‘lov summasi', '230001'); await click('To‘lovni hisoblash');
  await waitFor(`${doc}.querySelector('input[aria-label="To‘lov summasi"]')?.getAttribute('aria-invalid')==='true'`, 'credit creating amount is red');
  await screenshot('overpayment-field-error');
  assert.ok((await browser.evaluate(debtCard)).includes('230 000 UZS / 0 USD'), 'rejected calculation must not change debt');
  await click('USD'); await fill('To‘lov summasi', '5'); await click('To‘lovni hisoblash');
  await waitFor(`${doc}.body.innerText.includes('Serverdagi to‘lov hisobi')`, 'read-only USD allocation');
  const quoteText = await browser.evaluate(`${doc}.body.innerText.replace(/\u00a0|\u202f/g,' ')`);
  assert.ok(quoteText.includes('UZS qarziga: 65 000 UZS')); assert.ok(quoteText.includes('Qoladigan qarz: 165 000 UZS / 0 USD')); assert.ok(quoteText.includes('13000.000000'));
  assert.ok((await browser.evaluate(debtCard)).includes('230 000 UZS / 0 USD'), 'successful GET calculation must still leave the saved balance unchanged');
  await screenshot('usd-to-uzs-quote');
  const point = await browser.evaluate(`(() => { const d=${doc}, node=[...d.querySelectorAll('[role="button"]')].find(el=>el.getAttribute('aria-label')==='To‘lovni tasdiqlash' && !el.closest('[aria-hidden="true"],[inert]')); if(!node)throw Error('Confirmation missing'); node.scrollIntoView({block:'center'}); const r=node.getBoundingClientRect(),f=document.querySelector('#app').getBoundingClientRect(); return {x:f.x+r.x+r.width/2,y:f.y+r.y+r.height/2}; })()`);
  for (let count = 1; count <= 2; count++) {
    await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: count });
    await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: count });
  }
  await waitFor(`${doc}.body.innerText.includes('To‘lov serverda tasdiqlandi.')`, 'guarded payment acknowledged');
  await waitFor(`${debtCard}?.includes('165 000 UZS / 0 USD')`, 'single confirmed balance deduction');
  await screenshot('confirmed-payment');
  await click('To‘lov qabul qilish');
  await waitFor(`${doc}.querySelector('input[aria-label="To‘lov summasi"]')?.value==='165000.00'`, 'new dialog reads the updated saved debt');
  assert.equal(await browser.evaluate(`${doc}.body.innerText.includes('Serverdagi to‘lov hisobi')`), false);
  assert.ok(await browser.evaluate(`[...${doc}.querySelectorAll('[role="button"]')].some(el=>el.getAttribute('aria-label')==='To‘lovni hisoblash')`));
  await click('Ali Valiyevni yopish');
  assert.ok((await browser.evaluate(debtCard)).includes('165 000 UZS / 0 USD'), 'opening/closing a later dialog cannot replay the completed payment');
  await browser.evaluate("document.querySelector('#device').value='320,640';document.querySelector('#device').dispatchEvent(new Event('change'));true");
  await waitFor(`${doc}.documentElement.clientWidth===320`, 'narrow phone preview');
  assert.ok(await browser.evaluate(`${doc}.documentElement.scrollWidth<=320`)); assert.deepEqual(browser.errors, []);
  console.log('PASS: isolated Chrome red overpayment, read-only USD→UZS quote, exact remaining balance, duplicate confirmation protection and fresh-dialog reset. Explicit synthetic preview only; no native or production payment acceptance claimed.');
} catch (error) {
  await screenshot('failure');
  console.error('Debt QA diagnostic', JSON.stringify(await browser.evaluate(`(() => { const d=${doc}; const leaves=[...d.querySelectorAll('*')].filter(el=>!el.children.length && el.textContent==='Ali Valiyev'); return {body:d.body.innerText.slice(0,5000), card:${debtCard}, matches:leaves.map(node=>{const rows=[];for(let i=0;i<4&&node;i++,node=node.parentElement)rows.push({tag:node.tagName,role:node.getAttribute('role'),text:node.innerText,html:node.outerHTML.slice(0,1800)});return rows;})}; })()`)));
  throw error;
} finally { await browser.close(); }
