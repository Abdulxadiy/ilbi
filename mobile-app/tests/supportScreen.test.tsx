import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SupportScreen } from '../src/features/support/SupportScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request } from '../src/api/client';
import wire from './contracts/support.json';
let mockUser: any = { id: 1, username: 'mobile-test', first_name: 'Test', last_name: 'User', role: 'owner' };
let mockTenant: any = { id: 2 };
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: () => ({}), assertAuthScope: jest.fn() }));
jest.mock('../src/api/storage', () => ({ secureStorage: { getItem: async () => null, setItem: async () => {} } }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant, isLoading: false }) }));
jest.mock('../src/features/support/useSupport', () => ({ ...jest.requireActual('../src/features/support/useSupport'), useSupportActivity: () => true }));
const conversation = wire.conversation;
let current = { ...conversation };
function api(path: string, options: any = {}) {
  const body = options.body || {};
  if (path === '/support/metadata/') return Promise.resolve(wire.metadata);
  if (options.method === 'POST' && path.endsWith('/messages/')) return Promise.resolve({ ...wire.messages.results[0], id: 9001, text: body.text, client_id: body.client_id });
  if (options.method === 'POST' && body.action) {
    if (body.action === 'read') return Promise.resolve({ ok: true });
    current = { ...current, status: body.action === 'close' ? 'closed' : body.action === 'claim' ? 'active' : 'waiting', ...(body.action === 'reopen' ? { operator_id: null as any, operator_name: '' } : body.action === 'claim' ? { operator_id: mockUser.id } : {}) };
    return Promise.resolve(current);
  }
  if (options.method === 'POST') return Promise.resolve(wire.created);
  if (path.includes('/messages/')) return Promise.resolve(wire.messages);
  if (path.includes(conversation.id)) return Promise.resolve(current);
  return Promise.resolve({ results: [current], count: 1, next: null });
}
const show = () => render(<ThemeProvider><SupportScreen tabbed /></ThemeProvider>);
describe('Dedicated support page', () => {
  beforeEach(() => { jest.clearAllMocks(); current = { ...conversation }; mockUser = { id: 1, username: 'mobile-test', first_name: 'Test', last_name: 'User', role: 'owner' }; mockTenant = { id: 2 }; jest.mocked(request).mockImplementation(api); });
  test('opens an owned real-DTO conversation and sends one identified text message', async () => {
    const screen = await show();
    await fireEvent.press(await screen.findByLabelText(conversation.subject + ': yozishmalarni ochish'));
    expect(await screen.findByText('Synthetic operator answer')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Yordamga xabar'), 'Mobile reply');
    await fireEvent.press(screen.getByLabelText('Xabar yuborish'));
    expect(await screen.findByText('Mobile reply')).toBeTruthy();
    const sent = jest.mocked(request).mock.calls.find(([path, o]) => path.endsWith('/messages/') && o?.method === 'POST');
    expect(sent?.[0]).toBe(`/support/conversations/${conversation.id}/messages/`);
    expect(sent?.[1]?.body).toMatchObject({ text: 'Mobile reply', client_id: expect.stringMatching(/^[a-f\d-]{36}$/) });
  });
  test('requires explicit consent before starting a new conversation', async () => {
    const screen = await show();
    await fireEvent.press(screen.getByText('Yangi murojaat'));
    await fireEvent.changeText(screen.getByLabelText('Murojaat mavzusi'), 'Help with stock');
    await fireEvent.changeText(screen.getByLabelText('Birinchi xabar'), 'Please explain');
    await fireEvent.press(screen.getByText('Murojaat yuborish'));
    expect(screen.getByText('Yordam uchun ma’lumotlarni yuborishga rozilik kerak.')).toBeTruthy();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    await fireEvent.press(screen.getByLabelText('Yordam uchun ma’lumotlarni yuborishga roziman'));
    await fireEvent.press(screen.getByText('Murojaat yuborish'));
    const created = jest.mocked(request).mock.calls.find(([, options]) => options?.method === 'POST' && !options.body?.action);
    expect(created?.[1]?.body).toMatchObject({ subject: 'Help with stock', text: 'Please explain', consent: true });
    expect(new Headers(created?.[1]?.headers).get('X-Tenant-ID')).toBe('2');
  });
  test('uncertain send retries the same client ID and original payload', async () => {
    let failed = false;
    jest.mocked(request).mockImplementation((path, options: any) => { if (path.endsWith('/messages/') && options?.method === 'POST' && !failed) { failed = true; return Promise.reject(Object.assign(Error('Connection lost'), { status: 0, code: 'NETWORK' })); } return api(path, options); });
    const screen = await show();
    await fireEvent.press(await screen.findByLabelText(conversation.subject + ': yozishmalarni ochish'));
    await screen.findByLabelText('Yordamga xabar');
    await fireEvent.changeText(screen.getByLabelText('Yordamga xabar'), 'Keep this message');
    await fireEvent.press(screen.getByLabelText('Xabar yuborish'));
    await fireEvent.press(await screen.findByLabelText('Xabarni qayta yuborish'));
    const attempts = jest.mocked(request).mock.calls.filter(([path, options]) => path.endsWith('/messages/') && options?.method === 'POST');
    expect(attempts).toHaveLength(2); expect(attempts[0][1]?.body).toEqual(attempts[1][1]?.body);
    expect(await screen.findByText('Keep this message')).toBeTruthy();
  });
  test('close and reopen require confirmation and show authoritative status', async () => {
    const screen = await show();
    await fireEvent.press(await screen.findByLabelText(conversation.subject + ': yozishmalarni ochish'));
    await fireEvent.press(await screen.findByLabelText('Suhbatni yopish'));
    expect(jest.mocked(request).mock.calls.some(([, o]) => o?.body?.action === 'close')).toBe(false);
    await fireEvent.press(screen.getByText('Tasdiqlash'));
    expect(await screen.findByText(/^Yopilgan/)).toBeTruthy();
    expect(screen.queryByLabelText('Yordamga xabar')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Suhbatni qayta ochish'));
    await fireEvent.press(screen.getByText('Tasdiqlash'));
    expect(await screen.findByText('Javob kutilmoqda')).toBeTruthy();
  });
  test('switching account drops the previous conversation and composer contents', async () => {
    const screen = await show();
    await fireEvent.press(await screen.findByLabelText(conversation.subject + ': yozishmalarni ochish'));
    await screen.findByLabelText('Yordamga xabar');
    await fireEvent.changeText(screen.getByLabelText('Yordamga xabar'), 'Account A private draft');
    mockUser = { ...mockUser, id: 2 }; jest.mocked(request).mockImplementation(async () => ({ results: [], next: null }));
    await screen.rerender(<ThemeProvider><SupportScreen tabbed /></ThemeProvider>);
    expect(screen.queryByLabelText('Yordamga xabar')).toBeNull(); expect(screen.queryByText('Synthetic operator answer')).toBeNull();
    expect(await screen.findByText('Hozircha murojaat yo‘q')).toBeTruthy();
  });
  test('an operator cannot reply to another operator’s conversation', async () => {
    mockUser = { ...mockUser, id: conversation.operator_id + 1, role: 'platform_admin' }; mockTenant = null;
    const screen = await show();
    await fireEvent.press(await screen.findByLabelText(conversation.subject + ': yozishmalarni ochish'));
    expect(await screen.findByText('Bu murojaat boshqa operatorga biriktirilgan.')).toBeTruthy();
    expect(screen.queryByLabelText('Yordamga xabar')).toBeNull();
    expect(jest.mocked(request).mock.calls.some(([path]) => path.startsWith('/support/inbox/'))).toBe(true);
  });
  test('logged-out help uses a protected guest key without a store context', async () => {
    mockUser = null; mockTenant = null;
    const screen = await show(); await screen.findByText(conversation.subject);
    const guestCall = jest.mocked(request).mock.calls.find(([path]) => path.startsWith('/support/guest/'));
    expect(guestCall?.[1]?.skipTenant).toBe(true);
    expect(new Headers(guestCall?.[1]?.headers).get('X-Support-Token')).toMatch(/^[a-f\d]{64}$/);
    expect(new Headers(guestCall?.[1]?.headers).get('X-Tenant-ID')).toBeNull();
  });
});
