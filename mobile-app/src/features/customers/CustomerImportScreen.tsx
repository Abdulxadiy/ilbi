import { useEffect, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { getServerScope } from '../../api/environment';
import { assertAuthScope, captureAuthScope } from '../../api/client';
import { PendingOperationError } from '../../api/financialIdentity';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { acknowledgeCustomerImport, commitCustomerImport, previewCustomerImport, type AcceptedImport } from './importCommands';
import { importFields, importMoney, parseImportJob, type ImportJob } from './importModel';
import { downloadCustomerTemplate, pickSpreadsheet, releasePickedSpreadsheet, spreadsheetBody, type PickedSpreadsheet } from './importFiles';

export function CustomerImportScreen() {
  const { user, activeTenant } = useAuth();
  return <CustomerImport key={[getServerScope(), user?.id, activeTenant?.id].join(':')} />;
}
function CustomerImport() {
  const { user, activeTenant } = useAuth(), { can } = usePermissions(), navigation = useAppNavigation(), { colors } = useTheme();
  const [file, setFile] = useState<PickedSpreadsheet | null>(null), [job, setJob] = useState<ImportJob | null>(null), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false), [accepted, setAccepted] = useState(false), [needsReview, setNeedsReview] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [done, setDone] = useState<AcceptedImport['result'] | null>(null), [query, setQuery] = useState(''), [errorsOnly, setErrorsOnly] = useState(false), [page, setPage] = useState(1);
  const processing = useRef(false), completed = useRef(false), mounted = useRef(true), picked = useRef<PickedSpreadsheet | null>(null), acceptedRecord = useRef<AcceptedImport | null>(null), frozen = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (!processing.current && picked.current) void releasePickedSpreadsheet(picked.current); }; }, []);
  const run = async (work: () => Promise<void>) => {
    if (processing.current || !user || !activeTenant || !can('sales.manage_counterparty')) return;
    processing.current = true; setBusy(true); setError(''); setMessage('');
    const scope = captureAuthScope(user.id, activeTenant.id);
    try { assertAuthScope(scope); await work(); }
    catch (failure: any) { if (mounted.current) { setError(failure.message || 'Import yakunlanmadi.'); if (failure instanceof PendingOperationError) setNeedsReview(true); } }
    finally { processing.current = false; if (mounted.current) setBusy(false); else if (picked.current) void releasePickedSpreadsheet(picked.current); }
  };
  const choose = () => run(async () => {
    if (frozen.current || acceptedRecord.current || completed.current) return;
    const scope = captureAuthScope(user!.id, activeTenant!.id), next = await pickSpreadsheet();
    try { assertAuthScope(scope); } catch (failure) { if (next) await releasePickedSpreadsheet(next); throw failure; }
    if (!next) return;
    if (!mounted.current) { await releasePickedSpreadsheet(next); return; }
    if (picked.current) await releasePickedSpreadsheet(picked.current);
    picked.current = next; setFile(next); setJob(null); setDone(null); setPage(1); setErrorsOnly(false); setNeedsReview(false);
  });
  const preview = () => run(async () => {
    if (!file || frozen.current) return;
    const next = await previewCustomerImport(spreadsheetBody(file), user!, activeTenant!);
    if (!mounted.current) return;
    setJob(next); setPage(1); setQuery(''); setErrorsOnly(false);
    await releasePickedSpreadsheet(file); picked.current = null; setFile(null);
  });
  const commit = () => run(async () => {
    if (completed.current || !job?.payload) return;
    try {
      const result = acceptedRecord.current ? await acknowledgeCustomerImport(acceptedRecord.current) : await commitCustomerImport(job.payload, user!, activeTenant!, record => { acceptedRecord.current = record; if (mounted.current) setAccepted(true); }, pending => { frozen.current = pending; if (mounted.current) setLocked(pending); });
      completed.current = true;
      if (mounted.current) { setDone(result); setJob(null); }
    } catch (failure: any) {
      if (mounted.current && !frozen.current && !acceptedRecord.current && Array.isArray(failure.data?.rows)) {
        // A definitive fresh rejection can provide revalidated row errors.
        const originalRows = new Set(job.rows.map(row => row.row_number));
        if (failure.data.rows.length !== originalRows.size || new Set(failure.data.rows.map((row: any) => row?.row_number)).size !== originalRows.size || failure.data.rows.some((row: any) => !originalRows.has(row?.row_number))) {
          // Error sanitization may bound a long response. Never reinterpret a
          // truncated error array as a smaller, valid financial import.
          setJob({ ...job, payload: null });
          throw Error('Server qator xatolarini to‘liq qaytarmadi. Faylni tuzatib, qayta tekshiring.');
        }
        const updated = parseImportJob({ id: job.id, rows: failure.data.rows, expires_at: job.expires_at, completed_at: null, operation_context: { protocol: 'ilbi-counterparty-import-v1', actor_id: user!.id, tenant_id: activeTenant!.id, job_id: job.id } }, job.scope);
        setJob({ ...updated, payload: null });
      }
      throw failure;
    }
  });
  const rows = job?.rows.filter(row => (!errorsOnly || Object.keys(row.errors).length) && (!query.trim() || Object.values(row.data).some(value => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))) || [];
  const invalidCount = job?.rows.filter(row => Object.keys(row.errors).length).length || 0;
  const header = <View style={{ gap: 12 }}>
    {!can('sales.manage_counterparty') ? <Notice error>Mijozlarni yuklash uchun vakolat berilmagan.</Notice> : <>
      <Notice>1. Shablonni to‘ldiring. 2. Faylni tekshiring. 3. Hisobni ko‘rib, saqlashni tasdiqlang.</Notice>
      <Notice>Ko‘pi bilan 1000 qator, 8 MB, .xlsx yoki .csv. Telefonlar takrorlanmasin. Mavjud mijozlar o‘zgarmaydi. Boshlang‘ich nasiya tarixga yoziladi, kassa va savdo tushumiga qo‘shilmaydi.</Notice>
      {!locked && !accepted && !done && <><Button title="Mijozlar shablonini olish" variant="secondary" disabled={busy} onPress={() => run(async () => { const value = await downloadCustomerTemplate(user!.id, activeTenant!.id); if (mounted.current) setMessage(value); })} /><Button title={file || job ? 'Boshqa Excel / CSV faylni tanlash' : 'Excel / CSV faylni tanlash'} disabled={busy} onPress={choose} /></>}
      {file && <><Notice>Tanlangan fayl: {file.name} · {Math.ceil(file.size / 1024)} KB</Notice><Button title="Fayldagi mijozlarni tekshirish" loading={busy} onPress={preview} /></>}
      {job && <><Text style={{ color: colors.text, fontWeight: '700' }}>{job.rows.length} ta qator · {!job.payload && !invalidCount ? 'Qator xatolari to‘liq olinmadi' : `Xatoli: ${invalidCount}`}</Text><Notice>Ko‘rib chiqish muddati: {new Date(job.expires_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}. Saqlashda server yana tekshiradi.</Notice>
        {job.payload ? <><Notice>Boshlang‘ich nasiya: {importMoney(job.payload.expected_total_debt_uzs)} UZS / {importMoney(job.payload.expected_total_debt_usd)} USD</Notice>{accepted ? <Notice>Server importni qabul qildi. Mahalliy tasdiqni saqlashni yakunlang.</Notice> : locked ? <Notice>Natija noma’lum. Qayta tekshirish faqat shu importni davom ettiradi.</Notice> : <Notice>Quyidagi tugma barcha {job.rows.length} ta mijoz va ko‘rsatilgan boshlang‘ich nasiya hisobini saqlaydi.</Notice>}
          <Button title={accepted ? 'Import tasdiqini telefonga qayta saqlash' : locked ? 'Asl import natijasini tekshirish' : `${job.rows.length} ta mijozni saqlashni tasdiqlash`} loading={busy} onPress={commit} /></> : <Notice error>Xatoli qatorlar bor. Faylni tuzatib, qayta tanlang. Hech qanday mijoz saqlanmadi.</Notice>}
        <Input label="Import qatorlarini qidirish" value={query} onChangeText={value => { setQuery(value); setPage(1); }} />
        <Button title={errorsOnly ? 'Barcha import qatorlarini ko‘rsatish' : 'Faqat xatoli import qatorlari'} variant="ghost" onPress={() => { setErrorsOnly(value => !value); setPage(1); }} />
      </>}
      {done && <><Text style={{ color: colors.text, fontWeight: '700' }}>{done.created_count} ta mijoz importi tasdiqlandi.</Text><Notice>Boshlang‘ich nasiya: {importMoney(done.total_debt_uzs)} UZS / {importMoney(done.total_debt_usd)} USD</Notice><Button title="Mijozlar ro‘yxatiga o‘tish" onPress={() => navigation.navigate('Customers')} /><Button title="Yana mijozlar faylini yuklash" variant="secondary" onPress={() => { completed.current = false; acceptedRecord.current = null; frozen.current = false; setDone(null); setAccepted(false); setLocked(false); setNeedsReview(false); }} /></>}
    </>}
    {error ? <Notice error>{error}</Notice> : null}{message ? <Notice>{message}</Notice> : null}
    {(locked || needsReview) && !done && <Button title="Import uchun amallar jurnalini ochish" variant="secondary" disabled={busy} onPress={() => navigation.navigate('Sync')} />}
  </View>;
  return <Page title="Mijozlarni fayldan yuklash" onBack={navigation.goBack} insetBottom={false} scroll={false}>
    <FlatList data={rows.slice((page - 1) * 20, page * 20)} keyExtractor={row => String(row.row_number)} ListHeaderComponent={header} contentContainerStyle={{ padding: 16, gap: 12 }}
      ListFooterComponent={<>{job && <View style={{ gap: 8 }}><Notice>{page}-sahifa / {Math.max(1, Math.ceil(rows.length / 20))} · {rows.length} ta mos qator</Notice>{page > 1 && <Button title="Oldingi import qatorlari" variant="secondary" onPress={() => setPage(value => value - 1)} />}{page * 20 < rows.length && <Button title="Keyingi import qatorlari" variant="secondary" onPress={() => setPage(value => value + 1)} />}</View>}</>}
      renderItem={({ item }) => <View style={{ borderWidth: 1, borderColor: Object.keys(item.errors).length ? colors.danger : colors.border, padding: 12, borderRadius: 12, gap: 8, backgroundColor: colors.surface }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>Fayl qatori: {item.row_number} · {item.data.name || 'Nomsiz'}</Text>
        <Notice>{item.data.phone_number || 'Telefon kiritilmagan'}</Notice><Notice>Nasiya: {item.data.debt_balance_uzs || '0'} UZS / {item.data.debt_balance_usd || '0'} USD</Notice>
        {item.data.note ? <Notice>{item.data.note}</Notice> : null}
        {Object.entries(item.errors).map(([field, value]) => <Notice key={field} error>{`${importFields[field as keyof typeof importFields]}: ${value}`}</Notice>)}
      </View>} />
  </Page>;
}
