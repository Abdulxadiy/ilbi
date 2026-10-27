import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { useApiResource } from '../../hooks/useApiResource';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useTheme } from '../../theme/ThemeContext';
import { usePush } from './PushProvider';
import type { PushCategories } from './pushRegistration';

type Preferences = { id: number; notify_web_reports: boolean; notify_web_low_stock: boolean };
const parse = (value: any): Preferences => {
  if (!Number.isSafeInteger(value?.id) || typeof value.notify_web_reports !== 'boolean' || typeof value.notify_web_low_stock !== 'boolean') throw Error('Bildirishnoma sozlamalari tasdiqlanmadi.');
  return { id: value.id, notify_web_reports: value.notify_web_reports, notify_web_low_stock: value.notify_web_low_stock };
};
export function NotificationPreferences() {
  const { activeTenant } = useAuth(), { can } = usePermissions(), { colors } = useTheme();
  const push = usePush();
  const permitted = can('tenants.manage_settings');
  const { data, loading, error, reload } = useApiResource(permitted ? '/tenants/current/' : null, parse);
  const [saving, setSaving] = useState(''), [failure, setFailure] = useState('');
  const update = async (field: 'notify_web_reports' | 'notify_web_low_stock', value: boolean) => {
    if (!permitted || saving || !data || data.id !== activeTenant?.id) return;
    const scope = captureAuthScope(); setSaving(field); setFailure('');
    try {
      await request('/tenants/current/', { method: 'PATCH', body: { [field]: value } });
      assertAuthScope(scope); await reload();
    } catch (error: any) { try { assertAuthScope(scope); setFailure(error.message || 'Sozlama saqlanmadi.'); } catch {} }
    finally { setSaving(''); }
  };
  return <View style={styles.section}>
    <Text style={[styles.title, { color: colors.text }]}>Telefon bildirishnomalari</Text>
    {push.supported ? <>
      <Text style={{ color: colors.textSecondary }}>Qulflangan ekranda summalar va xabar matni ko‘rsatilmaydi. Tafsilotlarni ilovada ochasiz.</Text>
      <Button title={push.enabled ? 'Telefon bildirishnomalarini o‘chirish' : 'Telefon bildirishnomalarini yoqish'} loading={push.busy} onPress={push.enabled ? push.disable : push.enable} />
      {push.denied && <Button title="Telefon sozlamalarini ochish" variant="secondary" onPress={push.openSettings} />}
      {push.enabled && (Object.entries({ b2b: 'B2B', debts: 'Qarzlar', stock: 'Ombor', reports: 'Hisobotlar', system: 'Tizim xabarlari' }) as [keyof PushCategories, string][]).map(([key, label]) => <View key={key} style={styles.row}><Text style={[styles.label, { color: colors.text }]}>{label}</Text><Switch accessibilityLabel={`Telefon bildirishnomasi: ${label}`} value={push.categories[key]} disabled={push.busy} onValueChange={value => { void push.changeCategory(key, value); }} /></View>)}
      {push.message && <Text accessibilityRole={push.error ? 'alert' : undefined} accessibilityLiveRegion="polite" style={{ color: push.error ? colors.danger : colors.textSecondary }}>{push.message}</Text>}
    </> : <Text style={{ color: colors.textSecondary }}>Telefon push bildirishnomalari Android ilovasida sozlanadi. iOS yetkazilishi alohida tayyorlanadi.</Text>}
    {permitted && <>
    <Text style={[styles.title, { color: colors.text }]}>Do‘kon bildirishnomalari</Text>
    <Text style={{ color: colors.textSecondary }}>Bu sozlamalar veb, desktop va mobil ro‘yxat uchun umumiy.</Text>
    {loading && <Text style={{ color: colors.textSecondary }}>Yuklanmoqda…</Text>}
    {data && data.id === activeTenant?.id && <>
      <View style={styles.row}><Text style={[styles.label, { color: colors.text }]}>Yakunlangan Z-hisobotlar</Text><Switch accessibilityLabel="Yakunlangan Z-hisobot bildirishnomalari" value={data.notify_web_reports} disabled={Boolean(saving)} onValueChange={value => { void update('notify_web_reports', value); }} /></View>
      <View style={styles.row}><Text style={[styles.label, { color: colors.text }]}>Kamaygan tovarlar</Text><Switch accessibilityLabel="Kamaygan tovarlar bildirishnomalari" value={data.notify_web_low_stock} disabled={Boolean(saving)} onValueChange={value => { void update('notify_web_low_stock', value); }} /></View>
    </>}
    {(error || failure) && <><Text accessibilityRole="alert" style={{ color: colors.danger }}>{failure || error}</Text><Button title="Sozlamalarni qayta yuklash" variant="secondary" onPress={() => { void reload(); }} /></>}
    </>}
  </View>;
}
const styles = StyleSheet.create({ section: { padding: 16, gap: 12 }, title: { fontSize: 16, fontWeight: '700' }, row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }, label: { flex: 1, fontSize: 14 } });
