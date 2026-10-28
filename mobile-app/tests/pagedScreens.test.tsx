import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CatalogScreen } from '../src/features/catalog/CatalogScreen';
import { CustomerPickerSheet } from '../src/features/checkout/CustomerPickerSheet';
import { HomeScreen } from '../src/features/home/HomeScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request } from '../src/api/client';
let mockTenant = { id: 1, name: 'A', is_owner: true, permissions: [] as string[] };
const mockUser = { id: 1, role: 'owner', terms_accepted: true, tenants: [mockTenant, { ...mockTenant, id: 2, name: 'B' }] };
const mockAdd = jest.fn();
jest.mock('../src/api/client', () => ({ request: jest.fn() }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/features/cart/CartContext', () => ({ useCart: () => ({ ready: true, addItem: mockAdd }) }));
const product = { id: 9, product: 41, product_name: 'Rice', name: '1kg', unit: 'kg', price_recommended: '11.50', price_min: '10.00', price_partner: '11.00', stock_quantity: '2.750', barcode: '478001', currency: 'UZS' };
describe('Paged business screen integration', () => {
  beforeEach(() => { jest.clearAllMocks(); mockTenant = mockUser.tenants[0]; });

  test('USD prices retain their currency and cannot be added to retail checkout', async () => {
    jest.mocked(request).mockResolvedValue({ results: [{ ...product, currency: 'USD' }], count: 1, next: null });
    const screen = await render(<ThemeProvider><CatalogScreen /></ThemeProvider>);
    expect(await screen.findByText(/USD/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Rice: savatga qo‘shish'));
    expect(mockAdd).not.toHaveBeenCalled();
  });
  test('catalog exact barcode mode requests the complete barcode from the server', async () => {
    jest.mocked(request).mockResolvedValue({ results: [product], count: 1, next: null });
    const screen = await render(<ThemeProvider><CatalogScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Aniq shtrix-kod bo‘yicha'));
    await fireEvent.changeText(screen.getByLabelText('Tovar qidirish'), '478001');
    await screen.findByText('Rice');
    await new Promise(resolve => setTimeout(resolve, 300));
    await act(async () => {});
    expect(jest.mocked(request).mock.calls.some(([path]) => path === '/catalog/variants/?barcode=478001&page=1&page_size=50')).toBe(true);
    await fireEvent.press(screen.getByLabelText('Rice: savatga qo‘shish'));
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ productId: 41, defaultPrice: 11.5 }));
  });
  test('customer picker can select a customer on the second server page', async () => {
    jest.mocked(request).mockResolvedValueOnce({ results: [{ id: 1, name: 'First', phone_number: '111' }], count: 2, next: '?page=2' })
      .mockResolvedValueOnce({ results: [{ id: 2, name: 'Second page', phone_number: '222' }], count: 2, next: null });
    const select = jest.fn();
    const screen = await render(<ThemeProvider><CustomerPickerSheet visible onClose={() => {}} onSelectCustomer={select} /></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Yana mijozlar'));
    await fireEvent.press(await screen.findByText('Second page'));
    await fireEvent.press(screen.getByText('Tanlash'));
    expect(select).toHaveBeenCalledWith({ id: 2, name: 'Second page', phoneNumber: '222' });
  });
  test('the dashboard ignores the previous store result after switching', async () => {
    let finish!: (v: any) => void;
    const old = new Promise(resolve => { finish = resolve; });
    jest.mocked(request).mockImplementation(async path => path.includes('analytics') ? (mockTenant.id === 1 ? old : { kpi: { total_sales_uzs: 200 } }) : []);
    const screen = await render(<ThemeProvider><HomeScreen /></ThemeProvider>);
    mockTenant = mockUser.tenants[1]; await screen.rerender(<ThemeProvider><HomeScreen /></ThemeProvider>);
    await act(async () => { finish({ kpi: { total_sales_uzs: 999 } }); });
    expect(screen.queryByText(/999/)).toBeNull();
    expect(screen.getByText(/200/)).toBeTruthy();
  });
});
