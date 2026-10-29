import { useFeedback } from '../../hooks/useFeedback';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation } from '../../navigation/useAppNavigation';
import { Info, LogOut, Moon, Store, Sun, Trash2 } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Toast } from '../../components/ui/Toast';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { getApiBaseUrl, setApiBaseUrl } from '../../api/client';
import { normalizeApiBaseUrl } from '../../api/environment';
import { useFormErrors } from '../../hooks/useFormErrors';
import { installedApp } from '../updates/installed';
import appConfig from '../../../app.json';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors, mode, setMode } = useTheme();
  const { user, activeTenant, logout } = useAuth();
  const { canOpen } = usePermissions();

  const validation = useFormErrors();
  const installed = installedApp();
  const [apiUrl, setApiUrl] = useState(getApiBaseUrl());
  const { message: toastMessage, type: toastType, show: setToastMessage } = useFeedback();
  const [testingConnection, setTestingConnection] = useState(false);

  const handleSaveApiUrl = async () => {
    try {
      const normalized = normalizeApiBaseUrl(apiUrl);
      if (normalized === getApiBaseUrl()) return;
      await logout();
      await setApiBaseUrl(normalized);
      setToastMessage('Server ushbu sessiya uchun o‘zgardi. Qayta kiring.');
    } catch (error: any) { validation.setErrors({ api_url: error.message || 'Server manzilini tekshiring.' }); setToastMessage(error.message || 'Server manzili o‘zgarmadi', 'error'); }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const normalized = normalizeApiBaseUrl(apiUrl);
      validation.clear('api_url');
      const res = await fetch(`${normalized}/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: 'test' }),
      });
      // A 401 or 400 means server responded!
      if (res.status === 401 || res.status === 400 || res.ok) {
        setToastMessage('Serverga ulanish muvaffaqiyatli!');
      } else {
        setToastMessage(`Server javobi: ${res.status}`);
      }
    } catch (failure: any) {
      validation.setErrors({ api_url: failure.message || 'Serverga ulanib bo‘lmadi' });
      setToastMessage('Serverga ulanib bo‘lmadi', 'error');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleClearCache = async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith('ilbi_cache:'));
      if (keys.length) await AsyncStorage.multiRemove(keys);
      setToastMessage('Vaqtinchalik kesh tozalandi. Savat va yuborilmagan amallar saqlandi.');
    } catch { setToastMessage('Keshni tozalab bo‘lmadi'); }
  };

  const handleLogout = async () => {
    await logout();
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Sozlamalar"
        onGoBack={() => navigation.goBack()}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {canOpen('StoreSettings') && <Button title="Do‘kon va chek sozlamalari" variant="secondary" onPress={() => navigation.navigate('StoreSettings')} />}
        {/* Active Store & Profile */}
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Faol do&#39;kon va hisob</Text>
          <View style={styles.infoRow}>
            <Store size={18} color={colors.textSecondary} />
            <View style={styles.infoCol}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Do&#39;kon</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {activeTenant?.name || 'Asosiy do‘kon'}
              </Text>
            </View>
          </View>



          <View style={styles.infoRow}>
            <Info size={18} color={colors.textSecondary} />
            <View style={styles.infoCol}>
              <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Foydalanuvchi</Text>
              <Text style={[styles.infoValue, { color: colors.text }]}>
                {user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username : 'Foydalanuvchi'}
              </Text>
            </View>
          </View>
        </View>

        <Button title="Profilni ochish" variant="secondary" onPress={() => navigation.navigate('Profile')} />

        {/* Theme Settings (Kunduz / Tun) */}
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Mavzu</Text>
          <View style={[styles.themePillsRow, { backgroundColor: colors.surfaceSecondary }]}>
            {(['light', 'dark'] as const).map((m) => {
              const active = mode === m;
              const label = m === 'light' ? 'Kunduz' : 'Tun';
              const Icon = m === 'light' ? Sun : Moon;

              return (
                <TouchableOpacity accessibilityRole="button"
                  key={m}
                  onPress={() => setMode(m)}
                  style={[
                    styles.themePill,
                    active && { backgroundColor: colors.surface, shadowColor: '#000', elevation: 2 },
                  ]}
                >
                  <Icon size={16} color={active ? colors.text : colors.textSecondary} />
                  <Text
                    style={[
                      styles.themePillText,
                      { color: active ? colors.text : colors.textSecondary },
                      active && { fontWeight: '700' },
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Server Endpoint Settings: development builds only */}
        {__DEV__ && <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Server sozlamalari</Text>
          <Input
            label="API Base URL"
            value={apiUrl}
            onChangeText={value => { setApiUrl(value); validation.clear('api_url'); }}
            error={validation.errors.api_url}
            placeholder="http://192.168.1.100:8000/api/v1"
          />

          <View style={styles.actionRow}>
            <Button
              title="Tekshirish"
              variant="secondary"
              loading={testingConnection}
              onPress={handleTestConnection}
              style={{ flex: 1 }}
            />
            <Button
              title="Saqlash"
              variant="primary"
              onPress={handleSaveApiUrl}
              style={{ flex: 1 }}
            />
          </View>
        </View>}

        {/* Cache & Diagnostics */}
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Xotira va kesh</Text>
          <Button
            title="Vaqtinchalik keshni tozalash"
            variant="secondary"
            icon={<Trash2 size={16} color={colors.text} />}
            onPress={handleClearCache}
          />
        </View>

        {/* App Info & Logout */}
        <View style={[styles.sectionCard, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Ilova haqida</Text>
          <View style={styles.appInfoRow}>
            <Text style={[styles.appInfoLabel, { color: colors.textSecondary }]}>Talqin (Version)</Text>
            <Text style={[styles.appInfoValue, { color: colors.text }]}>{installed ? installed.version + ' (' + installed.buildNumber + ')' : appConfig.expo.version}</Text>
          </View>
          <View style={styles.appInfoRow}>
            <Text style={[styles.appInfoLabel, { color: colors.textSecondary }]}>Yuklamalar</Text>
            <Button title="Yangilanishlarni tekshirish" size="sm" variant="secondary" onPress={() => navigation.navigate('Downloads')} />
          </View>

          <Button title="Amallar va sinxronlash" variant="secondary" onPress={() => navigation.navigate('Sync')} />
          <Button
            title="Hisobdan chiqish"
            variant="danger"
            icon={<LogOut size={16} color="#FFFFFF" />}
            onPress={handleLogout}
            style={{ marginTop: spacing.md }}
          />
        </View>
      </ScrollView>

      {toastMessage && (
        <Toast
        type={toastType}
          message={toastMessage}
          variant="info"
          visible
          onDismiss={() => setToastMessage(null)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionCard: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.body.fontSize,
    fontFamily: typography.body.fontFamily,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  infoCol: {
    flex: 1,
  },
  infoLabel: {
    fontSize: typography.micro.fontSize,
    fontFamily: typography.micro.fontFamily,
  },
  infoValue: {
    fontSize: typography.body.fontSize,
    fontFamily: typography.body.fontFamily,
    fontWeight: '500',
    marginTop: 1,
  },
  themePillsRow: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: radius.md,
  },
  themePill: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  themePillText: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.caption.fontFamily,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  appInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  appInfoLabel: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.caption.fontFamily,
  },
  appInfoValue: {
    fontSize: typography.caption.fontSize,
    fontFamily: typography.caption.fontFamily,
    fontWeight: '500',
  },
});
