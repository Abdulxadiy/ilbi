import { useAuth } from '../features/auth/AuthContext';
import { usePermissions } from '../features/auth/usePermissions';
import { getAuthGeneration, getActiveTenantId } from '../api/client';
import { router, useNavigation as useRouterNavigation } from 'expo-router';

const paths: Record<string, string> = {
  Bosh: '/(app)/(tabs)', Tovar: '/(app)/(tabs)/products', Savdo: '/(app)/(tabs)/cart',
  Qarz: '/(app)/(tabs)/debts', Documents: '/(app)/(tabs)/documents', Inventory: '/(app)/(tabs)/inventory',
  Customers: '/(app)/(tabs)/customers', Reports: '/(app)/(tabs)/reports', Settings: '/(app)/(tabs)/settings',
  Checkout: '/checkout', Support: '/support', Downloads: '/downloads',
  Notifications: '/(app)/(tabs)/notifications', Profile: '/(app)/(tabs)/profile', History: '/(app)/(tabs)/history',
  SalesHistory: '/(app)/(tabs)/sales-history',
  Cashbox: '/(app)/(tabs)/cashbox',
  B2B: '/(app)/(tabs)/b2b',
  Employees: '/(app)/(tabs)/employees',
  Customer: '/(app)/(tabs)/customer',
  CustomerImport: '/(app)/(tabs)/customer-import',
  StoreSettings: '/(app)/(tabs)/store-settings',
  Sync: '/(app)/(tabs)/sync', Categories: '/(app)/(tabs)/categories',
  Product: '/(app)/(tabs)/product', NewProduct: '/(app)/(tabs)/product', Stores: '/stores', Admin: '/(app)/admin',
};
let receiptSnapshot: any = null;
let receiptScope = '';
const scope = () => String(getAuthGeneration()) + ':' + getActiveTenantId();
export const getReceiptSnapshot = () => receiptScope === scope() ? receiptSnapshot : null;

/** Feature transition adapter; URL/navigation ownership stays with Expo Router. */
export function useAppNavigation() {
  const navigation = useRouterNavigation<any>();
  const { canOpen } = usePermissions();
  const { user, activeTenant } = useAuth();
  const openDrawer = () => {
    let current = navigation;
    while (current) {
      if (typeof current.openDrawer === 'function') { current.openDrawer(); return; }
      current = current.getParent?.();
    }
  };
  return {
    openDrawer,
    goBack: () => router.canGoBack() ? router.back() : router.replace('/'),
    navigate(name: string, params?: any) {
      if (name === 'MainTabs') name = params?.screen || 'Bosh';
      if (!canOpen(name)) throw Error('Bu bo‘lim uchun faol do‘konda vakolat berilmagan.');
      if (['ReceiptView', 'ShareSheet', 'PdfExport'].includes(name)) {
        receiptSnapshot = params?.sale || null;
        receiptScope = scope();
        router.push({ pathname: '/receipt', params: { mode: name, saleId: String(params?.sale?.id || '') } });
        return;
      }
      if (name === 'Menyu') { openDrawer(); return; }
      const tabbedUtility = ['Support', 'Downloads'].includes(name) && user?.role !== 'platform_admin' && user?.terms_accepted && activeTenant;
      const adminUtility = user?.role === 'platform_admin' && ['Notifications', 'Profile', 'Employees'].includes(name);
      const path = adminUtility ? '/(app)/' + name.toLowerCase() : tabbedUtility ? '/(app)/(tabs)/' + name.toLowerCase() : paths[name];
      if (!path) throw Error('Unknown app route: ' + name);
      router.navigate({ pathname: path, params: name === 'NewProduct' ? { id: 'new' } : params || {} } as any);
    },
  };
}
