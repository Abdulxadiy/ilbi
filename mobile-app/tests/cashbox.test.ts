import { request } from '../src/api/client';
import { recordStore } from '../src/storage/recordStore';
import { getFinancialIntent, confirmFinancialIdentity } from '../src/api/financialIdentity';
import { getServerScope } from '../src/api/environment';
import { CashboxAcceptedButUnrecorded, submitCashbox, reconcileCashboxIntent } from '../src/features/cashbox/commands';
import { parseShift } from '../src/features/cashbox/model';
import { readCategories, saveCategory } from '../src/features/cashbox/categories';

jest.mock('../src/storage/recordStore', () => { jest.requireActual('fake-indexeddb/auto'); return jest.requireActual('../src/storage/recordStore.web'); });
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'f2e6739a-3286-4e5f-b90b-7ebecdbccbb4') }));
const tenant = { id: 7, name: 'Synthetic store', is_owner: true, permissions: [] };
const user = { id: 2, username: 'synthetic', role: 'owner' as const, terms_accepted: true, tenants: [tenant], first_name: '', last_name: '', phone_number: '' };
const operation = 'cashbox:income:0f7f06dc-e740-4f83-b303-e36de43b1abc';
const payload = { amount: '12.50', currency: 'USD', source: 'Synthetic', expected_shift_id: 19, date: '2026-10-27', note: '' };
const capability = { cashbox_mutations: 1, idempotent_operations: ['open', 'close', 'income', 'expense'] };
const accepted = (body: any) => ({ id: 31, amount: body.amount, currency: body.currency, recorded_by: user.id, cashbox_operation: { idempotency_key: body.idempotency_key, kind: 'income', actor_id: user.id, tenant_id: tenant.id } });
describe('Cashbook original-key protocol', () => {
  beforeEach(async () => {
    jest.restoreAllMocks(); jest.clearAllMocks();
    for (const [key] of await recordStore.entries()) await recordStore.update(key, () => null);
    jest.mocked(request).mockImplementation(async (path, options) => path === '/cashbox/capabilities/' ? capability : accepted(options!.body));
  });
  test('an old server cannot receive a cash write or acquire a journal identity', async () => {
    jest.mocked(request).mockRejectedValueOnce(Object.assign(Error('Old server'), { status: 404 }));
    await expect(submitCashbox(operation, payload, user, tenant)).rejects.toThrow(/Server kassa/);
    expect(await getFinancialIntent(operation, user.id, tenant.id)).toBeNull();
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });
  test('a completed unique dialog keeps its original key and exact cents', async () => {
    await submitCashbox(operation, payload, user, tenant);
    const saved = await getFinancialIntent(operation, user.id, tenant.id);
    expect(saved?.status).toBe('confirmed');
    await submitCashbox(operation, payload, user, tenant);
    const posts = jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual(posts[1]);
    expect(posts[0][1]?.body).toMatchObject({ amount: '12.50', idempotency_key: saved!.key });
    await expect(submitCashbox(operation, { ...payload, amount: '13.50' }, user, tenant)).rejects.toThrow('Oldingi amal');
  });
  test.each(['key', 'actor', 'tenant'])('a mismatched %s acknowledgement preserves pending identity', async field => {
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path === '/cashbox/capabilities/') return capability;
      const result = accepted(options!.body);
      if (field === 'key') result.cashbox_operation.idempotency_key = 'wrong-key';
      if (field === 'actor') result.cashbox_operation.actor_id++;
      if (field === 'tenant') result.cashbox_operation.tenant_id++;
      return result;
    });
    await expect(submitCashbox(operation, payload, user, tenant)).rejects.toThrow(/asl kalit/);
    expect((await getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
  });
  test('a rejection during unknown-result replay never proves the original failed', async () => {
    jest.mocked(request).mockImplementation(async (path) => {
      if (path === '/cashbox/capabilities/') return capability;
      throw Object.assign(Error('Timed out'), { status: 408 });
    });
    await expect(submitCashbox(operation, payload, user, tenant)).rejects.toThrow('Timed out');
    jest.mocked(request).mockImplementation(async path => {
      if (path === '/cashbox/capabilities/') return capability;
      throw Object.assign(Error('Shift changed'), { status: 400 });
    });
    await expect(submitCashbox(operation, payload, user, tenant)).rejects.toThrow('Shift changed');
    expect((await getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
  });
  test('the original key does not excuse a different amount or currency', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => path === '/cashbox/capabilities/' ? capability : { ...accepted(options!.body), amount: '120.50' });
    await expect(submitCashbox(operation, payload, user, tenant)).rejects.toThrow(/yozuvi/);
    expect((await getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
    jest.mocked(request).mockImplementation(async (path, options) => path === '/cashbox/capabilities/' ? capability : { ...accepted(options!.body), currency: 'UZS' });
    await expect(submitCashbox(operation, payload, user, tenant)).rejects.toThrow(/yozuvi/);
    expect((await getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
  });
  test('local acknowledgement failure retries only storage after server acceptance', async () => {
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path === '/cashbox/capabilities/') return capability;
      jest.spyOn(recordStore, 'transaction').mockRejectedValueOnce(Error('Synthetic disk failure'));
      return accepted(options!.body);
    });
    let failure: any;
    try { await submitCashbox(operation, payload, user, tenant); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(CashboxAcceptedButUnrecorded);
    expect((await getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
    await confirmFinancialIdentity(operation, user.id, tenant.id, failure.key, failure.result);
    expect((await getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('confirmed');
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  test('reconciliation uses persisted original payload/key and refuses another account', async () => {
    jest.mocked(request).mockImplementation(async path => { if (path === '/cashbox/capabilities/') return capability; throw Error('Disconnected'); });
    await expect(submitCashbox(operation, payload, user, tenant)).rejects.toThrow('Disconnected');
    const intent = (await getFinancialIntent(operation, user.id, tenant.id))!;
    jest.mocked(request).mockImplementation(async (path, options) => path === '/cashbox/capabilities/' ? capability : accepted(options!.body));
    await expect(reconcileCashboxIntent({ ...intent, server: getServerScope(), userId: user.id + 1 }, user, tenant)).rejects.toThrow(/boshqa server/);
    await reconcileCashboxIntent(intent, user, tenant);
    expect(jest.mocked(request).mock.calls.at(-1)).toEqual(['/cashbox/income/', { method: 'POST', body: { ...payload, idempotency_key: intent.key } }]);
    expect((await getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('confirmed');
  });
  test('staff without cash income permission cannot make even the capability request', async () => {
    const staffTenant = { ...tenant, is_owner: false, permissions: ['cashbox.view_cashbox'] };
    await expect(submitCashbox(operation, payload, { ...user, role: 'staff', tenants: [staffTenant] }, staffTenant)).rejects.toThrow(/vakolat/);
    expect(request).not.toHaveBeenCalled();
  });
  test('malformed shift cannot silently show zero money', () => {
    expect(() => parseShift({ is_open: true, shift_id: 1 })).toThrow(/summasi/);
    expect(() => parseShift({ is_open: true, shift_id: null })).toThrow(/smenasi/);
  });
  test('reusable cash categories are isolated by account, store and entry kind', async () => {
    await saveCategory('income', 2, 7, '  Synthetic source  ');
    expect(await readCategories('income', 2, 7)).toEqual(['Synthetic source']);
    expect(await readCategories('income', 3, 7)).toEqual([]);
    expect(await readCategories('income', 2, 8)).toEqual([]);
    expect(await readCategories('expense', 2, 7)).toEqual([]);
    await saveCategory('income', 2, 7, 'Synthetic source', true);
    expect(await readCategories('income', 2, 7)).toEqual([]);
  });
});
