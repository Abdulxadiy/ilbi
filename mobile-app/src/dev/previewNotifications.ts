export function createPreviewNotifications() {
  let rows = [
    { id: 103, recipient: 900001, type: 'daily_z_report', title: 'Demo Z-hisobot tayyor', message: 'Bu sun’iy bildirishnoma. Hisobotlarni ilova ichida ko‘ring.', link: '/reports', is_read: false, created_at: '2026-10-27T05:00:00Z' },
    { id: 102, recipient: 900001, type: 'debt_due_reminder', title: 'Demo qarz muddati', message: 'Mijozning qarz sanasini tekshiring. Haqiqiy mijozga xabar yuborilmaydi.', link: '/debts?workspace_id=1', is_read: false, created_at: '2026-10-27T04:30:00Z' },
    { id: 101, recipient: 900001, type: 'low_stock_alert', title: 'Demo ombor ogohlantirishi', message: 'Bu sinov ro‘yxati. Haqiqiy qoldiq o‘zgartirilmaydi.', link: '/inventory', is_read: true, created_at: '2026-10-27T04:00:00Z' },
  ];
  return (url: URL, method: string): { handled: boolean; data?: any } => {
    if (url.pathname === '/sales/notifications/' && method === 'GET') {
      const before = Number(url.searchParams.get('before_id') || 0), filtered = rows.filter(row => !before || row.id < before), page = filtered.slice(0, 20);
      return { handled: true, data: { results: page, count: rows.length, unread_count: rows.filter(row => !row.is_read).length, next: filtered.length > 20 ? '?page=2' : null, next_before_id: filtered.length > 20 ? page.at(-1)?.id : null } };
    }
    if (url.pathname === '/sales/notifications/' && method === 'DELETE') { rows = []; return { handled: true, data: null }; }
    if (url.pathname === '/sales/notifications/read-all/' && method === 'POST') { rows = rows.map(row => ({ ...row, is_read: true })); return { handled: true, data: { unread_count: 0 } }; }
    const match = url.pathname.match(/^\/sales\/notifications\/(\d+)\/(read\/)?$/);
    if (match && (method === 'POST' && match[2] || method === 'DELETE' && !match[2])) {
      if (!rows.some(row => row.id === Number(match[1]))) throw Error('Bildirishnoma topilmadi.');
      rows = method === 'DELETE' ? rows.filter(row => row.id !== Number(match[1])) : rows.map(row => row.id === Number(match[1]) ? { ...row, is_read: true } : row);
      return { handled: true, data: method === 'DELETE' ? null : { detail: 'O‘qilgan deb belgilandi.' } };
    }
    return { handled: false };
  };
}
