import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { request } from '../../api/client';
import { Page, Notice, Loading, Retry } from '../../components/ui/Page';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useAppNavigation } from '../../navigation/useAppNavigation';
export default function AdminHome() {
  const { user } = useAuth(), { colors } = useTheme(), navigation = useAppNavigation();
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [version, setVersion] = useState(0);
  useEffect(() => {
    if (user?.role !== 'platform_admin') return;
    const controller = new AbortController();
    request('/platform/overview/', { skipTenant: true, signal: controller.signal }).then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [user?.role, version]);
  if (user?.role !== 'platform_admin') return <Page title="Ruxsat yo‘q"><Notice error>Bu bo‘lim platforma administratori uchun.</Notice></Page>;
  return <Page title="Platforma boshqaruvi" onBack={navigation.goBack}>
    {error ? <Retry error={error} retry={() => { setError(''); setVersion(value => value + 1); }} /> : !data ? <Loading /> : <>
      {[['accounts', 'Hisoblar'], ['tenants', 'Do‘konlar'], ['support_waiting', 'Kutayotgan murojaatlar'], ['seller_pending', 'Sotuvchi tekshiruvi']].map(([key, title]) => <View key={key} style={{ padding: 18, borderRadius: 12, backgroundColor: colors.surface }}><Text style={{ color: colors.textSecondary }}>{title}</Text><Text style={{ fontSize: 26, color: colors.text }}>{data.counts?.[key] ?? '—'}</Text></View>)}
      <Notice>Telegram: {data.telegram_configured ? 'sozlangan' : 'sozlanmagan'}</Notice>
      {(data.activity || []).map((row: any) => <View key={row.id}><Text style={{ color: colors.text }}>{row.actor} · {row.action}</Text><Notice>{row.description}</Notice></View>)}
    </>}
  </Page>;
}
