import React from 'react';
import { Platform } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { PushProvider, usePush } from '../src/features/notifications/PushProvider';
import { pushInstallationState, registerPushToken, revokePushInstallation } from '../src/features/notifications/pushRegistration';
let mockUser: any = { id: 7, terms_accepted: true, role: 'owner' }, mockTenant = { id: 1 };
let mockRotation: (token: any) => void = () => {};
const mockFetchOne = jest.fn(async (id: number) => ({ id }));
const mockRefresh = jest.fn(async () => {});
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant, isLoading: false }) }));
jest.mock('../src/features/notifications/NotificationsContext', () => ({ useNotifications: () => ({ fetchOne: mockFetchOne, refresh: mockRefresh }) }));
jest.mock('../src/api/client', () => ({ captureAuthScope: () => ({}), assertAuthScope: jest.fn() }));
jest.mock('expo-application', () => ({ applicationId: 'uz.ilbi.mobile' }));
jest.mock('../src/features/notifications/pushRegistration', () => ({ defaultPushCategories: { b2b: true, debts: true, stock: true, reports: true, system: true }, pushInstallationState: jest.fn(), registerPushToken: jest.fn(async () => {}), revokePushInstallation: jest.fn(async () => {}), retryPushRevocations: jest.fn(async () => {}) }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 }, AndroidNotificationVisibility: { PRIVATE: 0 }, setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}), getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), getDevicePushTokenAsync: jest.fn(async () => ({ data: 'synthetic-fcm-token' })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })), addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn((callback: any) => { mockRotation = callback; return { remove: jest.fn() }; }),
  getLastNotificationResponseAsync: jest.fn(async () => null), clearLastNotificationResponseAsync: jest.fn(async () => {}),
}));
const wrapper = ({ children }: { children: React.ReactNode }) => <PushProvider>{children}</PushProvider>;
const response = (recipient = '7', tenant = '1') => ({ notification: { request: { content: { data: { kind: 'ilbi_inbox', notification_id: '3', recipient_id: recipient, tenant_id: tenant } } } } }) as any;
const saved = { enabledForUser: 7, categories: { b2b: true, debts: true, stock: true, reports: true, system: true } } as any;
describe('Android push consent, rotation and protected taps', () => {
  const original = Platform.OS;
  beforeAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' }));
  afterAll(() => Object.defineProperty(Platform, 'OS', { configurable: true, value: original }));
  beforeEach(() => {
    jest.clearAllMocks(); mockUser = { id: 7, terms_accepted: true, role: 'owner' }; mockTenant = { id: 1 };
    jest.mocked(pushInstallationState).mockResolvedValue(null);
    jest.mocked(registerPushToken).mockResolvedValue(false);
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true, canAskAgain: true } as any);
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValue({ granted: true, canAskAgain: true } as any);
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(null);
  });
  test('does not prompt for OS permission merely because the account logged in', async () => {
    const hook = await renderHook(usePush, { wrapper });
    expect(hook.result.current.supported).toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled(); expect(registerPushToken).not.toHaveBeenCalled();
  });
  test('explicit enable requests permission and registers the native FCM token', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: true } as any);
    const hook = await renderHook(usePush, { wrapper });
    await act(async () => { await hook.result.current.enable(); });
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(registerPushToken).toHaveBeenCalledWith(7, 'synthetic-fcm-token', expect.any(Object), expect.any(Object), 'https://ilbi.uz/api/v1');
    expect(hook.result.current.enabled).toBe(true);
  });
  test('permission denial deactivates the binding without repeated prompts', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: false, canAskAgain: false } as any);
    const hook = await renderHook(usePush, { wrapper });
    await act(async () => { await hook.result.current.enable(); });
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled(); expect(registerPushToken).not.toHaveBeenCalled();
    expect(revokePushInstallation).toHaveBeenCalled(); expect(hook.result.current.denied).toBe(true); expect(hook.result.current.enabled).toBe(false);
  });
  test('disabled server delivery is explicit and a failed category update keeps the acknowledged state', async () => {
    const hook = await renderHook(usePush, { wrapper });
    await act(async () => { await hook.result.current.enable(); });
    expect(hook.result.current.message).toContain('Serverda bildirishnoma jo‘natilishi hali faollashtirilmagan');
    jest.mocked(registerPushToken).mockRejectedValueOnce(Error('Offline'));
    await act(async () => { await hook.result.current.changeCategory('reports', false); });
    expect(hook.result.current.enabled).toBe(true); expect(hook.result.current.categories.reports).toBe(true);
    expect(hook.result.current.error).toBe(true); expect(hook.result.current.message).toBe('Offline');
  });
  test('an offline disable is shown as pending instead of claiming a completed server revocation', async () => {
    const hook = await renderHook(usePush, { wrapper });
    await act(async () => { await hook.result.current.enable(); });
    jest.mocked(revokePushInstallation).mockResolvedValueOnce(false);
    await act(async () => { await hook.result.current.disable(); });
    expect(hook.result.current.enabled).toBe(false);
    expect(hook.result.current.message).toContain('O‘chirish so‘rovi saqlandi');
  });
  test('native token rotation re-registers directly without recursively requesting another native token', async () => {
    jest.mocked(pushInstallationState).mockResolvedValue(saved);
    const hook = await renderHook(usePush, { wrapper });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    await act(async () => { mockRotation({ data: 'rotated-native-token' }); });
    await waitFor(() => expect(registerPushToken).toHaveBeenCalledTimes(2));
    expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalledTimes(1);
    expect(jest.mocked(registerPushToken).mock.calls[1][1]).toBe('rotated-native-token');
  });
  test('ordinary profile refresh does not revoke an unchanged account binding', async () => {
    jest.mocked(pushInstallationState).mockResolvedValue(saved);
    const hook = await renderHook(usePush, { wrapper });
    await waitFor(() => expect(hook.result.current.enabled).toBe(true));
    mockUser = { ...mockUser, first_name: 'Edited' }; await hook.rerender({});
    expect(revokePushInstallation).not.toHaveBeenCalled();
  });
  test('a stale-account cold-start tap never reads a different user notification', async () => {
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(response('8'));
    await renderHook(usePush, { wrapper });
    await waitFor(() => expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled());
    expect(mockFetchOne).not.toHaveBeenCalled(); expect(router.navigate).not.toHaveBeenCalled();
  });
  test('an authorized tap fetches server detail and opens only the internal inbox', async () => {
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(response());
    await renderHook(usePush, { wrapper });
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith({ pathname: '/(app)/(tabs)/notifications', params: { notificationId: '3' } }));
    expect(mockFetchOne).toHaveBeenCalledWith(3);
  });
  test('a different-store tap requests store selection and waits before reading business data', async () => {
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValue(response('7', '2'));
    const hook = await renderHook(usePush, { wrapper });
    await waitFor(() => expect(router.navigate).toHaveBeenCalledWith('/stores'));
    expect(mockFetchOne).not.toHaveBeenCalled();
    mockTenant = { id: 2 }; await hook.rerender({});
    await waitFor(() => expect(mockFetchOne).toHaveBeenCalledWith(3));
  });
});
