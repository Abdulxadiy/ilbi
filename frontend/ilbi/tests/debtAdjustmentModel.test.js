import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adjustmentAmount, adjustmentCents, adjustmentInput, adjustmentQuote, adjustmentReceipt } from '../src/utils/debtAdjustmentModel.js';
const contract = JSON.parse(readFileSync(new URL('../../../mobile-app/tests/contracts/debt-adjustments.json', import.meta.url), 'utf8'));
const scope = { actorId: contract.actor, tenantId: contract.tenant, customerId: contract.customer, branchId: contract.tenant };
const payload = { ...contract.payload, branch_id: contract.tenant, expected_quote: contract.quote.expected_quote };
const key = contract.result.adjustment_operation.idempotency_key;
test('shared renderer validates the same actual API fixture as native, without exposing opaque fields', () => {
  assert.deepEqual(adjustmentInput(payload), payload);
  assert.equal(adjustmentQuote({ ...contract.quote, password: 'opaque' }, scope, payload).password, undefined);
  assert.equal(adjustmentReceipt(contract.result, scope, payload, key).amount, '-3.00');
});
test('money is exact at model limit; signed corrections and comma input remain supported', () => {
  assert.equal(adjustmentCents('999999999999.99'), 99999999999999n);
  assert.equal(adjustmentAmount('-999999999999.99'), '-999 999 999 999,99');
  assert.equal(adjustmentInput({ ...payload, kind: 'correction', amount: '-1,25', payment_type: 'none' }).amount, '-1.25');
  for (const amount of ['0', '-1', '1.001', '1e3', '1000000000000', 3]) assert.throws(() => adjustmentInput({ ...payload, amount }), error => Boolean(error.fields?.amount));
});
test('refund needs a real amount, branch, currency/channel and explicit reason', () => {
  for (const changed of [{ note: '' }, { branch_id: 0 }, { currency: 'EUR' }, { payment_type: 'none' }, { kind: 'unknown' }]) assert.throws(() => adjustmentInput({ ...payload, ...changed }));
  assert.throws(() => adjustmentInput({ ...payload, expected_quote: 'bad' }));
});
test('foreign actor/store/customer/branch and incorrect arithmetic or credit bounds cannot become a quote', () => {
  for (const changed of [{ actor_id: scope.actorId + 1 }, { tenant_id: scope.tenantId + 1 }, { counterparty_id: scope.customerId + 1 }, { branch_id: scope.branchId + 1 }, { expected_quote: 'bad' }, { remaining: { UZS: '101.00', USD: '-7.00' } }, { available_credit: '3.00' }, { payment_amount: '3.00' }]) assert.throws(() => adjustmentQuote({ ...contract.quote, ...changed }, scope, payload));
  assert.throws(() => adjustmentQuote(contract.quote, {}, payload));
  assert.throws(() => adjustmentQuote(contract.quote, scope, { ...payload, amount: '11.00' }));
});
test('wrong receipt key/context, amount, channel, reason, FX, or status stays unaccepted', () => {
  for (const changed of [{ amount: '3.00' }, { payment_type: 'card' }, { note: 'Other' }, { is_correction: false }, { recorded_by: 1 }, { exchange_rate: '13000.00' }, { paid_at: 'bad' }, { adjustment_operation: null }, { adjustment_operation: { ...contract.result.adjustment_operation, idempotency_key: 'different' } }]) assert.throws(() => adjustmentReceipt({ ...contract.result, ...changed }, scope, payload, key));
});
