import { act, renderHook } from '@testing-library/react-native';
import { request } from '../src/api/client';
import { usePagedResource } from '../src/hooks/usePagedResource';
let mockTenant = 1;
jest.mock('../src/api/client', () => ({ request: jest.fn() }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, activeTenant: { id: mockTenant } }) }));
const deferred = () => { let resolve!: (v: any) => void; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
describe('Paged resources and stale requests', () => {
  beforeEach(() => { jest.clearAllMocks(); mockTenant = 1; });
  test('later searches cannot be replaced by an earlier response', async () => {
    const old = deferred(), recent = deferred();
    jest.mocked(request).mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise);
    const hook = await renderHook(({ q }: { q: string }) => usePagedResource<{id:number;name:string}>('/catalog/variants/?search=' + q), { initialProps: { q: 'old' } });
    await hook.rerender({ q: 'new' });
    await act(async () => { recent.resolve({ results: [{ id: 2, name: 'new' }], count: 1, next: null }); });
    await act(async () => { old.resolve({ results: [{ id: 1, name: 'old' }], count: 1, next: null }); });
    expect(hook.result.current.rows).toEqual([{ id: 2, name: 'new' }]);
  });
  test('switching stores cancels and hides the old store response', async () => {
    const old = deferred(); jest.mocked(request).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ results: [{ id: 20 }], count: 1 });
    const hook = await renderHook(() => usePagedResource('/sales/counterparties/'));
    mockTenant = 2; await hook.rerender({});
    await act(async () => { old.resolve({ results: [{ id: 10 }], count: 1 }); });
    expect(hook.result.current.rows).toEqual([{ id: 20 }]);
    expect((jest.mocked(request).mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
  });
  test('loads a second page once and never follows an untrusted next URL', async () => {
    jest.mocked(request).mockResolvedValueOnce({ results: [{ id: 1 }], count: 2, next: 'https://untrusted.invalid/?page=2' }).mockResolvedValueOnce({ results: [{ id: 2 }], count: 2, next: null });
    const hook = await renderHook(() => usePagedResource('/sales/counterparties/?search=Ali'));
    await act(async () => { await Promise.all([hook.result.current.loadMore(), hook.result.current.loadMore()]); });
    expect(hook.result.current.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(jest.mocked(request).mock.calls.map(([url]) => url)).toEqual(['/sales/counterparties/?search=Ali&page=1&page_size=50', '/sales/counterparties/?search=Ali&page=2&page_size=50']);
  });
  test('failed next page preserves existing rows and supports retry', async () => {
    jest.mocked(request).mockResolvedValueOnce({ results: [{ id: 1 }], count: 2, next: '?page=2' }).mockRejectedValueOnce(Error('Offline')).mockResolvedValueOnce({ results: [{ id: 2 }], count: 2, next: null });
    const hook = await renderHook(() => usePagedResource('/sales/'));
    await act(async () => { await hook.result.current.loadMore(); });
    expect(hook.result.current.rows).toHaveLength(1); expect(hook.result.current.error.message).toBe('Offline');
    await act(async () => { await hook.result.current.retry(); });
    expect(hook.result.current.rows).toHaveLength(2);
  });
});

test('support UUID pages preserve private headers while rejecting arbitrary string identifiers', async () => {
  const options = { skipTenant: true, headers: { 'X-Support-Token': 'synthetic-private-key' } };
  jest.mocked(request).mockResolvedValueOnce({ results: [{ id: '00000000-0000-4000-8000-000000000001' }], next: null });
  const hook = await renderHook(() => usePagedResource('/support/guest/', undefined, options));
  expect(hook.result.current.rows).toHaveLength(1);
  expect(jest.mocked(request).mock.calls.at(-1)?.[1]).toMatchObject(options);
  jest.mocked(request).mockResolvedValueOnce({ results: [{ id: '../other-account' }], next: null });
  await act(async () => { await hook.result.current.reload(); });
  expect(hook.result.current.error.message).toContain('identifikatori');
});
