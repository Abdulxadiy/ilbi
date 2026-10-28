import { isIsoDate } from '../../domain/date';
import { parseMoneyMinor } from '../../domain/money';

export type DebtDue = '' | 'overdue' | 'today' | 'soon' | 'future' | 'undated';
export type DebtBalance = 'debtors' | 'all' | 'credit' | 'settled';
export const dueOptions: { value: DebtDue; label: string }[] = [{ value: '', label: 'Barcha muddatlar' }, { value: 'overdue', label: 'Muddati o‘tgan' }, { value: 'today', label: 'Bugun' }, { value: 'soon', label: '7 kun ichida' }, { value: 'future', label: 'Keyinroq' }, { value: 'undated', label: 'Muddatsiz' }];
const addDays = (day: string, count: number) => { const date = new Date(day + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); };
export function dueStatus(date: string | null, businessDate: unknown): DebtDue {
  if (typeof businessDate !== 'string' || !isIsoDate(businessDate)) return '';
  if (!date) return 'undated';
  if (!isIsoDate(date)) throw Error('Qarz muddati tasdiqlanmadi.');
  return date < businessDate ? 'overdue' : date === businessDate ? 'today' : date <= addDays(businessDate, 7) ? 'soon' : 'future';
}
export function validateDebtPage(value: any, due: DebtDue) {
  if (!due) return; // Older servers still support the existing balance/search list.
  const summary = value?.summary;
  if (summary?.debt_due_filter_version !== 1 || summary?.due_soon_days !== 7 || summary?.applied_due_status !== due || typeof summary?.business_date !== 'string' || !isIsoDate(summary.business_date) || !Array.isArray(value?.results)) throw Error('Server muddat filtrini tasdiqlamadi. Serverni yangilang yoki muddat filtrini tozalang.');
  for (const row of value.results) {
    if (!row || row.is_active === false || parseMoneyMinor(row.debt_balance_uzs, true) <= 0 && parseMoneyMinor(row.debt_balance_usd, true) <= 0 || dueStatus(row.debt_due_date, summary.business_date) !== due) throw Error('Server muddat filtriga mos qarzlarni tasdiqlamadi. Ro‘yxatni yangilang.');
  }
}
