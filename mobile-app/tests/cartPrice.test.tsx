import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { CartScreen } from '../src/features/cart/CartScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
const mockUpdatePrice = jest.fn(), mockUpdateQuantity = jest.fn(), mockClear = jest.fn();
jest.mock('../src/features/cart/CartContext', () => ({ useCart: () => ({
  items: [{ variantId: 1, productName: 'Sut 1 L', unit: 'L', quantity: 2, unitPrice: 12000, defaultPrice: 12000 }],
  customer: null, totalQuantity: 2, totalTypes: 1, totalAmount: 24000,
  updateItemPrice: mockUpdatePrice, updateQuantity: mockUpdateQuantity, removeItem: jest.fn(), clearCart: mockClear, setCustomer: jest.fn(), loadCanonicalFixture: jest.fn(),
}) }));
describe('Negotiated price entry', () => {
  beforeEach(() => jest.clearAllMocks());

  test('fractional quantity has a dedicated accessible editor', async () => {
    const screen = await render(<ThemeProvider><CartScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByLabelText('Sut 1 L: miqdorni o‘zgartirish'));
    await fireEvent.changeText(screen.getByLabelText('Yangi miqdor'), '0,125');
    await fireEvent.press(screen.getByText('Miqdorni qo‘llash'));
    expect(mockUpdateQuantity).toHaveBeenCalledWith(1, 0.125);
  });
  test('clear cart requires explicit confirmation', async () => {
    const screen = await render(<ThemeProvider><CartScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Tozalash'));
    expect(mockClear).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Savatni saqlab qolish'));
    expect(mockClear).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Tozalash'));
    await fireEvent.press(screen.getByText('Ha, savatni tozalash'));
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
  test('comma decimal enters 11.50 rather than 1150', async () => {
    const screen = await render(<ThemeProvider><CartScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByLabelText('Sut 1 L: sotuv narxi'));
    await fireEvent.changeText(screen.getByLabelText('Yangi sotuv narxi'), '11,50');
    await fireEvent.press(screen.getByText("Qo'llash"));
    expect(mockUpdatePrice).toHaveBeenCalledWith(1, 11.5);
  });
  test('a negative amount is rejected and the sheet remains editable', async () => {
    const screen = await render(<ThemeProvider><CartScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByLabelText('Sut 1 L: sotuv narxi'));
    await fireEvent.changeText(screen.getByLabelText('Yangi sotuv narxi'), '-5');
    await fireEvent.press(screen.getByText("Qo'llash"));
    expect(mockUpdatePrice).not.toHaveBeenCalled();
    expect(screen.getByText('Dona narxini 0 dan katta summa sifatida kiriting.')).toBeTruthy();
    expect(screen.getByLabelText('Yangi sotuv narxi')).toBeTruthy();
    expect(screen.getByLabelText('Yangi sotuv narxi').props['aria-invalid']).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Yangi sotuv narxi'), '10000');
    expect(screen.getByLabelText('Yangi sotuv narxi').props['aria-invalid']).toBe(false);
  });
});
