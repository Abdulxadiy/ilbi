import { adjustmentInput, adjustmentReceipt } from './debtAdjustmentModel.js';
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
export class PendingAdjustmentError extends Error {
  constructor(record) { super('Oldingi qaytarish natijasini avval tekshiring. Asl yozuv saqlanadi.'); this.record = record; }
}
function sourceKey(source) {
  if (!source || typeof source.origin !== 'string' || !/^https?:\/\/[^/]+$/.test(source.origin) || !positive(source.actorId) || !positive(source.tenantId)) throw Error('Qaytarishning server, hisob yoki do‘koni tasdiqlanmadi.');
  return 'adjustment:' + JSON.stringify([source.origin, source.actorId, source.tenantId]);
}
function checked(record, source) {
  if (!record) return null;
  if (record.version !== 1 || !uuid(record.operation) || !uuid(record.key) || !positive(record.customerId) || !['pending', 'confirmed', 'rejected'].includes(record.status) || sourceKey(record.source) !== sourceKey(source) || !Number.isFinite(Date.parse(record.createdAt))) throw Error('Qaytarish jurnali buzilgan yoki boshqa manbaga tegishli. Yozuv saqlanadi.');
  const payload = adjustmentInput(record.payload);
  if (!payload.expected_quote || JSON.stringify(payload) !== JSON.stringify(record.payload)) throw Error('Qaytarish jurnalining asl mazmuni tasdiqlanmadi.');
  return { ...record, payload };
}
/** Real IndexedDB readwrite transactions serialize prepare/finish across browser tabs. */
export function createAdjustmentJournal(name = 'ilbi-financial-adjustments-v1') {
  let opening;
  const database = () => opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onerror = () => { opening = null; reject(request.error || Error('Amallar jurnali ochilmadi.')); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = null; }; resolve(request.result); };
  });
  const transaction = async (keys, mutate) => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records'), records = {};
      let remaining = keys.length, result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || Error('Asl qaytarish yozuvi saqlanmadi. Yangi amal yuborilmadi.'));
      for (const key of keys) {
        const read = store.get(key);
        read.onsuccess = () => {
          try {
            records[key] = read.result == null ? null : JSON.parse(read.result);
            if (--remaining) return;
            const mutation = mutate(records); result = mutation.result;
            for (const [key, value] of Object.entries(mutation.updates)) { if (value === null) store.delete(key); else store.put(JSON.stringify(value), key); }
          } catch (error) { tx.abort(); reject(error); }
        };
      }
    });
  };
  return {
    async pending(source) {
      const key = sourceKey(source);
      return transaction([key], records => {
        const row = checked(records[key], source);
        if (row && row.status !== 'pending') throw Error('Faol qaytarish jurnali tasdiqlanmadi.');
        return { updates: {}, result: row };
      });
    },
    async prepare(source, operation, customerId, raw) {
      const key = sourceKey(source), own = key + ':' + operation, payload = adjustmentInput(raw);
      if (!uuid(operation) || !positive(customerId) || !payload.expected_quote) throw Error('Avval qaytarish hisobini tasdiqlang.');
      return transaction([key, own], records => {
        const previous = checked(records[own], source), active = checked(records[key], source);
        if (active && active.operation !== operation) throw new PendingAdjustmentError(active);
        if (previous && previous.status !== 'rejected') {
          if (previous.customerId !== customerId || JSON.stringify(previous.payload) !== JSON.stringify(payload)) throw new PendingAdjustmentError(previous);
          return { updates: {}, result: previous };
        }
        if (active && (!previous || active.key !== previous.key)) throw new PendingAdjustmentError(active);
        const record = { version: 1, source: { ...source }, operation, customerId, key: crypto.randomUUID(), payload, status: 'pending', createdAt: new Date().toISOString() };
        return { updates: { [key]: record, [own]: record, ...(previous ? { [own + ':history:' + previous.key]: previous } : {}) }, result: record };
      });
    },
    async finish(source, operation, expectedKey, status, value) {
      if (!uuid(operation) || !uuid(expectedKey) || !['confirmed', 'rejected'].includes(status)) throw Error('Qaytarishning asl tasdiqi topilmadi.');
      const key = sourceKey(source), own = key + ':' + operation;
      return transaction([key, own], records => {
        const record = checked(records[own], source), active = checked(records[key], source);
        if (!record || record.key !== expectedKey || status === 'rejected' && record.status === 'confirmed') throw new PendingAdjustmentError(record);
        const result = status === 'confirmed' ? adjustmentReceipt(value, { actorId: source.actorId, tenantId: source.tenantId, customerId: record.customerId, branchId: record.payload.branch_id }, record.payload, expectedKey) : record.result;
        const next = { ...record, status, ...(result ? { result } : {}) };
        return { updates: { [own]: next, ...(active?.key === expectedKey ? { [key]: null } : {}) }, result: next };
      });
    },
  };
}
