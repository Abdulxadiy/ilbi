/** Explicit synthetic backend-shaped responses; never a fallback for live failures. */
export function createPreviewCore({ user, customers, sales, products }: { user: any; customers: any[]; sales: Map<number, any>; products: any[] }) {
  const payments = new Map<string, any>();
  const cashReport = { id: 71, date: '2026-10-27', tenant_name: 'Demo do‘kon', closed_by_name: 'Demo', is_closed: true, actual_cash_uzs: '1800000.00', expected_cash_uzs: '1800000.00', discrepancy_uzs: '0.00', total_sale_cash_uzs: '1800000.00', total_sale_card_uzs: '490000.00', total_sale_debt_uzs: '160000.00', closed_at: '2026-10-27T12:00:00+05:00' };
  for (const field of ['opening_cash', 'total_sale_cash', 'total_sale_card', 'total_sale_debt', 'collected_debt_cash', 'refund_cash', 'total_extra_income', 'total_expenses', 'expected_cash', 'actual_cash', 'discrepancy']) for (const currency of ['uzs', 'usd']) { const key = field + '_' + currency; if (!(key in cashReport)) Object.assign(cashReport, { [key]: '0.00' }); }
  const normalizeCustomer = (value: any) => ({ ...value, debt_balance_uzs: String(value.debt_balance_uzs ?? value.debt_amount ?? 0), debt_balance_usd: String(value.debt_balance_usd ?? 0), is_active: true, debt_due_date: value.debt_due_date || null, note: value.note || '' });
  const page = (rows: any[], url: URL, summary?: any) => {
    const number = Math.max(1, Number(url.searchParams.get('page') || 1)), size = Math.max(1, Math.min(100, Number(url.searchParams.get('page_size') || 50)));
    return { results: rows.slice((number - 1) * size, number * size), count: rows.length, next: number * size < rows.length ? '?page=' + (number + 1) : null, ...(summary ? { summary } : {}) };
  };
  return (url: URL, method: string, body: any) => {
    const path = url.pathname;
    let data: any;
    if (path === '/auth/profile/' && method === 'GET') data = { ...user, email: user.email || '', contact_phone: user.contact_phone || '', date_of_birth: user.date_of_birth || null };
    else if (path === '/auth/profile/' && method === 'PATCH') { Object.assign(user, body); data = { ...user }; }
    else if (path === '/auth/change-password/' && method === 'POST') data = { message: 'Demo parol yangilandi; haqiqiy hisob o‘zgarmadi.' };
    else if (path === '/analytics/dashboard/' && method === 'GET') {
      const kpi = { total_sales_uzs: '2450000.00', total_sales_usd: '0.00', sales_count: 24, average_check_uzs: '102083.33', cash_revenue_uzs: '1800000.00', card_revenue_uzs: '490000.00', debt_sales_uzs: '160000.00', total_debt_uzs: '860000.00' };
      data = { period: url.searchParams.get('period') || 'today', kpi, sales_chart: [{ date: '2026-10-27', total_sales_uzs: kpi.total_sales_uzs, total_sales_usd: '0', sales_count: 24 }] };
    } else if (path === '/sales/counterparties/' && method === 'GET') {
      let rows = customers.map(normalizeCustomer); const all = [...rows];
      const search = (url.searchParams.get('search') || '').toLowerCase();
      if (search) rows = rows.filter(row => (row.name + ' ' + row.phone_number).toLowerCase().includes(search));
      if (url.searchParams.get('balance_status') === 'debtors') rows = rows.filter(row => Number(row.debt_balance_uzs) > 0 || Number(row.debt_balance_usd) > 0);
      data = page(rows, url, { total_count: all.length, debtors_count: all.filter(row => Number(row.debt_balance_uzs) > 0 || Number(row.debt_balance_usd) > 0).length, total_debt_uzs: String(all.reduce((sum, row) => sum + Math.max(0, Number(row.debt_balance_uzs)), 0)), total_debt_usd: String(all.reduce((sum, row) => sum + Math.max(0, Number(row.debt_balance_usd)), 0)) });
    } else if (path === '/sales/counterparties/' && method === 'POST') {
      const item = normalizeCustomer({ id: 1000 + customers.length, ...body }); customers.push(item); data = item;
    } else if (/^\/sales\/counterparties\/\d+\/$/.test(path) && ['GET', 'PATCH'].includes(method)) {
      const item = customers.find(row => row.id === Number(path.split('/')[3]));
      if (!item) throw Error('Demo mijoz topilmadi.');
      if (method === 'PATCH') Object.assign(item, body);
      data = normalizeCustomer(item);
    } else if (/^\/sales\/counterparties\/\d+\/payments\/$/.test(path) && method === 'POST') {
      const id = Number(path.split('/')[3]), item = customers.find(row => row.id === id);
      if (!item) throw Error('Demo mijoz topilmadi.');
      if (payments.has(body.idempotency_key)) data = payments.get(body.idempotency_key);
      else {
        Object.assign(item, normalizeCustomer(item)); const field = body.currency === 'USD' ? 'debt_balance_usd' : 'debt_balance_uzs';
        item[field] = String(Number(item[field]) - Number(body.amount));
        data = { id: 9000 + payments.size, counterparty: id, ...body, _preview: true }; payments.set(body.idempotency_key, data);
      }
    } else if (path === '/sales/' && method === 'GET') {
      const search = (url.searchParams.get('search') || '').toLowerCase(), payment = url.searchParams.get('payment_type');
      data = page([...sales.values()].filter(row => (!payment || row.payment_type === payment) && (!search || [row.receipt_number, row.counterparty_name].join(' ').toLowerCase().includes(search))), url);
    } else if (path === '/cashbox/reports/' && method === 'GET') data = page([{ ...cashReport }], url);
    else if (path === '/cashbox/reports/71/' && method === 'GET') data = { ...cashReport };
    else if (path === '/inventory/stock/' && method === 'GET') {
      const search = (url.searchParams.get('search') || '').toLowerCase();
      let rows = products.filter(row => (row.product_name + ' ' + row.barcode).toLowerCase().includes(search)).map(row => ({ id: row.id, product_variant: row.id, product_name: row.product_name, variant_name: row.name, quantity: String(row.stock_quantity), unit: row.unit, currency: row.currency, barcode: row.barcode, sku: row.sku, last_cost_price: String(Number(row.price_recommended) * 0.8) }));
      if (url.searchParams.get('sort') === 'qty_asc') rows = rows.sort((left, right) => Number(left.quantity) - Number(right.quantity));
      data = page(rows, url);
    } else if (path === '/inventory/movements/' && method === 'GET') data = page([{ id: 81, quantity: '50.000', type: 'intake', created_at: '2026-10-27T03:00:00Z', unit: 'dona', currency: 'UZS' }], url);
    else if (path === '/inventory/batches/' && method === 'GET') data = [{ id: 82, quantity: '50.000', batch_code: 'DEMO-01', received_on: '2026-10-27', expires_on: '2027-01-01', expiry_status: 'valid', unit: 'dona', currency: 'UZS' }];
    else if (path === '/audit/history/' && method === 'GET') data = page([{ id: 'sale:1043', source: 'sale', object_id: 1043, title: 'Sotuv yakunlandi', subtitle: 'Demo savdo', created_at: '2026-10-27T03:00:00Z', actor_name: 'Demo', amount: '160000.00', currency: 'UZS' }], url);
    else if (path === '/audit/history/sale/1043/' && method === 'GET') data = { event: { id: 'sale:1043', source: 'sale', object_id: 1043, title: 'Sotuv yakunlandi', subtitle: 'Demo savdo', created_at: '2026-10-27T03:00:00Z', actor_name: 'Demo', amount: '160000.00', currency: 'UZS' }, details: { fields: [{ label: 'Mijoz', value: 'Ali Valiyev' }], changes: {}, snapshot: {}, note: '' }, sale: sales.get(1043) };
    else return { handled: false as const };
    return { handled: true as const, data };
  };
}
