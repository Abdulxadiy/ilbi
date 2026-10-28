/* Reviewed local mitigation; retain upstream package identity and audit visibility. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(path.dirname(module.filename), '..');
const manifest = require('../vendor/deepmerge-4.3.1-prototype-guard.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function patchDeepmerge(packageRoot) {
  const info = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (info.name !== manifest.package || info.version !== manifest.version) throw Error('Review the deepmerge guard against this new package version before installing.');
  const changes = manifest.files.map(file => {
    const filename = path.join(packageRoot, file.path), current = fs.readFileSync(filename), digest = hash(current);
    if (digest === file.patched_sha256) return null;
    if (digest !== file.original_sha256) throw Error('Unrecognized deepmerge source; prototype guard installation stopped.');
    const before = 'return propertyIsOnObject(target, key)';
    const indentation = file.path.endsWith('umd.js') ? '\t\t' : '\t';
    const after = "if (key === '__proto__' || key === 'constructor' || key === 'prototype') return true\n" + indentation + before;
    const text = current.toString('utf8');
    if (text.split(before).length !== 2) throw Error('Unexpected deepmerge guard boundary.');
    const patched = text.replace(before, after);
    if (hash(patched) !== file.patched_sha256) throw Error('Deepmerge patch verification failed.');
    return { filename, patched };
  });
  // Verify every input before changing any file. A partial interrupted install is
  // safe to resume because both exact original and patched states are recognized.
  for (const change of changes) if (change) fs.writeFileSync(change.filename, change.patched);
  return changes.filter(Boolean).length;
}
if (require.main === module) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages).filter(([name]) => /(^|\/)node_modules\/deepmerge$/.test(name));
  if (!entries.length) throw Error('Locked deepmerge dependency was not found; review the toolchain mitigation.');
  let changed = 0;
  for (const [name] of entries) changed += patchDeepmerge(path.join(root, name));
  console.log(`Verified deepmerge prototype guard (${entries.length} package, ${changed} files updated). Upstream version/audit identity preserved.`);
}
module.exports = { patchDeepmerge };
