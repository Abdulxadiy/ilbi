import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { savedReceiptIdentity } from '../src/utils/receiptIdentity.js';
const fixture = JSON.parse(readFileSync(new URL('../../../mobile-app/tests/contracts/documents.json', import.meta.url), 'utf8'));
test('shared web/desktop invoice identity uses the actual saved API snapshot over current names', () => {
  const sale = fixture.sales.cash;
  const identity = savedReceiptIdentity({ ...sale, sold_by_name: 'Changed cashier', counterparty_name: 'Changed customer', tenant_name: 'Changed store' }, { store: 'Current context', cashier: 'Current account', phone: '9999' });
  assert.equal(identity.store, 'Saved <store>');
  assert.equal(identity.cashier, sale.receipt_snapshot.document_parties.cashier_name);
  assert.equal(identity.customer, 'Document customer');
  assert.equal(identity.customerPhone, sale.receipt_snapshot.document_parties.customer_phone);
  assert.equal(identity.phone, ''); assert.equal(identity.legacyMessage, '');
});
test('known blank/null party fields cannot borrow another current user/customer/store', () => {
  const identity = savedReceiptIdentity({ tenant_name: 'Current', counterparty_name: 'Changed buyer', receipt_snapshot: { version: 1, store_name: '', document_parties: { version: 1, cashier_name: '', customer_name: null } } }, { store: 'Current context', cashier: 'Current user' });
  assert.equal(identity.store, ''); assert.equal(identity.cashier, ''); assert.equal(identity.customer, '');
  assert.equal(identity.customerPhone, ''); assert.equal(identity.recipient, ''); assert.equal(identity.legacyMessage, '');
});
test('legacy display remains readable and explicitly does not claim saved party history', () => {
  const sale = { tenant_name: 'Current legacy store', counterparty_name: 'Current legacy buyer', sold_by_name: 'Current legacy cashier' };
  const identity = savedReceiptIdentity(sale);
  assert.equal(identity.store, sale.tenant_name); assert.equal(identity.customer, sale.counterparty_name);
  assert.equal(identity.savedParties, false); assert.ok(identity.legacyMessage.includes('joriy ma’lumot'));
  assert.equal(sale.receipt_snapshot, undefined);
});
