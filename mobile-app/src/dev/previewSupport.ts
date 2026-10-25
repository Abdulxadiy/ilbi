import * as Crypto from 'expo-crypto';
import type { Conversation, SupportMessage } from '../features/support/model';
/** Explicit demo state only. Never answers a failed real support request. */
export function createPreviewSupport() {
  let nextMessage = 3;
  const seed = '90000000-0000-4000-8000-000000000001', now = () => new Date().toISOString();
  const conversations = new Map<string, Conversation>([[seed, { id: seed, name: 'Demo', subject: 'ILBI bo‘yicha yordam', language: 'uz', status: 'active', operator_id: 900002, operator_name: 'Yordam operatori', tenant_id: 900001, unread_count: 1, created_at: now(), updated_at: now() }]]);
  const owners = new Map<string, string>([[seed, 'account']]);
  const messages = new Map<string, SupportMessage[]>([[seed, [
    { id: 1, sender: 'visitor', author_name: '', client_id: '90000000-0000-4000-8000-000000000011', text: 'Ilovadan foydalanish bo‘yicha savolim bor.', event: '', has_image: false, has_voice: false, voice_duration: 0, sticker: '', reply_to: null, created_at: now() },
    { id: 2, sender: 'operator', author_name: 'Yordam operatori', client_id: '90000000-0000-4000-8000-000000000012', text: 'Salom! Savolingizni shu yerga yozishingiz mumkin. Bu sinov yozishmasi.', event: '', has_image: false, has_voice: false, voice_duration: 0, sticker: '', reply_to: null, created_at: now() },
  ]]]);
  return (url: URL, method: string, body: any, suppliedHeaders?: HeadersInit): { handled: boolean; data?: any } => {
    if (!url.pathname.startsWith('/support/')) return { handled: false };
    if (url.pathname === '/support/metadata/' && method === 'GET') return { handled: true, data: { phone: '', telegram_username: '', languages: ['uz', 'ru', 'en'], ai_enabled: false, max_image_bytes: 2097152 } };
    const match = url.pathname.match(/^\/support\/(conversations|guest|inbox)\/(?:([a-f\d-]+)\/(messages\/)?)?$/i);
    if (!match) throw Error('Bu yordam amali preview rejimida ulanmagan.');
    const owner = match[1] === 'guest' ? new Headers(suppliedHeaders).get('X-Support-Token') : 'account', id = match[2], isMessages = match[3];
    if (!owner) throw Error('Mehmon yordam seansi kerak.');
    if (!id && method === 'GET') {
      const rows = [...conversations.values()].filter(c => match[1] === 'inbox' || owners.get(c.id) === owner).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1), size = Number(url.searchParams.get('page_size')) || 50;
      return { handled: true, data: { count: rows.length, results: rows.slice((page - 1) * size, page * size).map(c => ({ ...c })), next: page * size < rows.length ? '?page=' + (page + 1) : null, unread_total: rows.reduce((sum, c) => sum + c.unread_count, 0) } };
    }
    if (!id && method === 'POST') {
      if (!body.consent || !body.name || !body.subject || !body.text || !body.client_id) throw Error('Ism, mavzu, xabar va rozilik kerak.');
      const retry = [...conversations.values()].find(c => owners.get(c.id) === owner && messages.get(c.id)?.some(m => m.client_id === body.client_id));
      if (retry) return { handled: true, data: { ...retry } };
      const created: Conversation = { id: Crypto.randomUUID(), name: body.name, subject: body.subject, language: body.language || 'uz', status: 'waiting', operator_id: null, operator_name: '', tenant_id: match[1] === 'guest' ? null : 900001, unread_count: 0, created_at: now(), updated_at: now() };
      conversations.set(created.id, created); owners.set(created.id, owner); messages.set(created.id, [{ id: nextMessage++, sender: 'visitor', author_name: '', client_id: body.client_id, text: body.text, event: '', has_image: false, has_voice: false, voice_duration: 0, sticker: '', reply_to: null, created_at: now() }]);
      return { handled: true, data: { ...created } };
    }
    const conversation = conversations.get(id), lines = messages.get(id);
    if (!conversation || !lines || owners.get(id) !== owner && match[1] !== 'inbox') throw Error('Murojaat topilmadi.');
    if (!isMessages && method === 'GET') return { handled: true, data: { ...conversation } };
    if (!isMessages && method === 'POST') {
      if (body.action === 'read') conversation.unread_count = 0;
      else if (body.action === 'close') conversation.status = 'closed';
      else if (body.action === 'reopen') { conversation.status = 'waiting'; conversation.operator_id = null; conversation.operator_name = ''; }
      else if (body.action === 'claim') { conversation.status = 'active'; conversation.operator_id = 900001; conversation.operator_name = 'Demo operator'; }
      else throw Error('Noma’lum yordam amali.');
      conversation.updated_at = now(); return { handled: true, data: body.action === 'read' ? { ok: true } : { ...conversation } };
    }
    if (isMessages && method === 'GET') {
      const after = Number(url.searchParams.get('after_id')) || 0, before = Number(url.searchParams.get('before_id')) || Infinity;
      const rows = lines.filter(message => message.id > after && message.id < before).sort((a, b) => after ? a.id - b.id : b.id - a.id);
      return { handled: true, data: { results: (after ? rows.slice(0, 50) : rows.slice(0, 50).reverse()).map(m => ({ ...m })), has_more: rows.length > 50 } };
    }
    if (isMessages && method === 'POST') {
      const existing = lines.find(message => message.client_id === body.client_id); if (existing) return { handled: true, data: { ...existing } };
      if (conversation.status === 'closed') throw Error('Avval suhbatni qayta oching.');
      if (!body.text?.trim() || !body.client_id) throw Error('Xabarni kiriting.');
      const message: SupportMessage = { id: nextMessage++, sender: match[1] === 'inbox' ? 'operator' : 'visitor', author_name: '', client_id: body.client_id, text: body.text, event: '', has_image: false, has_voice: false, voice_duration: 0, sticker: '', reply_to: null, created_at: now() };
      lines.push(message); conversation.updated_at = now(); return { handled: true, data: { ...message } };
    }
    throw Error('Yordam preview amali ulanmagan.');
  };
}
