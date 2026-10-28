import contract from './contracts/documents.json';
import { documentDate, documentHtml, documentPrintOptions, invoiceTitle, parseDocumentSale, publicReceiptUrl } from '../src/features/receipts/documentModel';
import { receiptMoney, receiptView } from '../src/features/receipts/receiptModel';

describe('Saved document contract and export content', () => {
  test.each(Object.entries(contract.sales))('%s uses the selected real API detail, saved identities, taxes and identifiers', (name, raw) => {
    const sale = parseDocumentSale(raw, raw.id), view = receiptView(sale);
    expect(sale.id).toBe(raw.id); expect(view.storeName).toBe('Saved <store>');
    expect(view.items).toHaveLength(2); expect(view.items[0].quantity).toBe('1.250');
    expect(view.items[0].lineTotal).toBe('140'); expect(view.items[0].taxAmount).toBe('15');
    expect(view.items[0].mxik).toBe('03816001001000000'); expect(view.items[0].packageCode).toBe('0001234');
    for (const format of ['receipt', 'a4'] as const) {
      const html = documentHtml(sale, format);
      expect(html).toContain('Saved &lt;store&gt;'); expect(html).toContain('Original &lt;address&gt;');
      expect(html).toContain('Saved &lt;product 1&gt;'); expect(html).toContain('Saved &lt;product 2&gt;');
      expect(html).toContain(raw.items[0].product_sku); expect(html).toContain(raw.items[0].product_barcode);
      expect(html).toContain('03816001001000000'); expect(html).toContain('0001234');
      expect(html).toContain('274,40'); expect(html).toContain('29,40');
      expect(html).toContain('Fiskal chek emas'); expect(html).toContain('<svg');
      expect(html).not.toMatch(/Changed current|New address|Changed catalog|<script>|cost_price|038160.*http/);
      if (name === 'debt_returned') { expect(html).toContain('Qisman qaytarilgan'); expect(html).toContain('246,40'); expect(html).toContain('0.250'); }
      if (format === 'a4') { expect(html).toContain(invoiceTitle(sale)); expect(html).toContain('hali imzolanmagan'); }
    }
    if (name === 'b2b') expect(invoiceTitle(sale)).toBe('B2B yuk xati');
    if (name === 'partner') expect(invoiceTitle(sale)).toBe('Ulgurji savdo fakturasi');

  });
  test.each([
    { id: 0 }, { currency: 'EUR' }, { status: 'unknown' }, { payment_type: 'wire' },
    { created_at: 'yesterday' }, { created_at: '2026-10-28T00:00:00' },
    { net_amount: '2.00' }, { total_amount: '-1.00' }, { tax_amount: '-1.00' }, { subtotal_amount: '1e2' },
    { items: [] },
    { items: [{ ...contract.sales.cash.items[0], total_price: '0.00' }, contract.sales.cash.items[1]] },
    { items: [{ ...contract.sales.cash.items[0], unit_price: '1.123' }] },
    { items: [contract.sales.cash.items[0], contract.sales.cash.items[0]] },
  ])('invalid authority %j cannot produce a document', change => {
    expect(() => parseDocumentSale({ ...contract.sales.cash, ...change }, contract.sales.cash.id)).toThrow();
  });
  test('a different transaction ID, missing totals and false future tax precision are rejected', () => {
    expect(() => parseDocumentSale(contract.sales.cash, contract.sales.card.id)).toThrow();
    expect(() => parseDocumentSale({ ...contract.sales.cash, total_amount: undefined }, contract.sales.cash.id)).toThrow();
    expect(() => parseDocumentSale({ ...contract.sales.cash, tax_amount: '1.001' }, contract.sales.cash.id)).toThrow();
  });
  test('historical USD retains USD without current exchange rates; legacy unknown tax is not fabricated', () => {
    const sale = parseDocumentSale({ ...contract.sales.cash, currency: 'USD', tax_amount: null, subtotal_amount: null, receipt_snapshot: null, cash_received: undefined }, contract.sales.cash.id);
    const html = documentHtml(sale, 'a4');
    expect(html).toContain('274,40 USD'); expect(html).toContain('rekvizitlari saqlanmagan');
    expect(html).not.toContain('so‘m'); expect(html).toContain('Naqd:</span><b>— USD');
  });
  test('saved tax visibility, paper width and exact currency formatting are preserved', () => {
    const sale = parseDocumentSale(contract.sales.cash, contract.sales.cash.id);
    expect(documentPrintOptions(sale, 'receipt').width).toBe(227);
    sale.receipt_snapshot = { ...sale.receipt_snapshot, receipt_paper_width: '58mm', receipt_show_item_tax: false };
    expect(documentPrintOptions(sale, 'receipt').width).toBe(165);
    expect(documentHtml(sale, 'receipt')).toContain('size: 58mm auto');
    expect(documentHtml(sale, 'receipt')).not.toContain('QQS 12%:');
    expect(documentPrintOptions(sale, 'a4')).toMatchObject({ width: 595, height: 842 });
    expect(receiptMoney('999999999999.99')).toBe('999\u00a0999\u00a0999\u00a0999,99');
    expect(receiptMoney('1.01')).toBe('1,01'); expect(receiptMoney('1.1')).toBe('1,10');
    expect(receiptMoney('-1')).toBe('—');
  });
  test('public receipt tokens stay on their own server and demo/invalid sources have no links', () => {
    const sale = parseDocumentSale(contract.sales.cash, contract.sales.cash.id);
    expect(publicReceiptUrl(sale, 'https://custom.example/api/v1')).toBe('https://custom.example/r/' + sale.public_token);
    for (const base of ['/api/v1', 'https://ilbi.uz/other', 'https://name:pass@ilbi.uz/api/v1', 'https://ilbi.uz/api/v1?secret=1']) expect(publicReceiptUrl(sale, base)).toBeNull();
    expect(publicReceiptUrl({ ...sale, _preview: true }, 'https://ilbi.uz/api/v1')).toBeNull();
    expect(publicReceiptUrl({ ...sale, public_token: '<invalid>' }, 'https://ilbi.uz/api/v1')).toBeNull();
  });
  test('business document dates do not follow the phone timezone', () => {
    expect(documentDate('2026-10-28T23:30:00Z')).toContain('29');
    expect(documentDate('2026-10-28T23:30:00Z')).toContain('04:30');
    expect(documentDate('2026-10-28T23:30:00Z')).toContain('Toshkent');
  });
  test('frozen parties win over changed related records in the screen model and printable document', () => {
    const raw = contract.sales.cash;
    const sale = parseDocumentSale({ ...raw, sold_by_name: 'Changed cashier', counterparty_name: 'Changed buyer' }, raw.id);
    const view = receiptView(sale);
    expect(view.hasParties).toBe(true); expect(view.cashierName).toBe(raw.receipt_snapshot.document_parties.cashier_name);
    expect(view.customerName).toBe('Document customer'); expect(view.items[0].hasProductSnapshot).toBe(true);
    const html = documentHtml(sale, 'a4');
    expect(html).not.toContain('Changed cashier'); expect(html).not.toContain('Changed buyer');
    expect(html).not.toContain('joriy katalogdan'); expect(html).not.toContain('joriy ma’lumot');
  });
  test('legacy parties and product names are labeled current/unknown without changing the source', () => {
    const raw = { ...contract.sales.cash, receipt_snapshot: {}, items: contract.sales.cash.items.map(item => ({ ...item, receipt_product_snapshot_version: null })) };
    const before = JSON.stringify(raw), sale = parseDocumentSale(raw, raw.id);
    const html = documentHtml(sale, 'receipt');
    expect(html).toContain('joriy ma’lumot ko‘rsatilgan'); expect(html).toContain('joriy katalogdan bo‘lishi mumkin');
    expect(receiptView(sale).hasParties).toBe(false); expect(JSON.stringify(raw)).toBe(before);
  });
  test('known empty saved party names never borrow a current account name', () => {
    const raw = contract.sales.cash;
    const sale = parseDocumentSale({ ...raw, sold_by_name: 'Changed cashier', counterparty_name: 'Changed buyer', receipt_snapshot: { ...raw.receipt_snapshot, document_parties: { version: 1, cashier_name: '', customer_name: null } } }, raw.id);
    const html = documentHtml(sale, 'a4');
    expect(html).not.toContain('Changed cashier'); expect(html).not.toContain('Changed buyer');
    expect(receiptView(sale).cashierName).toBe(''); expect(receiptView(sale).customerName).toBe('');
  });
});
