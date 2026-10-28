import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { CartProvider, useCart } from '../src/features/cart/CartContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CartProvider>{children}</CartProvider>
);

describe('Cart Domain & Canonical Price Negotiation (Board 22 & Master Spec)', () => {
  test('Scenario C01: Initial 10 canonical items sum to exactly 161 000 UZS', async () => {
    const hook = await renderHook(() => useCart(), { wrapper });

    await act(async () => {
      hook.result.current.loadCanonicalFixture();
    });

    expect(hook.result.current.items).toHaveLength(10);
    expect(hook.result.current.totalQuantity).toBe(15);
    expect(hook.result.current.totalAmount).toBe(161000);

    // Verify initial "Sut 1 L" item (variantId: 1)
    const milk = hook.result.current.items.find((i) => i.variantId === 1);
    expect(milk).toBeDefined();
    expect(milk?.quantity).toBe(2);
    expect(milk?.defaultPrice).toBe(12000);
    expect(milk?.unitPrice).toBe(12000);
  });

  test('Scenario C02: Customer price change (Sut 1 L from 12 000 to 11 500) reduces total to 160 000 UZS', async () => {
    const hook = await renderHook(() => useCart(), { wrapper });

    await act(async () => {
      hook.result.current.loadCanonicalFixture();
    });

    // Update unit price to 11 500 ("Faqat shu savdo uchun")
    await act(async () => {
      hook.result.current.updateItemPrice(1, 11500);
    });

    const updatedMilk = hook.result.current.items.find((i) => i.variantId === 1);
    expect(updatedMilk?.unitPrice).toBe(11500);
    // Crucial requirement: default catalog price remains untouched!
    expect(updatedMilk?.defaultPrice).toBe(12000);

    // Line amount: 2 dona x 11 500 = 23 000 UZS
    const lineAmount = (updatedMilk?.unitPrice || 0) * (updatedMilk?.quantity || 0);
    expect(lineAmount).toBe(23000);

    // Total cart price drops by 1 000 to exactly 160 000 UZS
    expect(hook.result.current.totalAmount).toBe(160000);
  });

  test('Scenario C04: Quantity adjustment after price negotiation retains the custom unit price', async () => {
    const hook = await renderHook(() => useCart(), { wrapper });

    await act(async () => {
      hook.result.current.loadCanonicalFixture();
    });

    await act(async () => {
      hook.result.current.updateItemPrice(1, 11500);
    });

    // Change milk quantity from 2 to 3
    await act(async () => {
      hook.result.current.updateQuantity(1, 3);
    });

    const updatedMilk = hook.result.current.items.find((i) => i.variantId === 1);
    expect(updatedMilk?.quantity).toBe(3);
    expect(updatedMilk?.unitPrice).toBe(11500);

    // Line total: 3 dona x 11 500 = 34 500 UZS
    const lineAmount = (updatedMilk?.unitPrice || 0) * (updatedMilk?.quantity || 0);
    expect(lineAmount).toBe(34500);

    // Total cart price: 160 000 + 11 500 = 171 500 UZS
    expect(hook.result.current.totalAmount).toBe(171500);
  });

  test('Scenario C05: Emptying cart results in 0 items and 0 UZS', async () => {
    const hook = await renderHook(() => useCart(), { wrapper });

    await act(async () => {
      hook.result.current.loadCanonicalFixture();
    });
    expect(hook.result.current.items.length).toBeGreaterThan(0);

    await act(async () => {
      hook.result.current.clearCart();
    });

    expect(hook.result.current.items).toHaveLength(0);
    expect(hook.result.current.totalQuantity).toBe(0);
    expect(hook.result.current.totalAmount).toBe(0);
  });

  test('Customer selection attaches counterparty to the cart session', async () => {
    const hook = await renderHook(() => useCart(), { wrapper });

    const mockCustomer = {
      id: 1,
      name: 'Ali Valiyev',
      phoneNumber: '+998 90 123 45 67',
    };

    await act(async () => {
      hook.result.current.setCustomer(mockCustomer);
    });

    expect(hook.result.current.customer).toEqual(mockCustomer);

    await act(async () => {
      hook.result.current.setCustomer(null);
    });

    expect(hook.result.current.customer).toBeNull();
  });
});
