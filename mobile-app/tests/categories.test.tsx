import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CategoriesScreen } from '../src/features/catalog/CategoriesScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request } from '../src/api/client';
let mockAllow = true;
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: () => ({}), assertAuthScope: jest.fn() }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, activeTenant: { id: 2 } }) }));
jest.mock('../src/features/auth/usePermissions', () => ({ usePermissions: () => ({ can: () => mockAllow, requirePermission: () => { if (!mockAllow) throw Error('Denied'); } }) }));
const parent = { id: 1, name: 'Imported', kod: '01', parent: null, currency: 'USD', is_active: true };
const child = { ...parent, id: 2, name: 'Child', kod: '02', parent: 1 };
const show = () => render(<ThemeProvider><CategoriesScreen /></ThemeProvider>);
describe('Category administration integration', () => {
  beforeEach(() => { jest.clearAllMocks(); mockAllow = true; });
  test('drilling into a parent creates a child with its currency and complete parent ID', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => options?.method === 'POST' ? { ...child } : { results: path.includes('parent=1') ? [] : [parent] });
    const screen = await show();
    await fireEvent.press(await screen.findByText('Imported: ichki kategoriyalar'));
    await fireEvent.press(screen.getByText('Yangi kategoriya'));
    await fireEvent.changeText(screen.getByLabelText('Kategoriya nomi'), 'Child');
    await fireEvent.press(screen.getByText('Kategoriyani saqlash'));
    const call = jest.mocked(request).mock.calls.find(([, options]) => options?.method === 'POST');
    expect(call?.[0]).toBe('/catalog/categories/');
    expect(JSON.parse(call![1]!.body as string)).toEqual({ name: 'Child', parent_id: 1, currency: 'USD' });
    expect(screen.queryByLabelText('Kategoriya nomi')).toBeNull();
  });
  test('read-only staff can browse but has no create or edit controls', async () => {
    mockAllow = false; jest.mocked(request).mockResolvedValue({ results: [parent] });
    const screen = await show(); await screen.findByText('Imported');
    expect(screen.queryByText('Yangi kategoriya')).toBeNull();
    expect(screen.queryByText('Imported: tahrirlash')).toBeNull();
  });
  test('category action menu opens the selected category editor', async () => {
    jest.mocked(request).mockResolvedValue({ results: [parent] });
    const screen = await show();
    await fireEvent.press(await screen.findByLabelText('Kategoriya amallari'));
    await fireEvent.press(screen.getByText('Kategoriyani tahrirlash'));
    expect(screen.getByLabelText('Kategoriya nomi').props.value).toBe('Imported');
    expect(screen.queryByText('Ichki kategoriyalarni ko‘rish')).toBeNull();
  });
  test('a dependent category deletion keeps the form and shows the real rejection', async () => {
    jest.mocked(request).mockImplementation(async (_path, options) => { if (options?.method === 'DELETE') throw Error('Faol mahsulot mavjud.'); return { results: [parent] }; });
    const screen = await show();
    await fireEvent.press(await screen.findByText('Imported: tahrirlash'));
    await fireEvent.press(screen.getByText('Kategoriyani o‘chirish'));
    await fireEvent.press(screen.getByText('O‘chirishni tasdiqlash'));
    expect(await screen.findByText('Faol mahsulot mavjud.')).toBeTruthy();
    expect(screen.getByLabelText('Kategoriya nomi').props.value).toBe('Imported');
  });
  test('editing a child cannot silently erase its parent when parent lookup fails', async () => {
    jest.mocked(request).mockImplementation(async path => { if (path === '/catalog/categories/1/') throw Error('Connection lost'); return { results: [child] }; });
    const screen = await show();
    await fireEvent.press(await screen.findByText('Child: tahrirlash'));
    expect(await screen.findByText('Connection lost')).toBeTruthy();
    expect(screen.queryByText('Kategoriyani saqlash')).toBeNull();
  });
});
