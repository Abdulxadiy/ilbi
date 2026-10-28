import { parseMoneyMinor } from '../domain/money';

/** Synthetic, opt-in design service only; never substitutes for a real cashbox response. */
export function createPreviewCashbox(actor: number, tenant: number) {
  const fields = ['opening_cash', 'total_sale_cash', 'total_sale_card', 'total_sale_debt', 'total_extra_income', 'total_expenses', 'collected_debt_cash', 'refund_cash', 'expected_cash'];
  const zeros = () => Object.fromEntries(fields.flatMap(field => ['uzs', 'usd'].map(code => [field + '_' + code, '0.00'])));
  const money = (minor: bigint) => `${minor < 0n ? '-' : ''}${(minor < 0n ? -minor : minor) / 100n}.${((minor < 0n ? -minor : minor) % 100n).toString().padStart(2, '0')}`;
  const clone = (value: any) => JSON.parse(JSON.stringify(value));
  let values = zeros(), open = true, shift = 21, nextId = 100, started = new Date().toISOString();
  values.opening_cash_uzs = values.expected_cash_uzs = '250000.00';
  const income: any[] = [], expenses: any[] = [], receipts = new Map<string, { fingerprint: string; result: any }>();
  const reports: any[] = [{ ...zeros(), id: 71, shift: 20, date: '2026-10-27', is_closed: true, tenant_name: 'Demo do‘kon', closed_by_name: 'Demo', opening_cash_uzs: '250000.00', expected_cash_uzs: '250000.00', actual_cash_uzs: '250000.00', actual_cash_usd: '0.00', discrepancy_uzs: '0.00', discrepancy_usd: '0.00' }];
  const status = () => ({ ...values, is_open: open, status: open ? 'OPEN' : 'CLOSED', shift_id: open ? shift : null, shift_start: open ? started : null, last_report_id: open ? null : reports[0].id, suggested_opening_cash_uzs: reports[0].actual_cash_uzs, suggested_opening_cash_usd: reports[0].actual_cash_usd });
  const page = (rows: any[], url: URL) => { const number = Number(url.searchParams.get('page') || 1), size = Number(url.searchParams.get('page_size') || 50); return { results: clone(rows.slice((number - 1) * size, number * size)), count: rows.length, next: number * size < rows.length ? '?page=' + (number + 1) : null }; };
  return (url: URL, method: string, body: any) => {
    const path = url.pathname;
    if (!path.startsWith('/cashbox/')) return { handled: false, data: null };
    let data: any;
    if (method === 'GET') {
      if (path === '/cashbox/capabilities/') data = { cashbox_mutations: 1, idempotent_operations: ['open', 'close', 'income', 'expense'] };
      else if (path === '/cashbox/shift/current/') data = status();
      else if (path === '/cashbox/income/' || path === '/cashbox/expenses/') data = page(path.includes('/income/') ? income : expenses, url);
      else if (path === '/cashbox/reports/') data = page(reports, url);
      else if (/^\/cashbox\/reports\/\d+\/$/.test(path)) { data = reports.find(report => report.id === Number(path.split('/')[3])); if (!data) throw Error('Demo Z-hisobot topilmadi.'); }
      else return { handled: false, data: null };
    } else if (method === 'POST') {
      const kind = path === '/cashbox/income/' ? 'income' : path === '/cashbox/expenses/' ? 'expense' : path === '/cashbox/shift/open/' ? 'open' : path === '/cashbox/shift/close/' ? 'close' : null;
      if (!kind) return { handled: false, data: null };
      const key = body.idempotency_key, fingerprint = JSON.stringify({ path, body }), previous = receipts.get(key);
      if (!key) throw Error('Demo kassa amalining asl kaliti kerak.');
      if (previous) { if (previous.fingerprint !== fingerprint) throw Error('Demo kalit boshqa amal uchun ishlatilgan.'); return { handled: true, data: clone(previous.result) }; }
      if (kind === 'open') {
        if (open || body.expected_report_id !== reports[0].id) throw Error('Demo smena holati o‘zgargan.');
        values = zeros();
        for (const code of ['uzs', 'usd']) values['opening_cash_' + code] = values['expected_cash_' + code] = money(BigInt(parseMoneyMinor(body['opening_cash_' + code])));
        open = true; shift++; started = new Date().toISOString(); data = { ...status(), id: shift };
      } else {
        if (!open || (kind === 'close' ? body.shift_id : body.expected_shift_id) !== shift) throw Error('Demo smena o‘zgargan yoki yopilgan.');
        if (kind === 'close') {
          for (const code of ['uzs', 'usd']) if (parseMoneyMinor(body['expected_cash_' + code], true) !== parseMoneyMinor(values['expected_cash_' + code], true)) throw Error('Demo kassa yig‘indisi o‘zgargan.');
          data = { ...values, id: nextId++, shift, date: new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10), is_closed: true, tenant_name: 'Demo do‘kon', closed_by: actor, closed_by_name: 'Demo', discrepancy_reason: body.discrepancy_reason, staff_notes: body.staff_notes };
          for (const code of ['uzs', 'usd']) { const actual = BigInt(parseMoneyMinor(body['actual_cash_' + code])); data['actual_cash_' + code] = money(actual); data['discrepancy_' + code] = money(actual - BigInt(parseMoneyMinor(values['expected_cash_' + code], true))); }
          reports.unshift(clone(data)); open = false; values = zeros();
        } else {
          if (!['UZS', 'USD'].includes(body.currency) || parseMoneyMinor(body.amount) <= 0) throw Error('Demo summani tekshiring.');
          data = { ...body, id: nextId++, recorded_by: actor, recorded_by_name: 'Demo', shift_report: null };
          (kind === 'income' ? income : expenses).unshift(clone(data));
          const field = (kind === 'income' ? 'total_extra_income_' : 'total_expenses_') + body.currency.toLowerCase(), expected = 'expected_cash_' + body.currency.toLowerCase();
          values[field] = money(BigInt(parseMoneyMinor(values[field])) + BigInt(parseMoneyMinor(body.amount)));
          values[expected] = money(BigInt(parseMoneyMinor(values[expected], true)) + (kind === 'income' ? 1n : -1n) * BigInt(parseMoneyMinor(body.amount)));
        }
      }
      data.cashbox_operation = { idempotency_key: key, kind, actor_id: actor, tenant_id: tenant };
      receipts.set(key, { fingerprint, result: clone(data) });
    } else return { handled: false, data: null };
    return { handled: true, data: clone(data) };
  };
}
