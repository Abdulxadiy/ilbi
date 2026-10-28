export type PushTarget = { notificationId: number; recipientId: number; tenantId: number };
const id = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
export function parsePushTarget(value: unknown): PushTarget | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  const notificationId = id(data.notification_id), recipientId = id(data.recipient_id), tenantId = id(data.tenant_id);
  if (data.kind !== 'ilbi_inbox' || !notificationId || !recipientId || !tenantId) return null;
  return { notificationId, recipientId, tenantId };
}
