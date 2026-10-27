import { router } from 'expo-router';
import { KeyboardRegion } from '../../components/ui/KeyboardRegion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useState, useEffect, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { CheckCircle2, Eye, EyeOff, ShieldAlert } from 'lucide-react-native';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { useAuth } from './AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { getApiBaseUrl, request, setApiBaseUrl } from '../../api/client';
import { isDesignPreview } from '../../dev/preview';
import { useFormErrors } from '../../hooks/useFormErrors';
import { LoginHero } from './LoginHero';

export const LoginScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { login, sendOtp, verifyOtp, loginStep, loginTicket, phoneHint, checkTelegram, resetLogin, otpResendAt } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useFormErrors();
  const recoveryForm = useFormErrors();
  const authSubmission = useRef(false);
  const lastAutoCode = useRef<string | null>(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [serverUrl, setServerUrlState] = useState(getApiBaseUrl());

  // Password Reset BottomSheet state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState<'request' | 'confirm' | 'old_password'>('request');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotToken, setForgotToken] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotOldPassword, setForgotOldPassword] = useState('');
  const [forgotShowNewPass, setForgotShowNewPass] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSuccess, setForgotSuccess] = useState<string | null>(null);
  const recoveryGeneration = useRef(0);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRecoveryTimer = () => {
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    recoveryTimer.current = null;
  };
  const resetRecovery = () => {
    recoveryGeneration.current++;
    clearRecoveryTimer();
    setForgotLoading(false);
    setForgotError(null);
    setForgotSuccess(null);
    setForgotToken('');
    setForgotNewPassword('');
    setForgotOldPassword('');
    setForgotShowNewPass(false);
    recoveryForm.clear();
  };
  const closeRecovery = () => {
    resetRecovery();
    setShowForgotModal(false);
  };
  const changeRecoveryStep = (step: typeof forgotStep) => {
    resetRecovery();
    setForgotStep(step);
  };
  useEffect(() => () => {
    recoveryGeneration.current++;
    if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (loginStep !== 'telegram' || !loginTicket) return;
    const check = () => { void checkTelegram().catch(error => setError(error.message)); };
    const first = setTimeout(check, 0), timer = setInterval(check, 8000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [loginStep, loginTicket, checkTelegram]);

  const resendSeconds = Math.max(0, Math.ceil((otpResendAt - now) / 1000));

  const handleLogin = async () => {
    if (authSubmission.current) return;
    form.clear();
    if (!username.trim() || !password) {
      form.setErrors({ ...(!username.trim() ? { username: 'Login yoki telefonni kiriting.' } : {}), ...(!password ? { password: 'Parolni kiriting.' } : {}) });
      setError('Login va parolni kiriting');
      return;
    }
    setError(null);
    authSubmission.current = true;
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      form.capture(err, [400, 401].includes(err.status) ? { username: 'Login yoki parolni tekshiring.', password: err.message || 'Parolni tekshiring.' } : {});
      setError(err.message || 'Kirishda xatolik yuz berdi');
    } finally {
      authSubmission.current = false;
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (code = otpCode) => {
    if (authSubmission.current) return;
    if (!/^\d{6}$/.test(code)) {
      form.setErrors({ verification_code: 'Tasdiqlash kodini to‘liq kiriting' });
      return;
    }
    authSubmission.current = true;
    form.clear();
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(code);
    } catch (err: any) {
      if (err.code === 'SESSION_CHANGED') return;
      if (!['NETWORK', 'TIMEOUT'].includes(err.code) && (!err.status || [400, 401, 422].includes(err.status))) form.setErrors({ verification_code: err.message || 'Kod noto‘g‘ri yoki muddati tugagan' });
      else setError(err.message || 'Tasdiqlash bajarilmadi. Qayta urinib ko‘ring.');
    } finally {
      authSubmission.current = false;
      setLoading(false);
    }
  };

  const changeOtpCode = (value: string) => {
    if (authSubmission.current) return;
    const code = value.replace(/\D/g, '').slice(0, 6);
    setOtpCode(code); form.clear('verification_code'); setError(null);
    if (code.length !== 6) lastAutoCode.current = null;
    else if (lastAutoCode.current !== `${loginTicket}:${code}`) {
      lastAutoCode.current = `${loginTicket}:${code}`;
      void handleVerifyOtp(code);
    }
  };

  const handleResendOtp = async () => {
    if (authSubmission.current || resendSeconds > 0) return;
    authSubmission.current = true;
    setError(null);
    setLoading(true);
    try {
      await sendOtp();
      setOtpCode(''); form.clear('verification_code'); lastAutoCode.current = null;
    } catch (err: any) {
      setError(err.message || 'Kodni yuborib bo‘lmadi');
    } finally {
      authSubmission.current = false;
      setLoading(false);
    }
  };

  // Password Reset: Request magic link / reset code
  const handlePasswordResetRequest = async () => {
    if (forgotLoading || recoveryTimer.current) return;
    if (!forgotIdentifier.trim()) {
      recoveryForm.setErrors({ login: 'Foydalanuvchi nomi yoki emailingizni kiriting' });
      return;
    }
    setForgotError(null);
    recoveryForm.clear();
    setForgotSuccess(null);
    setForgotLoading(true);
    const generation = ++recoveryGeneration.current;
    try {
      const res = await request('/auth/password-reset/request/', {
        method: 'POST',
        body: { login: forgotIdentifier.trim() },
      });
      if (generation !== recoveryGeneration.current) return;
      if (res?.has_email === false) setForgotStep('old_password');
      setForgotSuccess(res?.detail || 'Parolni tiklash havolasi emailingizga yuborildi.');
    } catch (err: any) {
      if (generation !== recoveryGeneration.current) return;
      recoveryForm.capture(err);
      setForgotError(err?.message || 'Tiklash so‘rovini yuborib bo‘lmadi');
    } finally {
      if (generation === recoveryGeneration.current) setForgotLoading(false);
    }
  };

  // Password Reset: Confirm with token
  const handlePasswordResetConfirm = async () => {
    if (forgotLoading || recoveryTimer.current) return;
    if (!forgotToken.trim() || !forgotNewPassword) {
      recoveryForm.setErrors({ ...(!forgotToken.trim() ? { token: 'Tiklash tokenini kiriting.' } : {}), ...(!forgotNewPassword ? { new_password: 'Yangi parolni kiriting.' } : {}) });
      return;
    }
    if (forgotNewPassword.length < 8) {
      recoveryForm.setErrors({ new_password: 'Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak' });
      return;
    }
    setForgotError(null);
    recoveryForm.clear();
    setForgotSuccess(null);
    setForgotLoading(true);
    const generation = ++recoveryGeneration.current;
    try {
      const res = await request('/auth/password-reset/confirm/', {
        method: 'POST',
        body: { token: forgotToken.trim(), new_password: forgotNewPassword },
      });
      if (generation !== recoveryGeneration.current) return;
      setForgotSuccess(res?.detail || 'Parol yangilandi! Endi yangi parol bilan kiring.');
      if (res?.username) setUsername(res.username);
      setPassword('');
      recoveryTimer.current = setTimeout(closeRecovery, 1800);
    } catch (err: any) {
      if (generation !== recoveryGeneration.current) return;
      recoveryForm.capture(err);
      setForgotError(err?.message || 'Parolni yangilashda xatolik yuz berdi');
    } finally {
      if (generation === recoveryGeneration.current) setForgotLoading(false);
    }
  };

  // Password Reset: Change with old password
  const handleChangeWithOld = async () => {
    if (forgotLoading || recoveryTimer.current) return;
    if (!forgotIdentifier.trim() || !forgotOldPassword || !forgotNewPassword) {
      recoveryForm.setErrors({ ...(!forgotIdentifier.trim() ? { login: 'Loginni kiriting.' } : {}), ...(!forgotOldPassword ? { old_password: 'Eski parolni kiriting.' } : {}), ...(!forgotNewPassword ? { new_password: 'Yangi parolni kiriting.' } : {}) });
      return;
    }
    if (forgotNewPassword.length < 8) {
      recoveryForm.setErrors({ new_password: 'Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak' });
      return;
    }
    setForgotError(null);
    recoveryForm.clear();
    setForgotSuccess(null);
    setForgotLoading(true);
    const generation = ++recoveryGeneration.current;
    try {
      const res = await request('/auth/password-reset/change-with-old/', {
        method: 'POST',
        body: { login: forgotIdentifier.trim(), old_password: forgotOldPassword, new_password: forgotNewPassword },
      });
      if (generation !== recoveryGeneration.current) return;
      setForgotSuccess(res?.detail || 'Parol muvaffaqiyatli almashtirildi!');
      setUsername(forgotIdentifier.trim());
      setPassword('');
      recoveryTimer.current = setTimeout(closeRecovery, 1800);
    } catch (err: any) {
      if (generation !== recoveryGeneration.current) return;
      recoveryForm.capture(err);
      setForgotError(err?.message || 'Parolni almashtirishda xatolik yuz berdi');
    } finally {
      if (generation === recoveryGeneration.current) setForgotLoading(false);
    }
  };

  return (
    <KeyboardRegion
      style={[styles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <LoginHero compact={loginStep !== 'credentials'} />

        {/* Form Container (Full-screen native flow, no floating card box) */}
        <View style={styles.formContainer}>
          {loginStep === 'credentials' ? (
            <>
              {isDesignPreview && (
                <Button
                  title="Demo ko‘rinishga kirish"
                  variant="secondary"
                  onPress={() => login('preview', 'preview')}
                  style={styles.previewBtn}
                />
              )}

              <Input
                label="Foydalanuvchi nomi yoki telefon"
                placeholder="masalan: admin yoki +99890..."
                value={username}
                onChangeText={value => { setUsername(value); form.clear('username'); setError(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                error={form.errors.username || form.errors.login}
                editable={!loading}
              />

              <Input
                label="Parol"
                placeholder="Parolingizni kiriting"
                value={password}
                onChangeText={value => { setPassword(value); form.clear('password'); setError(null); }}
                secureTextEntry={!showPassword}
                autoComplete="current-password"
                error={form.errors.password}
                editable={!loading}
                onSubmitEditing={() => { void handleLogin(); }}
                suffix={
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={showPassword ? 'Parolni yashirish' : 'Parolni ko‘rsatish'}
                    onPress={() => setShowPassword(prev => !prev)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.eyeBtn}
                  >
                    {showPassword ? (
                      <EyeOff size={18} color={colors.textSecondary} />
                    ) : (
                      <Eye size={18} color={colors.textSecondary} />
                    )}
                  </TouchableOpacity>
                }
              />

              {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

              <Button
                title="Kirish"
                loading={loading}
                onPress={handleLogin}
                style={styles.submitBtn}
                fullWidth
              />

              {/* Action Links: Parolni unutdingizmi? · Qo‘llab-quvvatlash */}
              <View style={styles.footerLinksRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => {
                    resetRecovery();
                    setForgotIdentifier(username.trim());
                    setForgotStep('request');
                    setShowForgotModal(true);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.footerLink, { color: colors.primaryAction }]}>
                    Parolni unutdingizmi?
                  </Text>
                </TouchableOpacity>

                <Text style={[styles.footerDot, { color: colors.textMuted }]}>·</Text>

                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => router.push('/support')}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={[styles.footerLink, { color: colors.textSecondary }]}>
                    Qo‘llab-quvvatlash
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : loginStep === 'telegram' ? (
            <View style={styles.telegramBox}>
              <Text style={[styles.stepTitle, { color: colors.text }]}>Telegram botni ulang</Text>
              <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
                @ilbi_bot ni oching, /start bosing va {phoneHint || 'o‘z telefon raqamingiz'} kontaktini ulashing. Ulanish tasdiqlangach kod so‘raladi.
              </Text>
              <Button
                title="Telegram botni ochish"
                onPress={() => Linking.openURL('https://t.me/ilbi_bot').catch(() => setError('Telegram ochilmadi. @ilbi_bot ni qo‘lda oching.'))}
                fullWidth
              />
              <Button
                title="Ulanishni tekshirish"
                variant="secondary"
                onPress={() => checkTelegram().catch(error => setError(error.message))}
                fullWidth
              />
              {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
              <Button
                title="Login va parolga qaytish"
                variant="ghost"
                onPress={() => { resetLogin(); setError(null); }}
              />
            </View>
          ) : (
            <View style={styles.otpBox}>
              <Text style={[styles.stepTitle, { color: colors.text }]}>Tasdiqlash kodi</Text>
              <Text style={[styles.stepSubtitle, { color: colors.textSecondary }]}>
                {phoneHint
                  ? `Telegram orqali ${phoneHint} raqamiga yuborilgan 6 xonali kodni kiriting.`
                  : 'Telegram bot orqali yuborilgan tasdiqlash kodini kiriting.'}
              </Text>

              <Input
                label="Tasdiqlash kodi"
                placeholder="123456"
                value={otpCode}
                onChangeText={changeOtpCode}
                keyboardType="number-pad"
                maxLength={6}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                editable={!loading}
                error={form.errors.verification_code}
                style={{ fontSize: 26, letterSpacing: 8, textAlign: 'center' }}
                onSubmitEditing={() => { void handleVerifyOtp(); }}
              />

              {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

              <Button
                title="Tasdiqlash"
                loading={loading}
                onPress={() => { void handleVerifyOtp(); }}
                style={styles.submitBtn}
                fullWidth
              />

              <TouchableOpacity
                accessibilityRole="button"
                disabled={loading || resendSeconds > 0}
                onPress={handleResendOtp}
                style={styles.resendBtn}
              >
                <Text style={[styles.resendText, { color: colors.textSecondary }]}>
                  {resendSeconds > 0 ? `Qayta yuborish: ${resendSeconds} soniya` : 'Kodni qayta yuborish'}
                </Text>
              </TouchableOpacity>
              <Button
                title="Login va parolga qaytish"
                variant="ghost"
                disabled={loading}
                onPress={() => { resetLogin(); form.clear(); setError(null); setOtpCode(''); lastAutoCode.current = null; }}
              />
            </View>
          )}

          {/* Downloads link */}
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.push('/downloads')}
            style={styles.downloadsBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.downloadsText, { color: colors.textMuted }]}>
              Dasturiy yangilanishlar va yuklab olish
            </Text>
          </TouchableOpacity>
        </View>

        {/* Server URL configuration toggle for local/staging testing */}
        {__DEV__ && (
          <View style={styles.serverConfigContainer}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => setShowServerConfig(!showServerConfig)}
              style={styles.serverToggle}
            >
              <Text style={[styles.serverToggleText, { color: colors.textMuted }]}>
                {showServerConfig ? '▼ Server sozlamasini yopish' : '⚙ Server manzilini sozlash'}
              </Text>
            </TouchableOpacity>

            {showServerConfig ? (
              <View style={[styles.serverBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Input
                  label="Server API URL"
                  value={serverUrl}
                  onChangeText={(val) => setServerUrlState(val)}
                  autoCapitalize="none"
                />
                <Button
                  title="Serverni tanlash"
                  onPress={async () => {
                    try {
                      await setApiBaseUrl(serverUrl);
                      setError(null);
                    } catch (err: any) {
                      setError(err.message);
                    }
                  }}
                />
                <Text style={[styles.serverNote, { color: colors.textMuted }]}>
                  Hozirgi: {getApiBaseUrl()}
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* Password Recovery BottomSheet */}
      <BottomSheet
        visible={showForgotModal}
        onClose={closeRecovery}
        title="Parolni tiklash"
        scrollable
      >
        <View style={styles.recoveryContainer}>
          {/* Step Selector Tabs */}
          <View style={[styles.tabsRow, { backgroundColor: colors.surfaceSecondary }]}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => changeRecoveryStep('request')}
              style={[
                styles.tabBtn,
                forgotStep === 'request' && [styles.activeTabBtn, { backgroundColor: colors.surface }],
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: forgotStep === 'request' ? colors.text : colors.textMuted },
                ]}
              >
                Havola so‘rash
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => changeRecoveryStep('confirm')}
              style={[
                styles.tabBtn,
                forgotStep === 'confirm' && [styles.activeTabBtn, { backgroundColor: colors.surface }],
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: forgotStep === 'confirm' ? colors.text : colors.textMuted },
                ]}
              >
                Kodni kiritish
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              onPress={() => changeRecoveryStep('old_password')}
              style={[
                styles.tabBtn,
                forgotStep === 'old_password' && [styles.activeTabBtn, { backgroundColor: colors.surface }],
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: forgotStep === 'old_password' ? colors.text : colors.textMuted },
                ]}
              >
                Eski parol
              </Text>
            </TouchableOpacity>
          </View>

          {forgotSuccess ? (
            <View style={[styles.statusBanner, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <CheckCircle2 size={18} color={colors.success} />
              <Text style={[styles.statusSuccessText, { color: colors.text }]}>{forgotSuccess}</Text>
            </View>
          ) : null}

          {forgotError ? (
            <View style={[styles.statusBanner, { backgroundColor: colors.surfaceSecondary, borderColor: colors.danger }]}>
              <ShieldAlert size={18} color={colors.danger} />
              <Text style={[styles.statusErrorText, { color: colors.danger }]}>{forgotError}</Text>
            </View>
          ) : null}

          {forgotStep === 'request' && (
            <View style={styles.tabContent}>
              <Text style={[styles.instructionText, { color: colors.textSecondary }]}>
                Hisobingizga biriktirilgan foydalanuvchi nomi, telefon yoki email manzilini kiriting. Tiklash havolasi yuboriladi.
              </Text>

              <Input
                label="Login, telefon yoki email"
                placeholder="masalan: admin yoki info@ilbi.uz"
                value={forgotIdentifier}
                onChangeText={value => { setForgotIdentifier(value); recoveryForm.clear('login'); }}
                error={recoveryForm.errors.login || recoveryForm.errors.identifier || recoveryForm.errors.email}
                autoCapitalize="none"
              />

              <Button
                title="Tiklash havolasini yuborish"
                loading={forgotLoading}
                onPress={handlePasswordResetRequest}
                fullWidth
                style={{ marginTop: spacing.md }}
              />

              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => changeRecoveryStep('confirm')}
                style={styles.switchStepBtn}
              >
                <Text style={[styles.switchStepText, { color: colors.primaryAction }]}>
                  Kodingiz bormi? Yangi parolni o‘rnatish ›
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {forgotStep === 'confirm' && (
            <View style={styles.tabContent}>
              <Text style={[styles.instructionText, { color: colors.textSecondary }]}>
                Emailingizga kelgan tiklash kodi (yoki havola tokeni) va yangi parolni kiriting.
              </Text>

              <Input
                label="Tiklash kodi / token"
                placeholder="Email orqali kelgan token"
                value={forgotToken}
                onChangeText={value => { setForgotToken(value); recoveryForm.clear('token'); }}
                error={recoveryForm.errors.token}
                autoCapitalize="none"
              />

              <Input
                label="Yangi parol"
                placeholder="Kamida 8 ta belgi"
                value={forgotNewPassword}
                onChangeText={value => { setForgotNewPassword(value); recoveryForm.clear('new_password'); }}
                error={recoveryForm.errors.new_password}
                secureTextEntry={!forgotShowNewPass}
                suffix={
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setForgotShowNewPass(prev => !prev)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {forgotShowNewPass ? (
                      <EyeOff size={18} color={colors.textSecondary} />
                    ) : (
                      <Eye size={18} color={colors.textSecondary} />
                    )}
                  </TouchableOpacity>
                }
              />

              <Button
                title="Yangi parolni saqlash"
                loading={forgotLoading}
                onPress={handlePasswordResetConfirm}
                fullWidth
                style={{ marginTop: spacing.md }}
              />
            </View>
          )}

          {forgotStep === 'old_password' && (
            <View style={styles.tabContent}>
              <Text style={[styles.instructionText, { color: colors.textSecondary }]}>
                Agar email ulanmagan bo‘lsa, joriy eski parolingiz yordamida yangi parol o‘rnatishingiz mumkin.
              </Text>

              <Input
                label="Login yoki telefon"
                placeholder="Foydalanuvchi nomi"
                value={forgotIdentifier}
                onChangeText={value => { setForgotIdentifier(value); recoveryForm.clear('login'); }}
                error={recoveryForm.errors.login}
                autoCapitalize="none"
              />

              <Input
                label="Eski parol"
                placeholder="Joriy parolingiz"
                value={forgotOldPassword}
                onChangeText={value => { setForgotOldPassword(value); recoveryForm.clear('old_password'); }}
                error={recoveryForm.errors.old_password}
                secureTextEntry
              />

              <Input
                label="Yangi parol"
                placeholder="Kamida 8 ta belgi"
                value={forgotNewPassword}
                onChangeText={value => { setForgotNewPassword(value); recoveryForm.clear('new_password'); }}
                error={recoveryForm.errors.new_password}
                secureTextEntry={!forgotShowNewPass}
                suffix={
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setForgotShowNewPass(prev => !prev)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    {forgotShowNewPass ? (
                      <EyeOff size={18} color={colors.textSecondary} />
                    ) : (
                      <Eye size={18} color={colors.textSecondary} />
                    )}
                  </TouchableOpacity>
                }
              />

              <Button
                title="Parolni almashtirish"
                loading={forgotLoading}
                onPress={handleChangeWithOld}
                fullWidth
                style={{ marginTop: spacing.md }}
              />
            </View>
          )}
        </View>
      </BottomSheet>
    </KeyboardRegion>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
    justifyContent: 'center',
    width: '100%',
  },
  topSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    width: '100%',
  },
  heroImage: {
    width: '100%',
    height: 180,
    maxHeight: 200,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginTop: 4,
    textAlign: 'center',
  },
  formContainer: {
    width: '100%',
  },
  previewBtn: {
    marginBottom: spacing.md,
  },
  eyeBtn: {
    paddingHorizontal: 4,
  },
  error: {
    fontSize: typography.size.sm,
    marginBottom: spacing.md,
  },
  submitBtn: {
    marginTop: spacing.md,
  },
  footerLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  footerLink: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  footerDot: {
    fontSize: typography.size.sm,
  },
  downloadsBtn: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  downloadsText: {
    fontSize: typography.size.xs,
    textDecorationLine: 'underline',
  },
  telegramBox: {
    gap: 14,
  },
  otpBox: {
    gap: 8,
  },
  stepTitle: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginBottom: spacing.xs,
  },
  stepSubtitle: {
    fontSize: typography.size.sm,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  resendBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  resendText: {
    fontSize: typography.size.sm,
    textDecorationLine: 'underline',
  },
  serverConfigContainer: {
    marginTop: spacing.xxl,
    alignItems: 'center',
  },
  serverToggle: {
    padding: spacing.sm,
  },
  serverToggleText: {
    fontSize: typography.size.xs,
  },
  serverBox: {
    width: '100%',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  serverNote: {
    fontSize: typography.size.xs,
  },
  recoveryContainer: {
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  tabsRow: {
    flexDirection: 'row',
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.xs,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  activeTabBtn: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  instructionText: {
    fontSize: typography.size.sm,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  tabContent: {
    width: '100%',
  },
  switchStepBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  switchStepText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  statusSuccessText: {
    flex: 1,
    fontSize: typography.size.xs,
    lineHeight: 18,
  },
  statusErrorText: {
    flex: 1,
    fontSize: typography.size.xs,
    lineHeight: 18,
  },
});
