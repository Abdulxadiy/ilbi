import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight, LogOut, RefreshCw, Store } from 'lucide-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from './AuthContext';
import { Page, Notice, Loading, Retry } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { useTheme } from '../../theme/ThemeContext';
import { request } from '../../api/client';

export function SessionRecovery() {
  const { sessionError, refreshProfile, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch {} finally { setBusy(false); } };
  return <Page title="Sessiyani tiklash"><Notice error>{sessionError || 'Sessiya tasdiqlanmadi.'}</Notice><Notice>Internet aloqasini tekshiring. Qoralamalar va yuborilmagan amallar saqlanadi.</Notice><Button title="Qayta tekshirish" loading={busy} onPress={() => run(refreshProfile)} /><Button title="Hisobdan chiqish" variant="secondary" onPress={() => run(logout)} /></Page>;
}
export function TermsScreen() {
  const { acceptTerms, logout } = useAuth();
  const [checked, setChecked] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const { colors } = useTheme();
  const accept = async () => { setBusy(true); try { await acceptTerms(); router.replace('/'); } catch (error: any) { setError(error.message); } finally { setBusy(false); } };
  return <Page title="Foydalanish shartlari"><Notice>Davom etishdan oldin amaldagi hujjatlarni o‘qing va roziligingizni tasdiqlang.</Notice>
    {[['ommaviy_oferta', 'Ommaviy oferta'], ['maxfiylik_siyosati', 'Maxfiylik siyosati'], ['foydalanish_qoidalari', 'Foydalanish qoidalari']].map(([doc, title]) => <Button key={doc} title={title} variant="secondary" onPress={() => router.push({ pathname: '/legal', params: { doc } })} />)}
    <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => setChecked(value => !value)} style={{ paddingVertical: 16 }}><Text style={{ color: colors.text }}>{checked ? '☑' : '☐'} Hujjatlarni o‘qidim va shartlarga roziman</Text></TouchableOpacity>
    {error ? <Notice error>{error}</Notice> : null}<Button title="Qabul qilish va davom etish" disabled={!checked} loading={busy} onPress={accept} /><Button title="Hisobdan chiqish" variant="ghost" onPress={() => logout().catch(error => setError(error.message))} />
  </Page>;
}
export function StoreSelection() {
  const { user, selectTenant, refreshProfile, logout, activeTenant } = useAuth();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  return (
    <Page
      title="Do‘konni tanlang"
      onBack={user?.tenants.length && (activeTenant || router.canGoBack()) ? () => (router.canGoBack() ? router.back() : router.replace('/')) : undefined}
    >
      <Notice>
        {user?.tenants.length
          ? 'Savdo qaysi do‘kon yoki filial nomidan bajarilishini tanlang.'
          : 'Faol do‘kon vakolati topilmadi. Do‘kon egasi bilan bog‘laning yoki hisobni qayta tekshiring.'}
      </Notice>

      <View style={gateStyles.storesList}>
        {user?.tenants.map(tenant => (
          <TouchableOpacity
            key={tenant.id}
            disabled={busy}
            accessibilityRole="button"
            onPress={async () => {
              setBusy(true);
              try {
                await selectTenant(tenant.id);
                router.replace('/');
              } catch (err: any) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
            style={[
              gateStyles.storeCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[gateStyles.storeIconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <Store size={22} color={colors.text} />
            </View>

            <View style={gateStyles.storeDetails}>
              <Text style={[gateStyles.storeName, { color: colors.text }]}>{tenant.name}</Text>
              <View style={gateStyles.storeBadgesRow}>
                <View style={[gateStyles.badgePill, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[gateStyles.badgeText, { color: colors.textSecondary }]}>
                    {tenant.is_owner ? 'Do‘kon egasi' : 'Xodim'}
                  </Text>
                </View>
                <Text style={[gateStyles.storeIdText, { color: colors.textMuted }]}>
                  ID: #{tenant.id}
                </Text>
              </View>
            </View>

            <ChevronRight size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      {error ? <Notice error>{error}</Notice> : null}

      <View style={gateStyles.actionsFooter}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => refreshProfile().catch(err => setError(err.message))}
          style={gateStyles.footerActionBtn}
        >
          <RefreshCw size={15} color={colors.textSecondary} />
          <Text style={[gateStyles.footerActionText, { color: colors.textSecondary }]}>
            Vakolatlarni qayta tekshirish
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => logout().catch(err => setError(err.message))}
          style={[gateStyles.footerActionBtn, { marginTop: 12 }]}
        >
          <LogOut size={15} color={colors.danger} />
          <Text style={[gateStyles.footerActionText, { color: colors.danger }]}>
            Hisobdan chiqish
          </Text>
        </TouchableOpacity>
      </View>
    </Page>
  );
}
export function LegalDocument() {
  const { doc = 'ommaviy_oferta' } = useLocalSearchParams<{ doc?: string }>();
  const { colors } = useTheme();
  const [state, setState] = useState<{ key: string; value?: any; error?: string }>({ key: '' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    request('/docs/?doc=' + encodeURIComponent(doc), { signal: controller.signal, skipTenant: true }).then(value => { if (!controller.signal.aborted) setState({ key: doc, value }); }).catch(error => { if (!controller.signal.aborted) setState({ key: doc, error: error.message }); });
    return () => controller.abort();
  }, [doc, version]);
  const current = state.key === doc ? state : null;
  return <Page title={current?.value?.title || 'Hujjat'} onBack={() => router.canGoBack() ? router.back() : router.replace('/')}>
    {current?.error ? <Retry error={current.error} retry={() => { setState({ key: '' }); setVersion(value => value + 1); }} /> : current?.value ? <ScrollView><Text selectable style={{ color: colors.text, fontSize: 15, lineHeight: 24 }}>{current.value.content}</Text></ScrollView> : <Loading />}
  </Page>;
}

const gateStyles = StyleSheet.create({
  storesList: {
    gap: 12,
    marginVertical: 12,
  },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    gap: 14,
  },
  storeIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeDetails: {
    flex: 1,
  },
  storeName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  storeBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badgePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  storeIdText: {
    fontSize: 11,
  },
  actionsFooter: {
    marginTop: 20,
    alignItems: 'center',
  },
  footerActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  footerActionText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
