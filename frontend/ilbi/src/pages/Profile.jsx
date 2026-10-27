import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Trash2,
  Mail,
  Phone,
  Store,
  Shield,
  Save,
  KeyRound,
  CheckCircle2,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { authApi, resolveAvatarUrl } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import CustomDatePicker from '../components/common/CustomDatePicker';
import Modal from '../components/common/Modal';
import PhoneInput from '../components/common/PhoneInput';
import { formatPhoneUz } from '../utils/phoneFormat';
import { showFormErrors } from '../utils/formValidation.js';

export default function Profile() {
  const { user, refreshProfile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const fileInputRef = useRef(null);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    date_of_birth: '',
    contact_phone: '',
  });

  // Password change modal state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showResetInfoModal, setShowResetInfoModal] = useState(false);
  const [passwordData, setPasswordData] = useState({
    old_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  useEffect(() => {
    if (user) {
      setFormData({
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        email: user.email || '',
        date_of_birth: user.date_of_birth ? String(user.date_of_birth).split('T')[0] : '',
        contact_phone: user.contact_phone || '',
      });
      setAvatarError(false);
    }
  }, [user]);

  // Safe avatar URL resolver
  const rawAvatar = user?.avatar_url || user?.avatar;
  const avatarUrl = !avatarError ? resolveAvatarUrl(rawAvatar) : null;

  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.warning('Rasm hajmi 5MB dan oshmasligi kerak');
      return;
    }

    const data = new FormData();
    data.append('avatar', file);

    setUploadingAvatar(true);
    setAvatarError(false);
    try {
      await authApi.uploadAvatar(data);
      await refreshProfile();
      toast.success('Profil rasmi muvaffaqiyatli yuklandi!');
    } catch (err) {
      toast.error(err.message || 'Rasm yuklashda xatolik yuz berdi');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAvatar = async () => {
    const isConfirmed = await confirm({
      title: 'Profil rasmini o‘chirish',
      message: 'Haqiqatan ham profilingiz rasmini o‘chirib tashlamoqchimisiz? Bu amalni ortga qaytarib bo‘lmaydi.',
      confirmText: 'Ha, o‘chirish',
      cancelText: 'Bekor qilish',
      type: 'danger',
    });
    if (!isConfirmed) return;

    setUploadingAvatar(true);
    try {
      await authApi.deleteAvatar();
      await refreshProfile();
      setAvatarError(false);
      toast.success('Profil rasmi o‘chirildi');
    } catch (err) {
      toast.error(err.message || 'Rasmni o‘chirishda xatolik');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const cleanDate = formData.date_of_birth ? formData.date_of_birth.trim() : null;
      const cleanContactPhone = formData.contact_phone ? formData.contact_phone.trim() : null;
      await authApi.updateProfile({
        first_name: formData.first_name.trim(),
        last_name: formData.last_name.trim(),
        email: formData.email.trim(),
        date_of_birth: cleanDate || null,
        contact_phone: cleanContactPhone,
      });
      await refreshProfile();
      toast.success('Profil ma’lumotlari muvaffaqiyatli saqlandi!');
    } catch (err) {
      toast.error(err.message || 'Ma’lumotlarni saqlashda xatolik');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (!passwordData.old_password || !passwordData.new_password) {
      toast.warning('Joriy parol va yangi parolni kiriting');
      return;
    }
    if (passwordData.new_password.length < 8) {
      toast.warning('Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak');
      return;
    }
    if (passwordData.new_password !== passwordData.confirm_password) {
      showFormErrors(e.currentTarget, { confirm_password: 'Yangi parollar bir-biriga mos kelmadi.' });
      toast.warning('Yangi parollar bir-biriga mos kelmadi');
      return;
    }

    setChangingPassword(true);
    try {
      await authApi.changePassword(passwordData.old_password, passwordData.new_password);
      toast.success('Parolingiz muvaffaqiyatli o‘zgartirildi!');
      setShowPasswordModal(false);
      setPasswordData({ old_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      toast.error(err.message || 'Parolni o‘zgartirishda xatolik yuz berdi');
    } finally {
      setChangingPassword(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) {
      toast.warning('Avval profilingizga email manzilingizni kiriting va saqlang');
      return;
    }
    setSendingReset(true);
    try {
      const res = await authApi.passwordResetRequest(user.email);
      setShowResetInfoModal(true);
      toast.success(res?.detail || 'Tiklash havolasi emailingizga yuborildi. Agar xat kelmasa, "Spam" papkasini ham tekshiring.');
    } catch (err) {
      toast.error(err.message || 'Parolni tiklashda xatolik');
    } finally {
      setSendingReset(false);
    }
  };

  const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || user?.phone_number || 'Foydalanuvchi';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'IN';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900, margin: '0 auto', width: '100%' }}>
      {/* Header Banner */}
      <div>
        <h2 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px', color: 'var(--text-primary)' }}>
          Foydalanuvchi Profili
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>
          Shaxsiy ma’lumotlaringiz, profilingiz rasmi va xavfsizlik sozlamalari
        </p>
      </div>

      {/* Profile Overview Card */}
      <div
        className="glass-card"
        style={{
          padding: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
          {/* Avatar with Upload Hover Button */}
          <div style={{ position: 'relative', width: 92, height: 92 }}>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt=""
                onError={() => setAvatarError(true)}
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '3px solid var(--primary)',
                  boxShadow: 'var(--primary-glow)',
                  display: 'block',
                }}
              />
            ) : (
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, var(--bg-card) 0%, var(--bg-surface) 100%)',
                  border: '2px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  fontWeight: 800,
                  color: 'var(--primary)',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                {initials}
              </div>
            )}

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarSelect}
            />

            {/* Camera Overlay Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              title="Profil rasmini yuklash yoki o‘zgartirish"
              style={{
                position: 'absolute',
                bottom: -2,
                right: -2,
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                border: '2.5px solid var(--bg-surface)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: uploadingAvatar ? 'not-allowed' : 'pointer',
                boxShadow: 'var(--shadow-sm)',
                transition: 'transform 0.15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.12)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              <Camera size={15} />
            </button>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                {displayName}
              </h3>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 11,
                  fontWeight: 700,
                  background: 'var(--primary-light)',
                  color: 'var(--primary)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Shield size={12} />
                {user?.role_display || user?.role || 'Foydalanuvchi'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '4px 0 8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Phone size={13} style={{ color: 'var(--primary)' }} />
                <span>Asosiy: <strong>{user?.phone_number || 'Kiritilmagan'}</strong></span>
              </span>
              {user?.contact_phone && user.contact_phone !== user.phone_number && (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Phone size={13} style={{ color: 'var(--accent-emerald)' }} />
                  <span>Aloqa: <strong>{user.contact_phone}</strong></span>
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {user?.tenant_name && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                    background: 'var(--bg-chip)',
                    color: 'var(--text-secondary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Store size={13} />
                  <span>{user.tenant_name}</span>
                </span>
              )}
              {user?.is_phone_verified && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 12,
                    background: 'rgba(34, 197, 94, 0.12)',
                    color: 'var(--accent-emerald)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontWeight: 600,
                  }}
                >
                  <CheckCircle2 size={13} />
                  <span>Tasdiqlangan</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Delete Avatar Button */}
        {avatarUrl && (
          <button
            type="button"
            onClick={handleDeleteAvatar}
            disabled={uploadingAvatar}
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(var(--danger-rgb), 0.25)',
              background: 'rgba(var(--danger-rgb), 0.08)',
              color: 'var(--accent-rose)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Trash2 size={14} />
            <span>Rasmni O‘chirish</span>
          </button>
        )}
      </div>

      {/* Edit Form */}
      <form onSubmit={handleSaveProfile} className="glass-card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h4 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
          Shaxsiy Ma’lumotlarni Tahrirlash
        </h4>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
              Ism
            </label>
            <input data-api-field="first_name"
              id="first-name"
              name="given-name"
              autoComplete="given-name"
              type="text"
              placeholder="Ismingizni kiriting"
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              className="input-field"
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
              Familiya
            </label>
            <input data-api-field="last_name"
              id="last-name"
              name="family-name"
              autoComplete="family-name"
              type="text"
              placeholder="Familiyangizni kiriting"
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              className="input-field"
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
              Email Manzil
            </label>
            <input data-api-field="email"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="example@mail.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="input-field"
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
              Tug‘ilgan Sana
            </label>
            <CustomDatePicker data-api-field="date_of_birth"
              id="bday"
              name="bday"
              value={formData.date_of_birth}
              onChange={(val) => {
                const cleanVal = typeof val === 'string' ? val : (val?.target?.value || '');
                setFormData({ ...formData, date_of_birth: cleanVal });
              }}
              placeholder="Tug‘ilgan sanani tanlang..."
              max="2026-12-31"
              min="1920-01-01"
              fullWidth
              size="lg"
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Format: YYYY-MM-DD (masalan: 1995-05-20)
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
              Asosiy Raqam (Login & Telegram 2FA)
            </label>
            <input
              type="text"
              disabled
              value={formatPhoneUz(user?.phone_number) || user?.phone_number || ''}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-chip)',
                color: 'var(--text-muted)',
                fontSize: 14,
                cursor: 'not-allowed',
              }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Lock size={11} style={{ opacity: 0.7 }} />
              <span>O‘zgarmas identifikator (2FA kodlari shu raqamga keladi)</span>
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
              Doimiy Aloqa Raqami (Qo‘ng‘iroqlar uchun)
            </label>
            <div style={{ position: 'relative' }}>
              <Phone
                size={16}
                color="var(--text-muted)"
                style={{ position: 'absolute', left: 14, top: 14 }}
              />
              <PhoneInput data-api-field="contact_phone"
                id="contact-phone"
                name="tel"
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                className="input-field"
                style={{
                  width: '100%',
                  padding: '11px 14px 11px 40px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Bo‘sh qolsa, asosiy raqamingiz aloqa raqami hisoblanadi
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
              Do‘kon Bog‘lanmasi
            </label>
            <input
              type="text"
              disabled
              value={user?.tenant_name || 'Biriktirilmagan'}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-chip)',
                color: 'var(--text-muted)',
                fontSize: 14,
                cursor: 'not-allowed',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
              Foydalanuvchi Nomi (Username)
            </label>
            <input
              type="text"
              disabled
              value={user?.username || 'Belgilanmagan'}
              style={{
                width: '100%',
                padding: '11px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-chip)',
                color: 'var(--text-muted)',
                fontSize: 14,
                cursor: 'not-allowed',
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-primary"
            style={{
              padding: '12px 28px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              fontSize: 14,
              fontWeight: 800,
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: 'var(--shadow-sm)',
              transition: 'all 0.2s ease',
            }}
          >
            <Save size={16} />
            <span>{saving ? 'Saqlanmoqda...' : 'O‘zgarishlarni Saqlash'}</span>
          </button>
        </div>
      </form>

      {/* Security & Password Section */}
      <div className="glass-card" style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <h4 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
          Xavfsizlik & Parol Boshqaruvi
        </h4>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
          {/* Direct Password Change Card */}
          <div
            style={{
              padding: 20,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Lock size={16} style={{ color: 'var(--primary)' }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Parolni O‘zgartirish
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Joriy parolingizni kiritgan holda yangi xavfsiz parol o‘rnating.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowPasswordModal(true)}
              className="btn btn-primary"
              style={{
                padding: '9px 18px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <KeyRound size={15} />
              <span>Parolni O‘zgartirish</span>
            </button>
          </div>

          {/* Email Reset Link Card */}
          <div
            style={{
              padding: 20,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Mail size={16} style={{ color: 'var(--accent-cyan)' }} />
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Email orqali Tiklash
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Parolni unutgan hollarda bir martalik xavfsiz tiklash havolasini yuborish.
              </p>
            </div>

            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={sendingReset}
              style={{
                padding: '9px 18px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontSize: 13,
                fontWeight: 600,
                cursor: sendingReset ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Mail size={15} />
              <span>{sendingReset ? 'Yuborilmoqda...' : 'Tiklash Havolasini Yuborish'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      <Modal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        title="Parolni O‘zgartirish"
        maxWidth={440}
      >
        <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Old Password */}
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
                  Joriy Parol
                </label>
                <div style={{ position: 'relative' }}>
                  <input data-api-field="old_password"
                    id="current-password"
                    name="current-password"
                    autoComplete="current-password"
                    type={showOldPassword ? 'text' : 'password'}
                    placeholder="Joriy parolingizni kiriting"
                    value={passwordData.old_password}
                    onChange={(e) => setPasswordData({ ...passwordData, old_password: e.target.value })}
                    className="input-field"
                    required
                    style={{
                      width: '100%',
                      padding: '11px 40px 11px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-card)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowOldPassword(!showOldPassword)}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 4,
                    }}
                  >
                    {showOldPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* New Password */}
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
                  Yangi Parol (kamida 8 ta belgi)
                </label>
                <div style={{ position: 'relative' }}>
                  <input data-api-field="new_password"
                    id="new-password"
                    name="new-password"
                    autoComplete="new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="Yangi parolni kiriting"
                    value={passwordData.new_password}
                    onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })}
                    className="input-field"
                    required
                    minLength={8}
                    style={{
                      width: '100%',
                      padding: '11px 40px 11px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-card)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 4,
                    }}
                  >
                    {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div>
                <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 600 }}>
                  Yangi Parolni Tasdiqlang
                </label>
                <input data-api-field="confirm_password"
                  id="confirm-password"
                  name="confirm-password"
                  autoComplete="new-password"
                  type="password"
                  placeholder="Yangi parolni qayta kiriting"
                  value={passwordData.confirm_password}
                  onChange={(e) => setPasswordData({ ...passwordData, confirm_password: e.target.value })}
                  className="input-field"
                  required
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-card)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: 14,
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  style={{
                    padding: '10px 18px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Bekor qilish
                </button>
                <button
                  type="submit"
                  disabled={changingPassword}
                  className="btn btn-primary"
                  style={{
                    padding: '10px 22px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: changingPassword ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Save size={15} />
                  <span>{changingPassword ? 'Saqlanmoqda...' : 'Tasdiqlash'}</span>
                </button>
              </div>
            </form>
      </Modal>

      {/* Reset Info Modal */}
      <Modal
        isOpen={showResetInfoModal}
        onClose={() => setShowResetInfoModal(false)}
        title="Parolni Qayta Tiklash Havolasi"
        maxWidth={480}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0 }}>
              Parolni yangilash so‘rovi muvaffaqiyatli qabul qilindi.
            </p>
            <div
              style={{
                padding: 14,
                borderRadius: 10,
                background: 'rgba(var(--primary-rgb), 0.08)',
                border: '1px solid rgba(var(--primary-rgb), 0.25)',
                fontSize: 12.5,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <AlertTriangle size={16} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 4 }}>
                  Pochtani tekshiring
                </strong>
                Parolni qayta tiklash havolasi elektron pochtangizga muvaffaqiyatli yuborildi. Agar xat asosiy pochtangizda ko‘rinmasa, iltimos, <strong>"Spam"</strong> yoki <strong>"Promotions"</strong> papkasini ham tekshirib ko‘ring. Havola 24 soat davomida amal qiladi.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setShowResetInfoModal(false)}
              className="btn btn-primary"
              style={{ padding: '9px 24px', fontSize: 13, fontWeight: 700 }}
            >
              Tushundim
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
