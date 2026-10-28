import IlbiLoader from '../components/common/IlbiLoader';
import { localStore } from '../utils/brandStorage.js';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  CheckCircle,
  CreditCard,
  Banknote,
  Receipt,
  Zap,
  ShoppingBag,
  Printer,
  FileText,
  Camera,
  Info,
  Package,
  ChevronRight,
  ArrowLeft,
  DollarSign,
  AlertTriangle,
  X,
  User,
  UserCheck,
  UserX,
} from 'lucide-react';
import { catalogApi, salesApi, tenantApi } from '../api/client';
import Modal from '../components/common/Modal';
import CustomSelect from '../components/common/CustomSelect';
import ReceiptSlip, { printReceiptSlip } from '../components/common/ReceiptSlip';
import InvoiceA4Modal from '../components/common/InvoiceA4Modal';
import ShareDocumentButton from '../components/common/ShareDocumentButton';
import CameraBarcodeScanner from '../components/common/CameraBarcodeScanner';
import Pagination from '../components/common/Pagination';
import PriceInput from '../components/common/PriceInput';
import DebtDueDateField from '../components/common/DebtDueDateField';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { useTenant } from '../context/TenantContext';
import { getOrCreateRequestKey } from '../utils/requestKey';
import { useAuth } from '../hooks/useAuth';
import { usePersistedState } from '../hooks/usePersistedState';
import { useAccountDraft } from '../hooks/useAccountDraft';
import { useTenantCurrency } from '../hooks/useTenantCurrency';
import { calculateTaxLine, taxExpectation } from '../utils/receiptTax';

import { useDebouncedValue, usePaginatedList } from '../hooks/usePaginatedList';

const EMPTY_CART = [];

export default function POS() {
  const toast = useToast();
  const confirm = useConfirm();
  const { activeTenant } = useTenant();
  const searchInputRef = useRef(null);
  const { user } = useAuth();
  const checkoutStorageKey = `ilbi_checkout:${user?.id}:${activeTenant?.id}`;

  // Catalog State
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery.trim());
  const { items: variants, total: variantCount, page: posPage, setPage: setPosPage,
    refresh: loadVariants, loading: loadingProducts, error: productError } = usePaginatedList(
    catalogApi.getVariants, { search: debouncedSearch, category: selectedCategory },
    { tenantId: activeTenant?.id, pageSize: 20 },
  );
  const [checkoutVariants, setCheckoutVariants] = useState([]);
  const { settings: tenantSettings } = useTenantCurrency(activeTenant?.id);
  const usdRate = Number(tenantSettings?.usd_rate || 0);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutSettingsSnapshot, setCheckoutSettingsSnapshot] = useState(null);
  const receiptSettings = checkoutOpen && String(checkoutSettingsSnapshot?.tenantId) === String(activeTenant?.id)
    ? checkoutSettingsSnapshot.settings : tenantSettings?.receipt_settings || null;
  const [usdCalculatorOpen, setUsdCalculatorOpen] = useState(false);
  const [usdCalculatorAmount, setUsdCalculatorAmount] = useState('');
  const [usdCalculatorSaleTotalUzs, setUsdCalculatorSaleTotalUzs] = useState('');
  const POS_PAGE_SIZE = 20;

  // 1-Narx (Partner Price) Switcher - Persisted
  const [isPartnerSale, setIsPartnerSale] = useAccountDraft(
    'pos_partner_sale',
    false,
  );

  // Cart State - Persisted across routes and refreshes
  const [cart, setCart, resetCart] = useAccountDraft(
    'pos_cart',
    EMPTY_CART,
  );

  // Checkout Modal State
  const [paymentMethod, setPaymentMethod, resetPaymentMethod] = useAccountDraft('checkout_method', 'CASH');
  const [paidAmountUZS, setPaidAmountUZS, resetPaidUZS] = useAccountDraft('checkout_paid_uzs', '');
  const [paidAmountUSD, setPaidAmountUSD, resetPaidUSD] = useAccountDraft('checkout_paid_usd', '');
  const [counterpartySearch, setCounterpartySearch, resetCounterpartySearch] = useAccountDraft('checkout_search', '');
  const [selectedCounterpartyRow, setSelectedCounterpartyRow, resetCounterpartyRow] = useAccountDraft('checkout_customer', null);
  const settledCounterpartySearch = useDebouncedValue(counterpartySearch.trim());
  const counterpartyList = usePaginatedList(salesApi.getCounterparties, { search: settledCounterpartySearch },
    { tenantId: activeTenant?.id, enabled: checkoutOpen });
  const counterparties = [...counterpartyList.items];
  if (selectedCounterpartyRow && !counterparties.some(row => row.id === selectedCounterpartyRow.id)) counterparties.unshift(selectedCounterpartyRow);
  const [selectedCounterparty, setSelectedCounterparty, resetCounterparty] = useAccountDraft('checkout_customer_id', '');
  const [debtDueDateDraft, setDebtDueDate, resetDebtDueDate] = useAccountDraft('checkout_debt_due_date', null);
  const debtDueDate = debtDueDateDraft ?? selectedCounterpartyRow?.debt_due_date ?? '';
  const [submittingSale, setSubmittingSale] = useState(false);

  // Receipt Modal State (supports multiple sales from split dual-currency checkout)
  const [completedSales, setCompletedSales] = useState([]);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [posInvoiceModalOpen, setPosInvoiceModalOpen] = useState(false);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const [selectedPosInvoiceSale, setSelectedPosInvoiceSale] = useState(null);
  const [receiptPaperWidth, setReceiptPaperWidth] = usePersistedState('ilbi_receipt_paper_width', '58mm');
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 900 : false));
  const [mobileTab, setMobileTab] = useState('catalog'); // 'catalog' | 'cart'

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 900);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (receiptSettings?.receipt_paper_width) setReceiptPaperWidth(receiptSettings.receipt_paper_width);
  }, [receiptSettings?.receipt_paper_width, setReceiptPaperWidth]);

  const previousTenantId = useRef(null);
  useEffect(() => {
    if (previousTenantId.current && String(previousTenantId.current) !== String(activeTenant?.id)) {
      setCheckoutOpen(false);
      setReceiptOpen(false);
    }
    previousTenantId.current = activeTenant?.id || null;
  }, [activeTenant?.id]);

  const handleOpenPosInvoice = (saleToOpen = null) => {
    const target = saleToOpen || (completedSales && completedSales.length > 0 ? completedSales[0] : null);
    if (target) {
      setSelectedPosInvoiceSale(target);
      setPosInvoiceModalOpen(true);
    }
  };

  const formatQuantity = (qty, unit = 'dona') => {
    const num = Number(qty || 0);
    if (unit === 'dona' || num % 1 === 0) {
      return `${Math.round(num)}`;
    }
    return `${parseFloat(num.toFixed(3))}`;
  };

  const formatPrice = (val, cur = 'UZS') => {
    const num = Number(val || 0);
    if (cur === 'USD') {
      return `$${num.toLocaleString()}`;
    }
    return `${num.toLocaleString()} UZS`;
  };

  const getDefaultPrice = useCallback((variant, partner = isPartnerSale) => {
    if (partner) {
      return Number(variant.price_partner || variant.price_recommended || variant.price_min || 0);
    }
    return Number(variant.price_recommended || variant.price_min || 0);
  }, [isPartnerSale]);

  const getItemEffectivePrice = useCallback((item) => {
    if (item.customPrice !== undefined && item.customPrice !== '') {
      return Number(item.customPrice);
    }
    return getDefaultPrice(item.variant, isPartnerSale);
  }, [getDefaultPrice, isPartnerSale]);

  useEffect(() => {
    const controller = new AbortController();
    catalogApi.getCategories().then((res) => {
      if (!controller.signal.aborted) setCategories(res.results || res);
    }).catch(() => {});
    return () => controller.abort();
  }, [activeTenant?.id]);

  useEffect(() => {
    if (productError) toast.error(productError.message || 'Tovarlarni yuklab bo‘lmadi.');
  }, [productError, toast]);

  const paginatedVariants = variants;

  const handleCategorySelect = (catId) => {
    setSelectedCategory(catId);
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const addToCart = useCallback((variant) => {
    if (variant.currency && variant.currency !== 'UZS') {
      toast.warning('POS faqat UZS’da ishlaydi. USD kalkulyator alohida va savdoga yozilmaydi.');
      return false;
    }
    const available = Number(variant.stock_quantity ?? 0);
    if (available <= 0) {
      toast.warning(`"${variant.product_name || variant.name || 'Ushbu tovar'}" bazada tugagan! (Ombordagi qoldiq: 0)`);
      return false;
    }
    const initialPrice = getDefaultPrice(variant, isPartnerSale);
    let success = true;
    setCart((prev) => {
      const existing = prev.find((item) => item.variant.id === variant.id);
      if (existing) {
        const currentQty = Number(existing.quantity) || 0;
        if (currentQty + 1 > available) {
          toast.warning(`"${variant.product_name || variant.name || 'Tovar'}" omborda faqat ${available} ta mavjud!`);
          success = false;
          return prev;
        }
        return prev.map((item) =>
          item.variant.id === variant.id
            ? { ...item, quantity: currentQty + 1 }
            : item
        );
      }
      return [...prev, { variant, quantity: 1, customPrice: initialPrice }];
    });
    return success;
  }, [getDefaultPrice, isPartnerSale, setCart, toast]);

  const updateQuantity = (variantId, delta) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.variant.id === variantId) {
            const currentQty = Number(item.quantity) || 0;
            const newQty = currentQty + delta;
            const available = Number(item.variant.stock_quantity ?? 0);
            if (delta > 0 && available > 0 && newQty > available) {
              toast.warning(`Omborda faqat ${available} ta mavjud!`);
              return item;
            }
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean)
    );
  };

  const updateItemQuantity = (variantId, newQty) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.variant.id === variantId) {
          const available = Number(item.variant.stock_quantity ?? 0);
          if (newQty !== '' && !isNaN(newQty)) {
            const num = Number(newQty);
            if (num > available && available > 0) {
              toast.warning(`Omborda faqat ${available} ta mavjud!`);
            }
          }
          return { ...item, quantity: newQty };
        }
        return item;
      })
    );
  };

  const updateItemPrice = (variantId, newPrice) => {
    setCart((prev) =>
      prev.map((item) => {
        if (item.variant.id === variantId) {
          return { ...item, customPrice: newPrice };
        }
        return item;
      })
    );
  };

  const togglePartnerSale = () => {
    const nextPartner = !isPartnerSale;
    setIsPartnerSale(nextPartner);
    setCart((prev) =>
      prev.map((item) => {
        const oldDefault = getDefaultPrice(item.variant, isPartnerSale);
        if (Number(item.customPrice) === oldDefault || item.customPrice === undefined) {
          return { ...item, customPrice: getDefaultPrice(item.variant, nextPartner) };
        }
        return item;
      })
    );
  };

  const removeFromCart = (variantId) => {
    setCart((prev) => prev.filter((item) => item.variant.id !== variantId));
  };

  const handleClearCart = async () => {
    if (cart.length === 0) return;
    const isConfirmed = await confirm({
      title: 'Savatni tozalash',
      message: 'Savatdagi barcha tovarlarni o‘chirmoqchimisiz?',
      confirmText: 'Ha, tozalash',
      cancelText: 'Bekor qilish',
      type: 'warning',
    });
    if (isConfirmed) {
      resetCart();
      resetPaymentMethod();
      resetPaidUZS();
      resetPaidUSD();
      resetCounterpartySearch();
      resetCounterpartyRow();
      resetCounterparty();
      toast.info('Savat tozalandi');
    }
  };

  const cartUZS = useMemo(
    () => cart.filter((item) => item.variant.currency === 'UZS' || !item.variant.currency),
    [cart]
  );
  const cartUSD = useMemo(
    () => cart.filter((item) => item.variant.currency === 'USD'),
    [cart]
  );
  const hasUZS = cartUZS.length > 0;
  const hasUSD = cartUSD.length > 0;
  const isSplitCheckout = hasUZS && hasUSD;

  const cartTotalUZS = useMemo(
    () =>
      cartUZS.reduce(
        (acc, item) => acc + Math.round(calculateTaxLine(item.quantity, getItemEffectivePrice(item), receiptSettings || {}).totalAmount * 100),
        0
      ),
    [cartUZS, getItemEffectivePrice, receiptSettings]
  ) / 100;

  const cartTotalUSD = useMemo(
    () =>
      cartUSD.reduce(
        (acc, item) => acc + getItemEffectivePrice(item) * (Number(item.quantity) || 0),
        0
      ),
    [cartUSD, getItemEffectivePrice]
  );

  const totalCartQty = useMemo(
    () => cart.reduce((a, b) => a + (Number(b.quantity) || 0), 0),
    [cart]
  );

  const changeDueUZS = useMemo(
    () => Math.max(0, parseFloat(paidAmountUZS || 0) - cartTotalUZS),
    [paidAmountUZS, cartTotalUZS]
  );
  const changeDueUSD = useMemo(
    () => Math.max(0, parseFloat(paidAmountUSD || 0) - cartTotalUSD),
    [paidAmountUSD, cartTotalUSD]
  );

  const hasStockError = useMemo(
    () =>
      cart.some((item) => {
        const available = Number(item.variant.stock_quantity ?? 0);
        const qty = Number(item.quantity) || 0;
        return available <= 0 || qty > available;
      }),
    [cart]
  );

  const expiredCartItems = cart.flatMap(item => {
    const variant = checkoutVariants.find(v => v.id === item.variant.id) || variants.find(v => v.id === item.variant.id) || item.variant;
    return (variant.expired_batches || []).length ? [{ variant, batches: variant.expired_batches }] : [];
  });

  // Open Checkout
  const handleOpenCheckout = async () => {
    if (cart.length === 0) {
      toast.warning('Savat bo‘sh, tovar tanlang');
      return;
    }

    if (cart.some((item) => item.variant.currency && item.variant.currency !== 'UZS')) {
      toast.error('Savatda USD narxli tovar bor. POS savdosi faqat UZS’da rasmiylashtiriladi; USD tovarini katalogda UZS narxiga o‘tkazing.');
      return;
    }

    let currentVariants;
    let checkoutSettings;
    const checkingTenantId = activeTenant?.id;
    try {
      const tenantData = await tenantApi.getCurrentTenant();
      if (String(checkingTenantId) !== String(previousTenantId.current)) return;
      checkoutSettings = tenantData.receipt_settings || {};
      setCheckoutSettingsSnapshot({ tenantId: checkingTenantId, settings: checkoutSettings });
      const data = await catalogApi.getVariants({ ids: cart.map(item => item.variant.id).join(',') });
      if (String(checkingTenantId) !== String(previousTenantId.current)) return;
      currentVariants = Array.isArray(data) ? data : data.results || [];
      setCheckoutVariants(currentVariants);
    } catch (error) {
      toast.error(error.message || 'Joriy ombor qoldig‘ini tekshirib bo‘lmadi.');
      return;
    }
    // Refresh both stock and expiry information before taking payment.
    for (const item of cart) {
      const currentVariant = currentVariants.find(variant => variant.id === item.variant.id);
      const available = Number(currentVariant?.stock_quantity ?? 0);
      const qty = Number(item.quantity) || 0;
      if (available <= 0) {
        toast.error(`"${item.variant.product_name || item.variant.name || 'Tovar'}" bazada tugagan (qoldiq: 0). Sotuv qilish uchun savatdan o‘chiring.`);
        return;
      }
      if (qty > available) {
        toast.error(`"${item.variant.product_name || item.variant.name || 'Tovar'}" uchun omborda yetarli qoldiq yo‘q (Mavjud: ${available}, Savatda: ${qty}).`);
        return;
      }
    }

    const refreshedTotal = cartUZS.reduce((sum, item) => sum + Math.round(calculateTaxLine(item.quantity, getItemEffectivePrice(item), checkoutSettings).totalAmount * 100), 0) / 100;
    if (paidAmountUZS === '') setPaidAmountUZS(refreshedTotal > 0 ? String(refreshedTotal) : '');
    if (paidAmountUSD === '') setPaidAmountUSD(cartTotalUSD > 0 ? String(cartTotalUSD) : '');
    setCheckoutOpen(true);
  };

  // Resolve scanner codes against the whole catalog, including other pages.
  const lookupAndAdd = async (code, allowName = false) => {
    const q = code.trim();
    if (!q) return;
    const tenantId = activeTenant?.id;
    try {
      const data = await catalogApi.getVariants({ lookup: q, page: 1, page_size: 2 });
      let match = data.results[0];
      if (!match && allowName) {
        const found = await catalogApi.getVariants({ search: q, page: 1, page_size: 2 });
        if (found.count === 1) match = found.results[0];
      }
      if (String(tenantId) !== String(previousTenantId.current)) return;
      if (match && addToCart(match)) {
        setSearchQuery('');
        toast.success(`"${match.product_name}" savatga qo‘shildi`);
      } else if (!match) {
        setSearchQuery(code);
        toast.info(`"${code}" kodi bo‘yicha tovar topilmadi`);
      }
    } catch (error) {
      toast.error(error.message || 'Tovarni qidirib bo‘lmadi.');
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (searchQuery.trim()) lookupAndAdd(searchQuery, true);
    else if (cart.length > 0) handleOpenCheckout();
  };

  const handleCameraBarcodeScan = (code) => lookupAndAdd(code);

  // Complete Sale
  const handleConfirmSale = async (e) => {
    e.preventDefault();
    if (cart.some((item) => item.variant.currency && item.variant.currency !== 'UZS')) {
      toast.error('USD narxli mahsulotni POS savdosiga qo‘shib bo‘lmaydi.');
      return;
    }
    if (paymentMethod === 'DEBT' && !selectedCounterparty) {
      toast.warning('Nasiya uchun kontragent (mijoz)ni tanlash majburiy');
      return;
    }

    // Stock check before submitting
    for (const item of cart) {
      const available = Number(item.variant.stock_quantity ?? 0);
      const qty = Number(item.quantity) || 0;
      if (available <= 0) {
        toast.error(`"${item.variant.product_name || item.variant.name || 'Tovar'}" bazada tugagan (qoldiq: 0).`);
        return;
      }
      if (qty > available) {
        toast.error(`"${item.variant.product_name || item.variant.name || 'Tovar'}" uchun omborda yetarli qoldiq yo‘q (Mavjud: ${available}, Savatda: ${qty}).`);
        return;
      }
    }

    setSubmittingSale(true);
    try {
      if (!receiptSettings) throw new Error('Soliq sozlamalarini yuklash uchun to‘lov oynasini qayta oching.');
      const salePayload = {
        expected_tax_settings: taxExpectation(receiptSettings),
        payment_type: paymentMethod.toLowerCase(), // 'cash' | 'card' | 'debt'
        is_partner_sale: isPartnerSale,
        counterparty_id: selectedCounterparty ? parseInt(selectedCounterparty, 10) : null,
        ...(paymentMethod === 'DEBT' ? { debt_due_date: debtDueDate || null } : {}),
        items: cart.map((i) => ({
          product_variant_id: i.variant.id,
          quantity: Number(i.quantity),
          unit_price: getItemEffectivePrice(i),
        })),
      };

      salePayload.idempotency_key = getOrCreateRequestKey(checkoutStorageKey, salePayload);
      const res = await salesApi.createSale(salePayload);
      const salesList = Array.isArray(res) ? res : [res];
      localStore.removeItem(checkoutStorageKey);
      setCompletedSales(salesList);
      resetCart();
      resetPaymentMethod();
      resetPaidUZS();
      resetPaidUSD();
      resetCounterpartySearch();
      resetCounterpartyRow();
      resetCounterparty();
      resetDebtDueDate();
      setMobileTab('catalog');
      loadVariants();
      setCheckoutOpen(false);
      setReceiptOpen(true);
      toast.success('Sotuv muvaffaqiyatli amalga oshirildi!');
      window.dispatchEvent(new CustomEvent('shift_status_changed'));
      window.dispatchEvent(new CustomEvent('refresh_notifications'));
    } catch (err) {
      toast.error(err.message || 'Sotuvni saqlashda xatolik yuz berdi');
    } finally {
      setSubmittingSale(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 12 : 20,
        height: isMobile ? 'auto' : 'calc(100vh - 120px)',
        minHeight: isMobile ? 'calc(100dvh - 130px)' : undefined,
        width: '100%',
        maxWidth: '100%',
      }}
    >
      {/* Mobile Mode Segmented Switcher */}
      {isMobile && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            background: 'var(--bg-card)',
            padding: 4,
            borderRadius: 12,
            border: '1px solid var(--border-card)',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <button
            type="button"
            onClick={() => setMobileTab('catalog')}
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 8,
              border: 'none',
              background: mobileTab === 'catalog' ? 'var(--primary)' : 'transparent',
              color: mobileTab === 'catalog' ? 'var(--text-on-primary)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <Package size={16} />
            <span>Katalog & Tovarlar</span>
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('cart')}
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 8,
              border: 'none',
              background: mobileTab === 'cart' ? 'var(--primary)' : 'transparent',
              color: mobileTab === 'cart' ? 'var(--text-on-primary)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <ShoppingBag size={16} />
            <span>Savat</span>
            <span
              style={{
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 999,
                background: mobileTab === 'cart' ? 'var(--text-on-primary)' : 'var(--primary)',
                color: mobileTab === 'cart' ? 'var(--primary)' : 'var(--text-on-primary)',
                fontWeight: 800,
              }}
            >
              {totalCartQty}
            </span>
          </button>
        </div>
      )}

      {/* Left Column: Catalog & Quick Select */}
      {(!isMobile || mobileTab === 'catalog') && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, width: '100%' }}>
          {/* Top Controls: Search Bar & Action Buttons */}
          <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
            <div style={{ flex: isMobile ? '1 1 100%' : 1, position: 'relative' }}>
              <Search
                size={18}
                color="var(--text-muted)"
                style={{ position: 'absolute', left: 14, top: 12 }}
              />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Shtrix-kod, 3 bosqichli kod yoki tovar nomini yozing..."
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                style={{
                  width: '100%',
                  padding: '11px 14px 11px 42px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: isMobile ? '100%' : 'auto', flex: isMobile ? '1 1 100%' : 'none' }}>
              {/* Camera Barcode Scanner Button */}
              <button
                type="button"
                onClick={() => setCameraScannerOpen(true)}
                title="Telefon / qurilma kamerasi orqali shtrix-kod skanerlash"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-input)',
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  flex: isMobile ? 1 : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <Camera size={16} />
                <span>Kamera</span>
              </button>

              {/* 1-Narx (Partner) Switch Button */}
              <button
                type="button"
                onClick={togglePartnerSale}
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: isPartnerSale
                    ? '1px solid var(--accent-emerald)'
                    : '1px solid var(--border-subtle)',
                  background: isPartnerSale
                    ? 'rgba(var(--success-rgb), 0.15)'
                    : 'rgba(255, 255, 255, 0.04)',
                  color: isPartnerSale ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  flex: isMobile ? 1 : 'none',
                  boxShadow: isPartnerSale ? '0 0 15px rgba(var(--success-rgb), 0.3)' : 'none',
                  transition: 'all var(--transition-fast)',
                  whiteSpace: 'nowrap',
                }}
              >
                <Zap size={16} />
                <span>1-Narx</span>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: isPartnerSale ? 'var(--accent-emerald)' : 'var(--text-muted)',
                  }}
                />
              </button>

              {/* USD Calculator Button */}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setUsdCalculatorOpen((open) => !open)}
                style={{
                  borderColor: usdCalculatorOpen ? 'var(--primary)' : undefined,
                  color: usdCalculatorOpen ? 'var(--primary)' : undefined,
                  flex: isMobile ? 1 : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '10px 12px',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                }}
              >
                <Banknote size={16} />
                <span>USD</span>
              </button>
            </div>
          </div>

        {usdCalculatorOpen && (() => {
          const usdAmount = parseFloat(String(usdCalculatorAmount || '').replace(/\s/g, '')) || 0;
          const saleTotal = parseFloat(String(usdCalculatorSaleTotalUzs || '').replace(/\s/g, '')) || 0;
          const effectiveSaleTotal = saleTotal > 0 ? saleTotal : (cartTotalUZS > 0 ? cartTotalUZS : 0);
          const usdValueUzs = Math.round(usdAmount * usdRate);
          const changeUzs = usdValueUzs - effectiveSaleTotal;

          return (
            <section
              style={{
                padding: '14px 16px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(var(--primary-rgb), 0.12)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Banknote size={16} />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
                    Valyuta (USD) Hisob-kitob Kalkulyatori
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      padding: '3px 10px',
                      borderRadius: 20,
                      background: 'rgba(var(--success-rgb), 0.12)',
                      border: '1px solid rgba(var(--success-rgb), 0.25)',
                      color: 'var(--accent-emerald)',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    1 USD = {usdRate > 0 ? usdRate.toLocaleString('uz-UZ') : '—'} UZS
                  </div>

                  <button
                    type="button"
                    onClick={() => setUsdCalculatorOpen(false)}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
                    title="Yopish"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Inputs Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {/* 1. Hisob / Savat Summasi (UZS) */}
                <div style={{ background: 'var(--bg-input)', padding: 10, borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      To‘lov / Savat summasi (UZS)
                    </label>
                    {cartTotalUZS > 0 && (
                      <button
                        type="button"
                        onClick={() => setUsdCalculatorSaleTotalUzs(String(cartTotalUZS))}
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          color: 'var(--primary)',
                          background: 'rgba(var(--primary-rgb), 0.1)',
                          border: 'none',
                          borderRadius: 4,
                          padding: '2px 6px',
                          cursor: 'pointer',
                        }}
                      >
                        Savatdan olish ({cartTotalUZS.toLocaleString()} UZS)
                      </button>
                    )}
                  </div>
                  <PriceInput
                    value={usdCalculatorSaleTotalUzs}
                    onChange={(event) => setUsdCalculatorSaleTotalUzs(event.target.value)}
                    placeholder="0"
                    style={{ width: '100%', fontSize: 13, fontWeight: 700 }}
                  />
                </div>

                {/* 2. Mijoz Bergan Valyuta ($ USD) */}
                <div style={{ background: 'var(--bg-input)', padding: 10, borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Mijoz bergan summa ($ USD)
                    </label>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['10', '20', '50', '100'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setUsdCalculatorAmount(preset)}
                          style={{
                            fontSize: 10.5,
                            fontWeight: 600,
                            padding: '1px 5px',
                            borderRadius: 4,
                            border: '1px solid var(--border-subtle)',
                            background: 'var(--bg-card)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          ${preset}
                        </button>
                      ))}
                    </div>
                  </div>
                  <PriceInput
                    value={usdCalculatorAmount}
                    onChange={(event) => setUsdCalculatorAmount(event.target.value)}
                    placeholder="0"
                    style={{ width: '100%', fontSize: 13, fontWeight: 700 }}
                  />
                </div>
              </div>

              {/* Calculation Result Banner */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-card)',
                }}
              >
                <div>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>USD ning so‘mdagi qiymati:</span>
                  <strong style={{ fontSize: 15, color: 'var(--primary)', fontWeight: 800 }}>
                    {usdAmount > 0 ? `${usdValueUzs.toLocaleString('uz-UZ')} UZS` : '0 UZS'}
                  </strong>
                </div>

                {effectiveSaleTotal > 0 && usdAmount > 0 && (
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>
                      {changeUzs >= 0 ? 'Mijozga qaytim (so‘mda):' : 'Yetishmayotgan summa:'}
                    </span>
                    <strong
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: changeUzs >= 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                      }}
                    >
                      {Math.abs(changeUzs).toLocaleString('uz-UZ')} UZS
                    </strong>
                  </div>
                )}
              </div>

              {/* Disclaimer Note */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                <Info size={13} style={{ flexShrink: 0 }} />
                <span>Faqat ma’lumot kalkulyatori: valyuta to‘lov sifatida qabul qilinmaydi va chekka faqat UZS yoziladi.</span>
              </div>
            </section>
          );
        })()}

        {/* Category Pills Bar */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 4,
          }}
        >
          <button
            onClick={() => handleCategorySelect(null)}
            style={{
              padding: '6px 14px',
              borderRadius: 'var(--radius-full)',
              border: selectedCategory === null ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
              background: selectedCategory === null ? 'var(--primary)' : 'var(--bg-chip)',
              color: selectedCategory === null ? 'var(--primary-foreground)' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Barchasi
          </button>
          {categories.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => handleCategorySelect(cat.id)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-full)',
                  border: active ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                  background: active ? 'var(--primary)' : 'var(--bg-chip)',
                  color: active ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {cat.name}
              </button>
            );
          })}
        </div>

        {/* Product Cards Grid */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: isMobile
              ? 'repeat(auto-fill, minmax(145px, 1fr))'
              : 'repeat(auto-fill, minmax(185px, 1fr))',
            gap: isMobile ? 10 : 12,
            alignContent: 'start',
            paddingRight: 4,
          }}
        >
          {loadingProducts ? (
            <div style={{ gridColumn: '1 / -1', padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              <IlbiLoader label="Tovarlar yuklanmoqda..." />
            </div>
          ) : variants.length > 0 ? (
            paginatedVariants.map((v) => {
              const activePrice = getDefaultPrice(v);
              const inStock = Number(v.stock_quantity || 0) > 0;
              const sellableAtPos = !v.currency || v.currency === 'UZS';
              return (
                <div
                  key={v.id}
                  onClick={() => addToCart(v)}
                  className={`glass-card ${inStock && sellableAtPos ? 'interactive' : ''}`}
                  style={{
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: inStock && sellableAtPos ? 'pointer' : 'not-allowed',
                    opacity: inStock && sellableAtPos ? 1 : 0.55,
                    filter: inStock && sellableAtPos ? 'none' : 'grayscale(0.35)',
                    position: 'relative',
                    userSelect: 'none',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: inStock ? 'rgba(var(--success-rgb), 0.15)' : 'rgba(var(--danger-rgb), 0.15)',
                          color: inStock ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          fontWeight: 700,
                        }}
                      >
                        {!sellableAtPos ? 'POS uchun UZS narxi kerak' : inStock ? `${formatQuantity(v.stock_quantity, v.unit)} ${v.unit || 'ta'}` : 'Tugagan'}
                      </span>
                      {v.code && (
                        <span style={{ fontSize: 10, color: 'var(--primary)', fontFamily: 'monospace', fontWeight: 700 }}>
                          {v.code}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.3 }}>
                      {v.product_name || v.name}
                    </div>
                    {v.name && v.name !== v.product_name && v.name.toLowerCase() !== 'standart' && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                        {v.name}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Price details: Tavsiya, Min, 1-Narx */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Tavsiya:</span>
                        <span style={{ fontWeight: 600, color: !isPartnerSale ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          {formatPrice(v.price_recommended, v.currency)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Min narx:</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {formatPrice(v.price_min, v.currency)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>1-Narx:</span>
                        <span style={{ fontWeight: isPartnerSale ? 700 : 500, color: isPartnerSale ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                          {formatPrice(v.price_partner, v.currency)}
                        </span>
                      </div>
                    </div>

                    {/* Main Price & Add Button */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--border-subtle)' }}>
                      <div>
                        <div style={{ fontSize: 9, color: isPartnerSale ? 'var(--accent-emerald)' : 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                          {isPartnerSale ? '1-Narx (Ulgurji)' : 'Sotuv narxi'}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: isPartnerSale ? 'var(--accent-emerald)' : 'var(--text-primary)' }}>
                          {formatPrice(activePrice, v.currency)}
                        </div>
                      </div>
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 'var(--radius-xs)',
                          background: 'var(--primary-light)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--primary)',
                        }}
                      >
                        <Plus size={16} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ gridColumn: '1 / -1', padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                Mahsulot topilmadi
              </div>
              <div style={{ fontSize: 13 }}>
                Ushbu filial omborida mahsulot mavjud emas yoki qoldig‘i 0 ga teng.
              </div>
            </div>
          )}
        </div>

        {/* POS Pagination Bar */}
        {variantCount > POS_PAGE_SIZE && (
          <Pagination
            currentPage={posPage}
            totalItems={variantCount}
            pageSize={POS_PAGE_SIZE}
            onPageChange={setPosPage}
            compact={true}
          />
        )}

        {/* Sticky Mobile Quick Cart Bar */}
        {isMobile && cart.length > 0 && (
          <div
            onClick={() => setMobileTab('cart')}
            style={{
              position: 'sticky',
              bottom: 8,
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, var(--primary) 0%, var(--primary-hover) 100%)',
              color: 'var(--text-on-primary)',
              fontWeight: 700,
              fontSize: 13.5,
              boxShadow: '0 8px 24px rgba(var(--primary-rgb), 0.42)',
              cursor: 'pointer',
              marginTop: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ShoppingBag size={18} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{totalCartQty} ta tovar savatda</div>
                <div style={{ fontSize: 12, opacity: 0.9 }}>{cartTotalUZS.toLocaleString()} UZS</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 800, fontSize: 13 }}>
              <span>Savatga o‘tish</span>
              <ChevronRight size={17} />
            </div>
          </div>
        )}
      </div>
      )}

      {/* Right Column: Live Cart Drawer */}
      {(!isMobile || mobileTab === 'cart') && (
        <div
          className="glass-card"
          style={{
            width: isMobile ? '100%' : 380,
            display: 'flex',
            flexDirection: 'column',
            padding: isMobile ? 14 : 20,
            background: 'var(--bg-surface)',
            boxSizing: 'border-box',
          }}
        >
          {/* Top navigation back button on mobile */}
          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileTab('catalog')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'none',
                border: 'none',
                color: 'var(--primary)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                padding: '4px 0 12px 0',
                marginBottom: 6,
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <ArrowLeft size={16} />
              <span>← Tovarlar qo‘shish (Katalogga qaytish)</span>
            </button>
          )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: 14,
            borderBottom: '1px solid var(--border-subtle)',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShoppingBag size={20} color="var(--primary)" />
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Savat</h3>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                background: 'var(--primary)',
                color: 'var(--text-on-primary)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {cart.reduce((a, b) => a + (Number(b.quantity) || 0), 0)}
            </span>
          </div>
          {cart.length > 0 && (
            <button
              onClick={handleClearCart}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent-rose)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Tozalash
            </button>
          )}
        </div>

        {/* Cart Items List */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cart.length > 0 ? (
            cart.map((item) => {
              const currentPrice = item.customPrice !== undefined ? item.customPrice : getDefaultPrice(item.variant);
              const minPrice = Number(item.variant.price_min || 0);
              const partnerPrice = Number(item.variant.price_partner || 0);
              const numPrice = Number(currentPrice || 0);
              const qty = Number(item.quantity) || 0;

              // Wholesale mode is active or price matches the wholesale tier
              const isWholesaleApplied = isPartnerSale || (partnerPrice > 0 && numPrice === partnerPrice);

              let priceWarning = null;
              if (isWholesaleApplied) {
                // In wholesale mode, minimal retail price warnings are NOT needed
                // Only warn if the cashier enters a price strictly below the wholesale price itself:
                if (partnerPrice > 0 && numPrice > 0 && numPrice < partnerPrice) {
                  priceWarning = `Ulgurji narxdan past (${formatPrice(partnerPrice, item.variant.currency)})`;
                }
              } else {
                // In retail mode, warn if entered price is strictly below the retail minimum price
                if (minPrice > 0 && numPrice > 0 && numPrice < minPrice) {
                  priceWarning = `Minimal narxdan past (${formatPrice(minPrice, item.variant.currency)})`;
                }
              }
              const isBelowMin = !!priceWarning;
              const isUSD = item.variant.currency === 'USD';
              const availableStock = Number(item.variant.stock_quantity ?? 0);
              const isOutOfStock = availableStock <= 0;
              const isOverStock = Number(item.quantity) > availableStock;

              return (
                <div
                  key={item.variant.id}
                  style={{
                    padding: 12,
                    borderRadius: 'var(--radius-sm)',
                    background: (isOutOfStock || isOverStock) ? 'rgba(var(--danger-rgb), 0.06)' : 'rgba(255, 255, 255, 0.03)',
                    border: (isOutOfStock || isOverStock)
                      ? '1px solid var(--accent-rose)'
                      : isBelowMin
                      ? '1px solid var(--accent-amber)'
                      : '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.variant.product_name || item.variant.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                        {isPartnerSale && partnerPrice > 0 ? (
                          <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>
                            1-Narx: {formatPrice(partnerPrice, item.variant.currency)}
                          </span>
                        ) : (
                          <span>Min: {formatPrice(minPrice, item.variant.currency)}</span>
                        )}
                        <span>Tavsiya: {formatPrice(item.variant.price_recommended, item.variant.currency)}</span>
                        {isOutOfStock ? (
                          <span style={{ color: 'var(--accent-rose)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <AlertTriangle size={11} />
                            <span>Omborda tugagan (0 ta)</span>
                          </span>
                        ) : isOverStock ? (
                          <span style={{ color: 'var(--accent-rose)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <AlertTriangle size={11} />
                            <span>Omborda faqat {availableStock} ta</span>
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variant.id, -1)}
                        title="1 taga kamaytirish"
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          border: 'none',
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Minus size={12} />
                      </button>
                      <input data-api-field="quantity"
                        type="number"
                        min="1"
                        step={item.variant.unit === 'dona' ? '1' : 'any'}
                        value={item.quantity ?? ''}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === '') {
                            updateItemQuantity(item.variant.id, '');
                          } else {
                            const num = parseFloat(val);
                            if (!isNaN(num) && num >= 0) {
                              updateItemQuantity(item.variant.id, num);
                            }
                          }
                        }}
                        onBlur={() => {
                          const available = Number(item.variant.stock_quantity ?? 0);
                          if (!item.quantity || Number(item.quantity) <= 0) {
                            updateItemQuantity(item.variant.id, 1);
                          } else if (available > 0 && Number(item.quantity) > available) {
                            updateItemQuantity(item.variant.id, available);
                            toast.warning(`"${item.variant.product_name || item.variant.name}" omborda faqat ${available} ta mavjud!`);
                          }
                        }}
                        title="Soni (qo‘lda kiritish mumkin)"
                        style={{
                          width: 46,
                          height: 24,
                          padding: '2px 4px',
                          textAlign: 'center',
                          borderRadius: 4,
                          border: '1px solid var(--border-card)',
                          background: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontSize: 13,
                          fontWeight: 700,
                          outline: 'none',
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => updateQuantity(item.variant.id, 1)}
                        title="1 taga oshirish"
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 4,
                          border: 'none',
                          background: 'rgba(255, 255, 255, 0.08)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Plus size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.variant.id)}
                        title="Savatdan o‘chirish"
                        style={{
                          marginLeft: 4,
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 4,
                        }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Editable Price Row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 6, borderTop: '1px dashed var(--border-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Narx ({isUSD ? '$' : 'UZS'}{receiptSettings?.is_vat_payer && !receiptSettings.price_includes_vat ? ', QQSsiz' : ''}):</span>
                      <PriceInput data-api-field="customPrice"
                        value={item.customPrice ?? ''}
                        onChange={(e) => updateItemPrice(item.variant.id, e.target.value)}
                        style={{
                          width: 105,
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-xs)',
                          border: isBelowMin ? '1px solid var(--accent-amber)' : '1px solid var(--border-card)',
                          background: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontSize: 13,
                          fontWeight: 700,
                          outline: 'none',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'right' }}>
                      {isUSD
                        ? `$${(numPrice * qty).toFixed(2)}`
                        : `${calculateTaxLine(qty, numPrice, receiptSettings || {}).totalAmount.toLocaleString()} UZS`}
                    </div>
                  </div>

                  {/* Advisory warning if entered price is lower than floor price */}
                  {receiptSettings?.is_vat_payer && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>QQS {Number(receiptSettings.vat_rate)}% {receiptSettings.price_includes_vat ? 'narx ichida' : 'jami summaga qo‘shilgan'}</div>}
              {priceWarning && (
                    <div style={{ fontSize: 10, color: 'var(--accent-amber)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {priceWarning}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 8 }}>
              <ShoppingBag size={36} strokeWidth={1.5} />
              <div style={{ fontSize: 13 }}>Savat hozircha bo‘sh</div>
              <div style={{ fontSize: 11 }}>Tovar ustiga bosing yoki skan qiling</div>
            </div>
          )}
        </div>

        {/* Cart Totals & Checkout Button */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, marginTop: 12 }}>
          {cartTotalUSD > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Valyuta (USD):</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                ${cartTotalUSD.toFixed(2)}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Jami Summa:</span>
            <span style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {cartTotalUZS.toLocaleString()} UZS
            </span>
          </div>

          {hasStockError && (
            <div
              style={{
                background: 'rgba(var(--danger-rgb), 0.12)',
                border: '1px solid var(--accent-rose)',
                color: 'var(--accent-rose)',
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>Savatda omborda qolmagan yoki yetarli bo‘lmagan tovarlar bor!</span>
            </div>
          )}

          <button
            onClick={handleOpenCheckout}
            disabled={cart.length === 0 || hasStockError}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: cart.length > 0 && !hasStockError
                ? 'var(--accent-emerald)'
                : 'rgba(255,255,255,0.06)',
              color: cart.length > 0 && !hasStockError ? 'var(--on-success)' : 'var(--text-muted)',
              fontSize: 16,
              fontWeight: 700,
              cursor: cart.length > 0 && !hasStockError ? 'pointer' : 'not-allowed',
              boxShadow: cart.length > 0 && !hasStockError ? 'var(--shadow-glow-emerald)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all var(--transition-fast)',
            }}
          >
            <CreditCard size={18} />
            <span>To‘lovga O‘tish</span>
          </button>
        </div>
      </div>
      )}

      {/* Checkout Modal */}
      <Modal
        isOpen={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="To‘lovni Qabul Qilish"
        maxWidth={isSplitCheckout ? 840 : 540}
      >
        <form onSubmit={handleConfirmSale} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {expiredCartItems.length > 0 && <div role="alert" style={{ padding: 14, border: '1px solid var(--accent-amber)', borderRadius: 8, background: 'rgba(var(--primary-rgb), .1)' }}>
            <strong>Diqqat: yaroqlilik muddati o‘tgan partiya bor.</strong>
            {expiredCartItems.map(({ variant, batches }) => <div key={variant.id}>{variant.product_name || variant.name}: {batches.map(batch => `${batch.batch_code || 'Partiya'} — ${batch.expires_on}`).join('; ')}</div>)}
            <div>Sotuvni davom ettirish mumkin.</div>
          </div>}
          {/* Payment Method Selector */}
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              To‘lov Usuli
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { id: 'CASH', label: 'Naqd Pul', icon: Banknote },
                { id: 'CARD', label: 'Bank Karta', icon: CreditCard },
                { id: 'DEBT', label: 'Nasiya / Qarz', icon: Receipt },
              ].map((m) => {
                const active = paymentMethod === m.id;
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id)}
                    style={{
                      padding: '12px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: active ? '1px solid var(--accent-emerald)' : '1px solid var(--border-subtle)',
                      background: active ? 'rgba(var(--success-rgb), 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      color: active ? 'var(--accent-emerald)' : 'var(--text-secondary)',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Icon size={20} color={active ? 'var(--accent-emerald)' : 'var(--text-muted)'} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Counterparty selection: Required for DEBT, recommended for Partner sale, optional for regular sale */}
          {checkoutOpen && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: paymentMethod === 'DEBT' ? 700 : 500,
                    color: paymentMethod === 'DEBT' && !selectedCounterparty ? 'var(--accent-amber)' : 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>
                    {paymentMethod === 'DEBT'
                      ? 'Kontragent (Nasiya qarzdor mijoz) *'
                      : isPartnerSale
                      ? 'Hamkor Do‘kon / Kontragent (1-Narx xaridori)'
                      : 'Mijoz / Hamkor biriktirish (Ixtiyoriy)'}
                  </span>
                  {paymentMethod === 'DEBT' && !selectedCounterparty && (
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: 'rgba(245, 158, 11, 0.15)',
                        color: 'var(--accent-amber)',
                      }}
                    >
                      Majburiy
                    </span>
                  )}
                </label>
              </div>

              {counterpartyList.error && (
                <div role="alert" style={{ fontSize: 11.5, color: 'var(--accent-rose)', marginBottom: 6 }}>
                  {counterpartyList.error.message}
                </div>
              )}

              {selectedCounterparty && selectedCounterpartyRow ? (
                /* Sleek Selected Customer Card */
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm, 10px)',
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.04))',
                    border: isPartnerSale
                      ? '1px solid var(--accent-emerald)'
                      : paymentMethod === 'DEBT'
                      ? '1px solid var(--primary)'
                      : '1px solid var(--border-card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: isPartnerSale
                          ? 'rgba(16, 185, 129, 0.15)'
                          : 'rgba(var(--primary-rgb), 0.15)',
                        color: isPartnerSale ? 'var(--accent-emerald)' : 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <User size={18} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {selectedCounterpartyRow.name}
                        </span>
                        {selectedCounterpartyRow.target_tenant_name && (
                          <span
                            style={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: 'var(--accent-emerald)',
                            }}
                          >
                            B2B: {selectedCounterpartyRow.target_tenant_name}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
                        <span>{selectedCounterpartyRow.phone_number || 'Telefon kiritilmagan'}</span>
                        {(Number(selectedCounterpartyRow.debt_balance_uzs || 0) > 0 || Number(selectedCounterpartyRow.debt_balance_usd || 0) > 0) && (
                          <span style={{ color: 'var(--accent-rose)', fontWeight: 600 }}>
                            • Qarz: {selectedCounterpartyRow.debt_balance_uzs ? `${Number(selectedCounterpartyRow.debt_balance_uzs).toLocaleString()} UZS` : ''} {selectedCounterpartyRow.debt_balance_usd ? `${selectedCounterpartyRow.debt_balance_usd} USD` : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCounterparty('');
                      setSelectedCounterpartyRow(null);
                      setDebtDueDate('');
                      setCounterpartySearch('');
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '6px 11px',
                      borderRadius: 6,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-chip, rgba(255, 255, 255, 0.06))',
                      color: 'var(--accent-rose)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                    title="Mijozni almashtirish yoki bekor qilish"
                  >
                    <X size={13} />
                    <span>O‘zgartirish</span>
                  </button>
                </div>
              ) : (
                /* Single, Unified Searchable Select */
                <CustomSelect
                  value={selectedCounterparty}
                  onChange={(val) => {
                    setSelectedCounterparty(val);
                    const customer = counterparties.find((row) => String(row.id) === String(val)) || null;
                    setSelectedCounterpartyRow(customer);
                    setDebtDueDate(customer?.debt_due_date || '');
                  }}
                  searchable
                  searchValue={counterpartySearch}
                  onSearchChange={setCounterpartySearch}
                  searchPlaceholder="Mijoz nomi yoki telefon raqami..."
                  searchLoading={counterpartyList.loading}
                  icon={User}
                  placeholder={
                    paymentMethod === 'DEBT'
                      ? 'Mijozni tanlang (Majburiy)...'
                      : isPartnerSale
                      ? 'Hamkor do‘kon / sherikni tanlang...'
                      : 'Oddiy chakana xaridor (Biriktirilmagan)'
                  }
                  options={[
                    ...(paymentMethod !== 'DEBT'
                      ? [
                          {
                            value: '',
                            label: 'Oddiy chakana xaridor (Biriktirilmagan)',
                            icon: UserX,
                          },
                        ]
                      : []),
                    ...counterparties.map((cp) => ({
                      value: cp.id,
                      label: `${cp.name} (${cp.phone_number || 'Tel yo‘q'})`,
                      badge: cp.target_tenant_name ? `B2B: ${cp.target_tenant_name}` : null,
                      icon: UserCheck,
                    })),
                  ]}
                  footer={
                    counterpartyList.total > 20 ? (
                      <div style={{ padding: '4px 6px', borderTop: '1px solid var(--border-subtle)' }}>
                        <Pagination
                          compact
                          currentPage={counterpartyList.page}
                          totalItems={counterpartyList.total}
                          onPageChange={counterpartyList.setPage}
                        />
                      </div>
                    ) : null
                  }
                  fullWidth
                  style={{
                    ...(paymentMethod === 'DEBT' && !selectedCounterparty
                      ? { border: '1px solid var(--accent-amber)', background: 'rgba(245, 158, 11, 0.04)' }
                      : isPartnerSale
                      ? { border: '1px solid var(--accent-emerald)' }
                      : {}),
                  }}
                />
              )}
            </div>
          )}

          {paymentMethod === 'DEBT' && selectedCounterparty && (
            <DebtDueDateField value={debtDueDate} onChange={setDebtDueDate} />
          )}

          {/* DUAL-CURRENCY SPLIT VIEW (USD on Left, UZS on Right with vertical divider line) */}
          {isSplitCheckout ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 24,
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: 16,
              }}
            >
              {/* LEFT COLUMN: USD */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  paddingRight: 16,
                  borderRight: '1px solid var(--border-card)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(var(--success-rgb), 0.12)',
                    border: '1px solid rgba(var(--success-rgb), 0.25)',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: 'var(--accent-emerald)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <DollarSign size={15} />
                    <span>USD Tovarlar ({cartUSD.length})</span>
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--accent-emerald)' }}>
                    ${cartTotalUSD.toLocaleString()}
                  </span>
                </div>

                {/* Items list */}
                <div
                  style={{
                    maxHeight: 180,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    paddingRight: 4,
                  }}
                >
                  {cartUSD.map((item) => {
                    const price = getItemEffectivePrice(item);
                    const lineTotal = calculateTaxLine(item.quantity, price, receiptSettings || {}).totalAmount;
                    return (
                      <div
                        key={item.variant.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12,
                          background: 'rgba(255, 255, 255, 0.03)',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {item.variant.product_name}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>
                            ({formatQuantity(item.quantity, item.variant.unit_type)})
                          </span>
                        </div>
                        <span style={{ fontWeight: 700, color: 'var(--accent-emerald)' }}>
                          ${lineTotal.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Cash & Change for USD */}
                {paymentMethod === 'CASH' && (
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Mijozdan qabul qilingan summa ($)
                    </label>
                    <PriceInput
                      value={paidAmountUSD}
                      onChange={(e) => setPaidAmountUSD(e.target.value)}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-card)',
                        background: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: 16,
                        fontWeight: 700,
                        outline: 'none',
                      }}
                    />
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: 'rgba(255, 255, 255, 0.04)',
                      }}
                    >
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Qaytim (USD):</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                        ${changeDueUSD.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: UZS */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  paddingLeft: 6,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: 'var(--primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Banknote size={15} />
                    <span>UZS Tovarlar ({cartUZS.length})</span>
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)' }}>
                    {cartTotalUZS.toLocaleString()} UZS
                  </span>
                </div>

                {/* Items list */}
                <div
                  style={{
                    maxHeight: 180,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    paddingRight: 4,
                  }}
                >
                  {cartUZS.map((item) => {
                    const price = getItemEffectivePrice(item);
                    const lineTotal = calculateTaxLine(item.quantity, price, receiptSettings || {}).totalAmount;
                    return (
                      <div
                        key={item.variant.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: 12,
                          background: 'rgba(255, 255, 255, 0.03)',
                          padding: '7px 10px',
                          borderRadius: 6,
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '65%' }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {item.variant.product_name}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 4 }}>
                            ({formatQuantity(item.quantity, item.variant.unit_type)})
                          </span>
                        </div>
                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                          {lineTotal.toLocaleString()} UZS
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Cash & Change for UZS */}
                {paymentMethod === 'CASH' && (
                  <div
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      padding: 12,
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Mijozdan qabul qilingan summa (UZS)
                    </label>
                    <PriceInput
                      value={paidAmountUZS}
                      onChange={(e) => setPaidAmountUZS(e.target.value)}
                      placeholder="0"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-card)',
                        background: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: 16,
                        fontWeight: 700,
                        outline: 'none',
                      }}
                    />
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: 8,
                        padding: '8px 10px',
                        borderRadius: 6,
                        background: 'rgba(255, 255, 255, 0.04)',
                      }}
                    >
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Qaytim (UZS):</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)' }}>
                        {changeDueUZS.toLocaleString()} UZS
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* SINGLE CURRENCY VIEW (compact layout when only one currency is present) */
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
              {hasUSD ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Jami to‘lov summasi:</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--accent-emerald)' }}>
                      ${cartTotalUSD.toLocaleString()}
                    </span>
                  </div>
                  {paymentMethod === 'CASH' && (
                    <div>
                      <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        Mijozdan qabul qilingan summa ($)
                      </label>
                      <PriceInput
                        value={paidAmountUSD}
                        onChange={(e) => setPaidAmountUSD(e.target.value)}
                        placeholder="0"
                        style={{
                          width: '100%',
                          padding: '12px 14px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-card)',
                          background: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontSize: 16,
                          fontWeight: 700,
                          outline: 'none',
                        }}
                      />
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginTop: 8,
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(255, 255, 255, 0.04)',
                        }}
                      >
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Qaytim:</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                          ${changeDueUSD.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Jami to‘lov summasi:</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)' }}>
                      {cartTotalUZS.toLocaleString()} UZS
                    </span>
                  </div>
                  {paymentMethod === 'CASH' && (
                    <div>
                      <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                        Mijozdan qabul qilingan summa (UZS)
                      </label>
                      <PriceInput
                        value={paidAmountUZS}
                        onChange={(e) => setPaidAmountUZS(e.target.value)}
                        placeholder="0"
                        style={{
                          width: '100%',
                          padding: '12px 14px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-card)',
                          background: 'var(--bg-input)',
                          color: 'var(--text-primary)',
                          fontSize: 16,
                          fontWeight: 700,
                          outline: 'none',
                        }}
                      />
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginTop: 8,
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(255, 255, 255, 0.04)',
                        }}
                      >
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Qaytim:</span>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                          {changeDueUZS.toLocaleString()} UZS
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Common Footer Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
            <button
              type="button"
              onClick={() => setCheckoutOpen(false)}
              style={{
                padding: '10px 18px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={submittingSale}
              style={{
                padding: '11px 26px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                fontWeight: 700,
                fontSize: 15,
                cursor: submittingSale ? 'not-allowed' : 'pointer',
                boxShadow: 'var(--primary-glow)',
              }}
            >
              {submittingSale ? 'Saqlanmoqda...' : 'Sotuvni Tasdiqlash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Receipt Print Modal */}
      <Modal isOpen={receiptOpen} onClose={() => setReceiptOpen(false)} title="Chek Kvitansiyasi" maxWidth={440}>
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div className="no-print">
            <CheckCircle size={36} color="var(--accent-emerald)" style={{ margin: '0 auto 8px' }} />
            <h3 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 2px', color: 'var(--text-primary)' }}>
              Sotuv Muvaffaqiyatli Yakunlandi!
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 16px' }}>
              {completedSales.length > 1
                ? `${completedSales.length} ta chek shakllantirildi (Dual-valyuta)`
                : `Chek raqami: #${completedSales[0]?.receipt_number || completedSales[0]?.id}`}
            </p>
          </div>

          {/* Thermal Printer Format Switcher */}
          <div className="no-print" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 14 }}>
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

          {/* Authentic Real-world Thermal Receipt Slip */}
          <div style={{ marginBottom: 18, display: 'flex', justifyContent: 'center' }}>
            <ReceiptSlip
              id="printable-pos-receipt"
              sales={completedSales}
              paidAmountUZS={paidAmountUZS}
              paidAmountUSD={paidAmountUSD}
              changeDueUZS={changeDueUZS}
              changeDueUSD={changeDueUSD}
              paperWidth={receiptPaperWidth}
            />
          </div>

          <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            <ShareDocumentButton
              elementId="printable-pos-receipt"
              title={`ILBI Chek ${completedSales?.[0]?.receipt_number || ''}`}
              sales={completedSales}
              paperWidth={receiptPaperWidth}
            />
            <button
              type="button"
              onClick={() => printReceiptSlip('printable-pos-receipt', 'ILBI Savdo Cheki', receiptPaperWidth)}
              style={{
                padding: '10px 18px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Printer size={16} />
              <span>Chekni chop etish ({receiptPaperWidth})</span>
            </button>
            {/* A4 Invoice only for Debt or Partner/Counterparty/B2B sales */}
            {(completedSales || []).some(
              (s) =>
                (s.payment_type || '').toLowerCase() === 'debt' ||
                Boolean(s.is_partner_sale) ||
                Boolean(s.counterparty) ||
                Boolean(s.counterparty_name) ||
                Boolean(s.b2b_target_tenant)
            ) && (
              <button
                type="button"
                onClick={() => handleOpenPosInvoice()}
                style={{
                  padding: '10px 18px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-card)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <FileText size={16} style={{ color: 'var(--primary)' }} />
                <span>A4 Faktura</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setReceiptOpen(false)}
              style={{
                padding: '10px 22px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Yopish
            </button>
          </div>
        </div>
      </Modal>

      {/* Official A4 Invoice Modal */}
      <InvoiceA4Modal
        isOpen={posInvoiceModalOpen}
        onClose={() => setPosInvoiceModalOpen(false)}
        sale={selectedPosInvoiceSale}
      />

      {/* Camera Barcode Scanner Modal */}
      <CameraBarcodeScanner
        isOpen={cameraScannerOpen}
        onClose={() => setCameraScannerOpen(false)}
        onScan={handleCameraBarcodeScan}
        title="POS Shtrix-kod Skaneri"
      />
    </div>
  );
}
