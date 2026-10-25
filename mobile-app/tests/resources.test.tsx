import { act, renderHook } from '@testing-library/react-native';
import { useApiResource } from '../src/hooks/useApiResource';
import { useApiAction } from '../src/hooks/useApiAction';
import { resourceChanged } from '../src/api/invalidation';
import { request, assertAuthScope } from '../src/api/client';
let mockTenantId = 2, mockAllowed = true;
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: () => ({}), assertAuthScope: jest.fn() }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, activeTenant: { id: mockTenantId } }) }));
jest.mock('../src/features/auth/usePermissions', () => ({ usePermissions: () => ({ requirePermission: () => { if (!mockAllowed) throw Error('Denied'); } }) }));
describe('Scoped resource and action infrastructure', () => {
  beforeEach(() => { jest.clearAllMocks(); mockTenantId = 2; mockAllowed = true; });
  test('confirmed related mutations refresh loaded detail data', async () => {
    jest.mocked(request).mockResolvedValueOnce({ id: 1, name: 'Before' }).mockResolvedValueOnce({ id: 1, name: 'After' });
    const hook = await renderHook(() => useApiResource<{ id: number; name: string }>('/catalog/products/1/'));
    expect(hook.result.current.data?.name).toBe('Before');
    await act(async () => resourceChanged('/catalog/variants/7/'));
    expect(hook.result.current.data?.name).toBe('After');
  });
  test('a late previous-store detail response never replaces current-store data', async () => {
    let finish!: (value: any) => void;
    jest.mocked(request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ id: 2 });
    const hook = await renderHook(() => useApiResource('/catalog/products/1/'));
    mockTenantId = 3; await hook.rerender(undefined);
    await act(async () => finish({ id: 1 }));
    expect(hook.result.current.data).toEqual({ id: 2 });
  });
  test('a deleted detail is removed rather than kept as editable stale data', async () => {
    jest.mocked(request).mockResolvedValueOnce({ id: 1, name: 'Before' }).mockRejectedValueOnce(Object.assign(Error('Deleted'), { status: 404 }));
    const hook = await renderHook(() => useApiResource<{ id: number; name: string }>('/catalog/products/1/'));
    expect(hook.result.current.data?.name).toBe('Before');
    await act(async () => resourceChanged('/catalog/products/1/'));
    expect(hook.result.current.data).toBeNull(); expect(hook.result.current.error).toBe('Deleted');
  });
  test('missing action permission cannot invoke its mutation', async () => {
    mockAllowed = false; const action = jest.fn();
    const hook = await renderHook(() => useApiAction('catalog.add_product'));
    await act(async () => { await hook.result.current.run(action); });
    expect(action).not.toHaveBeenCalled(); expect(hook.result.current.error).toBe('Denied');
  });
  test('duplicate presses share a submission boundary and a changed session cannot acknowledge success', async () => {
    let finish!: (value: any) => void;
    const action = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const hook = await renderHook(() => useApiAction('catalog.add_product'));
    let attempt!: Promise<unknown>;
    await act(async () => { attempt = hook.result.current.run(action); await hook.result.current.run(action); });
    expect(action).toHaveBeenCalledTimes(1);
    jest.mocked(assertAuthScope).mockImplementationOnce(() => { throw Error('Session changed'); });
    await act(async () => { finish({ id: 5 }); expect(await attempt).toBeUndefined(); });
    expect(hook.result.current.error).toBe('Session changed');
  });
});
