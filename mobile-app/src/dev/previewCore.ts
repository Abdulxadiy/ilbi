/** Explicit synthetic backend-shaped responses; never a fallback for live failures. */
export function createPreviewCore({ user, customers, sales, products }: { user: any; customers: any[]; sales: Map<number, any>; products: any[] }) {
  const payments = new Map<string, { fingerprint: string; result: any }>();
  const debtQuoteTokens = new Map<string, string>();
  let nextPaymentId = 9000;
  const copy = (value: any) => JSON.parse(JSON.stringify(value));
  const debtFailure = (message: string): never => { throw Object.assign(Error(message), { status: 400 }); };
  const minor = (value: unknown): bigint => {
    const text = String(value ?? '');
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return debtFailure('Demo pul qiymati noto‘g‘ri.');
    const negative = text.startsWith('-'), [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
    const amount = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    return negative ? -amount : amount;
  };
  const money = (value: bigint) => { const amount = value < 0n ? -value : value; return `${value < 0n ? '-' : ''}${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`; };
  const positiveBalance = (value: unknown) => { const result = minor(value); return result > 0n ? result : 0n; };
  const debtQuote = (item: any, input: any) => {
    const amount = minor(input.amount), branch = Number(input.branch_id ?? user.tenants[0].id);
    if (amount <= 0n || !['UZS', 'USD'].includes(input.currency) || !['cash', 'card'].includes(input.payment_type) || !user.tenants.some((row: any) => row.id === branch)) return debtFailure('Demo to‘lov summasi, usuli yoki do‘koni noto‘g‘ri.');
    const balanceUZS = minor(item.debt_balance_uzs ?? item.debt_amount ?? 0), balanceUSD = minor(item.debt_balance_usd ?? 0);
    const appliedUSD = input.currency === 'USD' && balanceUSD > 0n ? (amount < balanceUSD ? amount : balanceUSD) : 0n;
    // Deliberately fixed synthetic rate for this opt-in design fixture. It never
    // reads a live rate and must not act as a fallback for real server failures.
    const converting = input.currency === 'USD' && amount > appliedUSD;
    const appliedUZS = input.currency === 'UZS' ? amount : (amount - appliedUSD) * 13000n;
    const remainingUZS = balanceUZS - appliedUZS, remainingUSD = balanceUSD - appliedUSD;
    const result = {
      protocol: 'ilbi-debt-payment-quote-v1', actor_id: user.id, tenant_id: user.tenants[0].id,
      counterparty_id: item.id, branch_id: branch, amount: money(amount), currency: input.currency, payment_type: input.payment_type,
      balances: { UZS: money(balanceUZS), USD: money(balanceUSD) }, applied: { UZS: money(appliedUZS), USD: money(appliedUSD) },
      remaining: { UZS: money(remainingUZS), USD: money(remainingUSD) }, exchange_rate: converting ? '13000.000000' : null,
      exchange_rate_source: converting ? 'manual' : '', exchange_rate_date: null,
      creates_credit: remainingUZS < (balanceUZS < 0n ? balanceUZS : 0n) || remainingUSD < (balanceUSD < 0n ? balanceUSD : 0n),
    };
    const fingerprint = JSON.stringify(result);
    // Opaque fixture token, intentionally not a production signing primitive.
    if (!debtQuoteTokens.has(fingerprint)) debtQuoteTokens.set(fingerprint, (debtQuoteTokens.size + 1).toString(16).padStart(64, '0'));
    return { ...result, expected_quote: debtQuoteTokens.get(fingerprint)! };
  };
  const voidRequests = new Map<string, { fingerprint: string; result: any }>();
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
    else if (path === '/sales/capabilities/' && method === 'GET') data = { sale_void_idempotency: 1, partial_void_quantity_scale: 3 };
    else if (/^\/sales\/(?:items\/)?\d+\/void\/$/.test(path) && method === 'POST') {
      if (!body.idempotency_key) throw Error('Demo qaytarish kaliti kerak.');
      const fingerprint = JSON.stringify({ path, reason: body.reason, quantity: body.quantity });
      const previous = voidRequests.get(body.idempotency_key);
      if (previous) { if (previous.fingerprint !== fingerprint) throw Error('Demo kalit boshqa amal uchun ishlatilgan.'); data = previous.result; }
      else {
        const partial = path.includes('/items/'), target = Number(path.split('/')[partial ? 3 : 2]);
        const sale = partial ? [...sales.values()].find(row => row.items.some((item: any) => item.id === target)) : sales.get(target);
        if (!sale || sale.status === 'voided') throw Error('Demo savdo qaytarish uchun ochiq emas.');
        const line = partial ? sale.items.find((item: any) => item.id === target) : null;
        const quantity = partial ? Number(body.quantity) : null;
        if (partial && (!quantity || quantity <= 0 || quantity > Number(line.quantity) - Number(line.voided_quantity))) throw Error('Demo qaytarish miqdorini tekshiring.');
        const refund = partial ? Number(quantity) * Number(line.unit_price) : Number(sale.net_amount);
        if (partial) { line.voided_quantity = String(Number(line.voided_quantity) + Number(quantity)); line.status = Number(line.voided_quantity) === Number(line.quantity) ? 'voided' : 'partially_voided'; }
        else for (const item of sale.items) { item.voided_quantity = String(item.quantity); item.status = 'voided'; }
        sale.refunded_amount = Number(sale.refunded_amount) + refund; sale.net_amount = Number(sale.total_amount) - Number(sale.refunded_amount);
        sale.status = sale.items.every((item: any) => Number(item.voided_quantity) === Number(item.quantity)) ? 'voided' : 'partially_voided';
        const receipt = { actor_id: user.id, tenant_id: user.tenants[0].id, idempotency_key: body.idempotency_key, kind: partial ? 'item' : 'sale', sale_id: sale.id, sale_item_id: line?.id || null, reason: String(body.reason || '').trim(), quantity: partial ? String(quantity) : null, result: { currency: sale.currency, sale_status: sale.status, refunded_amount: String(refund), sale_net_amount: String(sale.net_amount) } };
        data = { ...(line || sale), void_operation: receipt, _preview: true };
        voidRequests.set(body.idempotency_key, { fingerprint, result: JSON.parse(JSON.stringify(data)) });
      }
    }
    else if (path === '/analytics/dashboard/' && method === 'GET') {
      const kpi = { total_sales_uzs: '2450000.00', total_sales_usd: '0.00', sales_count: 24, average_check_uzs: '102083.33', cash_revenue_uzs: '1800000.00', card_revenue_uzs: '490000.00', debt_sales_uzs: '160000.00', total_debt_uzs: '860000.00' };
      data = { period: url.searchParams.get('period') || 'today', kpi, sales_chart: [{ date: '2026-10-27', total_sales_uzs: kpi.total_sales_uzs, total_sales_usd: '0', sales_count: 24 }] };
    } else if (path === '/sales/counterparties/' && method === 'GET') {
      let rows = customers.map(normalizeCustomer); const all = [...rows];
      const search = (url.searchParams.get('search') || '').toLowerCase();
      if (search) rows = rows.filter(row => (row.name + ' ' + row.phone_number).toLowerCase().includes(search));
      if (url.searchParams.get('balance_status') === 'debtors') rows = rows.filter(row => minor(row.debt_balance_uzs) > 0n || minor(row.debt_balance_usd) > 0n);
      data = page(rows, url, { total_count: all.length, debtors_count: all.filter(row => minor(row.debt_balance_uzs) > 0n || minor(row.debt_balance_usd) > 0n).length, total_debt_uzs: money(all.reduce((sum, row) => sum + positiveBalance(row.debt_balance_uzs), 0n)), total_debt_usd: money(all.reduce((sum, row) => sum + positiveBalance(row.debt_balance_usd), 0n)) });
    } else if (path === '/sales/counterparties/' && method === 'POST') {
      const item = normalizeCustomer({ id: 1000 + customers.length, ...body }); customers.push(item); data = item;
    } else if (/^\/sales\/counterparties\/\d+\/$/.test(path) && ['GET', 'PATCH'].includes(method)) {
      const item = customers.find(row => row.id === Number(path.split('/')[3]));
      if (!item) throw Error('Demo mijoz topilmadi.');
      if (method === 'PATCH') Object.assign(item, body);
      data = normalizeCustomer(item);
    } else if (/^\/sales\/counterparties\/\d+\/payments\/quote\/$/.test(path) && method === 'GET') {
      const item = customers.find(row => row.id === Number(path.split('/')[3]));
      if (!item) return debtFailure('Demo mijoz topilmadi.');
      data = { ...debtQuote(item, Object.fromEntries(url.searchParams)), _preview: true };
    } else if (/^\/sales\/counterparties\/\d+\/payments\/$/.test(path) && method === 'POST') {
      const id = Number(path.split('/')[3]), item = customers.find(row => row.id === id);
      if (!item) throw Error('Demo mijoz topilmadi.');
      const branch = Number(body.branch_id ?? user.tenants[0].id), amount = money(minor(body.amount));
      const fingerprint = JSON.stringify({ customer: id, actor: user.id, tenant: user.tenants[0].id, branch, amount, currency: body.currency, payment_type: body.payment_type, note: String(body.note || '').trim(), expected_quote: body.expected_quote ?? null });
      const old = body.idempotency_key ? payments.get(body.idempotency_key) : null;
      if (old) { if (old.fingerprint !== fingerprint) return debtFailure('Demo kalit boshqa to‘lov uchun ishlatilgan.'); data = copy(old.result); }
      else {
        const quote = debtQuote(item, body);
        if (body.expected_quote != null && (!body.idempotency_key || !/^[a-f0-9]{64}$/.test(body.expected_quote) || quote.expected_quote !== body.expected_quote)) return debtFailure('Demo qarz qoldig‘i yoki kurs o‘zgardi. To‘lovni qayta hisoblang.');
        if (body.expected_quote != null && quote.creates_credit) return debtFailure('Demo to‘lov avans hosil qiladi. Summani kamaytiring.');
        const operation = body.expected_quote == null ? {} : { payment_operation: { protocol: quote.protocol, idempotency_key: body.idempotency_key, expected_quote: body.expected_quote, actor_id: user.id, tenant_id: user.tenants[0].id, counterparty_id: id, branch_id: branch } };
        // Construct the bound acknowledgement before applying this synthetic mutation.
        data = { ...body, id: nextPaymentId++, counterparty: id, recorded_by: user.id, branch_id: branch, branch, amount, is_correction: false, ...operation, _preview: true };
        item.debt_balance_uzs = quote.remaining.UZS; item.debt_balance_usd = quote.remaining.USD;
        if (body.idempotency_key) payments.set(body.idempotency_key, { fingerprint, result: copy(data) });
      }
    } else if (path === '/sales/' && method === 'GET') {
      const search = (url.searchParams.get('search') || '').toLowerCase(), payment = url.searchParams.get('payment_type'), status = url.searchParams.get('status'), currency = url.searchParams.get('currency'), from = url.searchParams.get('date_from'), to = url.searchParams.get('date_to'), customer = url.searchParams.get('counterparty_id');
      data = page([...sales.values()].filter(row => (!payment || row.payment_type === payment) && (!status || row.status === status) && (!currency || row.currency === currency) && (!customer || String(row.counterparty) === customer) && (!from || row.created_at.slice(0, 10) >= from) && (!to || row.created_at.slice(0, 10) <= to) && (!search || [row.receipt_number, row.counterparty_name].join(' ').toLowerCase().includes(search))), url);
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
