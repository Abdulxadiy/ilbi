import { formError } from '../../api/validation';
export type SetupInfo = { purpose: 'new_employee' | 'new_owner' | 'transfer_owner' | 'reset_password'; phase: 'password_required' | 'pending_2fa'; has_username: boolean; username: string; phone_hint: string; email_hint: string; tenant_name: string; position: string };
export type SetupChallenge = { login_ticket: string; phone_hint?: string };
const purposes = ['new_employee', 'new_owner', 'transfer_owner', 'reset_password'];
const tokenPattern = /^[A-Za-z0-9_-]{16,128}$/;
/** A pasted URL supplies only a token. It can never choose the API server or a redirect. */
export function setupToken(input: string) {
  const raw = input.trim();
  if (tokenPattern.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const native = url.protocol === 'ilbi:';
    const path = native ? '/' + (url.host + url.pathname).replace(/^\/+/, '') : url.pathname;
    if ((!native && (url.protocol !== 'https:' || url.hostname !== 'ilbi.uz' || url.port)) || url.username || url.password || url.hash || !['/setup-account', '/reset-password', '/setup-account/', '/reset-password/'].includes(path)) throw Error();
    const tokens = url.searchParams.getAll('token');
    if (tokens.length === 1 && tokenPattern.test(tokens[0])) return tokens[0];
  } catch {}
  throw formError({ token: 'Emaildagi to‘liq ILBI havolasini kiriting.' });
}
export function parseSetupInfo(value: any): SetupInfo {
  if (value?.valid !== true) throw Error('Ushbu havola eskirgan, bekor qilingan yoki ishlatilgan. Yangi havola so‘rang.');
  if (!purposes.includes(value.purpose) || !['password_required', 'pending_2fa'].includes(value.phase) || typeof value.has_username !== 'boolean') throw Error('Hisobni sozlash ma’lumotlari tasdiqlanmadi.');
  return { purpose: value.purpose, phase: value.phase, has_username: value.has_username, username: typeof value.username === 'string' ? value.username : '', phone_hint: typeof value.phone_hint === 'string' ? value.phone_hint : '', email_hint: typeof value.email_hint === 'string' ? value.email_hint : '', tenant_name: typeof value.tenant_name === 'string' ? value.tenant_name : '', position: typeof value.position === 'string' ? value.position : '' };
}
export function parseSetupChallenge(value: any): SetupChallenge {
  if (typeof value?.login_ticket !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.login_ticket) || value.access || value.refresh) throw Error('Telegram tasdiqlashni boshlash uchun server javobi tasdiqlanmadi. Havolani qayta tekshiring.');
  return { login_ticket: value.login_ticket, phone_hint: typeof value.phone_hint === 'string' ? value.phone_hint : undefined };
}
