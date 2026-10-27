import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { DebtsScreen } from '../src/features/debts/DebtsScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request, assertAuthScope } from '../src/api/client';
import { confirmFinancialIdentity, withFinancialIdentity } from '../src/api/financialIdentity';
const mockTenant = { id: 1, name: 'Store', is_owner: true, permissions: [] };
const mockUser = { id: 1, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ withFinancialIdentity: jest.fn(async (_operation, payload) => ({ ...payload, idempotency_key: 'same-intent-key' })), confirmFinancialIdentity: jest.fn(async () => {}), rejectFinancialIdentity: jest.fn(async () => {}) }));
const customer = { id: 1, name: 'Ali', phone_number: '+998901234567', debt_balance_uzs: '100.25', debt_balance_usd: '2.50', note: '', debt_due_date: '2026-10-28', is_active: true };
const list = { results: [customer], count: 1, next: null, summary: { debtors_count: 25, total_debt_uzs: '860000.75', total_debt_usd: '40.25' } };
describe('Real debt screen and durable payment boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(assertAuthScope).mockReset();
    jest.mocked(confirmFinancialIdentity).mockReset().mockResolvedValue(undefined);
    jest.mocked(request).mockImplementation(async (path, options) => path.endsWith('/payments/') ? { id: 8, counterparty: 1, ...options?.body } : path === '/sales/counterparties/1/' ? customer : list);
  });
  const open = async () => {
    const screen = await render(<ThemeProvider><DebtsScreen /></ThemeProvider>);
    await screen.findByText('Ali');
    await fireEvent.press(screen.getByText('To‘lov qabul qilish'));
    return screen;
  };
  test('loads actual paged debtors and store summary rather than a local fixture total', async () => {
    const screen = await render(<ThemeProvider><DebtsScreen /></ThemeProvider>);
    expect(await screen.findByText('Ali')).toBeTruthy();
    expect(screen.getByText('860 000,75 UZS')).toBeTruthy();
    expect(jest.mocked(request).mock.calls[0][0]).toContain('balance_status=debtors');
    expect(jest.mocked(request).mock.calls[0][0]).toContain('page=1&page_size=50');
  });
  test('invalid amounts turn the amount field red and never create an intent/payment', async () => {
    const screen = await open();
    await fireEvent.changeText(screen.getByLabelText('To‘lov summasi'), '-1');
    await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(screen.getByText('To‘lov summasini to‘g‘ri kiriting.')).toBeTruthy();
    expect(withFinancialIdentity).not.toHaveBeenCalled();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  test('re-reads the live balance before payment and blocks an amount above it', async () => {
    const screen = await open();
    jest.mocked(request).mockResolvedValueOnce({ ...customer, debt_balance_uzs: '5.00' });
    await fireEvent.changeText(screen.getByLabelText('To‘lov summasi'), '10');
    await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(screen.getByText('To‘lov joriy qarzdan oshmasin: 5 UZS')).toBeTruthy();
    expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test('successful USD/card payment sends exact decimal currency/method and stores accepted result', async () => {
    const screen = await open();
    await fireEvent.press(screen.getByText('USD'));
    await fireEvent.press(screen.getByText('Karta'));
    await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(withFinancialIdentity).toHaveBeenCalledWith('debt-1', { amount: '2.50', currency: 'USD', payment_type: 'card' }, 1, 1);
    expect(confirmFinancialIdentity).toHaveBeenCalledWith('debt-1', 1, 1, 'same-intent-key', expect.objectContaining({ id: 8, counterparty: 1, amount: '2.50' }));
  });
  test('local acknowledgment failure retries only the journal write, never another payment POST', async () => {
    jest.mocked(confirmFinancialIdentity).mockRejectedValueOnce(Error('Local disk unavailable')).mockResolvedValueOnce(undefined);
    const screen = await open();
    await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(await screen.findByText('Mahalliy tasdiqni saqlash')).toBeTruthy();
    await fireEvent.press(screen.getByText('Mahalliy tasdiqni saqlash'));
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(confirmFinancialIdentity).toHaveBeenCalledTimes(2);
  });
  test('scope changes cannot submit a payment for the previous account/store', async () => {
    const screen = await open();
    jest.mocked(assertAuthScope).mockImplementationOnce(() => { throw Error('Sessiya o‘zgargan.'); });
    await fireEvent.press(screen.getByText('To‘lovni tasdiqlash'));
    expect(screen.getByText('Sessiya o‘zgargan.')).toBeTruthy();
    expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
});
