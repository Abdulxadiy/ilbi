import wire from './contracts/support.json';
import { parseConversation, parseMessagePage } from '../src/features/support/model';
test('real Django support DTOs retain UUID ownership, operator replies and cursor fields', () => {
  expect(parseConversation(wire.created)).toMatchObject({ id: wire.created.id, status: 'waiting', operator_id: null });
  expect(parseConversation(wire.conversation)).toMatchObject({ status: 'active', unread_count: 0 });
  expect(parseConversation(wire.guest).tenant_id).toBeNull();
  expect(parseConversation(wire.closed).status).toBe('closed');
  expect(parseConversation(wire.reopened).status).toBe('waiting');
  const messages = parseMessagePage(wire.messages);
  const operator = messages.results.find(message => message.sender === 'operator');
  expect(operator?.reply_to?.id).toBe(messages.results[0].id);
  expect(parseMessagePage(wire.after).results.some(message => message.id === operator?.id)).toBe(true);
});
