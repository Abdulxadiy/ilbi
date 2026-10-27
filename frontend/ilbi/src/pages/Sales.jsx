import { useWorkspaceAction } from '../hooks/useWorkspaceAction';
import IlbiLoader from '../components/common/IlbiLoader';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Ban,
  AlertTriangle,
  Receipt,
  Search,
  Printer,
  RotateCcw,
  Calendar,
  CalendarDays,
  CreditCard,
  Building2,
  FileText,
  ArrowUpRight,
} from 'lucide-react';
import { salesApi } from '../api/client';
import Modal from '../components/common/Modal';
import ExcelExportButton from '../components/common/ExcelExportButton';
import ReceiptSlip, { printReceiptSlip } from '../components/common/ReceiptSlip';
import InvoiceA4Modal from '../components/common/InvoiceA4Modal';
import ShareDocumentButton from '../components/common/ShareDocumentButton';
import CustomSelect from '../components/common/CustomSelect';
import CustomDatePicker from '../components/common/CustomDatePicker';
import Pagination from '../components/common/Pagination';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { usePersistedState } from '../hooks/usePersistedState';
import { useDebouncedValue, usePaginatedList } from '../hooks/usePaginatedList';
import { useTenant } from '../context/TenantContext';

const DEFAULT_SALES_FILTERS = {
  search: '',
  datePreset: 'all', // 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'
  startDate: '',
  endDate: '',
  paymentMethod: 'all', // 'all' | 'cash' | 'card' | 'debt'
  status: 'all', // 'all' | 'completed' | 'partially_voided' | 'voided'
};

export default function Sales() {
  const { activeTenant } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();

  const [salesFilters, setSalesFilters, resetSalesFilters] = usePersistedState(
    `ilbi_sales_filters_v2:${activeTenant?.id || 'pending'}`,
    DEFAULT_SALES_FILTERS
  );

  // Automatic redirect if visited with legacy tabs (?tab=counterparties or ?tab=b2b)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    if (tab === 'counterparties' || tab === 'debts') {
      navigate('/debts', { replace: true });
    } else if (tab === 'b2b') {
      navigate('/b2b', { replace: true });
    }
  }, [location.search, navigate]);

  // Ensure persisted dates are clean strings
  useEffect(() => {
    if (salesFilters) {
      const isStartCorrupt = salesFilters.startDate && typeof salesFilters.startDate !== 'string';
      const isEndCorrupt = salesFilters.endDate && typeof salesFilters.endDate !== 'string';
      if (isStartCorrupt || isEndCorrupt) {
        setSalesFilters((prev) => ({
          ...prev,
          startDate: typeof prev.startDate === 'string' ? prev.startDate : (prev.startDate?.target?.value || prev.startDate?.value || ''),
          endDate: typeof prev.endDate === 'string' ? prev.endDate : (prev.endDate?.target?.value || prev.endDate?.value || ''),
        }));
      }
    }
  }, [salesFilters, setSalesFilters]);

  // Sale Detail & Receipt Modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedSaleDetail, setSelectedSaleDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [rotatingReceiptToken, setRotatingReceiptToken] = useState(false);
  const [receiptPaperWidth, setReceiptPaperWidth] = usePersistedState(
    `ilbi_receipt_paper_width:${activeTenant?.id || 'pending'}`,
    '58mm'
  );

  // A4 Invoice Modal
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [selectedInvoiceSale, setSelectedInvoiceSale] = useState(null);

  // Void Sale Modal
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [submittingVoid, setSubmittingVoid] = useState(false);

  // Void Item Modal
  const [voidItemModalOpen, setVoidItemModalOpen] = useState(false);
  const [selectedItemToVoid, setSelectedItemToVoid] = useState(null);
  const [voidItemQuantity, setVoidItemQuantity] = useState('1');
  const [voidItemReason, setVoidItemReason] = useState('');
  const [submittingItemVoid, setSubmittingItemVoid] = useState(false);

  const getSalesFilters = useCallback(() => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
    const day = new Date(`${today}T00:00:00Z`);
    const shiftDay = (offset) => { const date = new Date(day); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
    let dateFrom; let dateTo;
    if (salesFilters.datePreset === 'today') dateFrom = dateTo = today;
    if (salesFilters.datePreset === 'yesterday') dateFrom = dateTo = shiftDay(-1);
    if (salesFilters.datePreset === 'week') { dateFrom = shiftDay(-6); dateTo = today; }
    if (salesFilters.datePreset === 'month') { dateFrom = `${today.slice(0, 7)}-01`; dateTo = today; }
    if (salesFilters.datePreset === 'custom') { dateFrom = salesFilters.startDate; dateTo = salesFilters.endDate; }
    return { search: salesFilters.search,
        status: salesFilters.status !== 'all' ? salesFilters.status : undefined,
        payment_type: salesFilters.paymentMethod !== 'all' ? salesFilters.paymentMethod : undefined,
        date_from: dateFrom, date_to: dateTo,
    };
  }, [salesFilters]);

  const debouncedSearch = useDebouncedValue(salesFilters.search.trim());
  const { items: salesList, total: totalSalesCount, page: salesPage, setPage: setSalesPage,
    loading, refresh: loadData, error: listError } = usePaginatedList(
    salesApi.getSales, { ...getSalesFilters(), search: debouncedSearch },
    { tenantId: activeTenant?.id },
  );
  useEffect(() => {
    if (listError) toast.error(listError.message || 'Savdolarni yuklab bo‘lmadi.');
  }, [listError, toast]);

  // Open Sale Detail
  const handleOpenDetail = async (sale, signal) => {
    setSelectedSaleDetail(null);
    setDetailModalOpen(true);
    setLoadingDetail(true);
    try {
      const detail = await salesApi.getSaleDetail(sale.id, { signal });
      if (signal?.aborted) return;
      setSelectedSaleDetail(detail);
    } catch {
      if (signal?.aborted) return;
      toast.error('Chek tafsilotlarini yuklab bo‘lmadi');
      setDetailModalOpen(false);
    } finally {
      if (!signal?.aborted) setLoadingDetail(false);
    }
  };

  useWorkspaceAction(({ search, id, signal }) => {
    if (search !== null) setSalesFilters(previous => ({ ...DEFAULT_SALES_FILTERS, search }));
    if (id) handleOpenDetail({ id }, signal);
  });

  // Open A4 Invoice Modal
  const handleOpenInvoice = async (sale) => {
    if (sale.items && Array.isArray(sale.items) && sale.items.length > 0) {
      setSelectedInvoiceSale(sale);
      setInvoiceModalOpen(true);
      return;
    }
    try {
      const detail = await salesApi.getSaleDetail(sale.id);
      setSelectedInvoiceSale(detail);
      setInvoiceModalOpen(true);
    } catch {
      toast.error('Faktura ma’lumotlarini yuklab bo‘lmadi');
    }
  };

  const handleRotateReceiptToken = async () => {
    if (!selectedSaleDetail || rotatingReceiptToken) return;
    const approved = await confirm({
      title: 'Chek havolasini yangilash',
      message: 'Eski elektron havola darhol ishlamay qoladi. Yangi chekni chop etasizmi?',
      confirmText: 'Havolani yangilash',
      cancelText: 'Bekor qilish',
      type: 'warning',
    });
    if (!approved) return;
    setRotatingReceiptToken(true);
    try {
      const result = await salesApi.rotateReceiptToken(selectedSaleDetail.id);
      setSelectedSaleDetail((current) => ({ ...current, public_token: result.public_token }));
      toast.success('Chek havolasi yangilandi. Eski havola bekor qilindi.');
    } catch (err) {
      toast.error(err.message || 'Chek havolasini yangilab bo‘lmadi');
    } finally {
      setRotatingReceiptToken(false);
    }
  };

  // Void entire sale
  const handleOpenVoid = (saleId) => {
    setSelectedSaleId(saleId);
    setVoidReason('');
    setVoidModalOpen(true);
  };

  const handleConfirmVoid = async (e) => {
    e.preventDefault();
    if (!voidReason.trim()) {
      toast.warning('Chekni bekor qilish sababini kiriting');
      return;
    }
    setSubmittingVoid(true);
    try {
      await salesApi.voidSale(selectedSaleId, voidReason);
      toast.success('Chek butunlay bekor qilindi!');
      setVoidModalOpen(false);
      if (detailModalOpen && selectedSaleDetail) {
        try {
          const updated = await salesApi.getSaleDetail(selectedSaleDetail.id);
          setSelectedSaleDetail(updated);
        } catch {
          setDetailModalOpen(false);
        }
      }
      loadData();
    } catch (err) {
      toast.error(err.message || 'Chekni bekor qilishda xatolik yuz berdi');
    } finally {
      setSubmittingVoid(false);
    }
  };

  // Void item in sale
  const handleOpenVoidItem = (item) => {
    setSelectedItemToVoid(item);
    setVoidItemQuantity(String(item.quantity - (item.voided_quantity || 0)));
    setVoidItemReason('');
    setVoidItemModalOpen(true);
  };

  const handleConfirmVoidItem = async (e) => {
    e.preventDefault();
    if (!voidItemReason.trim()) {
      toast.warning('Sababni ko‘rsating');
      return;
    }
    setSubmittingItemVoid(true);
    try {
      await salesApi.voidSaleItem(selectedItemToVoid.id, {
        quantity: parseFloat(voidItemQuantity),
        reason: voidItemReason,
      });
      toast.success('Pozitsiya bekor qilindi!');
      setVoidItemModalOpen(false);
      if (selectedSaleDetail) {
        const updated = await salesApi.getSaleDetail(selectedSaleDetail.id);
        setSelectedSaleDetail(updated);
      }
      loadData();
    } catch (err) {
      toast.error(err.message || 'Pozitsiyani bekor qilishda xatolik');
    } finally {
      setSubmittingItemVoid(false);
    }
  };

  const filteredSales = salesList;

  // Uzbek date formatter for day headers
  const formatUzbekDateHeader = (dateStr) => {
    if (!dateStr || dateStr === 'Noma’lum sana') {
      return { title: 'Noma’lum sana', isToday: false, isYesterday: false };
    }
    const [y, m, d] = dateStr.split('-');
    const dateObj = new Date(Number(y), Number(m) - 1, Number(d));

    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    const monthsUz = [
      'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
      'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
    ];
    const daysUz = [
      'Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'
    ];

    const monthName = monthsUz[dateObj.getMonth()];
    const dayName = daysUz[dateObj.getDay()];
    const dayNum = parseInt(d, 10);

    if (dateStr === todayKey) {
      return { title: `Bugun — ${dayNum}-${monthName}, ${y}`, isToday: true, isYesterday: false, dayName };
    }
    if (dateStr === yesterdayKey) {
      return { title: `Kecha — ${dayNum}-${monthName}, ${y}`, isToday: false, isYesterday: true, dayName };
    }
    return { title: `${dayNum}-${monthName}, ${y} (${dayName})`, isToday: false, isYesterday: false, dayName };
  };

  // Group filtered sales by local date
  const sortedDayGroups = useMemo(() => {
    const groups = filteredSales.reduce((acc, sale) => {
      let dateKey = 'Noma’lum sana';
      if (sale.created_at) {
        const d = new Date(sale.created_at);
        dateKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(d);
      }

      if (!acc[dateKey]) {
        acc[dateKey] = {
          dateKey,
          sales: [],
          totalUzs: 0,
          totalUsd: 0,
          voidedCount: 0,
          activeCount: 0,
        };
      }

      acc[dateKey].sales.push(sale);
      const isVoided = (sale.status || '').toLowerCase() === 'voided';
      const amount = Number(sale.net_amount ?? sale.total_amount ?? sale.total_price_uzs ?? 0);
      const currency = (sale.currency || 'UZS').toUpperCase();

      if (isVoided) {
        acc[dateKey].voidedCount += 1;
      } else {
        acc[dateKey].activeCount += 1;
        if (currency === 'USD') {
          acc[dateKey].totalUsd += amount;
        } else {
          acc[dateKey].totalUzs += amount;
        }
      }

      return acc;
    }, {});

    return Object.values(groups).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [filteredSales]);

  const hasActiveSalesFilters =
    Boolean(salesFilters.search) ||
    salesFilters.datePreset !== 'all' ||
    salesFilters.paymentMethod !== 'all' ||
    salesFilters.status !== 'all' ||
    Boolean(salesFilters.startDate) ||
    Boolean(salesFilters.endDate);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Header Bar with Quick Nav to Debts & B2B */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <ExcelExportButton endpoint="/sales/export/" params={getSalesFilters()} filename="ilbi-savdolar.xlsx" disabled={loading} />
          <Link
            to="/debts"
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 13,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <CreditCard size={15} style={{ color: 'var(--accent-amber)' }} />
            <span>Mijoz Nasiyalari</span>
            <ArrowUpRight size={13} style={{ color: 'var(--text-muted)' }} />
          </Link>

          <Link
            to="/b2b"
            style={{
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 13,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <Building2 size={15} style={{ color: 'var(--accent-emerald)' }} />
            <span>B2B Tranzaksiyalar</span>
            <ArrowUpRight size={13} style={{ color: 'var(--text-muted)' }} />
          </Link>
        </div>

      {/* Filter toolbar for sales */}
      <div
        className="glass-card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          background: 'var(--bg-card)',
        }}
      >
        {/* Row 1: Search, Payment Method, Status */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Search Input */}
          <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input data-api-field="search"
              type="text"
              placeholder="Chek ID, mijoz yoki kassir bo‘yicha izlash..."
              value={salesFilters.search}
              onChange={(e) => setSalesFilters({ ...salesFilters, search: e.target.value })}
              style={{
                width: '100%',
                padding: '9px 14px 9px 38px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          {/* Payment Method Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>To‘lov turi:</span>
            <CustomSelect data-api-field="paymentMethod"
              value={salesFilters.paymentMethod}
              onChange={(val) => setSalesFilters({ ...salesFilters, paymentMethod: val })}
              options={[
                { value: 'all', label: 'Barcha to‘lovlar' },
                { value: 'cash', label: 'Naqd pul (CASH)' },
                { value: 'card', label: 'Plastik karta (CARD)' },
                { value: 'debt', label: 'Nasiya / Qarz (DEBT)' },
              ]}
              size="md"
              style={{ minWidth: 160 }}
            />
          </div>

          {/* Status Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Holati:</span>
            <CustomSelect data-api-field="status"
              value={salesFilters.status}
              onChange={(val) => setSalesFilters({ ...salesFilters, status: val })}
              options={[
                { value: 'all', label: 'Barcha holatlar' },
                { value: 'completed', label: 'Bajarildi' },
                { value: 'partially_voided', label: 'Qisman bekor qilingan' },
                { value: 'voided', label: 'Bekor qilingan' },
              ]}
              size="md"
              style={{ minWidth: 160 }}
            />
          </div>

          {/* Reset button */}
          {hasActiveSalesFilters && (
            <button
              type="button"
              onClick={resetSalesFilters}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(var(--danger-rgb), 0.3)',
                background: 'rgba(var(--danger-rgb), 0.08)',
                color: 'var(--accent-rose)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <RotateCcw size={12} />
              <span>Filtrni tozalash</span>
            </button>
          )}
        </div>

        {/* Row 2: Date Presets & Custom Range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 6 }}>
            <CalendarDays size={15} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sana:</span>
          </div>

          {[
            { id: 'all', label: 'Barchasi' },
            { id: 'today', label: 'Bugun' },
            { id: 'yesterday', label: 'Kecha' },
            { id: 'week', label: 'Oxirgi 7 kun' },
            { id: 'month', label: 'Shu oy' },
            { id: 'custom', label: 'Oraliq sana...' },
          ].map((preset) => {
            const isSelected = salesFilters.datePreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSalesFilters({ ...salesFilters, datePreset: preset.id })}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: isSelected ? '1px solid var(--primary)' : '1px solid var(--border-card)',
                  background: isSelected ? 'var(--primary)' : 'var(--bg-app)',
                  color: isSelected ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: isSelected ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {preset.label}
              </button>
            );
          })}

          {/* If Custom Date Selected */}
          {salesFilters.datePreset === 'custom' && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
              <CustomDatePicker
                value={typeof salesFilters.startDate === 'string' ? salesFilters.startDate : (salesFilters.startDate?.target?.value || '')}
                onChange={(val) => {
                  const cleanVal = typeof val === 'string' ? val : (val?.target?.value || '');
                  setSalesFilters({ ...salesFilters, startDate: cleanVal });
                }}
                placeholder="Boshlanish sanasi"
                size="sm"
                style={{ minWidth: 140 }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
              <CustomDatePicker
                value={typeof salesFilters.endDate === 'string' ? salesFilters.endDate : (salesFilters.endDate?.target?.value || '')}
                onChange={(val) => {
                  const cleanVal = typeof val === 'string' ? val : (val?.target?.value || '');
                  setSalesFilters({ ...salesFilters, endDate: cleanVal });
                }}
                placeholder="Tugash sanasi"
                size="sm"
                style={{ minWidth: 140 }}
              />
            </div>
          )}

          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            Topildi: <strong style={{ color: 'var(--text-primary)' }}>{filteredSales.length}</strong> ta sotuv ({sortedDayGroups.length} kun)
          </div>
        </div>
      </div>

      {/* Sales List Grouped by Day */}
      <div>
        {loading ? (
          <div className="glass-card" style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <IlbiLoader label="Sotuvlar yuklanmoqda..." />
          </div>
        ) : sortedDayGroups.length > 0 ? (
          sortedDayGroups.map((group) => {
            const headerInfo = formatUzbekDateHeader(group.dateKey);
            return (
              <div
                key={group.dateKey}
                className="glass-card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  marginBottom: 20,
                  border: headerInfo.isToday ? '1px solid rgba(var(--primary-rgb), 0.4)' : '1px solid var(--border-card)',
                }}
              >
                {/* Day Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                    padding: '14px 20px',
                    background: headerInfo.isToday
                      ? 'linear-gradient(90deg, rgba(var(--primary-rgb), 0.12) 0%, rgba(var(--primary-rgb), 0.03) 100%)'
                      : 'var(--bg-card)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Calendar size={18} style={{ color: headerInfo.isToday ? 'var(--primary)' : 'var(--text-secondary)' }} />
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {headerInfo.title}
                    </span>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: 11,
                        fontWeight: 700,
                        background: 'var(--bg-app)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {group.sales.length} ta chek
                    </span>
                  </div>

                  {/* Day Totals */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {group.totalUzs > 0 && (
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(34, 197, 94, 0.12)',
                          color: 'var(--accent-emerald)',
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        {group.totalUzs.toLocaleString()} UZS
                      </span>
                    )}
                    {group.totalUsd > 0 && (
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(59, 130, 246, 0.12)',
                          color: 'var(--accent-blue)',
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        ${group.totalUsd.toLocaleString()} USD
                      </span>
                    )}
                    {group.voidedCount > 0 && (
                      <span
                        style={{
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(var(--danger-rgb), 0.12)',
                          color: 'var(--accent-rose)',
                          fontWeight: 600,
                          fontSize: 12,
                        }}
                      >
                        {group.voidedCount} bekor qilingan
                      </span>
                    )}
                  </div>
                </div>

                {/* Day Sales Table */}
                <div className="table-responsive">
                  <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          background: 'var(--bg-card)',
                          color: 'var(--text-secondary)',
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <th style={{ padding: '12px 20px', whiteSpace: 'nowrap' }}>Chek #</th>
                        <th style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>To‘lov turi</th>
                        <th style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>Jami Summa</th>
                        <th style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>Mijoz</th>
                        <th style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>Sotuvchi</th>
                        <th style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>Holat</th>
                        <th style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>Vaqt</th>
                        <th style={{ padding: '12px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>Amallar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.sales.map((s) => {
                        const statusLower = (s.status || '').toLowerCase();
                        const isCompleted = statusLower === 'completed';
                        const isPartiallyVoided = statusLower === 'partially_voided';
                        const isVoided = statusLower === 'voided';
                        const canVoid = isCompleted || isPartiallyVoided;
                        const timeStr = s.created_at
                          ? new Date(s.created_at).toLocaleTimeString('uz-UZ', {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                          : '—';

                        return (
                          <tr
                            key={s.id}
                            style={{
                              borderBottom: '1px solid var(--border-subtle)',
                              transition: 'background 0.15s ease',
                            }}
                          >
                            <td style={{ padding: '14px 20px', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                              #{s.receipt_number || s.id}
                            </td>
                            <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              <span style={{ textTransform: 'uppercase', fontSize: 12, fontWeight: 600 }}>
                                {s.payment_type || s.payment_method || 'Naqd'}
                              </span>
                            </td>
                            <td
                              style={{
                                padding: '14px 16px',
                                fontWeight: 700,
                                color: isVoided ? 'var(--text-muted)' : 'var(--primary)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {Number(s.net_amount ?? s.total_amount ?? s.total_price_uzs ?? 0).toLocaleString()} {s.currency || 'UZS'}
                            </td>
                            <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {s.counterparty_name || 'Oddiy xaridor'}
                            </td>
                            <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: 13, whiteSpace: 'nowrap' }}>
                              {s.sold_by_name || 'Kassir'}
                            </td>
                            <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                              <span
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: 'var(--radius-xs)',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: isCompleted
                                    ? 'rgba(34, 197, 94, 0.12)'
                                    : isPartiallyVoided
                                    ? 'rgba(var(--primary-rgb), 0.12)'
                                    : isVoided
                                    ? 'rgba(var(--danger-rgb), 0.12)'
                                    : 'rgba(100, 116, 139, 0.12)',
                                  color: isCompleted
                                    ? 'var(--accent-emerald)'
                                    : isPartiallyVoided
                                    ? 'var(--accent-amber)'
                                    : isVoided
                                    ? 'var(--accent-rose)'
                                    : 'var(--text-secondary)',
                                }}
                              >
                                {isCompleted
                                  ? 'Bajarildi'
                                  : isPartiallyVoided
                                  ? 'Qisman bekor'
                                  : isVoided
                                  ? 'Bekor qilingan'
                                  : s.status}
                              </span>
                            </td>
                            <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                              {timeStr}
                            </td>
                            <td style={{ padding: '14px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <div style={{ display: 'inline-flex', gap: 6 }}>
                                <button
                                  type="button"
                                  onClick={() => handleOpenDetail(s)}
                                  style={{
                                    padding: '6px 12px',
                                    borderRadius: 'var(--radius-xs)',
                                    border: '1px solid var(--border-card)',
                                    background: 'var(--bg-card)',
                                    color: 'var(--text-primary)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                  }}
                                >
                                  <Receipt size={13} />
                                  <span>Chek</span>
                                </button>

                                {((s.payment_type || '').toLowerCase() === 'debt' ||
                                  Boolean(s.is_partner_sale) ||
                                  Boolean(s.counterparty) ||
                                  Boolean(s.counterparty_name) ||
                                  Boolean(s.b2b_target_tenant)) && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenInvoice(s)}
                                    title="A4 formatida rasmiy Hisob-faktura / Yuk xati"
                                    style={{
                                      padding: '6px 12px',
                                      borderRadius: 'var(--radius-xs)',
                                      border: '1px solid var(--border-card)',
                                      background: 'transparent',
                                      color: 'var(--text-secondary)',
                                      fontSize: 12,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <FileText size={13} />
                                    <span>Faktura</span>
                                  </button>
                                )}

                                {canVoid && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenVoid(s.id)}
                                    style={{
                                      padding: '6px 10px',
                                      borderRadius: 'var(--radius-xs)',
                                      border: '1px solid rgba(var(--danger-rgb), 0.3)',
                                      background: 'rgba(var(--danger-rgb), 0.08)',
                                      color: 'var(--accent-rose)',
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 4,
                                    }}
                                  >
                                    <Ban size={12} />
                                    <span>Bekor qilish</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
        ) : (
          <div className="glass-card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Receipt size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)' }}>
              Sotuvlar topilmadi
            </div>
            {hasActiveSalesFilters && (
              <button
                type="button"
                onClick={resetSalesFilters}
                style={{
                  marginTop: 12,
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Filtrlarni tozalash
              </button>
            )}
          </div>
        )}

        {/* Pagination Controls */}
        {sortedDayGroups.length > 0 && (
          <Pagination
            currentPage={salesPage}
            totalItems={totalSalesCount}
            pageSize={20}
            onPageChange={(p) => setSalesPage(p)}
          />
        )}
      </div>

      {/* Modal 1: Sale Detail / Printable Thermal Receipt */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Sotuv Cheki Tafsilotlari">
        {loadingDetail ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Yuklanmoqda..." /></div>
        ) : selectedSaleDetail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Printer format switcher */}
            <div className="no-print" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>
                Printer:
              </span>
              <button
                type="button"
                onClick={() => setReceiptPaperWidth('58mm')}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: receiptPaperWidth === '58mm' ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: receiptPaperWidth === '58mm' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  color: receiptPaperWidth === '58mm' ? 'var(--primary)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                58 mm (Uzum/Kichik termal)
              </button>
              <button
                type="button"
                onClick={() => setReceiptPaperWidth('80mm')}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: receiptPaperWidth === '80mm' ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: receiptPaperWidth === '80mm' ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                  color: receiptPaperWidth === '80mm' ? 'var(--primary)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                80 mm (Katta POS)
              </button>
            </div>

            {/* Authentic Printable Thermal Receipt */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <ReceiptSlip id="printable-receipt" sales={[selectedSaleDetail]} paperWidth={receiptPaperWidth} />
            </div>

            {/* Void Items Action List (Web Only) */}
            {['completed', 'partially_voided'].includes((selectedSaleDetail.status || '').toLowerCase()) && (
              <div
                className="no-print"
                style={{
                  marginTop: 6,
                  padding: 12,
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Tovarlarni qisman bekor qilish / qaytarish:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(selectedSaleDetail.items || []).map((it) => {
                    const remainingQty = (it.quantity || 0) - (it.voided_quantity || 0);
                    if (remainingQty <= 0) return null;
                    return (
                      <div
                        key={it.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '6px 10px',
                          borderRadius: 'var(--radius-xs)',
                          background: 'var(--bg-app)',
                          fontSize: 12,
                        }}
                      >
                        <div>
                          <strong>{it.product_name}</strong>
                          {it.product_variant_name ? ` (${it.product_variant_name})` : ''} — {remainingQty} dona qoldi
                        </div>
                        <button
                          type="button"
                          onClick={() => handleOpenVoidItem(it)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-xs)',
                            border: '1px solid rgba(var(--danger-rgb), 0.3)',
                            background: 'rgba(var(--danger-rgb), 0.1)',
                            color: 'var(--accent-rose)',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Bekor qilish
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Modal Bottom Actions */}
            <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, flexWrap: 'wrap', gap: 10 }}>
              <ShareDocumentButton
                elementId="printable-receipt"
                title={`ILBI Chek ${selectedSaleDetail.receipt_number || ''}`}
                sales={[selectedSaleDetail]}
                paperWidth={receiptPaperWidth}
              />
              <button
                type="button"
                onClick={() => printReceiptSlip('printable-receipt', 'ILBI Savdo Cheki', receiptPaperWidth)}
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
                  gap: 6,
                }}
              >
                <Printer size={15} />
                <span>Chekni chop etish</span>
              </button>

              {selectedSaleDetail &&
                ((selectedSaleDetail.payment_type || '').toLowerCase() === 'debt' ||
                  Boolean(selectedSaleDetail.is_partner_sale) ||
                  Boolean(selectedSaleDetail.counterparty) ||
                  Boolean(selectedSaleDetail.counterparty_name) ||
                  Boolean(selectedSaleDetail.b2b_target_tenant)) && (
                  <button
                    type="button"
                    onClick={() => handleOpenInvoice(selectedSaleDetail)}
                    style={{
                      padding: '9px 18px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-card)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <FileText size={15} style={{ color: 'var(--primary)' }} />
                    <span>A4 Faktura chop etish</span>
                  </button>
                )}

              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 'auto' }}>
                {selectedSaleDetail.public_token && (
                  <button
                    type="button"
                    onClick={handleRotateReceiptToken}
                    disabled={rotatingReceiptToken}
                    title="Mavjud elektron chek havolasini bekor qilib, yangisini yaratadi"
                    style={{
                      padding: '9px 14px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                      background: 'transparent',
                      color: 'var(--text-secondary)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: rotatingReceiptToken ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {rotatingReceiptToken ? <IlbiLoader size={21} inline decorative /> : <RotateCcw size={13} />}
                    {rotatingReceiptToken ? 'Yangilanmoqda…' : 'Havolani yangilash'}
                  </button>
                )}
                {['completed', 'partially_voided'].includes((selectedSaleDetail.status || '').toLowerCase()) && (
                  <button
                    type="button"
                    onClick={() => handleOpenVoid(selectedSaleDetail.id)}
                    style={{
                      padding: '9px 16px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(var(--danger-rgb), 0.3)',
                      background: 'rgba(var(--danger-rgb), 0.1)',
                      color: 'var(--accent-rose)',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Butun Chekni Bekor Qilish
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDetailModalOpen(false)}
                  style={{
                    padding: '9px 18px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Yopish
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Modal 2: Void Entire Sale */}
      <Modal isOpen={voidModalOpen} onClose={() => setVoidModalOpen(false)} title={`Chekni Bekor Qilish (#${selectedSaleId})`}>
        <form onSubmit={handleConfirmVoid} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(var(--danger-rgb), 0.1)',
              border: '1px solid rgba(var(--danger-rgb), 0.2)',
              color: 'var(--accent-rose)',
              fontSize: 13,
            }}
          >
            <AlertTriangle size={20} style={{ flexShrink: 0 }} />
            <span>
              Diqqat! Chek butunlay bekor qilinadi. Barcha tovarlar omborga qaytariladi va kassa tushumidan ayirib tashlanadi.
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Bekor qilish sababi (majburiy) *
            </label>
            <textarea
              rows={3}
              placeholder="Masalan: Xaridor to‘lov qilmadi yoki tovar qaytarildi..."
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
                resize: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setVoidModalOpen(false)}
              style={{
                padding: '10px 18px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Orqaga
            </button>
            <button
              type="submit"
              disabled={submittingVoid}
              style={{
                padding: '10px 20px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: 'var(--accent-rose)',
                color: 'var(--on-danger)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {submittingVoid ? 'Bekor qilinmoqda...' : 'Bekor Qilishni Tasdiqlash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 3: Void Item in Sale */}
      <Modal isOpen={voidItemModalOpen} onClose={() => setVoidItemModalOpen(false)} title="Pozitsiyani Bekor Qilish">
        <form onSubmit={handleConfirmVoidItem} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {selectedItemToVoid && (
            <div style={{ padding: 12, borderRadius: 'var(--radius-sm)', background: 'var(--bg-app)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{selectedItemToVoid.product_name}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                Mavjud miqdor: {selectedItemToVoid.quantity - (selectedItemToVoid.voided_quantity || 0)} dona · Narxi: {Number(selectedItemToVoid.unit_price).toLocaleString()} UZS
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Qaytariladigan Miqdor *
            </label>
            <input
              type="number"
              step="any"
              min="0.001"
              max={selectedItemToVoid ? selectedItemToVoid.quantity - (selectedItemToVoid.voided_quantity || 0) : 1}
              value={voidItemQuantity}
              onChange={(e) => setVoidItemQuantity(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px 14px',
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
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Bekor qilish sababi *
            </label>
            <textarea
              rows={3}
              placeholder="Masalan: Nuqsonli tovar, xaridor xohlamadi..."
              value={voidItemReason}
              onChange={(e) => setVoidItemReason(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 14,
                outline: 'none',
                resize: 'none',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setVoidItemModalOpen(false)}
              style={{
                padding: '10px 18px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Orqaga
            </button>
            <button
              type="submit"
              disabled={submittingItemVoid}
              style={{
                padding: '10px 20px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: 'var(--accent-rose)',
                color: 'var(--on-danger)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {submittingItemVoid ? 'Bekor qilinmoqda...' : 'Pozitsiyani Bekor Qilish'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Official A4 Invoice Modal */}
      <InvoiceA4Modal
        isOpen={invoiceModalOpen}
        onClose={() => setInvoiceModalOpen(false)}
        sale={selectedInvoiceSale}
      />
    </div>
  );
}
