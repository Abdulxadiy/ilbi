export type RecordMutation<T> = (records: Record<string, any>) => { updates: Record<string, any>; result: T };
export interface RecordStore {
  transaction<T>(keys: string[], mutate: RecordMutation<T>): Promise<T>;
  read<T>(key: string): Promise<T | null>;
  update<T>(key: string, updater: (previous: T | null) => T | null): Promise<T | null>;
  entries<T>(prefix?: string): Promise<[string, T][]>;
}
