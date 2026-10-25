import test from 'node:test';
import assert from 'node:assert/strict';
import { claimUpdateReminder, updateDay } from '../src/utils/updateReminder.js';

test('calendar boundary uses Tashkent rather than the machine timezone', () => {
  assert.equal(updateDay(Date.parse('2026-10-25T18:59:59Z')), '2026-10-25');
  assert.equal(updateDay(Date.parse('2026-10-25T19:00:00Z')), '2026-10-26');
});

test('one reminder per day persists, and a new offered build or account gets its own reminder', () => {
  const data = new Map(), storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const scope = { account: 'reminder-test-owner', installed: '1.4.0:a', offered: '1.4.0:b', day: '2026-10-25' };
  assert.equal(claimUpdateReminder(storage, scope), true);
  assert.equal(claimUpdateReminder(storage, scope), false);
  assert.equal(claimUpdateReminder(storage, { ...scope, day: '2026-10-26' }), true);
  assert.equal(claimUpdateReminder(storage, { ...scope, day: '2026-10-26', offered: '1.4.0:c' }), true);
  assert.equal(claimUpdateReminder(storage, { ...scope, account: 'another-owner' }), true);
  assert.equal(claimUpdateReminder(storage, { ...scope, account: null }), false);
});

test('unavailable browser storage cannot break login or repeat within the running session', () => {
  const storage = { getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } };
  const scope = { account: 'storage-denied-test', installed: '1.0.0:a', offered: '1.0.1:b', day: '2026-10-25' };
  assert.equal(claimUpdateReminder(storage, scope), true);
  assert.equal(claimUpdateReminder(storage, scope), false);
});
