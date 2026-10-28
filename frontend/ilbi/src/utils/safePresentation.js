// A presentation boundary for system errors/audit metadata, never ordinary
// user messages, document signatures or business IDs/amounts.
export const HIDDEN_VALUE = '[yashirilgan]';
const genericError = 'Amalni bajarib bo‘lmadi. Qayta urinib ko‘ring.';
const privateKey = /password|passwd|secret|token|authorization|cookie|apikey|privatekey|guesthash|requestfingerprint/;

export function safeDisplayText(value, fallback = genericError) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  if (value.length > 4000 || /-----BEGIN [\w ]*PRIVATE KEY-----|Traceback \(most recent call last\)|\n\s*at .+\(.+:\d+:\d+\)|Command failed:/i.test(value)) return fallback;
  return value
    .replace(/\b(?:pbkdf2_sha256|pbkdf2_sha1|scrypt|argon2)\$[^\s"'<>]+/gi, HIDDEN_VALUE)
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g, HIDDEN_VALUE)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, HIDDEN_VALUE)
    .replace(/\b[a-f0-9]{64,}\b/gi, HIDDEN_VALUE)
    .replace(/(\b(?:[a-z_]*password|passwd|secret|access_?token|refresh_?token|login_?ticket|api_?key|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1' + HIDDEN_VALUE)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1' + HIDDEN_VALUE)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1' + HIDDEN_VALUE + '@')
    .replace(/([?&](?:token|key|password|secret|access_token|refresh_token|login_ticket)=)[^&#\s]*/gi, '$1' + HIDDEN_VALUE);
}

export function redactSensitiveData(value) {
  const seen = new WeakSet();
  function visit(item, depth, publicDigest = false) {
    if (typeof item === 'string') return publicDigest && /^[a-f0-9]{64}$/i.test(item) ? item : safeDisplayText(item, HIDDEN_VALUE);
    if (!item || typeof item !== 'object') return item;
    if (depth > 7 || seen.has(item)) return HIDDEN_VALUE;
    seen.add(item);
    if (Array.isArray(item)) return item.slice(0, 100).map(child => visit(child, depth + 1));
    const credentialRow = ['field', 'key', 'label'].some(key => typeof item[key] === 'string' && (privateKey.test(item[key].toLowerCase().replace(/[^a-z0-9]/g, '')) || /^(?:access|refresh)$/.test(item[key].toLowerCase())));
    return Object.fromEntries(Object.entries(item).slice(0, 100).filter(([key]) => !['__proto__', 'prototype', 'constructor'].includes(key)).map(([key, child]) => {
      const name = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const sensitive = privateKey.test(name) || /^(?:access|refresh)$/.test(name) || credentialRow && /^(?:value|old|new|before|after|oldvalue|newvalue)$/.test(name);
      const publicDigest = /^(?:sha256|checksum|filesha256|filechecksum|artifactsha256|packagesha256|certificatesha256|signingcertificatesha256|certificatefingerprint|idempotencykey|requestkey|operationid|clientoperationid)$/.test(name);
      return [key, sensitive && child !== null && typeof child !== 'boolean' ? HIDDEN_VALUE : visit(child, depth + 1, publicDigest)];
    }));
  }
  return visit(value, 0);
}

export function safeApiErrorMessage(data, status) {
  const fallback = status >= 500 ? 'Serverda xatolik yuz berdi. Birozdan keyin qayta urinib ko‘ring.' : genericError;
  if (status >= 500) return fallback;
  const message = typeof data === 'string' ? data : data?.detail || data?.message || data?.error?.message;
  if (typeof message !== 'string' || message.trim().startsWith('<')) return fallback;
  return safeDisplayText(message, fallback);
}

/** Scrub an error response against only the sensitive values in that request.
 * Successful responses and ordinary business/chat content never use this path.
 */
export function redactRequestError(value, requestBody) {
  let body = requestBody;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const secrets = new Set();
  function collect(item, depth = 0) {
    if (!item || typeof item !== 'object' || depth > 6) return;
    for (const [key, child] of Object.entries(item).slice(0, 100)) {
      const name = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if ((privateKey.test(name) || /^(?:refresh|verificationcode|otp|onetimecode|loginticket)$/.test(name)) && ['string', 'number'].includes(typeof child) && String(child)) {
        const text = String(child);
        for (const variant of [text, encodeURIComponent(text), JSON.stringify(text).slice(1, -1)]) if (variant) secrets.add(variant);
      } else collect(child, depth + 1);
    }
  }
  collect(body);
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  const mask = text => ordered.reduce((result, secret) => result.split(secret).join(HIDDEN_VALUE), text);
  function clean(item, depth = 0, validation = false) {
    if (typeof item === 'string') return mask(safeDisplayText(item, HIDDEN_VALUE));
    if (!item || typeof item !== 'object') return item;
    if (depth > 7) return HIDDEN_VALUE;
    if (Array.isArray(item)) return item.slice(0, 100).map(child => clean(child, depth + 1, validation));
    return Object.fromEntries(Object.entries(item).slice(0, 100).filter(([key]) => !['__proto__', 'prototype', 'constructor'].includes(key)).map(([key, child]) => {
      const name = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const credentialMetadata = /^(?:guesthash|passwordhash|requestfingerprint|access|refresh|token|accesstoken|refreshtoken|loginticket|apikey|privatekey|secret|authorization|cookie)$/.test(name);
      const fieldMessages = validation || Array.isArray(child) && child.every(value => typeof value === 'string');
      const privateValue = credentialMetadata || /password|passwd/.test(name) && !fieldMessages;
      return [key, privateValue && child !== null && typeof child !== 'boolean' ? HIDDEN_VALUE : clean(child, depth + 1, validation || ['details', 'errors', 'field_errors'].includes(key))];
    }));
  }
  return clean(value);
}
