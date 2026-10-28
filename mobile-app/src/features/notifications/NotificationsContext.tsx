import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { useAuth } from '../auth/AuthContext';
import { inboxUrl, mergeInbox, parseInboxPage, type InboxNotification } from './inbox';

type State = { key: string; rows: InboxNotification[]; unreadCount: number; cursor: number | null; loading: boolean; loadingMore: boolean; error: string; checkedAt: number | null };
type Inbox = Omit<State, 'key' | 'cursor'> & { enabled: boolean; hasMore: boolean; busy: string; refresh: () => Promise<void>; loadMore: () => Promise<void>; fetchOne: (id: number) => Promise<InboxNotification | null>; markRead: (id: number) => Promise<boolean>; markAllRead: () => Promise<boolean>; remove: (id: number) => Promise<boolean>; clear: () => Promise<boolean> };
const empty = (key = ''): State => ({ key, rows: [], unreadCount: 0, cursor: null, loading: false, loadingMore: false, error: '', checkedAt: null });
const noop = async () => {};
const Context = createContext<Inbox>({ ...empty(), enabled: false, hasMore: false, busy: '', refresh: noop, loadMore: noop, fetchOne: async () => null, markRead: async () => false, markAllRead: async () => false, remove: async () => false, clear: async () => false });

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, activeTenant } = useAuth();
  const member = user?.tenants.find(row => row.id === activeTenant?.id);
  const enabled = Boolean(user?.terms_accepted && (user.role === 'platform_admin' || member));
  const key = [getServerScope(), user?.id, activeTenant?.id, enabled].join('|');
  const [state, setState] = useState<State>(empty), [busy, setBusy] = useState('');
  const [foreground, setForeground] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const latest = useRef(key), sequence = useRef(0), controller = useRef<AbortController | null>(null), pending = useRef<Promise<void> | null>(null), action = useRef('');
  const blockedUntil = useRef(0);
  const stateRef = useRef(state);
  useLayoutEffect(() => { latest.current = key; stateRef.current = state; }, [key, state]);
  const cancel = useCallback(() => { sequence.current++; controller.current?.abort(); pending.current = null; }, []);

  const load = useCallback((mode: 'refresh' | 'poll' | 'older'): Promise<void> => {
    if (!enabled || !foreground || !user || action.current || Date.now() < blockedUntil.current) return Promise.resolve();
    if (pending.current) return pending.current;
    const previous = stateRef.current.key === key ? stateRef.current : empty(key);
    if (mode === 'older' && previous.cursor === null) return Promise.resolve();
    const current = ++sequence.current, abort = new AbortController(), scope = captureAuthScope(); controller.current = abort;
    const valid = () => latest.current === key && sequence.current === current && !abort.signal.aborted;
    const operation = (async () => {
      setState(old => ({ ...(old.key === key ? old : empty(key)), loading: mode !== 'older' && (mode === 'refresh' || !previous.checkedAt), loadingMore: mode === 'older', error: '' }));
      try {
        const result = parseInboxPage(await request(inboxUrl(mode === 'older' ? previous.cursor : null), { signal: abort.signal }), user.id);
        if (!valid()) return;
        assertAuthScope(scope);
        setState(old => ({ key, rows: mode === 'refresh' ? result.rows : mergeInbox(old.key === key ? old.rows : [], result.rows), unreadCount: result.unreadCount,
          cursor: mode === 'poll' && previous.checkedAt ? old.cursor : result.cursor, loading: false, loadingMore: false, error: '', checkedAt: Date.now() }));
      } catch (error: any) { if (valid()) { blockedUntil.current = Date.now() + Math.max(0, Number(error.retryAfterMs) || 0); setState(old => ({ ...old, key, loading: false, loadingMore: false, error: error.message || 'Bildirishnomalar yuklanmadi.' })); } }
    })();
    pending.current = operation;
    void operation.finally(() => { if (pending.current === operation) pending.current = null; });
    return operation;
  }, [enabled, foreground, key, user]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => { if (value !== 'active') cancel(); setForeground(value === 'active'); });
    return () => { subscription.remove(); cancel(); };
  }, [cancel]);
  useEffect(() => { action.current = ''; blockedUntil.current = 0; setBusy(''); }, [key]);
  useEffect(() => {
    if (!enabled || !foreground) return;
    let alive = true;
    void Promise.resolve().then(() => { if (alive) return load('poll'); });
    const timer = setInterval(() => { void load('poll'); }, 30000);
    return () => { alive = false; clearInterval(timer); cancel(); };
  }, [cancel, enabled, foreground, key, load]);

  const mutate = useCallback(async (kind: 'read' | 'read-all' | 'delete' | 'clear', id?: number) => {
    if (!enabled || action.current || latest.current !== key) return false;
    if (id !== undefined && !stateRef.current.rows.some(row => row.id === id)) return false;
    const lock = kind + ':' + (id || 'all'); action.current = lock; setBusy(lock); cancel();
    const scope = captureAuthScope();
    try {
      const endpoint = kind === 'read' ? `/sales/notifications/${id}/read/` : kind === 'read-all' ? '/sales/notifications/read-all/' : kind === 'delete' ? `/sales/notifications/${id}/` : '/sales/notifications/';
      await request(endpoint, { method: ['read', 'read-all'].includes(kind) ? 'POST' : 'DELETE' });
      assertAuthScope(scope);
      if (latest.current !== key) return false;
      setState(old => {
        if (old.key !== key) return old;
        const unread = old.rows.find(row => row.id === id)?.is_read === false;
        return { ...old, rows: kind === 'clear' ? [] : kind === 'delete' ? old.rows.filter(row => row.id !== id) : old.rows.map(row => kind === 'read-all' || row.id === id ? { ...row, is_read: true } : row),
          unreadCount: ['clear', 'read-all'].includes(kind) ? 0 : Math.max(0, old.unreadCount - (unread ? 1 : 0)), cursor: kind === 'clear' ? null : old.cursor, error: '', loading: false, loadingMore: false };
      });
      return true;
    } catch (error: any) {
      if (latest.current === key) setState(old => ({ ...old, key, loading: false, loadingMore: false, error: error.message || 'Amal bajarilmadi. Qayta urining.' }));
      return false;
    } finally { if (action.current === lock && latest.current === key) { action.current = ''; setBusy(''); } }
  }, [cancel, enabled, key]);
  const fetchOne = useCallback(async (id: number) => {
    if (!enabled || !user || !Number.isSafeInteger(id) || id < 1) return null;
    const scope = captureAuthScope();
    try {
      const row = parseInboxPage([await request(`/sales/notifications/${id}/`)], user.id).rows[0];
      assertAuthScope(scope); if (latest.current !== key) return null;
      setState(old => ({ ...(old.key === key ? old : empty(key)), rows: mergeInbox(old.key === key ? old.rows : [], [row]) }));
      return row;
    } catch (error: any) { if (latest.current === key) setState(old => ({ ...old, key, error: error.message || 'Bildirishnoma ochilmadi.' })); return null; }
  }, [enabled, key, user]);
  const visible = state.key === key && enabled ? state : empty(key);
  const value = useMemo<Inbox>(() => ({ ...visible, enabled, hasMore: visible.cursor !== null, busy, refresh: () => load('refresh'), loadMore: () => load('older'), fetchOne,
    markRead: id => mutate('read', id), markAllRead: () => mutate('read-all'), remove: id => mutate('delete', id), clear: () => mutate('clear') }), [visible, enabled, busy, load, mutate, fetchOne]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useNotifications = () => useContext(Context);
