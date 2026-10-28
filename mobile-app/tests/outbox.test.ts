import AsyncStorage from '@react-native-async-storage/async-storage';
import { outboxManager } from '../src/features/sync/outbox';

describe('Legacy outbox isolation guard', () => {
  const key = '@ilbi_outbox_v1';
  const legacy = [{ id: 'old-sale', tenantId: 'other-store', status: 'processing', payload: { amount: 160000 } }];
  beforeEach(async () => { await AsyncStorage.clear(); await AsyncStorage.setItem(key, JSON.stringify(legacy)); });
  test('does not transmit or delete records with no account identity', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    expect(await outboxManager.processQueue()).toEqual({ processed: 0, failed: 0, blocked: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await outboxManager.getQueue()).toEqual(legacy);
    fetchSpy.mockRestore();
  });
  test('cache cleanup cannot erase a pending financial operation', async () => {
    await expect(outboxManager.clear()).rejects.toThrow();
    await expect(outboxManager.remove('old-sale')).rejects.toThrow();
    expect(await outboxManager.getQueue()).toEqual(legacy);
  });
  test('new financial operations cannot enter the unsafe legacy queue', async () => {
    await expect(outboxManager.enqueue('sale', '/sales/', 'POST', {}, 'new-store')).rejects.toThrow();
    expect(await outboxManager.getQueue()).toEqual(legacy);
  });
  test('corrupt persisted data is reported and preserved', async () => {
    await AsyncStorage.setItem(key, 'corrupt');
    await expect(outboxManager.getQueue()).rejects.toThrow();
    expect(await AsyncStorage.getItem(key)).toBe('corrupt');
  });
});
