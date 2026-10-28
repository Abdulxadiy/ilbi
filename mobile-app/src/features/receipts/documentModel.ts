import { parseSavedSale, SavedSale, saleStatuses } from '../sales/model';
import { escapeReceiptHtml as esc, receiptMoney, receiptView } from './receiptModel';
import { documentLogo } from '../../components/brand/documentLogo';

export type DocumentFormat = 'receipt' | 'a4';
const text = (value: unknown) => typeof value === 'string' ? value : '';
const money = (value: unknown, optional = false): string | null => {
  if (optional && value == null) return null;
  if (!['string', 'number'].includes(typeof value) || !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value))) throw Error('Hujjatning pul qiymati tasdiqlanmadi.');
  return String(value);
};
const cents = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
/** A selected list row/cache is never an export authority. Parse the scoped detail DTO. */
export function parseDocumentSale(value: unknown, expectedId: number): SavedSale {
  const sale = parseSavedSale(value);
  if (sale.id !== expectedId) throw Error('Server so‘ralgan chekni tasdiqlamadi.');
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(sale.created_at) || !Number.isFinite(Date.parse(sale.created_at))) throw Error('Hujjatning sanasi tasdiqlanmadi.');
  for (const key of ['total_amount', 'refunded_amount', 'net_amount']) money(sale[key]);
  for (const key of ['subtotal_amount', 'tax_amount', 'cash_received', 'change']) money(sale[key], true);
  if (!sale.items.length) throw Error('Hujjatning tovar qatorlari mavjud emas.');
  const ids = new Set<number>();
  for (const item of sale.items) {
    if (ids.has(item.id)) throw Error('Hujjatning tovar qatori takrorlangan.');
    ids.add(item.id);
    money(item.unit_price); money(item.total_price);
    money(item.net_amount, true); money(item.tax_amount, true); money(item.tax_rate, true);
  }
  if (sale.items.reduce((sum, item) => sum + cents(item.total_price), 0n) !== cents(sale.total_amount)) throw Error('Hujjat qatorlari asl savdo summasiga mos kelmadi.');
  // Deliberately exclude costs, raw fiscal/provider fields, journals and unrelated DTO fields.
  const items = sale.items.map(item => Object.fromEntries(['id', 'product_name', 'product_variant_name', 'product_code', 'product_sku', 'product_barcode', 'unit', 'mxik', 'package_code', 'quantity', 'voided_quantity', 'unit_price', 'total_price', 'net_amount', 'tax_amount', 'tax_rate', 'status', 'receipt_product_snapshot_version'].map(key => [key, item[key]])));
  const keys = ['id', 'receipt_number', 'currency', 'status', 'payment_type', 'created_at', 'total_amount', 'refunded_amount', 'net_amount', 'subtotal_amount', 'tax_amount', 'receipt_snapshot', 'tenant_name', 'sold_by_name', 'counterparty_name', 'is_partner_sale', 'b2b_target_tenant', 'b2b_target_tenant_name', 'public_token', 'cash_received', 'change', '_preview'];
  return { ...Object.fromEntries(keys.map(key => [key, sale[key]])), items } as SavedSale;
}
export function documentDate(value: unknown) {
  const date = new Date(text(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', hour12: false }) + ' (Toshkent)' : '—';
}
export function invoiceTitle(sale: SavedSale) {
  return sale.b2b_target_tenant ? 'B2B yuk xati' : sale.is_partner_sale ? 'Ulgurji savdo fakturasi' : sale.payment_type === 'debt' ? 'Nasiya savdo fakturasi' : 'Savdo fakturasi';
}
/** A bearer public token belongs to this API origin; never send a custom server's token to production. */
export function publicReceiptUrl(sale: SavedSale, apiBase: string): string | null {
  if (sale._preview || typeof sale.public_token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(sale.public_token)) return null;
  try {
    const url = new URL(apiBase);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/api\/v1\/?$/.test(url.pathname)) return null;
    return url.origin + '/r/' + sale.public_token;
  } catch { return null; }
}
export function documentPrintOptions(sale: SavedSale, format: DocumentFormat) {
  return format === 'a4'
    ? { width: 595, height: 842, margins: { left: 28, right: 28, top: 28, bottom: 28 } }
    : { width: receiptView(sale).pdfWidth, margins: { left: 6, right: 6, top: 6, bottom: 6 } };
}
export function documentHtml(sale: SavedSale, format: DocumentFormat): string {
  const view = receiptView(sale), a4 = format === 'a4', currency = sale.currency === 'UZS' ? 'so‘m' : 'USD';
  const pay = ({ cash: 'Naqd', card: 'Karta', debt: 'Nasiya' })[sale.payment_type];
  const details = (parts: string[]) => parts.filter(Boolean).map(part => `<div>${esc(part)}</div>`).join('');
  const identifiers = (item: typeof view.items[number]) => [
    item.hasProductSnapshot ? '' : 'Eski qator: nom va kodlar joriy katalogdan bo‘lishi mumkin.',
    item.variantName, item.code && 'Kod: ' + item.code, item.sku && 'SKU: ' + item.sku,
    item.barcode && 'Shtrix-kod: ' + item.barcode, item.mxik && 'MXIK: ' + item.mxik, item.packageCode && 'Qadoq: ' + item.packageCode,
  ];
  const rows = view.items.map((item, index) => a4
    ? `<tr><td>${index + 1}</td><td><b>${esc(item.productName)}</b><small>${details(identifiers(item))}</small></td><td>${esc(item.quantity)} ${esc(item.unit)}</td><td>${esc(item.unitPrice)}</td><td>${view.showItemTax ? esc(item.taxAmount) + (item.taxRate !== '—' ? '<br>' + esc(item.taxRate) + '%' : '') : '—'}</td><td>${esc(item.returnedQuantity)}</td><td>${esc(item.lineTotal)}</td></tr>`
    : `<section class="item"><div class="row"><b>${esc(item.productName)}</b><b>${esc(item.lineTotal)}</b></div><small>${details(identifiers(item))}${esc(item.quantity)} ${esc(item.unit)} × ${esc(item.unitPrice)}${Number(item.returnedQuantity) > 0 ? '<div>Qaytarilgan miqdor: ' + esc(item.returnedQuantity) + '</div>' : ''}${view.showItemTax && item.taxAmount !== '—' ? '<div>QQS' + (item.taxRate !== '—' ? ' ' + esc(item.taxRate) + '%' : '') + ': ' + esc(item.taxAmount) + ' ' + esc(currency) + '</div>' : ''}</small></section>`
  ).join('');
  const amount = (label: string, value: unknown) => `<div class="row"><span>${label}</span><b>${receiptMoney(value)} ${esc(currency)}</b></div>`;
  return `<!DOCTYPE html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>
    @page { size: ${a4 ? 'A4' : view.paperWidth + ' auto'}; margin: ${a4 ? '10mm' : '2mm'}; }
    *{box-sizing:border-box;overflow-wrap:anywhere}body{color:#111;background:#fff;font-family:${a4 ? 'Arial,sans-serif' : 'monospace'};font-size:${a4 ? 11 : 10}px;margin:0;width:100%}header{text-align:center}header svg{height:${a4 ? 40 : 28}px;width:auto}h1{font-size:20px;margin:8px 0}h2{font-size:16px;margin:8px 0}.saved-text{white-space:pre-wrap}.row{display:flex;justify-content:space-between;gap:12px;margin:5px 0}.divider{border-top:1px dashed #555;margin:10px 0}.item{break-inside:avoid;margin:8px 0}small{display:block;font-size:9px;color:#333}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:14px 0}thead{display:table-header-group}tr{break-inside:avoid}td,th{border:1px solid #777;padding:6px;vertical-align:top;text-align:left}th:nth-child(1){width:5%}th:nth-child(2){width:34%}th:nth-child(3){width:13%}th:nth-child(4){width:13%}th:nth-child(5){width:10%}th:nth-child(6){width:11%}th:nth-child(7){width:14%}.totals{break-inside:avoid;${a4 ? 'max-width:340px;margin-left:auto' : ''}}footer{font-size:9px;margin-top:14px}.notice{padding:6px 0}
    </style></head><body><header>${documentLogo}<h2>${esc(view.storeName || '—')}</h2>${details([view.sellerName, view.sellerTaxIdentifier && 'STIR: ' + view.sellerTaxIdentifier, view.storeCode && 'Do‘kon: ' + view.storeCode, view.address, view.phone])}<div class="saved-text">${esc(view.header)}</div></header>
    ${a4 ? '<h1>' + esc(invoiceTitle(sale)) + '</h1>' : '<div class="divider"></div>'}<b>Chek #${esc(sale.receipt_number)}</b><div>${esc(documentDate(sale.created_at))}</div><div>Holat: ${esc(saleStatuses[sale.status])}</div>
    ${view.showCashier ? '<div>Sotuvchi: ' + esc(view.cashierName || '—') + '</div>' : ''}${view.showCustomer ? '<div>Mijoz: ' + esc(view.customerName || 'Umumiy mijoz') + '</div>' : ''}${sale.b2b_target_tenant && view.showCustomer ? '<div>Qabul qiluvchi do‘kon: ' + esc(view.recipientName || '—') + '</div>' : ''}
    ${!view.hasParties && (view.showCashier || view.showCustomer) ? '<p class="notice">Eski hujjat: mijoz va kassirning sotuv paytidagi ma’lumotlari saqlanmagan; joriy ma’lumot ko‘rsatilgan.</p>' : ''}
    ${!view.hasSnapshot ? '<p class="notice">Eski hujjat: sotuv paytidagi do‘kon rekvizitlari saqlanmagan.</p>' : ''}
    ${a4 ? '<table><thead><tr><th>№</th><th>Tovar va identifikatorlar</th><th>Miqdor</th><th>Birlik narxi</th><th>QQS</th><th>Qaytarilgan miqdor</th><th>Asl summa</th></tr></thead><tbody>' + rows + '</tbody></table>' : rows + '<div class="divider"></div>'}
    <div class="totals">${amount('Jami:', sale.total_amount)}${Number(sale.tax_amount) > 0 ? amount('QQS:', sale.tax_amount) : ''}${Number(sale.refunded_amount) > 0 ? amount('Qaytarilgan:', sale.refunded_amount) + amount('Qolgan summa:', sale.net_amount) : ''}${amount(pay + ':', sale.payment_type === 'cash' ? sale.cash_received : sale.total_amount)}${sale.payment_type === 'cash' ? amount('Qaytim:', sale.change) : ''}</div>
    ${a4 ? '<p>Qatorlardagi miqdor va summalar — asl sotuv. Qaytarilgan miqdor va jami qaytarish alohida ko‘rsatilgan.</p><p>To‘lov turi: ' + esc(pay) + '. To‘lov yozuvi qarzning hozirgi qoldig‘ini anglatmaydi.</p>' : ''}
    <footer><div class="saved-text">${esc(view.footer)}</div>Elektron savdo nusxasi. Fiskal chek emas.${a4 ? '<div>Ushbu nusxa hali imzolanmagan.</div>' : ''}</footer></body></html>`;
}
