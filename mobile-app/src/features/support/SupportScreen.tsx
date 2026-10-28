import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import { getServerScope } from '../../api/environment';
import { useServerScope } from '../../hooks/useServerScope';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { Input } from '../../components/ui/Input';
import { ListState } from '../../components/ui/ListState';
import { Loading, Notice, Page, Retry } from '../../components/ui/Page';
import { useApiResource } from '../../hooks/useApiResource';
import { usePagedResource } from '../../hooks/usePagedResource';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { Conversation, parseConversation, parseMessage, SupportLanguage, SupportMessage, isUuid } from './model';
import { createSupportSession, GuestIdentity, loadGuestIdentity, SupportSession } from './session';
import { uncertainSupportWrite, useSupportActivity, useSupportFeed, useSupportWrite } from './useSupport';
import { formError, fieldErrors } from '../../api/validation';
import { useFormErrors } from '../../hooks/useFormErrors';

const statusLabel = { waiting: 'Javob kutilmoqda', active: 'Operator bilan', closed: 'Yopilgan' };
const eventLabel: Record<string, string> = { claim: 'Operator murojaatni qabul qildi', close: 'Suhbat yopildi', reopen: 'Suhbat qayta ochildi' };
function WriteError({ error, uncertain = false }: { error: any; uncertain?: boolean }) {
  return error ? <Notice error>{error.message || 'Amal bajarilmadi.'}{uncertain && uncertainSupportWrite(error) ? ' Natijani yangilang yoki aynan shu xabarni qayta yuboring.' : ''}</Notice> : null;
}
function NewConversation({ session, visible, onClose, onCreated }: { session: SupportSession; visible: boolean; onClose: () => void; onCreated: (value: Conversation) => void }) {
  const { user } = useAuth(), { colors } = useTheme();
  const [name, setName] = useState(user ? `${user.first_name} ${user.last_name}`.trim() || user.username : '');
  const [subject, setSubject] = useState(''), [text, setText] = useState(''), [language, setLanguage] = useState<SupportLanguage>('uz'), [consent, setConsent] = useState(false);
  const [pending, setPending] = useState<any>(null), action = useSupportWrite();
  const validation = useFormErrors();
  const frozen = action.busy || Boolean(pending);
  const submit = async () => {
    const result = await action.run(async () => {
      const fields = { ...(!name.trim() ? { name: 'Ismingizni kiriting.' } : {}), ...(!subject.trim() ? { subject: 'Murojaat mavzusini kiriting.' } : {}), ...(!text.trim() ? { text: 'Xabarni kiriting.' } : {}), ...(!consent ? { consent: 'Yordam uchun ma’lumotlarni yuborishga rozilik kerak.' } : {}) };
      if (Object.keys(fields).length) throw formError(fields);
      const payload = pending || { name: name.trim(), subject: subject.trim(), text: text.trim(), language, consent: true, client_id: Crypto.randomUUID() };
      setPending(payload);
      return parseConversation(await session.call('', { method: 'POST', body: payload, ...(session.userId && session.tenantId ? { headers: { 'X-Tenant-ID': String(session.tenantId) } } : {}) }));
    });
    if (result.ok) { validation.clear(); setPending(null); setSubject(''); setText(''); setConsent(false); onCreated(result.value); }
    else if (result.error) { validation.capture(result.error); if (!uncertainSupportWrite(result.error)) setPending(null); }
  };
  return <BottomSheet visible={visible} title="Yangi murojaat" onClose={() => { if (!action.busy) onClose(); }} scrollable>
    <Input label="Ismingiz" value={name} error={validation.errors.name} onChangeText={value => { setName(value); validation.clear('name'); }} maxLength={100} editable={!frozen} />
    <Input label="Murojaat mavzusi" value={subject} error={validation.errors.subject} onChangeText={value => { setSubject(value); validation.clear('subject'); }} maxLength={160} editable={!frozen} />
    <ChoiceField label="Javob tili" value={language} onChange={setLanguage} disabled={frozen} options={[{ value: 'uz', label: 'O‘zbekcha' }, { value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} />
    <Input label="Birinchi xabar" value={text} error={validation.errors.text} onChangeText={value => { setText(value); validation.clear('text'); }} maxLength={4000} multiline numberOfLines={4} editable={!frozen} />
    <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel="Yordam uchun ma’lumotlarni yuborishga roziman" accessibilityState={{ checked: consent, disabled: frozen }} aria-invalid={Boolean(validation.errors.consent)} disabled={frozen} onPress={() => { setConsent(value => !value); validation.clear('consent'); }} style={{ paddingVertical: 14, borderWidth: validation.errors.consent ? 1 : 0, borderColor: colors.danger, borderRadius: 8 }}><Text style={{ color: colors.text }}>{consent ? '☑' : '☐'} Yordam uchun ismim va xabarimni yuborishga roziman.</Text></TouchableOpacity>
    {validation.errors.consent ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{validation.errors.consent}</Text> : null}
    <Button title="Maxfiylik siyosati" variant="ghost" disabled={action.busy} onPress={() => { onClose(); router.push({ pathname: '/legal', params: { doc: 'maxfiylik_siyosati' } }); }} />
    <WriteError error={action.error} uncertain={Boolean(pending)} />
    <Button title={pending && action.error ? 'Murojaatni qayta yuborish' : 'Murojaat yuborish'} loading={action.busy} disabled={action.blocked} onPress={() => { void submit(); }} />
  </BottomSheet>;
}
function ConversationThread({ session, id, active, onBack, tabbed }: { session: SupportSession; id: string; active: boolean; onBack: () => void; tabbed: boolean }) {
  const { colors } = useTheme();
  const detail = useApiResource(active ? session.root + id + '/' : null, parseConversation, session.options);
  const feed = useSupportFeed(session, id, active), action = useSupportWrite(), status = useSupportWrite();
  const [draft, setDraft] = useState(''), [pending, setPending] = useState<{ text: string; client_id: string } | null>(null);
  const [confirm, setConfirm] = useState<'close' | 'reopen' | 'claim' | null>(null);
  const activeNow = useRef(active), read = useRef({ wanted: 0, ack: 0, busy: false });
  useLayoutEffect(() => { activeNow.current = active; }, [active]);
  const flushRead = useCallback(async () => {
    if (read.current.busy || !activeNow.current) return;
    read.current.busy = true;
    try { while (activeNow.current && read.current.wanted > read.current.ack) { const through = read.current.wanted; await session.call(id + '/', { method: 'POST', body: { action: 'read', through_id: through } }); read.current.ack = through; } } catch {} finally { read.current.busy = false; }
  }, [session, id]);
  useEffect(() => { if (active) void flushRead(); }, [active, flushRead]);
  const viewable = useCallback(({ viewableItems }: { viewableItems: { item: SupportMessage }[] }) => {
    if (!activeNow.current) return;
    read.current.wanted = Math.max(read.current.wanted, ...viewableItems.map(token => token.item.id)); void flushRead();
  }, [flushRead]);
  const acknowledged = Boolean(pending && feed.messages.some(message => message.client_id === pending.client_id));
  const shownPending = acknowledged ? null : pending, shownDraft = acknowledged ? '' : draft;
  const assignedElsewhere = Boolean(session.operator && detail.data?.operator_id && detail.data.operator_id !== session.userId);
  const canReply = detail.data && detail.data.status !== 'closed' && (!session.operator || detail.data.status === 'active' && detail.data.operator_id === session.userId);
  const send = async () => {
    const result = await action.run(async () => {
      const payload = pending || { text: draft.trim(), client_id: Crypto.randomUUID() };
      if (!payload.text) throw Error('Xabarni kiriting.');
      setPending(payload); return parseMessage(await session.call(id + '/messages/', { method: 'POST', body: payload }));
    });
    if (result.ok) { feed.accept([result.value]); setPending(null); setDraft(''); }
    else if (result.error) { Keyboard.dismiss(); if (!uncertainSupportWrite(result.error)) setPending(null); }
  };
  const changeStatus = async () => {
    const result = await status.run(async () => parseConversation(await session.call(id + '/', { method: 'POST', body: { action: confirm } })));
    if (result.ok) { setConfirm(null); void detail.reload(); feed.retry(); }
  };
  return <Page title="Yozishmalar" onBack={onBack} insetBottom={!tabbed} scroll={false} actionsStyle={{ padding: 8, gap: 6 }} actions={detail.data ? <>
    <WriteError error={acknowledged ? null : action.error} uncertain={Boolean(shownPending)} />
    {canReply ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}><Input accessibilityLabel="Yordamga xabar" placeholder="Xabaringiz…" error={fieldErrors(action.error).text} value={shownDraft} onChangeText={value => { if (acknowledged) setPending(null); action.clearError(); setDraft(value); }} maxLength={4000} multiline numberOfLines={1} containerStyle={{ flex: 1, marginBottom: 0 }} style={{ maxHeight: 80 }} editable={!action.busy && !shownPending} /><Button title={shownPending && action.error ? 'Qayta' : 'Yuborish'} accessibilityLabel={shownPending && action.error ? 'Xabarni qayta yuborish' : 'Xabar yuborish'} loading={action.busy} disabled={action.blocked || !(shownPending?.text || shownDraft.trim())} style={{ paddingHorizontal: 12 }} onPress={() => { void send(); }} /></View> : <Notice>{detail.data.status === 'closed' ? 'Davom etish uchun suhbatni qayta oching.' : assignedElsewhere ? 'Bu murojaat boshqa operatorga biriktirilgan.' : 'Javob berishdan oldin murojaatni qabul qiling.'}</Notice>}
  </> : undefined}>
    <View style={{ paddingHorizontal: 16, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {detail.data ? <>
        <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={{ color: colors.text, fontWeight: '700' }}>{detail.data.subject}</Text><Notice>{statusLabel[detail.data.status]}{detail.data.operator_name ? ' · ' + detail.data.operator_name : ''}</Notice></View>
        {session.operator && !assignedElsewhere && detail.data.status === 'waiting' ? <Button title="Qabul" accessibilityLabel="Murojaatni qabul qilish" variant="secondary" style={{ paddingHorizontal: 10 }} onPress={() => setConfirm('claim')} /> : null}
        {(detail.data.status === 'closed' || !assignedElsewhere) ? <Button title={detail.data.status === 'closed' ? 'Qayta ochish' : 'Yopish'} accessibilityLabel={detail.data.status === 'closed' ? 'Suhbatni qayta ochish' : 'Suhbatni yopish'} variant="ghost" style={{ paddingHorizontal: 8 }} onPress={() => setConfirm(detail.data!.status === 'closed' ? 'reopen' : 'close')} /> : null}
      </> : detail.error ? <Retry error={detail.error} retry={() => { void detail.reload(); }} /> : <Loading />}
    </View>
    <FlatList inverted data={feed.messages} keyExtractor={message => String(message.id)} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 10 }} keyboardShouldPersistTaps="handled" maintainVisibleContentPosition={{ minIndexForVisible: 0 }} onViewableItemsChanged={viewable} viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
      ListHeaderComponent={feed.messages.length && (feed.error || detail.error) ? <Retry error={feed.error?.message || detail.error} retry={() => { feed.retry(); void detail.reload(); void flushRead(); }} /> : undefined}
      ListEmptyComponent={<ListState loading={feed.loading} error={feed.error} empty emptyLabel="Hozircha xabar yo‘q" onRetry={feed.retry} />}
      ListFooterComponent={feed.hasOlder ? <Button title="Oldingi xabarlar" variant="secondary" loading={feed.loadingOlder} onPress={() => { void feed.loadOlder(); }} /> : undefined}
      renderItem={({ item }) => item.sender === 'system' ? <Notice>{eventLabel[item.event] || 'Suhbat holati yangilandi'}</Notice> : <View style={{ padding: 12, borderRadius: 12, maxWidth: '90%', alignSelf: item.sender === 'visitor' ? 'flex-end' : 'flex-start', backgroundColor: item.sender === 'visitor' ? colors.surfaceSecondary : colors.surface, borderColor: colors.border, borderWidth: 1, gap: 6 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{item.sender === 'operator' ? item.author_name || 'Operator' : session.operator ? detail.data?.name || 'Mijoz' : 'Siz'}</Text>
        {item.reply_to ? <Notice>↳ {item.reply_to.text || (item.reply_to.has_image ? 'Rasmli xabar' : 'Xabar')}</Notice> : null}
        {item.text ? <Text selectable style={{ color: colors.text, fontSize: 15 }}>{item.text}</Text> : null}
        {item.has_image ? <Notice>Rasmli xabar</Notice> : null}{item.has_voice ? <Notice>Ovozli xabar · {item.voice_duration} soniya</Notice> : null}{item.sticker ? <Text style={{ color: colors.text }}>{item.sticker}</Text> : null}
        <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{new Date(item.created_at).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' })}</Text>
      </View>} />
    <BottomSheet visible={Boolean(confirm)} title="Suhbat holatini o‘zgartirish" onClose={() => { if (!status.busy) setConfirm(null); }}><Notice>{confirm === 'close' ? 'Ushbu suhbat yopilsinmi? Yozishmalar saqlanadi.' : confirm === 'reopen' ? 'Suhbat qayta ochilsinmi?' : 'Murojaat sizga biriktirilsinmi?'}</Notice><WriteError error={status.error} /><Button title="Tasdiqlash" loading={status.busy} disabled={status.blocked} onPress={() => { void changeStatus(); }} /><Button title="Bekor qilish" variant="secondary" disabled={status.busy} onPress={() => setConfirm(null)} /></BottomSheet>
  </Page>;
}
function SupportBody({ session, tabbed, onBack }: { session: SupportSession; tabbed: boolean; onBack: () => void }) {
  const active = useSupportActivity(), { colors } = useTheme();
  const params = useLocalSearchParams<{ conversationId?: string }>();
  const requested = session.userId && typeof params.conversationId === 'string' && isUuid(params.conversationId) ? params.conversationId.toLowerCase() : null;
  const [selection, setSelection] = useState<{ requested: string | null; id: string | null }>({ requested, id: requested }), [creating, setCreating] = useState(false), [contactError, setContactError] = useState('');
  // A new route parameter supersedes the previous thread immediately. The
  // authenticated detail endpoint decides access; no cached ticket fallback.
  const selected = selection.requested === requested ? selection.id : requested;
  const setSelected = useCallback((id: string | null) => setSelection({ requested, id }), [requested]);
  const conversations = usePagedResource(!selected && active ? session.root : null, parseConversation, session.options);
  const metadata = useApiResource<any>(active ? '/support/metadata/' : null, undefined, useMemo(() => ({ skipTenant: true }), []));
  useEffect(() => {
    if (!active || selected || conversations.loading || conversations.loadingMore) return;
    const timer = setTimeout(() => { void conversations.reload(); }, Math.max(15000, conversations.error?.retryAfterMs || 0));
    return () => clearTimeout(timer);
  }, [active, selected, conversations]);
  useEffect(() => { if (!selected || !active) return; const listener = BackHandler.addEventListener('hardwareBackPress', () => { setSelected(null); return true; }); return () => listener.remove(); }, [selected, active, setSelected]);
  const openContact = async (uri: string) => { try { await Linking.openURL(uri); } catch { setContactError('Aloqa ilovasi ochilmadi.'); } };
  return <>
    {selected ? <ConversationThread key={selected} session={session} id={selected} active={active} onBack={() => setSelected(null)} tabbed={tabbed} /> : <Page title="Qo‘llab-quvvatlash" onBack={onBack} insetBottom={!tabbed} scroll={false}>
      <View style={{ padding: 16, gap: 10 }}>
        <Notice>{session.operator ? 'Operator murojaatlari' : 'Savol yoki muammo bo‘lsa, shu yerda yozing. Yozishmalar ushbu bo‘limda saqlanadi.'}</Notice>
        {!session.operator ? <Button title="Yangi murojaat" onPress={() => setCreating(true)} /> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {typeof metadata.data?.phone === 'string' && /^\+?[\d ()-]{6,25}$/.test(metadata.data.phone) ? <Button title="Telefon" variant="secondary" onPress={() => { void openContact('tel:' + metadata.data.phone); }} /> : null}
          {typeof metadata.data?.telegram_username === 'string' && /^[a-zA-Z0-9_]{5,32}$/.test(metadata.data.telegram_username) ? <Button title="Telegram" variant="secondary" onPress={() => { void openContact('https://t.me/' + metadata.data.telegram_username); }} /> : null}
        </View>
        {contactError ? <Notice error>{contactError}</Notice> : null}
      </View>
      <FlatList data={conversations.rows} keyExtractor={item => item.id} contentContainerStyle={{ padding: 16, gap: 10 }} refreshing={conversations.loading} onRefresh={conversations.reload} onEndReached={() => { void conversations.loadMore(); }}
        ListEmptyComponent={<ListState loading={conversations.loading} error={conversations.error} empty emptyLabel="Hozircha murojaat yo‘q" onRetry={conversations.retry} />}
        ListFooterComponent={conversations.rows.length ? <><ListState loading={conversations.loadingMore} error={conversations.error} onRetry={conversations.retry} />{conversations.hasMore ? <Button title="Yana murojaatlar" onPress={() => { void conversations.loadMore(); }} /> : null}</> : undefined}
        renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.subject + ': yozishmalarni ochish'} onPress={() => setSelected(item.id)} style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, padding: 16, gap: 8 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{item.subject}</Text><Notice>{statusLabel[item.status]}{item.unread_count ? ' · ' + item.unread_count + ' yangi' : ''}</Notice>{session.operator ? <Notice>{item.name} · {item.language.toUpperCase()}</Notice> : null}
        </TouchableOpacity>} />
    </Page>}
    <NewConversation session={session} visible={creating && active} onClose={() => setCreating(false)} onCreated={conversation => { setCreating(false); setSelected(conversation.id); }} />
  </>;
}
function GuestSupport({ tabbed, onBack }: { tabbed: boolean; onBack: () => void }) {
  const [identity, setIdentity] = useState<GuestIdentity | null>(null), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const origin = useServerScope();
  useEffect(() => { let current = true; loadGuestIdentity(origin).then(value => { if (current && getServerScope() === origin) setIdentity(value); }).catch(failure => { if (current) setError(failure.message || 'Yordam seansi yuklanmadi.'); }); return () => { current = false; }; }, [version, origin]);
  const session = useMemo(() => identity?.origin === origin ? createSupportSession({ userId: null, guest: identity, origin }) : null, [identity, origin]);
  return session ? <SupportBody key={session.key} session={session} tabbed={tabbed} onBack={onBack} /> : <Page title="Qo‘llab-quvvatlash" onBack={onBack}>{error ? <Retry error={error} retry={() => { setError(''); setVersion(value => value + 1); }} /> : <Loading />}</Page>;
}
export function SupportScreen({ tabbed = false }: { tabbed?: boolean }) {
  const { user, activeTenant, isLoading } = useAuth(), navigation = useAppNavigation();
  const origin = useServerScope();
  const userId = user?.id || null, tenantId = activeTenant?.id || null, operator = user?.role === 'platform_admin';
  const session = useMemo(() => userId ? createSupportSession({ userId, tenantId, operator, origin }) : null, [userId, tenantId, operator, origin]);
  if (isLoading) return <Page title="Qo‘llab-quvvatlash"><Loading /></Page>;
  return session ? <SupportBody key={session.key} session={session} tabbed={tabbed} onBack={navigation.goBack} /> : <GuestSupport key={origin} tabbed={tabbed} onBack={navigation.goBack} />;
}
