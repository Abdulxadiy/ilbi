const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, writeFile, access, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { DesktopUpdater, candidate } = require('../updater.cjs');
const { OFFICIAL_SERVER } = require('../runtime.cjs');
const body = Buffer.from('complete verified update fixture');
const current = { version: '1.2.0', sourceCommit: 'a'.repeat(40), buildTimestamp: 1000 };
function release(platform = 'linux', values = {}) {
  const name = platform === 'linux' ? 'ILBI-1.2.0-linux-x64.tar.gz' : 'ILBI-Setup-1.2.0-x64.exe';
  return { version: '1.2.0', sourceCommit: 'b'.repeat(40), buildTimestamp: 2000, url: `/downloads/${'b'.repeat(40)}/${name}`, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex'), ...values };
}
async function fixture(t, options = {}) {
  const cache = await mkdtemp(join(tmpdir(), 'ilbi-updater-')); t.after(() => rm(cache, { recursive: true, force: true }));
  let installations = 0, downloads = 0;
  const published = release();
  const fetcher = async (url, settings) => {
    assert.equal(settings.redirect, 'error'); assert.equal(settings.credentials, 'omit'); assert.equal(settings.headers?.Authorization, undefined);
    if (url.endsWith('/releases.json')) return new Response(JSON.stringify({ schema: 1, linux: published }));
    assert.equal(url, OFFICIAL_SERVER + published.url); downloads++;
    return new Response(options.download || body);
  };
  const updater = new DesktopUpdater({ current, cache, platform: 'linux', fetcher, install: async path => { installations++; assert.deepEqual(await readFile(path), body); await options.install?.(); } });
  return { updater, cache, published, counts: () => ({ installations, downloads }) };
}
test('same version receives new builds; identical, older and missing builds are ignored', () => {
  assert(candidate({ linux: release() }, current, 'linux'));
  assert.equal(candidate({ linux: release({}) }, current, 'darwin'), null);
  for (const changes of [{ sourceCommit: current.sourceCommit, url: release().url.replace('b'.repeat(40), current.sourceCommit) }, { buildTimestamp: 999 }, { buildTimestamp: 0 }]) {
    assert.equal(candidate({ linux: release('linux', changes) }, current, 'linux'), null);
  }
  assert.equal(candidate({}, current, 'linux'), null);
  assert(candidate({ windows: release('win32') }, current, 'win32'));
});
test('reminders identify the installed version and exact offered build without changing package versions', async t => {
  const { updater, published } = await fixture(t);
  await updater.check();
  assert.equal(updater.status().installedVersion, current.version);
  assert.equal(updater.status().availableBuild, published.sourceCommit);
  assert.match(updater.status().message, /yangi tuzatishlar/);
});
test('only immutable official packages of bounded size and valid hashes can be installed', () => {
  for (const changes of [{ url: 'https://evil.example/ILBI.exe' }, { url: release().url+'?token=secret' }, { sourceCommit: '../bad' }, { sha256: 'bad' }, { bytes: -1 }, { bytes: 2**40 }, { version: '1;rm' }]) {
    assert.throws(() => candidate({ linux: release('linux', changes) }, current, 'linux'));
  }
});
test('verified download reports progress and applies exactly once even after repeated clicks', async t => {
  const { updater, counts } = await fixture(t);
  const states = []; updater.on('status', state => states.push(state));
  await updater.check(); assert.equal(updater.status().phase, 'available');
  await Promise.all([updater.update(), updater.update()]);
  assert.equal(updater.status().phase, 'installing');
  assert(states.some(state => state.phase === 'downloading'));
  assert(states.some(state => state.phase === 'verifying'));
  await updater.update(); await updater.check();
  assert.deepEqual(counts(), { downloads: 1, installations: 1 });
});
test('truncated and tampered downloads cannot reach the installer', async t => {
  for (const download of [body.subarray(0, 3), Buffer.alloc(body.length, 42), Buffer.concat([body, body])]) {
    const { updater, cache, counts } = await fixture(t, { download });
    await updater.update();
    assert.equal(updater.status().phase, 'error'); assert.equal(counts().installations, 0);
    await assert.rejects(access(join(cache, 'b'.repeat(40)+'-ILBI-1.2.0-linux-x64.tar.gz.part')));
  }
});
test('a failed install can retry a verified cache without downloading again', async t => {
  let attempt = 0;
  const { updater, counts } = await fixture(t, { install: () => { if (!attempt++) throw Error('Busy store'); } });
  await updater.update(); assert.equal(updater.status().phase, 'error');
  await updater.update(); assert.equal(updater.status().phase, 'installing');
  assert.deepEqual(counts(), { downloads: 1, installations: 2 });
});
test('offline checks preserve a known update and do not launch an installer', async t => {
  const { updater, counts } = await fixture(t);
  await updater.check(); updater.fetcher = async () => { throw Error('offline'); };
  await updater.check(); assert.equal(updater.status().phase, 'error');
  await updater.update(); assert.equal(updater.status().phase, 'error');
  assert.equal(counts().installations, 0);
});
test('a corrupt cached file is verified again and replaced before installation', async t => {
  const { updater, cache, counts } = await fixture(t);
  await writeFile(join(cache, 'b'.repeat(40)+'-ILBI-1.2.0-linux-x64.tar.gz'), 'tampered');
  await updater.update(); assert.deepEqual(counts(), { downloads: 1, installations: 1 });
});
