import AsyncStorage from '@react-native-async-storage/async-storage';
import type { InstalledApp, Release } from './releases';
const memory = new Map<string, string>(), locks = new Map<string, Promise<boolean>>();
export const updateDay = (now = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
export function claimMobileReminder(account: number, installed: InstalledApp, offered: Release, day = updateDay(), storage = AsyncStorage, canClaim = () => true): Promise<boolean> {
  const key = ['ilbi:update-reminder:mobile', account, installed.platform, installed.version, installed.buildNumber].join(':');
  const value = JSON.stringify({ day, offered: offered.version + ':' + offered.buildNumber });
  // Serialize concurrent mounts; a second read after the first claim sees the stored day.
  const previous = locks.get(key);
  const attempt = (async () => {
    if (previous) await previous;
    let saved; try { saved = await storage.getItem(key); } catch {}
    if (!canClaim()) return false;
    if (saved === value || memory.get(key) === value) return false;
    memory.set(key, value);
    try { await storage.setItem(key, value); } catch {}
    if (!canClaim()) {
      if (memory.get(key) === value) memory.delete(key);
      try { if (await storage.getItem(key) === value) await storage.removeItem(key); } catch {}
      return false;
    }
    return true;
  })();
  locks.set(key, attempt);
  void attempt.finally(() => { if (locks.get(key) === attempt) locks.delete(key); });
  return attempt;
}
