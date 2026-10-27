import { RetryButton } from '../components/common/RecoveryNotice';
import { useWorkspace } from '../context/WorkspaceContext';
import IlbiLoader from '../components/common/IlbiLoader';
import { useDebouncedValue, usePaginatedList } from '../hooks/usePaginatedList';
import Pagination from '../components/common/Pagination';
import PlatformDashboard from './PlatformDashboard';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  ShoppingBag,
  CreditCard,
  Award,
  Store,
  Plus,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Lock,
  Search,
  ExternalLink,
  Unlock,
  BookOpen,
  Package,
  Power,
  PowerOff,
} from 'lucide-react';
import { analyticsApi, tenantApi, authApi, auditApi } from '../api/client';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { useTenant } from '../context/TenantContext';
import { useAuth } from '../hooks/useAuth';
import { useTenantCurrency } from '../hooks/useTenantCurrency';
import Modal from '../components/common/Modal';
import RevenueCostAnalyticsChart from '../components/dashboard/RevenueCostAnalyticsChart';
import { InlineCardSparkline } from '../components/dashboard/MiniVisualizers';
import PhoneInput from '../components/common/PhoneInput';
import { showOwnerInvitationResult } from '../utils/ownerInvitation';

const WorkDesktop = React.lazy(() => import('../components/workspace/WorkDesktop'));
const Reminders = React.lazy(() => import('../components/workspace/Reminders'));

function TenantDashboard() {
  const { mode } = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();
  const { activeTenant } = useTenant();
  const userPerms = activeTenant?.permissions || [];
  const canViewDashboard =
    isAdmin ||
    activeTenant?.is_owner ||
    userPerms.includes('*') ||
    userPerms.includes('analytics.view_dashboard');
  const { settings: currencySettings } = useTenantCurrency(canViewDashboard ? activeTenant?.id : null);
  const currencyRate = Number(currencySettings?.usd_rate || 0);

  const [period, setPeriod] = useState('today');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Platform admin tenant management state
  const [tenantSearch, setTenantSearch] = useState('');
  const [toggleLoadingId, setToggleLoadingId] = useState(null);
  const [unbanUserId, setUnbanUserId] = useState('');
  const [unbanning, setUnbanning] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(null);
  const [auditTotal, setAuditTotal] = useState(null);
  const [recentAdminLogs, setRecentAdminLogs] = useState([]);
  const [overviewError, setOverviewError] = useState('');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tenantForm, setTenantForm] = useState({
    name: '',
    owner_phone_number: '',
    owner_email: '',
    description: '',
  });

  const settledTenantSearch = useDebouncedValue(tenantSearch.trim());
  const tenantList = usePaginatedList(tenantApi.getTenants, { search: settledTenantSearch }, { enabled: isAdmin });
  const tenants = tenantList.items;
  const tenantsLoaded = !tenantList.loading;
  const tenantError = tenantList.error?.message || '';
  const loadTenants = tenantList.refresh;

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    Promise.allSettled([
      tenantApi.getSellerProfilesForReview({ status: 'pending', page_size: 1 }),
      auditApi.getLogs({ page: 1 }),
    ]).then(([reviews, audit]) => {
      if (cancelled) return;
      if (reviews.status === 'fulfilled') setPendingReviews(Number(reviews.value.count || 0));
      if (audit.status === 'fulfilled') {
        setAuditTotal(Number(audit.value.count || 0));
        setRecentAdminLogs((audit.value.results || []).slice(0, 5));
      }
      if (reviews.status === 'rejected' || audit.status === 'rejected') {
        setOverviewError('Ayrim boshqaruv ko‘rsatkichlarini yuklab bo‘lmadi. Sahifalarni alohida ochib tekshiring.');
      }
    });
    return () => { cancelled = true; };
  }, [isAdmin]);

  // Fetch financial dashboard for store owners & permitted staff (never called for platform_admin)
  const fetchDashboard = useCallback(
    async (selectedPeriod, signal) => {
      if (isAdmin || !canViewDashboard) return;

      setLoading(true);
      try {
        const res = await analyticsApi.getDashboard(selectedPeriod, null, null, null, { signal });
        if (!signal?.aborted) setData(res);
      } catch (err) {
        if (!signal?.aborted) toast.error(err.message || 'Dashboard ma’lumotlarini yuklashda xatolik');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [isAdmin, canViewDashboard, toast]
  );

  useEffect(() => {
    const controller = new AbortController();
    if (!isAdmin && canViewDashboard) {
      fetchDashboard(period, controller.signal);
    }
    return () => controller.abort();
  }, [period, isAdmin, canViewDashboard, fetchDashboard]);

  const handleCreateTenant = async (e) => {
    e.preventDefault();
    if (!tenantForm.name.trim() || !tenantForm.owner_phone_number.trim() || !tenantForm.owner_email.trim()) {
      toast.warning('Do‘kon nomi, egasining telefon raqami va email manzilini kiriting');
      return;
    }

    setCreating(true);
    try {
      const email = tenantForm.owner_email.trim();
      const newTenant = await tenantApi.createTenant({
        name: tenantForm.name.trim(),
        owner_phone_number: tenantForm.owner_phone_number.trim(),
        owner_email: email,
        description: tenantForm.description.trim() || undefined,
      });

      showOwnerInvitationResult(toast, newTenant.name, email, newTenant.owner_invitation?.status);
      setCreateModalOpen(false);
      setTenantForm({ name: '', owner_phone_number: '', owner_email: '', description: '' });
      loadTenants();
    } catch (err) {
      toast.error(err.message || 'Do‘konni yaratishda xatolik yuz berdi');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleTenantStatus = async (tenant) => {
    const accepted = await confirm({
      title: tenant.is_active ? 'Do‘konni to‘xtatish' : 'Do‘konni faollashtirish',
      message: `“${tenant.name}” do‘konining holatini ${tenant.is_active ? 'to‘xtatish' : 'faollashtirish'}ni tasdiqlaysizmi?`,
      confirmText: tenant.is_active ? 'To‘xtatish' : 'Faollashtirish',
      cancelText: 'Bekor qilish',
      type: tenant.is_active ? 'danger' : 'default',
    });
    if (!accepted) return;
    setToggleLoadingId(tenant.id);
    try {
      if (tenant.is_active) {
        await tenantApi.deactivateTenant(tenant.id);
        toast.info(`"${tenant.name}" do‘koni to‘xtatildi (muzlatildi)`);
      } else {
        await tenantApi.activateTenant(tenant.id);
        toast.success(`"${tenant.name}" do‘koni faollashtirildi`);
      }
      loadTenants();
    } catch (err) {
      toast.error('Do‘kon holatini o‘zgartirishda xatolik: ' + err.message);
    } finally {
      setToggleLoadingId(null);
    }
  };

  const handleUnbanUser = async (e) => {
    e.preventDefault();
    if (!unbanUserId.trim()) {
      toast.warning('Foydalanuvchi ID raqamini kiriting');
      return;
    }
    setUnbanning(true);
    try {
      await authApi.unban(unbanUserId.trim());
      toast.success(`Foydalanuvchi (ID: ${unbanUserId}) muvaffaqiyatli blokdan chiqarildi!`);
      setUnbanUserId('');
    } catch (err) {
      toast.error(err.message || 'Foydalanuvchini blokdan chiqarishda xatolik');
    } finally {
      setUnbanning(false);
    }
  };

  const filteredTenants = tenants;

  const paymentMethodsList = useMemo(() => {
    if (data?.payment_methods_list) return data.payment_methods_list;
    if (!data?.payment_methods) return [];
    if (Array.isArray(data.payment_methods)) return data.payment_methods;
    return Object.entries(data.payment_methods).map(([key, val]) => ({
      method: key.toUpperCase(),
      count: val.count || 0,
      total_uzs: val.amount_uzs || val.total_uzs || 0,
      total_usd: val.amount_usd || val.total_usd || 0,
    }));
  }, [data]);

  const activeCount = tenantList.summary?.active_count || 0;
  const inactiveCount = tenantList.summary?.inactive_count || 0;

  const formatUZS = (val) =>
    Number(val || 0).toLocaleString('uz-UZ') + ' UZS';

  const formatUSD = (val) =>
    '$' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });

  const periods = [
    { key: 'today', label: 'Bugun' },
    { key: 'this_week', label: 'So‘nggi 7 kun' },
    { key: 'this_month', label: 'Shu Oy' },
    { key: 'this_year', label: 'Shu Yil' },
  ];

  // =========================================================================
  // 1. PLATFORM ADMIN VIEW (verified operational data only)
  // Strictly NO tenant financial data (revenue, profit, debts, sales) shown!
  // =========================================================================
  if (isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Top Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              Platforma Administratori Boshqaruv Markazi
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Do‘konlar, xodimlar, sotuvchi profillari va audit amallarini boshqarish
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', fontSize: 13, fontWeight: 700 }}
            >
              <Plus size={16} />
              <span>Yangi Do‘kon</span>
            </button>
            <button
              onClick={() => navigate('/seller-profiles/review')}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', fontSize: 13 }}
            >
              <ShieldCheck size={16} />
              <span>Profil tekshiruvlari{pendingReviews === null ? '' : ` (${pendingReviews})`}</span>
            </button>
            <button
              onClick={() => navigate('/audit')}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', fontSize: 13 }}
            >
              <ShieldCheck size={16} color="var(--accent-cyan)" />
              <span>Audit Jurnali</span>
            </button>
            <button
              onClick={() => navigate('/tenants')}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', fontSize: 13 }}
            >
              <Store size={16} color="var(--primary)" />
              <span>Barcha Do‘konlar</span>
            </button>
          </div>
        </div>

        {/* System Overview Metrics Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {/* Card 1: Jami Do'konlar */}
          <div className="glass-card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Jami Do‘konlar (Tenants)
              </span>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Store size={18} color="var(--primary)" />
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>
              {tenantsLoaded && !tenantError ? `${tenantList.summary?.total_count || 0} ta` : '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {tenantsLoaded && !tenantError ? <><span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>{activeCount} ta faol</span> · {inactiveCount} ta to‘xtatilgan</> : 'Ro‘yxat yuklanmoqda yoki xatolik yuz berdi'}
            </div>
          </div>

          {/* Card 2: Suspended tenants */}
          <div className="glass-card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                To‘xtatilgan do‘konlar
              </span>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'rgba(var(--danger-rgb), 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <PowerOff size={18} color="var(--accent-rose)" />
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent-rose)' }}>
              {tenantsLoaded && !tenantError ? `${inactiveCount} ta` : '—'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Holatini do‘konlar sahifasida boshqaring
            </div>
          </div>

          {/* Card 3: Seller profile reviews */}
          <div className="glass-card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Kutilayotgan sotuvchi profillari
              </span>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'rgba(var(--info-rgb), 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheck size={18} color="var(--accent-cyan)" />
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)' }}>
              {pendingReviews === null ? '—' : `${pendingReviews} ta`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              POS ruxsatini berishdan oldin hujjatlarni tekshiring
            </div>
          </div>

          {/* Card 4: recorded audit events */}
          <div className="glass-card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                Audit yozuvlari
              </span>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'rgba(var(--primary-rgb), 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheck size={18} color="var(--accent-amber)" />
              </div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent-amber)' }}>
              {auditTotal === null ? '—' : `${auditTotal} ta`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              So‘nggi amallar audit jurnalida ko‘rinadi
            </div>
          </div>
        </div>

        {/* Scope and loading state */}
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Lock size={18} color="var(--primary)" />
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>
              Platforma boshqaruvi
            </strong>
            Do‘konlar va ularning xodimlari, sotuvchi profili tasdiqlari hamda audit yozuvlari shu panelda boshqariladi. Tijorat hisobotlari do‘kon egasi vakolatida qoladi.
            {overviewError && <span role="alert" style={{ display: 'block', color: 'var(--accent-rose)', marginTop: 5 }}>{overviewError}</span>}
          </div>
        </div>

        {/* Tenants Table & Quick Status */}
        <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                Do‘konlar (Tenants) Ro‘yxati va Tezkor Holati
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Tizimda ro‘yxatdan o‘tgan barcha savdo nuqtalari
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="Do‘kon yoki egasi qidirish..."
                  value={tenantSearch}
                  onChange={(e) => setTenantSearch(e.target.value)}
                  style={{
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '7px 12px 7px 32px',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    outline: 'none',
                    width: 220,
                  }}
                />
                <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              </div>

              <button
                onClick={() => navigate('/tenants')}
                className="btn btn-secondary"
                style={{ fontSize: 12, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <span>Barcha Do‘konlar</span>
                <ExternalLink size={14} />
              </button>
            </div>
          </div>

          {tenantError && <div role="alert" style={{ padding: 16, color: 'var(--accent-rose)' }}>{tenantError} <RetryButton onClick={loadTenants} loading={tenantList.loading}>Qayta urinish</RetryButton></div>}
          {!tenantsLoaded ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Do‘konlar yuklanmoqda..." /></div>
          ) : filteredTenants.length > 0 ? (
            <div className="table-responsive">
              <table style={{ width: '100%', minWidth: 780, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>Do‘kon Nomi</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>Do‘kon Egasi (Owner)</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>Xodimlar</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>Holati</th>
                    <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>Yaratilgan</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>Amallar</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div>{t.name}</div>
                        {t.description && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>{t.description}</div>}
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                        <div>{[t.owner_details?.first_name, t.owner_details?.last_name].filter(Boolean).join(' ') || t.owner_details?.username || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.owner_details?.phone_number || t.owner_details?.email || ''}</div>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>
                        <button className="btn btn-secondary" style={{ padding: '5px 9px', fontSize: 12 }} onClick={() => navigate(`/employees?tenant_id=${t.id}`)}>Jamoani ko‘rish</button>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '4px 10px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: 11,
                            fontWeight: 700,
                            background: t.is_active ? 'rgba(var(--success-rgb), 0.15)' : 'rgba(var(--danger-rgb), 0.15)',
                            color: t.is_active ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          }}
                        >
                          {t.is_active ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                          <span>{t.is_active ? 'Faol' : 'To‘xtatilgan'}</span>
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {t.created_at ? new Date(t.created_at).toLocaleDateString('uz-UZ', { timeZone: 'Asia/Tashkent' }) : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 8 }}>
                          <button
                            onClick={() => handleToggleTenantStatus(t)}
                            disabled={toggleLoadingId === t.id}
                            title={t.is_active ? 'Do‘konni to‘xtatish (muzlatish)' : 'Do‘konni faollashtirish'}
                            style={{
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-xs)',
                              border: '1px solid var(--border-subtle)',
                              background: 'transparent',
                              color: t.is_active ? 'var(--accent-rose)' : 'var(--accent-emerald)',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {t.is_active ? <PowerOff size={13} /> : <Power size={13} />}
                            <span>{t.is_active ? 'To‘xtatish' : 'Faollashtirish'}</span>
                          </button>
                          <button
                            onClick={() => navigate('/tenants')}
                            style={{
                              padding: '6px 10px',
                              borderRadius: 'var(--radius-xs)',
                              border: '1px solid var(--border-subtle)',
                              background: 'var(--bg-input)',
                              color: 'var(--text-secondary)',
                              fontSize: 12,
                              cursor: 'pointer',
                            }}
                          >
                            Boshqarish
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              {tenantError ? 'Ro‘yxat yuklanmadi' : tenantSearch ? 'Qidiruv bo‘yicha do‘kon topilmadi' : 'Hali do‘konlar yaratilmagan'}
            </div>
          )}
        </div>

        <Pagination currentPage={tenantList.page} totalItems={tenantList.total} onPageChange={tenantList.setPage} />
        {/* Settings & Administrative Controls Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
          {/* Panel A: Security Unban Tool */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'rgba(var(--danger-rgb), 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Unlock size={18} color="var(--accent-rose)" />
              </div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                  Xavfsizlik: Foydalanuvchini Blokdan Chiqarish (Unban)
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                  Parolni ko‘p marta xato kiritib cheklangan hisoblar
                </p>
              </div>
            </div>

            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              Agar tizim xodimi yoki do‘kon egasi kirishda xato qilib bloklangan bo‘lsa (Brute-Force Strike), ushbu vosita orqali blokni yechishingiz va Redis limitlarini tozalashingiz mumkin.
            </p>

            <form onSubmit={handleUnbanUser} style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <input
                type="number"
                placeholder="Foydalanuvchi ID (masalan: 12)"
                value={unbanUserId}
                onChange={(e) => setUnbanUserId(e.target.value)}
                required
                style={{
                  flex: 1,
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 14px',
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={unbanning}
                className="btn btn-primary"
                style={{ padding: '10px 18px', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}
              >
                {unbanning ? 'Ochilmoqda...' : 'Blokdan Chiqarish'}
              </button>
            </form>
          </div>

          {/* Panel B: Recent audited actions */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheck size={18} color="var(--primary)" />
              </div>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
                  So‘nggi audit amallari
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                  Tizimda qayd etilgan haqiqiy hodisalar
                </p>
              </div>
            </div>
            {recentAdminLogs.length ? recentAdminLogs.map((log) => (
              <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
                <span style={{ color: 'var(--text-primary)' }}>{String(log.action || 'amal').replaceAll('_', ' ')} · {log.tenant ? `Do‘kon #${log.tenant}` : 'Platforma'}</span>
                <time style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(log.created_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}</time>
              </div>
            )) : <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Hozircha yozuv yo‘q yoki yuklanmadi.</p>}
            <button className="btn btn-secondary" onClick={() => navigate('/audit')}>Audit jurnalini ochish</button>
          </div>
        </div>

        {/* Modal for creating a tenant */}
        <Modal
          isOpen={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          title="Yangi Do‘kon (Tenant) Yaratish"
        >
          <form onSubmit={handleCreateTenant} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Do‘kon Nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <input data-api-field="name"
                type="text"
                className="input-field"
                placeholder="Masalan: ILBI Flagship Store"
                value={tenantForm.name}
                onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })}
                required
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Egasi (Owner) Telefon Raqami <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <PhoneInput data-api-field="owner_phone_number"
                className="input-field"
                value={tenantForm.owner_phone_number}
                onChange={(e) => setTenantForm({ ...tenantForm, owner_phone_number: e.target.value })}
                required
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                Ushbu raqam orqali do‘kon egasi (Owner) hisobi ochiladi.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Egasi Email Manzili <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <input data-api-field="owner_email"
                type="email"
                className="input-field"
                placeholder="owner@example.com"
                value={tenantForm.owner_email}
                onChange={(e) => setTenantForm({ ...tenantForm, owner_email: e.target.value })}
                required
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                Parol o‘rnatish havolasi ushbu emailga avtomatik yuboriladi.
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Izoh / Manzil (Ixtiyoriy)
              </label>
              <textarea data-api-field="description"
                className="input-field"
                rows={2}
                placeholder="Filial yoki faoliyat turi haqida qisqacha ma’lumot..."
                value={tenantForm.description}
                onChange={(e) => setTenantForm({ ...tenantForm, description: e.target.value })}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="btn btn-secondary"
              >
                Bekor Qilish
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creating}
              >
                {creating ? 'Yaratilmoqda...' : 'Do‘konni Yaratish'}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    );
  }

  // =========================================================================
  // 2. PERMISSION CHECK FOR NON-ADMIN USERS
  // =========================================================================
  if (!canViewDashboard) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center', padding: '40px 24px' }} className="glass-card">
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'rgba(99, 102, 241, 0.1)',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          <TrendingUp size={28} />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px', color: 'var(--text-primary)' }}>
          Dashboard va Analitika
        </h2>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 24px' }}>
          Sizning hisobingizda do‘konning savdo analitikasi va moliyaviy ko‘rsatkichlarini ko‘rish ruxsati mavjud emas. Ushbu bo‘limdan foydalanish uchun do‘kon rahbariga murojaat qiling.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/pos')}>
            Kassaga o‘tish (POS)
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/sales')}>
            Savdolar tarixi
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // 3. STORE DASHBOARD VIEW (Real-time Financial Dashboard & Analytics)
  // Visible to authenticated store owner & staff with analytics.view_dashboard
  // =========================================================================
  const kpi = data?.kpi || data || {};
  const overview = data?.store_overview || data?.kpi || {};
  const costUZS = kpi.total_cost_uzs !== undefined
    ? Number(kpi.total_cost_uzs)
    : Math.max(0, Number(kpi.total_sales_uzs || kpi.total_revenue_uzs || 0) - Number(kpi.net_profit_uzs || 0));
  const costUSD = kpi.total_cost_usd !== undefined
    ? Number(kpi.total_cost_usd)
    : Math.max(0, Number(kpi.total_sales_usd || kpi.total_revenue_usd || 0) - Number(kpi.net_profit_usd || 0));

  if (mode === 'fast') return <React.Suspense fallback={<IlbiLoader />}><WorkDesktop data={data} loading={loading}
    period={period} setPeriod={setPeriod} currencyRate={currencyRate} /></React.Suspense>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* ========================================================================= */}
      {/* 1. DO'KONNING UMUMIY HOLATI & BALANSI (TOP SECTION: STORE OVERVIEW)       */}
      {/* Barcha davrlar bo'yicha doimiy moliyaviy aktivlar va balans ko'rsatkichlari */}
      {/* ========================================================================= */}
      <div>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Do‘konning Umumiy Holati & Balansi
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Do‘koningizning jami kapitali, mijozlar qarzi, ombor qiymati va barcha davrlardagi umumiy natijalari
          </p>
        </div>

        {/* 5 ta Umumiy Holat Kartochkasi */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {/* Top Card 1: Jami Nasiyalar Qarzi (Do'konga qaytishi kerak bo'lgan pul) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderLeft: '3px solid var(--primary)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Jami Nasiyalar Qarzi
                  </span>
                  <div style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>
                    {overview.debtors_count ? `${overview.debtors_count} ta qarzdor mijoz` : 'Undirilmagan nasiyalar'}
                  </div>
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(var(--primary-rgb), 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <BookOpen size={18} color="var(--primary)" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--primary)' }}>
                {loading && !data ? (
                  <IlbiLoader size={32} label="Statistika yuklanmoqda..." />
                ) : (
                  formatUZS(overview.total_debt_uzs)
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>
                + {formatUSD(overview.total_debt_usd)}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Do‘kon haqi
              </span>
            </div>
          </div>

          {/* Top Card 2: Ombor Qoldig'i (Tannarx bo'yicha jami tovar kapitali) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderLeft: '3px solid var(--accent-emerald)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Ombor Qoldig‘i (Tannarx)
                  </span>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {overview.inventory_total_qty ? `${overview.inventory_total_qty} dona tovar` : 'Mavjud tovarlar'}
                    {overview.inventory_variants_count ? ` (${overview.inventory_variants_count} tur)` : ''}
                  </div>
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(var(--success-rgb), 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Package size={18} color="var(--accent-emerald)" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {loading && !data ? (
                  <IlbiLoader size={32} label="Statistika yuklanmoqda..." />
                ) : (
                  formatUZS(overview.inventory_cost_value_uzs)
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Tovarlar tannarx qiymati
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-emerald)', background: 'rgba(var(--success-rgb), 0.12)', padding: '2px 8px', borderRadius: 6 }}>
                Aktiv
              </span>
            </div>
          </div>

          {/* Top Card 3: Kutilayotgan Savdo Tushumi (Sotuv bahosida) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderLeft: '3px solid var(--accent-purple)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Kutilayotgan Tushum
                  </span>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Ombordagi tovarlar sotuv bahosi
                  </div>
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(99, 102, 241, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Store size={18} color="var(--accent-purple)" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {loading && !data ? (
                  <IlbiLoader size={32} label="Statistika yuklanmoqda..." />
                ) : (
                  formatUZS(overview.inventory_retail_value_uzs)
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Yalpi savdo potensiali
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-purple)', background: 'rgba(99, 102, 241, 0.12)', padding: '2px 8px', borderRadius: 6 }}>
                Potensial
              </span>
            </div>
          </div>

          {/* Top Card 4: Jami Jamg'arilgan Sof Foyda (All-Time) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderLeft: '3px solid #1d4ed8' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Jami Sof Foyda (All-Time)
                  </span>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    Barcha davrlardagi sof daromad
                  </div>
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(29, 78, 216, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Award size={18} color="#1d4ed8" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {loading && !data ? (
                  <IlbiLoader size={32} label="Statistika yuklanmoqda..." />
                ) : (
                  formatUZS(overview.all_time_profit_uzs)
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--chart-profit)', fontWeight: 600 }}>
                + {formatUSD(overview.all_time_profit_usd)}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Jamg‘arilgan
              </span>
            </div>
          </div>

          {/* Top Card 5: Umumiy Savdo Aylanmasi (All-Time) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderLeft: '3px solid #15803d' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Umumiy Savdo Aylanmasi
                  </span>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {overview.all_time_sales_count ? `${overview.all_time_sales_count} ta savdo cheki` : 'Barcha davrlar'}
                  </div>
                </div>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(21, 128, 61, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TrendingUp size={18} color="var(--chart-revenue)" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {loading && !data ? (
                  <IlbiLoader size={32} label="Statistika yuklanmoqda..." />
                ) : (
                  formatUZS(overview.all_time_sales_uzs)
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
                + {formatUSD(overview.all_time_sales_usd)}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Jami savdo
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. DAVRIY MOLIYAVIY TAHLIL & FILTER (PERIOD-BASED SECTION)                 */}
      {/* Tanlangan davr (Bugun, Kecha, 7 kun, Oy, Yil) bo'yicha dinamik hisobotlar */}
      {/* ========================================================================= */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Davriy Moliyaviy Tahlil
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Tanlangan davr bo‘yicha tushum, xarajat, yangi berilgan nasiya va sof foyda
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {/* Period Selector Pills */}
            <div
              style={{
                display: 'flex',
                background: 'var(--bg-chip)',
                padding: 4,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                gap: 4,
              }}
            >
              {periods.map((p) => {
                const active = period === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    style={{
                      padding: '7px 16px',
                      borderRadius: 'var(--radius-xs)',
                      border: 'none',
                      background: active
                        ? 'var(--primary)'
                        : 'transparent',
                      color: active ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                      fontSize: 13,
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                      boxShadow: active ? 'var(--shadow-sm)' : 'none',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 5 ta Davriy KPI Kartochkasi */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {/* Card 1: Haqiqiy Tushum (Real receipts - Cash & Card) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Haqiqiy Tushum
                  </span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Naqd & Karta (nasiyasiz)
                  </div>
                </div>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(21, 128, 61, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TrendingUp size={16} color="var(--chart-revenue)" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {loading && !data ? (
                  <IlbiLoader size={32} label="Statistika yuklanmoqda..." />
                ) : (
                  formatUZS(kpi.total_revenue_uzs)
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--chart-revenue)', fontWeight: 600 }}>
                + {formatUSD(kpi.total_revenue_usd)}
              </div>
              <InlineCardSparkline
                data={
                  data?.sales_chart && data.sales_chart.length > 0
                    ? data.sales_chart.map((c) => Number(c.revenue_uzs || 1) / 1000 + 10)
                    : [12, 18, 15, 24, 21, 29, 35]
                }
                color="var(--chart-revenue)"
              />
            </div>
          </div>

          {/* Card 2: Nasiyaga Sotuv (Credit sales in selected period) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Berilgan Nasiya
                  </span>
                  <div style={{ fontSize: 10, color: 'var(--chart-debt)', fontWeight: 600 }}>
                    {kpi.debt_sales_count ? `${kpi.debt_sales_count} ta nasiya cheki` : 'Ushbu davrda'}
                  </div>
                </div>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(180, 83, 9, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Wallet size={16} color="var(--chart-debt)" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {loading && !data ? (
                  <IlbiLoader size={32} label="Statistika yuklanmoqda..." />
                ) : (
                  formatUZS(kpi.debt_sales_uzs)
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--chart-debt)', fontWeight: 600 }}>
                + {formatUSD(kpi.debt_sales_usd)}
              </div>
              <InlineCardSparkline
                data={
                  data?.sales_chart && data.sales_chart.length > 0
                    ? data.sales_chart.map((c) => Number(c.debt_sales_uzs || 1) / 1000 + 8)
                    : [5, 10, 8, 14, 12, 19, 22]
                }
                color="var(--chart-debt)"
              />
            </div>
          </div>

          {/* Card 3: Sof Foyda (Ushbu davrda) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Sof Foyda
                  </span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Daromad marjasi
                  </div>
                </div>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(29, 78, 216, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <DollarSign size={16} color="#1d4ed8" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {formatUZS(kpi.net_profit_uzs)}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--chart-profit)', fontWeight: 600 }}>
                + {formatUSD(kpi.net_profit_usd)}
              </div>
              <InlineCardSparkline
                data={
                  data?.sales_chart && data.sales_chart.length > 0
                    ? data.sales_chart.map((c) => Number(c.profit_uzs || 1) / 1000 + 8)
                    : [10, 14, 12, 19, 17, 25, 30]
                }
                color="#1d4ed8"
              />
            </div>
          </div>

          {/* Card 4: Jami Chiqim (Total Costs / Expenses in period) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Jami Chiqim
                  </span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Tannarx & xarajatlar
                  </div>
                </div>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(185, 28, 28, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TrendingDown size={16} color="#b91c1c" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {loading && !data ? (
                  <IlbiLoader size={32} label="Statistika yuklanmoqda..." />
                ) : (
                  formatUZS(costUZS)
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--chart-cost)', fontWeight: 600 }}>
                + {formatUSD(costUSD)}
              </div>
              <InlineCardSparkline
                data={
                  data?.sales_chart && data.sales_chart.length > 0
                    ? data.sales_chart.map((c) => {
                        const cSales = Number(c.total_sales_uzs || c.revenue_uzs || 0);
                        const cProf = Number(c.profit_uzs || 0);
                        return Math.max(1, (cSales - cProf) / 1000 + 5);
                      })
                    : [14, 18, 12, 16, 20, 15, 17]
                }
                color="#b91c1c"
              />
            </div>
          </div>

          {/* Card 5: Jami Savdo & Cheklar (Total Sales Turnover in period) */}
          <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Jami Savdo / Cheklar
                  </span>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    Aylanma (Tushum + Nasiya)
                  </div>
                </div>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(15, 118, 110, 0.14)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ShoppingBag size={16} color="#0f766e" />
                </div>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {formatUZS(kpi.total_sales_uzs || kpi.total_revenue_uzs)}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {kpi.sales_count || 0} ta chek {Number(kpi.total_sales_usd || 0) > 0 && `(+ ${formatUSD(kpi.total_sales_usd)})`}
              </div>
              <InlineCardSparkline
                data={
                  data?.sales_chart && data.sales_chart.length > 0
                    ? data.sales_chart.map((c) => Number(c.sales_count || 1) * 3 + 6)
                    : [8, 12, 11, 16, 15, 20, 24]
                }
                color="#0f766e"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Revenue and Costs Spline Analytics Chart */}
      {currencyRate > 0 ? <RevenueCostAnalyticsChart
        chartData={data?.sales_chart}
        period={period}
        formatUZS={formatUZS}
        formatUSD={formatUSD}
        currencyRate={currencyRate}
      /> : <div className="glass-card" role="status" style={{ padding: 24 }}>
        Grafik uchun do‘kon kursi mavjud emas. Qayta urinib ko‘ring.
      </div>}

      {/* Middle Section: Payment Methods Breakdown & Cashier Leaderboard */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 20,
        }}
      >
        {/* Payment Methods Breakdown */}
        <div className="glass-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>
            To‘lov Turlari Taqsimoti
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 20px' }}>
            Naqd pul, bank kartasi va nasiya xaridlari
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {paymentMethodsList && paymentMethodsList.length > 0 ? (
              paymentMethodsList.map((pm, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <CreditCard
                      size={18}
                      color={
                        pm.method === 'CASH'
                          ? 'var(--accent-emerald)'
                          : pm.method === 'CARD'
                          ? 'var(--primary)'
                          : pm.method === 'DEBT'
                          ? 'var(--accent-amber)'
                          : 'var(--accent-cyan)'
                      }
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                        {pm.method === 'CASH'
                          ? 'Naqd Pul'
                          : pm.method === 'CARD'
                          ? 'Bank Kartasi'
                          : pm.method === 'DEBT'
                          ? 'Nasiya (Berilgan Qarz)'
                          : pm.method === 'DEBT_COLLECTION'
                          ? 'Undirilgan Nasiya (Qarz to‘lovi)'
                          : pm.method}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {pm.count} ta {pm.method === 'DEBT' ? 'nasiya xaridi' : 'to‘lov'}
                        {pm.method === 'DEBT' && (
                          <span style={{ color: 'var(--accent-amber)', marginLeft: 4, fontWeight: 600 }}>
                            (tushum emas)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: pm.method === 'DEBT' ? 'var(--accent-amber)' : 'var(--text-primary)',
                      }}
                    >
                      {formatUZS(pm.total_uzs)}
                    </div>
                    {Number(pm.total_usd) > 0 && (
                      <div
                        style={{
                          fontSize: 11,
                          color: pm.method === 'DEBT' ? 'var(--accent-amber)' : 'var(--accent-emerald)',
                          fontWeight: 600,
                        }}
                      >
                        + {formatUSD(pm.total_usd)}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
                To‘lovlar tarixi mavjud emas
              </div>
            )}
          </div>
        </div>

        {/* Cashier Leaderboard */}
        <div className="glass-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>
            Kassirlar Peshqadamligi
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data?.cashiers_leaderboard && data.cashiers_leaderboard.length > 0 ? (
              data.cashiers_leaderboard.map((c, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Award
                      size={20}
                      color={
                        idx === 0
                          ? 'var(--accent-amber)'
                          : idx === 1
                          ? '#94a3b8'
                          : 'var(--chart-debt)'
                      }
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {c.name || c.cashier_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {c.sales_count || c.total_sales_count || 0} ta chek yopilgan
                        {Number(c.debt_count || 0) > 0 && (
                          <span style={{ color: 'var(--accent-amber)', marginLeft: 6, fontWeight: 600 }}>
                            ({c.debt_count} ta nasiya)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {formatUZS(c.total_amount_uzs || c.total_revenue_uzs)}
                    </div>
                    {Number(c.total_amount_usd || 0) > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--accent-emerald)', fontWeight: 600 }}>
                        + {formatUSD(c.total_amount_usd)}
                      </div>
                    )}
                    {(Number(c.debt_amount_uzs || 0) > 0 || Number(c.debt_amount_usd || 0) > 0) && (
                      <div style={{ fontSize: 10, color: 'var(--accent-amber)', fontWeight: 600, marginTop: 2 }}>
                        Nasiya: {Number(c.debt_amount_uzs || 0) > 0 ? formatUZS(c.debt_amount_uzs) : ''}
                        {Number(c.debt_amount_usd || 0) > 0 ? ` + ${formatUSD(c.debt_amount_usd)}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                Xodimlar savdo ma’lumotlari mavjud emas
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Section: Reminders & Employee Tasks + Top 10 Products */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <React.Suspense fallback={<div className="glass-card" style={{ padding: 24 }}><IlbiLoader label="Eslatmalar yuklanmoqda..." /></div>}>
          <Reminders />
        </React.Suspense>

        <div className="glass-card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px' }}>
            Eng Ko‘p Sotilgan Tovar (Top-10)
          </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data?.top_products && data.top_products.length > 0 ? (
            data.top_products.slice(0, 8).map((p, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: 'var(--primary)',
                      fontSize: 12,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {idx + 1}
                  </span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {p.name || p.product_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {Number(p.quantity_sold || p.total_quantity || 0).toLocaleString()} dona sotildi
                      {Number(p.debt_quantity || 0) > 0 && (
                        <span style={{ color: 'var(--accent-amber)', marginLeft: 6, fontWeight: 600 }}>
                          ({Number(p.debt_quantity).toLocaleString()} dona nasiyaga)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                    {p.currency === 'USD'
                      ? formatUSD(p.revenue || p.total_revenue_usd)
                      : formatUZS(p.revenue || p.total_revenue_uzs)}
                  </div>
                  {Number(p.debt_revenue || 0) > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--accent-amber)', fontWeight: 600, marginTop: 2 }}>
                      Nasiya: {p.currency === 'USD' ? formatUSD(p.debt_revenue) : formatUZS(p.debt_revenue)}
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              Hali tovarlar sotilmagan
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
  );
}

export default function Dashboard() {
  const { isAdmin } = useAuth();
  return isAdmin ? <PlatformDashboard /> : <TenantDashboard />;
}
