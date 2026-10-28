import { acknowledgeB2B, reconcileB2BIntent, submitB2B, type AcceptedB2B } from '../src/features/b2b/commands';
import { assertB2BResult, b2bCommand, b2bHtml, parseB2BDetail, pendingQuantity } from '../src/features/b2b/model';
import { request, assertAuthScope } from '../src/api/client';
import { getServerScope } from '../src/api/environment';
import { confirmFinancialIdentity, getFinancialIntent, rejectFinancialIdentity, withFinancialIdentity, type FinancialIntent } from '../src/api/financialIdentity';
const tenant = { id: 1, name: 'A', is_owner: true, permissions: [] };
const user = { id: 1, username: 'owner', role: 'owner' as const, terms_accepted: true, tenants: [tenant], first_name: '', last_name: '', phone_number: '' };
const draftId = '11111111-1111-4111-8111-111111111111';
const draft = { draftId, sale_id: 10, kind: 'accept' as const, items: [{ sale_item_id: 51, accepted_quantity: '1.250', target_category_id: 2 }] };
export const b2bSale = { id: 10, receipt_number: 'B10', status: 'b2b_pending', currency: 'UZS', source_tenant_name: 'Source', b2b_target_tenant_name: 'Destination', total_amount: '1000.00', refunded_amount: '0.00', net_amount: '1000.00', items: [{ id: 51, product_name: 'Rice', product_variant_name: 'Standard', quantity: '5.000', unit: 'kg', unit_price: '200.00', b2b_accepted_quantity: '0.000', voided_quantity: '0.000', b2b_rejected_quantity: '0.000', b2b_return_pending_quantity: '0.000', b2b_discrepancy_closed_quantity: '0.000' }] };
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ withFinancialIdentity: jest.fn(async (_operation, payload) => ({ ...payload, idempotency_key: 'original-key' })), getFinancialIntent: jest.fn(async () => null), confirmFinancialIdentity: jest.fn(async () => {}), rejectFinancialIdentity: jest.fn(async () => {}) }));
function result(kind = 'accept') {
  const sale = { ...b2bSale, status: 'b2b_partially_accepted' };
  return { ...(['accept', 'reject'].includes(kind) ? sale : { receipt_id: 9, closure_id: 9, sale }), b2b_operation: { operation_id: 'original-key', kind, actor_id: 1, tenant_id: 1, sale_id: 10, resource_id: ['accept', 'reject'].includes(kind) ? null : 9 } };
}
describe('B2B durable commands and protected documents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(assertAuthScope).mockReset();
    jest.mocked(getFinancialIntent).mockReset().mockResolvedValue(null);
    jest.mocked(confirmFinancialIdentity).mockReset().mockResolvedValue(undefined);
    jest.mocked(request).mockImplementation(async (path, options) => path === '/sales/b2b/capabilities/' ? { b2b_mutations: 1, operations: ['accept', 'reject', 'receive', 'close_discrepancy'] } : options?.method === 'POST' ? result(path.includes('receive') ? 'receive' : path.includes('close-discrepancy') ? 'close_discrepancy' : path.includes('reject') ? 'reject' : 'accept') : null);
  });
  test('old servers receive neither financial intent nor write', async () => {
    jest.mocked(request).mockRejectedValueOnce(Object.assign(Error('Not found'), { status: 404 }));
    await expect(submitB2B(draft, user, tenant)).rejects.toThrow(/serverni yangilash/);
    expect(withFinancialIdentity).not.toHaveBeenCalled();
    expect(jest.mocked(request).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  test('fractional acceptance keeps one unique dialog key and validates server acknowledgement', async () => {
    await submitB2B(draft, user, tenant);
    expect(withFinancialIdentity).toHaveBeenCalledWith('b2b:accept:' + draftId, { sale_id: 10, kind: 'accept', items: draft.items }, 1, 1);
    expect(request).toHaveBeenCalledWith('/sales/b2b/10/accept/', { method: 'POST', body: { operation_id: 'original-key', items: draft.items } });
    expect(confirmFinancialIdentity).toHaveBeenCalledTimes(1);
  });
  test.each([{ actor_id: 2 }, { tenant_id: 2 }, { sale_id: 11 }, { operation_id: 'foreign-key' }, { kind: 'reject' }])('foreign acknowledgement never confirms or erases journal: %o', async mismatch => {
    jest.mocked(request).mockImplementation(async (_path, options) => options?.method === 'POST' ? { ...result(), b2b_operation: { ...result().b2b_operation, ...mismatch } } : { b2b_mutations: 1, operations: ['accept', 'reject', 'receive', 'close_discrepancy'] });
    await expect(submitB2B(draft, user, tenant)).rejects.toThrow(/asl B2B/);
    expect(confirmFinancialIdentity).not.toHaveBeenCalled(); expect(rejectFinancialIdentity).not.toHaveBeenCalled();
  });
  test('unknown original result cannot be turned into a new rejected intent', async () => {
    jest.mocked(getFinancialIntent).mockResolvedValue({ status: 'pending' } as FinancialIntent);
    jest.mocked(request).mockImplementation(async (_path, options) => { if (options?.method === 'POST') throw Object.assign(Error('Unknown original'), { status: 400 }); return { b2b_mutations: 1, operations: ['accept', 'reject', 'receive', 'close_discrepancy'] }; });
    await expect(submitB2B(draft, user, tenant)).rejects.toThrow('Unknown original');
    expect(rejectFinancialIdentity).not.toHaveBeenCalled();
  });
  test('accepted local acknowledgement failure retries only local storage', async () => {
    let accepted: AcceptedB2B | null = null;
    jest.mocked(confirmFinancialIdentity).mockRejectedValueOnce(Error('Disk unavailable'));
    await expect(submitB2B(draft, user, tenant, row => { accepted = row; })).rejects.toThrow('Disk unavailable');
    const writes = jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST').length;
    await acknowledgeB2B(accepted!);
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(writes);
  });
  test('completed dialog returns original verified result without a second POST', async () => {
    jest.mocked(getFinancialIntent).mockResolvedValue({ status: 'confirmed', result: result() } as FinancialIntent);
    await submitB2B(draft, user, tenant);
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });
  test('reconciliation uses original payload/key and rejects another store', async () => {
    const command = b2bCommand(draft);
    const intent = { operation: command.operation, payload: command.payload, key: 'original-key', fingerprint: 'original', server: getServerScope(), userId: 1, tenantId: 1, status: 'pending' } as FinancialIntent;
    jest.mocked(getFinancialIntent).mockResolvedValue(intent);
    await reconcileB2BIntent(intent, user, tenant);
    expect(request).toHaveBeenCalledWith('/sales/b2b/10/accept/', expect.objectContaining({ body: { operation_id: 'original-key', items: draft.items } }));
    jest.clearAllMocks();
    await expect(reconcileB2BIntent({ ...intent, tenantId: 2 }, user, tenant)).rejects.toThrow(/boshqa server/);
    expect(request).not.toHaveBeenCalled();
  });
  test('return commands use both the durable mobile key and the existing domain return key', async () => {
    await submitB2B({ draftId, sale_id: 10, kind: 'receive', reason: ' Arrived ', items: [{ sale_item_id: 51, quantity: '1,250' }] }, user, tenant);
    expect(request).toHaveBeenCalledWith('/sales/b2b/10/returns/receive/', { method: 'POST', body: { operation_id: 'original-key', idempotency_key: 'original-key', reason: 'Arrived', items: [{ sale_item_id: 51, quantity: '1.250' }] } });
    expect(() => assertB2BResult({ ...result('receive'), receipt_id: 8 }, { sale_id: 10, kind: 'receive' }, 'original-key', 1, 1)).toThrow(/qaytish tasdig‘i/);
  });
  test('empty/malformed quantities reject before any request and document HTML escapes user text', () => {
    expect(() => b2bCommand({ ...draft, items: [] })).toThrow(/maydonlarni/);
    expect(() => b2bCommand({ ...draft, items: [{ sale_item_id: 51, accepted_quantity: '1.2501' }] })).toThrow(/maydonlarni/);
    const detail = parseB2BDetail({ direction: 'incoming', sale: { ...b2bSale, source_tenant_name: '<script>steal()</script>' } });
    expect(pendingQuantity(detail.sale.items[0])).toBe(5000n);
    expect(b2bHtml(detail)).toContain('&lt;script&gt;'); expect(b2bHtml(detail)).not.toContain('<script>');
  });
});
