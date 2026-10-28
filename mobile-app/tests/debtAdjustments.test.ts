import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordStore } from '../src/storage/recordStore';
import * as identities from '../src/api/financialIdentity';
import { getServerScope, scopedKey } from '../src/api/environment';
import { request, captureAuthScope, assertAuthScope } from '../src/api/client';
import { ApiError } from '../src/api/errors';
import { acknowledgeAdjustment, fetchAdjustmentQuote, reconcileAdjustmentIntent, submitAdjustment, type AcceptedAdjustment } from '../src/features/debts/adjustments';
import { adjustmentPayload } from '../src/features/debts/adjustmentModel';
import { reconcileFinancialIntent } from '../src/features/sync/reconcile';
import contract from './contracts/debt-adjustments.json';
import type { UserProfile } from '../src/features/auth/AuthContext';
jest.mock('../src/storage/recordStore', () => { jest.requireActual('fake-indexeddb/auto'); return jest.requireActual('../src/storage/recordStore.web'); });
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(), assertAuthScope: jest.fn() }));
const tenant = { id: contract.tenant, name: 'Source', is_owner: true, permissions: [] };
const user = { id: contract.actor, role: 'owner', terms_accepted: true, tenants: [tenant], username: 'synthetic-owner', first_name: '', last_name: '', phone_number: '' } as UserProfile;
const operation = `debt-adjustment:${contract.customer}:11111111-1111-4111-8111-111111111111`;
const nextOperation = `debt-adjustment:${contract.customer}:22222222-2222-4222-8222-222222222222`;
const payload = adjustmentPayload({ ...contract.payload, branch_id: tenant.id, expected_quote: contract.quote.expected_quote });
const commits = () => jest.mocked(request).mock.calls.filter(([path]) => path.endsWith('/adjust/'));
const quotes = () => jest.mocked(request).mock.calls.filter(([path]) => path.endsWith('/adjustment-quote/'));
const receipt = (body: any) => ({ ...contract.result, adjustment_operation: { ...contract.result.adjustment_operation, idempotency_key: body.idempotency_key, expected_quote: body.expected_quote } });
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.mocked(assertAuthScope).mockImplementation(() => {});
  jest.mocked(captureAuthScope).mockReturnValue({ generation: 1, server: getServerScope(), tenantId: String(tenant.id) });
  jest.mocked(request).mockImplementation(async (path, options) => path.endsWith('/adjustment-quote/') ? contract.quote : receipt(options?.body));
  await AsyncStorage.clear(); for (const [key] of await recordStore.entries()) await recordStore.update(key, () => null);
});
afterEach(() => jest.restoreAllMocks());
describe('Quoted adjustments with the real durable record store', () => {
  test('quote has no financial intent or commit; preserves exact server DTO', async () => {
    const quote = await fetchAdjustmentQuote(contract.customer, payload, user, tenant);
    expect(quote.remaining.USD).toBe('-7.00');
    expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
    expect(commits()).toHaveLength(0);
    expect(jest.mocked(request).mock.calls[0]).toEqual([`/sales/counterparties/${contract.customer}/payments/adjustment-quote/`, { method: 'POST', body: { ...contract.payload, branch_id: tenant.id } }]);
  });
  test('fresh submit rechecks quote, persists original body/key, validates receipt and acknowledges locally', async () => {
    const result = await submitAdjustment(operation, payload, user, tenant);
    expect(result.amount).toBe('-3.00'); expect(quotes()).toHaveLength(1); expect(commits()).toHaveLength(1);
    const saved = (await identities.getFinancialIntent(operation, user.id, tenant.id))!;
    expect(saved.status).toBe('confirmed'); expect(saved.payload).toEqual(payload);
    expect(commits()[0][1]?.body).toEqual({ ...payload, idempotency_key: saved.key });
    expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
    await submitAdjustment(operation, payload, user, tenant);
    expect(commits()).toHaveLength(1); // A completed dialog never creates another write.
  });
  test('uncertain result retains key/body; retry bypasses new quote and reconciles exactly once', async () => {
    let first = true;
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path.endsWith('/adjustment-quote/')) return contract.quote;
      if (first) { first = false; throw new ApiError('Connection lost', 0, null, 0, 'NETWORK'); }
      return receipt(options?.body);
    });
    await expect(submitAdjustment(operation, payload, user, tenant)).rejects.toThrow('Connection lost');
    const pending = (await identities.getFinancialIntent(operation, user.id, tenant.id))!;
    expect(pending.status).toBe('pending');
    await submitAdjustment(operation, payload, user, tenant);
    expect(quotes()).toHaveLength(1);
    expect(commits()[0][1]?.body).toEqual(commits()[1][1]?.body);
    expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.key).toBe(pending.key);
    expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('confirmed');
  });
  test('fresh stale quote is rejected before a durable intent or write', async () => {
    jest.mocked(request).mockResolvedValue({ ...contract.quote, expected_quote: 'b'.repeat(64) });
    await expect(submitAdjustment(operation, payload, user, tenant)).rejects.toThrow('Belgilangan maydonlarni');
    expect(await identities.getFinancialIntent(operation, user.id, tenant.id)).toBeNull(); expect(commits()).toHaveLength(0);
  });
  test('older/unsupported server cannot receive a fallback legacy correction', async () => {
    jest.mocked(request).mockRejectedValue(new ApiError('Missing route', 404));
    await expect(submitAdjustment(operation, payload, user, tenant)).rejects.toThrow('serverni yangilash');
    expect(commits()).toHaveLength(0); expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
  });
  test('fresh definitive rejection releases its family lock; pending replay rejection preserves the old journal', async () => {
    jest.mocked(request).mockImplementation(async path => {
      if (path.endsWith('/adjustment-quote/')) return contract.quote;
      throw new ApiError('Closed shift', 400);
    });
    await expect(submitAdjustment(operation, payload, user, tenant)).rejects.toThrow('Closed shift');
    expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('rejected');
    await identities.withFinancialIdentity(nextOperation, payload, user.id, tenant.id);
    await expect(submitAdjustment(nextOperation, payload, user, tenant)).rejects.toThrow('Closed shift');
    expect((await identities.getFinancialIntent(nextOperation, user.id, tenant.id))?.status).toBe('pending');
  });
  test('a malformed acknowledgement keeps the original pending intent', async () => {
    jest.mocked(request).mockImplementation(async path => path.endsWith('/adjustment-quote/') ? contract.quote : { ...contract.result, adjustment_operation: null });
    await expect(submitAdjustment(operation, payload, user, tenant)).rejects.toThrow('to‘liq tasdiqlamadi');
    expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
  });
  test('failed local acknowledgement retries storage without a second HTTP commit', async () => {
    const acknowledgement = jest.spyOn(identities, 'confirmFinancialIdentity').mockRejectedValueOnce(Error('Local quota'));
    let accepted!: AcceptedAdjustment;
    await expect(submitAdjustment(operation, payload, user, tenant, record => { accepted = record; })).rejects.toThrow('Local quota');
    expect(accepted.result.id).toBe(contract.result.id);
    acknowledgement.mockRestore();
    await acknowledgeAdjustment(accepted);
    expect(commits()).toHaveLength(1); expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('confirmed');
  });
  test.each(['debt', 'adjustment'])('pending %s locks both collection and adjustment families', async mode => {
    const normal = `debt:${contract.customer}:33333333-3333-4333-8333-333333333333`;
    const first = mode === 'debt' ? normal : operation, second = mode === 'debt' ? operation : normal;
    await identities.withFinancialIdentity(first, payload, user.id, tenant.id);
    await expect(identities.withFinancialIdentity(second, payload, user.id, tenant.id)).rejects.toBeInstanceOf(identities.PendingOperationError);
  });
  test('completed immutable adjustment never acquires a new key for a changed body', async () => {
    await submitAdjustment(operation, payload, user, tenant);
    await expect(identities.withFinancialIdentity(operation, { ...payload, amount: '2.00' }, user.id, tenant.id)).rejects.toBeInstanceOf(identities.PendingOperationError);
    await expect(submitAdjustment(operation, { ...payload, amount: '2.00' }, user, tenant)).rejects.toBeInstanceOf(identities.PendingOperationError);
    expect(commits()).toHaveLength(1);
  });
  test('sync dispatch replays persisted body/key even after restart without recalculating', async () => {
    const identity = await identities.withFinancialIdentity(operation, payload, user.id, tenant.id);
    const intent = (await identities.getFinancialIntent(operation, user.id, tenant.id))!;
    const result = await reconcileFinancialIntent(intent, user, tenant);
    expect(result.id).toBe(contract.result.id); expect(quotes()).toHaveLength(0);
    expect(commits()[0][1]?.body).toEqual({ ...payload, idempotency_key: identity.idempotency_key });
    expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
  });
  test('cross-server/store/account intent and corrupted persisted metadata never replay', async () => {
    await identities.withFinancialIdentity(operation, payload, user.id, tenant.id);
    const intent = (await identities.getFinancialIntent(operation, user.id, tenant.id))!;
    for (const changed of [{ ...intent, server: 'https://other.example/api/v1' }, { ...intent, userId: user.id + 1 }, { ...intent, tenantId: tenant.id + 1 }]) await expect(reconcileAdjustmentIntent(changed, user, tenant)).rejects.toThrow('boshqa hisob');
    await recordStore.update(scopedKey('intent:' + operation, user.id, tenant.id), () => ({ ...intent, userId: user.id + 1 }));
    await expect(reconcileAdjustmentIntent(intent, user, tenant)).rejects.toThrow('boshqa manbaga');
    expect(request).not.toHaveBeenCalled();
  });
  test('stale auth and a forged staff-owner flag cannot create a quote, intent or commit', async () => {
    await expect(fetchAdjustmentQuote(contract.customer, payload, { ...user, role: 'staff' }, tenant)).rejects.toThrow('egasi vakolati');
    jest.mocked(assertAuthScope).mockImplementation(() => { throw Error('Session changed'); });
    await expect(submitAdjustment(operation, payload, user, tenant)).rejects.toThrow('Session changed');
    expect(request).not.toHaveBeenCalled(); expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
  });
});
