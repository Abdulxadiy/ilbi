import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { request } from '../src/api/client';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { StoreSettingsScreen } from '../src/features/settings/StoreSettingsScreen';
import { storeSettingsFixture } from './fixtures/storeSettings';
const mockTenant = { id: 1, name: 'A', is_owner: true, permissions: [] };
const mockUser = { id: 1, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
describe('Actual loaded store-settings forms', () => {
  let current: typeof storeSettingsFixture;
  beforeEach(() => {
    jest.clearAllMocks(); current = { ...storeSettingsFixture };
    jest.mocked(request).mockImplementation(async (_path, options) => {
      if (options?.method === 'PATCH') current = { ...current, ...options.body, settings_revision: 'b'.repeat(64) };
      return current;
    });
  });
  test('load is read-only; changing one section preserves unsaved drafts in another section', async () => {
    const screen = await render(<ThemeProvider><StoreSettingsScreen /></ThemeProvider>);
    expect((await screen.findByLabelText('Chek pastidagi matn')).props.value).toBe('Original footer');
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Chek pastidagi matn'), 'Unsaved footer');
    await fireEvent.press(screen.getByLabelText('Sozlama bo‘limi: Hisobot jadvali'));
    await fireEvent.changeText(screen.getByLabelText('Kunlik hisobot vaqti'), '22:10');
    await fireEvent.press(screen.getByText('Bo‘limni saqlash'));
    await screen.findByText('Ushbu bo‘lim sozlamalari serverda tasdiqlandi.');
    expect(request).toHaveBeenLastCalledWith('/tenants/current/', { method: 'PATCH', headers: { 'If-Match': '"' + 'a'.repeat(64) + '"' }, body: { daily_report_time: '22:10:00' } });
    await fireEvent.press(screen.getByLabelText('Sozlama bo‘limi: Do‘kon va chek matni'));
    expect(screen.getByLabelText('Chek pastidagi matn').props.value).toBe('Unsaved footer');
    expect(current.receipt_footer).toBe('Original footer');
  });
  test('invalid schedules highlight the exact input and send no PATCH', async () => {
    const screen = await render(<ThemeProvider><StoreSettingsScreen /></ThemeProvider>);
    await screen.findByLabelText('Chek pastidagi matn');
    await fireEvent.press(screen.getByLabelText('Sozlama bo‘limi: Hisobot jadvali'));
    await fireEvent.changeText(screen.getByLabelText('Hafta kuni (1–7)'), '8');
    await fireEvent.press(screen.getByText('Bo‘limni saqlash'));
    expect(await screen.findByText('1 dan 7 gacha butun son kiriting.')).toBeTruthy();
    expect(screen.getByLabelText('Hafta kuni (1–7)').props['aria-invalid']).toBe(true);
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
    await fireEvent.changeText(screen.getByLabelText('Hafta kuni (1–7)'), '7');
    expect(screen.queryByText('1 dan 7 gacha butun son kiriting.')).toBeNull();
  });
  test('a field-specific backend rejection is red while the typed footer is retained', async () => {
    const handler = jest.mocked(request).getMockImplementation()!;
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (options?.method === 'PATCH') throw Object.assign(Error('Invalid footer'), { status: 400, data: { error: { code: 'validation_error', message: 'Invalid footer', details: { receipt_footer: ['Footer rejected'] } } } });
      return handler(path, options);
    });
    const screen = await render(<ThemeProvider><StoreSettingsScreen /></ThemeProvider>);
    await fireEvent.changeText(await screen.findByLabelText('Chek pastidagi matn'), 'My new footer');
    await fireEvent.press(screen.getByText('Bo‘limni saqlash'));
    expect(await screen.findByText('Footer rejected')).toBeTruthy();
    expect(screen.getByLabelText('Chek pastidagi matn').props.value).toBe('My new footer');
    expect(screen.getByLabelText('Chek pastidagi matn').props['aria-invalid']).toBe(true);
  });
  test('report sends require confirmation and unknown results stay blocked until explicitly reviewed', async () => {
    jest.mocked(request).mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') throw Error('Connection lost');
      return current;
    });
    const screen = await render(<ThemeProvider><StoreSettingsScreen /></ThemeProvider>);
    await screen.findByLabelText('Chek pastidagi matn');
    await fireEvent.press(screen.getByLabelText('Sozlama bo‘limi: Hisobot jadvali'));
    await fireEvent.press(screen.getByText('Kunlik hisobotni hozir yuborish'));
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await fireEvent.press(screen.getByText('Xabar yuborishni tasdiqlash'));
    expect(await screen.findByText('Yuborish natijasi noma’lum. Avval Telegramni tekshiring; avtomatik qayta yuborilmadi.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Kunlik hisobotni hozir yuborish'));
    await waitFor(() => expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1));
  });
  test('failed explicit reload preserves typed edits instead of replacing them with old defaults', async () => {
    const screen = await render(<ThemeProvider><StoreSettingsScreen /></ThemeProvider>);
    await fireEvent.changeText(await screen.findByLabelText('Chek pastidagi matn'), 'Keep my draft');
    jest.mocked(request).mockRejectedValueOnce(Error('Offline'));
    await fireEvent.press(screen.getByText('Serverdan qayta yuklash'));
    await fireEvent.press(screen.getByText('Qayta yuklashni tasdiqlash'));
    expect(await screen.findByText('Yangi qiymatlar olinmadi. Tahrirlaringiz saqlandi.')).toBeTruthy();
    expect(screen.getByLabelText('Chek pastidagi matn').props.value).toBe('Keep my draft');
  });
});
