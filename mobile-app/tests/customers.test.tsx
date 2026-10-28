import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { CustomersScreen } from '../src/features/customers/CustomersScreen';
import { CustomerStatementScreen } from '../src/features/customers/CustomerStatementScreen';
import { CustomerPickerSheet } from '../src/features/checkout/CustomerPickerSheet';
import { customerBody, customerDraft, parseCustomer, parseCustomerPayment } from '../src/features/customers/model';
import { customerSelection } from '../src/features/customers/selection';
import { request } from '../src/api/client';
import contract from './contracts/customers.json';
import { parseSavedSale } from '../src/features/sales/model';
import { parseMoneyMinor } from '../src/domain/money';
let mockTenant = { id: 1, name: 'Store', is_owner: true, permissions: [] as string[] };
let mockUser = { id: 7, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
let mockParams = { id: '1' };
let mockRefocus: () => void;
const mockNavigate = jest.fn();
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/navigation/useAppNavigation', () => ({ useAppNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), openDrawer: jest.fn() }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useFocusEffect: (callback: () => void) => { mockRefocus = callback; jest.requireActual('react').useEffect(callback, [callback]); } }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
const customer = (overrides: object = {}) => ({ id: 1, name: 'Ali', phone_number: '+998901234567', debt_balance_uzs: '70.00', debt_balance_usd: '-2.50', note: 'Regular', debt_due_date: '2026-12-31', target_tenant: 8, target_tenant_name: 'B2B store', is_active: true, ...overrides });
const sale = (overrides: object = {}) => ({ id: 11, counterparty: 1, receipt_number: 'CUSTOMER-11', currency: 'UZS', total_amount: '100.00', refunded_amount: '20.00', net_amount: '80.00', payment_type: 'debt', status: 'partially_voided', items: [], created_at: '2026-10-28T09:00:00+05:00', ...overrides });
const payment = (overrides: object = {}) => ({ id: 22, counterparty: 1, amount: '10.00', currency: 'UZS', payment_type: 'cash', is_correction: false, paid_at: '2026-10-28T10:00:00+05:00', branch_name: 'Main branch', recorded_by_name: 'Owner', note: 'Partial collection', exchange_rate: null, converted_amount_uzs: null, ...overrides });
const page = (rows: any[], more = false) => ({ results: rows, count: more ? 2 : rows.length, next: more ? 'https://evil.example/credential-theft' : null });
const renderList = () => render(<ThemeProvider><CustomersScreen /></ThemeProvider>);
const renderStatement = () => render(<ThemeProvider><CustomerStatementScreen /></ThemeProvider>);
beforeEach(() => {
  jest.clearAllMocks();
  mockTenant = { id: 1, name: 'Store', is_owner: true, permissions: [] };
  mockUser = { id: 7, role: 'owner', terms_accepted: true, tenants: [mockTenant, { ...mockTenant, id: 2 }] };
  mockParams = { id: '1' };
  jest.mocked(request).mockImplementation(async (path, options) => {
    if (path.includes('/payments/')) return page([payment()]);
    if (path.includes('/sales/?')) return { ...page([sale()]), summary: { total_sales_count: 3, debt_sales_count: 2, payments_count: 4, total_spent_uzs: '80.00', total_spent_usd: null } };
    if (options?.method === 'POST' || options?.method === 'PATCH') return customer(options.body);
    if (options?.method === 'DELETE') return { detail: 'Kontragent arxivlandi.' };
    if (path.includes('/counterparties/1/')) return customer();
    return page([customer()]);
  });
});
describe('Customer metadata and lifecycle', () => {
  test('create sends code/note/date; edit retains immutable phone and B2B link', () => {
    const draft = { ...customerDraft(), name: 'Ali', phone_number: '+998901234567', target_tenant_code: 'abc12345', debt_due_date: '2026-12-31', note: 'Regular' };
    expect(customerBody(draft, false)).toEqual({ name: 'Ali', phone_number: '+998901234567', target_tenant_code: 'ABC12345', debt_due_date: '2026-12-31', note: 'Regular' });
    expect(customerBody(draft, true)).toEqual({ name: 'Ali', debt_due_date: '2026-12-31', note: 'Regular' });
    expect(() => customerBody({ ...draft, debt_due_date: '2026-02-30' }, false)).toThrow();
    expect(() => customerBody({ ...draft, target_tenant_code: 'bad/code' }, false)).toThrow();
    expect(() => parseCustomer(customer({ debt_due_date: '2026-02-30' }))).toThrow();
  });
  test('date/code validation is inline and successful new customer uses the complete real API body', async () => {
    const screen = await renderList(); await screen.findByText('Ali');
    await fireEvent.press(screen.getByText('Yangi mijoz'));
    await fireEvent.changeText(screen.getByLabelText('Mijoz ismi'), 'New customer');
    await fireEvent.changeText(screen.getByLabelText('Telefon raqami'), '+998991234567');
    await fireEvent.changeText(screen.getByLabelText('B2B do‘kon kodi (ixtiyoriy)'), 'abc12345');
    await fireEvent.changeText(screen.getByLabelText('Standart qarz muddati (YYYY-MM-DD)'), '2026-02-30');
    await fireEvent.press(screen.getByText('Mijozni saqlash'));
    expect(screen.getByLabelText('Standart qarz muddati (YYYY-MM-DD)').props['aria-invalid']).toBe(true);
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Standart qarz muddati (YYYY-MM-DD)'), '2026-12-31');
    await fireEvent.press(screen.getByText('Mijozni saqlash'));
    expect(request).toHaveBeenCalledWith('/sales/counterparties/', { method: 'POST', body: { name: 'New customer', phone_number: '+998991234567', target_tenant_code: 'ABC12345', note: '', debt_due_date: '2026-12-31' } });
  });
  test('edit can remove the due date without rewriting phone/code or balances', async () => {
    const screen = await renderList(); await fireEvent.press(await screen.findByText('Ali: tahrirlash'));
    expect(screen.getByLabelText('Telefon raqami').props.editable).toBe(false);
    expect(screen.queryByLabelText('B2B do‘kon kodi (ixtiyoriy)')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Standart qarz muddati (YYYY-MM-DD)'), '');
    await fireEvent.press(screen.getByText('Mijozni saqlash'));
    expect(request).toHaveBeenCalledWith('/sales/counterparties/1/', { method: 'PATCH', body: { name: 'Ali', note: 'Regular', debt_due_date: null } });
  });
  test.each(['70.00', '-0.01'])('archive requires confirmation and rejects current debt/credit %s', async amount => {
    jest.mocked(request).mockImplementation(async path => path.includes('/counterparties/1/') ? customer({ debt_balance_uzs: amount, debt_balance_usd: '0.00' }) : page([customer({ debt_balance_uzs: '0.00', debt_balance_usd: '0.00' })]));
    const screen = await renderList(); await fireEvent.press(await screen.findByText('Ali: arxivlash'));
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
    await fireEvent.press(screen.getByText('Arxivlashni tasdiqlash'));
    expect(screen.getByText('Avval mijozning qarzi yoki ortiqcha to‘lovini yakunlang.')).toBeTruthy();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  });
  test('zero-balance archive verifies latest row before sending DELETE and preserves history messaging', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => options?.method === 'DELETE' ? { detail: 'Kontragent arxivlandi.' } : path.includes('/counterparties/1/') ? customer({ debt_balance_uzs: '0.00', debt_balance_usd: '0.00' }) : page([customer()]));
    const screen = await renderList(); await fireEvent.press(await screen.findByText('Ali: arxivlash'));
    await fireEvent.press(screen.getByText('Arxivlashni tasdiqlash'));
    expect(request).toHaveBeenCalledWith('/sales/counterparties/1/', { method: 'DELETE' });
    expect(await screen.findByText('Mijoz arxivlandi. Savdo va to‘lov tarixi saqlandi.')).toBeTruthy();
  });
  test('credit/settled/archive filters use server queries and the statement action opens selected customer', async () => {
    const screen = await renderList(); await screen.findByText('Ali');
    await fireEvent.press(screen.getByLabelText('Mijoz balansi: Mijoz haqqi'));
    await waitFor(() => expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('balance_status=credit'))).toBe(true));
    await fireEvent.press(screen.getByText('Arxivdagilarni ham ko‘rsatish'));
    await waitFor(() => expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('active=all'))).toBe(true));
    await fireEvent.press(screen.getByText('Ali: ko‘chirma'));
    expect(mockNavigate).toHaveBeenCalledWith('Customer', { id: '1' });
  });
  test('store changes discard an in-progress customer edit', async () => {
    const screen = await renderList(); await fireEvent.press(await screen.findByText('Ali: tahrirlash'));
    await fireEvent.changeText(screen.getByLabelText('Mijoz ismi'), 'Unsaved old tenant');
    mockTenant = { ...mockTenant, id: 2 };
    await screen.rerender(<ThemeProvider><CustomersScreen /></ThemeProvider>);
    expect(screen.queryByLabelText('Mijoz ismi')).toBeNull();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });
});
describe('Customer purchase and payment statements', () => {
  test('consumes actual customer/return/payment API responses and reconciles the saved70 balance exactly', () => {
    const cp = parseCustomer(contract.customer), saved = parseSavedSale(contract.sales.results[0]);
    const collection = parseCustomerPayment(contract.payments.results[0], cp.id);
    expect(parseMoneyMinor(saved.net_amount) - parseMoneyMinor(collection.amount)).toBe(parseMoneyMinor(cp.debt_balance_uzs));
    expect(cp.debt_balance_uzs).toBe('70.00');
    expect(saved.refunded_amount).toBe('20.00');
    expect(parseCustomer(contract.linked).target_tenant_name).toBeTruthy();
    expect(parseCustomer(contract.edited).debt_due_date).toBeNull();
  });
  test('uses server balances/aggregates, saved returns, payment channel/branch/actor/note and exact customer routes', async () => {
    const screen = await renderStatement(); await screen.findByText('#CUSTOMER-11 · 80 UZS');
    expect(screen.getByText('Qaytarilgan: 20 UZS')).toBeTruthy();
    expect(screen.getByText('Amaldagi balans: 70 UZS / -2,5 USD')).toBeTruthy();
    expect(screen.getByText(/Jami xaridlar: 3 · Nasiya: 2 · To‘lov yozuvlari: 4/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Ko‘chirma bo‘limi: Nasiya xaridlar'));
    await waitFor(() => expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('/counterparties/1/sales/?') && path.includes('payment_type=debt'))).toBe(true));
    await fireEvent.press(screen.getByLabelText('Ko‘chirma bo‘limi: To‘lovlar'));
    expect(await screen.findByText('Qabul qilingan to‘lov · 10 UZS')).toBeTruthy();
    expect(screen.getByText('Main branch · Owner')).toBeTruthy();
    expect(screen.getByText('Partial collection')).toBeTruthy();
  });
  test('shows signed correction and cross-currency conversion without treating them as ordinary cash collection', async () => {
    jest.mocked(request).mockImplementation(async path => path.includes('/payments/') ? page([payment({ amount: '-2.50', currency: 'USD', is_correction: true, payment_type: 'none', exchange_rate: '13000.000000', converted_amount_uzs: '-32500.00' })]) : path.includes('/sales/?') ? page([sale()]) : customer());
    const screen = await renderStatement(); await screen.findByText('Ali');
    await fireEvent.press(screen.getByLabelText('Ko‘chirma bo‘limi: To‘lovlar'));
    expect(await screen.findByText('Tuzatish / qaytarish · -2,5 USD')).toBeTruthy();
    expect(screen.getByText(/Kassaga ta’sirsiz tuzatish/)).toBeTruthy();
    expect(screen.getByText('Kurs: 13 000 UZS · Konvertatsiya: -32 500 UZS')).toBeTruthy();
  });
  test('debt-only recorder can inspect statements but not open unrestricted receipts/edit customers', async () => {
    mockTenant = { ...mockTenant, is_owner: false, permissions: ['sales.record_debt_payment'] };
    mockUser = { ...mockUser, role: 'staff', tenants: [mockTenant] };
    const screen = await renderStatement(); await screen.findByText('#CUSTOMER-11 · 80 UZS');
    expect(screen.queryByText('Chekni ochish: CUSTOMER-11')).toBeNull();
    expect(screen.queryByText('Qarz hisobini tuzatish')).toBeNull();
    expect(screen.queryByText('Mijoz haqqini qaytarish')).toBeNull();
    await screen.unmount();
    const list = await renderList(); await list.findByText('Ali');
    expect(list.queryByText('Ali: tahrirlash')).toBeNull();
    expect(list.getByText('Ali: ko‘chirma')).toBeTruthy();
  });
  test('returning to a cached statement reloads the actual server balance', async () => {
    const screen = await renderStatement(); await screen.findByText('Amaldagi balans: 70 UZS / -2,5 USD');
    jest.mocked(request).mockImplementation(async path => path.includes('/sales/?') ? page([sale()]) : customer({ debt_balance_usd: '-1.00' }));
    await act(async () => { mockRefocus(); });
    expect(await screen.findByText('Amaldagi balans: 70 UZS / -1 USD')).toBeTruthy();
  });
  test('untrusted next URL is never followed and a foreign-customer payment is rejected', async () => {
    jest.mocked(request).mockImplementation(async path => path.includes('/payments/') ? page([payment({ counterparty: 99 })]) : path.includes('page=2') ? page([sale({ id: 12, receipt_number: 'OLDER' })]) : path.includes('/sales/?') ? page([sale()], true) : customer());
    const screen = await renderStatement(); await fireEvent.press(await screen.findByText('Yana xaridlar'));
    expect(await screen.findByText('#OLDER · 80 UZS')).toBeTruthy();
    expect(jest.mocked(request).mock.calls.every(([path]) => !path.startsWith('http'))).toBe(true);
    await fireEvent.press(screen.getByLabelText('Ko‘chirma bo‘limi: To‘lovlar'));
    expect(await screen.findByText('Mijoz to‘lov yozuvi tasdiqlanmadi.')).toBeTruthy();
    expect(screen.queryByText('Partial collection')).toBeNull();
  });
  test('invalid route or permission does not fetch any customer history', async () => {
    mockParams = { id: '../2' };
    const screen = await renderStatement();
    expect(screen.getByText('Mijoz identifikatori yoki faol do‘kon vakolati tasdiqlanmadi.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  test('late profile from the previous account/store cannot populate the new statement', async () => {
    let finish!: (value: any) => void;
    jest.mocked(request).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const screen = await renderStatement(); await waitFor(() => expect(finish).toBeDefined());
    const oldFinish = finish;
    mockTenant = { ...mockTenant, id: 2 };
    jest.mocked(request).mockResolvedValue(customer({ name: 'Second store' }));
    await screen.rerender(<ThemeProvider><CustomerStatementScreen /></ThemeProvider>);
    await screen.findByText('Second store');
    await act(async () => oldFinish(customer({ name: 'Previous store' })));
    expect(screen.queryByText('Previous store')).toBeNull();
  });
});
describe('POS customer metadata and validation', () => {
  test('selection carries due date and B2B recipient, rejects invalid IDs/dates and strips opaque fields', () => {
    expect(customerSelection(customer())).toMatchObject({ id: 1, targetTenantId: 8, targetTenantName: 'B2B store', debtDueDate: '2026-12-31' });
    expect(customerSelection(customer({ password: 'opaque' }))).not.toHaveProperty('password');
    expect(() => customerSelection(customer({ id: 0 }))).toThrow();
    expect(() => parseCustomerPayment(payment({ currency: 'EUR' }), 1)).toThrow();
  });
  test('quick create marks invalid inputs instead of silently ignoring the button', async () => {
    const select = jest.fn();
    const screen = await render(<ThemeProvider><CustomerPickerSheet visible onClose={jest.fn()} onSelectCustomer={select} /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Yangi mijoz'));
    await fireEvent.press(screen.getByText('Saqlash'));
    expect(screen.getByLabelText('Mijoz ismi').props['aria-invalid']).toBe(true);
    expect(screen.getByLabelText('+998 90 123 45 67').props['aria-invalid']).toBe(true);
    expect(select).not.toHaveBeenCalled();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
});
