import { localStore, sessionStore } from '../utils/brandStorage.js';
import { request } from './client';
import { redactRequestError, safeApiErrorMessage } from '../utils/safePresentation.js';

const newGuestKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
let loginGuestKey = sessionStore.getItem('ilbi_login_support_guest');

export function beginLoginSupportSession() {
  loginGuestKey = newGuestKey();
  sessionStore.setItem('ilbi_login_support_guest', loginGuestKey);
}

export function guestSupportKey() {
  if (/^[a-f0-9]{64}$/.test(loginGuestKey || '')) return loginGuestKey;
  let key = localStore.getItem('ilbi_support_guest');
  if (!/^[a-f0-9]{64}$/.test(key || '')) {
    key = newGuestKey();
    localStore.setItem('ilbi_support_guest', key);
  }
  return key;
}

export async function publicSupportRequest(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(window.ilbiDesktop ? { 'X-ILBI-Cloud-Session': 'true' } : {}), ...options.headers },
    body: options.body && !isForm ? JSON.stringify(options.body) : options.body,
  });
  if (!response.ok) {
    const data = redactRequestError(await response.json().catch(() => ({})), options.body);
    const error = new Error(safeApiErrorMessage(data, response.status));
    error.status = response.status;
    error.data = data;
    error.retryAfterMs = Number(response.headers.get('Retry-After') || 0) * 1000;
    throw error;
  }
  return options.responseType === 'blob' ? response.blob() : response.json();
}

export function supportApi(authenticated, operator = false) {
  const root = `/support/${authenticated && operator ? 'inbox' : authenticated ? 'conversations' : 'guest'}/`;
  const guestToken = authenticated ? null : guestSupportKey();
  const call = (path = '', options = {}) => authenticated
    ? request(root + path, { ...options, skipTenant: true })
    : publicSupportRequest(root + path, { ...options, headers: { 'X-Support-Token': guestToken } });
  return {
    list: (query = '') => call(query),
    create: (body, tenantId) => call('', { method: 'POST', body, headers: tenantId ? { 'X-Tenant-ID': String(tenantId) } : {} }),
    detail: (id) => call(`${id}/`),
    action: (id, action, extra = {}) => call(`${id}/`, { method: 'POST', body: { action, ...extra } }),
    messages: (id, query = '') => call(`${id}/messages/${query}`),
    send: (id, body) => call(`${id}/messages/`, { method: 'POST', body }),
    image: (id, messageId) => call(`${id}/messages/${messageId}/image/`, { responseType: 'blob' }),
    voice: (id, messageId) => call(`${id}/messages/${messageId}/voice/`, { responseType: 'blob' }),
    customerProfile: (id) => call(`${id}/customer/`),
    updateCustomerProfile: (id, body) => call(`${id}/customer/`, { method: 'PATCH', body }),
  };
}
