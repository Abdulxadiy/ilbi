import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ScanBarcode,
  Camera,
  Plus,
  Minus,
  Trash2,
  PackagePlus,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Truck,
  FileText,
  MessageSquare,
  Layers,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Modal from '../common/Modal';
import PriceInput from '../common/PriceInput';
import CustomDatePicker from '../common/CustomDatePicker';
import CameraBarcodeScanner from '../common/CameraBarcodeScanner';
import { useDebouncedValue, usePaginatedList } from '../../hooks/usePaginatedList';
import { useSelectPopover } from '../../hooks/useSelectPopover';
import { inventoryApi, catalogApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAccountDraft } from '../../hooks/useAccountDraft';
import { useTenant } from '../../context/TenantContext';
import { localStore } from '../../utils/brandStorage.js';

const supplierStorageKey = (tenantId) => `ilbi_saved_suppliers:${tenantId || 'pending'}`;

const EMPTY_DRAFT = {
  supplier: '',
  invoiceNumber: '',
  note: '',
  items: [],
};

// Helper: Analyze expiration status and calculate remaining period
const getExpiryStatus = (dateStr) => {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - now) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      type: 'expired',
      label: `Muddati o‘tgan (${Math.abs(diffDays)} kun oldin)`,
      bg: 'rgba(var(--danger-rgb), 0.15)',
      color: 'var(--accent-rose)',
      borderColor: 'rgba(var(--danger-rgb), 0.35)',
      icon: <AlertCircle size={12} />,
      tooltip: 'Ushbu partiyaning yaroqlilik muddati tugagan!',
    };
  }
  if (diffDays <= 30) {
    return {
      type: 'warning',
      label: `${diffDays} kun qoldi`,
      bg: 'rgba(var(--warning-rgb), 0.15)',
      color: 'var(--accent-amber)',
      borderColor: 'rgba(var(--warning-rgb), 0.35)',
      icon: <AlertTriangle size={12} />,
      tooltip: 'Yaroqlilik muddati 1 oydan kam qoldi',
    };
  }
  if (diffDays <= 365) {
    const months = Math.round(diffDays / 30.5);
    return {
      type: 'ok',
      label: `${months} oy yaroqli`,
      bg: 'rgba(var(--success-rgb), 0.12)',
      color: 'var(--accent-emerald)',
      borderColor: 'rgba(var(--success-rgb), 0.28)',
      icon: <CheckCircle2 size={12} />,
      tooltip: `Yaroqlilik sanasi: ${dateStr}`,
    };
  }
  const years = (diffDays / 365.25).toFixed(1);
  return {
    type: 'ok',
    label: `${years} yil yaroqli`,
    bg: 'rgba(var(--success-rgb), 0.12)',
    color: 'var(--accent-emerald)',
    borderColor: 'rgba(var(--success-rgb), 0.28)',
    icon: <CheckCircle2 size={12} />,
    tooltip: `Yaroqlilik sanasi: ${dateStr}`,
  };
};

export default function RapidStockIntakeModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedVariantId = null,
}) {
  const toast = useToast();
  const { activeTenant } = useTenant();
  const confirm = useConfirm();
  const navigate = useNavigate();

  // Persisted Draft in localStore: survives navigation, tab switches, and reloads
  const [draft, setDraft, resetDraft] = useAccountDraft(
    'stock_intake_full_draft_v1',
    EMPTY_DRAFT
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastAddedRowId, setLastAddedRowId] = useState(null);
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);

  // Remembered suppliers for tenant
  const [savedSuppliers, setSavedSuppliers] = useState(() => {
    try {
      const stored = localStore.getItem(supplierStorageKey(activeTenant?.id));
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    let live = true;
    const canView = activeTenant?.is_owner || activeTenant?.permissions?.includes('inventory.view_supplier');
    if (canView) {
      inventoryApi.getSuppliers().then((apiList) => {
        if (!live || !Array.isArray(apiList)) return;
        setSavedSuppliers((prev) => {
          const merged = [...prev];
          for (const s of apiList) {
            if (s && !merged.some((x) => x.toLowerCase() === s.toLowerCase())) {
              merged.push(s);
            }
          }
          try {
            localStore.setItem(supplierStorageKey(activeTenant?.id), JSON.stringify(merged));
          } catch {}
          return merged;
        });
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [activeTenant?.id]);

  const searchInputRef = useRef(null);
  const rowInputRefs = useRef({});
  const dropdownRef = useRef(null);
  const searchBoxRef = useRef(null);

  // Auto-focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }, 100);
    } else {
      setIsDropdownOpen(false);
      setSearchQuery('');
    }
  }, [isOpen]);

  // Helper to get clean variant details
  const getVariantInfo = useCallback((variant) => {
    const name = variant.product_name || variant.name || 'Noma’lum tovar';
    const sub =
      variant.name && variant.name !== variant.product_name && variant.name.toLowerCase() !== 'standart'
        ? variant.name
        : '';
    const code = variant.code || variant.sku || '';
    const barcode = variant.barcode || '';
    const unit = variant.unit || 'dona';
    const currency = variant.currency || 'UZS';
    const stock = Number(variant.stock_quantity ?? variant.quantity ?? 0);
    const costPrice = variant.cost_price || variant.base_cost || '';

    return { name, sub, code, barcode, unit, currency, stock, costPrice };
  }, []);

  // Add or increment item in draft
  const addItemToDraft = useCallback(
    (variant, forceNew = false) => {
      if (!variant || !variant.id) return;

      const variantId = variant.id;
      const info = getVariantInfo(variant);
      const rowId = `row-${variantId}-${crypto.randomUUID()}`;

      setDraft((prevDraft) => {
        const currentItems = Array.isArray(prevDraft?.items) ? prevDraft.items : [];
        const existingIdx = currentItems.findIndex((it) => String(it.variantId) === String(variantId));

        if (existingIdx >= 0 && !forceNew) {
          // Increment quantity if already exists
          const updatedItems = [...currentItems];
          const currQty = parseFloat(updatedItems[existingIdx].quantity) || 0;
          const nextQty = currQty + 1;
          updatedItems[existingIdx] = {
            ...updatedItems[existingIdx],
            quantity: String(nextQty),
          };
          setLastAddedRowId(updatedItems[existingIdx].id);

          setTimeout(() => {
            const input = rowInputRefs.current[`${updatedItems[existingIdx].id}_qty`];
            if (input) {
              input.focus();
              input.select();
            }
          }, 50);

          return { ...prevDraft, items: updatedItems };
        } else {
          // Add new item row
          const newItem = {
            id: rowId,
            variantId: variant.id,
            variantSnapshot: {
              id: variant.id,
              name: info.name,
              sub: info.sub,
              code: info.code,
              barcode: info.barcode,
              unit: info.unit,
              currency: info.currency,
              stock: info.stock,
            },
            quantity: '1',
            cost_price: info.costPrice ? String(info.costPrice) : '',
            note: '',
            batch_code: '',
            expires_on: '',
          };

          setLastAddedRowId(rowId);

          setTimeout(() => {
            const input = rowInputRefs.current[`${rowId}_qty`];
            if (input) {
              input.focus();
              input.select();
            }
          }, 50);

          return {
            ...prevDraft,
            items: [newItem, ...currentItems],
          };
        }
      });

      setSearchQuery('');
      setIsDropdownOpen(false);
      setHighlightedIndex(0);
      toast.success(`"${info.name}" kirim jadvaliga qo‘shildi`);
    },
    [getVariantInfo, setDraft, toast]
  );

  useEffect(() => {
    if (!isOpen || !preselectedVariantId) return;
    const controller = new AbortController();
    catalogApi.getVariants({ ids: preselectedVariantId }, { signal: controller.signal }).then(rows => {
      if (!controller.signal.aborted && rows[0]) addItemToDraft(rows[0]);
    }).catch(error => { if (!controller.signal.aborted) toast.error(error.message); });
    return () => controller.abort();
  }, [isOpen, preselectedVariantId, addItemToDraft, toast]);

  // Close autocomplete on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target) &&
        searchInputRef.current &&
        !searchInputRef.current.contains(e.target)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const settledSearch = useDebouncedValue(searchQuery.trim());
  const searchList = usePaginatedList(catalogApi.getVariants, { search: settledSearch },
    { tenantId: activeTenant?.id, pageSize: 10, enabled: isOpen && Boolean(settledSearch) });
  const searchResults = searchList.items;
  const searchPopover = useSelectPopover({
    isOpen: isOpen && isDropdownOpen && searchResults.length > 0,
    anchorRef: searchBoxRef, menuRef: dropdownRef,
    onClose: () => setIsDropdownOpen(false), searchable: true,
    menuStyle: { maxHeight: 400 },
  });
  const renderSearchMenu = menu => searchPopover.supported ? menu
    : createPortal(menu, searchPopover.portalRoot || document.body);
  useEffect(() => { if (searchList.error) toast.error(searchList.error.message); }, [searchList.error, toast]);
  const resolveCode = async (code) => {
    try {
      const exact = await catalogApi.getVariants({ lookup: code.trim(), page: 1, page_size: 1 });
      if (exact.results[0]) { addItemToDraft(exact.results[0]); return; }
      const found = await catalogApi.getVariants({ search: code.trim(), page: 1, page_size: 10 });
      const match = found.results[highlightedIndex] || found.results[0];
      if (match) addItemToDraft(match);
      else toast.info('Tovar topilmadi. Qidiruvni aniqlashtiring.');
    } catch (error) { toast.error(error.message); }
  };

  // Handle Search Input KeyDown (Barcode scanner or manual autocomplete)
  const handleSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isDropdownOpen && searchResults.length > 0) {
        setIsDropdownOpen(true);
      }
      setHighlightedIndex((prev) => (prev + 1 < searchResults.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const q = searchQuery.trim().toLowerCase();
      if (!q) return;

      resolveCode(searchQuery);
    } else if (e.key === 'Escape') {
      if (isDropdownOpen) {
        e.preventDefault();
        e.stopPropagation();
      }
      setIsDropdownOpen(false);
    }
  };

  const handleCameraBarcodeScan = code => resolveCode(code);

  // Row update handlers
  const handleUpdateItem = (id, field, value) => {
    setDraft((prevDraft) => {
      const currentItems = Array.isArray(prevDraft?.items) ? prevDraft.items : [];
      const updated = currentItems.map((item) => {
        if (item.id === id) {
          return { ...item, [field]: value };
        }
        return item;
      });
      return { ...prevDraft, items: updated };
    });
  };

  const handleStepQuantity = (id, delta) => {
    setDraft((prevDraft) => {
      const currentItems = Array.isArray(prevDraft?.items) ? prevDraft.items : [];
      const updated = currentItems.map((item) => {
        if (item.id === id) {
          const curr = parseFloat(item.quantity) || 0;
          const next = Math.max(1, curr + delta);
          return { ...item, quantity: String(next) };
        }
        return item;
      });
      return { ...prevDraft, items: updated };
    });
  };

  const handleRemoveItem = (id) => {
    setDraft((prevDraft) => {
      const currentItems = Array.isArray(prevDraft?.items) ? prevDraft.items : [];
      return {
        ...prevDraft,
        items: currentItems.filter((it) => it.id !== id),
      };
    });
  };

  // Clear draft with confirmation
  const handleClearDraft = async () => {
    const hasData =
      (draft.items && draft.items.length > 0) ||
      draft.supplier ||
      draft.invoiceNumber ||
      draft.note;

    if (!hasData) {
      resetDraft();
      return;
    }

    const isConfirmed = await confirm({
      title: 'Qoralamani tozalash',
      message:
        'Haqiqatan ham barcha to‘plangan tovarlar va kiritilgan qoralama ma’lumotlarini tozalashni xohlaysizmi?',
      confirmText: 'Ha, tozalash',
      cancelText: 'Bekor qilish',
      type: 'danger',
    });

    if (isConfirmed) {
      resetDraft();
      toast.info('Kirim qoralamasi tozalandi');
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }
  };

  // Live Summary calculation
  const summary = useMemo(() => {
    const items = Array.isArray(draft?.items) ? draft.items : [];
    let totalQuantity = 0;
    let totalSumUZS = 0;
    let totalSumUSD = 0;

    items.forEach((it) => {
      const qty = parseFloat(it.quantity) || 0;
      const cost = parseFloat(it.cost_price) || 0;
      const currency = it.variantSnapshot?.currency || 'UZS';

      totalQuantity += qty;
      if (currency === 'USD') {
        totalSumUSD += qty * cost;
      } else {
        totalSumUZS += qty * cost;
      }
    });

    return {
      distinctCount: items.length,
      totalQuantity,
      totalSumUZS,
      totalSumUSD,
    };
  }, [draft]);

  // Batch Submit Handler
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const items = Array.isArray(draft?.items) ? draft.items : [];

    if (items.length === 0) {
      toast.warning('Kirim qilish uchun kamida bitta tovar kiriting');
      if (searchInputRef.current) searchInputRef.current.focus();
      return;
    }

    // Validate fields
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const name = it.variantSnapshot?.name || `${i + 1}-tovar`;
      const qty = parseFloat(it.quantity);
      if (isNaN(qty) || qty <= 0) {
        toast.warning(`"${name}" miqdori noto‘g‘ri kiritilgan`);
        const input = rowInputRefs.current[`${it.id}_qty`];
        if (input) input.focus();
        return;
      }
      const cost = parseFloat(it.cost_price);
      if (isNaN(cost) || cost < 0) {
        toast.warning(`"${name}" tan narxi noto‘g‘ri kiritilgan`);
        const input = rowInputRefs.current[`${it.id}_cost`];
        if (input) input.focus();
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await inventoryApi.batchStockIntake({
        supplier: (draft.supplier || '').trim(),
        faktura_number: (draft.invoiceNumber || '').trim(),
        note: (draft.note || '').trim(),
        items: items.map((it) => ({
          product_variant_id: parseInt(it.variantId, 10),
          quantity: parseFloat(it.quantity),
          cost_price: parseFloat(it.cost_price),
          note: it.note ? it.note.trim() : '',
          batch_code: (it.batch_code || '').trim(),
          expires_on: it.expires_on || null,
        })),
      });

      // Save supplier to remembered suppliers list
      const cleanSupplier = (draft.supplier || '').trim();
      if (cleanSupplier) {
        setSavedSuppliers((prev) => {
          if (!prev.some((s) => s.toLowerCase() === cleanSupplier.toLowerCase())) {
            const updated = [cleanSupplier, ...prev];
            try {
              localStore.setItem(supplierStorageKey(activeTenant?.id), JSON.stringify(updated));
            } catch {}
            return updated;
          }
          return prev;
        });
      }

      toast.success(
        `Kirim muvaffaqiyatli qabul qilindi! (${items.length} xil tovar, ${summary.totalQuantity} dona)`
      );

      // Successfully submitted: clear draft
      resetDraft();
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Tovar partiyasini qabul qilishda xatolik yuz berdi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const items = Array.isArray(draft?.items) ? draft.items : [];

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Tovar Kirimi (Tezkor Partiya Oqimi)" maxWidth={1120}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Top Header with Title and Auto-Saved Draft status */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            paddingBottom: 14,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(var(--primary-rgb), 0.12)',
                border: '1px solid rgba(var(--primary-rgb), 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
                boxShadow: '0 2px 8px rgba(var(--primary-rgb), 0.12)',
              }}
            >
              <PackagePlus size={22} />
            </div>
            <div>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-secondary)' }}>
                Kamera skaneri, shtrix-kod yoki klaviatura orqali tovarlar partiyasini bir zumda qabul qilish
              </p>
            </div>
          </div>

          {/* Draft Persistence Badge & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 20,
                background: items.length > 0 ? 'rgba(var(--success-rgb), 0.12)' : 'var(--bg-chip)',
                color: items.length > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 600,
                border: items.length > 0 ? '1px solid rgba(var(--success-rgb), 0.25)' : '1px solid var(--border-subtle)',
              }}
              title="Siz sahifadan chiqib ketsangiz ham, barcha kiritilgan ma'lumotlar saqlanadi"
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: items.length > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)',
                  boxShadow: items.length > 0 ? '0 0 6px var(--accent-emerald)' : 'none',
                }}
              />
              <span>
                {items.length > 0
                  ? `Qoralama saqlandi (${items.length} ta tovar)`
                  : 'Qoralama avtomatik saqlanadi'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                navigate('/catalog?new=1&intake=1');
                toast.info('Qoralamangiz saqlandi. Yangi tovar qo‘shib qaytishingiz mumkin.');
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(var(--primary-rgb), 0.08)',
                border: '1px solid rgba(var(--primary-rgb), 0.25)',
                color: 'var(--primary)',
                padding: '7px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title="Katalogga o‘tib yangi tovar yaratish (Qoralama o‘chmaydi)"
            >
              <Plus size={14} />
              <span>Yangi tovar yaratish</span>
            </button>
          </div>
        </div>

        {/* Batch Metadata Header: Ta'minotchi, Faktura raqami, Izoh */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 12,
            background: 'var(--bg-card)',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <Truck size={13} style={{ color: 'var(--primary)' }} />
              Ta’minotchi
            </label>
            <input data-api-field="supplier"
              type="text"
              list="rapid-intake-suppliers-list"
              placeholder="Yetkazib beruvchi nomi (ixtiyoriy)"
              value={draft.supplier || ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, supplier: e.target.value }))}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 12.5,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            <datalist id="rapid-intake-suppliers-list">
              {savedSuppliers.map((s, idx) => (
                <option key={idx} value={s} />
              ))}
            </datalist>
            {savedSuppliers.length > 0 && !draft.supplier && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10.5, color: 'var(--text-muted)', marginRight: 2 }}>
                  Eslab qolingan:
                </span>
                {savedSuppliers.slice(0, 5).map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, supplier: s }))}
                    style={{
                      padding: '2px 7px',
                      borderRadius: 5,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-card)',
                      color: 'var(--primary)',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    title="Ta’minotchi sifatida tanlash"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <FileText size={13} style={{ color: 'var(--primary)' }} />
              Faktura / Nakladnoy №
            </label>
            <input data-api-field="invoiceNumber"
              type="text"
              placeholder="Masalan: FAK-2026-904"
              value={draft.invoiceNumber || ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, invoiceNumber: e.target.value }))}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 12.5,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <MessageSquare size={13} style={{ color: 'var(--primary)' }} />
              Izoh
            </label>
            <input data-api-field="note"
              type="text"
              placeholder="Qisqa izoh..."
              value={draft.note || ''}
              onChange={(e) => setDraft((prev) => ({ ...prev, note: e.target.value }))}
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: 12.5,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Rapid Barcode & Autocomplete Search Bar + Camera Scanner Trigger */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          <div ref={searchBoxRef} style={{ flex: 1, position: 'relative', minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--bg-input)',
                border: isDropdownOpen ? '2px solid var(--primary)' : '1px solid var(--border-card)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                gap: 10,
                boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                transition: 'border 0.15s ease',
              }}
            >
              <ScanBarcode size={22} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsDropdownOpen(true);
                  setHighlightedIndex(0);
                }}
                onFocus={() => {
                  if (searchQuery.trim()) setIsDropdownOpen(true);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Shtrix-kodni skanerlang yoki tovar nomi / artikul / model bo‘yicha qidiring..."
                style={{
                  flex: 1,
                  minWidth: 0,
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: 14,
                  color: 'var(--text-primary)',
                  padding: '6px 0',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setIsDropdownOpen(false);
                    if (searchInputRef.current) searchInputRef.current.focus();
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: 4,
                  }}
                >
                  <X size={12} />
                </button>
              )}
              <div
                className="rapid-intake-search-hint"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 8px',
                  background: 'var(--bg-chip)',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  border: '1px solid var(--border-subtle)',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>Enter ↵</span>
                <span style={{ color: 'var(--text-muted)' }}>qo‘shish</span>
              </div>
            </div>

            {/* Autocomplete Dropdown Popover */}
          {isDropdownOpen && searchResults.length > 0 && renderSearchMenu(
            <div
              ref={dropdownRef}
              popover={searchPopover.supported ? 'manual' : undefined}
              className="rapid-intake-search-menu"
              style={{
                background: 'var(--bg-modal, var(--bg-surface))',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-card)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: '0 12px 30px rgba(0,0,0,0.22)',
                zIndex: 9999,
                overflow: 'hidden',
                boxSizing: 'border-box',
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                ...searchPopover.style,
              }}
            >
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--bg-card)',
                  borderBottom: '1px solid var(--border-subtle)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexShrink: 0,
                  flexWrap: 'wrap',
                  gap: 4,
                  justifyContent: 'space-between',
                }}
              >
                <span>Topilgan tovarlar ({searchResults.length} ta)</span>
                <span>↑ ↓ tugmalari orqali tanlang va Enter bosing</span>
              </div>

              <div style={{ overflowY: 'auto', minHeight: 0, overscrollBehavior: 'contain' }}>
              {searchResults.map((variant, index) => {
                const info = getVariantInfo(variant);
                const isSelected = index === highlightedIndex;

                return (
                  <div
                    key={variant.id}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => addItemToDraft(variant)}
                    style={{
                      padding: '10px 14px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid var(--border-subtle)',
                      background: isSelected ? 'rgba(59, 130, 246, 0.12)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 280px', minWidth: 0 }}>
                      <div
                        style={{
                          width: 32,
                          flexShrink: 0,
                          height: 32,
                          borderRadius: 6,
                          background: 'var(--bg-chip)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--primary)',
                          fontWeight: 700,
                          fontSize: 13,
                        }}
                      >
                        {info.name.charAt(0).toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>
                            {info.name}
                          </span>
                          {info.sub && (
                            <span
                              style={{
                                fontSize: 11,
                                padding: '1px 5px',
                                background: 'var(--bg-chip)',
                                borderRadius: 4,
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {info.sub}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                          {info.barcode && (
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                              #{info.barcode}
                            </span>
                          )}
                          {info.code && (
                            <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--primary)' }}>
                              [{info.code}]
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Joriy qoldiq</div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: info.stock > 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          }}
                        >
                          {info.stock} {info.unit}
                        </div>
                      </div>

                      {info.costPrice ? (
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Oxirgi tan narxi</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {Number(info.costPrice).toLocaleString()} {info.currency}
                          </div>
                        </div>
                      ) : null}

                      <div
                        style={{
                          padding: '4px 8px',
                          borderRadius: 4,
                          background: isSelected ? 'var(--primary)' : 'var(--bg-chip)',
                          color: isSelected ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        + Qo‘shish
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </div>
          )}
        </div>

        {/* Camera Barcode Scanner Trigger Button */}
        <button
          type="button"
          className="rapid-intake-camera-button"
          onClick={() => setCameraScannerOpen(true)}
          title="Telefon / kompyuter kamerasi orqali shtrix-kod skanerlash"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 16px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(var(--primary-rgb), 0.12)',
            border: '1px solid rgba(var(--primary-rgb), 0.3)',
            color: 'var(--primary)',
            fontWeight: 700,
            fontSize: 13,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s ease',
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--primary)';
            e.currentTarget.style.color = 'var(--primary-foreground, #000)';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.12)';
            e.currentTarget.style.color = 'var(--primary)';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          <Camera size={18} />
          <span className="rapid-intake-camera-label">Kamera skaneri</span>
        </button>
      </div>

        {/* Stream Table for Batch Intake */}
        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            overflow: 'hidden',
            background: 'var(--bg-card)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          }}
        >
          <div className="table-responsive" style={{ maxHeight: '440px', overflowY: 'auto' }}>
            <table
              style={{
                width: '100%',
                minWidth: 980,
                borderCollapse: 'separate',
                borderSpacing: 0,
                textAlign: 'left',
                fontSize: 13,
              }}
            >
              <thead
                style={{
                  background: 'var(--bg-chip)',
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                }}
              >
                <tr>
                  <th style={{ padding: '11px 8px', width: 36, textAlign: 'center', borderBottom: '2px solid var(--border-card)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 }}>№</th>
                  <th style={{ padding: '11px 12px', minWidth: 210, borderBottom: '2px solid var(--border-card)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 }}>Tovar nomi</th>
                  <th style={{ padding: '11px 10px', width: 135, borderBottom: '2px solid var(--border-card)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 }}>Partiya №</th>
                  <th style={{ padding: '11px 10px', width: 150, borderBottom: '2px solid var(--border-card)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 }}>Yaroqlilik muddati</th>
                  <th style={{ padding: '11px 8px', width: 95, textAlign: 'center', borderBottom: '2px solid var(--border-card)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 }}>Joriy qoldiq</th>
                  <th style={{ padding: '11px 10px', width: 145, borderBottom: '2px solid var(--border-card)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 }}>Kirim miqdori *</th>
                  <th style={{ padding: '11px 10px', width: 165, borderBottom: '2px solid var(--border-card)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 }}>Tan narxi *</th>
                  <th style={{ padding: '11px 12px', width: 120, borderBottom: '2px solid var(--border-card)', color: 'var(--text-secondary)', fontWeight: 700, fontSize: 12 }}>Jami qiymat</th>
                  <th style={{ padding: '11px 8px', width: 65, textAlign: 'center', borderBottom: '2px solid var(--border-card)' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <ScanBarcode size={38} style={{ opacity: 0.35, color: 'var(--primary)' }} />
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                          Hozircha tovarlar qo‘shilmadi
                        </div>
                        <div style={{ fontSize: 12.5, maxWidth: 440, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                          Yuqoridagi maydonda kamera yoki shtrix-kod skaneri orqali tovar nomini yozib{' '}
                          <kbd style={{ padding: '2px 6px', background: 'var(--bg-chip)', border: '1px solid var(--border-subtle)', borderRadius: 4, fontWeight: 700 }}>Enter</kbd>{' '}
                          bosing. Tovar avtomatik ushbu jadvalga qo‘shiladi.
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => {
                    const snap = item.variantSnapshot || {};
                    const unit = snap.unit || 'dona';
                    const currency = snap.currency || 'UZS';
                    const lineQty = parseFloat(item.quantity) || 0;
                    const lineCost = parseFloat(item.cost_price) || 0;
                    const lineTotal = lineQty * lineCost;
                    const isRecentlyAdded = item.id === lastAddedRowId;
                    const expiryStatus = getExpiryStatus(item.expires_on);

                    return (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom: '1px solid var(--border-subtle)',
                          background: isRecentlyAdded
                            ? 'rgba(var(--primary-rgb), 0.08)'
                            : idx % 2 === 1
                            ? 'rgba(255, 255, 255, 0.02)'
                            : 'transparent',
                          transition: 'background 0.25s ease',
                        }}
                      >
                        {/* 1. № */}
                        <td style={{ padding: '10px 8px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}>
                          {idx + 1}
                        </td>

                        {/* 2. Tovar Nomi & Kodlar */}
                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text-primary)' }}>
                                {snap.name || 'Tovar'}
                              </span>
                              {snap.sub && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: '1px 6px',
                                    background: 'rgba(var(--primary-rgb), 0.1)',
                                    borderRadius: 4,
                                    color: 'var(--primary)',
                                    fontWeight: 600,
                                    border: '1px solid rgba(var(--primary-rgb), 0.25)',
                                  }}
                                >
                                  {snap.sub}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {snap.barcode && (
                                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)', background: 'var(--bg-input)', padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border-subtle)' }}>
                                  #{snap.barcode}
                                </span>
                              )}
                              {snap.code && (
                                <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                                  [{snap.code}]
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* 3. Partiya № */}
                        <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}>
                          <input data-api-field="batch_code"
                            type="text"
                            placeholder="Ixtiyoriy"
                            value={item.batch_code || ''}
                            maxLength={80}
                            onChange={(e) => handleUpdateItem(item.id, 'batch_code', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              fontSize: 12.5,
                              borderRadius: 6,
                              border: '1px solid var(--border-subtle)',
                              background: 'var(--bg-input)',
                              color: 'var(--text-primary)',
                              outline: 'none',
                              boxSizing: 'border-box',
                            }}
                          />
                        </td>

                        {/* 4. Yaroqlilik Muddati */}
                        <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle', minWidth: 170 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <CustomDatePicker data-api-field="expires_on"
                              size="sm"
                              value={item.expires_on || ''}
                              min="2020-01-01"
                              max="2045-12-31"
                              onChange={(val) => handleUpdateItem(item.id, 'expires_on', val)}
                              title="Partiyaning yaroqlilik muddati (tugash sanasi)"
                              placeholder="Muddati..."
                              fullWidth
                            />
                            {expiryStatus && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: expiryStatus.color,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  whiteSpace: 'nowrap',
                                }}
                                title={expiryStatus.tooltip}
                              >
                                {expiryStatus.icon}
                                <span>{expiryStatus.label}</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 5. Joriy Qoldiq */}
                        <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              fontSize: 11.5,
                              fontWeight: 700,
                              padding: '3px 8px',
                              borderRadius: 6,
                              background: snap.stock > 0 ? 'rgba(var(--success-rgb), 0.12)' : 'rgba(var(--danger-rgb), 0.12)',
                              color: snap.stock > 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                              border: snap.stock > 0 ? '1px solid rgba(var(--success-rgb), 0.25)' : '1px solid rgba(var(--danger-rgb), 0.25)',
                              display: 'inline-block',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {snap.stock ?? 0} {unit}
                          </span>
                        </td>

                        {/* 6. Kirim Miqdori */}
                        <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                              type="button"
                              onClick={() => handleStepQuantity(item.id, -1)}
                              style={{
                                width: 28,
                                height: 30,
                                borderRadius: 6,
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--bg-chip)',
                                color: 'var(--text-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                              title="1 taga kamaytirish"
                            >
                              <Minus size={13} />
                            </button>

                            <input data-api-field="quantity"
                              ref={(el) => (rowInputRefs.current[`${item.id}_qty`] = el)}
                              type="number"
                              step={unit === 'dona' ? '1' : '0.001'}
                              min={unit === 'dona' ? '1' : '0.001'}
                              placeholder="0"
                              value={item.quantity}
                              onChange={(e) => handleUpdateItem(item.id, 'quantity', e.target.value)}
                              required
                              style={{
                                width: 56,
                                height: 30,
                                padding: '4px 6px',
                                borderRadius: 6,
                                border: '1px solid var(--border-card)',
                                background: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                fontSize: 13,
                                fontWeight: 700,
                                textAlign: 'center',
                                outline: 'none',
                                boxSizing: 'border-box',
                              }}
                            />

                            <button
                              type="button"
                              onClick={() => handleStepQuantity(item.id, 1)}
                              style={{
                                width: 28,
                                height: 30,
                                borderRadius: 6,
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--bg-chip)',
                                color: 'var(--text-primary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                              }}
                              title="1 taga oshirish"
                            >
                              <Plus size={13} />
                            </button>

                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 2 }}>{unit}</span>
                          </div>
                        </td>

                        {/* 7. Tan Narxi */}
                        <td style={{ padding: '10px 10px', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <PriceInput data-api-field="cost_price"
                              ref={(el) => (rowInputRefs.current[`${item.id}_cost`] = el)}
                              placeholder="0"
                              value={item.cost_price}
                              onChange={(e) => handleUpdateItem(item.id, 'cost_price', e.target.value)}
                              required
                              style={{
                                width: 110,
                                height: 30,
                                padding: '4px 8px',
                                borderRadius: 6,
                                border: '1px solid var(--border-card)',
                                background: 'var(--bg-input)',
                                color: 'var(--text-primary)',
                                fontSize: 13,
                                fontWeight: 600,
                                outline: 'none',
                                boxSizing: 'border-box',
                              }}
                            />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{currency}</span>
                          </div>
                        </td>

                        {/* 8. Jami Qiymat */}
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: lineTotal > 0 ? 'var(--primary)' : 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                          {lineTotal.toLocaleString()} {currency}
                        </td>

                        {/* 9. Amallar: Duplicate & Delete */}
                        <td style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid var(--border-subtle)', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const rows = await catalogApi.getVariants({ ids: item.variantId });
                                  if (rows[0]) addItemToDraft(rows[0], true);
                                  else toast.warning('Tovar faol katalogda topilmadi.');
                                } catch (error) { toast.error(error.message); }
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--primary)',
                                cursor: 'pointer',
                                padding: 5,
                                borderRadius: 4,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: 0.8,
                                transition: 'opacity 0.15s ease',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                              title="Shu tovardan yangi partiya qatori ochish"
                            >
                              <Layers size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent-rose)',
                                cursor: 'pointer',
                                padding: 5,
                                borderRadius: 4,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                opacity: 0.8,
                                transition: 'opacity 0.15s ease',
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                              title="Qatorni o‘chirish"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Summary Footer Card */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '12px 18px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-card)',
          }}
        >
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Partiya tarkibi: </span>
              <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{summary.distinctCount} xil tovar</strong>
            </div>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Jami kirim miqdori: </span>
              <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{summary.totalQuantity.toLocaleString()} dona</strong>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Jami partiya summasi:</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {summary.totalSumUZS > 0 && (
                <strong style={{ fontSize: 16, color: 'var(--primary)', fontWeight: 800 }}>
                  {summary.totalSumUZS.toLocaleString()} UZS
                </strong>
              )}
              {summary.totalSumUSD > 0 && (
                <strong style={{ fontSize: 16, color: 'var(--accent-emerald)', fontWeight: 800 }}>
                  {summary.totalSumUSD.toLocaleString()} USD
                </strong>
              )}
              {summary.totalSumUZS === 0 && summary.totalSumUSD === 0 && (
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>0 UZS</span>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Actions: Clear Draft, Cancel, Submit */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 8,
          }}
        >
          <div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={handleClearDraft}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-rose)',
                  fontSize: 12,
                  cursor: 'pointer',
                  padding: '6px 0',
                  textDecoration: 'underline',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Trash2 size={13} />
                <span>Qoralamani tozalash</span>
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 18px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
            >
              Bekor qilish
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || items.length === 0}
              style={{
                padding: '10px 24px',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                background: items.length > 0 ? 'var(--primary)' : 'var(--border-subtle)',
                color: items.length > 0 ? 'var(--primary-foreground)' : 'var(--text-muted)',
                fontWeight: 700,
                fontSize: 13,
                cursor: items.length > 0 && !isSubmitting ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.15s ease',
                boxShadow: items.length > 0 ? '0 4px 14px rgba(var(--primary-rgb), 0.28)' : 'none',
              }}
            >
              <PackagePlus size={16} />
              <span>
                {isSubmitting
                  ? 'Qabul qilinmoqda...'
                  : items.length > 0
                  ? `Partiyani Tasdiqlash (${items.length} ta tovar)`
                  : 'Kirimni Tasdiqlash'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Modal>

    {/* Camera Barcode Scanner Modal */}
    <CameraBarcodeScanner
      isOpen={cameraScannerOpen}
      onClose={() => setCameraScannerOpen(false)}
      onScan={handleCameraBarcodeScan}
      title="Tovar Kirimi Shtrix-kod Skaneri"
    />
    </>
  );
}
