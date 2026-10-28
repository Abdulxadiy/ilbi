import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { cartDraftKey, newDraft } from '../src/features/cart/drafts';
import { CartProvider, useCart } from '../src/features/cart/CartContext';
import { setApiBaseUrl, getApiBaseUrl } from '../src/api/client';

let mockUserId = 1, mockTenantId = 10;
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: mockUserId }, activeTenant: { id: mockTenantId } }) }));
const wrapper = ({ children }: { children: React.ReactNode }) => <CartProvider>{children}</CartProvider>;
const item = { variantId: 99, productId: 5, productName: 'Stored product', unit: 'kg', defaultPrice: 11500, unitPrice: 11500, quantity: 2 };
describe('Cart draft restoration and isolation', () => {
  beforeEach(async () => { mockUserId = 1; mockTenantId = 10; await AsyncStorage.clear(); });
  test('customer due date and B2B recipient survive restart; manual deadline survives same-customer reselection', async () => {
    const first = await renderHook(useCart, { wrapper });
    const customer = { id: 4, name: 'Partner', phoneNumber: '', targetTenantId: 8, targetTenantName: 'Receiving store', debtDueDate: '2026-12-31' };
    await act(async () => first.result.current.setCustomer(customer));
    expect(first.result.current.payment.dueDate).toBe('2026-12-31');
    await act(async () => first.result.current.setPayment({ dueDate: '2027-01-01' }));
    await act(async () => first.result.current.setCustomer(customer));
    expect(first.result.current.payment.dueDate).toBe('2027-01-01');
    await act(async () => first.result.current.flushDraft()); await first.unmount();
    const second = await renderHook(useCart, { wrapper });
    expect(second.result.current.customer?.targetTenantId).toBe(8);
    expect(second.result.current.payment.dueDate).toBe('2027-01-01');
    await act(async () => second.result.current.setCustomer({ id: 5, name: 'Other', phoneNumber: '' }));
    expect(second.result.current.payment.dueDate).toBe('');
  });

  test('checkout method, cash text, debt deadline and cart identity survive remount', async () => {
    const first = await renderHook(useCart, { wrapper });
    await act(async () => { first.result.current.addItem(item); first.result.current.setPayment({ method: 'debt', cashReceived: '11,50', dueDate: '2026-10-31' }); });
    await act(async () => { await first.result.current.flushDraft(); });
    const id = first.result.current.cartId;
    await first.unmount();
    const second = await renderHook(useCart, { wrapper });
    expect(second.result.current.cartId).toBe(id);
    expect(second.result.current.payment).toEqual({ method: 'debt', cashReceived: '11,50', dueDate: '2026-10-31' });
    await act(async () => second.result.current.clearCart());
    expect(second.result.current.cartId).not.toBe(id);
    expect(second.result.current.payment.method).toBe('cash');
  });
  test('v2 draft migration preserves the original and commits a stable new identity before restore', async () => {
    const old: any = { ...newDraft(1, 10, [item]), version: 2 }; delete old.id; delete old.payment;
    const raw = JSON.stringify(old), key = cartDraftKey(1, 10);
    await AsyncStorage.setItem(key, raw);
    const hook = await renderHook(useCart, { wrapper });
    expect(hook.result.current.ready).toBe(true); expect(hook.result.current.items).toEqual([item]);
    expect(await AsyncStorage.getItem(key + ':migration-v2')).toBe(raw);
    expect(JSON.parse((await AsyncStorage.getItem(key))!).id).toBe(hook.result.current.cartId);
  });

  test('wholesale mode persists configured prices and preserves negotiated prices', async () => {
    const first = await renderHook(useCart, { wrapper });
    await act(async () => first.result.current.addItem({ ...item, partnerPrice: 10000 }));
    await act(async () => first.result.current.setPartner(true));
    expect(first.result.current.items[0].unitPrice).toBe(10000);
    await act(async () => first.result.current.updateItemPrice(99, 10500));
    await act(async () => first.result.current.setPartner(false));
    expect(first.result.current.items[0].unitPrice).toBe(10500);
    await act(async () => first.result.current.setPartner(true));
    await act(async () => first.result.current.flushDraft());
    await first.unmount();
    const next = await renderHook(useCart, { wrapper });
    expect(next.result.current.partner).toBe(true); expect(next.result.current.items[0].unitPrice).toBe(10500);
  });
  test('USD cannot enter the retail cart and fractional increments remain exact', async () => {
    const hook = await renderHook(useCart, { wrapper });
    expect(() => hook.result.current.addItem({ ...item, currency: 'USD' })).toThrow('USD');
    await act(async () => hook.result.current.addItem({ ...item, quantity: 0.1 }));
    await act(async () => hook.result.current.addItem({ ...item, quantity: 0.2 }));
    expect(hook.result.current.items[0].quantity).toBe(0.3);
    expect(hook.result.current.totalQuantity).toBe(0.3);
  });
  test('restores a saved draft before allowing persistence to overwrite it', async () => {
    await AsyncStorage.setItem(cartDraftKey(1, 10), JSON.stringify(newDraft(1, 10, [item], { id: 4, name: 'Saved customer', phoneNumber: '' })));
    const hook = await renderHook(useCart, { wrapper });
    await act(async () => {});
    expect(hook.result.current.items).toEqual([item]);
    expect(hook.result.current.totalAmount).toBe(23000);
    expect(hook.result.current.customer?.id).toBe(4);
    expect(JSON.parse((await AsyncStorage.getItem(cartDraftKey(1, 10)))!).items).toEqual([item]);
  });
  test('switching store/account does not copy a previous cart into the new scope', async () => {
    const hook = await renderHook(useCart, { wrapper });
    await act(async () => { hook.result.current.addItem(item); hook.result.current.setCustomer({ id: 4, name: 'Customer', phoneNumber: '' }); });
    expect(hook.result.current.totalAmount).toBe(23000);
    mockTenantId = 20;
    await hook.rerender(undefined);
    await act(async () => {});
    expect(hook.result.current.items).toEqual([]);
    expect(hook.result.current.customer).toBeNull();
    mockTenantId = 10; mockUserId = 2;
    await hook.rerender(undefined); await act(async () => {});
    expect(hook.result.current.items).toEqual([]);
    expect(JSON.parse((await AsyncStorage.getItem(cartDraftKey(1, 10)))!).items).toEqual([item]);
  });
  test('equal user/store IDs on another server cannot restore this cart', async () => {
    const original = getApiBaseUrl(), originalKey = cartDraftKey(1, 10);
    await AsyncStorage.setItem(originalKey, JSON.stringify(newDraft(1, 10, [item])));
    await setApiBaseUrl('https://other.invalid/api/v1');
    const hook = await renderHook(useCart, { wrapper });
    await act(async () => {});
    expect(hook.result.current.items).toEqual([]);
    expect(await AsyncStorage.getItem(originalKey)).not.toBeNull();
    await setApiBaseUrl(original);
  });
  test('a failed restore never overwrites the existing draft', async () => {
    const key = cartDraftKey(1, 10), saved = JSON.stringify(newDraft(1, 10, [item]));
    await AsyncStorage.setItem(key, saved);
    const original = AsyncStorage.getItem;
    const readImplementation = jest.mocked(AsyncStorage.getItem).getMockImplementation()!;
    const read = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(Error('temporary read failure'));
    const hook = await renderHook(useCart, { wrapper });
    await act(async () => {});
    expect(hook.result.current.ready).toBe(false);
    expect(hook.result.current.persistenceError).toBe('temporary read failure');
    expect(await original(key)).toBe(saved);
    read.mockImplementation(readImplementation);
    await act(async () => hook.result.current.retryPersistence());
    await act(async () => {});
    expect(hook.result.current.items).toEqual([item]);
  });
  test('a corrupt draft is retained and mutations are blocked until recovery', async () => {
    const key = cartDraftKey(1, 10);
    await AsyncStorage.setItem(key, '{corrupt');
    const hook = await renderHook(useCart, { wrapper });
    await act(async () => {});
    expect(hook.result.current.ready).toBe(false);
    expect(await AsyncStorage.getItem(key)).toBe('{corrupt');
    expect(() => hook.result.current.addItem(item)).toThrow();
  });
  test('an unsuccessful write stays visible and can be retried with the current cart', async () => {
    const hook = await renderHook(useCart, { wrapper });
    await act(async () => {});
    const writeImplementation = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
    const save = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(Error('storage full'));
    await act(async () => hook.result.current.addItem(item));
    await act(async () => {});
    expect(hook.result.current.items).toEqual([item]);
    expect(hook.result.current.persistenceError).toBe('storage full');
    await expect(hook.result.current.flushDraft()).rejects.toThrow('storage full');
    save.mockImplementation(writeImplementation);
    await act(async () => hook.result.current.retryPersistence());
    await act(async () => {});
    expect(hook.result.current.persistenceError).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(cartDraftKey(1, 10)))!).items).toEqual([item]);
  });
});
