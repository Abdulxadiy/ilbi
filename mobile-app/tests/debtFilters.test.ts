import { dueStatus, validateDebtPage } from '../src/features/debts/filters';
import contract from './contracts/debt-filters.json';

test('actual isolated API today page validates including a mixed debt/credit customer', () => {
  expect(() => validateDebtPage(contract.today, 'today')).not.toThrow();
  expect(contract.today.results).toHaveLength(3);
  expect(contract.today.summary.business_date).toBe('2026-10-29');
});
test.each([
  [null, 'undated'], ['2026-10-28', 'overdue'], ['2026-10-29', 'today'],
  ['2026-10-30', 'soon'], ['2026-11-05', 'soon'], ['2026-11-06', 'future'],
])('due date %s is %s relative to the authoritative business day', (date, status) => {
  expect(dueStatus(date, '2026-10-29')).toBe(status);
});
test('phone clock/timezone does not choose the business date; absent metadata has no guessed category', () => {
  jest.useFakeTimers().setSystemTime(new Date('2040-01-01T00:00:00Z'));
  try {
    expect(dueStatus('2026-10-29', '2026-10-29')).toBe('today');
    expect(dueStatus('2026-10-29', undefined)).toBe('');
    expect(dueStatus('2026-10-29', '2026-02-30')).toBe('');
  } finally { jest.useRealTimers(); }
});
test.each([
  {}, { summary: null }, { ...contract.today, summary: { ...contract.today.summary, debt_due_filter_version: 2 } },
  { ...contract.today, summary: { ...contract.today.summary, due_soon_days: 30 } },
  { ...contract.today, summary: { ...contract.today.summary, applied_due_status: '' } },
])('unacknowledged/unsupported due filters never silently accept an unfiltered page', value => {
  expect(() => validateDebtPage(value, 'today')).toThrow('Server muddat filtrini tasdiqlamadi');
  expect(() => validateDebtPage(value, '')).not.toThrow();
});
test.each([
  { debt_due_date: '2026-10-28' }, { debt_balance_uzs: '0.00', debt_balance_usd: '0.00' },
  { debt_balance_uzs: '-1.00', debt_balance_usd: '-5.00' }, { is_active: false },
])('an incorrectly filtered, settled, credit-only or archived row is rejected', changes => {
  const value = { ...contract.today, results: [{ ...contract.today.results[0], ...changes }] };
  expect(() => validateDebtPage(value, 'today')).toThrow('mos qarzlarni tasdiqlamadi');
});
