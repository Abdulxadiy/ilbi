import { act, renderHook } from '@testing-library/react-native';
import { useSupportFeed } from '../src/features/support/useSupport';
import type { SupportSession } from '../src/features/support/session';
import wire from './contracts/support.json';
const message = (id: number) => ({ ...wire.messages.results[0], id, client_id: '00000000-0000-4000-8000-' + String(id).padStart(12, '0') });
function makeSession(call: jest.Mock): SupportSession { return { key: 'test', root: '/support/conversations/', userId: 1, tenantId: 2, operator: false, options: { skipTenant: true, expectedServerScope: 'test', headers: {} }, call } as SupportSession; }
describe('Support message cursor and visibility lifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test('older history and multiple live cursor pages merge without gaps or duplicate messages', async () => {
    const call = jest.fn().mockResolvedValueOnce({ results: Array.from({ length: 50 }, (_, i) => message(51 + i)), has_more: true });
    const session = makeSession(call), hook = await renderHook(() => useSupportFeed(session, wire.conversation.id, true));
    expect(hook.result.current.messages).toHaveLength(50);
    call.mockResolvedValueOnce({ results: Array.from({ length: 50 }, (_, i) => message(1 + i)), has_more: false });
    await act(async () => { await hook.result.current.loadOlder(); });
    expect(hook.result.current.messages).toHaveLength(100);
    expect(call.mock.calls[1][0]).toContain('before_id=51');
    call.mockResolvedValueOnce({ results: Array.from({ length: 50 }, (_, i) => message(101 + i)), has_more: true }).mockResolvedValueOnce({ results: [message(151)], has_more: false });
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
    expect(hook.result.current.messages).toHaveLength(151);
    expect(new Set(hook.result.current.messages.map(row => row.id)).size).toBe(151);
    expect(call.mock.calls[2][0]).toContain('after_id=100'); expect(call.mock.calls[3][0]).toContain('after_id=150');
    await hook.unmount();
  });
  test('an interrupted older-page read releases its loading lock after backgrounding', async () => {
    let finish!: (value: any) => void;
    const call = jest.fn().mockResolvedValueOnce({ results: [message(50)], has_more: true }).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })), session = makeSession(call);
    const hook = await renderHook(({ active }: { active: boolean }) => useSupportFeed(session, wire.conversation.id, active), { initialProps: { active: true } });
    let attempt!: Promise<void>;
    await act(async () => { attempt = hook.result.current.loadOlder(); });
    expect(hook.result.current.loadingOlder).toBe(true);
    await hook.rerender({ active: false });
    await act(async () => { finish({ results: [message(1)], has_more: false }); await attempt; });
    expect(hook.result.current.loadingOlder).toBe(false);
    expect(hook.result.current.messages.map(row => row.id)).toEqual([50]);
    await hook.unmount();
  });
  test('leaving the active screen aborts a pending read and ignores its late reply', async () => {
    let finish!: (value: any) => void;
    const call = jest.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve; })), session = makeSession(call);
    const hook = await renderHook(({ active }: { active: boolean }) => useSupportFeed(session, wire.conversation.id, active), { initialProps: { active: true } });
    const signal = call.mock.calls[0][1].signal as AbortSignal;
    await hook.rerender({ active: false }); expect(signal.aborted).toBe(true);
    await act(async () => { finish(wire.messages); await jest.advanceTimersByTimeAsync(60000); });
    expect(hook.result.current.messages).toEqual([]); expect(call).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });
});
