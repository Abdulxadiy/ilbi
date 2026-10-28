import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchBrowser } from './browser/chrome.mjs';
const evidence = process.env.ILBI_ADJUSTMENT_EVIDENCE;
if (!evidence) throw Error('Set ILBI_ADJUSTMENT_EVIDENCE to an isolated evidence directory.');
await mkdir(evidence, { recursive: true });
const contract = JSON.parse(await readFile(new URL('../../../mobile-app/tests/contracts/debt-adjustments.json', import.meta.url), 'utf8'));
const modules = new Map(await Promise.all(['debtAdjustmentModel', 'debtAdjustmentJournal'].map(async name => ['/src/utils/' + name + '.js', await readFile(new URL('../src/utils/' + name + '.js', import.meta.url), 'utf8')])));
const server = createServer((request, response) => {
  if (modules.has(request.url)) { response.setHeader('Content-Type', 'text/javascript'); response.end(modules.get(request.url)); }
  else if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><link rel="icon" href="data:,"><title>Isolated journal contract test</title>'); }
  else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await launchBrowser();
try {
  await browser.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port });
  const result = await browser.evaluate(`(async () => {
    const fixture = ${JSON.stringify(contract)};
    const {createAdjustmentJournal} = await import('/src/utils/debtAdjustmentJournal.js');
    const source = {origin: location.origin, actorId: fixture.actor, tenantId: fixture.tenant};
    const payload = {...fixture.payload, branch_id: fixture.tenant, expected_quote: fixture.quote.expected_quote};
    const name = 'isolated-adjustment-' + crypto.randomUUID();
    const one = createAdjustmentJournal(name), two = createAdjustmentJournal(name);
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    let checks = 0;
    const check = (condition, label) => {checks++; if(!condition) throw Error(label);};
    const reject = async (work, label) => {let failed = false; try {await work();} catch {failed=true;} check(failed,label);};
    const concurrent = await Promise.allSettled([one.prepare(source,a,fixture.customer,payload),two.prepare(source,b,fixture.customer,payload)]);
    check(concurrent.filter(row=>row.status==='fulfilled').length===1,'one winner across two real IDB connections');
    const first = concurrent.find(row=>row.status==='fulfilled').value;
    check((await two.pending(source)).key===first.key,'original key persisted');
    await reject(()=>one.prepare(source,first.operation,fixture.customer,{...payload,amount:'2.00'}),'pending body immutable');
    const receipt = {...fixture.result,adjustment_operation:{...fixture.result.adjustment_operation,idempotency_key:first.key}};
    await reject(()=>one.finish(source,first.operation,first.key,'confirmed',{...receipt,recorded_by:1}),'foreign acknowledgement rejected');
    check((await two.pending(source)).key===first.key,'failed ack retains pending');
    for(const changed of [{actorId:source.actorId+1},{tenantId:source.tenantId+1},{origin:'https://other.invalid'}]) {
      check(await two.pending({...source,...changed})===null,'scope isolation');
      await reject(()=>two.finish({...source,...changed},first.operation,first.key,'confirmed',receipt),'scope cannot acknowledge');
    }
    await two.finish(source,first.operation,first.key,'confirmed',receipt);
    check(await one.pending(source)===null,'confirmation releases active lock');
    const again = await one.prepare(source,first.operation,fixture.customer,payload);
    check(again.status==='confirmed'&&again.key===first.key,'completed callback retains original result/key');
    await reject(()=>one.prepare(source,first.operation,fixture.customer,{...payload,amount:'2.00'}),'completed body immutable');
    const next = await one.prepare(source,crypto.randomUUID(),fixture.customer,payload);
    await one.finish(source,next.operation,next.key,'rejected');
    check(await two.pending(source)===null,'fresh definitive rejection releases lock');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(){throw new DOMException('Controlled quota failure','QuotaExceededError');};
    try {await reject(()=>one.prepare(source,crypto.randomUUID(),fixture.customer,payload),'storage failure blocks new intent');}
    finally {IDBObjectStore.prototype.put=put;}
    check(await two.pending(source)===null,'failed transaction left no partial active write');
    const saved = await one.prepare(source,crypto.randomUUID(),fixture.customer,payload);
    const rawDb = await new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const active = 'adjustment:'+JSON.stringify([source.origin,source.actorId,source.tenantId]);
    await new Promise((resolve,reject)=>{const tx=rawDb.transaction('records','readwrite');tx.objectStore('records').put(JSON.stringify({...saved,source:{...source,actorId:source.actorId+1}}),active);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    await reject(()=>one.pending(source),'corrupted persisted scope fails closed');
    const retained = await new Promise((resolve,reject)=>{const request=rawDb.transaction('records','readonly').objectStore('records').get(active);request.onsuccess=()=>resolve(Boolean(request.result));request.onerror=()=>reject(request.error);});
    check(retained,'corruption does not silently delete the record'); rawDb.close();
    return {passed:true,runtime:'Isolated Chrome; actual IndexedDB transactions across two database connections; no API/provider/native calls',checks,scopeIsolation:true,atomicPrepare:true,immutablePendingAndConfirmed:true,storageFailureRollback:true,corruptionPreserved:true};
  })()`);
  assert.equal(result.passed, true); assert.deepEqual(browser.errors, []);
  await writeFile(resolve(evidence, 'journal-browser.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Adjustment journal checks passed with actual IndexedDB.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
