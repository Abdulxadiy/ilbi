import { observeResource } from '../api/invalidation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { request } from '../api/client';
import { isUuid } from '../domain/identifiers';
import { getServerScope } from '../api/environment';
import { useAuth } from '../features/auth/AuthContext';
const identity = <T,>(value: any): T => value;
type State<T> = { key: string; rows: T[]; count: number; page: number; hasMore: boolean; loading: boolean; loadingMore: boolean; error: any; failedPage: number; summary: any };
export const pageUrl = (path: string, page: number, size = 50) => path + (path.includes('?') ? '&' : '?') + `page=${page}&page_size=${size}`;
/** Own pagination URLs prevent a server-provided next link from redirecting credentials. */
export function usePagedResource<T extends { id: number | string }>(endpoint: string | null, parseRow: (value: any) => T = identity, options?: { skipTenant?: boolean; headers?: Record<string, string> }) {
  const { user, activeTenant } = useAuth();
  const key = [getServerScope(), user?.id, activeTenant?.id, endpoint].join('|');
  const [state, setState] = useState<State<T>>({ key: '', rows: [], count: 0, page: 0, hasMore: false, loading: false, loadingMore: false, error: null, failedPage: 1, summary: null });
  const sequence = useRef(0), currentKey = useRef(key), controller = useRef<AbortController | null>(null), inFlight = useRef('');
  useLayoutEffect(() => { currentKey.current = key; }, [key]);
  const load = useCallback(async (page: number, restart = false) => {
    if (!endpoint) return;
    if (restart) { sequence.current++; controller.current?.abort(); controller.current = new AbortController(); }
    const operation = sequence.current, requestKey = key + ':' + operation + ':' + page;
    if (inFlight.current === requestKey) return;
    inFlight.current = requestKey;
    const abort = controller.current ||= new AbortController();
    const current = () => currentKey.current === key && sequence.current === operation && !abort.signal.aborted;
    setState(previous => ({ ...(previous.key === key && page > 1 ? previous : { key, rows: [], count: 0, page: 0, hasMore: false, summary: null }), key, loading: page === 1, loadingMore: page > 1, error: null, failedPage: page }));
    try {
      const result = await request(pageUrl(endpoint, page), { ...options, signal: abort.signal });
      if (!current()) return;
      const raw = Array.isArray(result) ? result : result?.results;
      if (!Array.isArray(raw)) throw Error('Server ro‘yxatni tasdiqlamadi.');
      const rows = raw.map(parseRow);
      if (rows.some(row => !(typeof row.id === 'number' && Number.isInteger(row.id) && row.id > 0) && !isUuid(row.id))) throw Error('Ro‘yxat identifikatori tasdiqlanmadi.');
      setState(previous => ({ key, rows: page === 1 ? rows : [...new Map([...previous.rows, ...rows].map(row => [row.id, row])).values()],
        count: Number(result?.count ?? rows.length), page, hasMore: Boolean(result?.next), summary: result?.summary ?? previous.summary,
        loading: false, loadingMore: false, error: null, failedPage: page,
      }));
    } catch (error) {
      if (current()) setState(previous => ({ ...previous, loading: false, loadingMore: false, error, failedPage: page }));
    } finally { if (inFlight.current === requestKey) inFlight.current = ''; }
  }, [endpoint, key, parseRow, options]);
  const cancel = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active && endpoint) return load(1, true); });
    return () => { active = false; cancel(); };
  }, [endpoint, load, cancel]);
  useEffect(() => observeResource(endpoint, () => { void load(1, true); }), [endpoint, load]);
  const visible = state.key === key ? state : { key, rows: [], count: 0, page: 0, hasMore: false, summary: null, loading: Boolean(endpoint), loadingMore: false, error: null, failedPage: 1 };
  return { ...visible, reload: () => load(1, true), retry: () => load(visible.failedPage, visible.failedPage === 1),
    loadMore: () => visible.hasMore && !visible.loading && !visible.loadingMore ? load(visible.page + 1) : Promise.resolve(),
  };
}
export function useDebounced<T>(value: T, delay = 250) {
  const [result, setResult] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setResult(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return result;
}
