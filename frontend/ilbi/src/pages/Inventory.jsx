import { useWorkspaceAction } from '../hooks/useWorkspaceAction';
import IlbiLoader from '../components/common/IlbiLoader';
import RemoteVariantSelect from '../components/common/RemoteVariantSelect';
import { useDebouncedValue, usePaginatedList } from '../hooks/usePaginatedList';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Truck,
  Trash2,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  Info,
  ArrowUpDown,
  CalendarDays,
  AlertTriangle,
  Store,
  CheckCircle2,
} from 'lucide-react';
import { inventoryApi, catalogApi, tenantApi } from '../api/client';
import Modal from '../components/common/Modal';
import ExcelExportButton from '../components/common/ExcelExportButton';
import RapidStockIntakeModal from '../components/inventory/RapidStockIntakeModal';
import TenantTransfersPanel from '../components/inventory/TenantTransfersPanel';
import StockBatchesPanel from '../components/inventory/StockBatchesPanel';
import BatchSelector from '../components/inventory/BatchSelector';
import CustomSelect from '../components/common/CustomSelect';
import Pagination from '../components/common/Pagination';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../context/TenantContext';
import { usePersistedState } from '../hooks/usePersistedState';
import { useAccountDraft } from '../hooks/useAccountDraft';
import { readAccountDraft } from '../utils/accountDrafts';

const DEFAULT_INVENTORY_FILTERS = {
  stockSearch: '',
  stockCategory: 'all',
  stockSort: 'name_asc', // 'name_asc' | 'name_desc' | 'qty_desc' | 'qty_asc' | 'price_desc' | 'price_asc'
  movementType: 'all',
  movementDate: 'all',
  movementSearch: '',
};

export default function Inventory() {
  const toast = useToast();
  const confirm = useConfirm();
  const { isOwner, user } = useAuth();
  const { activeTenant } = useTenant();
  const canViewSupplier = isOwner || activeTenant?.is_owner || activeTenant?.permissions?.includes('inventory.view_supplier');

  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'transfers' | 'deficits' | 'movements'
  const [transfers, setTransfers] = useState([]);
  const [transferTargets, setTransferTargets] = useState([]);
  const [deficitsList, setDeficitsList] = useState([]);
  const [deficitCount, setDeficitCount] = useState(0);
  const [deficitSearch, setDeficitSearch] = useState('');
  const [categories, setCategories] = useState([]);
  const [loadingOther, setLoading] = useState(false);
  const STOCK_PAGE_SIZE = 25;
  const MOVEMENT_PAGE_SIZE = 25;
  const [inventoryFilters, setInventoryFilters, resetInventoryFilters] = usePersistedState(
    `ilbi_inventory_filters_v2:${activeTenant?.id || 'pending'}`,
    DEFAULT_INVENTORY_FILTERS
  );

  const stockSearch = useDebouncedValue(inventoryFilters.stockSearch.trim());
  const movementSearch = useDebouncedValue(inventoryFilters.movementSearch.trim());
  const stockParams = {
    search: stockSearch,
    category: inventoryFilters.stockCategory === 'all' ? undefined : inventoryFilters.stockCategory,
    sort: inventoryFilters.stockSort,
  };
  const { items: stockList, total: stockCount, page: stockPage, setPage: setStockPage,
    refresh: refreshStock, loading: loadingStock, error: stockError } = usePaginatedList(
    inventoryApi.getStock, stockParams,
    { tenantId: activeTenant?.id, pageSize: STOCK_PAGE_SIZE, enabled: activeTab === 'stock' },
  );
  const { items: movements, total: movementCount, page: movementPage, setPage: setMovementPage,
    refresh: refreshMovements, loading: loadingMovements, error: movementError } = usePaginatedList(
    inventoryApi.getMovements,
    { search: movementSearch, type: inventoryFilters.movementType, date: inventoryFilters.movementDate },
    { tenantId: activeTenant?.id, pageSize: MOVEMENT_PAGE_SIZE, enabled: activeTab === 'movements' },
  );
  const loading = loadingOther || loadingStock || loadingMovements;
  useEffect(() => {
    const error = stockError || movementError;
    if (error) toast.error(error.message || 'Ombor ma’lumotlarini yuklab bo‘lmadi.');
  }, [stockError, movementError, toast]);

  // Modals state
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [customerReturnModalOpen, setCustomerReturnModalOpen] = useState(false);
  const [supplierReturnModalOpen, setSupplierReturnModalOpen] = useState(false);
  const [writeOffModalOpen, setWriteOffModalOpen] = useState(false);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedStockDetail, setSelectedStockDetail] = useState(null);

  // Transfer & Price Modal states

  // Rapid Stock Intake state
  const [selectedVariantForIntake, setSelectedVariantForIntake] = useState(null);

  // Form states for Other Modals (Adjust, Return, Write-off)
  const [draftOperation, setDraftOperation] = useState('adjust');
  const stockDraftPrefix = draftOperation === 'adjust' ? 'draft_stock' : `draft_stock_${draftOperation}`;
  const [selectedVariantId, setSelectedVariantId] = useAccountDraft(`${stockDraftPrefix}_variant`, '');
  const [formQuantity, setFormQuantity] = useAccountDraft(`${stockDraftPrefix}_qty`, '');
  const [formDirection, setFormDirection] = useAccountDraft(`${stockDraftPrefix}_direction`, 'in');
  const [selectedBatch, setSelectedBatch] = useAccountDraft(`${stockDraftPrefix}_batch`, '');
  const [formNote, setFormNote] = useAccountDraft(`${stockDraftPrefix}_note`, '');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setSelectedVariantId('');
    setFormQuantity('');
    setFormDirection('in');
    setSelectedBatch('');
    setFormNote('');
  };

  useWorkspaceAction(({ action, search }) => {
    if (search !== null) setInventoryFilters(previous => ({ ...previous, stockSearch: search }));
    if (action === 'intake' && (activeTenant?.is_owner || activeTenant?.permissions?.includes('inventory.add_stock_intake'))) {
      setSelectedVariantForIntake(null); setIntakeModalOpen(true);
    }
    if (action === 'low_stock') { setActiveTab('stock'); setInventoryFilters(previous => ({ ...previous, stockSort: 'qty_asc', stockSearch: '', stockCategory: 'all' })); }
  });

  const handleQuickIntake = (variantId) => {
    setSelectedVariantForIntake(variantId);
    setIntakeModalOpen(true);
  };

  const refreshDeficitCount = useCallback(async () => {
    try {
      const res = await inventoryApi.getDeficits();
      const list = res.results || res;
      setDeficitCount(Array.isArray(list) ? list.length : 0);
    } catch {
      // ignore
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'stock') {
        refreshStock();
      } else if (activeTab === 'transfers') {
        const [res, availableTargets] = await Promise.all([
          inventoryApi.getTransfers(), tenantApi.getTransferTargets(),
        ]);
        const list = res.results || res;
        setTransfers(Array.isArray(list) ? list : []);
        setTransferTargets(Array.isArray(availableTargets) ? availableTargets : []);
      } else if (activeTab === 'deficits') {
        const res = await inventoryApi.getDeficits(deficitSearch);
        const list = res.results || res;
        const arr = Array.isArray(list) ? list : [];
        setDeficitsList(arr);
        setDeficitCount(arr.length);
      } else if (activeTab === 'movements') {
        refreshMovements();
      }
    } catch {
      toast.error('Ombor ma’lumotlarini yuklashda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  }, [activeTab, activeTenant?.id, deficitSearch, toast, refreshStock, refreshMovements]);

  useEffect(() => {
    if (activeTab !== 'stock' && activeTab !== 'movements') loadData();
  }, [loadData, activeTab]);

  useEffect(() => {
    refreshDeficitCount();
    let active = true;
    catalogApi.getCategories().then((res) => {
      if (active) setCategories(res.results || res);
    }).catch(() => {});
    return () => { active = false; };
  }, [activeTenant?.id, refreshDeficitCount]);

  // Adjust stock (Qoldiqni to‘g‘rilash)
  const handleAdjustSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVariantId || !formQuantity) {
      toast.warning('Variant va miqdorni kiriting');
      return;
    }
    setIsSubmitting(true);
    try {
      await inventoryApi.adjustStock({
        product_variant_id: parseInt(selectedVariantId, 10),
        batch_id: selectedBatch ? Number(selectedBatch) : null,
        quantity: parseFloat(formQuantity),
        direction: formDirection,
        note: formNote || 'Inventarizatsiya natijasi',
      });
      toast.success('Ombor qoldig‘i muvaffaqiyatli to‘g‘rilandi!');
      setAdjustModalOpen(false);
      resetForm();
      loadData();
      refreshDeficitCount();
    } catch (err) {
      toast.error(err.message || 'Tuzatishni saqlashda xatolik yuz berdi');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Customer Return (Mijoz qaytardi)
  const handleCustomerReturnSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVariantId || !formQuantity) {
      toast.warning('Variant va qaytarilgan miqdorni kiriting');
      return;
    }
    setIsSubmitting(true);
    try {
      await inventoryApi.customerReturn({
        product_variant_id: parseInt(selectedVariantId, 10),
        batch_id: selectedBatch ? Number(selectedBatch) : null,
        quantity: parseFloat(formQuantity),
        note: formNote || 'Mijoz tomonidan qaytarildi',
      });
      toast.success('Mijoz qaytargan tovar omborga qo‘shildi!');
      setCustomerReturnModalOpen(false);
      resetForm();
      loadData();
      refreshDeficitCount();
    } catch (err) {
      toast.error(err.message || 'Qaytarishda xatolik');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Supplier Return (Ta’minotchiga qaytarish)
  const handleSupplierReturnSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVariantId || !formQuantity) {
      toast.warning('Variant va qaytariladigan miqdorni kiriting');
      return;
    }
    setIsSubmitting(true);
    try {
      await inventoryApi.supplierReturn({
        product_variant_id: parseInt(selectedVariantId, 10),
        batch_id: selectedBatch ? Number(selectedBatch) : null,
        quantity: parseFloat(formQuantity),
        note: formNote || 'Yetkazib beruvchiga qaytarildi',
      });
      toast.success('Ta’minotchiga tovar muvaffaqiyatli chiqarildi!');
      setSupplierReturnModalOpen(false);
      resetForm();
      loadData();
      refreshDeficitCount();
    } catch (err) {
      toast.error(err.message || 'Chiqarishda xatolik');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Write-Off (Hisobdan chiqarish / Isrofgarchilik)
  const handleWriteOffSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVariantId || !formQuantity) {
      toast.warning('Variant va hisobdan chiqariladigan miqdorni kiriting');
      return;
    }
    setIsSubmitting(true);
    try {
      await inventoryApi.writeOff({
        product_variant_id: parseInt(selectedVariantId, 10),
        batch_id: selectedBatch ? Number(selectedBatch) : null,
        quantity: parseFloat(formQuantity),
        note: formNote || 'Yaroqsiz / Buzilgan / Muddati o‘tgan',
      });
      toast.success('Tovar muvaffaqiyatli hisobdan chiqarildi (Isrofgarchilik)!');
      setWriteOffModalOpen(false);
      resetForm();
      loadData();
      refreshDeficitCount();
    } catch (err) {
      toast.error(err.message || 'Hisobdan chiqarishda xatolik');
    } finally {
      setIsSubmitting(false);
    }
  };

  // View Stock Detail
  const handleOpenDetail = async (stockItem) => {
    const vId = stockItem.product_variant_id || stockItem.product_variant || stockItem.id;
    try {
      const detail = await inventoryApi.getStockDetail(vId);
      setSelectedStockDetail({ ...stockItem, ...detail });
      setDetailModalOpen(true);
    } catch {
      setSelectedStockDetail(stockItem);
      setDetailModalOpen(true);
    }
  };

  const formatQuantity = (qty, unit = 'dona') => {
    const num = Number(qty || 0);
    if (unit === 'dona' || num % 1 === 0) {
      return `${Math.round(num)}`;
    }
    return `${parseFloat(num.toFixed(3))}`;
  };

  const filteredStock = stockList;
  const paginatedStock = stockList;
  const filteredMovements = movements;
  const paginatedMovements = movements;

  const hasActiveStockFilters =
    Boolean(inventoryFilters.stockSearch) ||
    inventoryFilters.stockCategory !== 'all' ||
    inventoryFilters.stockSort !== 'name_asc';

  const hasActiveMovementFilters =
    Boolean(inventoryFilters.movementSearch) ||
    inventoryFilters.movementType !== 'all' ||
    inventoryFilters.movementDate !== 'all';


  // Count items in draft for badge display on "+ Tovar Kirimi" button
  const draftItemsCount = useMemo(() => {
    try {
      const draft = readAccountDraft('stock_intake_full_draft_v1', user?.id, activeTenant?.id, null);
      if (Array.isArray(draft?.items)) return draft.items.length;
    } catch {}
    return 0;
  }, [intakeModalOpen, user?.id, activeTenant?.id]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Bar with Actions & Tabs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Row 1: Section Tabs */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, background: 'var(--bg-card)', padding: 4, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveTab('stock')}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: activeTab === 'stock' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'stock' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Ombor Qoldiqlari
            </button>
            <button
              onClick={() => setActiveTab('transfers')}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: activeTab === 'transfers' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'transfers' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>Transferlar</span>
              {transfers.filter((t) => t.status === 'pending' && String(t.destination_tenant) === String(activeTenant?.id)).length > 0 && (
                <span
                  style={{
                    fontSize: 10.5,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: activeTab === 'transfers' ? 'rgba(0,0,0,0.1)' : 'var(--accent-amber)',
                    color: activeTab === 'transfers' ? 'var(--text-on-primary)' : 'var(--on-warning)',
                    fontWeight: 800,
                  }}
                >
                  {transfers.filter((t) => t.status === 'pending' && String(t.destination_tenant) === String(activeTenant?.id)).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('deficits')}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: activeTab === 'deficits' ? 'var(--accent-rose)' : 'transparent',
                color: activeTab === 'deficits' ? 'var(--on-danger)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span>Kamchiliklar</span>
              {deficitCount > 0 && (
                <span
                  style={{
                    fontSize: 10.5,
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: activeTab === 'deficits' ? 'rgba(0,0,0,0.1)' : 'var(--accent-rose)',
                    color: 'var(--on-danger)',
                    fontWeight: 800,
                  }}
                >
                  {deficitCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('movements')}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: activeTab === 'movements' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'movements' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Harakatlar Tarixi
            </button>
            <button
              onClick={() => setActiveTab('batches')}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: activeTab === 'batches' ? 'var(--primary)' : 'transparent',
                color: activeTab === 'batches' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              Partiyalar va yaroqlilik
            </button>
          </div>
        </div>

        {/* Row 2: Action Buttons - ALWAYS stays cleanly below the tabs on all sections */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {activeTab === 'stock' && isOwner && <>
            <ExcelExportButton endpoint="/inventory/stock/export/" params={{ scope: 'all' }}
              filename="ilbi-butun-ombor.xlsx" disabled={loading}
              label="Butun omborni Excelga yuklash"
              title="Tanlangan do‘konning barcha ombor mahsulotlarini qidiruv va filtrlardan qat’i nazar yuklash" />
            {(inventoryFilters.stockSearch.trim() || inventoryFilters.stockCategory !== 'all') &&
              <ExcelExportButton endpoint="/inventory/stock/export/" params={stockParams}
                filename="ilbi-ombor-filtrlangan.xlsx" disabled={loading} label="Filtrlangan ro‘yxatni yuklash" />}
          </>}
          <button
            onClick={() => {
              setSelectedVariantForIntake(null);
              setIntakeModalOpen(true);
            }}
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              boxShadow: 'var(--primary-glow)',
            }}
          >
            <PackagePlus size={16} />
            <span>+ Tovar Kirimi</span>
            {draftItemsCount > 0 && (
              <span
                style={{
                  background: 'rgba(255, 255, 255, 0.28)',
                  padding: '1px 6px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 800,
                }}
                title="Saqlangan qoralamada tovarlar mavjud"
              >
                {draftItemsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => { setDraftOperation('adjust'); setAdjustModalOpen(true); }}
            style={{
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RefreshCw size={14} />
            <span>Tuzatish</span>
          </button>

          <button
            onClick={() => { setDraftOperation('customer_return'); setCustomerReturnModalOpen(true); }}
            title="Cheksiz ombor kirimi — rasmiy chek bo‘yicha qaytarish 'Sotuvlar' bo‘limida amalga oshiriladi"
            style={{
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RotateCcw size={14} />
            <span>Mijoz Qaytardi (Cheksiz)</span>
          </button>

          <button
            onClick={() => { setDraftOperation('supplier_return'); setSupplierReturnModalOpen(true); }}
            style={{
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-card)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Truck size={14} />
            <span>Ta’minotchiga Qaytarish</span>
          </button>

          <button
            onClick={() => { setDraftOperation('write_off'); setWriteOffModalOpen(true); }}
            style={{
              padding: '9px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(var(--danger-rgb), 0.3)',
              background: 'rgba(var(--danger-rgb), 0.08)',
              color: 'var(--accent-rose)',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Trash2 size={14} />
            <span>Isrofgarchilik</span>
          </button>
        </div>
      </div>

      {/* Filter Bar for Stock Tab */}
      {activeTab === 'stock' && (
        <div
          className="glass-card"
          style={{
            padding: '12px 18px',
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap',
            background: 'var(--bg-card)',
            position: 'relative',
            zIndex: 10,
          }}
        >
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
              <input data-api-field="stockSearch"
                type="text"
                placeholder="Tovar nomi, SKU, shtrix-kod yoki 3 bosqichli kod..."
                value={inventoryFilters.stockSearch}
                onChange={(e) => setInventoryFilters({ ...inventoryFilters, stockSearch: e.target.value })}
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

            {/* Category Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Kategoriya:</span>
              <CustomSelect
                value={
                  categories.some((c) => String(c.id) === String(inventoryFilters.stockCategory))
                    ? categories.find((c) => String(c.id) === String(inventoryFilters.stockCategory))?.name || inventoryFilters.stockCategory
                    : inventoryFilters.stockCategory
                }
                onChange={(val) => setInventoryFilters({ ...inventoryFilters, stockCategory: val })}
                options={[
                  { value: 'all', label: 'Barcha kategoriyalar' },
                  ...categories.map((c) => ({ value: c.name, label: c.name })),
                ]}
                size="md"
                style={{ minWidth: 170 }}
              />
            </div>

            {/* Sort Order */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CustomSelect data-api-field="stockSort"
                icon={ArrowUpDown}
                value={inventoryFilters.stockSort}
                onChange={(val) => setInventoryFilters({ ...inventoryFilters, stockSort: val })}
                options={[
                  { value: 'name_asc', label: 'Nomi bo‘yicha (A-Z)' },
                  { value: 'name_desc', label: 'Nomi bo‘yicha (Z-A)' },
                  { value: 'qty_desc', label: 'Qoldiq: Ko‘pdan ozga' },
                  { value: 'qty_asc', label: 'Qoldiq: Ozdan ko‘pga' },
                  { value: 'price_desc', label: 'Tan narx: Qimmatdan' },
                  { value: 'price_asc', label: 'Tan narx: Arzondan' },
                ]}
                size="md"
                style={{ minWidth: 190 }}
              />
            </div>

            {/* Clear filters button */}
            {hasActiveStockFilters && (
              <button
                type="button"
                onClick={resetInventoryFilters}
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
                <span>Tozalash</span>
              </button>
            )}

            <div
              style={{
                marginLeft: 'auto',
                padding: '6px 12px',
                borderRadius: 'var(--radius-xs)',
                background: 'var(--bg-app)',
                border: '1px solid var(--border-subtle)',
                fontSize: 12,
                color: 'var(--text-secondary)',
                whiteSpace: 'nowrap',
              }}
            >
              Topildi: <strong style={{ color: 'var(--text-primary)' }}>{stockCount}</strong> ta tovar
            </div>
        </div>
      )}

      {/* Filter & Info Bar for Deficits Tab */}
      {activeTab === 'deficits' && (
        <div
          className="glass-card"
          style={{
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--bg-card)',
          }}
        >
          {/* Explanation banner */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(var(--danger-rgb), 0.08)',
              border: '1px solid rgba(var(--danger-rgb), 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            <AlertTriangle size={18} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} />
            <div>
              <strong style={{ color: 'var(--text-primary)' }}>Kamchiliklar mezoni:</strong> So‘nggi 30 kun ichida kamida <strong style={{ color: 'var(--primary)' }}>10 ta sotilgan</strong> va ayni paytda ombordagi qoldig‘i <strong style={{ color: 'var(--accent-rose)' }}>5 yoki undan kam qolgan (≤5)</strong> tovarlar. Yangi tovar kirimi qilinib, qoldiq 5 tadan oshsa, tovar ushbu ro‘yxatdan avtomatik ravishda chiqib ketadi.
            </div>
          </div>

          {/* Row: Search & Refresh */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
              <input
                type="text"
                placeholder="Kamchilik tovar nomi, kodi yoki shtrix-kodi bo‘yicha izlash..."
                value={deficitSearch}
                onChange={(e) => setDeficitSearch(e.target.value)}
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

            {deficitSearch && (
              <button
                type="button"
                onClick={() => setDeficitSearch('')}
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
                <span>Tozalash</span>
              </button>
            )}

            <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
              Kamchiliklar: <strong style={{ color: 'var(--accent-rose)' }}>{deficitsList.length}</strong> ta tovar
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar for Movements Tab */}
      {activeTab === 'movements' && (
        <div
          className="glass-card"
          style={{
            padding: '16px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            background: 'var(--bg-card)',
            position: 'relative',
            zIndex: 10,
          }}
        >
          {/* Row 1: Search, Movement Type, Reset */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
              <input data-api-field="movementSearch"
                type="text"
                placeholder="Tovar nomi yoki harakat izohi bo‘yicha izlash..."
                value={inventoryFilters.movementSearch}
                onChange={(e) => setInventoryFilters({ ...inventoryFilters, movementSearch: e.target.value })}
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

            {/* Movement Type Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Harakat turi:</span>
              <CustomSelect data-api-field="movementType"
                value={inventoryFilters.movementType}
                onChange={(val) => setInventoryFilters({ ...inventoryFilters, movementType: val })}
                options={[
                  { value: 'all', label: 'Barcha harakatlar' },
                  { value: 'kirim', label: 'Kirim (Intake)' },
                  { value: 'sotuv', label: 'Sotuv (Sale)' },
                  { value: 'mijoz_qaytardi', label: 'Mijoz qaytardi' },
                  { value: 'yetkazib_beruvchiga_qaytarish', label: 'Yetkazib beruvchiga qaytarish' },
                  { value: 'tuzatish', label: 'Tuzatish (Adjustment)' },
                  { value: 'isrofgarchilik', label: 'Isrofgarchilik (Write-off)' },
                ]}
                size="md"
                style={{ minWidth: 180 }}
              />
            </div>

            {/* Clear filters button */}
            {hasActiveMovementFilters && (
              <button
                type="button"
                onClick={resetInventoryFilters}
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
                <span>Tozalash</span>
              </button>
            )}
          </div>

          {/* Row 2: Date presets for Movements */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
            <CalendarDays size={14} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>Sana:</span>
            {[
              { id: 'all', label: 'Barchasi' },
              { id: 'today', label: 'Bugun' },
              { id: 'yesterday', label: 'Kecha' },
              { id: 'week', label: 'Oxirgi 7 kun' },
              { id: 'month', label: 'Shu oy' },
            ].map((p) => {
              const isSelected = inventoryFilters.movementDate === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setInventoryFilters({ ...inventoryFilters, movementDate: p.id })}
                  style={{
                    padding: '5px 12px',
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
                  {p.label}
                </button>
              );
            })}

            <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
              Topildi: <strong style={{ color: 'var(--text-primary)' }}>{movementCount}</strong> ta harakat
            </div>
          </div>
        </div>
      )}

      {/* Main Table View */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-responsive">
          {activeTab === 'batches' ? <StockBatchesPanel /> : activeTab === 'stock' ? (
            <table style={{ width: '100%', minWidth: 800, borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                  <th style={{ padding: '14px 20px', whiteSpace: 'nowrap' }}>Tovar Varianti</th>
                  <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Tovar Kodi</th>
                  <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Filial</th>
                  {canViewSupplier && (
                    <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Ta’minotchi</th>
                  )}
                  <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Oxirgi Tan Narxi</th>
                  <th style={{ padding: '14px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>Mavjud Qoldiq</th>
                  <th style={{ padding: '14px 20px', textAlign: 'center', whiteSpace: 'nowrap' }}>Amallar</th>
                </tr>
              </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canViewSupplier ? 7 : 6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Yuklanmoqda..." /></td>
                </tr>
              ) : filteredStock.length > 0 ? (
                paginatedStock.map((item, idx) => {
                  const qty = Number(item.quantity ?? item.stock_quantity ?? 0);
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s ease' }}>
                      <td style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: qty > 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)' }} />
                          <div>
                            <div>{item.product_name || item.name || `Variant #${item.product_variant || item.id}`}</div>
                            {item.category_name && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.category_name}</span>}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                        {item.code ? (
                          <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{item.code}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <Store size={13} color="var(--primary)" />
                          <span>{item.branch_name || activeTenant?.name || 'Asosiy'}</span>
                        </span>
                      </td>
                      {canViewSupplier && (
                        <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                          {item.supplier ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '4px 9px',
                                borderRadius: 'var(--radius-xs)',
                                background: 'rgba(59, 130, 246, 0.12)',
                                color: '#60a5fa',
                                fontSize: 12,
                                fontWeight: 600,
                                border: '1px solid rgba(59, 130, 246, 0.25)',
                              }}
                            >
                              <Truck size={12} />
                              {item.supplier}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                          )}
                        </td>
                      )}
                      <td style={{ padding: '14px 16px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {item.last_cost_price ? `${Number(item.last_cost_price).toLocaleString()} ${item.currency || 'UZS'}` : '—'}
                      </td>
                      <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                        <span
                          style={{
                            padding: '4px 12px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: 12,
                            fontWeight: 700,
                            background: qty > 0 ? 'rgba(34, 197, 94, 0.15)' : 'rgba(var(--danger-rgb), 0.15)',
                            color: qty > 0 ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                          }}
                        >
                          {formatQuantity(qty, item.unit)} {item.unit || 'dona'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <button
                            onClick={() => handleOpenDetail(item)}
                            title="Batafsil ko‘rish"
                            style={{
                              padding: '6px 10px',
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
                            <Info size={13} />
                            <span>Batafsil</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={canViewSupplier ? 7 : 6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {hasActiveStockFilters ? 'Tanlangan filtrlar bo‘yicha tovarlar topilmadi' : 'Hozircha omborda qoldiqlar mavjud emas'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : activeTab === 'transfers' ? (
          <TenantTransfersPanel
            activeTenant={activeTenant}
            isOwner={isOwner}
            transfers={transfers}
            targets={transferTargets}
            categories={categories}
            loading={loading}
            reload={loadData}
            toast={toast}
            confirm={confirm}
          />
        ) : activeTab === 'deficits' ? (
          <table style={{ width: '100%', minWidth: 840, borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                <th style={{ padding: '14px 20px', whiteSpace: 'nowrap' }}>Tovar Varianti</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Tovar Kodi</th>
                <th style={{ padding: '14px 16px', textAlign: 'center', whiteSpace: 'nowrap' }}>30 Kundagi Sotuv</th>
                <th style={{ padding: '14px 16px', textAlign: 'center', whiteSpace: 'nowrap' }}>Mavjud Qoldiq</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Holat</th>
                <th style={{ padding: '14px 20px', textAlign: 'center', whiteSpace: 'nowrap' }}>Amallar</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Yuklanmoqda..." /></td>
                </tr>
              ) : deficitsList.length > 0 ? (
                deficitsList.map((item) => {
                  const currentStock = Number(item.current_stock ?? 0);
                  const isZero = currentStock <= 0;
                  return (
                    <tr key={item.id || item.product_variant_id} style={{ borderBottom: '1px solid var(--border-subtle)', transition: 'background 0.15s ease' }}>
                      <td style={{ padding: '14px 20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: isZero ? 'var(--accent-rose)' : 'var(--accent-amber)',
                            }}
                          />
                          <div>
                            <div>{item.full_name || item.product_name}</div>
                            {item.category_name && (
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.category_name}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                        {item.code ? (
                          <span style={{ color: 'var(--primary)', fontWeight: 700 }}>{item.code}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: 'var(--radius-xs)',
                            background: 'rgba(59, 130, 246, 0.12)',
                            color: 'var(--chart-profit)',
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          {formatQuantity(item.total_sold_last_month, item.unit)} {item.unit || 'dona'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                        <span
                          style={{
                            padding: '4px 10px',
                            borderRadius: 'var(--radius-xs)',
                            background: isZero ? 'rgba(var(--danger-rgb), 0.15)' : 'rgba(var(--primary-rgb), 0.15)',
                            color: isZero ? 'var(--accent-rose)' : 'var(--accent-amber)',
                            fontWeight: 800,
                            fontSize: 13,
                          }}
                        >
                          {formatQuantity(currentStock, item.unit)} {item.unit || 'dona'}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-xs)',
                            fontSize: 11,
                            fontWeight: 700,
                            background: isZero ? 'rgba(var(--danger-rgb), 0.12)' : 'rgba(var(--primary-rgb), 0.12)',
                            color: isZero ? 'var(--accent-rose)' : 'var(--accent-amber)',
                          }}
                        >
                          <AlertTriangle size={12} />
                          {isZero ? 'Tugagan (0 dona)' : `Kam qolgan (${formatQuantity(currentStock, item.unit)} dona)`}
                        </span>
                      </td>
                      <td style={{ padding: '14px 20px', textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => handleQuickIntake(item.product_variant_id || item.id)}
                          style={{
                            padding: '7px 14px',
                            borderRadius: 'var(--radius-sm)',
                            border: 'none',
                            background: 'var(--primary)',
                            color: 'var(--primary-foreground)',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            boxShadow: 'var(--primary-glow)',
                          }}
                        >
                          <PackagePlus size={14} />
                          <span>Kirim qilish</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <CheckCircle2 size={32} color="var(--accent-emerald)" />
                      <strong style={{ color: 'var(--text-primary)', fontSize: 15 }}>
                        {deficitSearch ? 'Qidiruv bo‘yicha kamchilik tovarlar topilmadi' : 'Ayni damda kamayib qolgan tovarlar mavjud emas!'}
                      </strong>
                      <span style={{ fontSize: 13, maxWidth: 460 }}>
                        {deficitSearch
                          ? 'Boshqa so‘z yoki kod bilan qidirib ko‘ring'
                          : 'Barcha talabgir tovarlar omborda 5 tadan ortiq yetarli miqdorda mavjud.'}
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                <th style={{ padding: '14px 20px', whiteSpace: 'nowrap' }}>Harakat Turi</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Tovar</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Yo‘nalish / Miqdor</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Tan Narxi</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Izoh</th>
                <th style={{ padding: '14px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>Sana</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Yuklanmoqda..." /></td>
                </tr>
              ) : filteredMovements.length > 0 ? (
                paginatedMovements.map((m) => {
                  const isIn = m.direction === 'in';
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px' }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '4px 8px',
                            borderRadius: 'var(--radius-xs)',
                            background: isIn ? 'rgba(34, 197, 94, 0.12)' : 'rgba(var(--danger-rgb), 0.12)',
                            color: isIn ? 'var(--accent-emerald)' : 'var(--accent-rose)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {isIn ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                          {m.type_display || m.movement_type || m.type}
                        </span>
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {m.product_name ? `${m.product_name} (${m.variant_name || 'Standart'})` : (m.product_variant_name || m.variant_name || `Variant #${m.product_variant}`)}
                      </td>
                      <td style={{ padding: '14px 16px', fontWeight: 700, color: isIn ? 'var(--accent-emerald)' : 'var(--accent-rose)' }}>
                        {isIn ? `+${formatQuantity(m.quantity, m.unit)}` : `-${formatQuantity(m.quantity, m.unit)}`} {m.unit || 'dona'}
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>
                        {m.cost_price ? `${Number(m.cost_price).toLocaleString()} ${m.currency || 'UZS'}` : '—'}
                      </td>
                      <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                        {canViewSupplier && m.supplier && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 7px',
                              borderRadius: 4,
                              background: 'rgba(var(--primary-rgb), 0.1)',
                              color: 'var(--primary)',
                              fontWeight: 600,
                              fontSize: 11,
                              marginRight: 6,
                            }}
                            title="Ta’minotchi"
                          >
                            <Truck size={11} />
                            {m.supplier}
                          </span>
                        )}
                        {m.note || m.reason || (!m.supplier ? '—' : '')}
                      </td>
                      <td style={{ padding: '14px 20px', textAlign: 'right', color: 'var(--text-secondary)', fontSize: 12 }}>
                        {new Date(m.created_at).toLocaleString('uz-UZ')}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {hasActiveMovementFilters ? 'Tanlangan filtrlar bo‘yicha harakatlar topilmadi' : 'Harakatlar tarixi mavjud emas'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        </div>
      </div>

      {/* Pagination Controls for Stock Tab */}
      {activeTab === 'stock' && stockCount > STOCK_PAGE_SIZE && (
        <Pagination
          currentPage={stockPage}
          totalItems={stockCount}
          pageSize={STOCK_PAGE_SIZE}
          onPageChange={setStockPage}
        />
      )}

      {/* Pagination Controls for Movements Tab */}
      {activeTab === 'movements' && movementCount > MOVEMENT_PAGE_SIZE && (
        <Pagination
          currentPage={movementPage}
          totalItems={movementCount}
          pageSize={MOVEMENT_PAGE_SIZE}
          onPageChange={setMovementPage}
        />
      )}

      {/* Rapid POS-Style Barcode & Keyboard Stream Intake Workspace with Persisted Draft */}
      <RapidStockIntakeModal
        isOpen={intakeModalOpen}
        onClose={() => {
          setIntakeModalOpen(false);
          setSelectedVariantForIntake(null);
        }}
        onSuccess={() => {
          loadData();
          refreshDeficitCount();
        }}
        categories={categories}
        preselectedVariantId={selectedVariantForIntake}
      />

      {/* Modal 2: Qoldiqni To‘g‘rilash (Stock Adjust) */}
      <Modal isOpen={adjustModalOpen} onClose={() => setAdjustModalOpen(false)} title="Ombor Qoldig‘ini Tuzatish" maxWidth={760}>
        <form onSubmit={handleAdjustSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BatchSelector variantId={selectedVariantId} data-api-field="batch_id" value={selectedBatch} onChange={setSelectedBatch} allowEmpty={formDirection === 'in'} />
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Tovar Varianti *
            </label>
            <RemoteVariantSelect
              enabled={adjustModalOpen}
              data-api-field="product_variant_id" required value={selectedVariantId}
              onChange={(val) => { setSelectedVariantId(val); setSelectedBatch(''); }}
              placeholder="Tovarni tanlang..."
              
              fullWidth
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Yo‘nalish *
              </label>
              <CustomSelect
                data-api-field="direction" value={formDirection}
                onChange={(val) => setFormDirection(val)}
                options={[
                  { value: 'in', label: '+ Qo‘shish (Ortiqcha topildi)' },
                  { value: 'out', label: '- Ayirish (Kamomad/Yetishmovchilik)' },
                ]}
                fullWidth
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Miqdor (dona) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                placeholder="Masalan: 5"
                data-api-field="quantity" value={formQuantity}
                onChange={(e) => setFormQuantity(e.target.value)}
                required
                style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Tuzatish Sababi / Izoh
            </label>
            <input
              type="text"
              placeholder="Masalan: Yillik inventarizatsiya natijasi"
              data-api-field="note" value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setAdjustModalOpen(false)}
              style={{ padding: '10px 18px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{ padding: '10px 22px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'var(--primary-foreground)', fontWeight: 700, cursor: 'pointer' }}
            >
              {isSubmitting ? 'Saqlanmoqda...' : 'Tuzatishni Tasdiqlash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 3: Mijoz Qaytardi (Customer Return) */}
      <Modal isOpen={customerReturnModalOpen} onClose={() => setCustomerReturnModalOpen(false)} title="Mijozdan Tovarni Qaytarib Olish (Cheksiz)" maxWidth={760}>
        <form onSubmit={handleCustomerReturnSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BatchSelector variantId={selectedVariantId} data-api-field="batch_id" value={selectedBatch} onChange={setSelectedBatch} allowEmpty={true} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 'var(--radius-sm)', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.25)', color: '#93c5fa', fontSize: 13 }}>
            <Info size={18} style={{ flexShrink: 0, marginTop: 2, color: '#60a5fa' }} />
            <div>
              <strong>Eslatma:</strong> Bu amal ombor qoldig‘ini qo‘lda/cheksiz oshirish uchun xizmat qiladi.
              <div style={{ marginTop: 4, color: 'var(--text-secondary)' }}>
                Agar mijoz rasmiy sotuv cheki bo‘yicha tovarni qaytargan bo‘lsa, pulni kassadan chiqarish yoki mijoz qarzini to‘g‘ri kamaytirish uchun <strong>"Sotuvlar"</strong> bo‘limidagi chekdan <strong>"Bekor qilish (Void)"</strong> tugmasidan foydalaning.
              </div>
            </div>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Qaytarilgan Variant *
            </label>
            <RemoteVariantSelect
              enabled={customerReturnModalOpen}
              data-api-field="product_variant_id" required value={selectedVariantId}
              onChange={(val) => { setSelectedVariantId(val); setSelectedBatch(''); }}
              placeholder="Tovarni tanlang..."
              
              fullWidth
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Qaytarilgan Miqdor (dona) *
            </label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              placeholder="Masalan: 1"
              data-api-field="quantity" value={formQuantity}
              onChange={(e) => setFormQuantity(e.target.value)}
              required
              style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Qaytarish Sababi / Chek raqami
            </label>
            <input
              type="text"
              placeholder="Masalan: Chek #582, o‘lchami to‘g‘ri kelmadi"
              data-api-field="note" value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setCustomerReturnModalOpen(false)}
              style={{ padding: '10px 18px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{ padding: '10px 22px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'var(--primary-foreground)', fontWeight: 700, cursor: 'pointer' }}
            >
              {isSubmitting ? 'Qabul qilinmoqda...' : 'Qaytarishni Saqlash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 4: Ta’minotchiga Qaytarish (Supplier Return) */}
      <Modal isOpen={supplierReturnModalOpen} onClose={() => setSupplierReturnModalOpen(false)} title="Ta’minotchiga Tovarni Qaytarish" maxWidth={760}>
        <form onSubmit={handleSupplierReturnSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BatchSelector variantId={selectedVariantId} data-api-field="batch_id" value={selectedBatch} onChange={setSelectedBatch} allowEmpty={false} />
          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Qaytariladigan Variant *
            </label>
            <RemoteVariantSelect
              enabled={supplierReturnModalOpen}
              data-api-field="product_variant_id" required value={selectedVariantId}
              onChange={(val) => { setSelectedVariantId(val); setSelectedBatch(''); }}
              placeholder="Tovarni tanlang..."
              
              fullWidth
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Chiqariladigan Miqdor (dona) *
            </label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              placeholder="Masalan: 10"
              data-api-field="quantity" value={formQuantity}
              onChange={(e) => setFormQuantity(e.target.value)}
              required
              style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Izoh / Sabab / Ta’minotchi nomi
            </label>
            <input
              type="text"
              placeholder="Masalan: Zavod braki, Ta’minotchi bilan kelishildi"
              data-api-field="note" value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setSupplierReturnModalOpen(false)}
              style={{ padding: '10px 18px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{ padding: '10px 22px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'var(--primary-foreground)', fontWeight: 700, cursor: 'pointer' }}
            >
              {isSubmitting ? 'Chiqarilmoqda...' : 'Chiqarishni Tasdiqlash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 5: Write-off / Hisobdan chiqarish */}
      <Modal isOpen={writeOffModalOpen} onClose={() => setWriteOffModalOpen(false)} title="Hisobdan Chiqarish (Isrofgarchilik)" maxWidth={760}>
        <form onSubmit={handleWriteOffSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BatchSelector variantId={selectedVariantId} data-api-field="batch_id" value={selectedBatch} onChange={setSelectedBatch} allowEmpty={false} />
          <div style={{ padding: 12, borderRadius: 'var(--radius-xs)', background: 'rgba(var(--danger-rgb), 0.1)', border: '1px solid rgba(var(--danger-rgb), 0.2)', color: 'var(--accent-rose)', fontSize: 13 }}>
            Diqqat: Ushbu amal tovarlarni ombordan butunlay hisobdan chiqaradi va tizim auditiga qayd etiladi.
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Hisobdan chiqariladigan Variant *
            </label>
            <RemoteVariantSelect
              enabled={writeOffModalOpen}
              data-api-field="product_variant_id" required value={selectedVariantId}
              onChange={(val) => { setSelectedVariantId(val); setSelectedBatch(''); }}
              placeholder="Tovarni tanlang..."
              
              fullWidth
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Hisobdan chiqariladigan Miqdor *
            </label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              placeholder="Masalan: 3"
              data-api-field="quantity" value={formQuantity}
              onChange={(e) => setFormQuantity(e.target.value)}
              required
              style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Sabab (Buzilgan, Yaroqsiz, Siniq) *
            </label>
            <input
              type="text"
              placeholder="Masalan: Tashish paytida sindi"
              data-api-field="note" value={formNote}
              onChange={(e) => setFormNote(e.target.value)}
              required
              style={{ width: '100%', padding: '12px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-card)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14, outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setWriteOffModalOpen(false)}
              style={{ padding: '10px 18px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Bekor qilish
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{ padding: '10px 22px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--accent-rose)', color: 'var(--on-danger)', fontWeight: 700, cursor: 'pointer' }}
            >
              {isSubmitting ? 'Chiqarilmoqda...' : 'Hisobdan Chiqarish'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal 6: Variant Stock Detail */}
      <Modal isOpen={detailModalOpen} onClose={() => setDetailModalOpen(false)} title="Ombor Qoldig‘i Tafsilotlari" maxWidth={500}>
        {selectedStockDetail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 20,
                padding: '16px 18px',
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-card)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <h4
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    wordBreak: 'break-word',
                    lineHeight: 1.35,
                  }}
                >
                  {selectedStockDetail.product_name || selectedStockDetail.name || `Variant #${selectedStockDetail.product_variant || selectedStockDetail.id}`}
                </h4>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  SKU: {selectedStockDetail.sku || 'Mavjud emas'}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                  {selectedStockDetail.quantity ?? selectedStockDetail.stock_quantity ?? 0} dona
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Mavjud qoldiq</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: canViewSupplier && selectedStockDetail.supplier ? 'repeat(auto-fit, minmax(130px, 1fr))' : '1fr 1fr', gap: 12 }}>
              <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Oxirgi Tan Narxi</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {selectedStockDetail.last_cost_price ? `${Number(selectedStockDetail.last_cost_price).toLocaleString()} UZS` : 'Kiritilmagan'}
                </div>
              </div>
              <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Kategoriya</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                  {selectedStockDetail.category_name || 'Bosh kategoriya'}
                </div>
              </div>
              {canViewSupplier && selectedStockDetail.supplier && (
                <div style={{ padding: '14px 16px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Truck size={12} style={{ color: 'var(--primary)' }} />
                    Ta’minotchi
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary)' }}>
                    {selectedStockDetail.supplier}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setDetailModalOpen(false)}
                style={{
                  padding: '10px 22px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
              >
                Yopish
              </button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  );
}
