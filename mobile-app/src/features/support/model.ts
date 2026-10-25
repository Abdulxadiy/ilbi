import { isUuid } from '../../domain/identifiers';
export { isUuid } from '../../domain/identifiers';
export type SupportLanguage = 'uz' | 'ru' | 'en';
export interface Conversation { id: string; name: string; subject: string; language: SupportLanguage; status: 'waiting' | 'active' | 'closed'; operator_id: number | null; operator_name: string; tenant_id: number | null; unread_count: number; created_at: string; updated_at: string; }
export interface SupportMessage { id: number; sender: 'visitor' | 'operator' | 'system'; author_name: string; client_id: string; text: string; event: string; has_image: boolean; has_voice: boolean; voice_duration: number; sticker: string; reply_to: { id: number; sender: string; author_name: string; text: string; has_image: boolean; has_voice: boolean; voice_duration: number; sticker: string } | null; created_at: string; }
export function parseConversation(value: any): Conversation {
  if (!value || !isUuid(value.id) || typeof value.name !== 'string' || typeof value.subject !== 'string' || !['uz', 'ru', 'en'].includes(value.language) || !['waiting', 'active', 'closed'].includes(value.status) || (value.operator_id !== null && (!Number.isInteger(value.operator_id) || value.operator_id < 1))) throw Error('Murojaat ma’lumotlari tasdiqlanmadi.');
  return value;
}
export function parseMessage(value: any): SupportMessage {
  if (!value || !Number.isInteger(value.id) || value.id < 1 || !isUuid(value.client_id) || !['visitor', 'operator', 'system'].includes(value.sender) || typeof value.text !== 'string' || typeof value.created_at !== 'string') throw Error('Yozishma ma’lumotlari tasdiqlanmadi.');
  return value;
}
export function parseMessagePage(value: any) {
  if (!value || !Array.isArray(value.results) || typeof value.has_more !== 'boolean') throw Error('Yozishma sahifasi tasdiqlanmadi.');
  return { results: value.results.map(parseMessage) as SupportMessage[], has_more: value.has_more };
}
