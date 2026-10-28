import type { RecordStore } from './recordTypes';

/** Each read/modify/write uses one readwrite transaction, including across browser tabs. */
export function createRecordStore(name = 'ilbi-mobile-v1'): RecordStore {
  let opening: Promise<IDBDatabase> | null = null;
  const database = () => opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onerror = () => { opening = null; reject(request.error); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = null; }; resolve(request.result); };
  });
  return {
    async transaction<T>(keys: string[], mutate: import('./recordTypes').RecordMutation<T>) {
      const db = await database();
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records');
        const unique = [...new Set(keys)], records: Record<string, any> = {};
        let remaining = unique.length, result!: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error || Error('Saqlash tranzaksiyasi bajarilmadi.'));
        const apply = () => {
          try {
            const mutation = mutate(records); result = mutation.result;
            for (const [key, value] of Object.entries(mutation.updates)) {
              if (value === null) store.delete(key); else store.put(JSON.stringify(value), key);
            }
          } catch (error) { tx.abort(); reject(error); }
        };
        if (!remaining) apply();
        for (const key of unique) {
          const request = store.get(key);
          request.onsuccess = () => {
            try { records[key] = request.result == null ? null : JSON.parse(request.result); if (--remaining === 0) apply(); }
            catch (error) { tx.abort(); reject(error); }
          };
        }
      });
    },
    async read<T>(key: string) {
      const db = await database();
      return new Promise<T | null>((resolve, reject) => {
        const request = db.transaction('records', 'readonly').objectStore('records').get(key);
        request.onsuccess = () => { try { resolve(request.result == null ? null : JSON.parse(request.result)); } catch (error) { reject(error); } };
        request.onerror = () => reject(request.error);
      });
    },
    async update<T>(key: string, updater: (previous: T | null) => T | null) {
      const db = await database();
      return new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction('records', 'readwrite'), store = tx.objectStore('records');
        let result: T | null = null;
        tx.oncomplete = () => resolve(result);
        tx.onerror = tx.onabort = () => reject(tx.error || Error('Saqlash bajarilmadi. Ma’lumot o‘zgartirilmadi.'));
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            result = updater(request.result == null ? null : JSON.parse(request.result));
            if (result === null) store.delete(key); else store.put(JSON.stringify(result), key);
          } catch (error) { tx.abort(); reject(error); }
        };
      });
    },
    async entries<T>(prefix = '') {
      const db = await database();
      return new Promise<[string, T][]>((resolve, reject) => {
        const rows: [string, T][] = [];
        const tx = db.transaction('records', 'readonly');
        const cursor = tx.objectStore('records').openCursor();
        cursor.onsuccess = () => {
          try {
            const row = cursor.result;
            if (!row) return;
            if (String(row.key).startsWith(prefix)) rows.push([String(row.key), JSON.parse(row.value)]);
            row.continue();
          } catch (error) { tx.abort(); reject(error); }
        };
        tx.oncomplete = () => resolve(rows);
        tx.onerror = tx.onabort = () => reject(tx.error || Error('Saqlangan amallar o‘qilmadi.'));
      });
    },
  };
}
export const recordStore = createRecordStore();
