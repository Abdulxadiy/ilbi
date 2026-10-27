import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NotificationsScreen } from '../src/features/notifications/NotificationsScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
let mockTenant = { id: 1, name: 'A', is_owner: true, permissions: [] };
const mockUser = { id: 7, role: 'owner', terms_accepted: true, tenants: [mockTenant, { ...mockTenant, id: 2 }] };
const mockClear = jest.fn(async () => true);
const mockInbox = { rows: [{ id: 3, recipient: 7, title: 'Report', message: 'Text', type: 'daily_z_report', is_read: false, link: '', created_at: '2026-10-27T05:00:00Z' }], unreadCount: 1, loading: false, loadingMore: false, hasMore: false, busy: '', error: '', refresh: jest.fn(), markRead: jest.fn(async () => true), markAllRead: jest.fn(), remove: jest.fn(), clear: mockClear, fetchOne: jest.fn() };
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/features/notifications/NotificationsContext', () => ({ useNotifications: () => mockInbox }));
jest.mock('../src/features/notifications/NotificationPreferences', () => ({ NotificationPreferences: () => null }));
describe('Notification destructive action scope', () => {
  beforeEach(() => { jest.clearAllMocks(); mockTenant = { ...mockTenant, id: 1 }; });
  test('a clear-all confirmation cannot carry into another selected store', async () => {
    const screen = await render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByLabelText('Bildirishnomalarni tozalash'));
    expect(screen.getByText('O‘chirishni tasdiqlash')).toBeTruthy();
    mockTenant = { ...mockTenant, id: 2 };
    await screen.rerender(<ThemeProvider><NotificationsScreen /></ThemeProvider>);
    expect(screen.queryByText('O‘chirishni tasdiqlash')).toBeNull();
    expect(mockClear).not.toHaveBeenCalled();
  });
  test('clear-all is never sent before explicit confirmation', async () => {
    const screen = await render(<ThemeProvider><NotificationsScreen /></ThemeProvider>);
    await fireEvent.press(screen.getByLabelText('Bildirishnomalarni tozalash'));
    expect(mockClear).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('O‘chirishni tasdiqlash'));
    expect(mockClear).toHaveBeenCalledTimes(1);
  });
});
