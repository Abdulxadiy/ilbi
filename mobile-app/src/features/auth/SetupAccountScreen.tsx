import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { formError } from '../../api/validation';
import { safeDisplayText } from '../../security/presentation';
import { useFormErrors } from '../../hooks/useFormErrors';
import { useAuth } from './AuthContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { parseSetupChallenge, parseSetupInfo, setupToken, type SetupInfo } from './setupModel';

export function SetupAccountScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const incoming = typeof params.token === 'string' ? params.token : '';
  return <SetupBody key={getServerScope() + ':' + incoming} incoming={incoming} />;
}
function SetupBody({ incoming }: { incoming: string }) {
  const { adoptSetupChallenge } = useAuth();
  const [link, setLink] = useState(incoming), [info, setInfo] = useState<SetupInfo | null>(null);
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [recheck, setRecheck] = useState(false);
  const form = useFormErrors(), { clear, capture } = form, lock = useRef(false), mounted = useRef(true), sequence = useRef(0), autoInspected = useRef(false);
  const scope = useRef(captureAuthScope()).current;
  const checkedToken = useRef('');
  const current = useCallback((operation: number) => { assertAuthScope(scope); return mounted.current && operation === sequence.current; }, [scope]);
  const inspect = useCallback(async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); clear(); setInfo(null); checkedToken.current = '';
    const operation = ++sequence.current;
    try {
      const token = setupToken(link); assertAuthScope(scope);
      const parsed = parseSetupInfo(await request('/auth/password-reset/verify/?token=' + encodeURIComponent(token), { skipTenant: true, expectedServerScope: scope.server }));
      if (!current(operation)) return;
      checkedToken.current = token; setInfo(parsed); setRecheck(false); setUsername(''); setPassword(''); setConfirm('');
    } catch (failure: any) {
      if (mounted.current && operation === sequence.current) { capture(failure, ['NETWORK', 'TIMEOUT', 'SESSION_CHANGED'].includes(failure.code) ? {} : { token: 'Emaildagi to‘liq va amaldagi ILBI havolasini kiriting.' }); setError(safeDisplayText(failure.message, 'Havola tekshirilmadi.', [link, password, confirm])); }
    } finally { if (mounted.current && operation === sequence.current) { lock.current = false; setBusy(false); } }
  }, [link, password, confirm, scope, current, clear, capture]);
  // Only an incoming email link is inspected automatically; typing/pasting never sends a password.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active && incoming && !autoInspected.current) { autoInspected.current = true; return inspect(); } });
    return () => { active = false; };
  }, [incoming, inspect]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const submit = async () => {
    if (lock.current || !info || !checkedToken.current || recheck) return;
    lock.current = true; setBusy(true); setError(''); form.clear();
    const operation = ++sequence.current;
    let sent = false;
    try {
      assertAuthScope(scope);
      const token = checkedToken.current;
      const resume = info.phase === 'pending_2fa';
      if (!resume) {
        const fields: Record<string, string> = {};
        if (password.length < 8) fields.new_password = 'Parol kamida 8 belgidan iborat bo‘lsin.';
        if (password !== confirm) fields.confirm_password = 'Parollar bir xil bo‘lishi kerak.';
        if (!info.has_username && info.purpose !== 'reset_password' && !/^[A-Za-z0-9_.@+-]{3,150}$/.test(username.trim())) fields.username = 'Foydalanuvchi nomini kiriting (kamida 3 belgi).';
        if (Object.keys(fields).length) throw formError(fields);
      }
      sent = true;
      const result = parseSetupChallenge(await request('/auth/password-reset/' + (resume ? 'resume/' : 'confirm/'), { method: 'POST', skipTenant: true, expectedServerScope: scope.server, body: resume ? { token } : { token, new_password: password, ...(!info.has_username && info.purpose !== 'reset_password' ? { username: username.trim() } : {}) } }));
      if (!current(operation)) return;
      setPassword(''); setConfirm(''); setLink(''); checkedToken.current = '';
      adoptSetupChallenge(result);
      router.replace('/login');
    } catch (failure: any) {
      if (mounted.current && operation === sequence.current) {
        form.capture(failure);
        const needsRecheck = sent && (['NETWORK', 'TIMEOUT'].includes(failure.code) || failure.data?.detail === 'setup_already_started' || !failure.status);
        if (needsRecheck) { setRecheck(true); setPassword(''); setConfirm(''); }
        setError(safeDisplayText(failure.message, 'Hisob sozlanmadi. Havolani qayta tekshiring.', [checkedToken.current, password, confirm]));
      }
    } finally { if (mounted.current && operation === sequence.current) { lock.current = false; setBusy(false); } }
  };
  return <Page title="Hisobni faollashtirish" onBack={() => router.replace('/login')}>
    <Notice>Emaildagi taklif yoki parolni tiklash havolasini oching. Hisob paroli saqlangach Telegram orqali tasdiqlash davom etadi.</Notice>
    <Input label="Taklif yoki tiklash havolasi" value={link} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy && !info} error={form.errors.token} onChangeText={value => { setLink(value); form.clear('token'); setError(''); }} />
    {!info && <Button title="Havolani tekshirish" loading={busy} onPress={inspect} />}
    {info && <View style={{ gap: 12 }}>
      <Notice>{info.purpose === 'reset_password' ? 'Parolni tiklash' : 'Jamoaga xush kelibsiz'}{info.tenant_name ? ' · ' + info.tenant_name : ''}{info.position ? ' · ' + info.position : ''}</Notice>
      <Notice>{info.username || info.phone_hint || info.email_hint}</Notice>
      {info.phase === 'pending_2fa' ? <Notice>Parol avval saqlangan. Uni qayta o‘rnatmasdan Telegram tasdiqlashni davom ettiring.</Notice> : <>
        {!info.has_username && info.purpose !== 'reset_password' && <Input label="Yangi foydalanuvchi nomi" value={username} maxLength={150} autoCapitalize="none" autoCorrect={false} editable={!busy && !recheck} error={form.errors.username} onChangeText={value => { setUsername(value); form.clear('username'); }} />}
        <Input label="Yangi parol" value={password} secureTextEntry autoComplete="new-password" editable={!busy && !recheck} error={form.errors.new_password} onChangeText={value => { setPassword(value); form.clear('new_password'); }} />
        <Input label="Yangi parolni takrorlang" value={confirm} secureTextEntry autoComplete="new-password" editable={!busy && !recheck} error={form.errors.confirm_password} onChangeText={value => { setConfirm(value); form.clear('confirm_password'); }} />
      </>}
      {!recheck && <Button title={info.phase === 'pending_2fa' ? 'Telegram tasdiqlashni davom ettirish' : 'Parolni saqlash va davom etish'} loading={busy} onPress={submit} />}
      <Button title="Havolani qayta tekshirish" variant="secondary" disabled={busy} onPress={inspect} />
    </View>}
    {recheck && <Notice error>Oldingi so‘rov natijasi noma’lum yoki sozlash boshlangan. Parolni qayta yubormang; havolani tekshirib, mavjud bosqichni davom ettiring.</Notice>}
    {error ? <Notice error>{error}</Notice> : null}
  </Page>;
}
