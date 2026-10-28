import AsyncStorage from '@react-native-async-storage/async-storage';
import { recordStore } from '../src/storage/recordStore';
import { request, assertAuthScope, captureAuthScope } from '../src/api/client';
import { ApiError } from '../src/api/errors';
import { getServerScope, scopedKey } from '../src/api/environment';
import * as identities from '../src/api/financialIdentity';
import { acceptedImport, importMoney, parseImportJob } from '../src/features/customers/importModel';
import { acknowledgeCustomerImport, commitCustomerImport, previewCustomerImport, reconcileCustomerImport, type AcceptedImport } from '../src/features/customers/importCommands';
import { reconcileFinancialIntent } from '../src/features/sync/reconcile';
import type { UserProfile } from '../src/features/auth/AuthContext';
import contract from './contracts/counterparty-import.json';
jest.mock('../src/storage/recordStore', () => { jest.requireActual('fake-indexeddb/auto'); return jest.requireActual('../src/storage/recordStore.web'); });
jest.mock('../src/api/client', () => ({ request: jest.fn(), assertAuthScope: jest.fn(), captureAuthScope: jest.fn() }));
const context = contract.valid.operation_context;
const tenant = { id: context.tenant_id, name: 'Synthetic', is_owner: true, permissions: [] };
const user: UserProfile = { id: context.actor_id, role: 'owner', terms_accepted: true, tenants: [tenant], username: 'synthetic', first_name: '', last_name: '', phone_number: '' };
const scope = { actorId: user.id, tenantId: tenant.id };
const job = parseImportJob(contract.valid, scope), payload = job.payload!, operation = 'customer-import:' + job.id;
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.mocked(assertAuthScope).mockImplementation(() => {});
  jest.mocked(captureAuthScope).mockReturnValue({ generation: 1, server: getServerScope(), tenantId: String(tenant.id) });
  jest.mocked(request).mockResolvedValue(contract.result);
  await AsyncStorage.clear(); for (const [key] of await recordStore.entries()) await recordStore.update(key, () => null);
});
test('actual multipart API preview and commit DTO validate; opaque fields never enter the model', () => {
  expect(payload).toEqual({ job_id: job.id, expected_count: 2, expected_total_debt_uzs: '1250.50', expected_total_debt_usd: '2.75' });
  expect(parseImportJob({ ...contract.valid, password: 'opaque' }, scope)).not.toHaveProperty('password');
  expect(acceptedImport(contract.result, payload, scope).counterparty_ids).toHaveLength(2);
  expect(parseImportJob(contract.invalid, scope).payload).toBeNull();
});
test('row errors including unexpected fields cannot be dropped to enable an import', () => {
  for (const errors of [{ other: 'Not valid' }, JSON.parse('{"constructor":"Not valid"}')]) expect(() => parseImportJob({ ...contract.valid, rows: [{ ...contract.valid.rows[0], errors }] }, scope)).toThrow('to‘liq tasdiqlamadi');
});
test.each(['actor_id', 'tenant_id', 'job_id', 'protocol'])('foreign/unsupported preview context %s is rejected', field => {
  expect(() => parseImportJob({ ...contract.valid, operation_context: { ...context, [field]: 'wrong' } }, scope)).toThrow();
});
test('duplicate row numbers, missing scope, completed preview and invalid money fail closed', () => {
  for (const changed of [{ ...contract.valid, rows: [contract.valid.rows[0], contract.valid.rows[0]] }, { ...contract.valid, completed_at: contract.valid.expires_at }, { ...contract.valid, rows: [{ ...contract.valid.rows[0], data: { ...contract.valid.rows[0].data, debt_balance_usd: '-1' } }] }]) expect(() => parseImportJob(changed, scope)).toThrow();
  expect(() => parseImportJob(contract.valid, {} as any)).toThrow();
});
test('1000 maximal balances total exactly beyond Number-safe cents', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ row_number: i + 2, data: { name: 'Synthetic', phone_number: '+998901234567', debt_balance_uzs: '999999999999.99' }, errors: {} }));
  const large = parseImportJob({ ...contract.valid, rows }, scope).payload!;
  expect(large.expected_total_debt_uzs).toBe('999999999999990.00');
  expect(importMoney('999999999999999.99')).toBe('999 999 999 999 999,99');
});
test.each([
  { created_count: 1 }, { counterparty_ids: [1, 1] }, { counterparty_ids: ['1', '2'] }, { total_debt_uzs: '1250.51' }, { import_operation: null },
])('inconsistent commit acknowledgement remains unaccepted', changed => {
  expect(() => acceptedImport({ ...contract.result, ...changed }, payload, scope)).toThrow();
});
test('preview is multipart/read-only with no financial intent and rejects older unbound DTO', async () => {
  const body = new FormData(); body.append('file', 'Synthetic CSV');
  jest.mocked(request).mockResolvedValueOnce(contract.valid).mockResolvedValueOnce({ ...contract.valid, operation_context: null });
  expect((await previewCustomerImport(body, user, tenant)).payload).toEqual(payload);
  expect(jest.mocked(request).mock.calls[0][1]?.body).toBe(body);
  expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
  await expect(previewCustomerImport(body, user, tenant)).rejects.toThrow();
});
test('fresh commit is durable before posting and a completed dialog never sends twice', async () => {
  jest.mocked(request).mockImplementation(async () => {
    expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
    return contract.result;
  });
  await commitCustomerImport(payload, user, tenant); await commitCustomerImport(payload, user, tenant);
  expect(request).toHaveBeenCalledTimes(1);
  expect(jest.mocked(request).mock.calls[0][0]).toBe(`/sales/counterparties/import/${job.id}/commit/`);
  expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('confirmed');
});
test('lost response survives restart and sync replays the same job without another preview', async () => {
  jest.mocked(request).mockRejectedValueOnce(new ApiError('Disconnected', 0)).mockResolvedValueOnce(contract.result);
  await expect(commitCustomerImport(payload, user, tenant)).rejects.toThrow('Disconnected');
  const intent = (await identities.getFinancialIntent(operation, user.id, tenant.id))!;
  await reconcileFinancialIntent(intent, user, tenant);
  expect(jest.mocked(request).mock.calls[0]).toEqual(jest.mocked(request).mock.calls[1]);
  expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
  expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.key).toBe(intent.key);
});
test('malformed result stays pending; another import is blocked by the same family lock', async () => {
  jest.mocked(request).mockResolvedValue({ ...contract.result, import_operation: null });
  await expect(commitCustomerImport(payload, user, tenant)).rejects.toThrow();
  expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
  await expect(commitCustomerImport({ ...payload, job_id: payload.job_id + 1 }, user, tenant)).rejects.toBeInstanceOf(identities.PendingOperationError);
  expect(request).toHaveBeenCalledTimes(1);
});
test('failed local acknowledgement can finish without a second network request', async () => {
  const spy = jest.spyOn(identities, 'confirmFinancialIdentity').mockRejectedValueOnce(Error('Storage unavailable'));
  let accepted!: AcceptedImport;
  await expect(commitCustomerImport(payload, user, tenant, value => { accepted = value; })).rejects.toThrow('Storage unavailable');
  spy.mockRestore(); await acknowledgeCustomerImport(accepted);
  expect(request).toHaveBeenCalledTimes(1); expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
});
test('new definitive rejection can release the lock; an uncertain replay denial cannot erase the old intent', async () => {
  jest.mocked(request).mockRejectedValue(new ApiError('Duplicate phone', 400));
  await expect(commitCustomerImport(payload, user, tenant)).rejects.toThrow('Duplicate phone');
  expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('rejected');
  await identities.withFinancialIdentity(operation, payload, user.id, tenant.id);
  await expect(commitCustomerImport(payload, user, tenant)).rejects.toThrow();
  expect((await identities.getFinancialIntent(operation, user.id, tenant.id))?.status).toBe('pending');
});
test('foreign scope, changed completed payload and tampered persisted operation cannot replay', async () => {
  await commitCustomerImport(payload, user, tenant);
  const intent = (await identities.getFinancialIntent(operation, user.id, tenant.id))!;
  await expect(commitCustomerImport({ ...payload, expected_count: 3 }, user, tenant)).rejects.toBeInstanceOf(identities.PendingOperationError);
  for (const changes of [{ server: 'https://other.invalid' }, { userId: user.id + 1 }, { tenantId: tenant.id + 1 }]) await expect(reconcileCustomerImport({ ...intent, ...changes }, user, tenant)).rejects.toThrow('boshqa server');
  await recordStore.update(scopedKey('intent:' + operation, user.id, tenant.id), () => ({ ...intent, operation: 'customer-import:9999' }));
  await expect(reconcileCustomerImport(intent, user, tenant)).rejects.toThrow('asl jurnali');
  expect(request).toHaveBeenCalledTimes(1);
});
test('missing manage/debt permission and stale account stop before journaling or network', async () => {
  const staffTenant = { ...tenant, is_owner: false, permissions: ['sales.manage_counterparty'] };
  const staff: UserProfile = { ...user, role: 'staff', tenants: [staffTenant] };
  await expect(commitCustomerImport(payload, staff, staffTenant)).rejects.toThrow('Boshlang‘ich nasiya');
  await expect(previewCustomerImport(new FormData(), staff, { ...staffTenant, id: 99999 })).rejects.toThrow('vakolat berilmagan');
  jest.mocked(assertAuthScope).mockImplementation(() => { throw Error('Session changed'); });
  await expect(commitCustomerImport(payload, user, tenant)).rejects.toThrow('Session changed');
  expect(request).not.toHaveBeenCalled(); expect(await identities.listFinancialIntents(user.id, tenant.id)).toHaveLength(0);
});
