import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { EmployeesScreen } from '../src/features/employees/EmployeesScreen';
import { employeeAcknowledgement, employeeBody, employeeDraft, parseEmployee, parsePermissionChoices } from '../src/features/employees/model';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { assertAuthScope, request } from '../src/api/client';
import { ApiError } from '../src/api/errors';
import backendContract from './contracts/employees.json';

let mockTenant = { id: 1, name: 'Store', is_owner: true, permissions: [] as string[] };
let mockUser = { id: 7, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
let mockParams: Record<string, string> = {};
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
const choices = [
  { id: 43, category: 'sales', codename: 'add_sale', name: 'Savdo qilish' },
  { id: 87, category: 'catalog', codename: 'view_product', name: 'Tovarlarni ko‘rish' },
  { id: 100, category: 'employees', codename: 'hire_employee', name: 'Ega huquqi' },
];
const row = (overrides: object = {}) => ({
  id: 21, user: 55, tenant: 1, phone_number: '+998901234567', contact_phone: null,
  first_name: 'Dilshod', last_name: 'Aliyev', username: 'dilshod', email: 'staff@example.test', position: 'Kassir',
  is_active: true, is_owner: false, account_active: true, password_set: false,
  hired_at: '2026-10-28T09:00:00+05:00', fired_at: null, archived_at: null, permission_ids: [43],
  actions: { edit: true, block: true, invite: true, archive: true, restore: false }, ...overrides,
});
const page = (rows = [row()]) => ({ results: rows, count: rows.length, next: null });
const renderScreen = () => render(<ThemeProvider><EmployeesScreen /></ThemeProvider>);
function defaultApi(path: string, options?: any): Promise<any> {
  if (path.endsWith('/permissions/')) return Promise.resolve(choices);
  if (options?.method === 'POST' && path.endsWith('/hire/')) return Promise.resolve({ id: 22, user: 56, tenant: 1, is_active: true, onboarding_invitation: { sent: false, reason: 'email_send_failed' } });
  if (options?.method === 'PATCH') return Promise.resolve(row({ ...options.body }));
  if (options?.method === 'POST' && path.endsWith('/fire/')) return Promise.resolve({ id: 21, user: 55, tenant: 1, is_active: false });
  if (options?.method === 'DELETE') return Promise.resolve(row({ is_active: false, archived_at: '2026-10-28T09:00:00Z' }));
  if (path.includes('/resend-invite/')) return Promise.resolve({ sent: true, reason: 'sent' });
  if (path.includes('/account-status/')) return Promise.resolve(row({ account_active: !options.body.blocked }));
  if (path.includes('/restore/')) return Promise.resolve(row({ is_active: false }));
  return Promise.resolve(page());
}
beforeEach(() => {
  jest.clearAllMocks();
  mockTenant = { id: 1, name: 'Store', is_owner: true, permissions: [] };
  mockUser = { id: 7, role: 'owner', terms_accepted: true, tenants: [mockTenant, { ...mockTenant, id: 2 }] };
  mockParams = {};
  jest.mocked(assertAuthScope).mockImplementation(() => {});
  jest.mocked(request).mockImplementation(defaultApi);
});

describe('Employee directory contracts and authority', () => {
  test('consumes actual PostgreSQL API responses across the entire employment lifecycle', () => {
    const tenantId = backendContract.tenant_id;
    const permissions = parsePermissionChoices(backendContract.choices);
    expect(permissions.some(row => row.code === 'sales.add_sale')).toBe(true);
    const employee = parseEmployee(backendContract.directory.results[0], tenantId);
    expect(employee.actions.edit).toBe(true);
    expect(employeeAcknowledgement(backendContract.hired, tenantId).is_active).toBe(true);
    expect(parseEmployee(backendContract.edited, tenantId).contact_phone).toBe('+998991239999');
    expect(parseEmployee(backendContract.blocked, tenantId).account_active).toBe(false);
    expect(parseEmployee(backendContract.unblocked, tenantId).account_active).toBe(true);
    expect(employeeAcknowledgement(backendContract.fired, tenantId, employee).is_active).toBe(false);
    expect(parseEmployee(backendContract.archived, tenantId).archived_at).toBeTruthy();
    expect(parseEmployee(backendContract.restored, tenantId).is_active).toBe(false);
    expect(parseEmployee(backendContract.restored, tenantId).archived_at).toBeNull();
  });
  test('rejects another store row, malformed flags and strips credential fields', () => {
    expect(() => parseEmployee(row({ tenant: 2 }), 1)).toThrow();
    expect(() => parseEmployee(row({ account_active: 'true' }), 1)).toThrow();
    expect(parseEmployee(row({ actions: {}, password: 'hidden', token: 'hidden' }), 1)).not.toHaveProperty('password');
    expect(parseEmployee(row({ actions: {} }), 1).actions.edit).toBe(false);
  });
  test('filters owner-only grants, rejects duplicate choices and never hardcodes IDs', () => {
    expect(parsePermissionChoices(choices).map(item => item.id)).toEqual([43, 87]);
    expect(() => parsePermissionChoices([...choices, choices[0]])).toThrow();
    expect(() => parsePermissionChoices([{ ...choices[0], id: '43' }])).toThrow();
    expect(() => parsePermissionChoices([{ ...choices[0], category: undefined }])).toThrow();
  });
  test('profile-only edit preserves unknown legacy grants; changed permissions must be current assignable IDs', () => {
    const staff = parseEmployee(row({ permission_ids: [999] }), 1), draft = employeeDraft(staff);
    expect(employeeBody(draft, null, staff)).not.toHaveProperty('permission_ids');
    expect(() => employeeBody({ ...draft, permission_ids: [999, 43] }, parsePermissionChoices(choices), staff)).toThrow();
    expect(employeeBody({ ...draft, permission_ids: [87] }, parsePermissionChoices(choices), staff)).toMatchObject({ permission_ids: [87] });
    expect(employeeBody(draft, null, staff)).not.toHaveProperty('phone_number');
    expect(employeeBody(draft, null, staff)).not.toHaveProperty('role');
  });
  test('thin acknowledgements must match tenant and original account', () => {
    const staff = parseEmployee(row(), 1);
    expect(employeeAcknowledgement({ id: 21, user: 55, tenant: 1, is_active: false }, 1, staff).is_active).toBe(false);
    expect(() => employeeAcknowledgement({ id: 21, user: 99, tenant: 1, is_active: false }, 1, staff)).toThrow();
    expect(() => employeeAcknowledgement({ id: 21, user: 55, tenant: 2, is_active: false }, 1, staff)).toThrow();
  });
  test('owner role in another store and staff-forged employee grant do not query the directory', async () => {
    mockTenant = { ...mockTenant, is_owner: false, permissions: ['employees.hire_employee'] };
    mockUser.tenants[0] = mockTenant;
    const screen = await renderScreen();
    expect(screen.getByText(/Xodimlar boshqaruvi uchun/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
  test('admin requires explicit selected tenant; deep linked target uses isolated URLs', async () => {
    mockUser.role = 'platform_admin';
    const screen = await renderScreen();
    expect(screen.getByText('Xodimlarni ko‘rish uchun do‘konni tanlang.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    await screen.unmount();
    mockParams = { tenantId: '8' };
    jest.mocked(request).mockImplementation(async path => path.endsWith('/permissions/') ? choices : page([row({ tenant: 8 })]));
    const selected = await renderScreen();
    await selected.findByText('Dilshod Aliyev');
    expect(jest.mocked(request).mock.calls.every(([path]) => path.startsWith('/tenants/8/employees/'))).toBe(true);
  });
  test('owner route cannot be redirected into another tenant through params', async () => {
    mockParams = { tenantId: '99' };
    const screen = await renderScreen(); await screen.findByText('Dilshod Aliyev');
    expect(jest.mocked(request).mock.calls.every(([path]) => path.startsWith('/tenants/1/employees/'))).toBe(true);
  });
});

describe('Employee workflows through the real screen', () => {
  test('hire validates fields inline, resolves preset from server IDs and separates invitation failure from hiring', async () => {
    const screen = await renderScreen(); await screen.findByText('Dilshod Aliyev');
    await fireEvent.press(screen.getByText('Xodim yollash'));
    await fireEvent.press(screen.getByText('Yollashni tasdiqlash'));
    expect(screen.getByLabelText('Kirish telefoni').props['aria-invalid']).toBe(true);
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Kirish telefoni'), '+998991234567');
    await fireEvent.changeText(screen.getByLabelText('Ism'), 'New');
    await fireEvent.changeText(screen.getByLabelText('Xodim emaili'), 'new@example.test');
    await fireEvent.press(screen.getByText('Kassir', { exact: true }));
    expect(screen.queryByLabelText('Ega huquqi')).toBeNull();
    await fireEvent.press(screen.getByText('Yollashni tasdiqlash'));
    expect(request).toHaveBeenCalledWith('/tenants/1/employees/hire/', expect.objectContaining({ method: 'POST', body: { first_name: 'New', last_name: '', email: 'new@example.test', position: '', phone_number: '+998991234567', permission_ids: [43, 87] } }));
    expect(await screen.findByText(/Xodim yollandi, lekin taklif emaili yuborilmadi/)).toBeTruthy();
  });
  test('editing profile sends only writable directory fields and server validation highlights the field', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (options?.method === 'PATCH') throw new ApiError('Email band.', 400, { email: ['Bu email boshqa hisobga biriktirilgan.'] });
      return defaultApi(path, options);
    });
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByText('Tahrirlash: Dilshod Aliyev'));
    await fireEvent.changeText(screen.getByLabelText('Xodim emaili'), 'other@example.test');
    await fireEvent.press(screen.getByText('Xodimni saqlash'));
    expect(screen.getByLabelText('Xodim emaili').props['aria-invalid']).toBe(true);
    const body = jest.mocked(request).mock.calls.find(([, options]) => options?.method === 'PATCH')?.[1]?.body;
    expect(body).toEqual({ first_name: 'Dilshod', last_name: 'Aliyev', email: 'other@example.test', position: 'Kassir', contact_phone: '' });
  });
  test('fire uses account ID, waits for confirmation and accepts the thin response', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByLabelText('Ishdan bo‘shatish: Dilshod Aliyev'));
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    expect(request).toHaveBeenCalledWith('/tenants/1/employees/fire/', expect.objectContaining({ method: 'POST', body: { target_user_id: 55 } }));
    expect(await screen.findByText('Ishdan bo‘shatish serverda tasdiqlandi.')).toBeTruthy();
  });
  test.each([
    ['Hisobni bloklash', '/tenants/1/employees/21/account-status/', 'POST', { blocked: true, reason: 'Owner request' }],
    ['Arxivlash', '/tenants/1/employees/21/', 'DELETE', { reason: 'Owner request' }],
  ])('%s requires a nonempty reason and the selected membership ID', async (label, endpoint, method, body) => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByLabelText(label + ': Dilshod Aliyev'));
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    expect(screen.getByLabelText('Amal sababi').props['aria-invalid']).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Amal sababi'), 'Owner request');
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    expect(request).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method, body }));
  });
  test('restore explicitly keeps inactive employment and does not rehire', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => path.includes('archived=true') ? page([row({ is_active: false, archived_at: '2026-10-28T09:00:00Z', actions: { restore: true } })]) : defaultApi(path, options));
    const screen = await renderScreen(); await screen.findByText('Dilshod Aliyev');
    await fireEvent.press(screen.getByLabelText('Xodim holati: Arxiv'));
    await fireEvent.press(await screen.findByLabelText('Arxivdan chiqarish: Dilshod Aliyev'));
    expect(screen.getByText(/Faqat arxiv belgisi olib tashlanadi/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amal sababi'), 'Restoring history');
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    expect(request).toHaveBeenCalledWith('/tenants/1/employees/21/restore/', expect.objectContaining({ body: { reason: 'Restoring history' } }));
    expect(jest.mocked(request).mock.calls.some(([path]) => path.endsWith('/hire/'))).toBe(false);
  });
  test('invitation is not sent on opening and cooldown errors remain visible', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path.includes('resend-invite')) throw new ApiError('Kamida 60 soniya kuting.', 429);
      return defaultApi(path, options);
    });
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByLabelText('Taklif yuborish: Dilshod Aliyev'));
    expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('resend-invite'))).toBe(false);
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    expect(screen.getByText('Kamida 60 soniya kuting.')).toBeTruthy();
    expect(screen.queryByText(/Email yuborish serverda tasdiqlandi/)).toBeNull();
  });
  test('account/store switch discards open forms and late results', async () => {
    let finish!: (value: any) => void;
    jest.mocked(request).mockImplementation((path, options) => options?.method === 'PATCH' ? new Promise(resolve => { finish = resolve; }) : defaultApi(path, options));
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByText('Tahrirlash: Dilshod Aliyev'));
    const pendingSave = fireEvent.press(screen.getByText('Xodimni saqlash'));
    await waitFor(() => expect(finish).toBeDefined());
    mockTenant = { ...mockTenant, id: 2 };
    jest.mocked(request).mockImplementation(async path => path.endsWith('/permissions/') ? choices : page([row({ tenant: 2, first_name: 'Second store' })]));
    await screen.rerender(<ThemeProvider><EmployeesScreen /></ThemeProvider>);
    await screen.findByText('Second store Aliyev');
    await act(async () => { finish(row()); await pendingSave; });
    expect(screen.queryByLabelText('Ism')).toBeNull();
    expect(screen.queryByText('Xodim ma’lumotlari saqlandi.')).toBeNull();
  });
  test('stale authentication is checked before writing', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByText('Tahrirlash: Dilshod Aliyev'));
    jest.mocked(assertAuthScope).mockImplementation(() => { throw Error('Sessiya o‘zgardi.'); });
    await fireEvent.press(screen.getByText('Xodimni saqlash'));
    expect(screen.getByText('Sessiya o‘zgardi.')).toBeTruthy();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });
  test('uncertain writes cannot be repeated until an explicit successful directory review', async () => {
    let failReview = true;
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (options?.method === 'PATCH') throw new ApiError('Javob olinmadi.', 0, null, 0, 'TIMEOUT');
      if (path.includes('page=1') && failReview && jest.mocked(request).mock.calls.some(([, previous]) => previous?.method === 'PATCH')) throw new ApiError('Internet yo‘q.', 0);
      return defaultApi(path, options);
    });
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByText('Tahrirlash: Dilshod Aliyev'));
    await fireEvent.press(screen.getByText('Xodimni saqlash'));
    expect(screen.getByText('Xodimni saqlash').parent?.props.accessibilityState?.disabled).not.toBe(false);
    await fireEvent.press(screen.getByText('Natijani tekshirish uchun yangilash'));
    expect(screen.getByText('Oldingi amal natijasi noma’lum. Yangi amal oldidan ro‘yxatni yangilab tekshiring.')).toBeTruthy();
    failReview = false;
    await fireEvent.press(screen.getByText('Natijani tekshirish uchun yangilash'));
    await waitFor(() => expect(screen.queryByText('Oldingi amal natijasi noma’lum. Yangi amal oldidan ro‘yxatni yangilab tekshiring.')).toBeNull());
  });
  test('search/filter/pagination use controlled local URLs and reject rows from another tenant', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path.includes('page=2')) return page([row({ id: 22, first_name: 'Page two' })]);
      if (path.includes('active=false')) return page([row({ tenant: 99 })]);
      if (path.includes('/employees/?')) return { ...page(), next: 'https://evil.example/steal-session', count: 2 };
      return defaultApi(path, options);
    });
    const screen = await renderScreen(); await screen.findByText('Dilshod Aliyev');
    await fireEvent.press(screen.getByText('Yana xodimlar'));
    await screen.findByText('Page two Aliyev');
    expect(jest.mocked(request).mock.calls.every(([path]) => !path.startsWith('http'))).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Xodim qidirish'), 'Dilshod & test');
    await waitFor(() => expect(jest.mocked(request).mock.calls.some(([path]) => path.includes('search=Dilshod+%26+test'))).toBe(true));
    await fireEvent.press(screen.getByLabelText('Xodim holati: Nofaol'));
    expect(await screen.findByText('Xodim yoki do‘kon ma’lumotlari tasdiqlanmadi.')).toBeTruthy();
    expect(screen.queryByText('Dilshod Aliyev')).toBeNull();
  });
});
