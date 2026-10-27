/** Saved receipt fields only: never fetch current store configuration for an old sale. */
const text = (value: unknown) => typeof value === 'string' ? value : '';
export const escapeReceiptHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function receiptMoney(value: unknown) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+(?:\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}
export function receiptView(sale: any) {
  const saved = sale.receipt_snapshot, hasSnapshot = Boolean(saved && typeof saved === 'object' && !Array.isArray(saved) && Object.keys(saved).length);
  const snapshot = hasSnapshot ? saved : {};
  const storeName = hasSnapshot ? text(snapshot.store_name) : text(sale.tenant_name) || (sale._preview ? 'Demo do‘kon' : '—');
  const paperWidth = snapshot.receipt_paper_width === '80mm' ? '80mm' : '58mm';
  const sourceItems: any[] = Array.isArray(sale.items) ? sale.items : [];
  return {
    storeName, hasSnapshot, paperWidth, pdfWidth: Math.ceil((paperWidth === '80mm' ? 80 : 58) * 72 / 25.4),
    address: text(snapshot.store_address), phone: text(snapshot.receipt_phone), header: text(snapshot.receipt_header), footer: text(snapshot.receipt_footer),
    sellerName: text(snapshot.seller_name), sellerTaxIdentifier: text(snapshot.seller_tax_identifier), storeCode: text(snapshot.store_code),
    showCashier: hasSnapshot ? snapshot.receipt_show_cashier === true : true,
    showCustomer: hasSnapshot ? snapshot.receipt_show_customer === true : true,
    showItemTax: hasSnapshot ? snapshot.receipt_show_item_tax === true : false,
    items: sourceItems.map((item: any) => ({
      productName: text(item.product_name), quantity: /^\d+(?:\.\d{1,3})?$/.test(String(item.quantity)) ? String(item.quantity) : '—',
      unitPrice: receiptMoney(item.unit_price), lineTotal: receiptMoney(item.total_price),
      taxAmount: receiptMoney(item.tax_amount), taxRate: receiptMoney(item.tax_rate), unit: text(item.unit),
    })),
  };
}
export type ReceiptView = ReturnType<typeof receiptView>;
