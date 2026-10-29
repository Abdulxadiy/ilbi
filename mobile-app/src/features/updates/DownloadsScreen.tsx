import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { useTheme } from '../../theme/ThemeContext';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { isDesignPreview } from '../../dev/preview';
import { useUpdates } from './UpdatesProvider';
import type { Release, ReleasePlatform } from './releases';

const labels: Record<ReleasePlatform, string> = { android: 'Android', ios: 'iPhone va iPad', windows: 'Windows · 64 bit', linux: 'Linux · x86_64' };
function ReleaseCard({ platform, release }: { platform: ReleasePlatform; release: Release | null }) {
  const { colors } = useTheme(), updates = useUpdates();
  return <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 10 }}>
    <Text style={{ color: colors.text, fontWeight: '700', fontSize: 18 }}>{labels[platform]} uchun ILBI</Text>
    {release ? <><Notice>v{release.version}{release.buildNumber ? ' · ' + release.buildNumber : ''}{release.bytes ? ' · ' + (release.bytes / 1024 ** 2).toFixed(1) + ' MB' : ''}{release.channel === 'preview' ? ' · Sinov nusxasi' : ''}</Notice>
      <Button title={release.kind === 'store' ? 'Ilovalar do‘konida ochish' : labels[platform] + ' uchun yuklab olish'} disabled={isDesignPreview || updates.opening} onPress={() => { void updates.open(release); }} />
    </> : <Notice>Rasmiy yuklama hali joylanmagan.</Notice>}
  </View>;
}
export function DownloadsScreen({ tabbed = false }: { tabbed?: boolean }) {
  const updates = useUpdates(), navigation = useAppNavigation(), params = useLocalSearchParams<{ tab?: string }>();
  const { refresh } = updates;
  const [tab, setTab] = useState<'updates' | 'downloads'>(params.tab === 'downloads' ? 'downloads' : 'updates');
  useEffect(() => { void refresh(); }, [refresh]);
  return <Page title="Yuklab olish" onBack={navigation.goBack} insetBottom={!tabbed}>
    <ChoiceField label="Yuklamalar bo‘limi" value={tab} onChange={setTab} options={[{ value: 'updates', label: 'Yangilanish' }, { value: 'downloads', label: 'Yuklab olish' }]} />
    {isDesignPreview ? <Notice>Dizayn rejimi: haqiqiy paketlar yuklanmaydi.</Notice> : null}
    {updates.error ? <Notice error>{updates.error}{updates.feed ? ' Oxirgi tekshirilgan ro‘yxat ko‘rsatilmoqda.' : ''}</Notice> : null}
    {updates.actionMessage ? <Notice>{updates.actionMessage}</Notice> : null}
    {tab === 'updates' ? <>
      <Notice>{updates.installed ? `Sizdagi versiya: v${updates.installed.version} · ${updates.installed.buildNumber}` : 'O‘rnatilgan ilova versiyasi Android yoki iOS ilovasida ko‘rsatiladi.'}</Notice>
      {updates.candidate ? <><Notice>Yangi versiya mavjud: v{updates.candidate.version} · {updates.candidate.buildNumber}. Yangilashni qurilmangizdagi rasmiy oynada tugating.</Notice><Button title="Yangilash" loading={updates.opening} onPress={() => { void updates.open(updates.candidate!); }} /></> : updates.feed && updates.installed && updates.feed[updates.installed.platform] ? <Notice>{updates.error ? 'Yangilanish holatini tasdiqlash uchun qayta tekshiring.' : 'Yangiroq versiya topilmadi.'}</Notice> : <Notice>Bu qurilma uchun rasmiy reliz ma’lumoti hali mavjud emas.</Notice>}
      {updates.checkedAt ? <Notice>Tekshirildi: {new Date(updates.checkedAt).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}</Notice> : null}
      <Button title="Barcha ilovalarni ko‘rish" variant="secondary" onPress={() => setTab('downloads')} />
    </> : <>
      <Notice>Rasmiy ILBI paketlari. Platforma va mobil ilova versiyalari alohida yuritiladi.</Notice>
      {(['android', 'ios', 'windows', 'linux'] as ReleasePlatform[]).map(platform => <ReleaseCard key={platform} platform={platform} release={updates.feed?.[platform] || null} />)}
      <Notice>Android: APK yuklangach uni qurilmada oching yoki Google Play’dan yangilang. iPhone va iPad: App Store yoki TestFlight’dan foydalaning. Mavjud ilovani o‘chirib tashlamasdan yangilang.</Notice>
    </>}
    <Button title="Yangilanishlarni tekshirish" variant="secondary" loading={updates.loading} onPress={() => { void updates.refresh(); }} />
  </Page>;
}
