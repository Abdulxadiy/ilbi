import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { isDesignPreview } from '../../dev/preview';
import { previewReleaseFeed } from '../../dev/previewReleases';
import { useAuth } from '../auth/AuthContext';
import { installedApp } from './installed';
import { fetchReleaseFeed, parseReleaseFeed, releaseURL, updateCandidate, type InstalledApp, type Release, type ReleaseFeed } from './releases';
import { claimMobileReminder, updateDay } from './reminder';

type Updates = { feed: ReleaseFeed | null; installed: InstalledApp | null; candidate: Release | null; loading: boolean; error: string; checkedAt: number | null; refresh: () => Promise<void>; reminder: boolean; dismiss: () => void; open: (release: Release) => Promise<void>; opening: boolean; actionMessage: string };
const Context = createContext<Updates | null>(null);
const cacheKey = 'ilbi:official-releases:v1';
const serialized = (feed: ReleaseFeed) => JSON.stringify({ schema: 1, windows: feed.windows, linux: feed.linux, mobile: { android: feed.android, ios: feed.ios } });

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth(), account = user?.id || null;
  const installed = useMemo(() => installedApp(), []);
  const [feed, setFeed] = useState<ReleaseFeed | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive'), [day, setDay] = useState(updateDay);
  const [notice, setNotice] = useState(''), [dismissed, setDismissed] = useState(''), [opening, setOpening] = useState(false), [actionMessage, setActionMessage] = useState('');
  const mounted = useRef(true), networkLoaded = useRef(false), inFlight = useRef<Promise<void> | null>(null), abort = useRef<AbortController | null>(null), openLock = useRef(false);
  const candidate = useMemo(() => feed ? updateCandidate(feed, installed) : null, [feed, installed]);
  const identity = [account, installed?.platform, installed?.version, installed?.buildNumber, candidate?.version, candidate?.buildNumber, day].join('|');
  const scope = useRef({ account, identity, foreground });
  useLayoutEffect(() => { scope.current = { account, identity, foreground }; }, [account, identity, foreground]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => { setForeground(state === 'active'); setDay(updateDay()); });
    const clock = setInterval(() => { if (AppState.currentState === 'active') setDay(updateDay()); }, 60000);
    if (!isDesignPreview) void AsyncStorage.getItem(cacheKey).then(value => { if (value && mounted.current && !networkLoaded.current) { try { setFeed(parseReleaseFeed(JSON.parse(value))); } catch {} } }).catch(() => {});
    return () => { mounted.current = false; abort.current?.abort(); subscription.remove(); clearInterval(clock); };
  }, []);
  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const controller = new AbortController(); abort.current = controller;
    const pending = (async () => {
      setLoading(true); setError('');
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const result = isDesignPreview ? previewReleaseFeed() : await fetchReleaseFeed(controller.signal);
        if (!mounted.current || controller.signal.aborted) return;
        networkLoaded.current = true; setFeed(result); setCheckedAt(Date.now());
        if (!isDesignPreview) await AsyncStorage.setItem(cacheKey, serialized(result)).catch(() => {});
      } catch (failure: any) { if (mounted.current) setError(controller.signal.aborted ? 'Tekshirish vaqti tugadi. Internetni tekshirib, qayta urining.' : failure.message || 'Yangilanish tekshirilmadi.'); }
      finally { clearTimeout(timeout); if (mounted.current) setLoading(false); }
    })();
    inFlight.current = pending;
    void pending.finally(() => { if (inFlight.current === pending) inFlight.current = null; });
    return pending;
  }, []);
  useEffect(() => {
    if (!account || !foreground || !installed) return;
    let alive = true;
    void Promise.resolve().then(() => { if (alive) return refresh(); });
    const timer = setInterval(() => { void refresh(); }, 15 * 60000);
    return () => { alive = false; clearInterval(timer); };
  }, [account, foreground, installed, refresh]);
  useEffect(() => {
    if (!account || !installed || !candidate || !foreground) return;
    let alive = true;
    const valid = () => alive && mounted.current && scope.current.identity === identity && scope.current.account === account && scope.current.foreground;
    void claimMobileReminder(account, installed, candidate, day, AsyncStorage, valid).then(show => { if (show && valid()) setNotice(identity); });
    return () => { alive = false; };
  }, [account, candidate, day, foreground, identity, installed]);
  const open = useCallback(async (release: Release) => {
    if (openLock.current) return;
    openLock.current = true; setOpening(true); setActionMessage('');
    try {
      if (isDesignPreview) throw Error('Dizayn rejimida haqiqiy paket yuklanmaydi.');
      const validated = releaseURL(release.url, release.platform);
      await Linking.openURL(validated.url);
      if (mounted.current) setActionMessage(release.kind === 'store' ? 'Ilovalar do‘konida yangilashni tugating.' : 'Yuklab olish brauzerda ochildi. O‘rnatishni qurilmangizda tugating.');
    } catch (failure: any) { if (mounted.current) setActionMessage(failure.message || 'Yuklab olish oynasi ochilmadi.'); }
    finally { openLock.current = false; if (mounted.current) setOpening(false); }
  }, []);
  return <Context.Provider value={{ feed, installed, candidate, loading, error, checkedAt, refresh, reminder: Boolean(account && foreground && notice === identity && dismissed !== identity), dismiss: () => setDismissed(identity), open, opening, actionMessage }}>{children}</Context.Provider>;
}
export function useUpdates() { const value = useContext(Context); if (!value) throw Error('UpdatesProvider is required.'); return value; }
