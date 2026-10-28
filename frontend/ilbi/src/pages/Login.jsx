import IlbiLoader from '../components/common/IlbiLoader';
import { localStore } from '../utils/brandStorage.js';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Lock, User, KeyRound, ArrowRight, ArrowLeft, ShieldCheck, Eye, EyeOff, Sun, Moon, Play, RefreshCw, Mail, AlertCircle, Headphones } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { authApi } from '../api/client';
import Modal from '../components/common/Modal';
import IlbiLogo from '../components/common/IlbiLogo';
import IlbiIntroAnimation from '../components/common/IlbiIntroAnimation';
import TelegramConnectionGate from '../components/auth/TelegramConnectionGate';
import DesktopAccess from '../components/sync/DesktopAccess';
import { readRememberedLogin, rememberLogin, forgetRememberedLogin } from '../utils/rememberedLogin';
import { showFormErrors } from '../utils/formValidation.js';

const OTP_EXPIRY_SECONDS = 180; // 3 daqiqa

export default function Login() {
  const navigate = useNavigate();
  const { loginStep1, loginStep2, loading } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const toast = useToast();

  const [showIntro, setShowIntro] = useState(true);
  const [step, setStep] = useState(1); // 1 = credentials, 2 = Telegram binding, 3 = OTP
  const [rememberMe, setRememberMe] = useState(() => {
    const saved = localStore.getItem('ilbi_remember_me');
    return saved !== null ? saved === 'true' : true;
  });
  const [username, setUsername] = useState(() => {
    return localStore.getItem('ilbi_remember_login') || '';
  });
  const [password, setPassword] = useState(() => {
    if (window.ilbiDesktop) return '';
    const saved = localStore.getItem('ilbi_remember_pass_vault');
    if (!saved) return '';
    try {
      const raw = saved.startsWith('v1:') ? saved.slice(3) : saved;
      return decodeURIComponent(escape(atob(raw)));
    } catch {
      try {
        const raw = saved.startsWith('v1:') ? saved.slice(3) : saved;
        return atob(raw);
      } catch {
        return '';
      }
    }
  });
  const [loginTicket, setLoginTicket] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [credentialError, setCredentialError] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const otpInFlight = useRef(false);
  const lastAutomaticOtp = useRef('');
  const [phoneHint, setPhoneHint] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [otpTimeLeft, setOtpTimeLeft] = useState(OTP_EXPIRY_SECONDS);
  const [resending, setResending] = useState(false);
  const passwordInputRef = useRef(null);
  const credentialEdits = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const edits = credentialEdits.current;
    readRememberedLogin('online', controller.signal).then(value => {
      if (!controller.signal.aborted && credentialEdits.current === edits && value) {
        setUsername(value.username); setPassword(value.password);
        setRequiresPassword(Boolean(value.requiresPassword));
      }
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  async function saveRememberedLogin() {
    try {
      if (rememberMe) await rememberLogin('online', username, password);
      else await forgetRememberedLogin('online');
    } catch (error) { if (window.ilbiDesktop) toast.warning(error.message || 'Login va parolni eslab qolib bo‘lmadi. Tizim parollar omborini tekshiring.'); }
  }

  // Faqat sahifa birinchi yuklanganda: agar avval saqlangan username mavjud bo'lsa, parolga fokus beramiz
  useEffect(() => {
    const rememberedLogin = localStore.getItem('ilbi_remember_login');
    if (rememberedLogin && passwordInputRef.current) {
      passwordInputRef.current.focus();
    }
  }, []);

  // 2FA OTP Countdown Timer (3 daqiqa)
  useEffect(() => {
    if (step !== 3) return;

    const timer = setInterval(() => {
      setOtpTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [step]);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRememberMeChange = (e) => {
    credentialEdits.current += 1;
    const checked = e.target.checked;
    setRememberMe(checked);
    if (!checked) {
      void forgetRememberedLogin('online').catch(error => toast.warning(error.message));
    } else {
      localStore.setItem('ilbi_remember_me', 'true');
      if (username) localStore.setItem('ilbi_remember_login', username.trim());
      if (password) {
        void rememberLogin('online', username, password).catch(() => {});
      }
    }
  };

  // Password reset modal state
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetMode, setResetMode] = useState('sent'); // 'sent' | 'change_with_old' | 'prompt_login'
  const [resetIdentifier, setResetIdentifier] = useState('');
  const [emailHint, setEmailHint] = useState('');
  const [hasEmail, setHasEmail] = useState(true);
  const [resetLoading, setResetLoading] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [submittingStep1, setSubmittingStep1] = useState(false);

  const handleStep1 = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setCredentialError('');
    setSubmittingStep1(true);
    try {
      if (rememberMe) {
        localStore.setItem('ilbi_remember_login', username.trim());
        localStore.setItem('ilbi_remember_me', 'true');
      } else {
        void forgetRememberedLogin('online').catch(() => {});
      }
      const res = await loginStep1(username.trim(), password, rememberMe);
      if ((res.local_login === true || res.demo_login === true || res.password_login === true) && res.access && res.refresh) {
        await saveRememberedLogin();
        toast.success(res.demo_login ? 'Sinov akkauntiga kirildi' : 'Hisobingizga kirildi');
        navigate('/dashboard');
        return;
      }
      if (!res.login_ticket) throw new Error('Kirishni davom ettirib bo‘lmadi. Qayta urinib ko‘ring.');
      setLoginTicket(res.login_ticket);
      setPhoneHint(res.phone_hint || '');
      setOtpCode('');
      setOtpError('');
      lastAutomaticOtp.current = '';

      // Agar Telegram botga allaqachon bog'langan bo'lsa, "Telegram botni ulash" (step 2)
      // bosqichini ko'rsatish shart emas. To'g'ridan-to'g'ri kodni botga yuborib Step 3 (OTP kiritish)ga o'tamiz.
      if (res.telegram_linked) {
        try {
          const otpRes = await authApi.sendTelegramOtp(res.login_ticket);
          if (otpRes?.otp_sent) {
            setOtpTimeLeft(OTP_EXPIRY_SECONDS);
            setStep(3);
            toast.success('Tasdiqlash kodi Telegram botingizga yuborildi');
            return;
          }
        } catch (otpErr) {
          if (otpErr.status === 404 || otpErr.data?.error === 'telegram_contact_not_found') {
            setStep(2);
            return;
          }
          setErrorMsg(otpErr.message || 'Tasdiqlash kodini yuborishda xatolik yuz berdi');
        }
      }

      // FAQAT hali botga ulanmagan bo'lsagina Step 2 ("Telegram botni ulang") ko'rsatiladi
      setStep(2);
    } catch (err) {
      if (err.status === 401) {
        setErrorMsg('');
        setCredentialError('Login yoki parol noto‘g‘ri');
      } else {
        setErrorMsg(err.message || 'Kirishda xatolik yuz berdi');
      }
    } finally {
      setSubmittingStep1(false);
    }
  };

  const handleResendOtp = async () => {
    if (otpTimeLeft > 0 || resending) return;
    setResending(true);
    setErrorMsg('');
    setOtpError('');
    try {
      await authApi.sendTelegramOtp(loginTicket);
      setOtpCode('');
      lastAutomaticOtp.current = '';
      setOtpTimeLeft(OTP_EXPIRY_SECONDS);
      toast.success('Yangi tasdiqlash kodi Telegram orqali yuborildi');
    } catch (err) {
      if (err.data?.error === 'invalid_or_expired_login_ticket') {
        setLoginTicket('');
        setStep(1);
        setErrorMsg('Kirish muddati tugagan. Login va parolni qayta kiriting.');
      } else if (err.status === 404 || err.data?.error === 'telegram_contact_not_found') {
        setStep(2);
        setErrorMsg('Telegram aloqasi uzilgan. Botda telefoningizni qayta ulang.');
      } else {
        setErrorMsg(err.message || 'Kodni qayta yuborishda xatolik yuz berdi');
      }
    } finally {
      setResending(false);
    }
  };

  const submitOtp = async (code) => {
    if (otpInFlight.current) return;
    setErrorMsg('');
    setOtpError('');

    if (!/^\d{6}$/.test(code)) {
      setOtpError('6 xonali tasdiqlash kodini to‘liq kiriting.');
      return;
    }

    if (otpTimeLeft === 0) {
      setOtpError('Tasdiqlash kodi muddati tugagan. Kodni qayta yuboring.');
      return;
    }

    otpInFlight.current = true;
    setVerifyingOtp(true);
    try {
      if (rememberMe) {
        localStore.setItem('ilbi_remember_login', username.trim());
        localStore.setItem('ilbi_remember_me', 'true');
      } else {
        void forgetRememberedLogin('online').catch(() => {});
      }
      const result = await loginStep2(username.trim(), loginTicket, code, rememberMe, password);
      await saveRememberedLogin();
      if (result?.desktopNotice) toast.warning(result.desktopNotice);
      toast.success('Xush kelibsiz!');
      navigate('/dashboard');
    } catch (err) {
      if (err.data?.error === 'invalid_or_expired_login_ticket') {
        setLoginTicket('');
        setStep(1);
        setErrorMsg('Kirish muddati tugagan. Login va parolni qayta kiriting.');
      } else {
        const message = err.message || 'Tasdiqlash kodi noto‘g‘ri yoki muddati o‘tgan';
        if ([400, 401, 422].includes(err.status)) setOtpError(message);
        else setErrorMsg(message);
      }
    } finally {
      otpInFlight.current = false;
      setVerifyingOtp(false);
    }
  };

  const handleStep2 = (event) => { event.preventDefault(); void submitOtp(otpCode); };
  const handleOtpChange = (event) => {
    const code = event.target.value.replace(/\D/g, '').slice(0, 6);
    setOtpCode(code); setOtpError(''); setErrorMsg('');
    if (code.length < 6) lastAutomaticOtp.current = '';
    const attempt = loginTicket + ':' + code;
    if (code.length === 6 && lastAutomaticOtp.current !== attempt && !otpInFlight.current) {
      lastAutomaticOtp.current = attempt;
      void submitOtp(code);
    }
  };

  const triggerPasswordReset = async (ident) => {
    const trimmed = (ident || '').trim();
    if (!trimmed) {
      toast.warning('Foydalanuvchi nomi yoki telefon raqamingizni kiriting');
      return;
    }
    setResetLoading(true);
    try {
      const res = await authApi.passwordResetRequest(trimmed);
      setResetIdentifier(trimmed);
      setEmailHint(res.email_hint || '');
      setHasEmail(Boolean(res.has_email));
      setResetMode('sent');
      setResetModalOpen(true);
      if (res.has_email) {
        toast.success(res.detail || 'Tiklash havolasi emailingizga yuborildi. Agar xat kelmasa, "Spam" papkasini ham tekshiring.');
      } else {
        toast.info(res.detail || 'Hisob ma’lumotlari qabul qilindi');
      }
    } catch (err) {
      toast.error(err.message || 'Parolni tiklash so‘rovida xatolik');
    } finally {
      setResetLoading(false);
    }
  };

  const handleForgotClick = async () => {
    const ident = username.trim();
    if (!ident) {
      setResetIdentifier('');
      setResetMode('prompt_login');
      setResetModalOpen(true);
      return;
    }
    await triggerPasswordReset(ident);
  };

  const handleChangeWithOld = async (e) => {
    e.preventDefault();
    const loginUser = (resetIdentifier || username || '').trim();
    if (!loginUser) {
      toast.warning('Login kiritilishi shart');
      return;
    }
    if (!oldPassword || !newPassword) {
      toast.warning('Barcha maydonlarni to‘ldiring');
      return;
    }
    if (newPassword.length < 8) {
      toast.warning('Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak');
      return;
    }
    if (newPassword !== confirmPassword) {
      showFormErrors(e.currentTarget, { confirm_password: 'Yangi parollar bir-biriga mos kelmadi.' });
      toast.error('Yangi parollar bir-biriga mos kelmadi');
      return;
    }
    setResetLoading(true);
    try {
      const res = await authApi.changePasswordWithOld({
        login: loginUser,
        old_password: oldPassword,
        new_password: newPassword,
      });
      toast.success(res.detail || 'Parolingiz muvaffaqiyatli yangilandi!');
      setResetModalOpen(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPassword('');
      setUsername(loginUser);
      if (passwordInputRef.current) {
        passwordInputRef.current.focus();
      }
    } catch (err) {
      toast.error(err.message || 'Parolni yangilashda xatolik');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-app)',
        position: 'relative',
        padding: 20,
        transition: 'background-color 0.3s ease',
      }}
    >
      {/* Fullscreen Intro Animation */}
      {showIntro && (
        <IlbiIntroAnimation
          onComplete={() => setShowIntro(false)}
        />
      )}

      {/* Top Bar with Replay & Theme Switcher */}
      <div
        style={{
          position: 'absolute',
          top: 24,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          zIndex: 30,
        }}
      >
        <button
          type="button"
          onClick={() => setShowIntro(true)}
          style={{
            height: 42,
            padding: '0 14px',
            borderRadius: 14,
            background: 'var(--bg-chip)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            transition: 'all 0.2s',
          }}
          title="Kirish animatsiyasini qayta ko‘rish"
        >
          <Play size={13} fill="var(--primary)" color="var(--primary)" />
          <span>Intro</span>
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            background: 'var(--bg-chip)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
          }}
          title={isDark ? 'Kunduzgi rejimga o‘tish' : 'Tungi rejimga o‘tish'}
          aria-label="Mavzuni almashtirish"
        >
          {isDark ? <Sun size={18} color="var(--primary)" /> : <Moon size={18} />}
        </button>
      </div>

      {/* Decorative ambient glow follows the active neutral accent */}
      <div
        style={{
          position: 'absolute',
          width: 440,
          height: 440,
          borderRadius: '50%',
          background: isDark
            ? 'radial-gradient(circle, rgba(var(--primary-rgb), 0.18) 0%, rgba(12, 10, 9, 0) 70%)'
            : 'radial-gradient(circle, rgba(11, 9, 9, 0.08) 0%, rgba(240, 239, 235, 0) 70%)',
          top: '20%',
          left: '50%',
          transform: 'translate(-50%, -20%)',
          filter: 'blur(75px)',
          pointerEvents: 'none',
        }}
      />

      <div
        className="glass-card animate-scale-in"
        style={{
          width: '100%',
          maxWidth: 440,
          padding: '40px 36px',
          borderRadius: 24,
          border: '1px solid var(--border-card)',
          background: 'var(--bg-card)',
          boxShadow: isDark ? '0 24px 60px rgba(0, 0, 0, 0.75)' : 'var(--shadow-lg)',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Brand Logo & Heading */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'inline-flex', justifyContent: 'center', marginBottom: 12 }}>
            <Link to="/" aria-label="ILBI bosh sahifaga qaytish">
              <IlbiLogo size={58} variant="vertical" />
            </Link>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0', fontWeight: 500, letterSpacing: '0.04em' }}>
            Savdo Platformasi & POS Tizimi
          </p>
        </div>

        {errorMsg && (
          <div
            style={{
              background: 'rgba(var(--danger-rgb), 0.12)',
              border: '1px solid rgba(var(--danger-rgb), 0.3)',
              borderRadius: 12,
              padding: '10px 14px',
              color: 'var(--accent-rose)',
              fontSize: 13,
              marginBottom: 20,
              fontWeight: 500,
            }}
          >
            {errorMsg}
          </div>
        )}

        <DesktopAccess />
        {step === 1 ? (
          <form id="login-form" autoComplete={rememberMe ? 'on' : 'off'} onSubmit={handleStep1} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Foydalanuvchi nomi, telefon raqam yoki email
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={18}
                  color="var(--text-muted)"
                  style={{ position: 'absolute', left: 14, top: 14 }}
                />
                <input
                  id="username"
                  name="username"
                  disabled={submittingStep1 || loading}
                  autoComplete="username"
                  type="text"
                  placeholder="admin, +998901234567 yoki email"
                  value={username}
                  onChange={(e) => { credentialEdits.current += 1; setUsername(e.target.value); setCredentialError(''); }}
                  aria-invalid={credentialError ? true : undefined}
                  aria-describedby={credentialError ? 'credential-error' : undefined}
                  required
                  className="input-field"
                  style={{ paddingLeft: 42 }}
                />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                Username, tizimga biriktirilgan telefon raqam (+998...) yoki email orqali kiring
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Maxfiy parol
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={18}
                  color="var(--text-muted)"
                  style={{ position: 'absolute', left: 14, top: 14 }}
                />
                <input
                  ref={passwordInputRef}
                  id="password"
                  name="password"
                  disabled={submittingStep1 || loading}
                  autoComplete="current-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { credentialEdits.current += 1; setPassword(e.target.value); setCredentialError(''); }}
                  aria-invalid={credentialError ? true : undefined}
                  aria-describedby={credentialError ? 'credential-error' : undefined}
                  required
                  className="input-field"
                  style={{ paddingLeft: 42, paddingRight: 42 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: 14,
                    top: 14,
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Meni eslab qol & Parolni unutdingizmi */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 10,
                }}
              >
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    checked={rememberMe}
                    disabled={submittingStep1 || loading}
                    onChange={handleRememberMeChange}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      accentColor: 'var(--primary)',
                      cursor: 'pointer',
                    }}
                  />
                  <span>Meni eslab qol</span>
                </label>

                <button
                  type="button"
                  onClick={handleForgotClick}
                  disabled={resetLoading}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--primary)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: resetLoading ? 'not-allowed' : 'pointer',
                    padding: 0,
                  }}
                >
                  {resetLoading ? 'Yuborilmoqda...' : 'Unutdingizmi?'}
                </button>
              </div>
            </div>

            {credentialError && <div id="credential-error" className="field-error" role="alert">{credentialError}</div>}
            <button
              type="submit"
              disabled={loading || submittingStep1}
              className="btn btn-primary"
              style={{ marginTop: 8, padding: '13px' }}
            >
              <span>{loading || submittingStep1 ? 'Tekshirilmoqda...' : 'Davom etish'}</span>
              {loading || submittingStep1 ? <IlbiLoader size={24} inline decorative /> : <ArrowRight size={18} />}
            </button>
            {requiresPassword && <p role="status" style={{fontSize:13,color:'var(--text-secondary)',lineHeight:1.6,margin:0}}>Hisob xavfsizlik uchun qulflandi. Saqlangan parolingiz o‘chirilmagan; uni qayta kiriting.</p>}
            <p style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.6,margin:0}}>Telegram tasdig‘i shu qurilmada 24 soat amal qiladi. Shu vaqt ichida qayta kirish uchun login va parol yetarli.</p>
          </form>
        ) : step === 2 ? (
          <TelegramConnectionGate
            loginTicket={loginTicket}
            phoneHint={phoneHint}
            onOtpSent={() => {
              setErrorMsg('');
              setOtpCode('');
              setOtpError('');
              lastAutomaticOtp.current = '';
              setOtpTimeLeft(OTP_EXPIRY_SECONDS);
              setStep(3);
              toast.success('Tasdiqlash kodi Telegram orqali yuborildi');
            }}
            onBack={() => {
              setLoginTicket('');
              setErrorMsg('');
              setStep(1);
            }}
            backLabel="Login sahifasiga qaytish"
          />
        ) : (
          <form onSubmit={handleStep2} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                textAlign: 'center',
                padding: '16px',
                borderRadius: 14,
                background: 'var(--primary-light)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <ShieldCheck size={28} color="var(--primary)" style={{ margin: '0 auto 6px' }} />
              <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 700 }}>
                2-Bosqichli Xavfsizlik (2FA)
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Telegram botingizga 6 xonali tasdiqlash kodi yuborildi
              </div>
              {phoneHint && (
                <div style={{ fontSize: 12, color: 'var(--primary)', marginTop: 4, fontWeight: 600 }}>
                  Aloqa: {phoneHint}
                </div>
              )}

              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.5, borderTop: '1px dashed var(--border-subtle)', paddingTop: 8 }}>
                Kodni @ilbi_bot bilan suhbatdagi so‘nggi xabardan oling.
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Tasdiqlash kodi (OTP)
                </label>
                <span style={{ fontSize: 12, fontWeight: 700, color: otpTimeLeft > 30 ? 'var(--primary)' : 'var(--accent-rose)' }}>
                  {formatTimer(otpTimeLeft)}
                </span>
              </div>
              <div style={{ position: 'relative' }}>
                <KeyRound
                  size={18}
                  color="var(--text-muted)"
                  style={{ position: 'absolute', left: 14, top: 14 }}
                />
                <input
                  id="otp-code"
                  data-api-field="verification_code"
                  name="one-time-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  type="text"
                  placeholder={otpTimeLeft === 0 ? "Muddati tugagan" : "123456"}
                  maxLength={6}
                  pattern="[0-9]{6}"
                  title="6 xonali tasdiqlash kodini kiriting."
                  value={otpCode}
                  onChange={handleOtpChange}
                  aria-invalid={otpError ? true : undefined}
                  aria-describedby={otpError ? 'otp-error' : undefined}
                  disabled={otpTimeLeft === 0 || verifyingOtp}
                  autoFocus
                  required
                  className="input-field"
                  style={{
                    paddingLeft: 42,
                    fontSize: 18,
                    letterSpacing: '0.25em',
                    fontWeight: 800,
                    opacity: otpTimeLeft === 0 ? 0.6 : 1,
                  }}
                />
              </div>
              {otpError && <div id="otp-error" className="field-error" role="alert">{otpError}</div>}
            </div>

            {/* Resend OTP button — faqat 3 daqiqa to'liq tugagandan so'ng ochiladi */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: -2 }}>
              {otpTimeLeft > 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                  }}
                >
                  <span>Kodni qayta yuborish:</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {formatTimer(otpTimeLeft)}
                  </span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resending}
                  style={{
                    background: 'none',
                    border: '1px solid var(--primary)',
                    color: 'var(--primary)',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: resending ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 14px',
                    borderRadius: 8,
                    transition: 'all 0.2s ease',
                  }}
                >
                  {resending ? <IlbiLoader size={21} inline decorative /> : <RefreshCw size={13} />}
                  <span>{resending ? 'Yuborilmoqda...' : 'Kodni qayta yuborish'}</span>
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn btn-secondary"
                style={{ flex: 1 }}
              >
                Botni tekshirish
              </button>
              <button
                type="submit"
                disabled={loading || verifyingOtp || otpTimeLeft === 0}
                className="btn btn-primary"
                style={{ flex: 2 }}
              >
                {loading && <IlbiLoader size={24} inline decorative />}
                {loading || verifyingOtp ? 'Kutilyapti...' : otpTimeLeft === 0 ? 'Kodni Yangilang' : 'Tizimga Kirish'}
              </button>
            </div>

            <div style={{ textAlign: 'center', marginTop: 4 }}>
              <button
                type="button"
                disabled={loading || verifyingOtp}
                onClick={() => {
                  setLoginTicket('');
                  setErrorMsg('');
                  setOtpCode('');
                  setOtpError('');
                  lastAutomaticOtp.current = '';
                  setStep(1);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <ArrowLeft size={14} /> Login sahifasiga qaytish
              </button>
            </div>
          </form>
        )}

        <div
          style={{
            marginTop: 22,
            paddingTop: 16,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Link
            to="/support"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 12.5,
              fontWeight: 500,
              color: 'var(--text-muted)',
              textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            <Headphones size={15} />
            <span>Yordam markazi · Qo‘llab-quvvatlash</span>
          </Link>
        </div>
      </div>

      {/* Password Reset Modal */}
      <Modal
        isOpen={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        title={
          resetMode === 'change_with_old'
            ? 'Eski Parol Orqali Yangilash'
            : 'Parolni Qayta Tiklash'
        }
      >
        {resetMode === 'prompt_login' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              triggerPasswordReset(resetIdentifier);
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Parolni tiklash havolasini hisobingizga biriktirilgan emailga yuborish uchun
              foydalanuvchi nomingizni (username) yoki telefon raqamingizni kiriting.
            </p>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Foydalanuvchi nomi, telefon yoki email <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <User size={18} color="var(--text-muted)" style={{ position: 'absolute', left: 14, top: 14 }} />
                <input
                  type="text"
                  placeholder="admin, +998901234567 yoki email"
                  value={resetIdentifier}
                  onChange={(e) => setResetIdentifier(e.target.value)}
                  className="input-field"
                  style={{ paddingLeft: 42 }}
                  required
                  autoFocus
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setResetModalOpen(false)}
                className="btn btn-secondary"
              >
                Bekor Qilish
              </button>
              <button
                type="submit"
                disabled={resetLoading}
                className="btn btn-primary"
              >
                {resetLoading ? 'Yuborilmoqda...' : 'Tiklash Havolasini Yuborish'}
              </button>
            </div>
          </form>
        )}

        {resetMode === 'sent' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {hasEmail ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      background: 'rgba(var(--primary-rgb), 0.15)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Mail size={24} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      Tiklash Havolasi Yuborildi
                    </h4>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Elektron pochtangizni tekshiring
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Sizning hisobingizga biriktirilgan{' '}
                  <strong style={{ color: 'var(--primary)', letterSpacing: '0.04em', fontWeight: 700 }}>
                    {emailHint}
                  </strong>{' '}
                  pochtasiga parolni qayta tiklash uchun bir martalik havola yuborildi.
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: 'rgba(var(--primary-rgb), 0.08)',
                    border: '1px solid rgba(var(--primary-rgb), 0.25)',
                    fontSize: 12.5,
                    color: 'var(--text-primary)',
                    lineHeight: 1.5,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                  }}
                >
                  <AlertCircle size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <strong>Muhim eslatma:</strong> Agar xat asosiy pochtangizda ko‘rinmasa, iltimos, <strong>"Spam"</strong> yoki <strong>"Promotions"</strong> papkasini ham tekshiring. Havola 24 soat davomida amal qiladi.
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'rgba(var(--primary-rgb), 0.06)',
                    border: '1px dashed rgba(var(--primary-rgb), 0.3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                    Ushbu pochtaga kirish imkoni yo‘qmi yoki undan foydalanmaysizmi?
                  </span>
                  <button
                    type="button"
                    onClick={() => setResetMode('change_with_old')}
                    style={{
                      alignSelf: 'flex-start',
                      background: 'none',
                      border: 'none',
                      color: 'var(--primary)',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                      padding: 0,
                      textDecoration: 'underline',
                    }}
                  >
                    Men bu emaildan foydalanmayman &rarr;
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setResetModalOpen(false)}
                    className="btn btn-primary"
                    style={{ minWidth: 120 }}
                  >
                    Tushundim
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 14,
                      background: 'rgba(var(--danger-rgb), 0.12)',
                      color: 'var(--accent-rose)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <AlertCircle size={24} />
                  </div>
                  <div>
                    <h4 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      Email Manzil Mavjud Emas
                    </h4>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Akkauntga email biriktirilmagan
                    </span>
                  </div>
                </div>

                <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>
                  Ushbu hisobga elektron pochta biriktirilmagan. Parolni eslab qolgan eski (joriy)
                  parolingiz orqali yangilashingiz mumkin.
                </p>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => setResetModalOpen(false)}
                    className="btn btn-secondary"
                  >
                    Yopish
                  </button>
                  <button
                    type="button"
                    onClick={() => setResetMode('change_with_old')}
                    className="btn btn-primary"
                  >
                    Eski Parol Bilan Yangilash
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {resetMode === 'change_with_old' && (
          <form onSubmit={handleChangeWithOld} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Emailingizga kira olmasangiz, eslab qolgan joriy (eski) parolingizni kiritib yangi parol o‘rnatishingiz mumkin.
            </p>

            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                Foydalanuvchi nomi / Login
              </label>
              <input
                type="text"
                value={resetIdentifier || username}
                data-api-field="login"
                disabled
                className="input-field"
                style={{ opacity: 0.75, cursor: 'not-allowed' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                Eski (joriy) parol <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showOldPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={oldPassword}
                  data-api-field="old_password"
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="input-field"
                  style={{ paddingRight: 40 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowOldPassword(!showOldPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: 12,
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {showOldPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                Yangi parol <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder="Kamida 8 ta belgi"
                  value={newPassword}
                  data-api-field="new_password"
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="input-field"
                  style={{ paddingRight: 40 }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: 12,
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>
                Yangi parolni takrorlang <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                data-api-field="confirm_password"
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field"
                required
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setResetMode(hasEmail ? 'sent' : 'prompt_login')}
                className="btn btn-secondary"
              >
                Orqaga
              </button>
              <button
                type="submit"
                disabled={resetLoading}
                className="btn btn-primary"
              >
                {resetLoading ? 'Yangilanmoqda...' : 'Parolni Yangilash'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
