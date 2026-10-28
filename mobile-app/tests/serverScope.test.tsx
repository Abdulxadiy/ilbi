import { act, renderHook } from '@testing-library/react-native';
import { commitApiBaseUrl, getApiBaseUrl } from '../src/api/environment';
import { useServerScope } from '../src/hooks/useServerScope';
test('a committed origin change rerenders a logged-out consumer even if its profile remains null', async () => {
  const original = getApiBaseUrl(), hook = await renderHook(() => ({ user: null, origin: useServerScope() }));
  await act(async () => commitApiBaseUrl('https://external-store-change.invalid/api/v1'));
  expect(hook.result.current).toEqual({ user: null, origin: 'https://external-store-change.invalid/api/v1' });
  await act(async () => commitApiBaseUrl(original)); await hook.unmount();
});
