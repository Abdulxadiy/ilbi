import { Drawer } from 'expo-router/drawer';
import { DrawerContent } from '../../navigation/DrawerContent';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../features/auth/AuthContext';
export default function AppDrawer() {
  const { colors } = useTheme(), { user, activeTenant } = useAuth();
  const admin = user?.role === 'platform_admin';
  return <Drawer drawerContent={props => <DrawerContent {...props} />} screenOptions={{ headerShown: false, drawerStyle: { width: '84%', backgroundColor: colors.surface } }}>
    <Drawer.Protected guard={!admin && Boolean(activeTenant)}><Drawer.Screen name="(tabs)" /></Drawer.Protected>
    <Drawer.Protected guard={admin}><Drawer.Screen name="admin" /></Drawer.Protected>
    <Drawer.Protected guard={admin}><Drawer.Screen name="profile" /><Drawer.Screen name="notifications" /></Drawer.Protected>
  </Drawer>;
}
