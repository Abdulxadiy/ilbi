import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SalesHistoryScreen } from '../src/features/sales/SalesHistoryScreen';
import { SaleVoidSheet } from '../src/features/sales/SaleVoidSheet';
import type { SavedSale } from '../src/features/sales/model';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request } from '../src/api/client';
import { confirmFinancialIdentity, withFinancialIdentity } from '../src/api/financialIdentity';
const mockTenant = { id: 1, name: 'A', is_owner: true, permissions: [] };
const mockUser = { id: 1, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ withFinancialIdentity: jest.fn(async (_operation, payload) => ({ ...payload, idempotency_key: 'same-void-key' })), getFinancialIntent: jest.fn(async () => null), confirmFinancialIdentity: jest.fn(async () => {}), rejectFinancialIdentity: jest.fn(async () => {}) }));
const originalSale = { id: 10, receipt_number: 'R10', status: 'completed', created_at: '2026-10-27T03:00:00Z', total_amount: '1000.00', refunded_amount: '0.00', net_amount: '1000.00', currency: 'UZS', payment_type: 'cash', b2b_target_tenant: null, items: [{ id: 51, product_name: 'Rice', quantity: '5.000', voided_quantity: '0.000', unit_price: '200.00', total_price: '1000.00', unit: 'kg', status: 'active' }] };
describe('Genuine sales history and return controls', () => {
  let current: typeof originalSale;
  beforeEach(() => {
    jest.clearAllMocks(); current = { ...originalSale, items: originalSale.items.map(item => ({ ...item })) };
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path === '/sales/capabilities/') return { sale_void_idempotency: 1 };
      if (path.startsWith('/sales/counterparties/')) return { results: [{ id: 4, name: 'Customer A' }], count: 1, next: null };
      if (options?.method === 'POST') {
        current = { ...current, status: 'partially_voided', refunded_amount: '250.00', net_amount: '750.00', items: [{ ...current.items[0], voided_quantity: '1.250' }] };
        return { id: 51, void_operation: { actor_id: 1, tenant_id: 1, idempotency_key: options.body.idempotency_key, kind: 'item', sale_id: 10, sale_item_id: 51, reason: options.body.reason, quantity: options.body.quantity, result: { currency: 'UZS', sale_status: 'partially_voided', refunded_amount: '250.00', sale_net_amount: '750.00' } } };
      }
      if (path === '/sales/10/') return current;
      return { results: [current], count: 1, next: null };
    });
  });
  test('searchable saved sales open actual details and applied date filters reach the backend', async () => {
    const screen = await render(<ThemeProvider><SalesHistoryScreen /></ThemeProvider>);
    await screen.findByLabelText('Savdo #R10: tafsilotlar');
    await fireEvent.press(screen.getByText('Savdo filtrlari'));
    await fireEvent.changeText(screen.getByLabelText('Boshlanish sanasi'), '2026-10-01');
    await fireEvent.changeText(screen.getByLabelText('Tugash sanasi'), '2026-10-27');
    await fireEvent.press(screen.getByText('Savdo mijozi: Tanlang'));
    await fireEvent.press(await screen.findByLabelText('Customer A'));
    await fireEvent.press(screen.getByText('Filtrlarni qo‘llash'));
    await screen.findByLabelText('Savdo #R10: tafsilotlar');
    expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('date_from=2026-10-01') && path.includes('date_to=2026-10-27') && path.includes('counterparty_id=4') && path.includes('page=1'))).toBe(true);
    await fireEvent.press(screen.getByLabelText('Savdo #R10: tafsilotlar'));
    expect(await screen.findByText('Qolgan: 1 000 UZS')).toBeTruthy();
    expect(request).toHaveBeenCalledWith('/sales/10/', expect.anything());
  });
  test('invalid calendar/date order is marked on its field and is not submitted', async () => {
    const screen = await render(<ThemeProvider><SalesHistoryScreen /></ThemeProvider>);
    await screen.findByLabelText('Savdo #R10: tafsilotlar');
    await fireEvent.press(screen.getByText('Savdo filtrlari'));
    await fireEvent.changeText(screen.getByLabelText('Boshlanish sanasi'), '2026-10-28');
    await fireEvent.changeText(screen.getByLabelText('Tugash sanasi'), '2026-10-01');
    await fireEvent.press(screen.getByText('Filtrlarni qo‘llash'));
    expect(screen.getByText('Tugash sanasi boshlanish sanasidan oldin bo‘lmasin.')).toBeTruthy();
    expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('date_from='))).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Boshlanish sanasi'), '2026-02-31');
    await fireEvent.press(screen.getByText('Filtrlarni qo‘llash'));
    expect(screen.getByText('Boshlanish sanasini YYYY-MM-DD shaklida kiriting.')).toBeTruthy();
  });
  test('partial return needs a reason and refreshes the authoritative refund/remaining balance', async () => {
    const screen = await render(<ThemeProvider><SalesHistoryScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByLabelText('Savdo #R10: tafsilotlar'));
    await fireEvent.press(await screen.findByText('Rice: qisman qaytarish'));
    await fireEvent.press(screen.getByText('Qaytarishni tasdiqlash'));
    expect(screen.getByText('Qaytarish sababini kiriting.')).toBeTruthy();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Qaytarish sababi'), 'Damaged item');
    await fireEvent.changeText(screen.getByLabelText('Qaytariladigan miqdor'), '1,250');
    await fireEvent.press(screen.getByText('Qaytarishni tasdiqlash'));
    expect(await screen.findByText('Qolgan: 750 UZS')).toBeTruthy();
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(request).toHaveBeenCalledWith('/sales/items/51/void/', { method: 'POST', body: { reason: 'Damaged item', quantity: '1.250', idempotency_key: 'same-void-key' } });
  });
  test('old server leaves read-only sales usable and never enables unprotected financial controls', async () => {
    jest.mocked(request).mockImplementation(async path => {
      if (path === '/sales/capabilities/') throw Object.assign(Error('Not found'), { status: 404 });
      return path === '/sales/10/' ? current : { results: [current], count: 1, next: null };
    });
    const screen = await render(<ThemeProvider><SalesHistoryScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByLabelText('Savdo #R10: tafsilotlar'));
    expect(await screen.findByText('Xavfsiz qaytarish uchun serverning yangi talqini talab qilinadi.')).toBeTruthy();
    expect(screen.queryByText('Savdoni to‘liq qaytarish')).toBeNull();
    expect(screen.queryByText('Rice: qisman qaytarish')).toBeNull();
  });
  test('a completed dialog ignores a queued second submit even before its parent unmounts', async () => {
    const onDone = jest.fn(async () => {});
    const sale = originalSale as SavedSale;
    const screen = await render(<ThemeProvider><SaleVoidSheet target={{ sale, line: sale.items[0] }} onClose={jest.fn()} onDone={onDone} /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Qaytarish sababi'), 'Damaged item');
    await fireEvent.changeText(screen.getByLabelText('Qaytariladigan miqdor'), '1.250');
    await fireEvent.press(screen.getByText('Qaytarishni tasdiqlash'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByText('Mahalliy tasdiqni saqlash'));
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(confirmFinancialIdentity).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
  test('unknown-result retry freezes the saved inputs and retains the same dialog operation', async () => {
    const handler = jest.mocked(request).getMockImplementation()!;
    let failed = false;
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (options?.method === 'POST' && !failed) { failed = true; throw Error('Connection lost'); }
      return handler(path, options);
    });
    const sale = originalSale as SavedSale, onDone = jest.fn(async () => {});
    const screen = await render(<ThemeProvider><SaleVoidSheet target={{ sale, line: sale.items[0] }} onClose={jest.fn()} onDone={onDone} /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Qaytarish sababi'), 'Damaged item');
    await fireEvent.changeText(screen.getByLabelText('Qaytariladigan miqdor'), '1.250');
    await fireEvent.press(screen.getByText('Qaytarishni tasdiqlash'));
    expect(await screen.findByText('Connection lost')).toBeTruthy();
    expect(screen.getByLabelText('Qaytarish sababi').props.editable).toBe(false);
    expect(screen.getByLabelText('Qaytariladigan miqdor').props.editable).toBe(false);
    await fireEvent.press(screen.getByText('Asl qaytarish natijasini tekshirish'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const calls = jest.mocked(withFinancialIdentity).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatch(/^void-item-10-51:[a-f0-9-]{36}$/);
    expect(calls[1][0]).toBe(calls[0][0]);
    expect(calls[1][1]).toEqual(calls[0][1]);
  });
});
