/** Explicit synthetic store settings. This module never falls back from a live API failure. */
export function createPreviewStoreSettings(tenantId: number, name: string, notifications: { notify_web_reports: boolean; notify_web_low_stock: boolean }) {
  let revision = 1;
  const settings: Record<string, any> = {
    id: tenantId, name, address: 'Toshkent · namuna manzil', description: 'Demo do‘kon', receipt_phone: '+998 90 123 45 67',
    receipt_header: '', receipt_footer: 'Xaridingiz uchun rahmat!', receipt_paper_width: '58mm', receipt_show_cashier: true, receipt_show_customer: true, receipt_show_item_tax: true,
    tax_regime: 'unspecified', tax_regime_name: '', is_vat_payer: false, vat_rate: '12.00', price_includes_vat: true, turnover_tax_rate: '0.00', profit_tax_enabled: false, profit_tax_rate: '0.00',
    manual_usd_rate: '12000.00', auto_usd_rate: false, cbu_rates: { USD: { rate: '12950.123456', date: '2026-10-27' } },
    telegram_group_id: '', notify_on_sale: false, notify_on_debt: true, daily_report_target: 'none', shift_report_target: 'none', low_stock_report_target: 'none', daily_report_time: '22:00:00', low_stock_report_time: '09:00:00', low_stock_frequency: 'daily', low_stock_weekday: 1, low_stock_day_of_month: 1,
  };
  const receiptSnapshot = () => {
    const result: Record<string, any> = { version: 1, store_name: name, store_address: settings.address, store_code: 'DEMO1', seller_name: 'Namuna sotuvchi', seller_tax_identifier: '' };
    for (const field of ['receipt_header', 'receipt_footer', 'receipt_phone', 'receipt_paper_width', 'receipt_show_cashier', 'receipt_show_customer', 'receipt_show_item_tax', 'tax_regime', 'tax_regime_name', 'is_vat_payer', 'vat_rate', 'price_includes_vat', 'turnover_tax_rate', 'profit_tax_enabled', 'profit_tax_rate']) result[field] = settings[field];
    return result;
  };
  const value = () => ({ ...settings, ...notifications, settings_revision: revision.toString(16).padStart(64, '0'), usd_rate: settings.auto_usd_rate ? settings.cbu_rates.USD.rate : settings.manual_usd_rate, receipt_settings: receiptSnapshot(), _preview: true });
  return {
    receiptSnapshot,
    request(url: URL, method: string, body: any, headers?: HeadersInit): { handled: boolean; data?: any } {
      if (url.pathname === '/tenants/current/' && ['GET', 'PATCH'].includes(method)) {
        if (method === 'PATCH') {
          const expected = new Headers(headers).get('If-Match');
          if (expected && expected !== '"' + value().settings_revision + '"') throw Object.assign(Error('Demo sozlamalari boshqa oynada o‘zgardi.'), { status: 412 });
          for (const [field, next] of Object.entries(body)) {
            if (field === 'usd_rate') settings.manual_usd_rate = next;
            else if (field === 'notify_web_reports' || field === 'notify_web_low_stock') notifications[field] = next as boolean;
            else if (Object.hasOwn(settings, field) && !['id', 'name', 'manual_usd_rate', 'cbu_rates'].includes(field)) settings[field] = next;
          }
          revision++;
        }
        return { handled: true, data: value() };
      }
      if (method === 'POST' && /^\/tenants\/current\/(test-telegram|send-report-now|send-low-stock-report-now)\/$/.test(url.pathname)) return { handled: true, data: { success: true, detail: 'Demo rejimi: haqiqiy xabar yuborilmadi.', _preview: true } };
      return { handled: false };
    },
  };
}
