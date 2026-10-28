import { useWorkspaceAction } from '../hooks/useWorkspaceAction';
import IlbiLoader from '../components/common/IlbiLoader';
import { useDebouncedValue, usePaginatedList } from '../hooks/usePaginatedList';
import Pagination from '../components/common/Pagination';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CreditCard,
  Search,
  UserPlus,
  Building,
  History,
  RotateCcw,
  Sparkles,
  ShoppingBag,
  Receipt,
  Clock,
  FileText,
  Upload,
} from 'lucide-react';
import { salesApi } from '../api/client';
import Modal from '../components/common/Modal';
import ExcelExportButton from '../components/common/ExcelExportButton';
import CounterpartyImportModal from '../components/common/CounterpartyImportModal';
import InvoiceA4Modal from '../components/common/InvoiceA4Modal';
import CustomSelect from '../components/common/CustomSelect';
import PriceInput from '../components/common/PriceInput';
import PhoneInput from '../components/common/PhoneInput';
import DebtDueDateField from '../components/common/DebtDueDateField';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { useTenant } from '../context/TenantContext';
import { useTenantCurrency } from '../hooks/useTenantCurrency';
import { showFormErrors } from '../utils/formValidation.js';

export default function Debts() {
  const { activeTenant, tenants } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();
  const canManageCp = activeTenant?.is_owner || activeTenant?.permissions?.includes("sales.manage_counterparty");
  const canCorrectDebt = activeTenant?.is_owner === true;
  const [editingCp, setEditingCp] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const [counterpartyFilter, setCounterpartyFilter] = useState('all'); // 'all' | 'debtors' | 'credit' | 'settled'
  const [counterpartySearch, setCounterpartySearch] = useState('');

  // New Counterparty Modal
  const [newCpModalOpen, setNewCpModalOpen] = useState(false);
  const [newCpName, setNewCpName] = useState('');
  const [newCpPhone, setNewCpPhone] = useState('');
  const [newCpNote, setNewCpNote] = useState('');
  const [newCpDueDate, setNewCpDueDate] = useState('');
  const [newCpCode, setNewCpCode] = useState('');
  const [submittingCp, setSubmittingCp] = useState(false);

  // Record Debt Payment Modal
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [selectedCp, setSelectedCp] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentCurrency, setPaymentCurrency] = useState('UZS');
  const [paymentBranchId, setPaymentBranchId] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [paymentType, setPaymentType] = useState('cash');
  const [paymentRequestKey, setPaymentRequestKey] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const { settings: paymentSettings } = useTenantCurrency(debtModalOpen && paymentCurrency === 'USD' ? paymentBranchId : null);
  const paymentUsdRate = Number(paymentSettings?.usd_rate || 0);
  const remainingPaymentUsd = Math.max(0, (Number(paymentAmount) || 0) - Math.max(0, Number(selectedCp?.debt_balance_usd) || 0));

  // Refund Customer Credit Modal
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundCurrency, setRefundCurrency] = useState('UZS');
  const [refundBranchId, setRefundBranchId] = useState('');
  const [refundNote, setRefundNote] = useState('');
  const [refundType, setRefundType] = useState('cash');
  const [refundRequestKey, setRefundRequestKey] = useState('');
  const [submittingRefund, setSubmittingRefund] = useState(false);

  // Customer Purchases & Debts Detail Modal
  const [cpDetailModalOpen, setCpDetailModalOpen] = useState(false);
  const [selectedCpDetail, setSelectedCpDetail] = useState(null);
  const [cpDetailTab, setCpDetailTab] = useState('debt_sales'); // 'debt_sales' | 'all_sales' | 'payments'
  // Invoice A4 Modal
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [selectedInvoiceSale, setSelectedInvoiceSale] = useState(null);

  const search = useDebouncedValue(counterpartySearch.trim());
  const listParams = { search, balance_status: counterpartyFilter };
  const list = usePaginatedList(salesApi.getCounterparties, listParams, { tenantId: activeTenant?.id });
  const counterparties = list.items;
  const loading = list.loading;
  const loadCounterparties = list.refresh;
  const fetchDetailSales = useCallback((params, options) => salesApi.getCounterpartySales(selectedCpDetail?.id, params, options), [selectedCpDetail?.id]);
  const fetchDetailPayments = useCallback((params, options) => salesApi.getCounterpartyPayments(selectedCpDetail?.id, params, options), [selectedCpDetail?.id]);
  const detailSales = usePaginatedList(fetchDetailSales,
    { counterparty_id: selectedCpDetail?.id, payment_type: cpDetailTab === 'debt_sales' ? 'debt' : '' },
    { tenantId: activeTenant?.id, enabled: cpDetailModalOpen && Boolean(selectedCpDetail) });
  const detailPayments = usePaginatedList(fetchDetailPayments, { counterparty_id: selectedCpDetail?.id },
    { tenantId: activeTenant?.id, enabled: cpDetailModalOpen && cpDetailTab === 'payments' && Boolean(selectedCpDetail) });
  const cpDetailSales = detailSales.items;
  const cpDetailPayments = detailPayments.items;
  const loadingCpDetailSales = detailSales.loading;
  const loadingCpDetailPayments = detailPayments.loading;
  const cpSalesSummary = detailSales.summary || {};
  useEffect(() => {
    const error = list.error || detailSales.error || detailPayments.error;
    if (error) toast.error(error.message);
  }, [list.error, detailSales.error, detailPayments.error, toast]);

  // Create Counterparty
  const handleCreateCounterparty = async (e) => {
    e.preventDefault();
    if (!newCpName.trim()) {
      toast.warning('Kontragent nomini kiriting');
      return;
    }
    setSubmittingCp(true);
    try {
      const data = {
        name: newCpName.trim(),
        phone_number: newCpPhone.trim(),
        target_tenant_code: newCpCode.trim(),
        note: newCpNote.trim(),
        debt_due_date: newCpDueDate || null,
      };
      if (editingCp) await salesApi.updateCounterparty(editingCp.id, { name: data.name, note: data.note, debt_due_date: data.debt_due_date });
      else await salesApi.createCounterparty(data);
      toast.success('Kontragent saqlandi');
      window.dispatchEvent(new CustomEvent('refresh_notifications'));
      setEditingCp(null);
      setNewCpCode('');
      setNewCpModalOpen(false);
      setNewCpName('');
      setNewCpPhone('');
      setNewCpNote('');
      setNewCpDueDate('');
      loadCounterparties();
    } catch (err) {
      toast.error(err.message || 'Kontragent yaratishda xatolik');
    } finally {
      setSubmittingCp(false);
    }
  };

  // Open Counterparty Purchases & Debts Detail Modal
  const handleOpenCounterpartyPurchases = (cp, initialTab = 'debt_sales') => {
    setSelectedCpDetail(cp);
    setCpDetailTab(initialTab);
    setCpDetailModalOpen(true);
    detailSales.refresh();
    detailPayments.refresh();
  };

  // Record Debt Payment
  const handleOpenDebtPayment = (cp) => {
    setSelectedCp(cp);
    setPaymentAmount('');
    setPaymentCurrency('UZS');
    setPaymentBranchId(String(activeTenant?.id || (tenants.length > 0 ? tenants[0]?.id : '')));
    setPaymentNote('');
    setPaymentType('cash');
    setPaymentRequestKey(crypto.randomUUID());
    setDebtModalOpen(true);
  };

  useWorkspaceAction(({ action, search, id, signal }) => {
    if (search !== null) { setCounterpartySearch(search); setCounterpartyFilter('all'); }
    if (action === 'new_customer' && canManageCp) {
      setEditingCp(null); setNewCpName(''); setNewCpPhone(''); setNewCpNote(''); setNewCpDueDate(''); setNewCpCode(''); setNewCpModalOpen(true);
    }
    if (action === 'import' && canManageCp) setImportModalOpen(true);
    if (id) salesApi.getCounterparty(id, { signal }).then(cp => {
      if (signal.aborted) return;
      if (action === 'debt_payment') handleOpenDebtPayment(cp);
      else handleOpenCounterpartyPurchases(cp);
    }).catch(error => { if (!signal.aborted) toast.error(error.message); });
  });

  const handleConfirmDebtPayment = async (e) => {
    e.preventDefault();
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      showFormErrors(e.currentTarget, { amount: 'To‘lov summasi noldan katta bo‘lishi kerak.' });
      toast.warning('To‘lov summasini kiriting');
      return;
    }
    setSubmittingPayment(true);
    try {
      await salesApi.recordDebtPayment(selectedCp.id, {
        amount: parseFloat(paymentAmount),
        currency: paymentCurrency,
        payment_type: paymentType, idempotency_key: paymentRequestKey,
        branch_id: paymentBranchId ? parseInt(paymentBranchId, 10) : undefined,
        note: paymentNote,
      });
      toast.success('Qarz to‘lovi muvaffaqiyatli qabul qilindi!');
      setDebtModalOpen(false);
      loadCounterparties();
      if (cpDetailModalOpen && selectedCpDetail && selectedCpDetail.id === selectedCp.id) {
        handleOpenCounterpartyPurchases(selectedCp, cpDetailTab);
      }
    } catch (err) {
      toast.error(err.message || 'To‘lovni qabul qilishda xatolik');
    } finally {
      setSubmittingPayment(false);
    }
  };

  // Refund / Settle Customer Credit
  const handleOpenRefundCredit = (cp) => {
    if (!canCorrectDebt) { toast.warning('Mijoz haqqini qaytarish uchun do‘kon egasi vakolati kerak.'); return; }
    setSelectedCp(cp);
    const creditUzs = Math.max(0, -Number(cp.debt_balance_uzs || 0));
    const creditUsd = Math.max(0, -Number(cp.debt_balance_usd || 0));
    if (creditUzs > 0) {
      setRefundAmount(creditUzs.toString());
      setRefundCurrency('UZS');
    } else if (creditUsd > 0) {
      setRefundAmount(creditUsd.toString());
      setRefundCurrency('USD');
    } else {
      setRefundAmount('');
      setRefundCurrency('UZS');
    }
    setRefundBranchId(String(activeTenant?.id || (tenants.length > 0 ? tenants[0]?.id : '')));
    setRefundType('cash');
    setRefundRequestKey(crypto.randomUUID());
    setRefundNote('Mijozga ortiqcha to‘langan haq qaytarildi');
    setRefundModalOpen(true);
  };

  const handleConfirmRefundCredit = async (e) => {
    e.preventDefault();
    if (!canCorrectDebt) { toast.warning('Mijoz haqqini qaytarish uchun do‘kon egasi vakolati kerak.'); return; }
    const amt = parseFloat(refundAmount);
    if (!amt || amt <= 0) {
      showFormErrors(e.currentTarget, { amount: 'Qaytariladigan summa noldan katta bo‘lishi kerak.' });
      toast.warning('Qaytariladigan summani kiriting');
      return;
    }
    setSubmittingRefund(true);
    try {
      await salesApi.correctDebtPayment(selectedCp.id, {
        amount: -amt,
        currency: refundCurrency,
        payment_type: refundType, idempotency_key: refundRequestKey,
        branch_id: refundBranchId ? parseInt(refundBranchId, 10) : undefined,
        note: refundNote || 'Mijozga ortiqcha to‘langan haq qaytarildi',
      });
      toast.success('Mijoz haqqi muvaffaqiyatli qaytarildi! Balans tozalandi.');
      setRefundModalOpen(false);
      loadCounterparties();
      if (cpDetailModalOpen && selectedCpDetail && selectedCpDetail.id === selectedCp.id) {
        setSelectedCpDetail((prev) => {
          if (!prev) return null;
          if (refundCurrency === 'UZS') {
            return { ...prev, debt_balance_uzs: Number(prev.debt_balance_uzs || 0) + amt };
          }
          return { ...prev, debt_balance_usd: Number(prev.debt_balance_usd || 0) + amt };
        });
        handleOpenCounterpartyPurchases(selectedCp, cpDetailTab);
      }
    } catch (err) {
      toast.error(err.message || 'Haqni qaytarishda xatolik yuz berdi');
    } finally {
      setSubmittingRefund(false);
    }
  };

  const handleOpenInvoice = (sale) => {
    setSelectedInvoiceSale(sale);
    setInvoiceModalOpen(true);
  };

  const summary = list.summary || {};
  const totalDebtUzs = Number(summary.total_debt_uzs || 0);
  const totalDebtUsd = Number(summary.total_debt_usd || 0);
  const totalCreditUzs = Number(summary.total_credit_uzs || 0);
  const debtorsCount = summary.debtors_count || 0;
  const creditCount = summary.credit_count || 0;
  const settledCount = summary.settled_count || 0;
  const filteredCounterparties = counterparties;

  // Branch Options for Select
  const branchOptions = useMemo(() => {
    if (!Array.isArray(tenants) || tenants.length === 0) {
      if (activeTenant) {
        return [{ value: String(activeTenant.id), label: activeTenant.name || 'Asosiy filial' }];
      }
      return [{ value: '', label: 'Asosiy filial' }];
    }
    return tenants.map((t) => ({
      value: String(t.id),
      label: `${t.name}${String(t.id) === String(activeTenant?.id) ? ' (Joriy faol)' : ''}`,
    }));
  }, [tenants, activeTenant]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
        <div className="glass-card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Jami Nasiya (UZS)
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: totalDebtUzs > 0 ? 'var(--accent-rose)' : 'var(--text-primary)', marginTop: 4 }}>
            {totalDebtUzs.toLocaleString()} UZS
          </div>
          <div style={{ fontSize: 12, color: totalDebtUzs > 0 ? 'var(--accent-rose)' : 'var(--accent-amber)', marginTop: 4, fontWeight: 600 }}>
            {debtorsCount} nafar qarzdor mijoz
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Jami Nasiya (USD)
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
            ${totalDebtUsd.toFixed(2)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Valyuta hisobidagi qarzlar
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Mijoz Haqqi (Ortiqcha to‘lov)
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-emerald)', marginTop: 4 }}>
            +{totalCreditUzs.toLocaleString()} UZS
          </div>
          <div style={{ fontSize: 12, color: 'var(--accent-emerald)', marginTop: 4, fontWeight: 600 }}>
            {creditCount} nafar mijoz haqqi bor
          </div>
        </div>

        <div className="glass-card" style={{ padding: '16px 20px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Hisobi Tozalar
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-secondary)', marginTop: 4 }}>
            {settledCount} nafar
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Qarzsiz va to‘liq to‘langan
          </div>
        </div>
      </div>

      {/* Control & Search Bar */}
      <div
        className="glass-card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        {/* Filter chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setCounterpartyFilter('all')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              background: counterpartyFilter === 'all' ? 'var(--primary)' : 'var(--bg-chip)',
              color: counterpartyFilter === 'all' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Barchasi ({summary.total_count || 0})
          </button>
          <button
            type="button"
            onClick={() => setCounterpartyFilter('debtors')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              background: counterpartyFilter === 'debtors' ? 'var(--primary)' : 'var(--bg-chip)',
              color: counterpartyFilter === 'debtors' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Qarzdorlar ({debtorsCount})
          </button>
          <button
            type="button"
            onClick={() => setCounterpartyFilter('credit')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              background: counterpartyFilter === 'credit' ? 'var(--accent-emerald)' : 'var(--bg-chip)',
              color: counterpartyFilter === 'credit' ? 'var(--on-success)' : 'var(--text-secondary)',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Haqqi Borlar ({creditCount})
          </button>
          <button
            type="button"
            onClick={() => setCounterpartyFilter('settled')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              background: counterpartyFilter === 'settled' ? 'var(--primary)' : 'var(--bg-chip)',
              color: counterpartyFilter === 'settled' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Hisob Toza ({settledCount})
          </button>
        </div>

        {/* Right side: Search + Add */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', width: 260 }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Mijoz nomi yoki telefoni..."
              value={counterpartySearch}
              onChange={(e) => setCounterpartySearch(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 34px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 13,
                outline: 'none',
              }}
            />
          </div>

          <ExcelExportButton endpoint="/sales/counterparties/export/" params={listParams} filename="ilbi-qarzlar.xlsx" disabled={loading} />
          {canManageCp && <button type="button" className="btn btn-secondary" onClick={() => setImportModalOpen(true)}>
            <Upload size={15} /> <span>Fayldan yuklash</span>
          </button>}
          <button
            type="button"
            onClick={() => { setEditingCp(null); setNewCpName(''); setNewCpPhone(''); setNewCpNote(''); setNewCpDueDate(''); setNewCpCode(''); setNewCpModalOpen(true); }}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-xs)',
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
            <UserPlus size={15} />
            <span>Yangi Kontragent</span>
          </button>
        </div>
      </div>

      {importModalOpen && <CounterpartyImportModal key={activeTenant?.id}
        onClose={() => setImportModalOpen(false)} onSuccess={loadCounterparties} />}

      {/* Counterparties Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-responsive">
          <table style={{ width: '100%', minWidth: 840, borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-muted)',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <th style={{ padding: '14px 20px', whiteSpace: 'nowrap' }}>Mijoz / Hamkor Nomi</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Telefon Raqami</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>B2B Do‘kon Bog‘lanmasi</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Nasiya Qarz (UZS)</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Nasiya Qarz (USD)</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Oxirgi To‘lov</th>
                <th style={{ padding: '14px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    <IlbiLoader label="Yuklanmoqda..." />
                  </td>
                </tr>
              ) : filteredCounterparties.length > 0 ? (
                filteredCounterparties.map((cp) => {
                  const debtUzs = Number(cp.debt_balance_uzs || 0);
                  const debtUsd = Number(cp.debt_balance_usd || 0);
                  const hasDebt = debtUzs > 0 || debtUsd > 0;
                  const hasCredit = debtUzs < 0 || debtUsd < 0;
                  const isSettled = debtUzs === 0 && debtUsd === 0;

                  return (
                    <tr
                      key={cp.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        background: hasCredit ? 'rgba(21, 128, 61, 0.04)' : undefined,
                      }}
                    >
                      {/* Name */}
                      <td
                        onClick={() => handleOpenCounterpartyPurchases(cp, 'debt_sales')}
                        style={{
                          padding: '14px 20px',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                        }}
                        title="Nasiya va xaridlar tafsilotini ko‘rish uchun bosing"
                      >
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--primary)', borderBottom: '1px dashed var(--primary)' }}>
                            {cp.name}
                          </span>
                          {hasDebt && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: 4,
                                background: 'rgba(var(--danger-rgb), 0.12)',
                                color: 'var(--accent-rose)',
                                border: '1px solid rgba(var(--danger-rgb), 0.25)',
                              }}
                            >
                              Qarzdor
                            </span>
                          )}
                          {hasCredit && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: 4,
                                background: 'rgba(21, 128, 61, 0.14)',
                                color: '#15803d',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <Sparkles size={11} /> Haqqi bor
                            </span>
                          )}
                          {isSettled && (
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'var(--bg-chip)',
                                color: 'var(--text-muted)',
                              }}
                            >
                              Hisob toza
                            </span>
                          )}
                        </div>
                        {cp.note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{cp.note}</div>}
                        {cp.debt_due_date && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                          <Clock size={12} /> Qaytarish: {cp.debt_due_date.split('-').reverse().join('.')}
                        </div>}
                      </td>

                      {/* Phone */}
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                        {cp.phone_number || '—'}
                      </td>

                      {/* B2B target */}
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                        {cp.target_tenant_name ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'var(--primary-light)',
                              color: 'var(--primary)',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            <Building size={12} /> {cp.target_tenant_name}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      {/* Debt UZS */}
                      <td style={{ padding: '14px 16px' }}>
                        {debtUzs > 0 ? (
                          <div>
                            <div style={{ fontWeight: 800, color: 'var(--accent-rose)', fontSize: 13.5 }}>
                              {debtUzs.toLocaleString()} UZS
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--accent-rose)', opacity: 0.85, fontWeight: 600 }}>Mijoz qarzi</div>
                          </div>
                        ) : debtUzs < 0 ? (
                          <div>
                            <div style={{ fontWeight: 800, color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              +{Math.abs(debtUzs).toLocaleString()} UZS
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--accent-emerald)', fontWeight: 600 }}>Mijoz haqqi bor</div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>0 UZS</span>
                        )}
                      </td>

                      {/* Debt USD */}
                      <td style={{ padding: '14px 16px' }}>
                        {debtUsd > 0 ? (
                          <div>
                            <div style={{ fontWeight: 800, color: 'var(--accent-rose)', fontSize: 13.5 }}>
                              ${debtUsd.toFixed(2)}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--accent-rose)', opacity: 0.85, fontWeight: 600 }}>Mijoz qarzi</div>
                          </div>
                        ) : debtUsd < 0 ? (
                          <div>
                            <div style={{ fontWeight: 800, color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: 4 }}>
                              +${Math.abs(debtUsd).toFixed(2)}
                            </div>
                            <div style={{ fontSize: 10.5, color: 'var(--accent-emerald)', fontWeight: 600 }}>Mijoz haqqi bor</div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>$0.00</span>
                        )}
                      </td>

                      {/* Last Payment */}
                      <td style={{ padding: '14px 16px', minWidth: 170 }}>
                        {cp.last_payment ? (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 800, color: 'var(--accent-emerald)', fontSize: 13.5 }}>
                                {cp.last_payment.is_correction ? 'Tuzatish: ' : '+'}{Number(cp.last_payment.amount).toLocaleString()} {cp.last_payment.currency}
                              </span>
                              {cp.last_payment.currency === 'USD' && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    background: 'rgba(59, 130, 246, 0.12)',
                                    color: 'var(--primary)',
                                    border: '1px solid rgba(59, 130, 246, 0.25)',
                                  }}
                                >
                                  Valyuta
                                </span>
                              )}
                            </div>

                            {/* Show conversion note / note */}
                            {cp.last_payment.note ? (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: 'var(--text-secondary)',
                                  marginTop: 3,
                                  lineHeight: 1.35,
                                  maxWidth: 260,
                                  whiteSpace: 'normal',
                                  background: 'var(--bg-card)',
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  border: '1px dashed var(--border-subtle)',
                                }}
                                title={cp.last_payment.note}
                              >
                                {cp.last_payment.note}
                              </div>
                            ) : cp.last_payment.exchange_rate != null && cp.last_payment.converted_amount_uzs != null ? (
                              <div
                                style={{
                                  fontSize: 10.5,
                                  color: 'var(--text-muted)',
                                  marginTop: 3,
                                  fontStyle: 'italic',
                                }}
                              >
                                (Kurs: 1 USD = {Number(cp.last_payment.exchange_rate).toLocaleString()} UZS → {Number(cp.last_payment.converted_amount_uzs).toLocaleString()} UZS so‘m qarzidan ayirildi)
                              </div>
                            ) : null}

                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Clock size={10} />
                              <span>{new Date(cp.last_payment.paid_at).toLocaleString('uz-UZ', { dateStyle: 'short', timeStyle: 'short' })}</span>
                              {cp.last_payment.branch_name && (
                                <span style={{ color: 'var(--primary)', fontWeight: 600 }}>
                                  · {cp.last_payment.branch_name}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>To‘lov yo‘q</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          {canManageCp && <>
                            <button className="btn btn-secondary" onClick={() => {
                              setEditingCp(cp); setNewCpName(cp.name); setNewCpPhone(cp.phone_number); setNewCpNote(cp.note || ''); setNewCpDueDate(cp.debt_due_date || ''); setNewCpModalOpen(true);
                            }}>Tahrirlash</button>
                            {isSettled && <button className="btn btn-secondary" onClick={async () => {
                              if (!await confirm({ title: 'Kontragentni arxivlash', message: `${cp.name} arxivlansinmi? Xarid va to‘lov tarixi saqlanadi.`, confirmText: 'Arxivlash', cancelText: 'Bekor qilish' })) return;
                              try { await salesApi.deleteCounterparty(cp.id); await loadCounterparties(); toast.success('Kontragent arxivlandi'); }
                              catch (error) { toast.error(error.message); }
                            }}>Arxivlash</button>}
                          </>}
                          <button
                            type="button"
                            onClick={() => handleOpenCounterpartyPurchases(cp, 'debt_sales')}
                            style={{
                              padding: '6px 11px',
                              borderRadius: 'var(--radius-xs)',
                              border: '1px solid var(--border-card)',
                              background: 'var(--bg-card)',
                              color: 'var(--text-primary)',
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                            title="Nasiya tovarlari va xaridlar tarixi"
                          >
                            <ShoppingBag size={13} color="var(--accent-amber)" />
                            <span>Xaridlar</span>
                          </button>

                          {hasDebt ? (
                            <button
                              type="button"
                              onClick={() => handleOpenDebtPayment(cp)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: 'var(--radius-xs)',
                                border: 'none',
                                background: 'var(--primary)',
                                color: 'var(--primary-foreground)',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <CreditCard size={13} />
                              <span>Qarz To‘lash</span>
                            </button>
                          ) : hasCredit && canCorrectDebt ? (
                            <button
                              type="button"
                              onClick={() => handleOpenRefundCredit(cp)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: 'var(--radius-xs)',
                                border: 'none',
                                background: '#15803d',
                                color: '#ffffff',
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                              }}
                              title="Mijozga ortiqcha haqini qaytarish / hisobni tozalash"
                            >
                              <RotateCcw size={13} />
                              <span>Haqni Qaytarish</span>
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    Kontragentlar topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal 1: Create Counterparty */}
      <Pagination currentPage={list.page} totalItems={list.total} onPageChange={list.setPage} />
      <Modal isOpen={newCpModalOpen} onClose={() => setNewCpModalOpen(false)} title={editingCp ? "Kontragentni tahrirlash" : "Yangi Mijoz / Kontragent Qo‘shish"}>
        <form onSubmit={handleCreateCounterparty} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Mijoz / Do‘kon Nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="Masalan: Sardor aka yoki Smartfon Savdo MCHJ"
              data-api-field="name" value={newCpName}
              onChange={(e) => setNewCpName(e.target.value)}
              required
              className="input-field"
            />
          </div>

          {!editingCp && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  B2B Hamkor Do‘kon Kodi
                </label>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(ixtiyoriy)</span>
              </div>
              <input
                type="text"
                className="input-field"
                data-api-field="target_tenant_code" value={newCpCode}
                maxLength={12}
                onChange={(event) => setNewCpCode(event.target.value.toUpperCase())}
                placeholder="Hamkor bergan public kod (masalan: T-ABCD12)"
              />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                B2B hamkor bilan tovar va hisob-kitoblarni sinxronlashtirish uchun uning public kodini kiriting
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Telefon Raqami
            </label>
            <PhoneInput
              placeholder="+998 90 123 45 67"
              disabled={Boolean(editingCp)}
              data-api-field="phone_number" value={newCpPhone}
              onChange={(e) => setNewCpPhone(e.target.value)}
              className="input-field"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Qo‘shimcha Izoh
            </label>
            <input
              type="text"
              placeholder="Masalan: Doimiy ulgurji hamkor, Abu Saxiy 3-qator"
              data-api-field="note" value={newCpNote}
              onChange={(e) => setNewCpNote(e.target.value)}
              className="input-field"
            />
          </div>

          <DebtDueDateField value={newCpDueDate} onChange={setNewCpDueDate} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setNewCpModalOpen(false)}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submittingCp}
            >
              {submittingCp ? 'Saqlanmoqda...' : 'Saqlash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 2: Record Debt Payment */}
      <Modal isOpen={debtModalOpen} onClose={() => setDebtModalOpen(false)} title={`Qarz To‘lovini Qabul Qilish (${selectedCp?.name})`}>
        <form onSubmit={handleConfirmDebtPayment} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Last payment info banner */}
          {selectedCp?.last_payment ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <History size={13} />
                <span>Oxirgi To‘lov Ma’lumoti</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-emerald)' }}>
                  {selectedCp.last_payment.is_correction ? 'Tuzatish: ' : '+'}{Number(selectedCp.last_payment.amount).toLocaleString()} {selectedCp.last_payment.currency}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {new Date(selectedCp.last_payment.paid_at).toLocaleString('uz-UZ')}
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 2 }}>
                {selectedCp.last_payment.branch_name && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Building size={11} /> Filial: <strong style={{ color: 'var(--text-primary)' }}>{selectedCp.last_payment.branch_name}</strong>
                  </span>
                )}
                {selectedCp.last_payment.recorded_by_name && (
                  <span>Qabul qildi: <strong>{selectedCp.last_payment.recorded_by_name}</strong></span>
                )}
                {selectedCp.last_payment.note && (
                  <div style={{ width: '100%', fontSize: 11.5, color: 'var(--text-primary)', background: 'var(--bg-card)', padding: '5px 8px', borderRadius: 4, marginTop: 4, border: '1px dashed var(--border-subtle)' }}>
                    💬 <strong>Hisobot / Izoh:</strong> {selectedCp.last_payment.note}
                  </div>
                )}
                {selectedCp.last_payment.exchange_rate != null && selectedCp.last_payment.converted_amount_uzs != null && !selectedCp.last_payment.note?.includes('Kurs:') && (
                  <div style={{ width: '100%', fontSize: 11.5, color: 'var(--primary)', background: 'rgba(59, 130, 246, 0.08)', padding: '5px 8px', borderRadius: 4, marginTop: 4 }}>
                    💱 <strong>Valyuta hisobi:</strong> (Kurs: 1 USD = {Number(selectedCp.last_payment.exchange_rate).toLocaleString()} UZS → {Number(selectedCp.last_payment.converted_amount_uzs).toLocaleString()} UZS so‘m qarzidan ayirilgan)
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-card)',
                border: '1px dashed var(--border-subtle)',
                fontSize: 12,
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <History size={13} />
              <span>Ushbu mijoz bo‘yicha avval to‘lovlar amalga oshirilmagan</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                To‘lov Summasi <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <PriceInput
                placeholder="Masalan: 500 000"
                data-api-field="amount" value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                required
                className="input-field"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Valyuta <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <CustomSelect
                data-api-field="currency" value={paymentCurrency}
                onChange={(val) => setPaymentCurrency(val)}
                options={[
                  { value: 'UZS', label: 'UZS (So‘m)' },
                  { value: 'USD', label: 'USD (Dollar)' },
                ]}
                fullWidth
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                To‘lov Turi <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <CustomSelect
                data-api-field="payment_type" value={paymentType}
                onChange={setPaymentType}
                options={[
                  { value: 'cash', label: 'Naqd pul' },
                  { value: 'card', label: 'Bank karta' },
                ]}
                fullWidth
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Qaysi Filialga *
              </label>
              <CustomSelect
                data-api-field="branch_id" value={paymentBranchId}
                onChange={(val) => setPaymentBranchId(val)}
                options={branchOptions}
                fullWidth
              />
            </div>
          </div>

          {paymentCurrency === 'USD' && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--radius-xs)',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                fontSize: 12.5,
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span>💱</span>
                <span>
                  Do‘kon kursi (1 USD = <strong>{paymentUsdRate > 0 ? paymentUsdRate.toLocaleString() : '—'} UZS</strong>)
                </span>
              </span>
              <span style={{ fontWeight: 800, color: 'var(--accent-rose)' }}>
                {paymentUsdRate > 0
                  ? `~${(remainingPaymentUsd * paymentUsdRate).toLocaleString()} UZS so‘m qarzidan ayiriladi`
                  : 'Kursni olishning imkoni bo‘lmadi. Qayta urinib ko‘ring.'}
              </span>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Izoh / Kassa kvitansiyasi
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Masalan: Kassa orqali naqd berildi"
              data-api-field="note" value={paymentNote}
              onChange={(e) => setPaymentNote(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setDebtModalOpen(false)}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submittingPayment}
            >
              {submittingPayment ? 'Qabul qilinmoqda...' : 'To‘lovni Saqlash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 3: Refund Customer Credit */}
      <Modal
        isOpen={refundModalOpen}
        onClose={() => setRefundModalOpen(false)}
        title={`Mijoz Haqqini Qaytarish — ${selectedCp?.name || ''}`}
        maxWidth={480}
      >
        <form onSubmit={handleConfirmRefundCredit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(var(--success-rgb), 0.08)',
              border: '1px solid rgba(var(--success-rgb), 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={16} />
              <span>Bizda Qolgan Ortiqcha Haq</span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
              {Math.max(0, -Number(selectedCp?.debt_balance_uzs || 0)) > 0 &&
                `+${Math.max(0, -Number(selectedCp?.debt_balance_uzs || 0)).toLocaleString()} UZS `}
              {Math.max(0, -Number(selectedCp?.debt_balance_usd || 0)) > 0 &&
                `+$${Math.max(0, -Number(selectedCp?.debt_balance_usd || 0)).toFixed(2)}`}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              Ushbu summa mijozga qaytarib berilgach, mijoz balansi 0 ga tenglashadi.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Qaytariladigan Summa <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <PriceInput
                data-api-field="amount" value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                required
                className="input-field"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Valyuta <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <CustomSelect
                data-api-field="currency" value={refundCurrency}
                onChange={(val) => setRefundCurrency(val)}
                options={[
                  { value: 'UZS', label: 'UZS (So‘m)' },
                  { value: 'USD', label: 'USD (Dollar)' },
                ]}
                fullWidth
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Qaytarish Turi <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <CustomSelect
                data-api-field="payment_type" value={refundType}
                onChange={setRefundType}
                options={[
                  { value: 'cash', label: 'Naqd pul' },
                  { value: 'card', label: 'Bank karta' },
                ]}
                fullWidth
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Qaysi Filialdan *
              </label>
              <CustomSelect
                data-api-field="branch_id" value={refundBranchId}
                onChange={(val) => setRefundBranchId(val)}
                options={branchOptions}
                fullWidth
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Izoh / Sababi <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="Masalan: Mijozga ortiqcha haq qaytarildi"
              data-api-field="note" value={refundNote}
              onChange={(e) => setRefundNote(e.target.value)}
              required
              className="input-field"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setRefundModalOpen(false)}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={submittingRefund}
              className="btn btn-success"
            >
              {submittingRefund ? 'Qaytarilmoqda...' : 'Haqni Qaytarish'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 4: Customer Purchases & Debt History */}
      <Modal
        isOpen={cpDetailModalOpen}
        onClose={() => setCpDetailModalOpen(false)}
        title={`Mijoz Nasiya & Xarid Tarixi — ${selectedCpDetail?.name || ''}`}
        maxWidth={900}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {selectedCpDetail?.debt_due_date && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>
            Qarzni qaytarish sanasi: <strong>{selectedCpDetail.debt_due_date.split('-').reverse().join('.')}</strong>
          </p>}
          {/* Summary Card */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 12,
              padding: 14,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-card)',
              border: '1px solid var(--border-card)',
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Mijoz Ma‘lumotlari
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                {selectedCpDetail?.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, fontFamily: 'monospace' }}>
                {selectedCpDetail?.phone_number || 'Telefon kiritilmagan'}
              </div>
              {selectedCpDetail?.note && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>
                  {selectedCpDetail.note}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 11, color: Number(selectedCpDetail?.debt_balance_uzs || 0) < 0 ? 'var(--accent-emerald)' : Number(selectedCpDetail?.debt_balance_uzs || 0) > 0 ? 'var(--accent-rose)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                {Number(selectedCpDetail?.debt_balance_uzs || 0) < 0 ? 'Mijoz Haqqi (UZS)' : 'Nasiya Qarzi (UZS)'}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: Number(selectedCpDetail?.debt_balance_uzs || 0) > 0 ? 'var(--accent-rose)' : Number(selectedCpDetail?.debt_balance_uzs || 0) < 0 ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                  marginTop: 3,
                }}
              >
                {Number(selectedCpDetail?.debt_balance_uzs || 0) < 0
                  ? `+${Math.abs(Number(selectedCpDetail?.debt_balance_uzs || 0)).toLocaleString()} UZS`
                  : `${Number(selectedCpDetail?.debt_balance_uzs || 0).toLocaleString()} UZS`}
              </div>
              <div style={{ fontSize: 11, color: Number(selectedCpDetail?.debt_balance_uzs || 0) < 0 ? 'var(--accent-emerald)' : Number(selectedCpDetail?.debt_balance_uzs || 0) > 0 ? 'var(--accent-rose)' : 'var(--text-muted)', marginTop: 2, fontWeight: Number(selectedCpDetail?.debt_balance_uzs || 0) !== 0 ? 600 : 400 }}>
                {Number(selectedCpDetail?.debt_balance_uzs || 0) < 0 ? 'Mijoz haqqi (ortiqcha to‘lov)' : Number(selectedCpDetail?.debt_balance_uzs || 0) > 0 ? 'Mijoz qarzi' : 'Joriy so‘m balansi'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: Number(selectedCpDetail?.debt_balance_usd || 0) < 0 ? 'var(--accent-emerald)' : Number(selectedCpDetail?.debt_balance_usd || 0) > 0 ? 'var(--accent-rose)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                {Number(selectedCpDetail?.debt_balance_usd || 0) < 0 ? 'Mijoz Haqqi (USD)' : 'Nasiya Qarzi (USD)'}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 800,
                  color: Number(selectedCpDetail?.debt_balance_usd || 0) > 0 ? 'var(--accent-rose)' : Number(selectedCpDetail?.debt_balance_usd || 0) < 0 ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                  marginTop: 3,
                }}
              >
                {Number(selectedCpDetail?.debt_balance_usd || 0) < 0
                  ? `+$${Math.abs(Number(selectedCpDetail?.debt_balance_usd || 0)).toFixed(2)}`
                  : `$${Number(selectedCpDetail?.debt_balance_usd || 0).toFixed(2)}`}
              </div>
              <div style={{ fontSize: 11, color: Number(selectedCpDetail?.debt_balance_usd || 0) < 0 ? 'var(--accent-emerald)' : Number(selectedCpDetail?.debt_balance_usd || 0) > 0 ? 'var(--accent-rose)' : 'var(--text-muted)', marginTop: 2, fontWeight: Number(selectedCpDetail?.debt_balance_usd || 0) !== 0 ? 600 : 400 }}>
                {Number(selectedCpDetail?.debt_balance_usd || 0) < 0 ? 'Mijoz haqqi (ortiqcha to‘lov)' : Number(selectedCpDetail?.debt_balance_usd || 0) > 0 ? 'Mijoz qarzi' : 'Joriy dollar balansi'}
              </div>
            </div>

            {/* Last payment stat card */}
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                Oxirgi To‘lov
              </div>
              {selectedCpDetail?.last_payment ? (
                <>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-emerald)', marginTop: 3 }}>
                    {selectedCpDetail.last_payment.is_correction ? 'Tuzatish: ' : '+'}{Number(selectedCpDetail.last_payment.amount).toLocaleString()} {selectedCpDetail.last_payment.currency}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {new Date(selectedCpDetail.last_payment.paid_at).toLocaleDateString('uz-UZ')}
                    {selectedCpDetail.last_payment.branch_name ? ` · ${selectedCpDetail.last_payment.branch_name}` : ''}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  To‘lov qilinmagan
                </div>
              )}
            </div>
          </div>

          {/* Action buttons inside header */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            {Number(selectedCpDetail?.debt_balance_uzs || 0) < 0 || Number(selectedCpDetail?.debt_balance_usd || 0) < 0 ? (
              <button
                type="button"
                onClick={() => handleOpenRefundCredit(selectedCpDetail)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: 'var(--accent-emerald)',
                  color: 'var(--on-success)',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Sparkles size={14} />
                <span>Haqni Qaytarish</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSelectedCp(selectedCpDetail);
                  setPaymentAmount('');
                  setPaymentCurrency('UZS');
                  setPaymentBranchId(String(activeTenant?.id || (tenants.length > 0 ? tenants[0]?.id : '')));
                  setPaymentNote('');
                  setDebtModalOpen(true);
                }}
                style={{
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-xs)',
                  border: 'none',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <CreditCard size={14} />
                <span>Qarz To‘lash</span>
              </button>
            )}
          </div>

          {/* Tab buttons */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              borderBottom: '1px solid var(--border-subtle)',
              paddingBottom: 8,
            }}
          >
            <button
              type="button"
              onClick={() => setCpDetailTab('debt_sales')}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: cpDetailTab === 'debt_sales' ? 'var(--primary)' : 'var(--bg-chip)',
                color: cpDetailTab === 'debt_sales' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ShoppingBag size={13} />
              <span>Nasiya Xaridlari</span>
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-full)',
                  background: cpDetailTab === 'debt_sales' ? 'rgba(255,255,255,0.25)' : 'var(--bg-card)',
                  fontSize: 11,
                }}
              >
                {cpSalesSummary.debt_sales_count}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCpDetailTab('all_sales')}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: cpDetailTab === 'all_sales' ? 'var(--primary)' : 'var(--bg-chip)',
                color: cpDetailTab === 'all_sales' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Receipt size={13} />
              <span>Barcha Xaridlar</span>
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-full)',
                  background: cpDetailTab === 'all_sales' ? 'rgba(255,255,255,0.25)' : 'var(--bg-card)',
                  fontSize: 11,
                }}
              >
                {cpSalesSummary.total_sales_count}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCpDetailTab('payments')}
              style={{
                padding: '7px 14px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: cpDetailTab === 'payments' ? 'var(--primary)' : 'var(--bg-chip)',
                color: cpDetailTab === 'payments' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <History size={13} />
              <span>To‘lovlar Tarixi</span>
              <span
                style={{
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-full)',
                  background: cpDetailTab === 'payments' ? 'rgba(255,255,255,0.25)' : 'var(--bg-card)',
                  fontSize: 11,
                }}
              >
                {cpSalesSummary.payments_count ?? detailPayments.total}
              </span>
            </button>
          </div>

          {/* Tab 1 & 2: Sales List */}
          {(cpDetailTab === 'debt_sales' || cpDetailTab === 'all_sales') && (
            <div>
              {loadingCpDetailSales ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Yuklanmoqda..." /></div>
              ) : cpDetailSales.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '52vh', overflowY: 'auto' }}>
                  {cpDetailSales
                    
                    .map((sale) => (
                      <div
                        key={sale.id}
                        style={{
                          padding: '12px 14px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                              #{sale.receipt_number}
                            </span>
                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                              {new Date(sale.created_at).toLocaleString('uz-UZ')}
                            </span>
                            {sale.payment_type === 'debt' && (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: 'rgba(var(--primary-rgb), 0.15)', color: 'var(--accent-amber)' }}>
                                Nasiya
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
                              {Number(sale.total_amount).toLocaleString()} {sale.currency}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleOpenInvoice(sale)}
                              style={{
                                padding: '5px 10px',
                                borderRadius: 'var(--radius-xs)',
                                border: '1px solid var(--border-card)',
                                background: 'var(--bg-card)',
                                color: 'var(--text-primary)',
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                            >
                              <FileText size={13} style={{ color: 'var(--primary)' }} />
                              <span>A4 Faktura</span>
                            </button>
                          </div>
                        </div>

                        {/* Items */}
                        <div className="table-responsive">
                          <table style={{ width: '100%', minWidth: 500, borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase' }}>
                                <th style={{ padding: '6px 8px' }}>Tovar</th>
                                <th style={{ padding: '6px 8px', textAlign: 'center' }}>Soni</th>
                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Narxi</th>
                                <th style={{ padding: '6px 8px', textAlign: 'right' }}>Jami</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(sale.items || []).map((it, idx) => (
                                <tr key={it.id || idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                  <td style={{ padding: '6px 8px', color: 'var(--text-primary)', fontWeight: 600 }}>
                                    {it.product_name || 'Tovar'}{it.product_variant_name ? ` (${it.product_variant_name})` : ''}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                    {Number(it.quantity)} {it.unit || 'dona'}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                                    {Number(it.unit_price).toLocaleString()} {sale.currency}
                                  </td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>
                                    {Number(it.total_price).toLocaleString()} {sale.currency}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Xaridlar topilmadi
                </div>
              )}
            </div>
          )}

          {(cpDetailTab === 'debt_sales' || cpDetailTab === 'all_sales') && <Pagination currentPage={detailSales.page} totalItems={detailSales.total} onPageChange={detailSales.setPage} />}
          {cpDetailTab === 'payments' && <Pagination currentPage={detailPayments.page} totalItems={detailPayments.total} onPageChange={detailPayments.setPage} />}
          {/* Tab 3: Debt Payments History */}
          {cpDetailTab === 'payments' && (
            <div>
              {loadingCpDetailPayments ? (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Yuklanmoqda..." /></div>
              ) : cpDetailPayments.length > 0 ? (
                <div className="table-responsive" style={{ maxHeight: '52vh' }}>
                  <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-input)', color: 'var(--text-muted)', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>Sana & Vaqt</th>
                        <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>Filial (Qayerga to‘langan)</th>
                        <th style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>Qabul qildi (Kassir)</th>
                        <th style={{ padding: '10px 14px' }}>Izoh</th>
                        <th style={{ padding: '10px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>To‘langan Summa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cpDetailPayments.map((p) => (
                        <tr key={p.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {new Date(p.paid_at).toLocaleString('uz-UZ')}
                          </td>
                          <td style={{ padding: '10px 14px', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                              <Building size={12} style={{ color: 'var(--primary)' }} />
                              <span>{p.branch_name || 'Asosiy'}</span>
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', color: 'var(--text-primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {p.recorded_by_name || 'Kassir'}
                          </td>
                          <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>{p.note || '—'}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--accent-emerald)', whiteSpace: 'nowrap' }}>
                            {p.is_correction ? 'Tuzatish: ' : '+'}{Number(p.amount).toLocaleString()} {p.currency}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Ushbu mijoz bo‘yicha to‘lovlar tarixi mavjud emas
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              onClick={() => setCpDetailModalOpen(false)}
              style={{
                padding: '9px 20px',
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
      </Modal>

      {/* Invoice Modal */}
      {invoiceModalOpen && selectedInvoiceSale && (
        <InvoiceA4Modal
          isOpen={invoiceModalOpen}
          onClose={() => {
            setInvoiceModalOpen(false);
            setSelectedInvoiceSale(null);
          }}
          sale={selectedInvoiceSale}
        />
      )}
    </div>
  );
}
