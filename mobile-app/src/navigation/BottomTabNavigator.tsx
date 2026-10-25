import { Tabs } from 'expo-router';
import { Clock, Home, Menu, Package, ShoppingCart } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCart } from '../features/cart/CartContext';
import { useTheme } from '../theme/ThemeContext';
import { useAppNavigation } from './useAppNavigation';
import { usePermissions } from '../features/auth/usePermissions';
export function BottomTabNavigator() {
  const { colors } = useTheme(), { totalQuantity } = useCart(), insets = useSafeAreaInsets();
  const navigation = useAppNavigation(), { canOpen } = usePermissions();
  return <Tabs backBehavior="history" screenOptions={{ headerShown: false,
    tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.borderSubtle, height: 56 + insets.bottom, paddingBottom: Math.max(6, insets.bottom) },
    tabBarActiveTintColor: colors.text, tabBarInactiveTintColor: colors.textTertiary,
    tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
  }}>
    <Tabs.Screen name="index" options={{ title: 'Bosh', tabBarIcon: ({ color, size }) => <Home size={size - 2} color={color} /> }} />
    <Tabs.Protected guard={canOpen('Tovar')}><Tabs.Screen name="products" options={{ title: 'Tovar', tabBarIcon: ({ color, size }) => <Package size={size - 2} color={color} /> }} /></Tabs.Protected>
    <Tabs.Protected guard={canOpen('Savdo')}><Tabs.Screen name="cart" options={{ title: 'Savdo', tabBarAccessibilityLabel: 'Savdo', tabBarBadge: totalQuantity || undefined, tabBarBadgeStyle: { backgroundColor: colors.text, color: colors.surface }, tabBarIcon: ({ color, size }) => <ShoppingCart size={size - 2} color={color} /> }} /></Tabs.Protected>
    <Tabs.Protected guard={canOpen('Qarz')}><Tabs.Screen name="debts" options={{ title: 'Qarz', tabBarIcon: ({ color, size }) => <Clock size={size - 2} color={color} /> }} /></Tabs.Protected>
    <Tabs.Screen name="menu" listeners={{ tabPress: event => { event.preventDefault(); navigation.openDrawer(); } }} options={{ title: 'Menyu', tabBarIcon: ({ color, size }) => <Menu size={size - 2} color={color} /> }} />
    <Tabs.Protected guard={canOpen('Documents')}><Tabs.Screen name="documents" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} /></Tabs.Protected>
    <Tabs.Protected guard={canOpen('Inventory')}><Tabs.Screen name="inventory" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} /></Tabs.Protected>
    <Tabs.Protected guard={canOpen('Customers')}><Tabs.Screen name="customers" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} /></Tabs.Protected>
    <Tabs.Protected guard={canOpen('Reports')}><Tabs.Screen name="reports" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} /></Tabs.Protected>
    <Tabs.Protected guard={canOpen('Categories')}><Tabs.Screen name="categories" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} /></Tabs.Protected>
    <Tabs.Protected guard={canOpen('Product') || canOpen('NewProduct')}><Tabs.Screen name="product" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} /></Tabs.Protected>
    <Tabs.Screen name="support" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
    <Tabs.Screen name="downloads" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
    <Tabs.Screen name="sync" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
    <Tabs.Screen name="settings" options={{ tabBarButton: () => null, tabBarItemStyle: { display: 'none' } }} />
  </Tabs>;
}
