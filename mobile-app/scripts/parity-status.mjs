import { readFile, writeFile } from 'node:fs/promises';
const audit = new URL('../docs/DESKTOP_MOBILE_PARITY_AUDIT.md', import.meta.url);
const stateFile = new URL('../docs/parity-status.json', import.meta.url);
const text = await readFile(audit, 'utf8');
let state;
try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { principle: 'Implement → test → record evidence → advance. Never mark an unexecuted or failed check as passed.', records: {} }; }
for (const [, id, title] of text.matchAll(/^### (DMP-\d{3}) — (.+)$/gm)) state.records[id] ||= { title, status: 'OPEN', evidence: [], notes: '' };
const [id, status, evidence, notes] = process.argv.slice(2);
if (id) {
  if (!state.records[id]) throw Error('Unknown finding: ' + id);
  if (!['IN_PROGRESS', 'TESTED_CODE', 'VERIFIED_RUNTIME', 'EXTERNAL_GATE', 'OPEN'].includes(status)) throw Error('Invalid status');
  if (['TESTED_CODE', 'VERIFIED_RUNTIME'].includes(status) && !evidence) throw Error('Passing evidence is required');
  state.records[id] = { ...state.records[id], status, evidence: evidence ? [...state.records[id].evidence, evidence] : state.records[id].evidence, notes: notes || state.records[id].notes };
}
const rows = Object.entries(state.records);
const ledger = ['<!-- IMPLEMENTATION_LEDGER_START -->', '## Implementation ledger — live', '', '**Working principle: implement → test → record evidence → advance.** The audit below is the historical baseline; this ledger records subsequent implementation. `TESTED_CODE` means the named automated/code checks passed, not native or production acceptance. `VERIFIED_RUNTIME` states the actual runtime used. `EXTERNAL_GATE` requires the stated external runtime/service; it is not completed.', '', '| ID | Status | Latest evidence / remaining verification |', '| --- | --- | --- |', ...rows.map(([key, row]) => `| [${key}](#${key.toLowerCase()}) | ${row.status} | ${(row.evidence.at(-1) || row.notes || 'Pending').replaceAll('|', '\\|')} |`), '', '<!-- IMPLEMENTATION_LEDGER_END -->'].join('\n');
let updated;
if (text.includes('<!-- IMPLEMENTATION_LEDGER_START -->')) updated = text.replace(/<!-- IMPLEMENTATION_LEDGER_START -->[\s\S]*?<!-- IMPLEMENTATION_LEDGER_END -->/, ledger);
else updated = text.replace('## How to use this record', ledger + '\n\n## How to use this record');
await writeFile(stateFile, JSON.stringify(state, null, 2) + '\n');
await writeFile(audit, updated);
const counts = Object.fromEntries([...new Set(rows.map(([, row]) => row.status))].map(kind => [kind, rows.filter(([, row]) => row.status === kind).length]));
console.log(JSON.stringify(counts));
