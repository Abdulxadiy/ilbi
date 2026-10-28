import { useSyncExternalStore } from 'react';
import { getServerScope, subscribeServerScope } from '../api/environment';
/** Origin changes are external session state, including when a logged-out profile stays null. */
export const useServerScope = () => useSyncExternalStore(subscribeServerScope, getServerScope, getServerScope);
