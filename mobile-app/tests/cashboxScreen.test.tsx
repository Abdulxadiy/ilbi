import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { CashboxScreen } from '../src/features/cashbox/CashboxScreen';
import { request } from '../src/api/client';
import { submitCashbox } from '../src/features/cashbox/commands';
import { getFinancialIntent } from '../src/api/financialIdentity';
const tenant = { id: 7, name: 'Synthetic', is_owner: true, permissions: [] };
const user = { id: 2, role: 'owner', terms_accepted: true, tenants: [tenant] };
const mockPresses: Record<string, () => Promise<void>> = {};
jest.mock('../src/components/ui/Button', () => ({ Button: (props: any) => {
  mockPresses[props.title] = props.onPress;
  return jest.requireActual('react').createElement(jest.requireActual('../src/components/ui/Button').Button, props);
} }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user, activeTenant: tenant }) }));
jest.mock('../src/navigation/useAppNavigation', () => ({ useAppNavigation: () => ({ navigate: jest.fn(), openDrawer: jest.fn() }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('../src/features/cashbox/commands', () => ({ submitCashbox: jest.fn(), CashboxAcceptedButUnrecorded: class extends Error {} }));
jest.mock('../src/api/financialIdentity', () => ({ getFinancialIntent: jest.fn(), confirmFinancialIdentity: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '0f7f06dc-e740-4f83-b303-e36de43b1abc' }));
function shift(expected = '100.25') {
  return { is_open: true, shift_id: 19, shift_start: '2026-10-27T09:00:00+05:00', last_report_id: null,
    opening_cash_uzs: '100.25', opening_cash_usd: '0.00', expected_cash_uzs: expected, expected_cash_usd: '0.00',
    suggested_opening_cash_uzs: '0.00', suggested_opening_cash_usd: '0.00',
    total_sale_cash_uzs: '0.00', total_sale_cash_usd: '0.00', total_sale_card_uzs: '0.00', total_sale_card_usd: '0.00',
    total_sale_debt_uzs: '0.00', total_sale_debt_usd: '0.00', total_extra_income_uzs: '0.00', total_extra_income_usd: '0.00',
    total_expenses_uzs: '0.00', total_expenses_usd: '0.00', collected_debt_cash_uzs: '0.00', collected_debt_cash_usd: '0.00', refund_cash_uzs: '0.00', refund_cash_usd: '0.00' };
}
describe('Cashbox screen actual API flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getFinancialIntent).mockResolvedValue(null);
    jest.mocked(submitCashbox).mockResolvedValue({ id: 3 });
    jest.mocked(request).mockImplementation(async path => path.startsWith('/cashbox/shift/current/') ? shift() : path === '/cashbox/capabilities/' ? { cashbox_mutations: 1, idempotent_operations: ['open', 'close', 'income', 'expense'] } : { results: [], count: 0, next: null });
  });
  test('blank counted cash marks both fields red before any close command', async () => {
    const screen = await render(<ThemeProvider><CashboxScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Smenani yopish'));
    await fireEvent.press(screen.getByText('Smenani yopishni tasdiqlash'));
    expect(screen.getByLabelText('Sanalgan naqd UZS').props['aria-invalid']).toBe(true);
    expect(screen.getByLabelText('Sanalgan naqd USD').props['aria-invalid']).toBe(true);
    expect(submitCashbox).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Sanalgan naqd UZS'), '100,25');
    expect(screen.getByLabelText('Sanalgan naqd UZS').props['aria-invalid']).toBe(false);
    expect(screen.getByLabelText('Sanalgan naqd USD').props['aria-invalid']).toBe(true);
  });
  test('income sends exact original dialog, currency, source and current shift', async () => {
    const screen = await render(<ThemeProvider><CashboxScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Kassaga kirim'));
    await fireEvent.changeText(screen.getByLabelText('Kassa summasi'), '12,50');
    await fireEvent.press(screen.getByText('USD'));
    await fireEvent.changeText(screen.getByLabelText('Kirim manbasi'), 'Synthetic source');
    await fireEvent.changeText(screen.getByLabelText('Kassa sanasi'), '2026-10-27');
    await fireEvent.press(screen.getByText('Kassaga kirimni tasdiqlash'));
    expect(submitCashbox).toHaveBeenCalledWith('cashbox:income:0f7f06dc-e740-4f83-b303-e36de43b1abc', { amount: '12.50', currency: 'USD', source: 'Synthetic source', date: '2026-10-27', note: '', expected_shift_id: 19 }, user, tenant);
  });
  test('old server remains readable but exposes no mutation button', async () => {
    jest.mocked(request).mockImplementation(async path => path.startsWith('/cashbox/shift/current/') ? shift() : path === '/cashbox/capabilities/' ? {} : { results: [], count: 0, next: null });
    const screen = await render(<ThemeProvider><CashboxScreen /></ThemeProvider>);
    await screen.findByText('Smena ochiq · #19');
    expect(screen.queryByText('Smenani yopish')).toBeNull();
    expect(screen.queryByText('Kassaga kirim')).toBeNull();
  });
  test('unknown write freezes the draft and keeps original payload for retry', async () => {
    jest.mocked(submitCashbox).mockRejectedValueOnce(Error('Disconnected'));
    jest.mocked(getFinancialIntent).mockResolvedValue({ status: 'pending' } as any);
    const screen = await render(<ThemeProvider><CashboxScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Kassaga kirim'));
    await fireEvent.changeText(screen.getByLabelText('Kassa summasi'), '3.25');
    await fireEvent.changeText(screen.getByLabelText('Kirim manbasi'), 'Synthetic');
    await fireEvent.press(screen.getByText('Kassaga kirimni tasdiqlash'));
    expect(await screen.findByText('Disconnected')).toBeTruthy();
    expect(screen.getByLabelText('Kassa summasi').props.editable).toBe(false);
    const first = jest.mocked(submitCashbox).mock.calls[0];
    await fireEvent.press(screen.getByText('Asl amalni tekshirish'));
    expect(jest.mocked(submitCashbox).mock.calls[1]).toEqual(first);
  });
  test('a successful completed dialog cannot be resent by its queued callback', async () => {
    const screen = await render(<ThemeProvider><CashboxScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Smenani yopish'));
    await fireEvent.changeText(screen.getByLabelText('Sanalgan naqd UZS'), '100.25');
    await fireEvent.changeText(screen.getByLabelText('Sanalgan naqd USD'), '0');
    // Retain the original press callback, as an already queued native event could.
    const onPress = mockPresses['Smenani yopishni tasdiqlash'];
    await act(async () => { await onPress(); });
    await act(async () => { await onPress(); });
    expect(submitCashbox).toHaveBeenCalledTimes(1);
  });
});
