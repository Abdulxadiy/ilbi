import { notificationCategory, notificationDestination, type InboxNotification } from '../src/features/notifications/inbox';
const row = (type: string, link: string): InboxNotification => ({ id: 1, recipient: 2, type, link, title: 'Generic', message: 'Generic', is_read: false, created_at: '2026-10-27T09:00:00Z' });
test('support alerts only open exact internal UUID threads and never arbitrary URLs', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  expect(notificationDestination(row('support_message', '/support?conversation=' + id))).toEqual({ module: 'Support', label: 'Yordam suhbatini ochish', params: { conversationId: id } });
  for (const path of ['https://evil.invalid/support?conversation=' + id, '//evil.invalid', '/support?conversation=' + id + '&url=https://evil.invalid', '/support?conversation=../private']) expect(notificationDestination(row('support_message', path))).toBeNull();
  expect(notificationCategory('support_message')).toBe('Yordam');
});
test('workspace reminders remain readable inbox items until a real module is present', () => {
  for (const type of ['workspace_assigned', 'workspace_due']) {
    expect(notificationDestination(row(type, '/workspace/reminders/12/'))).toBeNull();
    expect(notificationCategory(type)).toBe('Eslatma');
  }
});
test.each(['/b2b', '/sales/b2b/inbox/'])('B2B producer destination %s opens the native B2B list', link => {
  expect(notificationDestination(row('b2b_transfer_request', link))).toEqual({ module: 'B2B', label: 'B2B savdolarni ochish' });
});
test('legacy B2B aliases remain restricted to exact trusted internal links and notification types', () => {
  for (const link of ['https://evil.invalid/b2b', '//evil.invalid/b2b', '/b2b?redirect=https://evil.invalid', '/b2b/../accounts', '/b2b#other', '/B2B', '/b2b-other']) {
    expect(notificationDestination(row('b2b_transfer_request', link))).toBeNull();
  }
  expect(notificationDestination(row('unknown', '/b2b'))).toBeNull();
});
