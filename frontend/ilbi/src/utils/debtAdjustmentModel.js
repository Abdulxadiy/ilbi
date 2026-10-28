export const ADJUSTMENT_PROTOCOL = 'ilbi-debt-adjustment-quote-v1';
const max = 99999999999999n;
const id = value => Number.isSafeInteger(value) && value > 0;
const nonce = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const invalid = () => { throw Error('Server tuzatish hisobini to‘liq tasdiqlamadi. Hisobni yangilang.'); };
const fixed = minor => (minor < 0n ? '-' : '') + `${(minor < 0n ? -minor : minor) / 100n}.${((minor < 0n ? -minor : minor) % 100n).toString().padStart(2, '0')}`;
export function adjustmentCents(value) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value)) return invalid();
  const negative = value.startsWith('-'), [whole, fraction] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  if (cents > max) return invalid();
  return negative ? -cents : cents;
}
function validation(fields) {
  const error = Error('Belgilangan maydonlarni tekshiring.');
  error.status = 400; error.fields = fields;
  error.data = { error: { code: 'validation_error', details: fields } }; throw error;
}
export function adjustmentInput(raw) {
  const fields = {}, text = typeof raw?.amount === 'string' ? raw.amount.trim().replace(',', '.') : '';
  let amount = 0n;
  if (/^-?\d{1,12}(?:\.\d{1,2})?$/.test(text)) {
    const negative = text.startsWith('-'), [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
    amount = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (negative ? -1n : 1n);
  }
  if (!amount || amount > max || amount < -max || raw?.kind === 'credit_refund' && amount < 0n) fields.amount = 'Summani ikki kasr xonasigacha to‘g‘ri kiriting.';
  if (!['credit_refund', 'correction'].includes(raw?.kind)) fields.kind = 'Tuzatish turini tanlang.';
  if (!['UZS', 'USD'].includes(raw?.currency)) fields.currency = 'Valyutani tanlang.';
  if (!['cash', 'card', 'none'].includes(raw?.payment_type) || raw?.kind === 'credit_refund' && raw.payment_type === 'none') fields.payment_type = 'Qaytarish usulini tanlang.';
  if (!id(raw?.branch_id)) fields.branch_id = 'Qaytaruvchi do‘konni tanlang.';
  if (typeof raw?.note !== 'string' || !raw.note.trim() || raw.note.trim().length > 2000) fields.note = 'Sababni kiriting (2000 belgigacha).';
  if (raw?.expected_quote != null && !nonce(raw.expected_quote)) return invalid();
  if (Object.keys(fields).length) validation(fields);
  return { kind: raw.kind, amount: fixed(amount), currency: raw.currency, payment_type: raw.payment_type, branch_id: raw.branch_id, note: raw.note.trim(), ...(raw.expected_quote ? { expected_quote: raw.expected_quote } : {}) };
}
const validScope = scope => scope && [scope.actorId, scope.tenantId, scope.customerId, scope.branchId].every(id);
export function adjustmentQuote(value, scope, raw) {
  const input = adjustmentInput(raw);
  if (!validScope(scope) || value?.protocol !== ADJUSTMENT_PROTOCOL || value.actor_id !== scope.actorId || value.tenant_id !== scope.tenantId || value.counterparty_id !== scope.customerId || value.branch_id !== scope.branchId || input.branch_id !== scope.branchId || value.kind !== input.kind || value.amount !== input.amount || value.currency !== input.currency || value.payment_type !== input.payment_type || value.note !== input.note || !nonce(value.expected_quote)) return invalid();
  const amount = adjustmentCents(value.amount), signed = input.kind === 'credit_refund' ? -amount : amount;
  const balances = { UZS: adjustmentCents(value.balances?.UZS), USD: adjustmentCents(value.balances?.USD) }, remaining = { UZS: adjustmentCents(value.remaining?.UZS), USD: adjustmentCents(value.remaining?.USD) };
  const available = balances[input.currency] < 0n ? -balances[input.currency] : 0n;
  if (adjustmentCents(value.payment_amount) !== signed || adjustmentCents(value.available_credit) !== available || input.kind === 'credit_refund' && (amount <= 0n || amount > available)) return invalid();
  for (const currency of ['UZS', 'USD']) if (remaining[currency] !== balances[currency] - (input.currency === currency ? signed : 0n)) return invalid();
  return { protocol: ADJUSTMENT_PROTOCOL, actor_id: scope.actorId, tenant_id: scope.tenantId, counterparty_id: scope.customerId, branch_id: scope.branchId, kind: input.kind, amount: input.amount, payment_amount: fixed(signed), currency: input.currency, payment_type: input.payment_type, note: input.note, available_credit: fixed(available), balances: { UZS: fixed(balances.UZS), USD: fixed(balances.USD) }, remaining: { UZS: fixed(remaining.UZS), USD: fixed(remaining.USD) }, expected_quote: value.expected_quote };
}
export function adjustmentReceipt(value, scope, raw, key) {
  const input = adjustmentInput(raw), receipt = value?.adjustment_operation;
  if (!validScope(scope) || input.branch_id !== scope.branchId || !id(value?.id) || !input.expected_quote || typeof key !== 'string' || !key || key.length > 64 || value.counterparty !== scope.customerId || value.recorded_by !== scope.actorId || value.branch !== scope.branchId || value.branch_id !== scope.branchId || value.is_correction !== true || value.currency !== input.currency || value.payment_type !== input.payment_type || value.note !== input.note || typeof value.paid_at !== 'string' || !Number.isFinite(Date.parse(value.paid_at)) || value.exchange_rate != null || value.exchange_rate_source !== '' || value.exchange_rate_date != null || value.converted_amount_uzs != null) return invalid();
  const signed = input.kind === 'credit_refund' ? -adjustmentCents(input.amount) : adjustmentCents(input.amount);
  if (adjustmentCents(value.amount) !== signed || receipt?.protocol !== ADJUSTMENT_PROTOCOL || receipt.actor_id !== scope.actorId || receipt.tenant_id !== scope.tenantId || receipt.counterparty_id !== scope.customerId || receipt.branch_id !== scope.branchId || receipt.idempotency_key !== key || receipt.expected_quote !== input.expected_quote || receipt.kind !== input.kind || receipt.amount !== input.amount || receipt.currency !== input.currency || receipt.payment_type !== input.payment_type || receipt.note !== input.note) return invalid();
  return { id: value.id, counterparty: scope.customerId, recorded_by: scope.actorId, branch: scope.branchId, branch_id: scope.branchId, amount: fixed(signed), currency: input.currency, payment_type: input.payment_type, is_correction: true, note: input.note, paid_at: value.paid_at, exchange_rate: null, exchange_rate_source: '', exchange_rate_date: null, converted_amount_uzs: null, adjustment_operation: { protocol: ADJUSTMENT_PROTOCOL, actor_id: scope.actorId, tenant_id: scope.tenantId, counterparty_id: scope.customerId, branch_id: scope.branchId, idempotency_key: key, expected_quote: input.expected_quote, kind: input.kind, amount: input.amount, currency: input.currency, payment_type: input.payment_type, note: input.note } };
}
export function adjustmentAmount(value) {
  const text = fixed(adjustmentCents(value)), [whole, fraction] = text.split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fraction === '00' ? '' : ',' + fraction);
}
