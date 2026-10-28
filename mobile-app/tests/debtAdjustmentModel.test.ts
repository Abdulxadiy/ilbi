import { acceptedAdjustment, adjustmentMoney, adjustmentPayload, parseAdjustmentQuote } from '../src/features/debts/adjustmentModel';
import contract from './contracts/debt-adjustments.json';
const scope = { actorId: contract.actor, tenantId: contract.tenant, customerId: contract.customer, branchId: contract.tenant };
const payload = adjustmentPayload({ ...contract.payload, branch_id: contract.tenant });
describe('Actual debt-adjustment protocol consumer', () => {
  test('actual PostgreSQL refund DTO changes USD-10 to-7 and retains UZS100; accepts original-key acknowledgement', () => {
    const quote = parseAdjustmentQuote(contract.quote, scope, payload);
    expect(quote.remaining).toEqual({ UZS: '100.00', USD: '-7.00' });
    expect(quote.payment_amount).toBe('-3.00');
    const confirmed = { ...payload, expected_quote: quote.expected_quote };
    expect(acceptedAdjustment(contract.result, scope, confirmed, 'original-adjustment-key').id).toBe(contract.result.id);
    expect(acceptedAdjustment({ ...contract.result, password: 'opaque' }, scope, confirmed, 'original-adjustment-key')).not.toHaveProperty('password');
    expect(() => parseAdjustmentQuote(contract.quote, {} as any, payload)).toThrow();
  });
  test('signed user amounts keep cents and only supported fields enter the journal payload', () => {
    expect(adjustmentPayload({ ...payload, kind: 'correction', amount: '-1 234,56', payment_type: 'none', opaque: 'hidden' })).toEqual({ ...payload, kind: 'correction', amount: '-1234.56', payment_type: 'none' });
    expect(() => adjustmentPayload({ ...payload, amount: '-3.00' })).toThrow();
    expect(() => adjustmentPayload({ ...payload, amount: '0' })).toThrow();
    expect(() => adjustmentPayload({ ...payload, payment_type: 'none' })).toThrow();
    expect(() => adjustmentPayload({ ...payload, note: '' })).toThrow();
    expect(() => adjustmentMoney('3e0')).toThrow();
    expect(() => adjustmentMoney('1.234')).toThrow();
  });
  test.each(['actor_id', 'tenant_id', 'counterparty_id', 'branch_id'])('quote %s cannot come from another scope', field => {
    expect(() => parseAdjustmentQuote({ ...contract.quote, [field]: 99999999 }, scope, payload)).toThrow();
  });
  test.each([
    { protocol: 'old-server' }, { kind: 'correction' }, { amount: '4.00' }, { payment_amount: '3.00' },
    { available_credit: '100.00' }, { remaining: { UZS: '139000.00', USD: '-10.00' } },
    { note: 'Another reason' }, { payment_type: 'card' }, { expected_quote: '' },
  ])('rejects unconfirmed quote arithmetic/identity %#', patch => {
    expect(() => parseAdjustmentQuote({ ...contract.quote, ...patch }, scope, payload)).toThrow();
  });
  test('rejects a quote that creates debt while claiming to refund limited credit', () => {
    expect(() => parseAdjustmentQuote({ ...contract.quote, amount: '11.00', payment_amount: '-11.00', remaining: { UZS: '100.00', USD: '1.00' } }, scope, { ...payload, amount: '11.00' })).toThrow();
  });
  test.each([
    { amount: '3.00' }, { recorded_by: 999999 }, { counterparty: 999999 }, { branch_id: 999999 },
    { is_correction: false }, { exchange_rate: '13000.00' }, { adjustment_operation: null },
  ])('rejects wrong signed result or opaque legacy acknowledgement %#', patch => {
    expect(() => acceptedAdjustment({ ...contract.result, ...patch }, scope, { ...payload, expected_quote: contract.quote.expected_quote }, 'original-adjustment-key')).toThrow();
  });
  test('expected quote, kind and original key are independently required on acknowledgement', () => {
    const confirmed = { ...payload, expected_quote: contract.quote.expected_quote };
    expect(() => acceptedAdjustment(contract.result, scope, confirmed, 'another-key')).toThrow();
    expect(() => acceptedAdjustment(contract.result, scope, payload, 'original-adjustment-key')).toThrow();
    expect(() => acceptedAdjustment({ ...contract.result, adjustment_operation: { ...contract.result.adjustment_operation, kind: 'correction' } }, scope, confirmed, 'original-adjustment-key')).toThrow();
  });
});
