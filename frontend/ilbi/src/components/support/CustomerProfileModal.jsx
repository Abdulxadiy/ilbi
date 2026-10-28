import IlbiLoader from '../common/IlbiLoader';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  User,
  Store,
  AlertTriangle,
  ExternalLink,
  Edit2,
  Save,
} from 'lucide-react';
import { safeDisplayText } from '../../utils/safePresentation.js';

export default function CustomerProfileModal({ conversationId, api, onClose, onCustomerUpdated }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [loadedConversation, setLoadedConversation] = useState(null);
  const generation = useRef(0);
  const cancelPending = useCallback(() => { generation.current++; }, []);

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    contact_phone: '',
    tenant_name: '',
    tenant_address: '',
  });

  useEffect(() => {
    generation.current++;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active || !conversationId) return;
      setLoading(true); setError(''); setEditing(false); setSaving(false); setToast(''); setProfile(null);
      try {
        const data = await api.customerProfile(conversationId);
        if (!active) return;
        setProfile(data);
        if (data.user) setForm({ first_name: data.user.first_name || '', last_name: data.user.last_name || '', contact_phone: data.user.contact_phone || '', tenant_name: data.tenant?.name || '', tenant_address: data.tenant?.address || '' });
      } catch (err) {
        if (active) setError(safeDisplayText(err.message, 'Mijoz ma‘lumotlarini yuklab bo‘lmadi.'));
      } finally {
        if (active) { setLoadedConversation(conversationId); setLoading(false); }
      }
    });
    return () => { active = false; cancelPending(); };
  }, [conversationId, api, cancelPending]);

  const showToast = (msg) => {
    setToast(safeDisplayText(msg));
    setTimeout(() => setToast(''), 3500);
  };

  const handleSave = async () => {
    if (loadedConversation !== conversationId || loading || saving) return;
    const current = generation.current;
    setSaving(true);
    try {
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
        contact_phone: form.contact_phone,
      };
      if (profile?.tenant) {
        payload.tenant_name = form.tenant_name;
        payload.tenant_address = form.tenant_address;
      }
      const updated = await api.updateCustomerProfile(conversationId, payload);
      if (generation.current !== current) return;
      setProfile(updated);
      setEditing(false);
      showToast('O‘zgarishlar muvaffaqiyatli saqlandi!');
      if (onCustomerUpdated) onCustomerUpdated(updated);
    } catch (err) {
      if (generation.current === current) showToast(err.message || 'Saqlashda xatolik yuz berdi');
    } finally {
      if (generation.current === current) setSaving(false);
    }
  };

  const openAccounts = () => { onClose(); navigate('/accounts?' + new URLSearchParams({ search: profile?.user?.phone_number || profile?.user?.username || '' })); };
  const openStores = () => { onClose(); navigate('/tenants'); };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Mavjud emas';
    try {
      return new Date(dateStr).toLocaleString('uz-UZ', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="customer-profile-backdrop" onClick={onClose}>
      <div className="customer-profile-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="customer-profile-header">
          <div className="customer-profile-user-info">
            <div className="customer-profile-avatar">
              {profile?.user ? (
                profile.user.first_name ? profile.user.first_name.charAt(0).toUpperCase() : 'U'
              ) : (
                'M'
              )}
            </div>
            <div className="customer-profile-name-wrap">
              <h3>
                {profile?.user
                  ? profile.user.full_name || profile.user.username || profile.user.phone_number
                  : profile?.guest?.name || 'Mehmon'}
              </h3>
              <div className="customer-profile-badge-row">
                {profile?.user ? (
                  <>
                    <span className={`customer-profile-badge ${profile.user.is_active ? 'active' : 'inactive'}`}>
                      {profile.user.is_active ? 'Faol hisob' : 'Bloklangan'}
                    </span>
                    <span className="customer-profile-badge role">
                      {profile.user.role_display || profile.user.role}
                    </span>
                    {profile.user.is_phone_verified && (
                      <span className="customer-profile-badge active" title="SMS tasdiqlangan">
                        ✓ Tasdiqlangan
                      </span>
                    )}
                  </>
                ) : (
                  <span className="customer-profile-badge guest">Mehmon tashrifchi</span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="support-widget-icon-btn"
            onClick={onClose}
            title="Yopish"
            style={{ width: 34, height: 34 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Toast Notification */}
        {toast && (
          <div style={{
            background: 'var(--primary)',
            color: 'var(--text-on-primary)',
            fontWeight: 600,
            fontSize: 12.5,
            padding: '8px 16px',
            textAlign: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}>
            {toast}
          </div>
        )}

        {/* Content Body */}
        <div className="customer-profile-body">
          {loading || loadedConversation !== conversationId ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
              <IlbiLoader label="Mijoz ma‘lumotlari yuklanmoqda..." />
            </div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--accent-rose)' }}>
              <AlertTriangle size={32} style={{ marginBottom: 12 }} />
              <div>{error}</div>
            </div>
          ) : profile && (
            <>
              {/* Stats Overview */}
              <div className="customer-profile-stats-grid">
                <div className="customer-profile-stat-card">
                  <span className="customer-profile-stat-number">{profile.stats?.total_conversations || 1}</span>
                  <span className="customer-profile-stat-label">Murojaatlari</span>
                </div>
                <div className="customer-profile-stat-card">
                  <span className="customer-profile-stat-number">{profile.stats?.total_sales || 0}</span>
                  <span className="customer-profile-stat-label">Jami savdolar</span>
                </div>
                <div className="customer-profile-stat-card">
                  <span className="customer-profile-stat-number">{profile.stats?.total_products || 0}</span>
                  <span className="customer-profile-stat-label">Tovarlar</span>
                </div>
              </div>

              {/* Personal Information */}
              <div className="customer-profile-section">
                <div className="customer-profile-section-title">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <User size={15} /> Shaxsiy Ma'lumotlar
                  </span>
                  {profile.user && !editing && (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Edit2 size={13} /> Tahrirlash
                    </button>
                  )}
                </div>

                {profile.user ? (
                  <div className="customer-profile-grid">
                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Ismi</span>
                      {editing ? (
                        <input data-api-field="first_name"
                          type="text"
                          className="customer-profile-input"
                          value={form.first_name}
                          onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                        />
                      ) : (
                        <span className="customer-profile-value">{profile.user.first_name || '—'}</span>
                      )}
                    </div>

                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Familiyasi</span>
                      {editing ? (
                        <input data-api-field="last_name"
                          type="text"
                          className="customer-profile-input"
                          value={form.last_name}
                          onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                        />
                      ) : (
                        <span className="customer-profile-value">{profile.user.last_name || '—'}</span>
                      )}
                    </div>

                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Asosiy telefon</span>
                      <span className="customer-profile-value" style={{ fontFamily: 'monospace' }}>
                        {profile.user.phone_number}
                      </span>
                    </div>

                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Qo‘shimcha aloqa</span>
                      {editing ? (
                        <input data-api-field="contact_phone"
                          type="text"
                          className="customer-profile-input"
                          placeholder="+998..."
                          value={form.contact_phone}
                          onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                        />
                      ) : (
                        <span className="customer-profile-value" style={{ fontFamily: 'monospace' }}>
                          {profile.user.contact_phone || 'Kiritilmagan'}
                        </span>
                      )}
                    </div>

                    <div className="customer-profile-item full-width">
                      <span className="customer-profile-label">Email manzili</span>
                      <span className="customer-profile-value">{profile.user.email || 'Kiritilmagan'}</span>
                    </div>

                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Tizimdagi roli</span>
                      <span className="customer-profile-value">{profile.user.role_display}</span>
                    </div>

                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Ro‘yxatdan o‘tgan</span>
                      <span className="customer-profile-value" style={{ fontSize: 12 }}>
                        {formatDate(profile.user.created_at)}
                      </span>
                    </div>

                    <div className="customer-profile-item full-width">
                      <span className="customer-profile-label">Oxirgi kirish vaqti</span>
                      <span className="customer-profile-value" style={{ fontSize: 12 }}>
                        {formatDate(profile.user.last_login)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="customer-profile-grid">
                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Mehmon ismi</span>
                      <span className="customer-profile-value">{profile.guest?.name}</span>
                    </div>
                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Tanlagan tili</span>
                      <span className="customer-profile-value">O‘zbekcha</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Store & Business Information */}
              <div className="customer-profile-section">
                <div className="customer-profile-section-title">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Store size={15} /> Do‘kon va Biznes Ma'lumotlari
                  </span>
                  {profile.tenant && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        navigate('/tenants');
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        fontSize: 11.5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      Boshqaruv <ExternalLink size={12} />
                    </button>
                  )}
                </div>

                {profile.tenant ? (
                  <div className="customer-profile-grid">
                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Do‘kon nomi</span>
                      {editing ? (
                        <input data-api-field="tenant_name"
                          type="text"
                          className="customer-profile-input"
                          value={form.tenant_name}
                          onChange={(e) => setForm({ ...form, tenant_name: e.target.value })}
                        />
                      ) : (
                        <span className="customer-profile-value" style={{ fontWeight: 700 }}>
                          {profile.tenant.name}
                        </span>
                      )}
                    </div>

                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Do‘kon kodi</span>
                      <span className="customer-profile-value" style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>
                        {profile.tenant.public_code}
                      </span>
                    </div>

                    <div className="customer-profile-item full-width">
                      <span className="customer-profile-label">Manzil</span>
                      {editing ? (
                        <input data-api-field="tenant_address"
                          type="text"
                          className="customer-profile-input"
                          value={form.tenant_address}
                          onChange={(e) => setForm({ ...form, tenant_address: e.target.value })}
                        />
                      ) : (
                        <span className="customer-profile-value">{profile.tenant.address || 'Kiritilmagan'}</span>
                      )}
                    </div>

                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Do‘kon holati</span>
                      <span className={`customer-profile-badge ${profile.tenant.is_active ? 'active' : 'inactive'}`} style={{ width: 'fit-content' }}>
                        {profile.tenant.is_active ? 'Faoliyatda' : 'To‘xtatilgan'}
                      </span>
                    </div>

                    <div className="customer-profile-item">
                      <span className="customer-profile-label">Do‘kon egasi</span>
                      <span className="customer-profile-value">{profile.tenant.owner_name}</span>
                    </div>

                    {profile.seller_profile && (
                      <div className="customer-profile-item full-width" style={{ marginTop: 6, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                        <span className="customer-profile-label">Yuridik ma'lumotlar</span>
                        <div style={{ fontSize: 12.5, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <div><strong>Tashkiliy shakli:</strong> {profile.seller_profile.legal_form}</div>
                          <div><strong>Rasmiy nomi:</strong> {profile.seller_profile.official_name}</div>
                          <div><strong>STIR / INN:</strong> <code style={{ color: 'var(--primary)' }}>{profile.seller_profile.tax_identifier}</code></div>
                          <div><strong>Tekshiruv holati:</strong> {profile.seller_profile.status_display}</div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '6px 0' }}>
                    Ushbu suhbatga hech qanday do‘kon biriktirilmagan.
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Admin Action Controls */}
        {profile && !loading && (
          <div className="customer-profile-footer">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {profile.user && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={openAccounts}
                  disabled={saving}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                >
                  Hisobni xavfsiz boshqarish
                </button>
              )}

              {profile.tenant && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={openStores}
                  disabled={saving}
                  style={{ fontSize: 12 }}
                >
                  Do‘konni boshqarish
                </button>
              )}
            </div>

            <div>
              {editing ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    Bekor qilish
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSave}
                    disabled={saving}
                    style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    <Save size={13} />
                    {saving ? 'Saqlanmoqda...' : 'Saqlash'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onClose}
                >
                  Yopish
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
