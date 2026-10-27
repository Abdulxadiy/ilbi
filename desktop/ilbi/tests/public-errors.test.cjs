const test = require('node:test');
const assert = require('node:assert/strict');
const { publicErrorMessage, protectIpcHandler } = require('../public-errors.cjs');
const { DesktopUpdater } = require('../updater.cjs');

test('native errors preserve useful user guidance and pairing comparison codes', () => {
  assert.equal(publicErrorMessage("Error invoking remote method 'ilbi:setup': Error: Parollar omboriga ulanib bo‘lmadi."), 'Parollar omboriga ulanib bo‘lmadi.');
  assert.equal(publicErrorMessage('Tasdiqlash belgisi A123-B456'), 'Tasdiqlash belgisi A123-B456');
});
test('native process details, hashes and credentials never become user-facing errors', async () => {
  for (const message of ['Command failed: python secret=synthetic', 'Traceback\npassword=synthetic', 'a'.repeat(64),
    'pbkdf2_sha256$1000000$salt$synthetic', 'postgres://user:synthetic@localhost/db', 'Bearer synthetic-token', "ENOENT: open '/private/profile/device.vault'"]) {
    assert(!publicErrorMessage(Error(message)).includes(message));
    await assert.rejects(protectIpcHandler(async () => { throw Error(message); })(), error => !error.message.includes(message));
  }
});
test('IPC protection preserves arguments, authorization failures and successful result ownership', async () => {
  const event = { sender: 'untrusted' };
  const protectedCall = protectIpcHandler(async (request, value) => {
    assert.equal(request, event); assert.equal(value, 42);
    throw Error('Hisobingizga qayta kiring.');
  });
  await assert.rejects(protectedCall(event, 42), /Hisobingizga qayta kiring/);
  assert.deepEqual(await protectIpcHandler(async (_request, value) => ({ id: value }))(event, 42), { id: 42 });
});
test('updater status redacts unexpected native errors and preserves progress guidance', () => {
  const updater = new DesktopUpdater({ current: { version: '1.4.0' }, cache: '/tmp/unused', install: async () => {} });
  updater.set({ phase: 'error', message: 'token=' + 'b'.repeat(64) });
  assert(!updater.status().message.includes('b'.repeat(64)));
  updater.set({ phase: 'verifying', message: 'Yuklangan paket tekshirilmoqda…' });
  assert.equal(updater.status().message, 'Yuklangan paket tekshirilmoqda…');
});
