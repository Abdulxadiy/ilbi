import React from 'react';
import { act, fireEvent, render, userEvent, waitFor } from '@testing-library/react-native';
import { LoginScreen } from '../src/features/auth/LoginScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import * as Linking from 'expo-linking';
const mockCheck = jest.fn(async () => {}), mockSend = jest.fn(async () => {}), mockVerify = jest.fn(async () => {}), mockReset = jest.fn();
let mockStep = 'telegram', mockDeadline = 0;
const mockRequest = jest.fn();
jest.mock('../src/api/client', () => ({ ...jest.requireActual('../src/api/client'), request: (...args: unknown[]) => mockRequest(...args) }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ login: jest.fn(), sendOtp: mockSend, verifyOtp: mockVerify, loginStep: mockStep, loginTicket: 'ticket', phoneHint: '+99890***1234', checkTelegram: mockCheck, resetLogin: mockReset, otpResendAt: mockDeadline }) }));
jest.mock('expo-linking', () => ({ openURL: jest.fn(async () => {}) }));
describe('Telegram login interface', () => {
  beforeEach(() => { jest.clearAllMocks(); mockRequest.mockReset(); mockStep = 'telegram'; mockDeadline = 0; });
  test('bot onboarding offers the actual bot link and a connection check', async () => {
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Telegram botni ochish'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://t.me/ilbi_bot');
    await fireEvent.press(screen.getByText('Ulanishni tekshirish'));
    expect(mockCheck).toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('123456')).toBeNull();
  });
  test('cooldown disables resend and offers return to credentials', async () => {
    mockStep = 'otp'; mockDeadline = Date.now() + 179000;
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText(/Qayta yuborish:/));
    expect(mockSend).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Login va parolga qaytish'));
    expect(mockReset).toHaveBeenCalledTimes(1);
  });
  test('incomplete code is not submitted', async () => {
    mockStep = 'otp';
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    await fireEvent.changeText(screen.getByPlaceholderText('123456'), '1234');
    await fireEvent.press(screen.getByText('Tasdiqlash'));
    expect(mockVerify).not.toHaveBeenCalled();
    expect(screen.getByText('Tasdiqlash kodini to‘liq kiriting')).toBeTruthy();
  });
  test('credentials screen renders clean full layout without registration and opens password reset', async () => {
    mockStep = 'credentials';
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    expect(screen.queryByText(/Hisob yaratish/i)).toBeNull();
    expect(screen.getByText('Parolni unutdingizmi?')).toBeTruthy();
    expect(screen.getByText('Qo‘llab-quvvatlash')).toBeTruthy();
    // Open password reset sheet
    await fireEvent.press(screen.getByText('Parolni unutdingizmi?'));
    expect(screen.getByText('Parolni tiklash')).toBeTruthy();
    expect(screen.getByText('Havola so‘rash')).toBeTruthy();
    expect(screen.getByText('Kodni kiritish')).toBeTruthy();
    expect(screen.getByText('Eski parol')).toBeTruthy();
  });

  test('recovery sends the backend login field and surfaces email delivery errors', async () => {
    mockStep = 'credentials';
    mockRequest.mockRejectedValueOnce(new Error('Yangi havola so‘rashdan oldin 60 soniya kuting.'));
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Parolni unutdingizmi?'));
    await fireEvent.changeText(screen.getByLabelText('Login, telefon yoki email'), ' seller@example.com ');
    await fireEvent.press(screen.getByText('Tiklash havolasini yuborish'));
    expect(mockRequest).toHaveBeenCalledWith('/auth/password-reset/request/', { method: 'POST', body: { login: 'seller@example.com' } });
    await waitFor(() => expect(screen.getByText('Yangi havola so‘rashdan oldin 60 soniya kuting.')).toBeTruthy());
  });

  test('account without email moves to old-password recovery with its identifier', async () => {
    mockStep = 'credentials';
    mockRequest.mockResolvedValueOnce({ has_email: false, detail: 'Hisobga email biriktirilmagan.' });
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Parolni unutdingizmi?'));
    await fireEvent.changeText(screen.getByLabelText('Login, telefon yoki email'), 'seller');
    await fireEvent.press(screen.getByText('Tiklash havolasini yuborish'));
    await waitFor(() => expect(screen.getByLabelText('Eski parol')).toBeTruthy());
    expect(screen.getByLabelText('Login yoki telefon').props.value).toBe('seller');
    expect(screen.getByText('Hisobga email biriktirilmagan.')).toBeTruthy();
  });

  test('token recovery rejects short passwords and submits the full valid payload', async () => {
    mockStep = 'credentials';
    mockRequest.mockResolvedValueOnce({ detail: 'Parol saqlandi.', username: 'seller' });
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Parolni unutdingizmi?'));
    await fireEvent.press(screen.getByText('Kodni kiritish'));
    await fireEvent.changeText(screen.getByLabelText('Tiklash kodi / token'), ' test-token ');
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'short');
    await fireEvent.press(screen.getByText('Yangi parolni saqlash'));
    expect(mockRequest).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'new-password');
    await fireEvent.press(screen.getByText('Yangi parolni saqlash'));
    expect(mockRequest).toHaveBeenCalledWith('/auth/password-reset/confirm/', { method: 'POST', body: { token: 'test-token', new_password: 'new-password' } });
    await waitFor(() => expect(screen.getByText('Parol saqlandi.')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Parolni tiklashni yopish'));
    expect(screen.getByLabelText('Foydalanuvchi nomi yoki telefon').props.value).toBe('seller');
  });

  test('old-password recovery submits all fields and does not show success on rejection', async () => {
    mockStep = 'credentials';
    mockRequest.mockRejectedValueOnce(new Error('Eski parol noto‘g‘ri.'));
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Parolni unutdingizmi?'));
    await fireEvent.press(screen.getByText('Eski parol'));
    await fireEvent.changeText(screen.getByLabelText('Login yoki telefon'), ' seller ');
    await fireEvent.changeText(screen.getByLabelText('Eski parol'), 'old-password');
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'new-password');
    await fireEvent.press(screen.getByText('Parolni almashtirish'));
    expect(mockRequest).toHaveBeenCalledWith('/auth/password-reset/change-with-old/', { method: 'POST', body: { login: 'seller', old_password: 'old-password', new_password: 'new-password' } });
    await waitFor(() => expect(screen.getByText('Eski parol noto‘g‘ri.')).toBeTruthy());
    expect(screen.queryByText('Parol muvaffaqiyatli almashtirildi!')).toBeNull();
  });

  test('closing recovery discards secrets and ignores a late response after reopening', async () => {
    mockStep = 'credentials';
    let resolveRequest!: (value: unknown) => void;
    mockRequest.mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve; }));
    const screen = await render(<ThemeProvider><LoginScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByText('Parolni unutdingizmi?'));
    await fireEvent.press(screen.getByText('Kodni kiritish'));
    await fireEvent.changeText(screen.getByLabelText('Tiklash kodi / token'), 'test-token');
    await fireEvent.changeText(screen.getByLabelText('Yangi parol'), 'new-password');
    // A native press returns while its network request remains in flight.
    await userEvent.press(screen.getByRole('button', { name: 'Yangi parolni saqlash' }));
    await fireEvent.press(screen.getByLabelText('Parolni tiklashni yopish'));
    await fireEvent.press(screen.getByText('Parolni unutdingizmi?'));
    await act(async () => { resolveRequest({ detail: 'Late success', username: 'stale-user' }); });
    expect(screen.queryByText('Late success')).toBeNull();
    await fireEvent.press(screen.getByText('Kodni kiritish'));
    expect(screen.getByLabelText('Tiklash kodi / token').props.value).toBe('');
    expect(screen.getByLabelText('Yangi parol').props.value).toBe('');
  });
});
