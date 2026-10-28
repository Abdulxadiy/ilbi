import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CheckoutScreen } from '../src/features/checkout/CheckoutScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { confirmFinancialIdentity, rejectFinancialIdentity, getFinancialIntent } from '../src/api/financialIdentity';
import { request } from '../src/api/client';

const mockClearCart = jest.fn();
const mockQuote = { totalAmount: 23000, subtotalAmount: 23000, taxAmount: 0, settings: { is_vat_payer: false, vat_rate: '12.00', price_includes_vat: true }, warnings: [] as string[], warningKey: '[]' };
jest.mock('../src/features/checkout/useRetailQuote', () => ({ useRetailQuote: () => ({ quote: mockQuote, error: '', loading: false, reload: async () => mockQuote }) }));
let mockOwner = true;
let mockCustomer: any = null;
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: () => ({}), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ withFinancialIdentity: jest.fn(async (_operation, payload) => ({ ...payload, idempotency_key: 'stable-key' })), confirmFinancialIdentity: jest.fn(async () => {}), rejectFinancialIdentity: jest.fn(async () => {}), getFinancialIntent: jest.fn(async () => null) }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'owner', terms_accepted: true, tenants: [{ id: 2, is_owner: mockOwner, permissions: [] }] }, activeTenant: { id: 2, is_owner: mockOwner, permissions: [] } }) }));
jest.mock('../src/features/cart/CartContext', () => ({ useCart: () => { const [payment, set] = jest.requireActual('react').useState({ method: 'cash', cashReceived: '', dueDate: '' }); return ({
  ready: true, partner: false, cartId: 'cart-fixture', payment, setPayment: (patch: any) => set((old: any) => ({ ...old, ...patch })), flushDraft: async () => {},
  items: [{ variantId: 1, quantity: 2, unitPrice: 11500 }], customer: mockCustomer,
  totalAmount: 23000, totalQuantity: 2, totalTypes: 1, clearCart: mockClearCart,
}); } }));
describe('Checkout confirmation boundary', () => {
  beforeEach(() => { jest.clearAllMocks(); mockOwner = true; mockCustomer = null; jest.mocked(confirmFinancialIdentity).mockResolvedValue(undefined); jest.mocked(rejectFinancialIdentity).mockResolvedValue(undefined); jest.mocked(getFinancialIntent).mockResolvedValue(null); });

  test('confirmed change uses the accepted server total, including decimals', async () => {
    jest.mocked(request).mockResolvedValueOnce([{ id: 55, total_amount: '24000.50', payment_type: 'cash' }]);
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '30000');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(await screen.findByText(/5\s?999,5/)).toBeTruthy();
  });
  test('a rejection storage failure preserves the original server error', async () => {
    jest.mocked(request).mockRejectedValueOnce(Object.assign(Error('Insufficient stock'), { status: 400 }));
    jest.mocked(rejectFinancialIdentity).mockRejectedValueOnce(Error('Storage full'));
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '30000');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(await screen.findByText(/Insufficient stock.*qurilmaga yozilmadi/)).toBeTruthy();
    expect(mockClearCart).not.toHaveBeenCalled(); expect(confirmFinancialIdentity).not.toHaveBeenCalled();
  });
  test('a confirmed sale remains confirmed when local journal save fails; retry only saves locally', async () => {
    jest.mocked(request).mockResolvedValueOnce([{ id: 55, total_amount: '23000', payment_type: 'cash' }]);
    jest.mocked(confirmFinancialIdentity).mockRejectedValueOnce(Error('Storage full'));
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '30000');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(await screen.findByText('Savdo yakunlandi')).toBeTruthy();
    expect(screen.getByText(/Savdo serverda tasdiqlandi, qurilmaga yozish yakunlanmadi/)).toBeTruthy();
    expect(mockClearCart).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Tasdiqni qurilmaga qayta saqlash'));
    expect(request).toHaveBeenCalledTimes(1); expect(mockClearCart).toHaveBeenCalledTimes(1);
  });
  test('a restored confirmed cart reuses its saved result without another POST', async () => {
    jest.mocked(getFinancialIntent).mockResolvedValueOnce({ status: 'confirmed', result: { id: 55, total_amount: '23000', payment_type: 'cash' } } as any);
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '30000');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(await screen.findByText('Savdo yakunlandi')).toBeTruthy(); expect(request).not.toHaveBeenCalled();
  });
  test('debt due date is chosen for this sale and sent in its payload', async () => {
    mockCustomer = { id: 9, name: 'Customer' };
    jest.mocked(request).mockResolvedValueOnce([{ id: 55, total_amount: '23000', payment_type: 'debt' }]);
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Nasiya'));
    await fireEvent.changeText(screen.getByLabelText('Qarzni qaytarish sanasi'), '2026-10-31');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(request).toHaveBeenCalledWith('/sales/', expect.objectContaining({ body: expect.objectContaining({ payment_type: 'debt', counterparty_id: 9, debt_due_date: '2026-10-31' }) }));
  });
  test('an invalid calendar date cannot be submitted as a debt deadline', async () => {
    mockCustomer = { id: 9, name: 'Customer' };
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Nasiya'));
    await fireEvent.changeText(screen.getByLabelText('Qarzni qaytarish sanasi'), '2026-02-30');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(request).not.toHaveBeenCalled(); expect(screen.getByText(/Qaytarish sanasini YYYY/)).toBeTruthy();
  });
  test('losing the active store permission prevents a financial request', async () => {
    mockOwner = false;
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '30000');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(await screen.findByText('Bu amal uchun faol do‘konda vakolat berilmagan.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  test('a server error keeps the cart and shows the real failure', async () => {
    jest.mocked(request).mockRejectedValueOnce(Error('Server offline'));
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '30000');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(await screen.findByText('Server offline')).toBeTruthy();
    expect(mockClearCart).not.toHaveBeenCalled();
    expect(screen.queryByText('Savdo yakunlandi')).toBeNull();
  });
  test('only a server-confirmed sale clears the cart', async () => {
    jest.mocked(request).mockResolvedValueOnce([{ id: 55, total_amount: 23000, payment_type: 'cash' }]);
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '30000');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(await screen.findByText('Savdo yakunlandi')).toBeTruthy();
    expect(mockClearCart).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/7\s?000/)).toBeTruthy();
  });
});
