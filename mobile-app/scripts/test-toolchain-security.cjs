/* Actual installed consumers: keep this test with the reviewed Zod 4 override. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { z } = require('zod');
const cliRoot = path.dirname(require.resolve('@expo/cli/package.json'));
const cliRequire = createRequire(path.join(cliRoot, 'package.json'));
const { PluginSchema, DevToolsPluginOutputSchema } = require(path.join(cliRoot, 'build/src/start/server/DevToolsPlugin.schema.js'));
const { createMCPDevToolsExtensionSchema } = require(path.join(cliRoot, 'build/src/start/server/createMCPDevToolsExtensionSchema.js'));
const { DevToolsPluginCliExtensionResults } = require(path.join(cliRoot, 'build/src/start/server/DevToolsPluginCliExtensionResults.js'));

test('CLI and React lint resolve the reviewed fixed Zod, without an older nested copy', () => {
  assert.equal(require('zod/package.json').version, '4.6.7');
  assert.equal(cliRequire('zod/package.json').version, '4.6.7');
  const hooksRequire = createRequire(require.resolve('eslint-plugin-react-hooks'));
  assert.equal(hooksRequire('zod/package.json').version, '4.6.7');
});
test('oversized bounded sync/async arrays, exact lengths and sets stop before visiting elements', async () => {
  const invalid = Array.from({ length: 1000 }, (_, index) => index);
  for (const schema of [z.array(z.string()).max(2), z.array(z.string()).length(2)]) {
    const sync = schema.safeParse(invalid), asyncResult = await schema.safeParseAsync(invalid);
    for (const result of [sync, asyncResult]) {
      assert.equal(result.success, false); assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0].code, 'too_big');
    }
  }
  const result = z.set(z.string()).max(2).safeParse(new Set(invalid));
  assert.equal(result.success, false); assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, 'too_big');
});
const plugin = { packageName: 'synthetic-devtools', packageRoot: '/synthetic-only', bannerTitle: false,
  cliExtensions: { description: 'Synthetic compatibility check', entryPoint: 'index.js', commands: [
    { name: 'inspect', title: 'Inspect', environments: ['cli', 'mcp'], parameters: [
      { name: 'label', type: 'text' }, { name: 'limit', type: 'number' }, { name: 'confirm', type: 'confirm' },
    ] },
  ] } };
test('actual Expo plugin schema preserves valid, stripped, readonly and invalid inputs', () => {
  const parsed = PluginSchema.parse({ ...plugin, extra: 'stripped' });
  assert.equal(parsed.packageName, plugin.packageName); assert.equal(parsed.bannerTitle, false);
  assert.equal('extra' in parsed, false); assert.ok(Object.isFrozen(parsed.cliExtensions.commands[0].environments));
  for (const change of [{ packageName: '' }, { packageRoot: null }, { bannerTitle: '' }, { cliExtensions: { ...plugin.cliExtensions, commands: [] } }]) {
    const result = PluginSchema.safeParse({ ...plugin, ...change });
    assert.equal(result.success, false); assert.ok(result.error.issues.length > 0);
  }
});
test('actual Expo MCP generator keeps command enums, primitive parameters and strict unknown-field rejection', () => {
  const schema = createMCPDevToolsExtensionSchema(PluginSchema.parse(plugin));
  const valid = { command: 'inspect', label: 'synthetic', limit: 2, confirm: true };
  assert.deepEqual(schema.parse(valid), valid);
  for (const change of [{ command: 'unknown' }, { limit: '2' }, { confirm: 'yes' }, { extra: true }]) assert.equal(schema.safeParse({ ...valid, ...change }).success, false);
  assert.throws(() => createMCPDevToolsExtensionSchema({ packageName: 'empty' }), /no commands/);
});
test('actual Expo output parser keeps text/image/audio, invalid JSON, issue messages and exit handling', () => {
  const result = [
    { type: 'text', text: 'synthetic', level: 'info' },
    { type: 'image', url: 'https://example.invalid/image.png' },
    { type: 'audio', url: 'https://example.invalid/audio.mp3', text: 'synthetic' },
  ];
  assert.deepEqual(DevToolsPluginOutputSchema.parse(result), result);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'image', url: 'invalid' }]).success, false);
  const events = [], output = new DevToolsPluginCliExtensionResults(value => events.push(value));
  output.append(JSON.stringify(result)); output.append('plain\ntext'); output.append(JSON.stringify([{ type: 'unknown' }])); output.exit(2);
  assert.deepEqual(output.getOutput().slice(0, 3), result);
  assert.ok(output.getOutput().some(line => line.level === 'error' && line.text.startsWith('Invalid JSON:')));
  assert.ok(output.getOutput().some(line => line.text === 'Process exited with code 2'));
  assert.equal(output.isTruncated(), false); assert.equal(events.length, 4);
});
test('the installed lint error formatter understands fixed-version validation errors', () => {
  const result = z.object({ count: z.number() }).safeParse({ count: 'wrong' });
  assert.equal(result.success, false);
  const { fromZodError } = require('zod-validation-error');
  assert.match(fromZodError(result.error).message, /count/);
});
test('actual CJS and UMD merges cannot poison a returned object with a null-prototype target', () => {
  const mergeRoot = path.dirname(require.resolve('deepmerge/package.json'));
  for (const merge of [require('deepmerge'), require(path.join(mergeRoot, 'dist/umd.js'))]) {
    const unsafe = JSON.parse('{"__proto__":{"syntheticInherited":"unexpected"},"constructor":{"prototype":{"syntheticInherited":"unexpected"}},"prototype":{"syntheticInherited":"unexpected"},"safe":{"value":2}}');
    for (const target of [{}, Object.create(null), { nested: Object.create(null) }]) {
      const result = merge(target, unsafe);
      assert.equal(result.syntheticInherited, undefined);
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      for (const name of ['__proto__', 'constructor', 'prototype']) assert.equal(Object.hasOwn(result, name), false);
      assert.deepEqual(result.safe, { value: 2 });
    }
    const result = merge({ nested: Object.create(null) }, { nested: unsafe });
    assert.equal(result.nested.syntheticInherited, undefined);
    assert.equal(({}).syntheticInherited, undefined);
  }
});
test('installed merge still clones nested configs, joins arrays, supports custom arrays, symbols and merge.all', () => {
  const merge = require('deepmerge'), symbol = Symbol('synthetic');
  const input = { nested: { one: 1 }, list: [1], [symbol]: 'kept' };
  const result = merge(input, { nested: { two: 2 }, list: [2] });
  assert.deepEqual(result.nested, { one: 1, two: 2 }); assert.notEqual(result.nested, input.nested);
  assert.deepEqual(result.list, [1, 2]); assert.equal(result[symbol], 'kept');
  assert.deepEqual(input.list, [1]);
  assert.deepEqual(merge({ list: [1] }, { list: [2] }, { arrayMerge: (_target, source) => source }).list, [2]);
  assert.deepEqual(merge.all([{ a: 1 }, { b: 2 }]), { a: 1, b: 2 });
});
test('vendor guard verifies every shipped entry point, is idempotent and fails closed on changed source', () => {
  const { patchDeepmerge } = require('./patch-toolchain.cjs');
  const manifest = require('../vendor/deepmerge-4.3.1-prototype-guard.json');
  const mergeRoot = path.dirname(require.resolve('deepmerge/package.json'));
  assert.equal(require('deepmerge/package.json').version, '4.3.1');
  for (const file of manifest.files) {
    const content = fs.readFileSync(path.join(mergeRoot, file.path));
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), file.patched_sha256);
  }
  assert.equal(patchDeepmerge(mergeRoot), 0);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ilbi-deepmerge-guard-'));
  try {
    fs.cpSync(mergeRoot, sandbox, { recursive: true });
    const file = path.join(sandbox, 'dist/cjs.js'), other = fs.readFileSync(path.join(sandbox, 'dist/umd.js'));
    fs.appendFileSync(file, '\n// Synthetic unexpected edit\n');
    assert.throws(() => patchDeepmerge(sandbox), /Unrecognized deepmerge source/);
    assert.deepEqual(fs.readFileSync(path.join(sandbox, 'dist/umd.js')), other);
  } finally { fs.rmSync(sandbox, { recursive: true, force: true }); }
});
