import { useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Bell, CheckCheck, Settings2, Trash2 } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { usePermissions } from '../auth/usePermissions';
import { useAuth } from '../auth/AuthContext';
import { getServerScope } from '../../api/environment';
import { useTheme } from '../../theme/ThemeContext';
import { useNotifications } from './NotificationsContext';
import { NotificationPreferences } from './NotificationPreferences';
import { notificationCategory, notificationDestination, type InboxNotification } from './inbox';
import { safeDisplayText } from '../../security/presentation';

export function NotificationsScreen() {
  const { colors } = useTheme(), navigation = useAppNavigation(), { canOpen } = usePermissions(), inbox = useNotifications();
  const { user, activeTenant } = useAuth();
  const scopeKey = [getServerScope(), user?.id, activeTenant?.id].join('|');
  const params = useLocalSearchParams<{ notificationId?: string }>();
  const { fetchOne, markRead } = inbox;
  const focusedId = typeof params.notificationId === 'string' && /^[1-9]\d{0,14}$/.test(params.notificationId) ? Number(params.notificationId) : null;
  const focused = inbox.rows.find(row => row.id === focusedId), attempted = useRef<number | null>(null);
  useEffect(() => { if (focusedId && !focused) void fetchOne(focusedId); }, [focusedId, focused, fetchOne]);
  useEffect(() => {
    if (!focusedId) { attempted.current = null; return; }
    if (focused && !focused.is_read && attempted.current !== focusedId) { attempted.current = focusedId; void markRead(focusedId); }
  }, [focusedId, focused, markRead]);
  const [confirmation, setConfirmation] = useState<{ key: string; target: InboxNotification | 'all' } | null>(null), [preferencesKey, setPreferencesKey] = useState(''), [targetFailure, setTargetFailure] = useState({ key: '', message: '' });
  const confirm = confirmation?.key === scopeKey ? confirmation.target : null, preferences = preferencesKey === scopeKey;
  const targetError = targetFailure.key === scopeKey ? targetFailure.message : '';
  const setConfirm = (target: InboxNotification | 'all' | null) => setConfirmation(target ? { key: scopeKey, target } : null);
  const setPreferences = (visible: boolean) => setPreferencesKey(visible ? scopeKey : '');
  const setTargetError = (message: string) => setTargetFailure({ key: scopeKey, message });
  const open = async (row: InboxNotification) => {
    setTargetError('');
    const target = notificationDestination(row);
    if (!target || !canOpen(target.module)) return;
    if (!row.is_read && !await inbox.markRead(row.id)) return;
    try { navigation.navigate(target.module, target.params); } catch (error: any) { setTargetError(error.message || 'Bo‘lim ochilmadi.'); }
  };
  const remove = async () => {
    if (!confirm) return;
    const ok = confirm === 'all' ? await inbox.clear() : await inbox.remove(confirm.id);
    if (ok) setConfirm(null);
  };
  return <View style={[styles.container, { backgroundColor: colors.background }]}>
    <ScreenHeader title="Bildirishnomalar" onGoBack={navigation.goBack} rightAction={<TouchableOpacity accessibilityRole="button" accessibilityLabel="Bildirishnoma sozlamalari" onPress={() => setPreferences(true)} style={styles.icon}><Settings2 size={21} color={colors.text} /></TouchableOpacity>} />
    <View style={styles.toolbar}><Text accessibilityLiveRegion="polite" style={[styles.summary, { color: colors.text }]}>{inbox.unreadCount} ta o‘qilmagan</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Barchasini o‘qilgan qilish" disabled={!inbox.unreadCount || Boolean(inbox.busy)} onPress={() => { void inbox.markAllRead(); }} style={styles.icon}><CheckCheck size={22} color={!inbox.unreadCount || inbox.busy ? colors.textMuted : colors.text} /></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Bildirishnomalarni tozalash" disabled={!inbox.rows.length || Boolean(inbox.busy)} onPress={() => setConfirm('all')} style={styles.icon}><Trash2 size={20} color={!inbox.rows.length || inbox.busy ? colors.textMuted : colors.danger} /></TouchableOpacity>
    </View>
    {(inbox.error || targetError) && <View style={styles.message}><Text accessibilityRole="alert" style={{ color: colors.danger }}>{safeDisplayText(targetError || inbox.error)}</Text><Button title="Qayta urinish" variant="secondary" onPress={() => { void inbox.refresh(); }} /></View>}
    <FlatList data={inbox.rows} keyExtractor={row => String(row.id)} contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={inbox.loading} onRefresh={() => { void inbox.refresh(); }} />}
      ListEmptyComponent={<View style={styles.empty}>{inbox.loading ? <ActivityIndicator color={colors.text} /> : <><Bell size={36} color={colors.textMuted} /><Text style={{ color: colors.textSecondary }}>{inbox.error ? 'Ro‘yxatni yuklash uchun qayta urining.' : 'Hozircha bildirishnoma yo‘q'}</Text></>}</View>}
      renderItem={({ item: row }) => {
        const target = notificationDestination(row), allowed = target && canOpen(target.module);
        return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: row.is_read ? colors.borderSubtle : colors.primaryAction }]}>
          <View style={styles.meta}><Text style={[styles.category, { color: colors.textSecondary }]}>{notificationCategory(row.type)}{row.is_read ? '' : ' · Yangi'}</Text><Text style={{ color: colors.textMuted, fontSize: 11 }}>{new Date(row.created_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}</Text></View>
          <Text style={[styles.title, { color: colors.text }]}>{row.title}</Text><Text selectable style={[styles.body, { color: colors.textSecondary }]}>{row.message}</Text>
          <View style={styles.actions}>
            {!row.is_read && <Button title="O‘qildi" size="sm" variant="secondary" disabled={Boolean(inbox.busy)} onPress={() => { void inbox.markRead(row.id); }} />}
            {allowed && <Button title={target.label} size="sm" variant="secondary" disabled={Boolean(inbox.busy)} onPress={() => { void open(row); }} />}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${row.title}: o‘chirish`} disabled={Boolean(inbox.busy)} onPress={() => setConfirm(row)} style={styles.icon}><Trash2 size={18} color={colors.textMuted} /></TouchableOpacity>
          </View>
        </View>;
      }}
      ListFooterComponent={inbox.hasMore ? <Button title="Oldingi bildirishnomalar" variant="secondary" loading={inbox.loadingMore} disabled={Boolean(inbox.busy)} onPress={() => { void inbox.loadMore(); }} /> : undefined} />
    <BottomSheet visible={Boolean(confirm)} title="Bildirishnomani o‘chirish" onClose={() => { if (!inbox.busy) setConfirm(null); }}>
      <Text style={{ color: colors.text, marginBottom: 16 }}>{confirm === 'all' ? 'Barcha bildirishnomalar o‘chiriladi. Bu amalni qaytarib bo‘lmaydi.' : 'Ushbu bildirishnomani o‘chirasizmi?'}</Text>
      <Button title="O‘chirishni tasdiqlash" variant="danger" loading={Boolean(inbox.busy)} onPress={remove} /><Button title="Bekor qilish" variant="ghost" disabled={Boolean(inbox.busy)} onPress={() => setConfirm(null)} />
    </BottomSheet>
    <BottomSheet visible={preferences} title="Bildirishnoma sozlamalari" onClose={() => setPreferences(false)} scrollable><NotificationPreferences key={scopeKey} /></BottomSheet>
    <BottomSheet visible={Boolean(focusedId && focused)} title="Bildirishnoma" onClose={() => router.setParams({ notificationId: '' })} scrollable>
      {focused && <View style={{ gap: 12 }}><Text style={[styles.title, { color: colors.text }]}>{focused.title}</Text><Text selectable style={[styles.body, { color: colors.textSecondary }]}>{focused.message}</Text>
        {!focused.is_read && <Button title="O‘qildi" disabled={Boolean(inbox.busy)} onPress={() => { void inbox.markRead(focused.id); }} />}
        {(() => { const target = notificationDestination(focused); return target && canOpen(target.module) ? <Button title={target.label} onPress={async () => { router.setParams({ notificationId: '' }); await open(focused); }} /> : null; })()}
      </View>}
    </BottomSheet>
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1 }, icon: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }, summary: { flex: 1, fontWeight: '600' }, message: { padding: 16, gap: 8 }, list: { padding: 16, paddingTop: 4, flexGrow: 1 }, empty: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 12 }, card: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10, marginBottom: 12 }, meta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }, category: { fontWeight: '600', fontSize: 12 }, title: { fontSize: 16, fontWeight: '700' }, body: { fontSize: 14, lineHeight: 21 }, actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 } });
