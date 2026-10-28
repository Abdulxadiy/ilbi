import { getAccessToken, getAuthenticationGeneration, parseJwt, salesApi } from '../api/client.js';
import { localStore, sessionStore } from './brandStorage.js';
import { adjustmentInput, adjustmentQuote, adjustmentReceipt } from './debtAdjustmentModel.js';
import { createAdjustmentJournal, PendingAdjustmentError } from './debtAdjustmentJournal.js';
export const debtAdjustmentJournal = createAdjustmentJournal();
const positive = value => Number.isSafeInteger(value) && value > 0;
export function captureAdjustmentSession(user, tenant) {
  const member = user?.tenants?.find(row => row.id === tenant?.id);
  if (user?.role !== 'owner' || user.terms_accepted !== true || !positive(user.id) || !positive(tenant?.id) || member?.is_owner !== true) throw Error('Mijoz haqqini qaytarish uchun faol do‘kon egasi vakolati talab qilinadi.');
  const source = { origin: window.location.origin, actorId: user.id, tenantId: tenant.id }, generation = getAuthenticationGeneration();
  const assertCurrent = () => {
    const selected = sessionStore.getItem('ilbi_active_tenant:' + source.actorId) || localStore.getItem('ilbi_active_tenant:' + source.actorId);
    if (window.location.origin !== source.origin || generation !== getAuthenticationGeneration() || parseJwt(getAccessToken())?.user_id !== source.actorId || String(selected) !== String(source.tenantId)) throw Error('Sessiya yoki do‘kon o‘zgardi. Asl qaytarish yozuvi saqlandi.');
  };
  assertCurrent(); return { source, assertCurrent, user };
}
function branchAllowed(session, payload) {
  session.assertCurrent();
  if (session.user.tenants.find(row => row.id === payload.branch_id)?.is_owner !== true) throw Error('Qaytaruvchi do‘konda egasi vakolati talab qilinadi.');
}
const context = (session, customerId, payload) => ({ actorId: session.source.actorId, tenantId: session.source.tenantId, customerId, branchId: payload.branch_id });
export async function fetchWebAdjustmentQuote(session, customerId, raw) {
  const payload = adjustmentInput(raw); branchAllowed(session, payload);
  if (!positive(customerId)) throw Error('Mijoz identifikatori tasdiqlanmadi.');
  let value;
  try {
    const { expected_quote: _quote, ...body } = payload;
    value = await salesApi.quoteDebtAdjustment(customerId, body);
  } catch (failure) {
    session.assertCurrent();
    if ([404, 405].includes(failure.status)) throw Error('Qaytarish hisobi uchun serverni yangilash kerak.');
    throw failure;
  }
  session.assertCurrent(); return adjustmentQuote(value, context(session, customerId, payload), payload);
}
export async function pendingWebAdjustment(session) {
  session.assertCurrent(); const record = await debtAdjustmentJournal.pending(session.source); session.assertCurrent(); return record;
}
export async function acknowledgeWebAdjustment(session, record, result) {
  session.assertCurrent();
  const accepted = adjustmentReceipt(result, context(session, record.customerId, record.payload), record.payload, record.key);
  await debtAdjustmentJournal.finish(session.source, record.operation, record.key, 'confirmed', accepted);
  session.assertCurrent(); return accepted;
}
export async function submitWebAdjustment(session, operation, customerId, raw, onRecorded, onAccepted) {
  const payload = adjustmentInput(raw); branchAllowed(session, payload);
  const previous = await debtAdjustmentJournal.read(session.source, operation); session.assertCurrent();
  const active = await pendingWebAdjustment(session);
  if (active && active.operation !== operation) throw new PendingAdjustmentError(active);
  if (!previous || previous.status === 'rejected') {
    if (!payload.expected_quote) throw Error('Avval qaytarish hisobini oling va tekshiring.');
    const fresh = await fetchWebAdjustmentQuote(session, customerId, payload);
    if (fresh.expected_quote !== payload.expected_quote) { const error = Error('Mijoz balansi o‘zgardi. Qaytarish hisobini yangilang.'); error.fields = { amount: error.message }; throw error; }
  }
  const record = await debtAdjustmentJournal.prepare(session.source, operation, customerId, payload); session.assertCurrent();
  onRecorded?.(record);
  let value = record.status === 'confirmed' ? record.result : null;
  if (!value) {
    try { value = await salesApi.commitDebtAdjustment(record.customerId, { ...record.payload, idempotency_key: record.key }); session.assertCurrent(); }
    catch (failure) {
      if (previous?.status !== 'pending' && [400, 403, 404, 422].includes(failure.status)) {
        session.assertCurrent(); await debtAdjustmentJournal.finish(session.source, operation, record.key, 'rejected'); onRecorded?.(null);
      }
      throw failure;
    }
  }
  const accepted = adjustmentReceipt(value, context(session, record.customerId, record.payload), record.payload, record.key);
  onAccepted?.(record, accepted);
  return acknowledgeWebAdjustment(session, record, accepted);
}
