import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { useAuth } from '../auth/AuthContext';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ApiPicker, type PickValue } from '../../components/ui/ApiPicker';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { ListState } from '../../components/ui/ListState';
import { pageUrl, useDebounced, usePagedResource } from '../../hooks/usePagedResource';
import { useApiResource } from '../../hooks/useApiResource';
import { useApiAction } from '../../hooks/useApiAction';
import { PermissionSelector } from './PermissionSelector';
import { canTeamOperate, employeeAcknowledgement, employeeBase, employeeBody, employeeDraft, employeeName, parseEmployee, parsePermissionChoices, teamManager, teamOperation, type Employee, type EmployeeDraft, type TeamOperation } from './model';

const operationLabels: Record<TeamOperation, string> = { fire: 'Ishdan bo‘shatish', block: 'Hisobni bloklash', unblock: 'Hisobni faollashtirish', archive: 'Arxivlash', restore: 'Arxivdan chiqarish', invite: 'Taklif yuborish' };
const operationHints: Record<TeamOperation, string> = {
  fire: 'Faol ish munosabati tugatiladi va xodim do‘konga kira olmaydi. Tarix saqlanadi. Qayta ishga olish alohida yollash orqali bajariladi.',
  block: 'Hisobga kirish bloklanadi va uning faol sessiyalari bekor qilinadi.',
  unblock: 'Hisob qayta faollashadi. Bu ishdan bo‘shatilgan xodimni qayta yollamaydi.',
  archive: 'Xodim arxivlanadi, do‘kon vakolatlari bekor qilinadi. Savdo va audit tarixi saqlanadi.',
  restore: 'Faqat arxiv belgisi olib tashlanadi. Xodim faol ishga avtomatik qaytmaydi; qayta yollash talab qilinadi.',
  invite: 'Tanlangan hisob emailiga maxfiy sozlash havolasi yuboriladi. Qayta yuborish cheklovi bor.',
};
export function EmployeesScreen() {
  const { user, activeTenant } = useAuth();
  return <EmployeesScope key={[getServerScope(), user?.id, user?.role, activeTenant?.id].join(':')} />;
}
function EmployeesScope() {
  const { user, activeTenant } = useAuth(), navigation = useAppNavigation();
  const params = useLocalSearchParams<{ tenantId?: string }>();
  const initialId = Number(params.tenantId);
  const [selected, setSelected] = useState<PickValue | null>(() => user?.role === 'platform_admin' && Number.isSafeInteger(initialId) && initialId > 0 ? { id: initialId, name: `Do‘kon #${initialId}` } : null);
  const manager = teamManager(user, activeTenant), tenantId = user?.role === 'platform_admin' ? selected?.id : activeTenant?.id;
  return <Page title="Xodimlar" onBack={navigation.goBack} scroll={false} insetBottom={user?.role === 'platform_admin'}>
    {!manager ? <View style={{ padding: 16 }}><Notice error>Xodimlar boshqaruvi uchun shu do‘kon egasi yoki platforma administratori bo‘lish kerak.</Notice></View> : <>
      {user?.role === 'platform_admin' && <View style={{ padding: 16 }}><ApiPicker label="Xodimlar do‘koni" endpoint="/tenants/" value={selected} onChange={setSelected} /></View>}
      {tenantId ? <EmployeesBody key={tenantId} tenantId={tenantId} /> : <View style={{ padding: 16 }}><Notice>Xodimlarni ko‘rish uchun do‘konni tanlang.</Notice></View>}
    </>}
  </Page>;
}
function EmployeesBody({ tenantId }: { tenantId: number }) {
  const { user, activeTenant } = useAuth(), { colors } = useTheme();
  const base = employeeBase(tenantId);
  const options = useMemo(() => ({ skipTenant: true, expectedServerScope: getServerScope(), headers: user?.role === 'platform_admin' ? undefined : { 'X-Tenant-ID': String(tenantId) } }), [user?.role, tenantId]);
  const [search, setSearch] = useState(''), query = useDebounced(search.trim());
  const [filter, setFilter] = useState<'active' | 'inactive' | 'all' | 'archived'>('all');
  const parseRow = useCallback((value: unknown) => parseEmployee(value, tenantId), [tenantId]);
  const endpoint = base + '?' + new URLSearchParams({ search: query, active: filter === 'active' ? 'true' : filter === 'inactive' ? 'false' : 'all', archived: filter === 'archived' ? 'true' : 'false' }).toString();
  const list = usePagedResource(endpoint, parseRow, options);
  const permissions = useApiResource(base + 'permissions/', parsePermissionChoices, options);
  const [editor, setEditor] = useState<Employee | 'new' | null>(null), [draft, setDraft] = useState<EmployeeDraft>(employeeDraft);
  const [confirmation, setConfirmation] = useState<{ row: Employee; kind: TeamOperation } | null>(null), [reason, setReason] = useState('');
  const [message, setMessage] = useState(''), [reviewRequired, setReviewRequired] = useState(false);
  const action = useApiAction(), scope = useRef(captureAuthScope(user?.id, user?.role === 'platform_admin' ? undefined : tenantId)).current;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const assertManager = () => {
    assertAuthScope(scope);
    if (!mounted.current || !teamManager(user, activeTenant) || user?.role !== 'platform_admin' && activeTenant?.id !== tenantId) throw Error('Do‘kon yoki hisob o‘zgardi. Amalni qayta boshlang.');
    if (reviewRequired) throw Error('Avval ro‘yxatni yangilang va oldingi amal natijasini tekshiring.');
  };
  const write = async <T,>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body: object, verify: (value: any) => T) => {
    assertManager();
    let received = false;
    try {
      const value = await request(path, { ...options, method, body });
      received = true;
      assertManager();
      return verify(value);
    } catch (error: any) {
      if ((received || ['NETWORK', 'TIMEOUT'].includes(error.code)) && mounted.current) setReviewRequired(true);
      throw error;
    }
  };
  const refresh = async () => { await list.reload(); };
  const review = async () => {
    setEditor(null); setConfirmation(null);
    const confirmed = await action.run(async () => {
      assertAuthScope(scope);
      const value = await request(pageUrl(endpoint, 1), options);
      assertAuthScope(scope);
      if (!mounted.current || !Array.isArray(value?.results)) throw Error('Yangilangan xodimlar ro‘yxati tasdiqlanmadi.');
      value.results.forEach(parseRow);
      return true;
    });
    if (confirmed && mounted.current) { setReviewRequired(false); setMessage('Ro‘yxat yangilandi. Oldingi amal natijasini tekshiring.'); await refresh(); }
  };
  const openEditor = (row: Employee | 'new') => {
    if (action.busy || reviewRequired || row !== 'new' && !row.actions.edit) return;
    action.clearError(); setEditor(row); setDraft(employeeDraft(row === 'new' ? undefined : row));
  };
  const field = (key: keyof EmployeeDraft, value: string | number[]) => { setDraft(current => ({ ...current, [key]: value })); action.clearField(key); };
  const saved = async (notice: string) => { if (mounted.current) { setEditor(null); setConfirmation(null); setMessage(notice); await refresh(); } };
  const save = async () => {
    if (!editor) return;
    const editing = editor === 'new' ? null : editor;
    const result = await action.run(async () => {
      assertManager();
      if (editing && !editing.actions.edit) throw Error('Tahrirlashga ruxsat berilmagan.');
      const body = employeeBody(draft, permissions.error || permissions.loading ? null : permissions.data, editing);
      return write(editing ? base + editing.id + '/' : base + 'hire/', editing ? 'PATCH' : 'POST', body, raw => {
        const ack = employeeAcknowledgement(raw, tenantId, editing || undefined);
        if (!editing && !ack.is_active) throw Error('Server faol xodimni tasdiqlamadi. Ro‘yxatni tekshiring.');
        if (editing) parseEmployee(raw, tenantId);
        return ack;
      });
    });
    if (result) {
      const invitation = result.onboarding_invitation;
      await saved(editing ? 'Xodim ma’lumotlari saqlandi.' : invitation?.sent === true ? 'Xodim yollandi. Email yuborish tasdiqlandi; xodim pochta qutisini tekshirsin.' : invitation?.reason === 'existing_account' ? 'Xodim yollandi. Mavjud hisob yoki emailsiz hisob uchun yangi taklif yuborilmadi.' : 'Xodim yollandi, lekin taklif emaili yuborilmadi. Emailni tekshirib, taklifni alohida yuboring.');
    }
  };
  const openOperation = (row: Employee, kind: TeamOperation) => {
    if (!user || !canTeamOperate(row, kind, user.id) || action.busy || reviewRequired) return;
    action.clearError(); setConfirmation({ row, kind }); setReason('');
  };
  const operate = async () => {
    if (!confirmation || !user) return;
    const { row, kind } = confirmation;
    const result = await action.run(async () => {
      assertManager();
      if (!canTeamOperate(row, kind, user.id)) throw Error('Ushbu amal uchun ruxsat berilmagan.');
      const operation = teamOperation(base, row, kind, reason);
      return write(operation.path, operation.method, operation.body, raw => {
        if (kind === 'invite') {
          if (raw?.sent !== true) throw Error('Taklif yuborilgani tasdiqlanmadi. Qayta yuborishdan oldin emailni tekshiring.');
        } else {
          const ack = employeeAcknowledgement(raw, tenantId, row);
          if ((kind === 'fire' || kind === 'archive') && ack.is_active) throw Error('Xodim faoliyati to‘xtatilgani tasdiqlanmadi. Ro‘yxatni yangilang.');
          if (kind !== 'fire') {
            const updated = parseEmployee(raw, tenantId);
            if ((kind === 'block' && updated.account_active) || (kind === 'unblock' && !updated.account_active) || (kind === 'archive' && !updated.archived_at) || (kind === 'restore' && updated.archived_at)) throw Error('Amal natijasi tasdiqlanmadi. Ro‘yxatni yangilang.');
          }
        }
        return true;
      });
    });
    if (result) await saved(kind === 'invite' ? 'Email yuborish serverda tasdiqlandi. Pochta qutisiga yetib borishini xodim tekshirishi kerak.' : operationLabels[kind] + ' serverda tasdiqlandi.');
  };
  const inputFields = [
    ['first_name', 'Ism'], ['last_name', 'Familiya'], ['phone_number', 'Kirish telefoni'], ['email', 'Xodim emaili'], ['position', 'Lavozim'],
    ...(editor !== 'new' ? [['contact_phone', 'Aloqa telefoni']] : []),
  ] as [Exclude<keyof EmployeeDraft, 'permission_ids'>, string][];
  return <>
    <View style={{ padding: 16, gap: 10 }}>
      <Button title="Xodim yollash" disabled={action.busy || reviewRequired} onPress={() => openEditor('new')} />
      <Input label="Xodim qidirish" placeholder="Ism, telefon yoki lavozim" value={search} onChangeText={setSearch} />
      <ChoiceField label="Xodim holati" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Barchasi' }, { value: 'active', label: 'Faol' }, { value: 'inactive', label: 'Nofaol' }, { value: 'archived', label: 'Arxiv' }]} />
      {message ? <Notice>{message}</Notice> : null}
      {reviewRequired && <><Notice error>Oldingi amal natijasi noma’lum. Yangi amal oldidan ro‘yxatni yangilab tekshiring.</Notice>{action.error ? <Notice error>{action.error}</Notice> : null}<Button title="Natijani tekshirish uchun yangilash" variant="secondary" loading={action.busy} onPress={review} /></>}
    </View>
    <FlatList data={list.rows} keyExtractor={row => String(row.id)} refreshing={list.loading} onRefresh={refresh} contentContainerStyle={{ padding: 16, gap: 12 }}
      ListEmptyComponent={<ListState loading={list.loading} error={list.error} empty onRetry={list.retry} emptyLabel="Xodim topilmadi." />}
      ListFooterComponent={<>{list.rows.length > 0 && list.error && <ListState error={list.error} onRetry={list.retry} />}{list.hasMore && <Button title="Yana xodimlar" variant="secondary" loading={list.loadingMore} onPress={list.loadMore} />}</>}
      renderItem={({ item }) => <View style={{ padding: 16, gap: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
        <Text style={{ color: colors.text, fontWeight: '700', fontSize: 17 }}>{employeeName(item)}</Text>
        <Notice>{item.is_owner ? 'Do‘kon egasi' : item.position || 'Xodim'} · {item.archived_at ? 'Arxivlangan' : item.is_active ? 'Faol' : 'Ishdan bo‘shatilgan'}</Notice>
        <Notice>{item.phone_number || 'Telefon ko‘rsatilmagan'}{item.email ? ' · ' + item.email : ''}</Notice>
        <Notice>{item.account_active ? 'Hisob faol' : 'Hisob bloklangan'} · {item.password_set ? 'Hisob sozlangan' : 'Hisobni sozlash kerak'}</Notice>
        {item.actions.edit && <Button title={'Tahrirlash: ' + employeeName(item)} variant="secondary" disabled={action.busy || reviewRequired} onPress={() => openEditor(item)} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(Object.keys(operationLabels) as TeamOperation[]).filter(kind => user && canTeamOperate(item, kind, user.id)).map(kind => <Button key={kind} title={operationLabels[kind]} accessibilityLabel={operationLabels[kind] + ': ' + employeeName(item)} variant="secondary" disabled={action.busy || reviewRequired} onPress={() => openOperation(item, kind)} />)}
        </View>
      </View>} />
    <BottomSheet visible={editor !== null} title={editor === 'new' ? 'Yangi xodim' : 'Xodimni tahrirlash'} scrollable onClose={() => { if (!action.busy) setEditor(null); }}>
      <View style={{ gap: 12 }}>
        <Notice>Parol emaildagi maxfiy havola orqali belgilanadi. Kirish telefoni va hisob roli bu formadan o‘zgartirilmaydi.</Notice>
        {inputFields.map(([key, label]) => <Input key={key} label={label} value={draft[key]} maxLength={key === 'position' ? 100 : key.includes('phone') ? 20 : key.includes('name') ? 50 : 254} keyboardType={key.includes('phone') ? 'phone-pad' : key === 'email' ? 'email-address' : 'default'} autoCapitalize={key === 'email' ? 'none' : 'sentences'} editable={!action.busy && (key !== 'phone_number' || editor === 'new')} error={action.fields[key]} onChangeText={value => field(key, value)} />)}
        <ListState loading={permissions.loading} error={permissions.error} onRetry={permissions.reload} />
        {permissions.data && <PermissionSelector choices={permissions.data} selected={draft.permission_ids} disabled={action.busy || permissions.loading || Boolean(permissions.error)} onChange={value => field('permission_ids', value)} error={action.fields.permission_ids} />}
        {!permissions.data && action.fields.permission_ids ? <Notice error>{action.fields.permission_ids}</Notice> : null}
        {action.error ? <Notice error>{action.error}</Notice> : null}
        <Button title={editor === 'new' ? 'Yollashni tasdiqlash' : 'Xodimni saqlash'} loading={action.busy} disabled={reviewRequired} onPress={save} />
      </View>
    </BottomSheet>
    <BottomSheet visible={confirmation !== null} title={confirmation ? operationLabels[confirmation.kind] : ''} scrollable onClose={() => { if (!action.busy) setConfirmation(null); }}>
      {confirmation && <View style={{ gap: 12 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{employeeName(confirmation.row)} · Do‘kon #{tenantId}</Text>
        <Notice>{operationHints[confirmation.kind]}</Notice>
        {!['fire', 'invite'].includes(confirmation.kind) && <Input label="Amal sababi" value={reason} maxLength={500} multiline error={action.fields.reason} editable={!action.busy} onChangeText={value => { setReason(value); action.clearField('reason'); }} />}
        {action.error ? <Notice error>{action.error}</Notice> : null}
        <Button title="Amalni tasdiqlash" variant={['fire', 'block', 'archive'].includes(confirmation.kind) ? 'danger' : 'primary'} loading={action.busy} disabled={reviewRequired} onPress={operate} />
        <Button title="Bekor qilish" variant="secondary" disabled={action.busy} onPress={() => setConfirmation(null)} />
      </View>}
    </BottomSheet>
  </>;
}
