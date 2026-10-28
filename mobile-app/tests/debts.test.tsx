import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DebtsScreen } from '../src/features/debts/DebtsScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request, assertAuthScope } from '../src/api/client';
import { confirmFinancialIdentity, getFinancialIntent, withFinancialIdentity, type FinancialIntent } from '../src/api/financialIdentity';
import { fetchDebtQuote, DEBT_QUOTE_PROTOCOL, type DebtQuote } from '../src/features/debts/quote';
import { formError } from '../src/api/validation';
const mockTenant = { id: 1, name: 'Store', is_owner: true, permissions: [] };
const mockBranch = { id: 2, name: 'Receiving branch', is_owner: true, permissions: [] };
const mockUser = { id: 1, role: 'owner', terms_accepted: true, tenants: [mockTenant, mockBranch] };
const mockPresses: Record<string, () => Promise<void>> = {};
jest.mock('../src/components/ui/Button', () => ({ Button: (props: any) => {
  mockPresses[props.title] = props.onPress;
  return jest.requireActual('react').createElement(jest.requireActual('../src/components/ui/Button').Button, props);
} }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ getFinancialIntent: jest.fn(async () => null), withFinancialIdentity: jest.fn(async (_operation, payload) => ({ ...payload, idempotency_key: 'same-intent-key' })), confirmFinancialIdentity: jest.fn(async () => {}), rejectFinancialIdentity: jest.fn(async () => {}) }));
jest.mock('../src/features/debts/quote', () => ({ DEBT_QUOTE_PROTOCOL: 'ilbi-debt-payment-quote-v1', fetchDebtQuote: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
const customer = { id: 1, name: 'Ali', phone_number: '+998901234567', debt_balance_uzs: '100.25', debt_balance_usd: '2.50', note: '', debt_due_date: '2026-10-28', is_active: true };
const list = { results: [customer], count: 1, next: null, summary: { debtors_count: 25, total_debt_uzs: '860000.75', total_debt_usd: '40.25' } };
const token = 'a'.repeat(64);
const baseQuote: DebtQuote = { protocol: DEBT_QUOTE_PROTOCOL, actor_id: 1, tenant_id: 1, counterparty_id: 1, branch_id: 1, amount: '100.25', currency: 'UZS', payment_type: 'cash', balances: { UZS: '100.25', USD: '2.50' }, applied: { UZS: '100.25', USD: '0.00' }, remaining: { UZS: '0.00', USD: '2.50' }, exchange_rate: null, exchange_rate_source: '', exchange_rate_date: null, creates_credit: false, expected_quote: token };
function savedPayment(body: any) {
  return { id: 8, counterparty: 1, recorded_by: 1, branch_id: body.branch_id ?? 1, ...body, payment_operation: { protocol: DEBT_QUOTE_PROTOCOL, actor_id: 1, tenant_id: 1, counterparty_id: 1, branch_id: body.branch_id ?? 1, idempotency_key: body.idempotency_key, expected_quote: body.expected_quote } };
}
describe('Authoritative two-step debt payment UI and durable boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(assertAuthScope).mockReset();
    jest.mocked(confirmFinancialIdentity).mockReset().mockResolvedValue(undefined);
    jest.mocked(getFinancialIntent).mockReset().mockResolvedValue(null);
    // Quote arithmetic/validation is tested by the real helper suite. Here the DTO fixture binds the actual selected form fields.
    jest.mocked(fetchDebtQuote).mockReset().mockImplementation(async (_id, payload) => ({ ...baseQuote, amount: payload.amount, currency: payload.currency, payment_type: payload.payment_type, branch_id: payload.branch_id ?? 1 }));
    jest.mocked(request).mockReset().mockImplementation(async (path, options) => path.endsWith('/payments/') ? savedPayment(options!.body) : list);
  });
  const open = async () => {
    const screen = await render(<ThemeProvider><DebtsScreen /></ThemeProvider>);
    await screen.findByText('Ali'); await fireEvent.press(screen.getByText('To‘lov qabul qilish'));
    return screen;
  };
  const calculate = async (screen: Awaited<ReturnType<typeof open>>) => {
    await fireEvent.press(screen.getByText('To‘lovni hisoblash'));
    await screen.findByText('Serverdagi to‘lov hisobi');
  };
  test('loads actual paged debtors and store summary rather than a local fixture total', async () => {
    const screen = await render(<ThemeProvider><DebtsScreen /></ThemeProvider>);
    expect(await screen.findByText('Ali')).toBeTruthy(); expect(screen.getByText('860 000,75 UZS')).toBeTruthy();
    expect(jest.mocked(request).mock.calls[0][0]).toContain('balance_status=debtors');
    expect(jest.mocked(request).mock.calls[0][0]).toContain('page=1&page_size=50');
  });
  test('due filters are sent to the server; an older server cannot silently supply unfiltered debtors', async () => {
    const screen = await render(<ThemeProvider><DebtsScreen /></ThemeProvider>);
    await screen.findByText('Ali'); await fireEvent.press(screen.getByText('Qarz filtrlarini ochish'));
    await fireEvent.press(screen.getByLabelText('Qarz muddati filtri: Muddati o‘tgan'));
    expect(await screen.findByText('Server muddat filtrini tasdiqlamadi. Serverni yangilang yoki muddat filtrini tozalang.')).toBeTruthy();
    expect(screen.queryByText('Ali')).toBeNull();
    expect(jest.mocked(request).mock.calls.at(-1)?.[0]).toContain('due_status=overdue');
    await fireEvent.press(screen.getByText('Qarz filtrlarini tozalash'));
    expect(await screen.findByText('Ali')).toBeTruthy();
  });
  test('credit filter clears an old due filter, renders both credit currencies and offers refund/statement', async () => {
    jest.mocked(request).mockImplementation(async path => ({ ...list, results: path.includes('balance_status=credit') ? [{ ...customer, debt_balance_uzs: '-12.50', debt_balance_usd: '-2.00' }] : list.results, summary: { ...list.summary, total_credit_uzs: '12.50', total_credit_usd: '2.00', credit_count: 1 } }));
    const screen = await render(<ThemeProvider><DebtsScreen /></ThemeProvider>);
    await screen.findByText('Ali'); await fireEvent.press(screen.getByText('Qarz filtrlarini ochish'));
    await fireEvent.press(screen.getByLabelText('Qarz muddati filtri: Bugun'));
    await fireEvent.press(screen.getByLabelText('Balans holati: Mijoz haqqi'));
    expect(await screen.findByText('Mijoz haqqi: 12,5 UZS / 2 USD · Mijozlar: 1')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Ali: mijoz haqqini qaytarish')).toBeTruthy());
    expect(screen.getByText('Ali: ko‘chirma')).toBeTruthy();
    expect(screen.queryByText('To‘lov qabul qilish')).toBeNull();
    expect(jest.mocked(request).mock.calls.at(-1)?.[0]).toContain('balance_status=credit');
    expect(jest.mocked(request).mock.calls.at(-1)?.[0]).not.toContain('due_status');
    expect(screen.queryByLabelText('Qarz muddati filtri: Bugun')).toBeNull();
    await fireEvent.press(screen.getByText('Ali: mijoz haqqini qaytarish'));
    expect(screen.getByLabelText('Qaytariladigan summa').props.value).toBe('12.5');
    expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test('a validated second page is requested with the same due filter, never a server next URL', async () => {
    const summary = { ...list.summary, business_date: '2026-10-29', debt_due_filter_version: 1, due_soon_days: 7, applied_due_status: 'overdue' };
    jest.mocked(request).mockImplementation(async path => path.includes('due_status=overdue') ? { results: [{ ...customer, ...(path.includes('page=2&') ? { id: 2, name: 'Older debtor' } : {}) }], count: 2, next: path.includes('page=2&') ? null : 'https://evil.invalid/steal', summary } : list);
    const screen = await render(<ThemeProvider><DebtsScreen /></ThemeProvider>); await screen.findByText('Ali');
    await fireEvent.press(screen.getByText('Qarz filtrlarini ochish')); await fireEvent.press(screen.getByLabelText('Qarz muddati filtri: Muddati o‘tgan'));
    await fireEvent.press(await screen.findByText('Yana qarzdorlar'));
    expect(await screen.findByText('Older debtor')).toBeTruthy();
    expect(jest.mocked(request).mock.calls.at(-1)?.[0]).toContain('due_status=overdue&page=2');
    expect(jest.mocked(request).mock.calls.every(([path]) => !path.startsWith('http'))).toBe(true);
  });
  test('initial calculation is a read and does not create an intent or payment', async () => {
    const screen = await open(); await calculate(screen);
    expect(fetchDebtQuote).toHaveBeenCalledWith(1, { amount: '100.25', currency: 'UZS', payment_type: 'cash', branch_id: 1, note: '' }, mockUser, mockTenant);
    expect(withFinancialIdentity).not.toHaveBeenCalled(); expect(confirmFinancialIdentity).not.toHaveBeenCalled();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    expect(screen.getByText('To‘lovni tasdiqlash')).toBeTruthy();
  });
  test('invalid amounts turn the exact field red before quoting or creating any intent', async () => {
    const screen = await open(); await fireEvent.changeText(screen.getByLabelText('To‘lov summasi'), '-1');
    await fireEvent.press(screen.getByText('To‘lovni hisoblash'));
    expect(screen.getByText('To‘lov summasini to‘g‘ri kiriting.')).toBeTruthy();
    expect(screen.getByLabelText('To‘lov summasi').props['aria-invalid']).toBe(true);
    expect(fetchDebtQuote).not.toHaveBeenCalled(); expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test('USD5 may cover UZS debt using the authoritative displayed conversion', async () => {
    jest.mocked(request).mockResolvedValue({ ...list, results: [{ ...customer, debt_balance_uzs: '100000.00', debt_balance_usd: '0.00' }] });
    const screen = await open(); await fireEvent.press(screen.getByText('USD'));
    await fireEvent.changeText(screen.getByLabelText('To‘lov summasi'), '5');
    jest.mocked(fetchDebtQuote).mockResolvedValue({ ...baseQuote, amount: '5.00', currency: 'USD', balances: { UZS: '100000.00', USD: '0.00' }, applied: { UZS: '65000.00', USD: '0.00' }, remaining: { UZS: '35000.00', USD: '0.00' }, exchange_rate: '13000.000000', exchange_rate_source: 'manual' });
    await calculate(screen);
    expect(screen.getByText('UZS qarziga: 65 000 UZS')).toBeTruthy();
    expect(screen.getByText('Qoladigan qarz: 35 000 UZS / 0 USD')).toBeTruthy();
    expect(screen.getByText('1 USD = 13000.000000 UZS · Do‘kon ichki kursi')).toBeTruthy();
    expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test.each(['amount', 'currency', 'method', 'branch', 'note'])('editing %s clears the displayed quote and requires a new calculation', async field => {
    const screen = await open(); await calculate(screen);
    if (field === 'amount') await fireEvent.changeText(screen.getByLabelText('To‘lov summasi'), '10');
    if (field === 'currency') await fireEvent.press(screen.getByText('USD'));
    if (field === 'method') await fireEvent.press(screen.getByText('Karta'));
    if (field === 'branch') await fireEvent.press(screen.getByLabelText('To‘lov qabul qiluvchi do‘kon: Receiving branch'));
    if (field === 'note') await fireEvent.changeText(screen.getByLabelText('To‘lov izohi'), 'Received at register');
    expect(screen.queryByText('Serverdagi to‘lov hisobi')).toBeNull();
    expect(screen.getByText('To‘lovni hisoblash')).toBeTruthy(); expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test('successful USD/card payment sends exact confirmed token, branch and note', async () => {
    const screen = await open(); await fireEvent.press(screen.getByText('USD')); await fireEvent.press(screen.getByText('Karta'));
    await fireEvent.press(screen.getByLabelText('To‘lov qabul qiluvchi do‘kon: Receiving branch'));
    await fireEvent.changeText(screen.getByLabelText('To‘lov izohi'), 'Branch receipt');
    await calculate(screen); await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(withFinancialIdentity).toHaveBeenCalledWith('debt:1:11111111-1111-4111-8111-111111111111', { amount: '2.50', currency: 'USD', payment_type: 'card', branch_id: 2, note: 'Branch receipt', expected_quote: token }, 1, 1);
    expect(confirmFinancialIdentity).toHaveBeenCalledWith('debt:1:11111111-1111-4111-8111-111111111111', 1, 1, 'same-intent-key', expect.objectContaining({ id: 8, counterparty: 1, amount: '2.50' }));
  });
  test('a stale quote before the new write marks the field red and requires recalculation', async () => {
    const screen = await open(); await calculate(screen);
    jest.mocked(fetchDebtQuote).mockRejectedValueOnce(formError({ amount: 'Qarz yoki kurs o‘zgardi.' }));
    await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(screen.getByText('Qarz yoki kurs o‘zgardi.')).toBeTruthy(); expect(screen.getByText('To‘lovni hisoblash')).toBeTruthy();
    expect(screen.queryByText('Serverdagi to‘lov hisobi')).toBeNull(); expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test('local acknowledgement failure retries only the journal write, without another quote or POST', async () => {
    jest.mocked(confirmFinancialIdentity).mockRejectedValueOnce(Error('Local disk unavailable')).mockResolvedValueOnce(undefined);
    const screen = await open(); await calculate(screen); await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(await screen.findByText('Mahalliy tasdiqni saqlash')).toBeTruthy();
    const quoteCount = jest.mocked(fetchDebtQuote).mock.calls.length;
    await fireEvent.press(screen.getByText('Mahalliy tasdiqni saqlash'));
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(fetchDebtQuote).toHaveBeenCalledTimes(quoteCount); expect(confirmFinancialIdentity).toHaveBeenCalledTimes(2);
  });
  test('an old queued confirm callback also retries only a known accepted local acknowledgement', async () => {
    jest.mocked(confirmFinancialIdentity).mockRejectedValueOnce(Error('Local disk unavailable')).mockResolvedValueOnce(undefined);
    const screen = await open(); await calculate(screen);
    const queued = mockPresses['To‘lovni tasdiqlash'];
    await act(async () => { await queued(); });
    expect(screen.getByText('Mahalliy tasdiqni saqlash')).toBeTruthy();
    const quoteCount = jest.mocked(fetchDebtQuote).mock.calls.length;
    await act(async () => { await queued(); });
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(fetchDebtQuote).toHaveBeenCalledTimes(quoteCount); expect(confirmFinancialIdentity).toHaveBeenCalledTimes(2);
  });
  test('unknown-result retry freezes the original token, amount, method, receiving branch and note', async () => {
    const screen = await open(); await calculate(screen);
    jest.mocked(request).mockRejectedValueOnce(Error('Connection lost'));
    await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(await screen.findByText('Asl to‘lov natijasini tekshirish')).toBeTruthy();
    expect(screen.getByLabelText('To‘lov summasi').props.editable).toBe(false);
    expect(screen.getByLabelText('To‘lov izohi').props.editable).toBe(false);
    const persisted = jest.mocked(withFinancialIdentity).mock.calls[0][1];
    jest.mocked(getFinancialIntent).mockResolvedValue({ status: 'pending', payload: persisted, key: 'same-intent-key' } as FinancialIntent);
    const quoteCount = jest.mocked(fetchDebtQuote).mock.calls.length;
    await fireEvent.press(screen.getByText('Asl to‘lov natijasini tekshirish'));
    expect(fetchDebtQuote).toHaveBeenCalledTimes(quoteCount);
    const posts = jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(posts).toHaveLength(2); expect(posts[1][1]?.body).toEqual(posts[0][1]?.body);
  });
  test('scope changes cannot submit a payment for the previous account/store', async () => {
    const screen = await open(); await calculate(screen);
    jest.mocked(assertAuthScope).mockImplementationOnce(() => { throw Error('Sessiya o‘zgargan.'); });
    await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(screen.getByText('Sessiya o‘zgargan.')).toBeTruthy(); expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test('completed payment ignores a queued callback from the same dialog', async () => {
    const screen = await open(); await calculate(screen);
    const queued = mockPresses['To‘lovni tasdiqlash'];
    await act(async () => { await queued(); }); await act(async () => { await queued(); });
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
});
