import { ApiError } from './errors';
import { safeDisplayText, sensitiveField } from '../security/presentation';

export type FieldErrors = Record<string, string>;
const general = new Set(['detail', 'message', 'error', 'non_field_errors', '__all__']);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);

/** Keep server field paths: a nested variant error must not mark an unrelated input. */
export function fieldErrors(failure: unknown): FieldErrors {
  if (!failure || typeof failure !== 'object') return {};
  const outer = failure as any;
  const data = outer.data ?? outer.response?.data ?? (failure instanceof Error ? null : failure);
  if (!data || typeof data !== 'object') return {};
  if (data.error && typeof data.error === 'object' && data.error.details == null && !data.errors) return {};
  const details = data.error?.details ?? data.errors ?? data;
  if (!details || typeof details !== 'object') return {};
  const result: FieldErrors = {};
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 6 || Object.keys(result).length >= 100) return;
    if (typeof value === 'string' && path) {
      if (value.trim()) result[path] = safeDisplayText(value, 'Ushbu maydonni tekshiring.');
    } else if (Array.isArray(value)) {
      if (value.every(item => typeof item === 'string')) {
        if (path && value.length) result[path] = safeDisplayText(value.join(' '), 'Ushbu maydonni tekshiring.');
      } else value.slice(0, 100).forEach((item, index) => walk(item, path ? `${path}.${index}` : String(index), depth + 1));
    } else if (value && typeof value === 'object') {
      Object.entries(value).slice(0, 100).forEach(([key, item]) => {
        if (unsafe.has(key) || ['non_field_errors', '__all__'].includes(key)) return;
        if (sensitiveField(key) && !['password', 'old_password', 'new_password', 'current_password', 'confirm_password', 'parol'].includes(key.toLowerCase())) return;
        if (details === data && !path && (general.has(key) || key === 'code' && (data.detail || data.message) && typeof item === 'string')) return;
        walk(item, path ? `${path}.${key}` : key, depth + 1);
      });
    }
  };
  walk(details, '', 0);
  return result;
}

export function formError(fields: FieldErrors, message = 'Belgilangan maydonlarni tekshiring.') {
  return new ApiError(message, 400, { error: { code: 'validation_error', message, details: fields } });
}
