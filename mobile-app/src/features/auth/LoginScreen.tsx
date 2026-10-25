import { router } from 'expo-router';
import { KeyboardRegion } from '../../components/ui/KeyboardRegion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useState, useEffect } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { IlbiLogo } from '../../components/brand/IlbiLogo';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useAuth } from './AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { getApiBaseUrl, setApiBaseUrl } from '../../api/client';
import { isDesignPreview } from '../../dev/preview';

export const LoginScreen: React.FC = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { login, sendOtp, verifyOtp, loginStep, loginTicket, phoneHint, checkTelegram, resetLogin, otpResendAt } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [serverUrl, setServerUrlState] = useState(getApiBaseUrl());

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
    if (!username.trim() || !password) {
      setError('Login va parolni kiriting');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
    } catch (err: any) {
      setError(err.message || 'Kirishda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setError('Tasdiqlash kodini to‘liq kiriting');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await verifyOtp(otpCode.trim());
    } catch (err: any) {
      setError(err.message || 'Kod noto‘g‘ri yoki muddati tugagan');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      await sendOtp();
    } catch (err: any) {
      setError(err.message || 'Kodni yuborib bo‘lmadi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardRegion

      style={[styles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <IlbiLogo height={36} />
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Savdo va do&#39;kon boshqaruvi platformasi
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {loginStep === 'credentials' ? (
            <>
              <Text style={[styles.title, { color: colors.text }]}>Tizimga kirish</Text>
              {isDesignPreview && <Button title="Demo ko‘rinishga kirish" onPress={() => login('preview', 'preview')} />}

              <Input
                label="Foydalanuvchi nomi yoki telefon"
                placeholder="masalan: admin yoki +99890..."
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />

              <Input
                label="Parol"
                placeholder="Parolingizni kiriting"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />

              {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

              <Button
                title="Kirish"
                loading={loading}
                onPress={handleLogin}
                style={styles.submitBtn}
                fullWidth
              />
            </>
          ) : loginStep === 'telegram' ? (
            <View style={{ gap: 14 }}>
              <Text style={[styles.title, { color: colors.text }]}>Telegram botni ulang</Text>
              <Text style={{ color: colors.textSecondary, lineHeight: 22 }}>@ilbi_bot ni oching, /start bosing va {phoneHint || 'o‘z telefon raqamingiz'} kontaktini ulashing. Ulanish tasdiqlangach kod so‘raladi.</Text>
              <Button title="Telegram botni ochish" onPress={() => Linking.openURL('https://t.me/ilbi_bot').catch(() => setError('Telegram ochilmadi. @ilbi_bot ni qo‘lda oching.'))} />
              <Button title="Ulanishni tekshirish" variant="secondary" onPress={() => checkTelegram().catch(error => setError(error.message))} />
              {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
              <Button title="Login va parolga qaytish" variant="ghost" onPress={() => { resetLogin(); setError(null); }} />
            </View>
          ) : (
            <>
              <Text style={[styles.title, { color: colors.text }]}>Tasdiqlash kodi</Text>
              <Text style={[styles.otpHint, { color: colors.textSecondary }]}>
                {phoneHint
                  ? `Telegram orqali ${phoneHint} raqamiga yuborilgan 6 xonali kodni kiriting.`
                  : 'Telegram bot orqali yuborilgan tasdiqlash kodini kiriting.'}
              </Text>

              <Input
                label="Tasdiqlash kodi"
                placeholder="123456"
                value={otpCode}
                onChangeText={setOtpCode}
                keyboardType="number-pad"
                maxLength={6}
              />

              {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

              <Button
                title="Tasdiqlash"
                loading={loading}
                onPress={handleVerifyOtp}
                style={styles.submitBtn}
                fullWidth
              />

              <TouchableOpacity accessibilityRole="button" disabled={loading || resendSeconds > 0} onPress={handleResendOtp} style={styles.resendBtn}>
                <Text style={[styles.resendText, { color: colors.textSecondary }]}>
                  {resendSeconds > 0 ? `Qayta yuborish: ${resendSeconds} soniya` : 'Kodni qayta yuborish'}
                </Text>
              </TouchableOpacity>
              <Button title="Login va parolga qaytish" variant="ghost" onPress={() => { resetLogin(); setError(null); setOtpCode(''); }} />
            </>
          )}
        </View>

        {/* Server URL configuration toggle for local/staging testing */}
        {__DEV__ && <View style={styles.serverConfigContainer}>
          <TouchableOpacity accessibilityRole="button"
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
                onChangeText={(val) => {
                  setServerUrlState(val);

                }}
                autoCapitalize="none"
              />
              <Button title="Serverni tanlash" onPress={async () => { try { await setApiBaseUrl(serverUrl); setError(null); } catch (error: any) { setError(error.message); } }} />
              <Text style={[styles.serverNote, { color: colors.textMuted }]}>
                Hozirgi: {getApiBaseUrl()}
              </Text>
            </View>
          ) : null}
        </View>}
        <Button title="Qo‘llab-quvvatlash" variant="ghost" onPress={() => router.push('/support')} />
      </ScrollView>
    </KeyboardRegion>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  subtitle: {
    fontSize: typography.size.sm,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  card: {
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginBottom: spacing.lg,
  },
  otpHint: {
    fontSize: typography.size.sm,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  submitBtn: {
    marginTop: spacing.md,
  },
  resendBtn: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  resendText: {
    fontSize: typography.size.sm,
    textDecorationLine: 'underline',
  },
  error: {
    fontSize: typography.size.sm,
    marginBottom: spacing.md,
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
  },
  serverNote: {
    fontSize: typography.size.xs,
  },
});
