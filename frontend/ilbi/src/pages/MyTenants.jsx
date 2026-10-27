import IlbiLoader from '../components/common/IlbiLoader';
import { localStore, sessionStore } from '../utils/brandStorage.js';
import React, { useEffect, useState } from 'react';
import {
  Check,
  Plus,
  Store,
  Building2,
  MapPin,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { tenantApi } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../context/TenantContext';
import { useToast } from '../context/ToastContext';
import CustomSelect from '../components/common/CustomSelect';

const LEGAL_FORM_OPTIONS = [
  { value: 'ytt', label: 'YTT (Yakka tartibdagi tadbirkor)' },
  { value: 'mchj', label: 'MChJ (Mas’uliyati cheklangan jamiyat)' },
  { value: 'other', label: 'Boshqa tashkiliy-huquqiy shakl' },
];

export default function MyTenants() {
  const { user, refreshProfile } = useAuth();
  const { activeTenant, selectTenant } = useTenant();
  const toast = useToast();

  const [tenants, setTenants] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingTenant, setSavingTenant] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // New tenant form state
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [sellerProfile, setSellerProfile] = useState('');
  const [editingProfileId, setEditingProfileId] = useState(null);

  // New seller profile form state
  const [profileForm, setProfileForm] = useState({
    legal_form: 'ytt',
    official_name: '',
    tax_identifier: '',
    tax_regime: '',
    permitted_activity: '',
    fiscal_provider: '',
  });

  const loadTenants = async () => {
    setLoading(true);
    try {
      const data = await tenantApi.getMyTenants();
      setTenants(Array.isArray(data) ? data : []);
      const profileData = await tenantApi.getSellerProfiles();
      setProfiles(Array.isArray(profileData) ? profileData : []);
    } catch (error) {
      toast.error(error.message || 'Do‘konlarni yuklashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenants();
  }, []);

  const createSellerProfile = async (event) => {
    event.preventDefault();
    if (!profileForm.official_name.trim() || (!editingProfileId && !profileForm.tax_identifier.trim())) {
      toast.warning('Rasmiy nomi va STIR maydonlarini to‘ldiring');
      return;
    }

    setSavingProfile(true);
    try {
      const payload = {
        ...profileForm,
        official_name: profileForm.official_name.trim(),
        tax_identifier: profileForm.tax_identifier.trim(),
        tax_regime: profileForm.tax_regime.trim(),
        permitted_activity: profileForm.permitted_activity.trim(),
        fiscal_provider: profileForm.fiscal_provider.trim(),
      };
      if (editingProfileId && !payload.tax_identifier) delete payload.tax_identifier;
      const created = editingProfileId
        ? await tenantApi.updateSellerProfile(editingProfileId, payload)
        : await tenantApi.createSellerProfile(payload);
      setProfiles((current) => editingProfileId ? current.map((profile) => profile.id === created.id ? created : profile) : [...current, created]);
      setEditingProfileId(null);
      setSellerProfile(String(created.id));
      setProfileForm({
        legal_form: 'ytt',
        official_name: '',
        tax_identifier: '',
        tax_regime: '',
        permitted_activity: '',
        fiscal_provider: '',
      });
      toast.success('Sotuvchi profili tekshiruvga yuborildi');
    } catch (error) {
      toast.error(error.message || 'Sotuvchi profili yuborilmadi');
    } finally {
      setSavingProfile(false);
    }
  };

  const bindProfile = async (tenantId, profileId) => {
    try {
      const parsedId = profileId ? Number(profileId) : null;
      const updated = await tenantApi.bindMyTenantSellerProfile(tenantId, parsedId);
      setTenants((current) =>
        current.map((tenant) => (tenant.id === tenantId ? updated : tenant))
      );
      toast.success(
        parsedId
          ? 'Sotuvchi profili do‘konga biriktirildi'
          : 'Profil biriktiruvi bekor qilindi'
      );
    } catch (error) {
      toast.error(error.message || 'Profil biriktirilmadi');
      await loadTenants();
    }
  };

  const createTenant = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;

    setSavingTenant(true);
    try {
      const created = await tenantApi.createMyTenant({
        name: name.trim(),
        address: address.trim(),
        description: description.trim(),
        ...(sellerProfile ? { seller_profile: Number(sellerProfile) } : {}),
        ...(copyFrom ? { copy_settings_from: Number(copyFrom) } : {}),
      });

      const storageKey = `ilbi_active_tenant:${user.id}`;
      sessionStore.setItem(storageKey, String(created.id));
      localStore.setItem(storageKey, String(created.id));
      await refreshProfile();

      setName('');
      setAddress('');
      setDescription('');
      setCopyFrom('');
      setSellerProfile('');
      toast.success('Yangi do‘kon muvaffaqiyatli qo‘shildi');
      await loadTenants();
    } catch (error) {
      toast.error(error.message || 'Do‘kon yaratilmadi');
    } finally {
      setSavingTenant(false);
    }
  };

  // Options for selecting seller profiles when creating a new store
  const sellerProfileOptions = [
    { value: '', label: 'Sotuvchi profiliga biriktirmaslik' },
    ...profiles.map((p) => ({
      value: String(p.id),
      label: `${p.official_name} (${p.status_display || p.status})`,
      badge:
        p.status === 'approved'
          ? 'Faol'
          : p.status === 'pending'
          ? 'Kutilmoqda'
          : null,
    })),
  ];

  // Options for copying settings from an existing store
  const copyFromOptions = [
    { value: '', label: 'Sozlamalarni nusxalamaslik (boshlang‘ich sozlamalar)' },
    ...tenants.map((t) => ({
      value: String(t.id),
      label: `"${t.name}" sozlamalarini nusxalash`,
    })),
  ];

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '16px 20px 48px' }}>
      {/* Page Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: 'var(--primary-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
              boxShadow: '0 2px 10px rgba(var(--primary-rgb), 0.2)',
            }}
          >
            <Store size={22} />
          </div>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
              }}
            >
              Mening do‘konlarim
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 13.5, color: 'var(--text-muted)' }}>
              Har bir do‘konning katalogi, tovar qoldig‘i va kassasi alohida yuritiladi.
            </p>
          </div>
        </div>
      </div>

      {/* Stores List Section */}
      <section style={{ marginBottom: 36 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>Mavjud filiallar va do‘konlar</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 9px',
                borderRadius: 12,
                background: 'var(--bg-chip)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {tenants.length} ta
            </span>
          </div>
        </div>

        {loading ? (
          <div
            className="glass-card"
            style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}
          >
            <IlbiLoader label="Ma’lumotlar yuklanmoqda..." />
          </div>
        ) : tenants.length === 0 ? (
          <div className="glass-card" style={{ padding: 48, textAlign: 'center' }}>
            <Store
              size={44}
              style={{ color: 'var(--text-muted)', margin: '0 auto 12px', opacity: 0.5 }}
            />
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              Hozircha do‘konlar mavjud emas
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Quyidagi forma orqali birinchi do‘koningizni yarating.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {tenants.map((tenant) => {
              const isActive = String(activeTenant?.id) === String(tenant.id);
              return (
                <div
                  key={tenant.id}
                  className="glass-card"
                  style={{
                    padding: '18px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 20,
                    flexWrap: 'wrap',
                    border: isActive
                      ? '1px solid var(--primary)'
                      : '1px solid var(--border-card)',
                    boxShadow: isActive ? '0 0 20px var(--primary-light)' : undefined,
                  }}
                >
                  {/* Left: Store info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 260 }}>
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 14,
                        background: isActive ? 'var(--primary)' : 'var(--bg-chip)',
                        color: isActive ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Store size={22} />
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <strong
                          style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}
                        >
                          {tenant.name}
                        </strong>
                        <span
                          style={{
                            fontSize: 11,
                            fontFamily: 'monospace',
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: 'var(--bg-chip)',
                            color: 'var(--primary)',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          {tenant.public_code}
                        </span>
                      </div>

                      <div
                        style={{
                          fontSize: 13,
                          color: 'var(--text-secondary)',
                          marginTop: 4,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <MapPin size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <span>{tenant.address || 'Manzil kiritilmagan'}</span>
                      </div>

                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-muted)',
                          marginTop: 4,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <Building2 size={13} style={{ flexShrink: 0 }} />
                        <span>
                          Sotuvchi profili:{' '}
                          {tenant.seller_profile ? (
                            <strong style={{ color: 'var(--text-secondary)' }}>
                              {tenant.seller_profile.official_name} (
                              {tenant.seller_profile.status || 'faol'})
                            </strong>
                          ) : (
                            <span style={{ fontStyle: 'italic' }}>biriktirilmagan</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions & Profile Binding */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      flexWrap: 'wrap',
                    }}
                  >
                    {profiles.length > 0 && (
                      <div style={{ minWidth: 230 }}>
                        <CustomSelect
                          value={String(tenant.seller_profile?.id || '')}
                          onChange={(val) => bindProfile(tenant.id, val)}
                          options={[
                            { value: '', label: 'Profil biriktirilmagan' },
                            ...profiles.map((p) => ({
                              value: String(p.id),
                              label: `${p.official_name} · ${p.status_display || p.status}`,
                            })),
                          ]}
                          size="sm"
                          placeholder="Profilni biriktirish..."
                        />
                      </div>
                    )}

                    {isActive ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '8px 16px',
                          borderRadius: 'var(--radius-sm, 10px)',
                          background: 'rgba(var(--success-rgb), 0.12)',
                          color: 'var(--accent-emerald)',
                          fontSize: 13,
                          fontWeight: 700,
                          border: '1px solid rgba(var(--success-rgb), 0.25)',
                        }}
                      >
                        <Check size={16} strokeWidth={2.5} />
                        <span>Faol do‘kon</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => selectTenant(tenant)}
                        style={{
                          padding: '8px 18px',
                          borderRadius: 'var(--radius-sm, 10px)',
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Tanlash
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Forms Grid (Two Column on Desktop, Stacked on Mobile) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
          gap: 24,
          alignItems: 'start',
        }}
      >
        {/* Card 1: Add New Store */}
        <form
          onSubmit={createTenant}
          className="glass-card"
          style={{
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14 }}>
            <h2
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: 0,
                color: 'var(--text-primary)',
                fontSize: 17,
                fontWeight: 700,
              }}
            >
              <Plus size={20} style={{ color: 'var(--primary)' }} />
              <span>Yangi do‘kon qo‘shish</span>
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Yangi filial yoki savdo nuqtasi ochish va sozlamalarini belgilash
            </p>
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}
            >
              Do‘kon nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              placeholder="Masalan: ARA-mobile 2-filial"
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}
            >
              Manzil (ixtiyoriy)
            </label>
            <input
              className="input-field"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={255}
              placeholder="Toshkent sh., Chilonzor tumani, 9-mavze..."
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-secondary)',
                marginBottom: 6,
              }}
            >
              Izoh / Tavsif (ixtiyoriy)
            </label>
            <textarea
              className="input-field"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Filial yoki savdo nuqtasi haqida qo‘shimcha eslatmalar..."
              rows={2}
              style={{ resize: 'vertical' }}
            />
          </div>

          {profiles.length > 0 && (
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Sotuvchi profili (Fiskal ma’lumotlar)
              </label>
              <CustomSelect
                value={sellerProfile}
                onChange={setSellerProfile}
                options={sellerProfileOptions}
                fullWidth
                size="md"
              />
            </div>
          )}

          {tenants.length > 0 && (
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Sozlamalarni nusxalash (ixtiyoriy)
              </label>
              <CustomSelect
                value={copyFrom}
                onChange={setCopyFrom}
                options={copyFromOptions}
                fullWidth
                size="md"
              />
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={savingTenant || !name.trim()}
              style={{
                width: '100%',
                padding: '12px 20px',
                borderRadius: 'var(--radius-sm, 12px)',
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              <Plus size={18} />
              <span>{savingTenant ? 'Yaratilmoqda...' : 'Do‘kon yaratish'}</span>
            </button>
          </div>
        </form>

        {/* Card 2: Seller Profiles & Submission */}
        <div
          className="glass-card"
          style={{
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <div style={{ borderBottom: '1px solid var(--border-subtle)', paddingBottom: 14 }}>
            <h2
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: 0,
                color: 'var(--text-primary)',
                fontSize: 17,
                fontWeight: 700,
              }}
            >
              <ShieldCheck size={20} style={{ color: 'var(--accent-emerald)' }} />
              <span>Sotuvchi profillari</span>
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
              Har bir YTT yoki yuridik shaxs uchun profil yarating. Tekshiruv holati tasdiqlanmaguncha
              POS chek fiskalizatsiyasi cheklanadi.
            </p>
          </div>

          {/* Existing profiles list */}
          {profiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>Mavjud sotuvchi profillari:</span>
                <span style={{ color: 'var(--text-muted)' }}>({profiles.length})</span>
              </div>

              {profiles.map((profile) => {
                const isApproved = profile.status === 'approved';
                const isRejected = profile.status === 'rejected';
                return (
                  <div
                    key={profile.id}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 12,
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
                        {profile.official_name}
                      </strong>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '3px 8px',
                          borderRadius: 6,
                          background: isApproved
                            ? 'rgba(var(--success-rgb), 0.15)'
                            : isRejected
                            ? 'rgba(var(--danger-rgb), 0.15)'
                            : 'rgba(var(--primary-rgb), 0.15)',
                          color: isApproved
                            ? 'var(--accent-emerald)'
                            : isRejected
                            ? 'var(--accent-rose)'
                            : 'var(--accent-amber)',
                        }}
                      >
                        {profile.status_display || profile.status}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--text-muted)',
                        marginTop: 4,
                        display: 'flex',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>
                        {profile.legal_form}
                      </span>
                      <span>•</span>
                      <span>
                        STIR: {profile.tax_identifier_masked || profile.tax_identifier}
                      </span>
                    </div>

                    <button
                      className="btn btn-secondary"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        setEditingProfileId(profile.id);
                        setProfileForm(Object.fromEntries(['legal_form', 'official_name', 'tax_identifier', 'tax_regime', 'permitted_activity', 'fiscal_provider'].map((field) => [field, profile[field] || ''])));
                      }}
                    >
                      Ma’lumotlarini tahrirlash
                    </button>
                    {profile.review_reason && (
                      <div
                        style={{
                          fontSize: 12,
                          color: isApproved
                            ? 'var(--accent-emerald)'
                            : isRejected
                            ? 'var(--accent-rose)'
                            : 'var(--accent-amber)',
                          marginTop: 8,
                          background: isApproved
                            ? 'rgba(var(--success-rgb), 0.1)'
                            : isRejected
                            ? 'rgba(var(--danger-rgb), 0.08)'
                            : 'rgba(var(--primary-rgb), 0.08)',
                          padding: '6px 10px',
                          borderRadius: 6,
                          border: `1px solid ${
                            isApproved
                              ? 'rgba(var(--success-rgb), 0.25)'
                              : isRejected
                              ? 'rgba(var(--danger-rgb), 0.25)'
                              : 'rgba(var(--primary-rgb), 0.25)'
                          }`,
                        }}
                      >
                        {isRejected ? 'Rad etish sababi' : 'Izoh'}: {profile.review_reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Form to submit new profile */}
          <form
            onSubmit={createSellerProfile}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              padding: 16,
              borderRadius: 14,
              background: 'var(--bg-input)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              {editingProfileId ? "Sotuvchi profilini yangilash (qayta tekshiruvga yuboriladi)" : "Yangi sotuvchi profilini yuborish"}
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Tashkiliy-huquqiy shakli <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <CustomSelect data-api-field="legal_form"
                value={profileForm.legal_form}
                onChange={(val) => setProfileForm({ ...profileForm, legal_form: val })}
                options={LEGAL_FORM_OPTIONS}
                fullWidth
                size="md"
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Rasmiy nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <input data-api-field="official_name"
                className="input-field"
                required
                maxLength={200}
                placeholder="Masalan: YTT Aliyev Vali yoki 'ARA MOB' MChJ"
                value={profileForm.official_name}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, official_name: e.target.value })
                }
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                STIR yoki tegishli identifikator <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <input data-api-field="tax_identifier"
                className="input-field"
                required={!editingProfileId}
                maxLength={20}
                placeholder={editingProfileId ? "O‘zgartirish uchun yangi STIR kiriting" : "9 xonali STIR (INN)"}
                value={profileForm.tax_identifier}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, tax_identifier: e.target.value })
                }
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Soliq rejimi (ixtiyoriy)
              </label>
              <input data-api-field="tax_regime"
                className="input-field"
                maxLength={100}
                placeholder="Masalan: Aylanmadan olinadigan soliq (4%)"
                value={profileForm.tax_regime}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, tax_regime: e.target.value })
                }
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Ruxsatli faoliyat turi (ixtiyoriy)
              </label>
              <textarea data-api-field="permitted_activity"
                className="input-field"
                rows={2}
                placeholder="Masalan: Uyali aloqa vositalari va aksessuarlari savdosi..."
                value={profileForm.permitted_activity}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, permitted_activity: e.target.value })
                }
                style={{ resize: 'vertical' }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  marginBottom: 6,
                }}
              >
                Fiskal provayder (ixtiyoriy)
              </label>
              <input data-api-field="fiscal_provider"
                className="input-field"
                maxLength={150}
                placeholder="Masalan: Soliq servis / E-POS"
                value={profileForm.fiscal_provider}
                onChange={(e) =>
                  setProfileForm({ ...profileForm, fiscal_provider: e.target.value })
                }
              />
            </div>

            <div style={{ marginTop: 6 }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  savingProfile ||
                  !profileForm.official_name.trim() ||
                  (!editingProfileId && !profileForm.tax_identifier.trim())
                }
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  borderRadius: 'var(--radius-sm, 12px)',
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                <Send size={16} />
                <span>{savingProfile ? 'Yuborilmoqda...' : 'Tekshiruvga yuborish'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
