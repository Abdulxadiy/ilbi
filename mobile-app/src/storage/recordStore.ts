import * as SQLite from 'expo-sqlite';
import type { RecordStore } from './recordTypes';

let connection: Promise<SQLite.SQLiteDatabase> | null = null;
const database = () => connection ||= (async () => {
  const db = await SQLite.openDatabaseAsync('ilbi-mobile-records.db');
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');
  return db;
})();
let writes: Promise<unknown> = Promise.resolve();
export const recordStore: RecordStore = {
  async transaction<T>(keys: string[], mutate: import('./recordTypes').RecordMutation<T>) {
    const pending = writes.catch(() => {}).then(async () => {
      const db = await database(); let result!: T;
      await db.withExclusiveTransactionAsync(async tx => {
        const records: Record<string, any> = {};
        for (const key of new Set(keys)) {
          const row = await tx.getFirstAsync<{ value: string }>('SELECT value FROM records WHERE key = ?', key);
          records[key] = row ? JSON.parse(row.value) : null;
        }
        const mutation = mutate(records); result = mutation.result;
        for (const [key, value] of Object.entries(mutation.updates)) {
          if (value === null) await tx.runAsync('DELETE FROM records WHERE key = ?', key);
          else await tx.runAsync('INSERT INTO records (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
        }
      });
      return result;
    });
    writes = pending; return pending;
  },
  async read<T>(key: string) {
    const row = await (await database()).getFirstAsync<{ value: string }>('SELECT value FROM records WHERE key = ?', key);
    return row ? JSON.parse(row.value) as T : null;
  },
  async update<T>(key: string, updater: (previous: T | null) => T | null) {
    const pending = writes.catch(() => {}).then(async () => {
      const db = await database(); let result: T | null = null;
      await db.withExclusiveTransactionAsync(async tx => {
        const row = await tx.getFirstAsync<{ value: string }>('SELECT value FROM records WHERE key = ?', key);
        result = updater(row ? JSON.parse(row.value) : null);
        if (result === null) await tx.runAsync('DELETE FROM records WHERE key = ?', key);
        else await tx.runAsync('INSERT INTO records (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(result));
      });
      return result;
    });
    writes = pending; return pending;
  },
  async entries<T>(prefix = '') {
    const rows = await (await database()).getAllAsync<{ key: string; value: string }>('SELECT key, value FROM records WHERE substr(key, 1, ?) = ? ORDER BY key', prefix.length, prefix);
    return rows.map(row => [row.key, JSON.parse(row.value) as T]);
  },
};
