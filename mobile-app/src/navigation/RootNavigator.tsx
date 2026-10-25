import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../features/auth/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { IlbiLogo } from '../components/brand/IlbiLogo';
import { SessionRecovery } from '../features/auth/Gates';
import { sessionEntry } from '../features/auth/routePolicy';
import { usePermissions } from '../features/auth/usePermissions';

export function RootNavigator() {
  const { isAuthenticated, isLoading, user, activeTenant, sessionError } = useAuth();
  const { colors } = useTheme();
  const { canOpen } = usePermissions();
  if (isLoading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
    <IlbiLogo height={32} /><ActivityIndicator color={colors.text} style={{ marginTop: 24 }} />
  </View>;
  if (sessionError) return <SessionRecovery />;
  // Both the entry route and business tabs resolve to "/". An explicit fallback
  // prevents protected-route reconciliation from choosing the old business route on logout.
  const entry = sessionEntry(user, activeTenant);
  const accepted = user?.terms_accepted === true;
  const businessReady = accepted && (user?.role === 'platform_admin' || Boolean(activeTenant));
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
    <Stack.Screen name="index" />
    <Stack.Screen name="legal" />
    <Stack.Screen name="support" />
    <Stack.Protected guard={!isAuthenticated}><Stack.Screen name="login" /></Stack.Protected>
    <Stack.Protected guard={isAuthenticated && !accepted}><Stack.Screen name="terms" /></Stack.Protected>
    <Stack.Protected guard={isAuthenticated && accepted}><Stack.Screen name="stores" /></Stack.Protected>
    <Stack.Protected guard={isAuthenticated && businessReady} redirectTo={entry}>
      <Stack.Screen name="(app)" />
      <Stack.Protected guard={canOpen('Checkout')}><Stack.Screen name="checkout" options={{ presentation: 'modal' }} /></Stack.Protected>
      <Stack.Protected guard={canOpen('ReceiptView')}><Stack.Screen name="receipt" /></Stack.Protected>
    </Stack.Protected>
  </Stack>;
}
