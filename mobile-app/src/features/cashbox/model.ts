import { parseMoneyMinor } from '../../domain/money';

export type CashboxKind = 'open' | 'close' | 'income' | 'expense';
export type ShiftStatus = { id: number | null; open: boolean; lastReportId: number | null; startedAt: string | null; values: Record<string, string> };
const keys = ['opening_cash_uzs', 'opening_cash_usd', 'expected_cash_uzs', 'expected_cash_usd', 'suggested_opening_cash_uzs', 'suggested_opening_cash_usd', 'total_sale_cash_uzs', 'total_sale_cash_usd', 'total_sale_card_uzs', 'total_sale_card_usd', 'total_sale_debt_uzs', 'total_sale_debt_usd', 'total_extra_income_uzs', 'total_extra_income_usd', 'total_expenses_uzs', 'total_expenses_usd', 'collected_debt_cash_uzs', 'collected_debt_cash_usd', 'refund_cash_uzs', 'refund_cash_usd'] as const;
export function amount(value: unknown) {
  if (!['string', 'number'].includes(typeof value)) throw Error('Kassa summasi tasdiqlanmadi.');
  const text = String(value);
  parseMoneyMinor(text.startsWith('-') ? text.slice(1) : text);
  return text;
}
export function parseShift(value: any): ShiftStatus {
  if (typeof value?.is_open !== 'boolean' || value.is_open && (!Number.isSafeInteger(value.shift_id) || value.shift_id < 1) || !value.is_open && value.shift_id != null) throw Error('Kassa smenasi tasdiqlanmadi.');
  if (value.last_report_id != null && (!Number.isSafeInteger(value.last_report_id) || value.last_report_id < 1)) throw Error('Oxirgi hisobot tasdiqlanmadi.');
  const values: Record<string, string> = {};
  keys.forEach(key => { values[key] = amount(value[key]); });
  return { id: value.shift_id ?? null, open: value.is_open, lastReportId: value.last_report_id ?? null, startedAt: typeof value.shift_start === 'string' ? value.shift_start : null, values };
}
export const cashboxEndpoint = (kind: CashboxKind) => kind === 'income' ? '/cashbox/income/' : kind === 'expense' ? '/cashbox/expenses/' : '/cashbox/shift/' + kind + '/';
export const cashboxPermission = (kind: CashboxKind) => kind === 'income' ? 'cashbox.record_income' : kind === 'expense' ? 'cashbox.record_expense' : 'cashbox.manage_shift';
export function parseCashboxResult(value: any, kind: CashboxKind, key: string, actor: number, tenant: number, payload: any) {
  const receipt = value?.cashbox_operation;
  if (!Number.isSafeInteger(value?.id) || value.id < 1 || receipt?.idempotency_key !== key || receipt.kind !== kind || receipt.actor_id !== actor || receipt.tenant_id !== tenant) throw Error('Server kassa amalini asl kalit bilan tasdiqlamadi. Jurnal saqlanadi.');
  if (kind === 'open') {
    const shift = parseShift(value);
    if (!shift.open || shift.id !== value.id || ['uzs', 'usd'].some(code => parseMoneyMinor(shift.values['opening_cash_' + code]) !== parseMoneyMinor(payload['opening_cash_' + code]))) throw Error('Ochilgan smena tasdiqlanmadi.');
  } else if (kind === 'close') {
    if (value.is_closed !== true || value.shift !== payload.shift_id || ['uzs', 'usd'].some(code => parseMoneyMinor(String(value['actual_cash_' + code])) !== parseMoneyMinor(payload['actual_cash_' + code]))) throw Error('Yopilgan smena hisoboti tasdiqlanmadi.');
  } else {
    if (!['UZS', 'USD'].includes(value.currency) || value.currency !== payload.currency || parseMoneyMinor(String(value.amount)) !== parseMoneyMinor(payload.amount) || parseMoneyMinor(String(value.amount)) <= 0 || value.recorded_by !== actor) throw Error('Kassa yozuvi tasdiqlanmadi.');
  }
  return value;
}
