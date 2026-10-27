import { requiredDecimal, positiveId } from '../reports/model';
export type Customer = { id: number; name: string; phone_number: string; debt_balance_uzs: string; debt_balance_usd: string; debt_due_date: string | null; note: string; is_active: boolean; last_payment?: any };
export function parseCustomer(value: any): Customer {
  if (!value || typeof value.name !== 'string') throw Error('Server mijoz ma’lumotini tasdiqlamadi.');
  return { ...value, id: positiveId(value.id), phone_number: String(value.phone_number || ''), debt_balance_uzs: requiredDecimal(value.debt_balance_uzs), debt_balance_usd: requiredDecimal(value.debt_balance_usd), debt_due_date: value.debt_due_date || null, note: String(value.note || ''), is_active: value.is_active !== false };
}
