import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDesignPreview, previewUser } from '../../dev/preview';
import { clearTokens, getAccessToken, getAuthGeneration, getRefreshToken, initializeAuthFromStorage, onSessionCleared, parseJwt, refreshAccessToken, request, setActiveTenantId, setTokens } from '../../api/client';
import { getServerScope } from '../../api/environment';
import { ApiError } from '../../api/errors';
import { chooseTenant, validateProfile } from './profile';
import { revokePushInstallation } from '../notifications/pushRegistration';

export interface UserTenant { id: number; name: string; is_owner: boolean; permissions: string[]; }
export interface UserProfile {
  id: number; username: string; first_name: string; last_name: string; phone_number: string;
  role: 'owner' | 'staff' | 'platform_admin'; tenants: UserTenant[];
  terms_accepted?: boolean; permissions?: string[]; email?: string; avatar_url?: string | null;
}
type LoginStep = 'credentials' | 'telegram' | 'otp';
interface AuthContextType {
  user: UserProfile | null; activeTenant: UserTenant | null; isAuthenticated: boolean; isLoading: boolean;
  sessionError: string | null; loginStep: LoginStep; loginTicket: string | null; phoneHint: string | null;
  otpResendAt: number; login: (username: string, password: string) => Promise<{ otpRequired: boolean; phoneHint?: string }>;
  sendOtp: () => Promise<void>; checkTelegram: () => Promise<void>; resetLogin: () => void;
  verifyOtp: (code: string) => Promise<void>; selectTenant: (id: number) => Promise<void>;
  logout: () => Promise<void>; refreshProfile: () => Promise<void>; acceptTerms: () => Promise<void>;
}
const emptyAsync = async () => {};
const AuthContext = createContext<AuthContextType>({
  user: null, activeTenant: null, isAuthenticated: false, isLoading: true, sessionError: null,
  loginStep: 'credentials', loginTicket: null, phoneHint: null, otpResendAt: 0,
  login: async () => ({ otpRequired: false }), sendOtp: emptyAsync, checkTelegram: emptyAsync, resetLogin: () => {},
  verifyOtp: emptyAsync, selectTenant: emptyAsync, logout: emptyAsync, refreshProfile: emptyAsync, acceptTerms: emptyAsync,
});
const selectionKey = (userId: number) => 'ilbi:' + encodeURIComponent(getServerScope()) + ':' + userId + ':active-store';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [activeTenant, setActiveTenant] = useState<UserTenant | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [loginStep, setLoginStep] = useState<LoginStep>('credentials');
  const [loginTicket, setLoginTicket] = useState<string | null>(null);
  const [phoneHint, setPhoneHint] = useState<string | null>(null);
  const [otpResendAt, setOtpResendAt] = useState(0);
  const sequence = useRef(0), ticket = useRef<string | null>(null);
  const autoOtpSent = useRef<string | null>(null);
  const pendingOtp = useRef<{ ticket: string; promise: Promise<void> } | null>(null);
  const loginEpoch = useRef(0);
  const pendingVerification = useRef<{ ticket: string; promise: Promise<void> } | null>(null);
  const setTicket = (value: string | null) => { ticket.current = value; setLoginTicket(value); };
  const resetLogin = useCallback(() => { loginEpoch.current++; ticket.current = null; autoOtpSent.current = null; setLoginTicket(null); setLoginStep('credentials'); setPhoneHint(null); setOtpResendAt(0); }, []);
  const resetSession = useCallback(() => { sequence.current += 1; setUser(null); setActiveTenant(null); setSessionError(null); resetLogin(); }, [resetLogin]);
  useEffect(() => onSessionCleared(resetSession), [resetSession]);

  const loadProfile = useCallback(async () => {
    const current = ++sequence.current, generation = getAuthGeneration();
    const profile = validateProfile(await request('/auth/me/'));
    const claimedId = parseJwt(getAccessToken())?.user_id;
    if (claimedId && String(claimedId) !== String(profile.id)) throw new ApiError('Profil hisobga mos emas.', 401);
    const savedId = await AsyncStorage.getItem(selectionKey(profile.id));
    if (current !== sequence.current || generation !== getAuthGeneration()) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
    const selected = chooseTenant(profile, savedId);
    await setActiveTenantId(selected ? String(selected.id) : null);
    if (current !== sequence.current) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
    // Publish all verified session state together, after the last fallible initialization step.
    setUser(profile); setActiveTenant(selected); setSessionError(null);
    return profile;
  }, []);
  const refreshProfile = useCallback(async () => {
    try {
      if (!getAccessToken() && getRefreshToken()) await refreshAccessToken();
      if (!getAccessToken()) { resetSession(); return; }
      await loadProfile();
    } catch (error: any) {
      if (error.code === 'SESSION_CHANGED') return;
      if (error.status === 401) { try { await clearTokens(); } finally { resetSession(); } }
      else { setUser(null); setActiveTenant(null); setSessionError(error.message || 'Sessiyani tekshirib bo‘lmadi. Qayta urinib ko‘ring.'); }
      throw error;
    }
  }, [loadProfile, resetSession]);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (isDesignPreview) {
          await setActiveTenantId(String(previewUser.tenants[0].id));
          if (active) { setUser(previewUser); setActiveTenant(previewUser.tenants[0]); }
        } else {
          await initializeAuthFromStorage();
          if (getAccessToken() || getRefreshToken()) await refreshProfile();
        }
      } catch (error: any) { if (active && error.status !== 401) setSessionError(error.message || 'Sessiya yuklanmadi.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; sequence.current += 1; };
  }, [refreshProfile]);

  const failTicket = (error: any) => {
    if (error.data?.error === 'invalid_or_expired_login_ticket') resetLogin();
    if (error.status === 404 || error.data?.error === 'telegram_contact_not_found') setLoginStep('telegram');
    if (error.retryAfterMs > 0) setOtpResendAt(Date.now() + error.retryAfterMs);
    throw error;
  };
  const requestOtp = async (currentTicket: string) => {
    if (pendingOtp.current?.ticket === currentTicket) return pendingOtp.current.promise;
    const pending = { ticket: currentTicket, promise: (async () => {
      try {
        const result = await request('/auth/admin-login/send-otp/', { method: 'POST', body: { login_ticket: currentTicket } });
        if (currentTicket !== ticket.current) return;
        if (!result?.otp_sent) throw new ApiError('Kod yuborilgani tasdiqlanmadi.', 502);
        autoOtpSent.current = currentTicket; setOtpResendAt(Date.now() + 180000); setLoginStep('otp');
      } catch (error) { if (currentTicket === ticket.current) failTicket(error); }
    })().finally(() => { if (pendingOtp.current === pending) pendingOtp.current = null; }) };
    pendingOtp.current = pending; return pending.promise;
  };
  const login = async (username: string, password: string) => {
    setSessionError(null); resetLogin();
    const epoch = loginEpoch.current, generation = getAuthGeneration();
    if (isDesignPreview) { setUser(previewUser); await setActiveTenantId(String(previewUser.tenants[0].id)); setActiveTenant(previewUser.tenants[0]); return { otpRequired: false }; }
    const response = await request('/auth/admin-login/', { method: 'POST', body: { username, password } });
    if (epoch !== loginEpoch.current || generation !== getAuthGeneration()) throw new ApiError('Kirish seansi o‘zgardi.', 0, null, 0, 'SESSION_CHANGED');
    if (response.access && response.refresh) {
      await setTokens(response.access, response.refresh);
      if (epoch !== loginEpoch.current) throw new ApiError('Kirish seansi o‘zgardi.', 0, null, 0, 'SESSION_CHANGED');
      try { await loadProfile(); } catch (error: any) { if (error.code !== 'SESSION_CHANGED') { setUser(null); setActiveTenant(null); setSessionError(error.message); } throw error; }
      return { otpRequired: false };
    }
    if (!response.login_ticket) throw new ApiError('Kirishni davom ettirib bo‘lmadi.', 502);
    setTicket(response.login_ticket); setPhoneHint(response.phone_hint || null); setLoginStep('telegram');
    if (response.telegram_linked) await requestOtp(response.login_ticket);
    return { otpRequired: true, phoneHint: response.phone_hint };
  };
  const checkTelegram = async () => {
    const current = ticket.current;
    if (!current) throw new ApiError('Kirishni qayta boshlang.');
    try {
      const result = await request('/auth/admin-login/telegram-status/', { method: 'POST', body: { login_ticket: current } });
      if (ticket.current === current && autoOtpSent.current !== current && result.telegram_linked) await requestOtp(current);
    } catch (error) { if (ticket.current === current) failTicket(error); }
  };
  const sendOtp = async () => {
    if (!ticket.current) throw new ApiError('Kirishni qayta boshlang.');
    if (Date.now() < otpResendAt) throw new ApiError('Yangi kodni so‘rashdan oldin kuting.', 429, null, otpResendAt - Date.now());
    await requestOtp(ticket.current);
  };
  const verifyOtp = async (code: string) => {
    if (!/^\d{6}$/.test(code)) throw new ApiError('6 xonali kodni kiriting.');
    if (!ticket.current) throw new ApiError('Kirishni qayta boshlang.');
    const currentTicket = ticket.current;
    if (pendingVerification.current?.ticket === currentTicket) return pendingVerification.current.promise;
    const epoch = loginEpoch.current, generation = getAuthGeneration();
    const current = () => epoch === loginEpoch.current && ticket.current === currentTicket;
    const pending = { ticket: currentTicket, promise: (async () => {
      try {
        const response = await request('/auth/admin-login/verify-otp/', { method: 'POST', body: { login_ticket: currentTicket, verification_code: code } });
        if (!current() || generation !== getAuthGeneration()) throw new ApiError('Kirish seansi o‘zgardi.', 0, null, 0, 'SESSION_CHANGED');
        await setTokens(response.access, response.refresh);
        if (!current()) throw new ApiError('Kirish seansi o‘zgardi.', 0, null, 0, 'SESSION_CHANGED');
        await loadProfile();
        if (current()) resetLogin();
      } catch (error) {
        if (!current()) throw new ApiError('Kirish seansi o‘zgardi.', 0, null, 0, 'SESSION_CHANGED');
        failTicket(error);
      }
    })().finally(() => { if (pendingVerification.current === pending) pendingVerification.current = null; }) };
    pendingVerification.current = pending;
    return pending.promise;
  };
  const selectTenant = async (id: number) => {
    const selected = user?.tenants.find(item => item.id === id);
    if (!selected || !user || user.role === 'platform_admin') throw new ApiError('Do‘kon vakolati topilmadi.', 403);
    const current = sequence.current, generation = getAuthGeneration();
    await AsyncStorage.setItem(selectionKey(user.id), String(id));
    if (generation !== getAuthGeneration() || current !== sequence.current) throw new ApiError('Sessiya o‘zgargan.', 0, null, 0, 'SESSION_CHANGED');
    await setActiveTenantId(String(id));
    if (current === sequence.current) setActiveTenant(selected);
  };
  const logout = async () => {
    try { await revokePushInstallation(); }
    finally { resetSession(); await clearTokens(); }
  };
  const acceptTerms = async () => { await request('/auth/accept-terms/', { method: 'POST', body: {} }); await refreshProfile(); };
  return <AuthContext.Provider value={{ user, activeTenant, isAuthenticated: Boolean(user), isLoading, sessionError, loginStep, loginTicket, phoneHint, otpResendAt, login, sendOtp, checkTelegram, resetLogin, verifyOtp, selectTenant, logout, refreshProfile, acceptTerms }}>{children}</AuthContext.Provider>;
};
export const useAuth = () => useContext(AuthContext);
