import { safeDisplayText, sensitiveField } from '../security/presentation';
export class ApiError extends Error {
  constructor(message: string, public status = 0, public data: any = null, public retryAfterMs = 0, public code = 'API_ERROR') { super(safeDisplayText(message)); this.name = 'ApiError'; }
}
export function errorMessage(data: any, fallback = 'So‘rov bajarilmadi'): string {
  if (typeof data === 'string') return safeDisplayText(data, fallback);
  if (typeof data?.detail === 'string') return safeDisplayText(data.detail, fallback);
  if (typeof data?.message === 'string') return safeDisplayText(data.message, fallback);
  if (typeof data?.error?.message === 'string') return safeDisplayText(data.error.message, fallback);
  if (typeof data?.error === 'string') return safeDisplayText(data.error, fallback);
  if (data && typeof data === 'object') {
    const values = Object.entries(data).filter(([key, value]) => !sensitiveField(key) && Array.isArray(value)).flatMap(([, value]) => (value as unknown[]).filter(item => typeof item === 'string'));
    if (values.length) return safeDisplayText(values.join(' '), fallback);
  }
  return fallback;
}
