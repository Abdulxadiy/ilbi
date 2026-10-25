import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme } from './src/theme/ThemeContext';
import { AuthProvider } from './src/features/auth/AuthContext';
import { CartProvider, useCart } from './src/features/cart/CartContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { isDesignPreview } from './src/dev/preview';
import { UpdatesProvider } from './src/features/updates/UpdatesProvider';
import { UpdateNotice } from './src/features/updates/UpdateNotice';

const ThemedApp: React.FC = () => {
  const { isDark, colors } = useTheme();
  const { persistenceError, retryPersistence, saving } = useCart();

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.container}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {isDesignPreview && <View style={{ backgroundColor: '#e9dfc2', padding: 5 }}><Text style={{ color: '#3b3018', fontSize: 10, textAlign: 'center' }}>DIZAYN PREVIEW · Sun’iy ma’lumotlar · Haqiqiy savdo emas</Text></View>}
      {persistenceError && <View accessibilityRole="alert" style={{ padding: 10, backgroundColor: colors.surface }}><Text style={{ color: colors.danger }}>{persistenceError}</Text><Text onPress={retryPersistence} accessibilityRole="button" style={{ paddingTop: 8, color: colors.text }}>Qayta urinish</Text></View>}
      {saving && <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary, padding: 4, fontSize: 11 }}>Qoralama saqlanmoqda…</Text>}
      <UpdateNotice />
      <RootNavigator />
    </SafeAreaView>
  );
};

export default function App() {
  return (
    <GestureHandlerRootView style={styles.container}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <CartProvider>
              <UpdatesProvider>
              <ThemedApp />
              </UpdatesProvider>
            </CartProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
