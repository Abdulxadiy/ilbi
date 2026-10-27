import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { request } from '../src/api/client';
import { NotificationsProvider, useNotifications } from '../src/features/notifications/NotificationsContext';
import { inboxUrl, notificationDestination, parseInboxPage } from '../src/features/notifications/inbox';
let mockTenant = { id: 1, name: 'A', is_owner: true, permissions: [] };
let mockUser: any = { id: 7, role: 'owner', terms_accepted: true, tenants: [mockTenant, { ...mockTenant, id: 2 }] };
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: () => ({ generation: 1 }), assertAuthScope: jest.fn() }));
const row = (id = 3, read = false) => ({ id, recipient: 7, type: 'daily_z_report', title: 'Report', message: 'Text', link: '', is_read: read, created_at: '2026-10-27T05:00:00Z' });
const page = (rows = [row()], unread = 14, cursor: number | null = null) => ({ results: rows, unread_count: unread, next_before_id: cursor, next: cursor ? 'https://invalid.invalid/steal' : null });
const wrapper = ({ children }: { children: React.ReactNode }) => <NotificationsProvider>{children}</NotificationsProvider>;
describe('Real notification inbox contract', () => {
  beforeEach(() => { jest.clearAllMocks(); mockTenant = { id: 1, name: 'A', is_owner: true, permissions: [] }; mockUser = { id: 7, role: 'owner', terms_accepted: true, tenants: [mockTenant, { ...mockTenant, id: 2 }] }; });
  test('unread count comes from the server, not the visible page; foreign recipients are rejected', () => {
    expect(parseInboxPage(page(), 7).unreadCount).toBe(14);
    expect(() => parseInboxPage(page([{ ...row(), recipient: 8 }]), 7)).toThrow();
    expect(() => parseInboxPage({ ...page(), unread_count: -1 }, 7)).toThrow();
    expect(() => parseInboxPage(page([{ ...row(), id: '../4' } as any]), 7)).toThrow();
  });
  test('targets cannot open arbitrary URLs and history URLs are client-owned', () => {
    expect(notificationDestination({ ...row(), type: 'unknown', link: 'https://evil.invalid' })).toBeNull();
    expect(notificationDestination({ ...row(), type: 'unknown', link: '//evil.invalid' })).toBeNull();
    expect(notificationDestination({ ...row(), type: 'b2b_transfer_accepted', link: '/sales/45/' })).toEqual({ module: 'ReceiptView', label: 'Chekni ochish', params: { sale: { id: 45 } } });
    expect(inboxUrl(12)).toBe('/sales/notifications/?page=1&page_size=20&before_id=12');
  });
  test('loads the real endpoint and server cursor without following a returned next URL', async () => {
    jest.mocked(request).mockResolvedValueOnce(page([row(30)], 14, 30)).mockResolvedValueOnce(page([row(29)], 14));
    const hook = await renderHook(useNotifications, { wrapper });
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
    expect(hook.result.current.unreadCount).toBe(14);
    await act(async () => { await hook.result.current.loadMore(); });
    expect(jest.mocked(request).mock.calls[1][0]).toBe('/sales/notifications/?page=1&page_size=20&before_id=30');
    expect(hook.result.current.rows.map(item => item.id)).toEqual([30, 29]);
    expect(hook.result.current.hasMore).toBe(false);
  });
  test('failed read is visible and never acknowledged locally; read-all changes count only after success', async () => {
    jest.mocked(request).mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ unread_count: 0 });
    const hook = await renderHook(useNotifications, { wrapper });
    await waitFor(() => expect(hook.result.current.rows).toHaveLength(1));
    await act(async () => { expect(await hook.result.current.markRead(3)).toBe(false); });
    expect(hook.result.current.unreadCount).toBe(14); expect(hook.result.current.rows[0].is_read).toBe(false); expect(hook.result.current.error).toBe('Offline');
    await act(async () => { expect(await hook.result.current.markAllRead()).toBe(true); });
    expect(hook.result.current.unreadCount).toBe(0); expect(hook.result.current.rows[0].is_read).toBe(true);
    expect(jest.mocked(request).mock.calls.at(-1)?.[0]).toBe('/sales/notifications/read-all/');
  });
  test('a store switch hides old data immediately and rejects an old in-flight result', async () => {
    let finish!: (value: any) => void;
    jest.mocked(request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(page([row(5)], 1));
    const hook = await renderHook(useNotifications, { wrapper });
    mockTenant = { ...mockTenant, id: 2 }; await hook.rerender({});
    await waitFor(() => expect(hook.result.current.rows[0]?.id).toBe(5));
    await act(async () => { finish(page([row(99)], 90)); });
    expect(hook.result.current.rows.map(item => item.id)).toEqual([5]); expect(hook.result.current.unreadCount).toBe(1);
  });
  test('a signed-out session never requests or exposes the inbox', async () => {
    mockUser = null;
    const hook = await renderHook(useNotifications, { wrapper });
    expect(hook.result.current.enabled).toBe(false); expect(hook.result.current.rows).toEqual([]); expect(request).not.toHaveBeenCalled();
  });
});
