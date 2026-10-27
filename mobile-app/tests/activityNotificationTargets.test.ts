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
