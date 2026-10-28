export const HIDDEN_VALUE = '[yashirilgan]';
export const GENERIC_ERROR = 'Amalni bajarib bo‘lmadi. Qayta urinib ko‘ring.';
const normalize = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');
const privateKeys = new Set(['password', 'passwd', 'parol', 'passwordhash', 'guesthash', 'guesttoken', 'token', 'access', 'refresh', 'accesstoken', 'refreshtoken', 'idtoken', 'authorization', 'cookie', 'setcookie', 'csrftoken', 'secret', 'secretkey', 'privatekey', 'clientsecret', 'apikey', 'revokesecret', 'temporarypassword', 'resetpasswordtoken', 'invitationtoken', 'resetlink', 'invitelink', 'sessionid', 'sessionkey', 'sessionhash']);
export const sensitiveField = (key: string) => privateKeys.has(normalize(key)) || /^(?:old|new|confirm|current|temporary)?password(?:hash|1|2)?$/.test(normalize(key));

/** Presentation only: never mutate a request, stored credential or financial identity. */
export function safeDisplayText(value: unknown, fallback = GENERIC_ERROR, submittedSecrets: readonly string[] = []): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  let text = value.slice(0, 8192);
  for (const secret of submittedSecrets.slice(0, 30)) {
    if (secret && (secret.length >= 4 || text.trim() === secret)) text = text.split(secret).join(HIDDEN_VALUE);
  }
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|Traceback \(most recent call last\)|<!doctype html|<html[\s>]|\n\s+at (?:\S+ \()?[^\n]+:\d+:\d+/i.test(text)) return fallback;
  const safe = text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1' + HIDDEN_VALUE + '@')
    .replace(/\b(?:pbkdf2_sha256|pbkdf2_sha1|scrypt|argon2(?:id|i|d)?)\$[^\s"'<>]+|\$2[aby]\$\d{2}\$[^\s"'<>]+/gi, HIDDEN_VALUE)
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\b/g, HIDDEN_VALUE)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi, '$1 ' + HIDDEN_VALUE)
    .replace(/((?:["']?)(?:password(?:_hash)?|passwd|parol|guest_hash|guest_token|x-support-token|token|secret|access|refresh|access_token|refresh_token|id_token|revoke_secret|client_secret|api[_-]?key|private_key|secret_key|authorization|cookie|csrf_token|csrftoken)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&}\]]+)/gi, '$1' + HIDDEN_VALUE)
    .replace(/\b[a-f0-9]{64}\b/gi, HIDDEN_VALUE);
  return safe.slice(0, 600).trim() || fallback;
}

/** Request-local values are never attached to an Error, persisted or logged. */
export function submittedSecretValues(body: unknown): string[] {
  let input = body;
  if (typeof input === 'string') {
    if (input.length > 65536) return [];
    try { input = JSON.parse(input); } catch { return []; }
  }
  const values: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 5 || !node || typeof node !== 'object' || values.length >= 30) return;
    for (const [key, item] of Object.entries(node).slice(0, 100)) {
      if (sensitiveField(key) && typeof item === 'string' && item) values.push(item);
      else walk(item, depth + 1);
    }
  };
  walk(input, 0);
  return values;
}

export function safeErrorData(value: unknown, submittedSecrets: readonly string[] = [], depth = 0): any {
  if (depth > 8) return '[qisqartirilgan]';
  if (typeof value === 'string') return safeDisplayText(value, GENERIC_ERROR, submittedSecrets);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeErrorData(item, submittedSecrets, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const passwordValidation = /^(?:old|new|confirm|current)?password[12]?$/.test(normalize(key)) || normalize(key) === 'parol';
    result[key] = sensitiveField(key) && !passwordValidation ? HIDDEN_VALUE : safeErrorData(item, submittedSecrets, depth + 1);
  }
  return result;
}

/** Historical audit rows may predate server-side redaction. Preserve ordinary business values. */
export function redactSensitiveData(value: unknown, depth = 0): any {
  if (depth > 8) return '[qisqartirilgan]';
  if (typeof value === 'string') return safeDisplayText(value, '');
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redactSensitiveData(item, depth + 1));
  const row = value as Record<string, unknown>, result: Record<string, unknown> = {};
  const secretRow = ['key', 'field', 'label'].some(key => typeof row[key] === 'string' && sensitiveField(row[key] as string));
  for (const [key, item] of Object.entries(row).slice(0, 100)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    if (sensitiveField(key) || secretRow && ['value', 'old', 'new', 'before', 'after', 'oldvalue', 'newvalue'].includes(normalize(key))) result[key] = HIDDEN_VALUE;
    else if (['idempotencykey', 'requestkey', 'operationid', 'clientoperationid'].includes(normalize(key)) && typeof item === 'string' && /^[a-z0-9_-]{1,128}$/i.test(item)) result[key] = item;
    else if (['sha256', 'checksum', 'signersha256', 'fingerprint'].includes(normalize(key)) && typeof item === 'string' && /^(?:[a-f0-9]{64}|[A-F0-9]{4}-[A-F0-9]{4})$/i.test(item)) result[key] = item;
    else result[key] = redactSensitiveData(item, depth + 1);
  }
  return result;
}
