import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SyncScreen } from '../src/features/sync/SyncScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { listFinancialIntents } from '../src/api/financialIdentity';
import { reconcileFinancialIntent } from '../src/features/sync/reconcile';
const mockClear = jest.fn();
const mockTenant = { id: 2, name: 'Store', is_owner: true, permissions: [] };
const mockUser = { id: 1, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/features/cart/CartContext', () => ({ useCart: () => ({ cartId: 'current', clearCart: mockClear }) }));
jest.mock('../src/api/financialIdentity', () => ({ listFinancialIntents: jest.fn(), acknowledgeLegacySale: jest.fn() }));
jest.mock('../src/features/sync/reconcile', () => ({ reconcileFinancialIntent: jest.fn() }));
jest.mock('../src/features/sync/outbox', () => ({ outboxManager: { getQueue: async () => [] } }));
const intent = { key: 'one', operation: 'sale:current', payload: { items: [{ product_variant_id: 5, quantity: '0.125', unit_price: '11.50' }] }, createdAt: '2026-10-24T10:00:00Z' };
describe('Journal recovery screen', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.mocked(listFinancialIntents).mockResolvedValue([intent as any]); });
  test('manual result check confirms and clears only its matching cart', async () => {
    jest.mocked(reconcileFinancialIntent).mockResolvedValueOnce({ id: 55, receipt_number: 'R55' });
    const screen = await render(<ThemeProvider><SyncScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Asl kalit bilan natijani tekshirish'));
    expect(reconcileFinancialIntent).toHaveBeenCalledWith(intent, mockUser, mockTenant);
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Tasdiqlangan natija: #R55/)).toBeTruthy();
  });
  test('failed result check remains visible without clearing the cart', async () => {
    jest.mocked(reconcileFinancialIntent).mockRejectedValueOnce(Error('Still offline'));
    const screen = await render(<ThemeProvider><SyncScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Asl kalit bilan natijani tekshirish'));
    expect(screen.getByText('Still offline')).toBeTruthy(); expect(mockClear).not.toHaveBeenCalled();
  });
});
