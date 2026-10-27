export type InboxNotification = { id: number; recipient: number; type: string; title: string; message: string; link: string; is_read: boolean; created_at: string };
export type InboxPage = { rows: InboxNotification[]; unreadCount: number; cursor: number | null };
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

export function parseInboxPage(value: any, recipient: number): InboxPage {
  const rows = Array.isArray(value) ? value : value?.results;
  if (!Array.isArray(rows)) throw Error('Bildirishnomalar ro‘yxati tasdiqlanmadi.');
  const parsed = rows.map((row: any): InboxNotification => {
    if (!positive(row?.id) || row.recipient !== recipient || typeof row.title !== 'string' || typeof row.message !== 'string' || typeof row.type !== 'string' || typeof row.is_read !== 'boolean' || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) throw Error('Bildirishnoma ma’lumotlari tasdiqlanmadi.');
    if (row.title.length > 200 || row.message.length > 50000 || row.type.length > 64 || row.link && (typeof row.link !== 'string' || row.link.length > 255)) throw Error('Bildirishnoma ma’lumotlari tasdiqlanmadi.');
    return { id: row.id, recipient: row.recipient, type: row.type, title: row.title, message: row.message, link: row.link || '', is_read: row.is_read, created_at: row.created_at };
  });
  const unreadCount = Array.isArray(value) ? parsed.filter(row => !row.is_read).length : value.unread_count;
  const cursor = Array.isArray(value) ? null : value.next_before_id ?? null;
  if (!Number.isSafeInteger(unreadCount) || unreadCount < 0 || cursor !== null && !positive(cursor)) throw Error('Bildirishnomalar soni tasdiqlanmadi.');
  return { rows: parsed.sort((a, b) => b.id - a.id), unreadCount, cursor };
}

export const inboxUrl = (cursor: number | null = null) => '/sales/notifications/?page=1&page_size=20' + (cursor ? '&before_id=' + cursor : '');
export const mergeInbox = (previous: InboxNotification[], next: InboxNotification[]) => [...new Map([...previous, ...next].map(row => [row.id, row])).values()].sort((a, b) => b.id - a.id);

/** Only known internal destinations. Never open a notification's arbitrary URL. */
export function notificationDestination(row: InboxNotification): { module: string; label: string; params?: any } | null {
  if (row.type === 'daily_z_report') return { module: 'Reports', label: 'Hisobotlarni ochish' };
  if (row.type === 'low_stock_alert') return { module: 'Inventory', label: 'Omborni ochish' };
  if (['debt_due_reminder', 'debt_threshold_warning'].includes(row.type)) return { module: 'Qarz', label: 'Qarzlarni ochish' };
  const sale = row.link.match(/^\/sales\/([1-9]\d{0,9})\/$/);
  if (sale && Number.isSafeInteger(Number(sale[1]))) return { module: 'ReceiptView', label: 'Chekni ochish', params: { sale: { id: Number(sale[1]) } } };
  return null;
}

export function notificationCategory(type: string) {
  if (type.startsWith('b2b_transfer_')) return 'B2B';
  if (type.startsWith('debt_')) return 'Qarz';
  if (type === 'daily_z_report') return 'Z-hisobot';
  if (type === 'low_stock_alert') return 'Ombor';
  return 'Xabar';
}
