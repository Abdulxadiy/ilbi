import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CheckoutScreen } from '../src/features/checkout/CheckoutScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request } from '../src/api/client';
const mockContract = require('./contracts/backend.json');
let mockStock = '50.125', mockExpired = false, mockVat = false;
const mockVariant = mockContract.variants.results[0];
const mockItems = [{ variantId: mockVariant.id, productId: mockVariant.product, productName: 'Rice', unit: 'kg', quantity: 0.125, unitPrice: 11.5, defaultPrice: 11.5 }];
const mockTenant = { id: mockContract.tenant.id, is_owner: true, permissions: [] };
const mockUser = { id: 1, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: () => ({}), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ withFinancialIdentity: jest.fn(async (_operation, payload) => ({ ...payload, idempotency_key: 'stable-key' })), confirmFinancialIdentity: jest.fn(async () => {}), rejectFinancialIdentity: jest.fn(async () => {}), getFinancialIntent: jest.fn(async () => null) }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/features/cart/CartContext', () => ({ useCart: () => {
  const [payment, set] = jest.requireActual('react').useState({ method: 'cash', cashReceived: '', dueDate: '' });
  return { ready: true, cartId: 'cart-quote', partner: false, items: mockItems, customer: null, totalAmount: 1.44, totalQuantity: 0.125, totalTypes: 1, clearCart: jest.fn(), flushDraft: async () => {}, payment, setPayment: (patch: any) => set((old: any) => ({ ...old, ...patch })) };
} }));
const posts = () => jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST');
describe('Checkout stock/tax integration using real serializer shapes', () => {
  beforeEach(() => {
    jest.clearAllMocks(); mockStock = '50.125'; mockExpired = false; mockVat = false;
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (options?.method === 'POST') return mockContract.created_sales;
      if (path.includes('/catalog/variants/')) return [{ ...mockVariant, stock_quantity: mockStock, expired_batches: mockExpired ? [{ batch_code: 'OLD-1', expires_on: '2020-01-01', quantity: '1.000' }] : [] }];
      return { ...mockContract.tenant, receipt_settings: { ...mockContract.tenant.receipt_settings, is_vat_payer: mockVat, price_includes_vat: !mockVat } };
    });
  });
  test('re-reads stock immediately before creating a sale', async () => {
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await screen.findByText(/Soliqsiz:/); mockStock = '0.100';
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '2');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(await screen.findByText(/qoldiq yetarli emas/)).toBeTruthy(); expect(posts()).toHaveLength(0);
  });
  test('VAT-exclusive totals and exact expected settings reach checkout POST', async () => {
    mockVat = true;
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    expect(await screen.findByText(/QQS: 0,17/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '2');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(posts()[0][1]?.body.expected_tax_settings).toEqual({ is_vat_payer: true, vat_rate: '12.00', price_includes_vat: false });
  });
  test('live expired batches require explicit acknowledgement before POST', async () => {
    mockExpired = true;
    const screen = await render(<ThemeProvider><CheckoutScreen /></ThemeProvider>);
    await screen.findByText(/Muddati o‘tgan partiyalar:/);
    await fireEvent.changeText(screen.getByLabelText('Mijoz berdi'), '2');
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(posts()).toHaveLength(0);
    await fireEvent.press(screen.getByRole('checkbox'));
    await fireEvent.press(screen.getByText('Savdoni yakunlash'));
    expect(posts()).toHaveLength(1);
  });
});
