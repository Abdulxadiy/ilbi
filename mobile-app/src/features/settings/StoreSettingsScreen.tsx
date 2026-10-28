import { useCallback, useEffect, useRef, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { ListState } from '../../components/ui/ListState';
import { useFormErrors } from '../../hooks/useFormErrors';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useTheme } from '../../theme/ThemeContext';
import { parseTaxSettings, taxLine } from '../../domain/tax';
import { saveStoreSection, sendStoreAction, storeActions, type StoreAction } from './storeCommands';
import { convertStoreCurrency, parseStoreSettings, sectionSupported, settingsDraft, storeFields, storeSections, type StoreDraft, type StoreSection, type StoreSettings } from './storeModel';

export function StoreSettingsScreen() {
  const { user, activeTenant } = useAuth();
  return <StoreSettingsBody key={[getServerScope(), user?.id, activeTenant?.id].join('|')} />;
}
function StoreSettingsBody() {
  const { activeTenant } = useAuth(), { can } = usePermissions(), navigation = useAppNavigation();
  const [data, setData] = useState<StoreSettings | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [reloadVersion, setReloadVersion] = useState(0);
  const sequence = useRef(0), permitted = can('tenants.manage_settings'), tenantId = activeTenant?.id;
  const cancel = useCallback(() => { sequence.current++; }, []);
  const load = useCallback(async () => {
    const current = ++sequence.current;
    if (!permitted || !tenantId) return;
    setLoading(true); setError(''); const scope = captureAuthScope();
    try {
      const result = parseStoreSettings(await request('/tenants/current/')); assertAuthScope(scope);
      if (result.id !== tenantId) throw Error('Server boshqa do‘kon sozlamalarini qaytardi.');
      if (sequence.current === current) { setData(result); return true; }
    } catch (failure: any) { if (sequence.current === current) setError(failure.message || 'Sozlamalar yuklanmadi.'); return false; }
    finally { if (sequence.current === current) setLoading(false); }
  }, [permitted, tenantId]);
  useEffect(() => { let active = true; void Promise.resolve().then(() => { if (active) return load(); }); return () => { active = false; cancel(); }; }, [cancel, load]);
  return <Page title="Do‘kon sozlamalari" onBack={() => navigation.goBack()}>
    {!permitted ? <Notice error>Do‘kon sozlamalarini boshqarish uchun vakolat kerak.</Notice> : <>
      <ListState loading={loading} error={error} onRetry={load} />
      {data && <StoreEditor key={reloadVersion} initial={data} onReload={async () => { if (!await load()) throw Error('Yangi qiymatlar olinmadi. Tahrirlaringiz saqlandi.'); setReloadVersion(value => value + 1); }} />}
    </>}
  </Page>;
}
function StoreEditor({ initial, onReload }: { initial: StoreSettings; onReload: () => Promise<void> }) {
  const { user, activeTenant } = useAuth(), { colors } = useTheme(), fields = useFormErrors();
  const [snapshot, setSnapshot] = useState(initial), [draft, setDraft] = useState<StoreDraft>(() => settingsDraft(initial));
  const [baselines, setBaselines] = useState<Record<StoreSection, StoreSettings>>(() => Object.fromEntries(Object.keys(storeSections).map(section => [section, initial])) as Record<StoreSection, StoreSettings>);
  const [section, setSection] = useState<StoreSection>('identity'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<StoreAction | 'reload' | null>(null), [uncertain, setUncertain] = useState<StoreAction | null>(null);
  const [calculator, setCalculator] = useState('100'), [direction, setDirection] = useState('UZS');
  const lock = useRef(false);
  const set = (field: string, value: string | boolean) => { setDraft(previous => ({ ...previous, [field]: value })); fields.clear(field); setMessage(''); };
  const save = async () => {
    if (lock.current || !user || !activeTenant) return;
    lock.current = true; setBusy(true); setError(''); setMessage(''); fields.clear();
    const scope = captureAuthScope();
    try {
      const saved = await saveStoreSection(section, draft, baselines[section], user, activeTenant); assertAuthScope(scope);
      const values = settingsDraft(saved);
      setBaselines(previous => ({ ...previous, [section]: saved })); setSnapshot(saved);
      setDraft(previous => ({ ...previous, ...Object.fromEntries(storeSections[section].fields.map(field => [field, values[field]])) }));
      setMessage('Ushbu bo‘lim sozlamalari serverda tasdiqlandi.');
    } catch (failure: any) { try { assertAuthScope(scope); fields.capture(failure); setError(failure.message || 'Sozlamalar saqlanmadi.'); } catch {} }
    finally { lock.current = false; setBusy(false); }
  };
  const perform = async () => {
    if (!confirm || lock.current || !user || !activeTenant) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    const action = confirm, scope = captureAuthScope();
    try {
      if (action === 'reload') await onReload();
      else { const detail = await sendStoreAction(action, user, activeTenant); assertAuthScope(scope); setMessage(detail); }
      setConfirm(null);
    } catch (failure: any) {
      try {
        assertAuthScope(scope);
        if (action !== 'reload' && (!failure.status || failure.status >= 500)) setUncertain(action);
        setError(failure.message || 'Amal tasdiqlanmadi.'); setConfirm(null);
      } catch {}
    } finally { lock.current = false; setBusy(false); }
  };
  const supported = sectionSupported(snapshot, section), readOnly = !snapshot.revision || !supported;
  let conversion = '';
  let previewTotals: ReturnType<typeof taxLine> | null = null;
  if (['identity', 'receipt', 'tax'].includes(section)) {
    try { previewTotals = taxLine('1', '100000', parseTaxSettings(draft)); } catch {}
  }
  if (section === 'currency') {
    try { conversion = convertStoreCurrency(calculator, draft.auto_usd_rate ? snapshot.rates.USD?.rate || '' : String(draft.usd_rate || ''), direction as 'UZS' | 'USD'); } catch {}
  }
  return <View style={{ gap: 16 }}>
    <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>{snapshot.name}</Text>
    {snapshot.receiptIdentity.seller_name ? <Notice>Sotuvchi: {snapshot.receiptIdentity.seller_name} · STIR: {snapshot.receiptIdentity.seller_tax_identifier || '—'}</Notice> : null}
    {snapshot.receiptIdentity.store_code ? <Notice>Do‘kon kodi: {snapshot.receiptIdentity.store_code}</Notice> : null}
    <ChoiceField label="Sozlama bo‘limi" value={section} disabled={busy} onChange={value => { setSection(value as StoreSection); fields.clear(); setError(''); setMessage(''); }} options={Object.entries(storeSections).map(([value, row]) => ({ value, label: row.title }))} />
    <Notice>Faqat tanlangan bo‘limdagi o‘zgartirilgan qiymatlar saqlanadi. Oldingi cheklar o‘zining saqlangan ma’lumotidan foydalanadi.</Notice>
    {readOnly ? <Notice error>Bu serverda ushbu bo‘limni xavfsiz saqlash hali mavjud emas. Ma’lumotlar ko‘rsatildi; server yangilanishi kerak.</Notice> : null}
    {section === 'currency' && <>
      <Notice>Serverdagi amaldagi USD kursi: {snapshot.effectiveUsdRate || 'Mavjud emas'} UZS</Notice>
      {Object.entries(snapshot.rates).map(([code, row]) => <Notice key={code}>CBU {code}: {row.rate} UZS · {row.date}</Notice>)}
      {draft.auto_usd_rate && !snapshot.rates.USD ? <Notice error>CBU dollar kursi serverda hali yo‘q. Avtomatik rejim saqlanmaydi.</Notice> : null}
    </>}
    {section === 'schedule' && <Notice>Hisobot vaqti: Toshkent (UTC+5). Haftada 1=Dushanba, 7=Yakshanba; oy sanasi 1–31. Hisobotlar serverdagi reja asosida yuboriladi.</Notice>}
    {section === 'telegram' && <Notice>Guruh IDsi: −100… yoki @kanal_nomi. Saqlash xabar yubormaydi. Telefonning push ruxsati Bildirishnomalar bo‘limida alohida yoqiladi.</Notice>}
    {storeSections[section].fields.map(field => {
      if (field === 'low_stock_weekday' && draft.low_stock_frequency !== 'weekly' || field === 'low_stock_day_of_month' && draft.low_stock_frequency !== 'monthly') return null;
      const definition = storeFields[field], disabled = busy || readOnly || field === 'usd_rate' && draft.auto_usd_rate === true;
      if (definition.kind === 'boolean') return <View key={field} style={{ gap: 5 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 8, borderRadius: 10, borderWidth: 1, borderColor: fields.errors[field] ? colors.danger : colors.border }}><Text style={{ color: colors.text, flex: 1 }}>{definition.label}</Text><Switch accessibilityLabel={definition.label} accessibilityHint={fields.errors[field]} aria-invalid={Boolean(fields.errors[field])} disabled={disabled} value={draft[field] === true} onValueChange={value => set(field, value)} /></View>{fields.errors[field] && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{fields.errors[field]}</Text>}</View>;
      if (definition.kind === 'choice') return <ChoiceField key={field} label={definition.label} value={String(draft[field] ?? '')} options={[...definition.options!]} disabled={disabled} error={fields.errors[field]} onChange={value => set(field, value)} />;
      return <Input key={field} label={definition.label} value={String(draft[field] ?? '')} editable={!disabled} error={fields.errors[field]} multiline={definition.kind === 'long'} maxLength={definition.max && definition.kind !== 'integer' ? definition.max : definition.kind === 'time' ? 8 : undefined} keyboardType={['rate', 'money'].includes(definition.kind) ? 'decimal-pad' : definition.kind === 'integer' ? 'number-pad' : 'default'} placeholder={definition.kind === 'time' ? 'HH:MM' : undefined} onChangeText={value => set(field, value)} />;
    })}
    {error ? <Notice error>{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    <Button title="Bo‘limni saqlash" loading={busy} disabled={readOnly} onPress={save} />
    {['identity', 'receipt', 'tax'].includes(section) && <View accessibilityLabel="Yangi chek ko‘rinishining namunasi" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 16, alignSelf: 'center', width: '100%', maxWidth: draft.receipt_paper_width === '80mm' ? 380 : 300, gap: 8 }}>
      <Text style={{ color: colors.text, fontWeight: '700', textAlign: 'center' }}>Chek namunasi</Text>
      <Text style={{ color: colors.text, textAlign: 'center' }}>{snapshot.name}</Text>
      {['address', 'receipt_phone', 'receipt_header'].map(field => draft[field] ? <Text key={field} style={{ color: colors.textSecondary, textAlign: 'center' }}>{String(draft[field])}</Text> : null)}
      {draft.receipt_show_cashier ? <Text style={{ color: colors.textSecondary }}>Sotuvchi: Namuna kassir</Text> : null}
      {draft.receipt_show_customer ? <Text style={{ color: colors.textSecondary }}>Mijoz: Namuna mijoz</Text> : null}
      <Text style={{ color: colors.text }}>Namuna tovar · 1 dona × 100 000 UZS</Text>
      {previewTotals ? <><Text style={{ color: colors.text, fontWeight: '700' }}>Jami: {(Number(previewTotals.totalMinor) / 100).toLocaleString('ru-RU')} UZS</Text>{draft.receipt_show_item_tax ? <Text style={{ color: colors.textSecondary }}>QQS: {(Number(previewTotals.taxMinor) / 100).toLocaleString('ru-RU')} UZS</Text> : null}</> : <Notice error>Namuna uchun QQS stavkasi va narx rejimini tekshiring.</Notice>}
      {draft.receipt_footer ? <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>{String(draft.receipt_footer)}</Text> : null}
      <Notice>Ko‘rinish namunasi. Savdo yaratilmaydi; oldingi cheklar o‘zgarmaydi.</Notice>
    </View>}
    {section === 'currency' && <>
      <ChoiceField label="Hisoblash yo‘nalishi" value={direction} options={[{ value: 'UZS', label: 'USD → UZS' }, { value: 'USD', label: 'UZS → USD' }]} onChange={setDirection} />
      <Input label="Hisoblash summasi" value={calculator} keyboardType="decimal-pad" onChangeText={setCalculator} />
      <Notice>Hisob-kitob namunasi: {conversion || 'Summa yoki kursni tekshiring.'}{conversion ? ' ' + direction : ''}. Bu savdo yoki pul o‘tkazmasi emas.</Notice>
    </>}
    {(section === 'telegram' || section === 'schedule') && <>
      <Notice>Quyidagi amallar serverda saqlangan sozlamalardan foydalanadi. Avval o‘zgarishlarni saqlang.</Notice>
      {(Object.entries(storeActions) as [StoreAction, typeof storeActions[StoreAction]][]).map(([action, definition]) => <Button key={action} title={definition.title} variant="secondary" disabled={busy || uncertain === action} onPress={() => setConfirm(action)} />)}
      {uncertain && <><Notice error>Yuborish natijasi noma’lum. Avval Telegramni tekshiring; avtomatik qayta yuborilmadi.</Notice><Button title="Telegramni tekshirdim, yangi so‘rovga ruxsat berish" variant="secondary" disabled={busy} onPress={() => setUncertain(null)} /></>}
    </>}
    <Button title="Serverdan qayta yuklash" variant="ghost" disabled={busy} onPress={() => setConfirm('reload')} />
    <BottomSheet visible={confirm !== null} title={confirm === 'reload' ? 'Sozlamalarni qayta yuklash' : 'Yuborishni tasdiqlash'} onClose={() => { if (!busy) setConfirm(null); }}>
      <View style={{ gap: 12 }}><Notice>{confirm === 'reload' ? 'Saqlanmagan tahrirlar o‘rniga serverdagi joriy qiymatlar olinadi.' : 'Bu amal sozlangan Telegram manzillariga haqiqiy xabar yuboradi. Davom etasizmi?'}</Notice><Button title={confirm === 'reload' ? 'Qayta yuklashni tasdiqlash' : 'Xabar yuborishni tasdiqlash'} loading={busy} onPress={perform} /><Button title="Bekor qilish" variant="ghost" disabled={busy} onPress={() => setConfirm(null)} /></View>
    </BottomSheet>
  </View>;
}
