import { RetryButton } from '../components/common/RecoveryNotice';
import IlbiLoader from '../components/common/IlbiLoader';
import RemoteTenantSelect from '../components/common/RemoteTenantSelect';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sliders,
  Coins,
  Send,
  Receipt,
  Cpu,
  Save,
  HelpCircle,
  Clock,
  Sparkles,
  Store,
  RefreshCw,
  Info,
  ArrowRight,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { tenantApi } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../context/ToastContext';
import CustomSelect from '../components/common/CustomSelect';
import PriceInput from '../components/common/PriceInput';
import ReceiptSettingsPanel from '../components/common/ReceiptSettingsPanel';
import { receiptDefaults } from '../utils/receiptTax';
import { useTenant } from '../context/TenantContext';
import PlatformSettings from '../components/platform/PlatformSettings';
import { useTenantCurrency } from '../hooks/useTenantCurrency';

function TenantServices() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const { activeTenant } = useTenant();
  const activeTenantId = activeTenant?.id;
  const loadGeneration = useRef(0);

  const [activeTab, setActiveTab] = useState('currency'); // 'currency' | 'telegram' | 'receipt' | 'automation'
  const [selectedTenantId, setSelectedTenantId] = useState(user?.tenant_id || null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [sendingReportNow, setSendingReportNow] = useState(false);
  const [sendingLowStockReportNow, setSendingLowStockReportNow] = useState(false);
  const [previewDate] = useState(() => new Date());

  // Quick Calculator State (USD <-> UZS)
  const [calculatorInput, setCalculatorInput] = useState({ currency: 'USD', value: '100' });

  // Main Form Data
  const [formData, setFormData] = useState({
    ...receiptDefaults,
    address: '',
    name: '',
    description: '',
    usd_rate: '12800.00',
    auto_usd_rate: false,
    daily_report_time: '22:00:00',
    daily_report_target: 'both',
    shift_report_target: 'both',
    low_stock_report_target: 'both',
    low_stock_report_time: '09:00:00',
    low_stock_frequency: 'daily',
    low_stock_weekday: 1,
    low_stock_day_of_month: 1,
    telegram_group_id: '',
    notify_web_reports: true,
    notify_web_low_stock: true,
    notify_on_sale: false,
    notify_on_debt: false,
    receipt_header: 'Xaridingiz uchun rahmat!',
    receipt_footer: '',
    receipt_phone: '',
  });

  const { settings: currencySettings } = useTenantCurrency(isAdmin ? selectedTenantId : activeTenantId);
  const cbuRates = currencySettings?.cbu_rates || tenant?.cbu_rates || {};
  const effectiveUsdRate = formData.auto_usd_rate ? Number(cbuRates.USD?.rate || 0) : Number(formData.usd_rate || 0);

  const calculatorAmount = Number(calculatorInput.value);
  const canCalculate = calculatorInput.value !== '' && Number.isFinite(calculatorAmount) && effectiveUsdRate > 0;
  const calcUsd = calculatorInput.currency === 'USD' ? calculatorInput.value
    : canCalculate ? (calculatorAmount / effectiveUsdRate).toFixed(2) : '';
  const calcUzs = calculatorInput.currency === 'UZS' ? calculatorInput.value
    : canCalculate ? (calculatorAmount * effectiveUsdRate).toLocaleString('uz-UZ') : '';

  // Load current tenant settings
  const loadTenantData = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (isAdmin && !selectedTenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    setTenant(null);
    try {
      const params = isAdmin && selectedTenantId ? { tenant_id: selectedTenantId } : {};
      if (!isAdmin && !activeTenantId) { setLoading(false); return; }
      const data = await tenantApi.getCurrentTenant(params);
      if (generation !== loadGeneration.current) return;
      setTenant(data);
      setFormData({
        ...Object.fromEntries(Object.entries(receiptDefaults).map(([key, fallback]) => [key, data[key] ?? fallback])),
        address: data.address || '',
        name: data.name || '',
        description: data.description || '',
        usd_rate: String(data.manual_usd_rate ?? data.usd_rate ?? ''),
        auto_usd_rate: Boolean(data.auto_usd_rate),
        daily_report_time: data.daily_report_time || '22:00:00',
        daily_report_target: data.daily_report_target || 'both',
        shift_report_target: data.shift_report_target || 'both',
        low_stock_report_target: data.low_stock_report_target || 'both',
        low_stock_report_time: data.low_stock_report_time || '09:00:00',
        low_stock_frequency: data.low_stock_frequency || 'daily',
        low_stock_weekday: data.low_stock_weekday !== undefined && data.low_stock_weekday !== null ? Number(data.low_stock_weekday) : 1,
        low_stock_day_of_month: data.low_stock_day_of_month !== undefined && data.low_stock_day_of_month !== null ? Number(data.low_stock_day_of_month) : 1,
        telegram_group_id: data.telegram_group_id || '',
        notify_web_reports: data.notify_web_reports !== undefined ? data.notify_web_reports : true,
        notify_web_low_stock: data.notify_web_low_stock !== undefined ? Boolean(data.notify_web_low_stock) : true,
        notify_on_sale: Boolean(data.notify_on_sale),
        notify_on_debt: Boolean(data.notify_on_debt),
        receipt_header: '',
        receipt_footer: (data.receipt_footer !== undefined && data.receipt_footer !== null && data.receipt_footer !== '')
          ? data.receipt_footer
          : "Iltimos, chekni saqlab qo‘ying.\nSavdo nusxasi — fiskal chek emas",
        receipt_phone: data.receipt_phone || '',
      });

    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setLoadError('Do‘kon sozlamalarini yuklab bo‘lmadi: ' + err.message);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [isAdmin, selectedTenantId, activeTenantId]);

  useEffect(() => {
    loadTenantData();
    return () => { loadGeneration.current++; };
  }, [loadTenantData]);

  // Handle Calculator Changes
  const handleUsdChange = (val) => {
    setCalculatorInput({ currency: 'USD', value: val });
  };

  const handleUzsChange = (val) => {
    setCalculatorInput({ currency: 'UZS', value: val.replace(/\s+/g, '') });
  };

  // Save Tenant Settings
  const handleSave = async (e) => {
    if (e) e.preventDefault();
    const generation = loadGeneration.current;
    setSaving(true);
    try {
      if (!formData.auto_usd_rate && !(Number(formData.usd_rate) > 0)) {
        toast.warning('Ichki dollar kursi 0 dan katta bo‘lishi kerak.');
        return;
      }
      const { usd_rate, ...settings } = formData;
      const payload = {
        ...settings,
        ...(!formData.auto_usd_rate ? { usd_rate } : {}),
        low_stock_weekday: parseInt(formData.low_stock_weekday, 10) || 1,
        low_stock_day_of_month: parseInt(formData.low_stock_day_of_month, 10) || 1,
      };
      const params = isAdmin && selectedTenantId ? { tenant_id: selectedTenantId } : {};
      const updated = await tenantApi.updateCurrentTenant(payload, params);
      if (generation !== loadGeneration.current) return;
      setTenant(updated);
      setFormData(previous => ({ ...previous, usd_rate: String(updated.manual_usd_rate), auto_usd_rate: Boolean(updated.auto_usd_rate) }));
      window.dispatchEvent(new Event('tenant:currency-updated'));
      toast.success('Sozlamalar muvaffaqiyatli saqlandi');
    } catch (err) {
      toast.error('Saqlashda xatolik yuz berdi: ' + (err.detail || err.message));
    } finally {
      setSaving(false);
    }
  };

  // Test Telegram Message
  const handleTestTelegram = async () => {
    setTestingTelegram(true);
    try {
      const params = isAdmin && selectedTenantId ? { tenant_id: selectedTenantId } : {};
      const res = await tenantApi.testTelegram(params);
      toast.success(res.detail || 'Test xabari muvaffaqiyatli yuborildi!');
    } catch (err) {
      toast.error('Telegram test xatosi: ' + (err.detail || err.message));
    } finally {
      setTestingTelegram(false);
    }
  };

  // Send Daily Report Now
  const handleSendReportNow = async () => {
    setSendingReportNow(true);
    try {
      const params = isAdmin && selectedTenantId ? { tenant_id: selectedTenantId } : {};
      const res = await tenantApi.sendDailyReportNow(params);
      toast.success(res.detail || 'Bugungi kunlik hisobot jo‘natildi!');
    } catch (err) {
      toast.error('Hisobotni yuborishda xatolik: ' + (err.detail || err.message));
    } finally {
      setSendingReportNow(false);
    }
  };

  // Send Low Stock Report Now
  const handleSendLowStockReportNow = async () => {
    setSendingLowStockReportNow(true);
    try {
      const params = isAdmin && selectedTenantId ? { tenant_id: selectedTenantId } : {};
      const res = await tenantApi.sendLowStockReportNow(params);
      toast.success(res.detail || 'Kamchiliklar hisoboti jo‘natildi!');
    } catch (err) {
      toast.error('Kamchiliklar hisobotini yuborishda xatolik: ' + (err.detail || err.message));
    } finally {
      setSendingLowStockReportNow(false);
    }
  };

  const tabs = [
    { key: 'currency', label: 'Valyuta & Kurs', icon: Coins },
    { key: 'telegram', label: 'Telegram & Bildirishnomalar', icon: Send },
    { key: 'receipt', label: 'Chek va soliqlar', icon: Receipt },
    { key: 'automation', label: 'Avtomatlashtirish & Xizmatlar', icon: Cpu },
  ];

  if (loading && !tenant) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
        <IlbiLoader label="Xizmatlar va sozlamalar yuklanmoqda..." />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="glass-card" role={loadError ? 'alert' : undefined} style={{ padding: 28, color: loadError ? 'var(--accent-rose)' : 'var(--text-muted)' }}>
        {loadError || (isAdmin ? 'Sozlamalarni ko‘rish uchun do‘kon tanlang.' : 'Do‘kon sozlamalari topilmadi.')}
        {isAdmin && (
          <RemoteTenantSelect autoSelect value={selectedTenantId || ''} onChange={value => setSelectedTenantId(Number(value))} />
        )}
        {selectedTenantId && <RetryButton onClick={loadTenantData} loading={loading} style={{ marginTop: 12 }}>Qayta urinish</RetryButton>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
      {/* Top Header Card */}
      <div
        className="glass-card"
        style={{
          padding: '24px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Sliders size={26} />
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Xizmatlar & Do‘kon Sozlamalari
            </h2>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
              {isAdmin ? 'Tanlangan do‘konning' : 'Do‘koningizning'} kurs kalkulyatori, Telegram va chek sozlamalari
            </div>
          </div>
        </div>

        {/* Platform Admin Tenant Selector or Store Badge */}
        {isAdmin ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Do‘kon:
            </span>
            <RemoteTenantSelect value={selectedTenantId || ''} onChange={value => setSelectedTenantId(Number(value))} />
          </div>
        ) : (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 999,
              background: 'var(--bg-chip)',
              border: '1px solid var(--border-subtle)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-secondary)',
            }}
          >
            <Store size={15} color="var(--primary)" />
            <span>{tenant?.name || 'Mening Do‘konim'}</span>
          </div>
        )}
      </div>

      {/* Tabs Navigation Bar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 4,
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                borderRadius: 12,
                fontSize: 13.5,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                border: isActive ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                background: isActive ? 'var(--primary)' : 'var(--bg-card)',
                color: isActive ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                boxShadow: isActive ? '0 4px 14px rgba(var(--primary-rgb), 0.25)' : 'none',
                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: VALYUTA & KURS */}
      {/* ========================================================================= */}
      {activeTab === 'currency' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Ichki Valyuta Kursi (1 USD / UZS)
                </h3>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Faqat ichki ma’lumot va alohida kalkulyator uchun. POS narxi va to‘lovi UZS’da yuritiladi.
                </div>
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 800,
                  color: 'var(--primary)',
                  padding: '6px 14px',
                  borderRadius: 10,
                  background: 'var(--primary-light)',
                }}
              >
                1 $ = {effectiveUsdRate > 0 ? effectiveUsdRate.toLocaleString('uz-UZ') : '—'} UZS
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                aria-label="CBU kursidan avtomatik foydalanish"
                checked={formData.auto_usd_rate}
                disabled={saving || (!formData.auto_usd_rate && !cbuRates.USD)}
                onChange={event => setFormData(previous => ({ ...previous, auto_usd_rate: event.target.checked }))}
              />
              <span>CBU kursidan avtomatik foydalanish</span>
            </label>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {formData.auto_usd_rate
                ? 'Hisoblash CBU kursi bo‘yicha. Avtomatik rejimni o‘chirsangiz, avvalgi qo‘lda kiritilgan kurs qaytadi.'
                : 'Hisoblash owner saqlagan ichki kurs bo‘yicha. CBU rejimini yoqsangiz, kurs avtomatik yangilanadi.'}
              {!cbuRates.USD && <div role="status">CBU kurslari hali mavjud emas. Avtomatik rejim kurs olingach yoqiladi.</div>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
              {['USD', 'EUR', 'RUB'].map(code => (
                <div key={code} style={{ padding: 12, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                  <strong>1 {code} = {cbuRates[code] ? Number(cbuRates[code].rate).toLocaleString('uz-UZ', { maximumFractionDigits: 6 }) : '—'} UZS</strong>
                  <div style={{ marginTop: 4, fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {cbuRates[code] ? `Amal qilish sanasi: ${cbuRates[code].date}` : 'CBU kursi kutilmoqda'}
                  </div>
                  {cbuRates[code] && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    Tekshirilgan: {new Date(cbuRates[code].checked_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}
                  </div>}
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 16 }}>
              {!formData.auto_usd_rate && <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Qo‘lda kiritilgan dollar kursi (so‘mda)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <PriceInput data-api-field="usd_rate"
                    aria-label="Qo‘lda kiritilgan dollar kursi"
                    value={formData.usd_rate}
                    disabled={formData.auto_usd_rate || saving}
                    min={0.01}
                    onChange={(e) => {
                      setFormData({ ...formData, usd_rate: e.target.value });
                    }}
                    placeholder="12 800"
                    style={{
                      flex: 1,
                      padding: '11px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-card)',
                      background: 'var(--bg-input)',
                      color: 'var(--text-primary)',
                      fontSize: 16,
                      fontWeight: 700,
                      outline: 'none',
                    }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)' }}>UZS</span>
                </div>

                {/* Quick rate adjustment chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {[12750, 12800, 12850, 12900, 12950].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={formData.auto_usd_rate || saving}
                      onClick={() => {
                        setFormData({ ...formData, usd_rate: String(preset) });
                      }}
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: 12, borderRadius: 8 }}
                    >
                      {preset.toLocaleString('uz-UZ')}
                    </button>
                  ))}
                </div>
              </div>}

              {/* Live Calculator Card */}
              <div
                style={{
                  padding: 16,
                  borderRadius: 14,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  <Sparkles size={15} color="var(--primary)" />
                  <span>Tezkor Kurs Kalkulyatori</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>USD ($)</div>
                    <PriceInput
                      aria-label="Kalkulyator USD"
                      value={calcUsd}
                      onChange={(e) => handleUsdChange(e.target.value)}
                      placeholder="USD"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border-card)',
                        background: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    />
                  </div>
                  <ArrowRight size={16} style={{ color: 'var(--text-muted)', marginTop: 18 }} />
                  <div style={{ flex: 1.4 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>UZS (so‘m)</div>
                    <input
                      aria-label="Kalkulyator UZS"
                      type="text"
                      value={calcUzs}
                      onChange={(e) => handleUzsChange(e.target.value)}
                      placeholder="UZS"
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--border-card)',
                        background: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Information Notice */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 16px',
                borderRadius: 12,
                background: 'var(--bg-chip)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <Info size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                CBU kurslari har kuni avtomatik tekshiriladi. Oxirgi muvaffaqiyatli olingan, amal qilayotgan kurs ishlatiladi. Kurs o‘zgarishi oldingi operatsiyalarni qayta hisoblamaydi. POS narxi va to‘lovi UZS’da yuritiladi.
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary"
                style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700 }}
              >
                <Save size={16} />
                <span>{saving ? 'Saqlanmoqda...' : 'Kurs sozlamalarini saqlash'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: TELEGRAM & BILDIRISHNOMALAR */}
      {/* ========================================================================= */}
      {activeTab === 'telegram' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Card: Telegram Guruh / Kanal ID */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Telegram Guruh yoki Kanal Integratsiyasi
                </h3>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Kunlik savdo va smena Z-hisobotlarini avtomatik qabul qiluvchi guruh yoki kanal ID si
                </div>
              </div>
              <button
                type="button"
                onClick={handleTestTelegram}
                disabled={testingTelegram || !formData.telegram_group_id}
                className="btn btn-secondary"
                style={{ padding: '8px 16px', fontSize: 12.5 }}
                title="Guruhga va shaxsiy chatga test xabari yuborib ko‘rish"
              >
                <Send size={14} color="var(--primary)" />
                <span>{testingTelegram ? 'Yuborilmoqda...' : 'Test xabar yuborish'}</span>
              </button>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Telegram Guruh / Kanal ID (yoki @kanal_nomi)
              </label>
              <input data-api-field="telegram_group_id"
                type="text"
                placeholder="Masalan: -1001928374650 yoki @mening_dokonim"
                value={formData.telegram_group_id}
                onChange={(e) => setFormData({ ...formData, telegram_group_id: e.target.value })}
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

            {/* Step-by-Step Telegram ID Instruction Guide */}
            <div
              style={{
                borderRadius: 14,
                padding: '16px 20px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                <HelpCircle size={16} color="var(--primary)" />
                <span>Telegram Guruh yoki Kanal ID sini qanday olish mumkin?</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: 'var(--primary-light)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    1
                  </div>
                  <div>
                    Telegram qidiruvidan <strong style={{ color: 'var(--primary)' }}>@ilbi_bot</strong> botimizni toping va uni guruhingiz yoki kanalingizga a’zo qilib qo‘shing.
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: 'var(--primary-light)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    2
                  </div>
                  <div>
                    Botga guruhda yoki kanalda xabar yoza olishi uchun <strong>Administrator (Admin)</strong> huquqini bering.
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: 'var(--primary-light)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    3
                  </div>
                  <div>
                    <strong>ID raqamini aniqlash:</strong> Guruhingizga <strong style={{ color: 'var(--primary)' }}>@myidbot</strong> yoki <strong style={{ color: 'var(--primary)' }}>@getmyid_bot</strong> botini vaqtincha qo‘shib, guruhda <code>/getgroupid</code> buyrug‘ini yuboring (u <code>-100...</code> bilan boshlanuvchi ID qaytaradi). Agar ommaviy kanal bo‘lsa, to‘g‘ridan-to‘g‘ri kanal username’ini (masalan: <code>@mening_kanalim</code>) kiritishingiz mumkin.
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: 'var(--primary-light)',
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 700,
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    4
                  </div>
                  <div>
                    Olingan ID ni yuqoridagi maydonga kiriting, <strong>Sozlamalarni saqlash</strong> tugmasini bosing va <strong>Test xabar yuborish</strong> orqali tekshirib ko‘ring!
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card: Report Destination Selectors */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Hisobotlar Yuborilish Manzili
              </h3>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                Kunlik avtomatik hisobot va kassa smenasi yopilgandagi Z-hisobot qayerga yuborilishini belgilang
              </div>
            </div>

            {/* Kunlik Hisobot Yo'nalishi */}
            <div>
              <label style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                1. Kunlik Yig‘ma Hisobot Manzili
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {[
                  { value: 'both', title: 'Ikkalasiga ham (Tavsiya)', desc: 'Ham guruh/kanalga, ham do‘kon egasining shaxsiy Telegramiga' },
                  { value: 'group', title: 'Faqat Guruh / Kanalga', desc: 'Shaxsiy chatni bezovta qilmasdan guruhga jo‘natadi' },
                  { value: 'user', title: 'Faqat Shaxsiy Chatga', desc: 'Faqat do‘kon egasining shaxsiy Telegramiga boradi' },
                  { value: 'none', title: 'O‘chirib qo‘yish', desc: 'Telegramga kunlik hisobot yuborilmaydi' },
                ].map((opt) => {
                  const isChecked = formData.daily_report_target === opt.value;
                  return (
                    <div
                      key={opt.value}
                      onClick={() => setFormData({ ...formData, daily_report_target: opt.value })}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: isChecked ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: isChecked ? 'var(--primary-light)' : 'var(--bg-surface)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: isChecked ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {opt.title}
                        </span>
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 999,
                            border: `2px solid ${isChecked ? 'var(--primary)' : 'var(--border-subtle)'}`,
                            background: isChecked ? 'var(--primary)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isChecked && <Check size={11} color="var(--text-on-primary)" />}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {opt.desc}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Smena Yopilgandagi Z-Hisobot Yo'nalishi */}
            <div>
              <label style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                2. Smena Yopilgandagi Z-Hisobot Manzili
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {[
                  { value: 'both', title: 'Ikkalasiga ham (Tavsiya)', desc: 'Guruhga hamda egasining shaxsiy Telegramiga jo‘natadi' },
                  { value: 'group', title: 'Faqat Guruh / Kanalga', desc: 'Faqat do‘kon guruhiga yuboriladi' },
                  { value: 'user', title: 'Faqat Shaxsiy Chatga', desc: 'Faqat do‘kon egasiga yuboriladi' },
                  { value: 'none', title: 'O‘chirib qo‘yish', desc: 'Smena yopilganda Telegramga hisobot bormaydi' },
                ].map((opt) => {
                  const isChecked = formData.shift_report_target === opt.value;
                  return (
                    <div
                      key={opt.value}
                      onClick={() => setFormData({ ...formData, shift_report_target: opt.value })}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: isChecked ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: isChecked ? 'var(--primary-light)' : 'var(--bg-surface)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: isChecked ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {opt.title}
                        </span>
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 999,
                            border: `2px solid ${isChecked ? 'var(--primary)' : 'var(--border-subtle)'}`,
                            background: isChecked ? 'var(--primary)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isChecked && <Check size={11} color="var(--text-on-primary)" />}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {opt.desc}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Kamayib Qolgan Tovarlar Hisoboti Yo'nalishi */}
            <div>
              <label style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                3. Kamayib Qolgan Tovarlar (Kamchiliklar) Hisoboti Manzili
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                {[
                  { value: 'both', title: 'Ikkalasiga ham (Tavsiya)', desc: 'Ham guruh/kanalga, ham do‘kon egasining shaxsiy Telegramiga' },
                  { value: 'group', title: 'Faqat Guruh / Kanalga', desc: 'Shaxsiy chatni bezovta qilmasdan faqat guruhga jo‘natadi' },
                  { value: 'user', title: 'Faqat Shaxsiy Chatga', desc: 'Faqat do‘kon egasining shaxsiy Telegramiga boradi' },
                  { value: 'none', title: 'O‘chirib qo‘yish', desc: 'Telegramga kamchiliklar haqida hisobot yuborilmaydi' },
                ].map((opt) => {
                  const isChecked = formData.low_stock_report_target === opt.value;
                  return (
                    <div
                      key={opt.value}
                      onClick={() => setFormData({ ...formData, low_stock_report_target: opt.value })}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        border: isChecked ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: isChecked ? 'var(--primary-light)' : 'var(--bg-surface)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: isChecked ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {opt.title}
                        </span>
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 999,
                            border: `2px solid ${isChecked ? 'var(--primary)' : 'var(--border-subtle)'}`,
                            background: isChecked ? 'var(--primary)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isChecked && <Check size={11} color="var(--text-on-primary)" />}
                        </div>
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {opt.desc}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Card: Web Interfeys va Qo'shimcha Signallar */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Web Interfeys va Qo‘shimcha Signallar
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Web Notification Toggle */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={formData.notify_web_reports}
                  onChange={(e) => setFormData({ ...formData, notify_web_reports: e.target.checked })}
                  style={{ width: 18, height: 18, accentColor: 'var(--primary)', marginTop: 2, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Web interfeysga Z-hisobot bildirishnomasini chiqarish
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    O‘chirib qo‘yilsa, smena yopilganda hisobot web interfeysdagi bildirishnomalar oynasiga (qo‘ng‘iroqcha) tushmaydi, bu esa bildirishnomalar to‘lib ketishining oldini oladi.
                  </span>
                </div>
              </label>

              {/* Web Low-Stock Notification Toggle */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={formData.notify_web_low_stock}
                  onChange={(e) => setFormData({ ...formData, notify_web_low_stock: e.target.checked })}
                  style={{ width: 18, height: 18, accentColor: 'var(--primary)', marginTop: 2, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Web interfeysga kamchiliklar (defitsit) bildirishnomasini chiqarish
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    O‘chirib qo‘yilsa, kamchilik tovarlar haqidagi ogohlantirish web interfeysdagi bildirishnomalar oynasiga (qo‘ng‘iroqcha) tushmaydi.
                  </span>
                </div>
              </label>

              {/* Notify on sale */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={formData.notify_on_sale}
                  onChange={(e) => setFormData({ ...formData, notify_on_sale: e.target.checked })}
                  style={{ width: 18, height: 18, accentColor: 'var(--primary)', marginTop: 2, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Savdolar haqida Telegramda xabardor qilish
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    Kassada amalga oshirilgan yirik va muhim savdolar haqida Telegramga tezkor xabar yuborish.
                  </span>
                </div>
              </label>

              {/* Notify on debt */}
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={formData.notify_on_debt}
                  onChange={(e) => setFormData({ ...formData, notify_on_debt: e.target.checked })}
                  style={{ width: 18, height: 18, accentColor: 'var(--primary)', marginTop: 2, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Nasiya va qarz to‘lovlari haqida xabar berish
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                    Mijoz nasiyasi yozilganda yoki qarz to‘langanda Telegram manziliga xabar yetkaziladi.
                  </span>
                </div>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary"
                style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700 }}
              >
                <Save size={16} />
                <span>{saving ? 'Saqlanmoqda...' : 'Telegram Sozlamalarini Saqlash'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: CHEK & KASSA SOZLAMALARI */}
      {/* ========================================================================= */}
      {activeTab === 'receipt' && (
        <ReceiptSettingsPanel tenant={tenant} value={formData} onChange={setFormData}
          onSave={handleSave} saving={saving} previewDate={previewDate} />
      )}

      {/* ========================================================================= */}
      {/* TAB 4: AVTOMATLASHTIRISH & XIZMATLAR */}
      {/* ========================================================================= */}
      {activeTab === 'automation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Card: Daily Report Time */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Avtomatik Kunlik Hisobot Vaqti
                </h3>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Celery Beat orqali do‘konning kunlik umumiy balansi va savdo natijalari avtomatik yuboriladigan reja vaqti
                </div>
              </div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: 'var(--primary-light)',
                  color: 'var(--primary)',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <Clock size={15} />
                <span>Reja: {formData.daily_report_time.slice(0, 5)}</span>
              </div>
            </div>

            <div style={{ maxWidth: 300 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Hisobot Yuborilish Soati
              </label>
              <input
                type="time"
                step="60"
                value={formData.daily_report_time.slice(0, 5)}
                onChange={(e) => setFormData({ ...formData, daily_report_time: e.target.value + ':00' })}
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: 15,
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary"
                style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700 }}
              >
                <Save size={16} />
                <span>{saving ? 'Saqlanmoqda...' : 'Vaqtni Saqlash'}</span>
              </button>
            </div>
          </div>

          {/* Card: Low Stock Report Schedule */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={18} style={{ color: 'var(--accent-rose)' }} />
                  <span>Kamchiliklar (Defitsit) Tovarlar Hisoboti Jadvali</span>
                </h3>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  Oxirgi 30 kunda kamida 10 ta sotilgan va hozirda ombordagi qoldig‘i 5 yoki undan kam qolgan tovarlar bo‘yicha avtomatik xabarnoma jadvali
                </div>
              </div>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: 'rgba(var(--danger-rgb), 0.1)',
                  color: 'var(--accent-rose)',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <Clock size={15} />
                <span>
                  {formData.low_stock_frequency === 'daily' && `Har kuni, soat ${formData.low_stock_report_time.slice(0, 5)} da`}
                  {formData.low_stock_frequency === 'weekly' && `Haftalik (${['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'][(formData.low_stock_weekday || 1) - 1]}), soat ${formData.low_stock_report_time.slice(0, 5)} da`}
                  {formData.low_stock_frequency === 'monthly' && `Oylik (har oyning ${formData.low_stock_day_of_month}-kuni), soat ${formData.low_stock_report_time.slice(0, 5)} da`}
                </span>
              </div>
            </div>

            {/* Frequency Selection */}
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Yuborilish Davriyligi (Chastotasi)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                {[
                  { value: 'daily', label: 'Har kuni', desc: 'Har kuni belgilangan vaqtda kamchiliklar tekshirilib yuboriladi' },
                  { value: 'weekly', label: 'Haftada bir marta', desc: 'Haftaning ma’lum bir belgilangan kunida yuboriladi' },
                  { value: 'monthly', label: 'Oyda bir marta', desc: 'Har oyning ma’lum bir belgilangan sanasida yuboriladi' },
                ].map((freq) => {
                  const isChecked = formData.low_stock_frequency === freq.value;
                  return (
                    <div
                      key={freq.value}
                      onClick={() => setFormData({ ...formData, low_stock_frequency: freq.value })}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: isChecked ? '2px solid var(--primary)' : '1px solid var(--border-subtle)',
                        background: isChecked ? 'var(--primary-light)' : 'var(--bg-surface)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isChecked ? 'var(--primary)' : 'var(--text-primary)' }}>
                          {freq.label}
                        </span>
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: 999,
                            border: `2px solid ${isChecked ? 'var(--primary)' : 'var(--border-subtle)'}`,
                            background: isChecked ? 'var(--primary)' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isChecked && <Check size={10} color="var(--text-on-primary)" />}
                        </div>
                      </div>
                      <span style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                        {freq.desc}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Conditional Parameters: Weekday or Day of Month */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {formData.low_stock_frequency === 'weekly' && (
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Haftaning Qaysi Kuni?
                  </label>
                  <CustomSelect data-api-field="low_stock_weekday"
                    value={formData.low_stock_weekday}
                    onChange={(val) => setFormData({ ...formData, low_stock_weekday: parseInt(val, 10) })}
                    options={[
                      { value: 1, label: '1 — Dushanba' },
                      { value: 2, label: '2 — Seshanba' },
                      { value: 3, label: '3 — Chorshanba' },
                      { value: 4, label: '4 — Payshanba' },
                      { value: 5, label: '5 — Juma' },
                      { value: 6, label: '6 — Shanba' },
                      { value: 7, label: '7 — Yakshanba' },
                    ]}
                    fullWidth
                  />
                </div>
              )}

              {formData.low_stock_frequency === 'monthly' && (
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Oyning Qaysi Sanasida? (1 — 31)
                  </label>
                  <CustomSelect data-api-field="low_stock_day_of_month"
                    value={formData.low_stock_day_of_month}
                    onChange={(val) => setFormData({ ...formData, low_stock_day_of_month: parseInt(val, 10) })}
                    options={Array.from({ length: 31 }, (_, i) => ({
                      value: i + 1,
                      label: `Har oyning ${i + 1}-kuni`,
                    }))}
                    fullWidth
                  />
                </div>
              )}

              {/* Time Picker */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Yuborilish Soati
                </label>
                <input
                  type="time"
                  step="60"
                  value={formData.low_stock_report_time.slice(0, 5)}
                  onChange={(e) => setFormData({ ...formData, low_stock_report_time: e.target.value + ':00' })}
                  style={{
                    width: '100%',
                    padding: '11px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-card)',
                    background: 'var(--bg-input)',
                    color: 'var(--text-primary)',
                    fontSize: 15,
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="btn btn-primary"
                style={{ padding: '10px 24px', fontSize: 14, fontWeight: 700 }}
              >
                <Save size={16} />
                <span>{saving ? 'Saqlanmoqda...' : 'Kamchiliklar Jadvalini Saqlash'}</span>
              </button>
            </div>
          </div>

          {/* Card: Low Stock Instant Trigger */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ maxWidth: 650 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={17} style={{ color: 'var(--accent-rose)' }} />
                <span>Kamchiliklar Hisobotini Hozir Yuborish (Instant Trigger)</span>
              </h3>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                Rejadagi vaqtni kutmasdan, ayni daqiqada kamayib qolgan tovarlar tahlilini (so‘nggi 30 kunda 10+ sotilgan va qoldig‘i ≤5 bo‘lgan tovarlar) Telegramdagi belgilangan manzilga darhol jo‘natish.
              </div>
            </div>
            <button
              type="button"
              onClick={handleSendLowStockReportNow}
              disabled={sendingLowStockReportNow}
              className="btn btn-secondary"
              style={{
                padding: '11px 20px',
                fontSize: 13.5,
                fontWeight: 700,
                color: 'var(--accent-rose)',
                border: '1px solid var(--accent-rose)',
              }}
            >
              <Send size={16} />
              <span>{sendingLowStockReportNow ? 'Yuborilmoqda...' : 'Kamchiliklar Hisobotini Hozir Yuborish'}</span>
            </button>
          </div>

          {/* Card: Manual Instant Trigger */}
          <div className="glass-card" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ maxWidth: 650 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Qo‘lda Tezkor Hisobot Yuborish (Instant Trigger)
              </h3>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                Rejadagi kechki soatni kutmasdan, bugungi ayni paytgacha bo‘lgan barcha savdolar va kassa holatini Telegramdagi belgilangan manzilga darhol yuborish.
              </div>
            </div>
            <button
              type="button"
              onClick={handleSendReportNow}
              disabled={sendingReportNow}
              className="btn btn-secondary"
              style={{
                padding: '11px 20px',
                fontSize: 13.5,
                fontWeight: 700,
                color: 'var(--primary)',
                border: '1px solid var(--primary)',
              }}
            >
              <Send size={16} />
              <span>{sendingReportNow ? 'Hisobot yuborilmoqda...' : 'Hisobotni Hozir Yuborish'}</span>
            </button>
          </div>

          <div className="glass-card" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 6px', color: 'var(--text-primary)' }}>Xizmatlar holati</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Bu sahifada Redis, Celery va Telegram uchun jonli diagnostika mavjud emas. Xizmat holatini server monitoringi orqali tekshiring.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Services() {
  const { isAdmin } = useAuth();
  const [scope, setScope] = useState('platform');
  if (!isAdmin) return <TenantServices />;
  return <div className="admin-page">
    <div className="admin-toolbar"><button className={`btn ${scope === 'platform' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScope('platform')}>Platforma bildirishnomalari</button><button className={`btn ${scope === 'tenant' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setScope('tenant')}>Do‘kon sozlamalari</button></div>
    {scope === 'platform' ? <PlatformSettings /> : <TenantServices />}
  </div>;
}
