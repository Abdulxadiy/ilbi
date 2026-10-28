import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
const memoryStore = new Map<string, string>();
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    return Platform.OS === 'web' ? memoryStore.get(key) || null : SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') memoryStore.set(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  async removeItem(key: string): Promise<void> {
    memoryStore.delete(key);
    if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(key);
  },
};
