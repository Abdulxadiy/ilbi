import { parseMoneyMinor } from '../../domain/money';
import { formError } from '../../api/validation';

export const ADJUSTMENT_PROTOCOL = 'ilbi-debt-adjustment-quote-v1';
export type AdjustmentKind = 'credit_refund' | 'correction';
export type AdjustmentPayload = { kind: AdjustmentKind; amount: string; currency: 'UZS' | 'USD'; payment_type: 'cash' | 'card' | 'none'; branch_id: number; note: string; expected_quote?: string };
export type AdjustmentScope = { actorId: number; tenantId: number; customerId: number; branchId: number };
export type AdjustmentQuote = { protocol: typeof ADJUSTMENT_PROTOCOL; actor_id: number; tenant_id: number; counterparty_id: number; branch_id: number; kind: AdjustmentKind; amount: string; payment_amount: string; currency: 'UZS' | 'USD'; payment_type: AdjustmentPayload['payment_type']; note: string; available_credit: string; balances: { UZS: string; USD: string }; remaining: { UZS: string; USD: string }; expected_quote: string };
const maxMinor = 99_999_999_999_999n;
const id = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const invalid = (): never => { throw Error('Server tuzatish hisobini to‘liq tasdiqlamadi. Hisobni yangilang.'); };
export function adjustmentMoney(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value)) return invalid();
  const negative = value.startsWith('-'), [whole, fraction] = (negative ? value.slice(1) : value).split('.');
  const amount = BigInt(whole) * 100n + BigInt(fraction);
  if (amount > maxMinor) return invalid();
  return negative ? -amount : amount;
}
const textMoney = (minor: bigint) => (minor < 0n ? '-' : '') + `${(minor < 0n ? -minor : minor) / 100n}.${((minor < 0n ? -minor : minor) % 100n).toString().padStart(2, '0')}`;
export function adjustmentPayload(raw: any): AdjustmentPayload {
  const fields: Record<string, string> = {};
  let amount = 0n;
  try { amount = BigInt(parseMoneyMinor(raw?.amount, true)); if (!amount || amount > maxMinor || amount < -maxMinor) throw Error(); }
  catch { fields.amount = 'Summani ikki kasr xonasigacha to‘g‘ri kiriting.'; }
  if (!['credit_refund', 'correction'].includes(raw?.kind)) fields.kind = 'Tuzatish turini tanlang.';
  if (!['UZS', 'USD'].includes(raw?.currency)) fields.currency = 'Valyutani tanlang.';
  if (!['cash', 'card', 'none'].includes(raw?.payment_type) || raw?.kind === 'credit_refund' && raw.payment_type === 'none') fields.payment_type = 'Haqni qaytarish usulini tanlang.';
  if (raw?.kind === 'credit_refund' && amount <= 0n) fields.amount = 'Qaytariladigan summa musbat bo‘lsin.';
  if (!id(raw?.branch_id)) fields.branch_id = 'Qaytaruvchi do‘konni tanlang.';
  if (typeof raw?.note !== 'string' || !raw.note.trim() || raw.note.trim().length > 2000) fields.note = 'Sababni kiriting (2000 belgigacha).';
  if (raw?.expected_quote != null && (typeof raw.expected_quote !== 'string' || !/^[a-f0-9]{64}$/.test(raw.expected_quote))) return invalid();
  if (Object.keys(fields).length) throw formError(fields);
  return { kind: raw.kind, amount: textMoney(amount), currency: raw.currency, payment_type: raw.payment_type, branch_id: raw.branch_id, note: raw.note.trim(), ...(raw.expected_quote ? { expected_quote: raw.expected_quote } : {}) };
}
const validScope = (scope: AdjustmentScope) => [scope.actorId, scope.tenantId, scope.customerId, scope.branchId].every(id);
export function parseAdjustmentQuote(value: any, scope: AdjustmentScope, raw: AdjustmentPayload): AdjustmentQuote {
  const input = adjustmentPayload(raw);
  if (!validScope(scope) || value?.protocol !== ADJUSTMENT_PROTOCOL || value.actor_id !== scope.actorId || value.tenant_id !== scope.tenantId || value.counterparty_id !== scope.customerId || value.branch_id !== scope.branchId || input.branch_id !== scope.branchId || value.kind !== input.kind || value.currency !== input.currency || value.amount !== input.amount || value.payment_type !== input.payment_type || value.note !== input.note || typeof value.expected_quote !== 'string' || !/^[a-f0-9]{64}$/.test(value.expected_quote)) return invalid();
  const amount = adjustmentMoney(value.amount), signed = input.kind === 'credit_refund' ? -amount : amount;
  if (adjustmentMoney(value.payment_amount) !== signed) return invalid();
  const balances = { UZS: adjustmentMoney(value.balances?.UZS), USD: adjustmentMoney(value.balances?.USD) };
  const remaining = { UZS: adjustmentMoney(value.remaining?.UZS), USD: adjustmentMoney(value.remaining?.USD) };
  const selected = balances[input.currency], available = selected < 0n ? -selected : 0n;
  if (adjustmentMoney(value.available_credit) !== available || input.kind === 'credit_refund' && (amount <= 0n || amount > available)) return invalid();
  for (const currency of ['UZS', 'USD'] as const) if (remaining[currency] !== balances[currency] - (currency === input.currency ? signed : 0n)) return invalid();
  // Keep only the protocol DTO; opaque response fields never reach product UI.
  return { protocol: ADJUSTMENT_PROTOCOL, actor_id: value.actor_id, tenant_id: value.tenant_id, counterparty_id: value.counterparty_id, branch_id: value.branch_id, kind: input.kind, amount: input.amount, payment_amount: textMoney(signed), currency: input.currency, payment_type: input.payment_type, note: input.note, available_credit: value.available_credit, balances: { UZS: value.balances.UZS, USD: value.balances.USD }, remaining: { UZS: value.remaining.UZS, USD: value.remaining.USD }, expected_quote: value.expected_quote };
}
export function acceptedAdjustment(value: any, scope: AdjustmentScope, raw: AdjustmentPayload, key: string) {
  const input = adjustmentPayload(raw), receipt = value?.adjustment_operation;
  if (!validScope(scope) || !id(value?.id) || !input.expected_quote || !key || key.length > 64 || value.counterparty !== scope.customerId || value.recorded_by !== scope.actorId || value.branch !== scope.branchId || value.branch_id !== scope.branchId || value.currency !== input.currency || value.payment_type !== input.payment_type || value.is_correction !== true || value.note !== input.note || typeof value.paid_at !== 'string' || !Number.isFinite(Date.parse(value.paid_at)) || value.exchange_rate != null || value.converted_amount_uzs != null || value.exchange_rate_date != null || value.exchange_rate_source !== '') return invalid();
  const signed = input.kind === 'credit_refund' ? -adjustmentMoney(input.amount) : adjustmentMoney(input.amount);
  if (adjustmentMoney(value.amount) !== signed || receipt?.protocol !== ADJUSTMENT_PROTOCOL || receipt.actor_id !== scope.actorId || receipt.tenant_id !== scope.tenantId || receipt.counterparty_id !== scope.customerId || receipt.branch_id !== scope.branchId || receipt.idempotency_key !== key || receipt.expected_quote !== input.expected_quote || receipt.kind !== input.kind || receipt.currency !== input.currency || receipt.amount !== input.amount || receipt.payment_type !== input.payment_type || receipt.note !== input.note) return invalid();
  return { id: value.id as number, counterparty: scope.customerId, recorded_by: scope.actorId, branch: scope.branchId, branch_id: scope.branchId, amount: value.amount as string, currency: input.currency, payment_type: input.payment_type, is_correction: true as const, note: input.note, paid_at: value.paid_at as string, recorded_by_name: typeof value.recorded_by_name === 'string' ? value.recorded_by_name : '', branch_name: typeof value.branch_name === 'string' ? value.branch_name : '', exchange_rate: null, exchange_rate_source: '', exchange_rate_date: null, converted_amount_uzs: null, adjustment_operation: { protocol: ADJUSTMENT_PROTOCOL, actor_id: scope.actorId, tenant_id: scope.tenantId, counterparty_id: scope.customerId, branch_id: scope.branchId, idempotency_key: key, expected_quote: input.expected_quote, kind: input.kind, currency: input.currency, amount: input.amount, payment_type: input.payment_type, note: input.note } };
}
