import { KeyboardRegion } from './KeyboardRegion';
import React from 'react';
import { ActivityIndicator, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from './ScreenHeader';
import { useTheme } from '../../theme/ThemeContext';
import { Button } from './Button';
export function Page({ title, children, onBack, onMenu, scroll = true, actions, insetBottom = true, actionsStyle }: { title: string; children: React.ReactNode; onBack?: () => void; onMenu?: () => void; scroll?: boolean; actions?: React.ReactNode; insetBottom?: boolean; actionsStyle?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <SafeAreaView edges={insetBottom ? ['bottom'] : []} style={{ flex: 1, backgroundColor: colors.background }}>
    <ScreenHeader title={title} onGoBack={onBack} onOpenDrawer={onMenu} />
    <KeyboardRegion style={{ flex: 1 }}>
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}>{children}</ScrollView> : children}
      {actions && <View style={[{ padding: 16, gap: 10, borderTopWidth: 1, borderColor: colors.border }, actionsStyle]}>{actions}</View>}
    </KeyboardRegion>
  </SafeAreaView>;
}
export function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  const { colors } = useTheme();
  return <Text accessibilityRole={error ? 'alert' : undefined} style={{ color: error ? colors.danger : colors.textSecondary, fontSize: 14, lineHeight: 21 }}>{children}</Text>;
}
export function Loading() { const { colors } = useTheme(); return <ActivityIndicator accessibilityLabel="Yuklanmoqda" color={colors.text} style={{ padding: 24 }} />; }
export function Retry({ error, retry }: { error: string; retry: () => void }) { return <View style={{ gap: 12 }}><Notice error>{error}</Notice><Button title="Qayta urinish" variant="secondary" onPress={retry} /></View>; }
