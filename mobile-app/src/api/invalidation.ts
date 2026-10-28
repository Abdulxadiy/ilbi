type Listener = { endpoint: string; refresh: () => void };
const listeners = new Set<Listener>();
export function observeResource(endpoint: string | null, refresh: () => void) {
  if (!endpoint) return () => {};
  const listener = { endpoint, refresh }; listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const related: Record<string, string[]> = {
  catalog: ['catalog', 'inventory', 'analytics'], inventory: ['inventory', 'catalog', 'analytics'],
  sales: ['sales', 'catalog', 'inventory', 'analytics', 'cashbox'], cashbox: ['cashbox', 'analytics'],
  tenants: ['tenants', 'analytics'],
};
/** Invalidate only after a successful server mutation; consumers retain their own session/request guards. */
export function resourceChanged(endpoint: string) {
  const root = endpoint.split('/')[1];
  const prefixes = (related[root] || [root]).map(name => '/' + name + '/');
  for (const listener of listeners) if (prefixes.some(prefix => listener.endpoint.startsWith(prefix))) listener.refresh();
}
