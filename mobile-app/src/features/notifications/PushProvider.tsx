import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { router } from 'expo-router';
import { captureAuthScope, assertAuthScope } from '../../api/client';
import { getApiBaseUrl, isDesignPreview } from '../../api/environment';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from './NotificationsContext';
import { defaultPushCategories, pushInstallationState, registerPushToken, retryPushRevocations, revokePushInstallation, type PushCategories } from './pushRegistration';
import { parsePushTarget, type PushTarget } from './pushTarget';

type PushState = { supported: boolean; enabled: boolean; busy: boolean; denied: boolean; error: boolean; message: string; categories: PushCategories; enable: () => Promise<void>; disable: () => Promise<void>; changeCategory: (key: keyof PushCategories, enabled: boolean) => Promise<void>; openSettings: () => Promise<void> };
const Context = createContext<PushState>({ supported: false, enabled: false, busy: false, denied: false, error: false, message: '', categories: defaultPushCategories, enable: async () => {}, disable: async () => {}, changeCategory: async () => {}, openSettings: async () => {} });

export function PushProvider({ children }: { children: ReactNode }) {
  const auth = useAuth(), inbox = useNotifications(), user = auth.user, server = getApiBaseUrl();
  const fetchOne = inbox.fetchOne;
  const userId = user?.id, accepted = user?.terms_accepted;
  const supported = Platform.OS === 'android' && Application.applicationId === 'uz.ilbi.mobile' && !isDesignPreview;
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false), [denied, setDenied] = useState(false), [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [categories, setCategories] = useState<PushCategories>({ ...defaultPushCategories }), [pending, setPending] = useState<PushTarget | null>(null);
  const lock = useRef(false), current = useRef({ user, server }), inboxRef = useRef(inbox), mounted = useRef(true), promptedStore = useRef('');
  const previousAccount = useRef<{ userId: number | undefined; server: string }>({ userId, server });
  useLayoutEffect(() => { current.current = { user, server }; inboxRef.current = inbox; }, [user, server, inbox]);
  const sync = useCallback(async (prompt: boolean, preferred?: PushCategories, rotatedToken?: string) => {
    if (!supported || !userId || !accepted || lock.current) return;
    const scope = captureAuthScope(); lock.current = true; setBusy(true); setMessage(''); setFailed(false);
    const valid = () => mounted.current && current.current.user?.id === userId && current.current.server === server;
    try {
      await retryPushRevocations();
      await Notifications.setNotificationChannelAsync('ilbi-activity', { name: 'ILBI xabarlari', importance: AndroidImportance.DEFAULT, lockscreenVisibility: AndroidNotificationVisibility.PRIVATE });
      let permission = await Notifications.getPermissionsAsync();
      if (!permission.granted && prompt && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        await revokePushInstallation(server);
        if (valid()) { setEnabled(false); setDenied(true); setMessage('Telefonda bildirishnoma ruxsati o‘chiq. Telefon sozlamalaridan yoqishingiz mumkin.'); }
        return;
      }
      const token = rotatedToken || (await Notifications.getDevicePushTokenAsync()).data;
      if (typeof token !== 'string') throw Error('Android bildirishnoma tokeni olinmadi.');
      assertAuthScope(scope);
      const saved = await pushInstallationState(server), chosen = preferred || saved?.categories || defaultPushCategories;
      const deliveryEnabled = await registerPushToken(userId, token, chosen, scope, server);
      if (valid()) { setEnabled(true); setDenied(false); setCategories(chosen); setMessage(deliveryEnabled ? 'Telefon bildirishnomalari yoqildi.' : 'Qurilma ulandi. Serverda bildirishnoma jo‘natilishi hali faollashtirilmagan.'); }
    } catch (error: any) { if (valid()) { setFailed(true); setMessage(error.message || 'Telefon bildirishnomalarini ulab bo‘lmadi. Qayta urining.'); } }
    finally { lock.current = false; if (valid()) setBusy(false); }
  }, [server, supported, userId, accepted]);
  useEffect(() => {
    mounted.current = true;
    if (!supported) return;
    void retryPushRevocations().catch(() => {});
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false }) });
    const incoming = Notifications.addNotificationReceivedListener(notification => {
      const target = parsePushTarget(notification.request.content.data);
      if (target && target.recipientId === current.current.user?.id) void inboxRef.current.refresh();
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(response => setPending(parsePushTarget(response.notification.request.content.data)));
    void Notifications.getLastNotificationResponseAsync().then(response => { if (response && mounted.current) setPending(parsePushTarget(response.notification.request.content.data)); }).catch(() => {});
    return () => { mounted.current = false; incoming.remove(); tapped.remove(); Notifications.setNotificationHandler(null); };
  }, [supported]);
  useEffect(() => {
    const previous = previousAccount.current;
    if (previous.userId && (previous.userId !== userId || previous.server !== server)) void revokePushInstallation(previous.server);
    previousAccount.current = { userId, server };
  }, [server, userId]);
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    void pushInstallationState(server).then(saved => { if (!alive) return; setEnabled(false); setBusy(false); setMessage(''); setCategories({ ...defaultPushCategories }); if (saved?.enabledForUser === userId && userId) void sync(false); else if (!userId && !auth.isLoading) void revokePushInstallation(server); }).catch(() => {});
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void pushInstallationState(server).then(saved => { if (alive && saved?.enabledForUser === userId) return sync(false); }).catch(() => {}); });
    const rotation = Notifications.addPushTokenListener(token => { if (typeof token.data === 'string') void pushInstallationState(server).then(saved => { if (alive && saved?.enabledForUser === userId) return sync(false, undefined, token.data); }).catch(() => {}); });
    return () => { alive = false; foreground.remove(); rotation.remove(); };
  }, [server, supported, sync, userId, auth.isLoading]);
  useEffect(() => {
    if (!pending || !user?.terms_accepted || auth.isLoading) return;
    if (pending.recipientId !== user.id) { void Notifications.clearLastNotificationResponseAsync().then(() => setPending(null)).catch(() => {}); return; }
    if (user.role !== 'platform_admin' && auth.activeTenant?.id !== pending.tenantId) {
      const identity = [user.id, pending.notificationId, pending.tenantId].join(':');
      if (promptedStore.current !== identity) { promptedStore.current = identity; router.navigate('/stores'); }
      return;
    }
    let alive = true;
    void fetchOne(pending.notificationId).then(row => {
      if (!alive || !row) return;
      setPending(null);
      router.navigate({ pathname: user.role === 'platform_admin' ? '/(app)/notifications' : '/(app)/(tabs)/notifications', params: { notificationId: String(row.id) } });
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    });
    return () => { alive = false; };
  }, [auth.activeTenant?.id, auth.isLoading, fetchOne, pending, user]);
  const value = useMemo<PushState>(() => ({ supported, enabled, busy, denied, error: failed, message, categories, enable: () => sync(true),
    disable: async () => { setBusy(true); const done = await revokePushInstallation(server); setEnabled(false); setBusy(false); setFailed(false); setMessage(done ? 'Telefon bildirishnomalari o‘chirildi.' : 'O‘chirish so‘rovi saqlandi. Internet bo‘lganda serverda yakunlanadi.'); },
    changeCategory: (key, active) => sync(false, { ...categories, [key]: active }), openSettings: () => Linking.openSettings() }), [supported, enabled, busy, denied, failed, message, categories, sync, server]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const usePush = () => useContext(Context);
