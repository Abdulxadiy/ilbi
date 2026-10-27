import { useWorkspaceAction } from '../hooks/useWorkspaceAction';
import IlbiLoader from '../components/common/IlbiLoader';
import { useDebouncedValue, usePaginatedList } from '../hooks/usePaginatedList';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Package,
  Search,
  Plus,
  Edit2,
  Archive,
  Image as ImageIcon,
  Tag,
  DollarSign,
  Barcode,
  Sparkles,
  Info,
  Trash2,
  FolderTree,
  X,
  PackagePlus,
  RotateCcw,
  Camera,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { catalogApi, inventoryApi, resolveMediaUrl } from '../api/client';
import { localStore } from '../utils/brandStorage.js';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';

const supplierStorageKey = (tenantId) => `ilbi_saved_suppliers:${tenantId || 'pending'}`;
import Modal from '../components/common/Modal';
import CustomSelect from '../components/common/CustomSelect';
import CustomDatePicker from '../components/common/CustomDatePicker';
import Pagination from '../components/common/Pagination';
import ProductToolsModal from '../components/common/ProductToolsModal';
import CatalogImportModal from '../components/common/CatalogImportModal';
import ProductLabelsModal from '../components/common/ProductLabelsModal';
import PriceInput from '../components/common/PriceInput';
import FiscalMetadataFields from '../components/common/FiscalMetadataFields';
import CameraBarcodeScanner from '../components/common/CameraBarcodeScanner';
import { useAccountDraft } from '../hooks/useAccountDraft';
import { useAccountDraftFile } from '../hooks/useAccountDraftFile';
import { useTenant } from '../context/TenantContext';
import { useAuth } from '../hooks/useAuth';

const defaultProductForm = {
  name: '',
  category_id: '',
  unit: 'dona',
  variant_name: 'Standart',
  code: '',
  barcode: '',
  mxik: '',
  package_code: '',
  price_partner: '',
  price_min: '',
  price_recommended: '',
  do_intake: false,
  intake_quantity: '',
  intake_cost_price: '',
  intake_supplier: '',
  intake_note: '',
  intake_expires_on: '',
  intake_batch_code: '',
};

const defaultCategoryForm = {
  name: '',
  kod: '',
  parent_id: '',
  currency: 'UZS',
};

function ProductCardImageCarousel({ variant, isOutOfStock, stockQty }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const touchStartX = useRef(null);

  // Compute all available images (from variant.images array or fallback to variant.image)
  const images = useMemo(() => {
    if (Array.isArray(variant?.images) && variant.images.length > 0) {
      return variant.images.filter(Boolean);
    }
    if (variant?.image) {
      return [variant.image];
    }
    return [];
  }, [variant?.images, variant?.image]);

  const total = images.length;

  const handlePrev = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  };

  const handleNext = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % total);
  };

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = (e) => {
    if (touchStartX.current === null || total <= 1) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (diff > 35) {
      setCurrentIndex((prev) => (prev + 1) % total);
    } else if (diff < -35) {
      setCurrentIndex((prev) => (prev - 1 + total) % total);
    }
    touchStartX.current = null;
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        height: 150,
        borderRadius: 12,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
        padding: 8,
        userSelect: 'none',
      }}
    >
      {/* Category Pill Tag */}
      <span
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          fontSize: 10,
          fontWeight: 700,
          padding: '2px 7px',
          borderRadius: 6,
          background: 'rgba(12, 10, 9, 0.75)',
          color: '#fff',
          backdropFilter: 'blur(4px)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          zIndex: 3,
        }}
      >
        {variant.category_name || 'Kategoriyasiz'}
      </span>

      {/* Stock Pill Badge */}
      <span
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          fontSize: 10.5,
          fontWeight: 700,
          padding: '3px 8px',
          borderRadius: 999,
          background: isOutOfStock
            ? 'rgba(var(--danger-rgb), 0.92)'
            : 'rgba(var(--success-rgb), 0.92)',
          color: isOutOfStock ? 'var(--on-danger)' : 'var(--on-success)',
          backdropFilter: 'blur(4px)',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
          zIndex: 3,
        }}
      >
        {stockQty} {variant.unit || 'dona'}
      </span>

      {/* Main Image or Carousel */}
      {total > 0 ? (
        <img
          key={images[currentIndex % total]}
          src={resolveMediaUrl(images[currentIndex % total])}
          alt={`${variant.product_name || variant.name} (${(currentIndex % total) + 1}/${total})`}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
            const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon');
            if (fallback) fallback.style.display = 'flex';
          }}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
            display: 'block',
            transition: 'opacity 0.2s ease',
          }}
        />
      ) : null}

      <div
        className="fallback-icon"
        style={{
          display: total > 0 ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
        }}
      >
        <Package size={38} color="var(--primary)" opacity={0.6} />
      </div>

      {/* Carousel Controls (if multiple images) */}
      {total > 1 && (
        <>
          {/* Previous Arrow */}
          <button
            type="button"
            onClick={handlePrev}
            style={{
              position: 'absolute',
              left: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(12, 10, 9, 0.68)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 4,
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              padding: 0,
              transition: 'background 0.15s ease, transform 0.15s ease',
            }}
            title="Oldingi rasm"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(12, 10, 9, 0.95)'; e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(12, 10, 9, 0.68)'; e.currentTarget.style.transform = 'translateY(-50%) scale(1)'; }}
          >
            <ChevronLeft size={16} />
          </button>

          {/* Next Arrow */}
          <button
            type="button"
            onClick={handleNext}
            style={{
              position: 'absolute',
              right: 6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: 'rgba(12, 10, 9, 0.68)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 4,
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              padding: 0,
              transition: 'background 0.15s ease, transform 0.15s ease',
            }}
            title="Keyingi rasm"
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(12, 10, 9, 0.95)'; e.currentTarget.style.transform = 'translateY(-50%) scale(1.1)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(12, 10, 9, 0.68)'; e.currentTarget.style.transform = 'translateY(-50%) scale(1)'; }}
          >
            <ChevronRight size={16} />
          </button>

          {/* Dots Indicator */}
          <div
            style={{
              position: 'absolute',
              bottom: 6,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px',
              borderRadius: 999,
              background: 'rgba(12, 10, 9, 0.65)',
              backdropFilter: 'blur(4px)',
              zIndex: 4,
            }}
          >
            {images.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setCurrentIndex(idx);
                }}
                style={{
                  width: idx === (currentIndex % total) ? 12 : 5,
                  height: 5,
                  borderRadius: idx === (currentIndex % total) ? 3 : '50%',
                  background: idx === (currentIndex % total) ? 'var(--primary)' : 'rgba(255, 255, 255, 0.45)',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                title={`${idx + 1}-rasm`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Catalog() {
  const { user, isOwner, isAdmin } = useAuth();
  const { activeTenant } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();

  const userPerms = useMemo(() => {
    const list = [
      ...(Array.isArray(user?.permissions) ? user.permissions : []),
      ...(Array.isArray(activeTenant?.permissions) ? activeTenant.permissions : []),
    ];
    return new Set(list);
  }, [user?.permissions, activeTenant?.permissions]);

  const isSuperUser =
    !user ||
    isOwner ||
    isAdmin ||
    activeTenant?.is_owner ||
    user?.role === 'owner' ||
    user?.role === 'platform_admin' ||
    userPerms.has('*');

  const canChangeProduct =
    isSuperUser ||
    userPerms.has('catalog.change_product') ||
    userPerms.has('change_product');

  const canArchiveProduct =
    isSuperUser ||
    userPerms.has('catalog.archive_product') ||
    userPerms.has('archive_product') ||
    canChangeProduct ||
    (user?.role !== 'kassir');

  const canImport =
    isSuperUser ||
    userPerms.has('catalog.add_product') ||
    userPerms.has('add_product');

  const [toolsProductId, setToolsProductId] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [labelVariant, setLabelVariant] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const [categories, setCategories] = useState([]);
  const [selectedCat, setSelectedCat] = useState('');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'archived'
  const [cameraScannerOpen, setCameraScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState('search'); // 'search' | 'product_barcode' | 'edit_barcode'
  const pageSize = 24;
  const debouncedSearch = useDebouncedValue(search.trim());
  const { items: variants, total: variantCount, page: currentPage, setPage: setCurrentPage,
    refresh: loadVariants, loading: loadingVariants, error: variantError } = usePaginatedList(
    catalogApi.getVariants,
    { category: selectedCat, search: debouncedSearch, archived: activeTab === 'archived' },
    { tenantId: activeTenant?.id, pageSize },
  );
  const paginatedVariants = variants;

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
    const canView = isSuperUser || userPerms.has('inventory.view_supplier') || userPerms.has('view_supplier');
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
  }, [activeTenant?.id, isSuperUser, userPerms]);

  // Modals
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [manageCategoriesModalOpen, setManageCategoriesModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [editProductModalOpen, setEditProductModalOpen] = useState(false);
  const [editPriceModalOpen, setEditPriceModalOpen] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState(null);

  // Forms - Persisted Drafts
  const [productForm, setProductForm, resetProductForm] = useAccountDraft(
    'draft_product',
    defaultProductForm
  );
  const [productImage, setProductImage] = useAccountDraftFile('draft_product_image');
  const [productImagePreview, setProductImagePreview] = useState('');
  useEffect(() => {
    if (!productImage) { setProductImagePreview(''); return; }
    const url = URL.createObjectURL(productImage);
    setProductImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [productImage]);

  const [categoryForm, setCategoryForm, resetCategoryForm] = useAccountDraft(
    'draft_category',
    defaultCategoryForm
  );

  const [editCategoryForm, setEditCategoryForm] = useState({
    name: '',
    kod: '',
    parent_id: '',
    currency: 'UZS',
  });

  const [editProductForm, setEditProductForm] = useState({
    product_id: null,
    variant_id: null,
    name: '',
    category_id: '',
    unit: 'dona',
    code: '',
    barcode: '',
    mxik: '',
    package_code: '',
    price_partner: '',
    price_min: '',
    price_recommended: '',
    current_image: null,
  });
  const [editProductImage, setEditProductImage] = useState(null);

  const [priceForm, setPriceForm] = useState({
    price_recommended: '',
    price_min: '',
    price_partner: '',
    barcode: '',
  });

  const [submitting, setSubmitting] = useState(false);

  const loadCategories = useCallback(async () => {
    try {
      const res = await catalogApi.getCategories();
      const list = res.results || res;
      setCategories(Array.isArray(list) ? list : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadCategories();
  }, [loadCategories, activeTenant?.id]);

  useEffect(() => {
    if (variantError) toast.error(variantError.message || 'Katalogni yuklab bo‘lmadi.');
  }, [variantError, toast]);

  useWorkspaceAction(({ action, search }) => {
    if (search !== null) { setSearch(search); setActiveTab('active'); setSelectedCat(''); }
    if (action === 'import' && canImport) setImportOpen(true);
  });

  useEffect(() => {
    if (searchParams.get('new') === '1' || searchParams.get('action') === 'new_product') {
      setProductModalOpen(true);
      if (searchParams.get('intake') === '1') {
        setProductForm((prev) => ({ ...prev, do_intake: true }));
      }
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('new');
      newParams.delete('action');
      newParams.delete('intake');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams, setSearchParams, setProductForm]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  const handleSearch = (e) => {
    const val = e.target.value;
    setSearch(val);
  };

  const handleCatChange = (e) => {
    const val = e.target.value;
    setSelectedCat(val);
  };

  const handleCameraScan = (code) => {
    const cleanCode = (code || '').trim();
    if (!cleanCode) return;
    if (scannerTarget === 'product_barcode') {
      setProductForm((prev) => ({ ...prev, barcode: cleanCode }));
      toast.success(`Shtrix-kod kiritildi: ${cleanCode}`);
    } else if (scannerTarget === 'edit_barcode') {
      setEditProductForm((prev) => ({ ...prev, barcode: cleanCode }));
      toast.success(`Shtrix-kod kiritildi: ${cleanCode}`);
    } else {
      setSearch(cleanCode);
      toast.info(`"${cleanCode}" shtrix-kodi bo‘yicha qidirilmoqda...`);
    }
  };

  const handleUnarchive = async (id, name) => {
    const isConfirmed = await confirm({
      title: 'Tovarni arxivdan chiqarish',
      message: `"${name}" tovarini arxivdan chiqarmoqchimisiz? U yana POS kassa va faol katalogda ko‘rinadi.`,
      confirmText: 'Arxivdan chiqarish',
      cancelText: 'Bekor qilish',
      type: 'info',
    });
    if (!isConfirmed) return;
    try {
      await catalogApi.unarchiveVariant(id);
      toast.success('Tovar arxivdan chiqarildi');
      loadVariants();
    } catch (err) {
      toast.error(err.message || 'Arxivdan chiqarishda xatolik');
    }
  };

  const formatPrice = (val, cur = 'UZS') => {
    const n = Number(val || 0);
    return cur === 'USD'
      ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `${n.toLocaleString('uz-UZ')} UZS`;
  };


  const calculateSuggestedCode = (catId, minPrice) => {
    const cat = categories.find((c) => c.id === parseInt(catId, 10));
    if (!cat) return '';
    const thousands = Math.floor(Number(minPrice || 0) / (cat.currency === 'USD' ? 1 : 1000));
    if (cat.parent) {
      const parent = categories.find((p) => p.id === cat.parent);
      return `${parent?.kod || '01'}/${cat.kod || '01'}/${thousands}`;
    }
    return `${cat.kod || '01'}/${thousands}`;
  };

  const handleProductCategoryChange = (catId) => {
    const newCode = calculateSuggestedCode(catId, productForm.price_min);
    setProductForm((prev) => ({
      ...prev,
      category_id: catId,
      code: prev.code && prev.category_id ? prev.code : newCode,
    }));
  };

  const handleProductMinPriceChange = (val) => {
    setProductForm((prev) => {
      let newCode = prev.code;
      if (prev.category_id && (!prev.code || prev.code.includes('/'))) {
        const parts = prev.code.split('/');
        const cat = categories.find((c) => c.id === parseInt(prev.category_id, 10));
        const thousands = Math.floor(Number(val || 0) / (cat?.currency === 'USD' ? 1 : 1000));
        if (parts.length >= 2) {
          parts[parts.length - 1] = thousands;
          newCode = parts.join('/');
        } else {
          newCode = calculateSuggestedCode(prev.category_id, val);
        }
      }
      return { ...prev, price_min: val, code: newCode };
    });
  };

  const handleParentCategoryChange = (e) => {
    const parentId = typeof e === 'object' && e !== null && 'target' in e ? e.target.value : e;
    if (parentId) {
      const parent = categories.find((c) => c.id === parseInt(parentId, 10));
      setCategoryForm((prev) => ({
        ...prev,
        parent_id: parentId,
        currency: parent?.currency || 'UZS',
      }));
    } else {
      setCategoryForm((prev) => ({
        ...prev,
        parent_id: '',
      }));
    }
  };

  const getCategoryLabel = (c) => {
    if (c.parent) {
      const parent = categories.find((p) => p.id === c.parent);
      return `${parent ? parent.name + ' > ' : ''}${c.name} [${parent ? parent.kod + '/' : ''}${c.kod}] (${c.currency})`;
    }
    return `${c.name} [${c.kod}] (${c.currency})`;
  };

  // Create Product Submit
  const handleProductSubmit = async (e) => {
    e.preventDefault();
    if (!productForm.name.trim() || !productForm.category_id) {
      toast.warning('Mahsulot nomi va kategoriyasini tanlang');
      return;
    }

    if (productForm.do_intake) {
      if (!productForm.intake_quantity || parseFloat(productForm.intake_quantity) <= 0) {
        toast.warning('Kirim miqdorini to‘g‘ri kiriting');
        return;
      }
      if (productForm.intake_cost_price === '' || parseFloat(productForm.intake_cost_price) < 0) {
        toast.warning('Tovar tan narxini (asl narxini) kiriting');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (productImage) {
        const formData = new FormData();
        formData.append('name', productForm.name.trim());
        formData.append('category_id', productForm.category_id);
        formData.append('unit', productForm.unit);
        formData.append('variant_name', productForm.variant_name || 'Standart');
        formData.append('mxik', productForm.mxik?.trim() || '');
        formData.append('package_code', productForm.package_code?.trim() || '');
        if (productForm.code.trim()) {
          formData.append('code', productForm.code.trim());
        }
        if (productForm.barcode?.trim()) {
          formData.append('barcode', productForm.barcode.trim());
        }
        formData.append('price_partner', productForm.price_partner || '0');
        formData.append('price_min', productForm.price_min || '0');
        formData.append('price_recommended', productForm.price_recommended || '0');
        formData.append('image', productImage);

        if (productForm.do_intake) {
          formData.append('initial_quantity', productForm.intake_quantity);
          formData.append('initial_cost_price', productForm.intake_cost_price);
          if (productForm.intake_supplier?.trim()) {
            formData.append('supplier', productForm.intake_supplier.trim());
          }
          if (productForm.intake_note?.trim()) {
            formData.append('intake_note', productForm.intake_note.trim());
          }
          if (productForm.intake_expires_on) {
            formData.append('expires_on', productForm.intake_expires_on);
          }
          if (productForm.intake_batch_code?.trim()) {
            formData.append('batch_code', productForm.intake_batch_code.trim());
          }
        }

        await catalogApi.createProduct(formData);
      } else {
        const payload = {
          name: productForm.name.trim(),
          category_id: parseInt(productForm.category_id, 10),
          unit: productForm.unit,
          variant_name: productForm.variant_name || 'Standart',
          mxik: productForm.mxik?.trim() || null,
          package_code: productForm.package_code?.trim() || null,
          code: productForm.code.trim() || undefined,
          barcode: productForm.barcode?.trim() || undefined,
          price_partner: parseFloat(productForm.price_partner || 0),
          price_min: parseFloat(productForm.price_min || 0),
          price_recommended: parseFloat(productForm.price_recommended || 0),
        };

        if (productForm.do_intake) {
          payload.initial_quantity = parseFloat(productForm.intake_quantity);
          payload.initial_cost_price = parseFloat(productForm.intake_cost_price);
          if (productForm.intake_supplier?.trim()) {
            payload.supplier = productForm.intake_supplier.trim();
          }
          if (productForm.intake_note?.trim()) {
            payload.intake_note = productForm.intake_note.trim();
          }
          if (productForm.intake_expires_on) {
            payload.expires_on = productForm.intake_expires_on;
          }
          if (productForm.intake_batch_code?.trim()) {
            payload.batch_code = productForm.intake_batch_code.trim();
          }
        }

        await catalogApi.createProduct(payload);
      }

      if (productForm.do_intake && productForm.intake_supplier?.trim()) {
        const cleanSupp = productForm.intake_supplier.trim();
        setSavedSuppliers((prev) => {
          if (!prev.some((s) => s.toLowerCase() === cleanSupp.toLowerCase())) {
            const updated = [cleanSupp, ...prev];
            try {
              localStore.setItem(supplierStorageKey(activeTenant?.id), JSON.stringify(updated));
            } catch {}
            return updated;
          }
          return prev;
        });
      }

      if (productForm.do_intake) {
        toast.success(`"${productForm.name}" yaratildi va ${productForm.intake_quantity} ${productForm.unit} omborga kirim qilindi!`);
      } else {
        toast.success(`"${productForm.name}" mahsuloti muvaffaqiyatli yaratildi!`);
      }
      setProductModalOpen(false);
      resetProductForm();
      setProductImage(null);
      loadVariants();
    } catch (err) {
      toast.error(err.message || 'Mahsulotni saqlashda xatolik');
    } finally {
      setSubmitting(false);
    }
  };

  // Create Category Submit
  const handleCategorySubmit = async (e) => {
    e.preventDefault();
    if (!categoryForm.name.trim()) {
      toast.warning('Kategoriya nomini kiriting');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: categoryForm.name.trim(),
        currency: categoryForm.currency,
      };
      if (categoryForm.kod.trim()) {
        payload.kod = categoryForm.kod.trim();
      }
      if (categoryForm.parent_id) {
        payload.parent_id = parseInt(categoryForm.parent_id, 10);
      }

      await catalogApi.createCategory(payload);

      toast.success('Yangi kategoriya yaratildi!');
      setCategoryModalOpen(false);
      resetCategoryForm();
      loadCategories();
    } catch (err) {
      toast.error(err.message || 'Kategoriyani yaratishda xatolik');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Edit Price Modal
  const openEditPrice = (variant) => {
    setSelectedVariant(variant);
    setPriceForm({
      price_recommended: variant.price_recommended || '',
      price_min: variant.price_min || '',
      price_partner: variant.price_partner || '',
      barcode: variant.barcode || '',
    });
    setEditPriceModalOpen(true);
  };

  // Update Price Submit
  const handlePriceUpdate = async (e) => {
    e.preventDefault();
    if (!selectedVariant) return;

    setSubmitting(true);
    try {
      await catalogApi.updateVariant(selectedVariant.id, {
        price_recommended: parseFloat(priceForm.price_recommended),
        price_min: parseFloat(priceForm.price_min),
        price_partner: parseFloat(priceForm.price_partner),
        barcode: priceForm.barcode.trim() || null,
      });

      toast.success('Tovar narxi muvaffaqiyatli yangilandi!');
      setEditPriceModalOpen(false);
      loadVariants();
    } catch (err) {
      toast.error(err.message || 'Narxni yangilashda xatolik');
    } finally {
      setSubmitting(false);
    }
  };

  // Archive Variant
  const handleArchive = async (id, name) => {
    const isConfirmed = await confirm({
      title: 'Tovarni arxivlash',
      message: `"${name}" tovarini arxivga o‘tkazmoqchimisiz? Arxivlangan tovarlar POS kassada ko‘rinmaydi.`,
      confirmText: 'Arxivga o‘tkazish',
      cancelText: 'Bekor qilish',
      type: 'warning',
    });
    if (!isConfirmed) return;
    try {
      await catalogApi.archiveVariant(id);
      toast.info('Tovar arxivlandi');
      loadVariants();
    } catch (err) {
      toast.error(err.message || 'Arxivlashda xatolik');
    }
  };

  // Category Edit & Delete Handlers
  const handleStartEditCategory = (cat) => {
    setEditingCategory(cat);
    setEditCategoryForm({
      name: cat.name || '',
      kod: cat.kod || '',
      parent_id: cat.parent ? String(cat.parent) : '',
      currency: cat.currency || 'UZS',
    });
  };

  const handleSaveEditCategory = async (e) => {
    e.preventDefault();
    if (!editingCategory) return;
    if (!editCategoryForm.name.trim()) {
      toast.warning('Kategoriya nomini kiriting');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: editCategoryForm.name.trim(),
        currency: editCategoryForm.currency,
      };
      if (editCategoryForm.kod.trim()) {
        payload.kod = editCategoryForm.kod.trim();
      }
      if (editCategoryForm.parent_id) {
        payload.parent_id = parseInt(editCategoryForm.parent_id, 10);
        payload.clear_parent = false;
      } else if (editingCategory.parent) {
        payload.clear_parent = true;
      }

      await catalogApi.updateCategory(editingCategory.id, payload);
      toast.success('Kategoriya muvaffaqiyatli yangilandi!');
      setEditingCategory(null);
      await loadCategories();
      loadVariants();
    } catch (err) {
      toast.error(err.message || 'Kategoriyani yangilashda xatolik');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCategory = async (cat) => {
    const isConfirmed = await confirm({
      title: 'Kategoriyani o‘chirish',
      message: `"${cat.name}" kategoriyasini o‘chirmoqchimisiz? Agar ushbu kategoriyada faol mahsulotlar yoki subkategoriyalar mavjud bo‘lsa, tizim xavfsizlik maqsadida o‘chirishni rad etadi.`,
      confirmText: 'O‘chirish',
      cancelText: 'Bekor qilish',
      type: 'danger',
    });
    if (!isConfirmed) return;
    try {
      await catalogApi.deleteCategory(cat.id);
      toast.success(`"${cat.name}" kategoriyasi muvaffaqiyatli o‘chirildi`);
      if (editingCategory?.id === cat.id) {
        setEditingCategory(null);
      }
      await loadCategories();
      loadVariants();
    } catch (err) {
      toast.error(err.message || 'Kategoriyani o‘chirishda xatolik');
    }
  };

  // Product Edit & Delete Handlers
  const handleOpenEditProduct = (v) => {
    setEditProductImage(null);
    setEditProductForm({
      product_id: v.product,
      variant_id: v.id,
      name: v.product_name,
      category_id: v.category_id ? String(v.category_id) : '',
      unit: v.unit || 'dona',
      code: v.code || '',
      barcode: v.barcode || '',
      mxik: v.mxik || '',
      package_code: v.package_code || '',
      price_partner: v.price_partner || '',
      price_min: v.price_min || '',
      price_recommended: v.price_recommended || '',
      current_image: v.image,
    });
    setEditProductModalOpen(true);
  };

  const handleEditProductCategoryChange = (catId) => {
    const newCode = calculateSuggestedCode(catId, editProductForm.price_min);
    setEditProductForm((prev) => ({
      ...prev,
      category_id: catId,
      code: prev.code && prev.category_id ? prev.code : newCode,
    }));
  };

  const handleEditProductMinPriceChange = (val) => {
    setEditProductForm((prev) => {
      let newCode = prev.code;
      if (prev.category_id && (!prev.code || prev.code.includes('/'))) {
        const parts = prev.code.split('/');
        const cat = categories.find((c) => c.id === parseInt(prev.category_id, 10));
        const thousands = Math.floor(Number(val || 0) / (cat?.currency === 'USD' ? 1 : 1000));
        if (parts.length >= 2) {
          parts[parts.length - 1] = thousands;
          newCode = parts.join('/');
        } else {
          newCode = calculateSuggestedCode(prev.category_id, val);
        }
      }
      return { ...prev, price_min: val, code: newCode };
    });
  };

  const handleSaveEditProduct = async (e) => {
    e.preventDefault();
    if (!editProductForm.name.trim() || !editProductForm.category_id) {
      toast.warning('Mahsulot nomi va kategoriyasini tanlang');
      return;
    }
    setSubmitting(true);
    try {
      if (editProductImage) {
        const formData = new FormData();
        formData.append('name', editProductForm.name.trim());
        formData.append('category_id', editProductForm.category_id);
        formData.append('variant_id', editProductForm.variant_id);
        formData.append('mxik', editProductForm.mxik?.trim() || '');
        formData.append('package_code', editProductForm.package_code?.trim() || '');
        formData.append('unit', editProductForm.unit);
        if (editProductForm.code.trim()) {
          formData.append('code', editProductForm.code.trim());
        }
        if (editProductForm.barcode.trim()) {
          formData.append('barcode', editProductForm.barcode.trim());
        }
        formData.append('price_partner', editProductForm.price_partner || '0');
        formData.append('price_min', editProductForm.price_min || '0');
        formData.append('price_recommended', editProductForm.price_recommended || '0');
        formData.append('image', editProductImage);

        await catalogApi.updateProduct(editProductForm.product_id, formData);
      } else {
        const payload = {
          name: editProductForm.name.trim(),
          category_id: parseInt(editProductForm.category_id, 10),
          variant_id: editProductForm.variant_id,
          mxik: editProductForm.mxik?.trim() || null,
          package_code: editProductForm.package_code?.trim() || null,
          unit: editProductForm.unit,
          code: editProductForm.code.trim() || undefined,
          barcode: editProductForm.barcode.trim() || undefined,
          price_partner: parseFloat(editProductForm.price_partner || 0),
          price_min: parseFloat(editProductForm.price_min || 0),
          price_recommended: parseFloat(editProductForm.price_recommended || 0),
        };
        await catalogApi.updateProduct(editProductForm.product_id, payload);
      }

      toast.success(`"${editProductForm.name}" mahsuloti muvaffaqiyatli yangilandi!`);
      setEditProductModalOpen(false);
      setEditProductImage(null);
      loadVariants();
    } catch (err) {
      toast.error(err.message || 'Mahsulotni yangilashda xatolik');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProduct = async (v) => {
    const isConfirmed = await confirm({
      title: 'Mahsulotni o‘chirish',
      message: `"${v.product_name}" mahsulotini o‘chirmoqchimisiz? Agar ushbu mahsulot bo‘yicha savdo yoki ombor harakati bo‘lsa, moliyaviy audit uchun u arxivlanadi. Agar savdo tarixi bo‘lmasa, tizimdan butunlay o‘chiriladi.`,
      confirmText: 'O‘chirish',
      cancelText: 'Bekor qilish',
      type: 'danger',
    });
    if (!isConfirmed) return;
    try {
      await catalogApi.deleteProduct(v.product);
      toast.success(`"${v.product_name}" mahsuloti o‘chirildi`);
      loadVariants();
    } catch (err) {
      toast.error(err.message || 'Mahsulotni o‘chirishda xatolik');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Top Action Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
            Mahsulotlar & Tovar Nomenklaturasi
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Narxlar, shtrix-kodlar, MinIO rasmlari va qoldiqlar nazorati
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canImport && <button className="btn btn-secondary" onClick={() => setImportOpen(true)}>Fayldan yuklash</button>}
          <button
            onClick={() => setManageCategoriesModalOpen(true)}
            className="btn btn-secondary"
            title="Kategoriyalarni ko‘rish, tahrirlash va o‘chirish"
          >
            <FolderTree size={16} />
            <span>Kategoriyalarni Boshqarish</span>
          </button>

          <button
            onClick={() => setCategoryModalOpen(true)}
            className="btn btn-secondary"
          >
            <Tag size={16} />
            <span>+ Kategoriya</span>
          </button>

          <button
            onClick={() => setProductModalOpen(true)}
            className="btn btn-primary"
          >
            <Plus size={16} />
            <span>Yangi Tovar</span>
          </button>
        </div>
      </div>

      {/* Status Tabs: Faol vs Arxivlangan */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => handleTabChange('active')}
          style={{
            padding: '8px 18px',
            borderRadius: 10,
            border: activeTab === 'active' ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
            background: activeTab === 'active' ? 'rgba(var(--primary-rgb), 0.12)' : 'var(--bg-card)',
            color: activeTab === 'active' ? 'var(--primary)' : 'var(--text-primary)',
            fontWeight: activeTab === 'active' ? 700 : 600,
            fontSize: 13.5,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.15s ease',
            boxShadow: activeTab === 'active' ? '0 0 12px rgba(var(--primary-rgb), 0.15)' : 'none',
          }}
        >
          <Package size={16} />
          <span>Faol tovarlar</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('archived')}
          style={{
            padding: '8px 18px',
            borderRadius: 10,
            border: activeTab === 'archived' ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
            background: activeTab === 'archived' ? 'rgba(var(--primary-rgb), 0.12)' : 'var(--bg-card)',
            color: activeTab === 'archived' ? 'var(--primary)' : 'var(--text-primary)',
            fontWeight: activeTab === 'archived' ? 700 : 600,
            fontSize: 13.5,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            transition: 'all 0.15s ease',
            boxShadow: activeTab === 'archived' ? '0 0 12px rgba(var(--primary-rgb), 0.15)' : 'none',
          }}
        >
          <Archive size={16} />
          <span>Arxivlangan tovarlar</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div
        className="glass-card"
        style={{
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 260, position: 'relative' }}>
          <Search
            size={18}
            color="var(--text-muted)"
            style={{ position: 'absolute', left: 14, top: 13 }}
          />
          <input
            type="text"
            placeholder="Tovar nomi, 3 bosqichli kod yoki shtrix-kod bo‘yicha tezkor qidiruv..."
            value={search}
            onChange={handleSearch}
            className="input-field"
            style={{ paddingLeft: 42 }}
          />
        </div>

        {/* Camera Barcode Scanner Button */}
        <button
          type="button"
          onClick={() => {
            setScannerTarget('search');
            setCameraScannerOpen(true);
          }}
          className="btn btn-secondary"
          title="Telefon / qurilma kamerasi orqali tovar shtrix-kodini skanerlash"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 42,
            padding: '0 14px',
            color: 'var(--primary)',
            borderColor: 'var(--border-card)',
            cursor: 'pointer',
          }}
        >
          <Camera size={16} />
          <span>Kamera</span>
        </button>

        <CustomSelect
          value={selectedCat}
          onChange={(val) => {
            handleCatChange({ target: { value: val } });
          }}
          options={[
            { value: '', label: 'Barcha kategoriyalar' },
            ...categories.map((c) => ({
              value: c.id,
              label: getCategoryLabel(c),
            })),
          ]}
          size="md"
          style={{ minWidth: 230 }}
        />
      </div>

      {/* Variants / Products Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 18,
        }}
      >
        {loadingVariants ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
            <IlbiLoader label="Tovarlar yuklanmoqda..." />
          </div>
        ) : variants.length === 0 ? (
          <div
            className="glass-card"
            style={{
              gridColumn: '1 / -1',
              padding: '60px 20px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {activeTab === 'archived' ? (
              <>
                <Archive size={44} color="var(--accent-amber)" />
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Arxivlangan tovarlar mavjud emas
                </span>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                  Barcha tovarlaringiz faol holatda savdoga chiqarilgan
                </p>
                <button
                  type="button"
                  onClick={() => handleTabChange('active')}
                  className="btn btn-secondary"
                  style={{ marginTop: 8 }}
                >
                  Faol tovarlarga qaytish
                </button>
              </>
            ) : (
              <>
                <Package size={44} color="var(--primary)" />
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Hech qanday tovar topilmadi
                </span>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                  Katalogga birinchi tovaringizni qo‘shish uchun yuqoridagi tugmani bosing
                </p>
                <button
                  onClick={() => setProductModalOpen(true)}
                  className="btn btn-primary"
                  style={{ marginTop: 8 }}
                >
                  + Birinchi Tovarni Qo‘shish
                </button>
              </>
            )}
          </div>
        ) : (
          paginatedVariants.map((v) => {
            const stockQty = parseFloat(v.stock_quantity || 0);
            const isOutOfStock = stockQty <= 0;

            return (
              <div
                key={v.id}
                className="glass-card interactive"
                style={{
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  position: 'relative',
                  borderRadius: 'var(--radius-md, 14px)',
                }}
              >
                {/* Product Image Carousel */}
                <ProductCardImageCarousel
                  variant={v}
                  isOutOfStock={isOutOfStock}
                  stockQty={stockQty}
                />

                {/* Product Info */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                    <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: 'var(--text-primary)', lineHeight: 1.3, flex: 1 }}>
                      {v.product_name}
                    </h4>
                    {v.code && (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '2px 6px',
                          borderRadius: 5,
                          background: 'rgba(var(--primary-rgb), 0.12)',
                          color: 'var(--primary)',
                          fontFamily: 'monospace',
                          whiteSpace: 'nowrap',
                          border: '1px solid rgba(var(--primary-rgb), 0.22)',
                        }}
                        title="3 Bosqichli Kod (Kategoriya/Subkategoriya/Narx)"
                      >
                        Kod: {v.code}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 4, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    <span>
                      Variant: <strong style={{ color: 'var(--text-primary)' }}>{v.name}</strong>
                    </span>
                    {v.barcode && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          fontFamily: 'monospace',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                        title={`Shtrix-kod: ${v.barcode}`}
                      >
                        <Barcode size={12} opacity={0.7} />
                        <span>{v.barcode}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Unified Price Block */}
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-chip)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 600 }}>
                      Sotuv narxi
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--primary)' }}>
                      {formatPrice(v.price_recommended, v.currency)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--text-muted)', borderTop: '1px dashed var(--border-subtle)', paddingTop: 4 }}>
                    <span>Min: <strong style={{ color: 'var(--text-secondary)' }}>{formatPrice(v.price_min, v.currency)}</strong></span>
                    <span>Hamkor: <strong style={{ color: 'var(--text-secondary)' }}>{formatPrice(v.price_partner, v.currency)}</strong></span>
                  </div>
                </div>

                {/* Action Buttons - Compact 2-Row Layout */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto', paddingTop: 2 }}>
                  {/* Row 1: Quick Tools (Yorliq, Narxlar, Variantlar) */}
                  <div style={{ display: 'grid', gridTemplateColumns: canChangeProduct ? '1fr 1fr 1fr' : '1fr', gap: 6 }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setLabelVariant(v)}
                      style={{ padding: '6px 4px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                      title="Shtrix-kod va narx yorlig‘i chop etish"
                    >
                      <Barcode size={13} />
                      <span>Yorliq</span>
                    </button>
                    {canChangeProduct && (
                      <>
                        <button
                          className="btn btn-secondary"
                          onClick={() => openEditPrice(v)}
                          style={{ padding: '6px 4px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                          title="Narxlarni tezkor tahrirlash"
                        >
                          <DollarSign size={13} />
                          <span>Narx</span>
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => setToolsProductId(v.product)}
                          style={{ padding: '6px 4px', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                          title="Mahsulot rasmlari va yangi variantlar"
                        >
                          <ImageIcon size={13} />
                          <span>Media</span>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Row 2: Actions */}
                  {activeTab === 'archived' ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleUnarchive(v.id, v.product_name || v.name)}
                        className="btn btn-secondary"
                        style={{
                          flex: 1,
                          padding: '7px 10px',
                          fontSize: 12,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6,
                          color: 'var(--accent-emerald)',
                          borderColor: 'rgba(var(--success-rgb), 0.4)',
                          background: 'rgba(var(--success-rgb), 0.08)',
                        }}
                        title="Tovarni arxivdan chiqarib faol savdoga qaytarish"
                      >
                        <RotateCcw size={13} />
                        <span>Arxivdan chiqarish</span>
                      </button>

                      <button
                        onClick={() => handleDeleteProduct(v)}
                        className="btn btn-danger"
                        style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Mahsulotni o‘chirish"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => handleOpenEditProduct(v)}
                        className="btn btn-primary"
                        style={{ flex: 1, padding: '7px 10px', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        title="Mahsulot ma‘lumotlari va narxlarni to‘liq tahrirlash"
                      >
                        <Edit2 size={13} />
                        <span>Tahrirlash</span>
                      </button>

                      {canArchiveProduct && (
                        <button
                          onClick={() => handleArchive(v.id, v.product_name || v.name)}
                          className="btn btn-secondary"
                          style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          title="Mahsulotni arxivlash"
                        >
                          <Archive size={13} />
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteProduct(v)}
                        className="btn btn-danger"
                        style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="Mahsulotni o‘chirish"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {variantCount > pageSize && (
          <div style={{ gridColumn: '1 / -1' }}>
            <Pagination
              currentPage={currentPage}
              totalItems={variantCount}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {importOpen && <CatalogImportModal onClose={() => setImportOpen(false)} onSuccess={() => { loadCategories(); loadVariants(); }} />}
      {labelVariant && <ProductLabelsModal key={labelVariant.id} variant={labelVariant} canGenerate={canChangeProduct} onClose={() => setLabelVariant(null)} onChanged={() => loadVariants()} />}
      <ProductToolsModal productId={toolsProductId} onClose={() => setToolsProductId(null)} onChanged={() => loadVariants()} />

      {/* Create Product Modal */}
      <Modal
        isOpen={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title="Yangi Mahsulot Qo‘shish"
        maxWidth={800}
      >
        <form onSubmit={handleProductSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Mahsulot Nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input data-api-field="name"
              type="text"
              placeholder="Masalan: Coca Cola 1.5L"
              value={productForm.name}
              onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
              className="input-field"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Kategoriya <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <CustomSelect data-api-field="category_id" required
                value={productForm.category_id}
                onChange={(val) => handleProductCategoryChange(val)}
                placeholder="Tanlang..."
                options={categories.map((c) => ({
                  value: c.id,
                  label: getCategoryLabel(c),
                }))}
                fullWidth
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                O‘lchov Birligi
              </label>
              <CustomSelect data-api-field="unit"
                value={productForm.unit}
                onChange={(val) => setProductForm({ ...productForm, unit: val })}
                options={[
                  { value: 'dona', label: 'Dona' },
                  { value: 'kg', label: 'Kilogramm (kg)' },
                  { value: 'litr', label: 'Litr' },
                  { value: 'metr', label: 'Metr' },
                ]}
                fullWidth
              />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                3 Bosqichli Kod (Kategoriya / Subkategoriya / Narx)
              </label>
              <button
                type="button"
                onClick={() => {
                  const code = calculateSuggestedCode(productForm.category_id, productForm.price_min);
                  setProductForm((prev) => ({ ...prev, code }));
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title="Kategoriya va minimal narx bo‘yicha kodni qayta hisoblash"
              >
                <Sparkles size={13} />
                <span>Avto-kod</span>
              </button>
            </div>
            <input data-api-field="code"
              type="text"
              placeholder="Masalan: 01/02/11"
              value={productForm.code}
              onChange={(e) => setProductForm({ ...productForm, code: e.target.value })}
              className="input-field"
              style={{ fontFamily: 'monospace', fontWeight: 600 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Format: {`{Ota kategoriya}/{Subkategoriya}/{Min narx // 1000}`} (erkin tahrirlash mumkin)
            </span>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Shtrix-kod (Barcode)
              </label>
              <button
                type="button"
                onClick={() => {
                  setScannerTarget('product_barcode');
                  setCameraScannerOpen(true);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title="Telefon kamerasi orqali shtrix-kodni o‘qish"
              >
                <Camera size={13} />
                <span>Kameradan o‘qish</span>
              </button>
            </div>
            <input data-api-field="barcode"
              type="text"
              placeholder="Masalan: 4780001234567 (ixtiyoriy yoki kameradan o‘qing)"
              value={productForm.barcode || ''}
              onChange={(e) => setProductForm({ ...productForm, barcode: e.target.value })}
              className="input-field"
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          <FiscalMetadataFields value={productForm} onChange={setProductForm} idPrefix="create-product" />

          {(() => {
            const selectedCatObj = categories.find((c) => c.id === parseInt(productForm.category_id, 10));
            const cur = selectedCatObj?.currency || 'UZS';

            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Hamkor Narxi ({cur}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                    </label>
                    <PriceInput data-api-field="price_partner"
                      placeholder="10 000"
                      value={productForm.price_partner}
                      onChange={(e) => setProductForm({ ...productForm, price_partner: e.target.value })}
                      className="input-field"
                      required
                    />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                      1-narx (ulgurji)
                    </span>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Minimal Narx ({cur}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                    </label>
                    <PriceInput data-api-field="price_min"
                      placeholder="11 000"
                      value={productForm.price_min}
                      onChange={(e) => handleProductMinPriceChange(e.target.value)}
                      className="input-field"
                      required
                    />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                      Chegara narxi
                    </span>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Sotuv Narxi ({cur}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                    </label>
                    <PriceInput data-api-field="price_recommended"
                      placeholder="13 000"
                      value={productForm.price_recommended}
                      onChange={(e) => setProductForm({ ...productForm, price_recommended: e.target.value })}
                      className="input-field"
                      required
                    />
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                      Tavsiya narx
                    </span>
                  </div>
                </div>

                {/* Immediate Stock Intake Option */}
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: productForm.do_intake ? '1px solid var(--primary)' : '1px solid var(--border-card)',
                    background: productForm.do_intake ? 'var(--bg-surface-elevated, var(--bg-card))' : 'var(--bg-card)',
                    transition: 'all var(--transition-fast)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={() => setProductForm((prev) => ({ ...prev, do_intake: !prev.do_intake }))}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="checkbox"
                        id="do_intake_checkbox"
                        checked={!!productForm.do_intake}
                        onChange={(e) => setProductForm((prev) => ({ ...prev, do_intake: e.target.checked }))}
                        style={{ width: 17, height: 17, cursor: 'pointer', accentColor: 'var(--primary)' }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div>
                        <label
                          htmlFor="do_intake_checkbox"
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <PackagePlus size={16} color="var(--primary)" />
                          <span>Darhol omborga kirim qilish (Boshlang‘ich qoldiq)</span>
                        </label>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          Yangi tovar yaratilishi bilan uning miqdori va tan narxini omborga qabul qilish
                        </div>
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: productForm.do_intake ? 'var(--primary)' : 'var(--bg-chip)',
                        color: productForm.do_intake ? 'var(--primary-foreground)' : 'var(--text-muted)',
                      }}
                    >
                      {productForm.do_intake ? 'KIRIM QILINADI' : 'KIRIMSIZ'}
                    </span>
                  </div>

                  {/* Intake fields */}
                  {productForm.do_intake && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        paddingTop: 12,
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Kirim Miqdori ({productForm.unit || 'dona'}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                          </label>
                          <input data-api-field="intake_quantity initial_quantity"
                            type="number"
                            step={productForm.unit === 'dona' ? '1' : '0.001'}
                            min={productForm.unit === 'dona' ? '1' : '0.001'}
                            placeholder={productForm.unit === 'dona' ? 'Masalan: 10' : 'Masalan: 10.5'}
                            value={productForm.intake_quantity}
                            onChange={(e) => setProductForm((prev) => ({ ...prev, intake_quantity: e.target.value }))}
                            className="input-field"
                            required={productForm.do_intake}
                          />
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Asl Narx / Tan Narxi ({cur}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                          </label>
                          <PriceInput data-api-field="intake_cost_price initial_cost_price"
                            placeholder={cur === 'USD' ? '10' : '45 000'}
                            value={productForm.intake_cost_price}
                            onChange={(e) => setProductForm((prev) => ({ ...prev, intake_cost_price: e.target.value }))}
                            className="input-field"
                            required={productForm.do_intake}
                          />
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                            Omborga kirim qilinadigan faktura narxi
                          </span>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Ta’minotchi (Yetkazib beruvchi)
                          </label>
                          <input data-api-field="intake_supplier supplier"
                            type="text"
                            list="catalog-saved-suppliers-list"
                            placeholder="Masalan: Global Trade MCHJ yoki Baza"
                            value={productForm.intake_supplier}
                            onChange={(e) => setProductForm((prev) => ({ ...prev, intake_supplier: e.target.value }))}
                            className="input-field"
                          />
                          <datalist id="catalog-saved-suppliers-list">
                            {savedSuppliers.map((s, idx) => (
                              <option key={idx} value={s} />
                            ))}
                          </datalist>
                          {savedSuppliers.length > 0 && !productForm.intake_supplier && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, alignItems: 'center' }}>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Eslab qolingan:</span>
                              {savedSuppliers.slice(0, 4).map((s, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setProductForm((prev) => ({ ...prev, intake_supplier: s }))}
                                  style={{
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    border: '1px solid var(--border-subtle)',
                                    background: 'var(--bg-card)',
                                    color: 'var(--primary)',
                                    fontSize: 10.5,
                                    fontWeight: 500,
                                    cursor: 'pointer',
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
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Faktura raqami / Izoh
                          </label>
                          <input data-api-field="intake_note"
                            type="text"
                            placeholder="Masalan: Faktura #1084"
                            value={productForm.intake_note}
                            onChange={(e) => setProductForm((prev) => ({ ...prev, intake_note: e.target.value }))}
                            className="input-field"
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Yaroqlilik Muddati (Sanasi)
                          </label>
                          <CustomDatePicker data-api-field="intake_expires_on expires_on"
                            value={productForm.intake_expires_on || ''}
                            onChange={(val) => setProductForm((prev) => ({ ...prev, intake_expires_on: val }))}
                            placeholder="Sanani tanlang..."
                            fullWidth
                            title="Partiyaning yaroqlilik sanasi (ixtiyoriy)"
                          />
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                            Tugash sanasi (muddati o‘tgan tovarlar kassada ogohlantiriladi)
                          </span>
                        </div>

                        <div>
                          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Partiya Raqami / Seriya
                          </label>
                          <input data-api-field="intake_batch_code batch_code"
                            type="text"
                            placeholder="Masalan: B-2026/09"
                            maxLength={80}
                            value={productForm.intake_batch_code || ''}
                            onChange={(e) => setProductForm((prev) => ({ ...prev, intake_batch_code: e.target.value }))}
                            className="input-field"
                          />
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                            Partiya kodi (ixtiyoriy)
                          </span>
                        </div>
                      </div>

                      {parseFloat(productForm.intake_quantity || 0) > 0 && parseFloat(productForm.intake_cost_price || 0) > 0 && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: 'var(--radius-xs)',
                            background: 'var(--bg-input)',
                            border: '1px dashed var(--border-card)',
                            fontSize: 12,
                          }}
                        >
                          <span style={{ color: 'var(--text-secondary)' }}>Jami kirim tovar partiyasi qiymati:</span>
                          <strong style={{ color: 'var(--primary)', fontSize: 13 }}>
                            {(parseFloat(productForm.intake_quantity) * parseFloat(productForm.intake_cost_price)).toLocaleString()} {cur}
                          </strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!productForm.do_intake && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-xs)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border-subtle)',
                      fontSize: 12,
                      color: 'var(--text-muted)',
                    }}
                  >
                    <Info size={15} color="var(--primary)" style={{ flexShrink: 0 }} />
                    <span>
                      Mahsulotning <strong>tannarxi</strong> ombor orqali tovar kirim qilinganda faktura narxiga qarab belgilanadi.
                    </span>
                  </div>
                )}
              </>
            );
          })()}

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Mahsulot Rasmi (MinIO Cloud Saqlash)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setProductImage(e.target.files[0] || null)}
              className="input-field"
              style={{ padding: '8px 12px' }}
            />
            {productImage && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={productImagePreview || undefined}
                  alt="Preview"
                  style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border-subtle)' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {productImage.name} ({Math.round(productImage.size / 1024)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => setProductImage(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-rose)',
                    fontSize: 12,
                    cursor: 'pointer',
                    marginLeft: 'auto',
                  }}
                >
                  Rasmni o‘chirish
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <div>
              {(productForm.name || productForm.category_id || productForm.code || productForm.price_min || productForm.price_recommended || productImage) && (
                <button
                  type="button"
                  onClick={() => {
                    resetProductForm();
                    setProductImage(null);
                    toast.info('Mahsulot qoralamasi tozalandi');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-rose)',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '6px 0',
                    textDecoration: 'underline',
                  }}
                >
                  Qoralamani tozalash
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="btn btn-secondary"
              >
                Bekor Qilish
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn btn-primary"
              >
                {submitting ? 'Saqlanmoqda...' : 'Mahsulotni Yaratish'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Create Category Modal */}
      <Modal
        isOpen={categoryModalOpen}
        onClose={() => setCategoryModalOpen(false)}
        title="Yangi Kategoriya Qo‘shish"
        maxWidth={680}
      >
        <form onSubmit={handleCategorySubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Ota Kategoriya (Ixtiyoriy)
            </label>
            <CustomSelect data-api-field="parent_id"
              value={categoryForm.parent_id}
              onChange={handleParentCategoryChange}
              placeholder="(Ota kategoriya yo‘q — Asosiy Kategoriya)"
              options={[
                { value: '', label: '(Ota kategoriya yo‘q — Asosiy Kategoriya)' },
                ...categories
                  .filter((c) => !c.parent)
                  .map((c) => ({
                    value: c.id,
                    label: `${c.name} [Kod: ${c.kod}] (${c.currency})`,
                  })),
              ]}
              fullWidth
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Faqat asosiy kategoriyalar ota kategoriya bo‘la oladi (2 bosqichli ierarxiya)
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Kategoriya Nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input data-api-field="name"
              type="text"
              placeholder="Masalan: Ichimliklar yoki Gazli suvlar..."
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
              className="input-field"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Kategoriya Kodi (Ixtiyoriy)
              </label>
              <input data-api-field="kod"
                type="text"
                placeholder="Masalan: 01"
                value={categoryForm.kod}
                onChange={(e) => setCategoryForm({ ...categoryForm, kod: e.target.value })}
                className="input-field"
                style={{ fontFamily: 'monospace' }}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                Bo‘sh qolsa avtomatik beriladi
              </span>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Valyuta <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <CustomSelect data-api-field="currency"
                value={categoryForm.currency}
                onChange={(val) => setCategoryForm({ ...categoryForm, currency: val })}
                disabled={Boolean(categoryForm.parent_id)}
                options={[
                  { value: 'UZS', label: 'UZS (So‘m)' },
                  { value: 'USD', label: 'USD (AQSH Dollari)' },
                ]}
                fullWidth
              />
              {categoryForm.parent_id && (
                <span style={{ fontSize: 11, color: 'var(--accent-emerald)', marginTop: 4, display: 'block' }}>
                  ✓ Ota kategoriyadan meros olindi
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <div>
              {(categoryForm.name || categoryForm.kod) && (
                <button
                  type="button"
                  onClick={() => {
                    resetCategoryForm();
                    toast.info('Kategoriya qoralamasi tozalandi');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-rose)',
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '6px 0',
                    textDecoration: 'underline',
                  }}
                >
                  Qoralamani tozalash
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => setCategoryModalOpen(false)}
                className="btn btn-secondary"
              >
                Bekor Qilish
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="btn btn-primary"
              >
                {submitting ? 'Yaratilmoqda...' : 'Kategoriyani Saqlash'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Edit Price Modal */}
      <Modal
        isOpen={editPriceModalOpen}
        onClose={() => setEditPriceModalOpen(false)}
        title={`Narxlarni Tahrirlash: ${selectedVariant?.product_name || ''}`}
      >
        <form onSubmit={handlePriceUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Tavsiya Etilgan Sotuv Narxi ({selectedVariant?.currency || 'UZS'}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <PriceInput data-api-field="price_recommended"
              value={priceForm.price_recommended}
              onChange={(e) => setPriceForm({ ...priceForm, price_recommended: e.target.value })}
              className="input-field"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Hamkor Narxi (1-narx) ({selectedVariant?.currency || 'UZS'}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <PriceInput data-api-field="price_partner"
                value={priceForm.price_partner}
                onChange={(e) => setPriceForm({ ...priceForm, price_partner: e.target.value })}
                className="input-field"
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Minimal Chegara Narxi ({selectedVariant?.currency || 'UZS'}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <PriceInput data-api-field="price_min"
                value={priceForm.price_min}
                onChange={(e) => setPriceForm({ ...priceForm, price_min: e.target.value })}
                className="input-field"
                required
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Shtrix-Kod (Skaner uchun)
            </label>
            <input data-api-field="barcode"
              type="text"
              placeholder="Masalan: 4780001234567"
              value={priceForm.barcode}
              onChange={(e) => setPriceForm({ ...priceForm, barcode: e.target.value })}
              className="input-field"
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setEditPriceModalOpen(false)}
              className="btn btn-secondary"
            >
              Bekor Qilish
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
            >
              {submitting ? 'Saqlanmoqda...' : 'Narxni Yangilash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Manage Categories Modal */}
      <Modal
        isOpen={manageCategoriesModalOpen}
        onClose={() => {
          setManageCategoriesModalOpen(false);
          setEditingCategory(null);
        }}
        title="Kategoriyalarni Boshqarish"
        maxWidth={800}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Subheading / Header Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                Barcha asosiy va subkategoriyalar ierarxiyasi (Jami: {categories.length} ta)
              </p>
            </div>
            <button
              onClick={() => {
                setManageCategoriesModalOpen(false);
                setCategoryModalOpen(true);
              }}
              className="btn btn-primary"
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              <Plus size={14} />
              <span>Yangi Kategoriya</span>
            </button>
          </div>

          {/* Edit Category Form (when editingCategory is active) */}
          {editingCategory && (
            <div
              style={{
                padding: 16,
                borderRadius: 12,
                background: 'rgba(59, 130, 246, 0.05)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Edit2 size={15} />
                  Kategoriyani Tahrirlash: {editingCategory.name}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingCategory(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveEditCategory} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Kategoriya Nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
                    </label>
                    <input data-api-field="name"
                      type="text"
                      value={editCategoryForm.name}
                      onChange={(e) => setEditCategoryForm({ ...editCategoryForm, name: e.target.value })}
                      className="input-field"
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Kategoriya Kodi
                    </label>
                    <input data-api-field="kod"
                      type="text"
                      value={editCategoryForm.kod}
                      onChange={(e) => setEditCategoryForm({ ...editCategoryForm, kod: e.target.value })}
                      className="input-field"
                      style={{ fontFamily: 'monospace' }}
                      placeholder="Masalan: 01"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Ota Kategoriya
                    </label>
                    <CustomSelect data-api-field="parent_id"
                      value={editCategoryForm.parent_id}
                      onChange={(val) => {
                        const pId = val;
                        const parent = categories.find((c) => c.id === parseInt(pId, 10));
                        setEditCategoryForm({
                          ...editCategoryForm,
                          parent_id: pId,
                          currency: parent ? parent.currency : editCategoryForm.currency,
                        });
                      }}
                      placeholder="(Asosiy Kategoriya — Ota kategoriya yo‘q)"
                      options={[
                        { value: '', label: '(Asosiy Kategoriya — Ota kategoriya yo‘q)' },
                        ...categories
                          .filter((c) => !c.parent && c.id !== editingCategory.id)
                          .map((c) => ({
                            value: c.id,
                            label: `${c.name} [Kod: ${c.kod}] (${c.currency})`,
                          })),
                      ]}
                      size="sm"
                      fullWidth
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                      Valyuta
                    </label>
                    <CustomSelect data-api-field="currency"
                      value={editCategoryForm.currency}
                      onChange={(val) => setEditCategoryForm({ ...editCategoryForm, currency: val })}
                      disabled={Boolean(editCategoryForm.parent_id)}
                      options={[
                        { value: 'UZS', label: 'UZS (So‘m)' },
                        { value: 'USD', label: 'USD (AQSH Dollari)' },
                      ]}
                      size="sm"
                      fullWidth
                    />
                    {editCategoryForm.parent_id && (
                      <span style={{ fontSize: 10, color: 'var(--accent-emerald)', marginTop: 2, display: 'block' }}>
                        ✓ Ota kategoriyadan meros olinadi
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => setEditingCategory(null)}
                    className="btn btn-secondary"
                    style={{ fontSize: 12, padding: '6px 12px' }}
                  >
                    Bekor Qilish
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary"
                    style={{ fontSize: 12, padding: '6px 14px' }}
                  >
                    {submitting ? 'Saqlanmoqda...' : 'O‘zgarishlarni Saqlash'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Categories List Hierarchy */}
          <div
            style={{
              maxHeight: 420,
              overflowY: 'auto',
              borderRadius: 12,
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
            }}
          >
            {categories.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                Kategoriyalar mavjud emas. Yuqoridagi tugma orqali yangi kategoriya qo‘shing.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {categories
                  .filter((c) => !c.parent)
                  .map((mainCat) => {
                    const subCats = categories.filter((c) => c.parent === mainCat.id);
                    return (
                      <React.Fragment key={mainCat.id}>
                        {/* Main Category Row */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 16px',
                            borderBottom: '1px solid var(--border-subtle)',
                            background: editingCategory?.id === mainCat.id ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                            transition: 'background 0.15s ease',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontWeight: 700,
                                fontSize: 12,
                                background: 'rgba(59, 130, 246, 0.12)',
                                color: 'var(--primary)',
                                padding: '3px 8px',
                                borderRadius: 6,
                              }}
                            >
                              [{mainCat.kod}]
                            </span>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                                {mainCat.name}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Asosiy kategoriya • {subCats.length} ta subkategoriya
                              </div>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: 999,
                                background: mainCat.currency === 'USD' ? 'rgba(var(--success-rgb), 0.15)' : 'rgba(59, 130, 246, 0.12)',
                                color: mainCat.currency === 'USD' ? 'var(--accent-emerald)' : 'var(--primary)',
                                marginLeft: 6,
                              }}
                            >
                              {mainCat.currency}
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button
                              onClick={() => handleStartEditCategory(mainCat)}
                              className="btn btn-secondary"
                              style={{ padding: '6px 10px', fontSize: 12 }}
                              title="Kategoriyani tahrirlash"
                            >
                              <Edit2 size={13} />
                              <span>Tahrirlash</span>
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(mainCat)}
                              className="btn btn-danger"
                              style={{ padding: '6px 10px' }}
                              title="Kategoriyani o‘chirish"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Subcategories */}
                        {subCats.map((sub) => (
                          <div
                            key={sub.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '10px 16px 10px 36px',
                              borderBottom: '1px solid var(--border-subtle)',
                              background: editingCategory?.id === sub.id ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.01)',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>↳</span>
                              <span
                                style={{
                                  fontFamily: 'monospace',
                                  fontWeight: 600,
                                  fontSize: 11,
                                  background: 'rgba(255, 255, 255, 0.05)',
                                  color: 'var(--text-secondary)',
                                  padding: '2px 7px',
                                  borderRadius: 6,
                                  border: '1px solid var(--border-subtle)',
                                }}
                              >
                                [{mainCat.kod}/{sub.kod}]
                              </span>
                              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-secondary)' }}>
                                {sub.name}
                              </div>
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  padding: '1px 6px',
                                  borderRadius: 999,
                                  background: sub.currency === 'USD' ? 'rgba(var(--success-rgb), 0.15)' : 'rgba(59, 130, 246, 0.12)',
                                  color: sub.currency === 'USD' ? 'var(--accent-emerald)' : 'var(--primary)',
                                }}
                              >
                                {sub.currency}
                              </span>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <button
                                onClick={() => handleStartEditCategory(sub)}
                                className="btn btn-secondary"
                                style={{ padding: '5px 8px', fontSize: 11 }}
                                title="Subkategoriyani tahrirlash"
                              >
                                <Edit2 size={12} />
                                <span>Tahrirlash</span>
                              </button>
                              <button
                                onClick={() => handleDeleteCategory(sub)}
                                className="btn btn-danger"
                                style={{ padding: '5px 8px' }}
                                title="Subkategoriyani o‘chirish"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </React.Fragment>
                    );
                  })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button
              onClick={() => {
                setManageCategoriesModalOpen(false);
                setEditingCategory(null);
              }}
              className="btn btn-secondary"
            >
              Yopish
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Product Modal */}
      <Modal
        isOpen={editProductModalOpen}
        onClose={() => {
          setEditProductModalOpen(false);
          setEditProductImage(null);
        }}
        title={`Mahsulotni Tahrirlash: ${editProductForm.name || ''}`}
        maxWidth={800}
      >
        <form onSubmit={handleSaveEditProduct} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Mahsulot Nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
            </label>
            <input data-api-field="name"
              type="text"
              placeholder="Masalan: Coca Cola 1.5L"
              value={editProductForm.name}
              onChange={(e) => setEditProductForm({ ...editProductForm, name: e.target.value })}
              className="input-field"
              required
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Kategoriya <span style={{ color: 'var(--accent-rose)' }}>*</span>
              </label>
              <CustomSelect data-api-field="category_id" required
                value={editProductForm.category_id}
                onChange={(val) => handleEditProductCategoryChange(val)}
                placeholder="Tanlang..."
                options={categories.map((c) => ({
                  value: c.id,
                  label: getCategoryLabel(c),
                }))}
                fullWidth
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                O‘lchov Birligi
              </label>
              <CustomSelect data-api-field="unit"
                value={editProductForm.unit}
                onChange={(val) => setEditProductForm({ ...editProductForm, unit: val })}
                options={[
                  { value: 'dona', label: 'Dona' },
                  { value: 'kg', label: 'Kilogramm (kg)' },
                  { value: 'litr', label: 'Litr' },
                  { value: 'metr', label: 'Metr' },
                ]}
                fullWidth
              />
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                3 Bosqichli Kod (Kategoriya / Subkategoriya / Narx)
              </label>
              <button
                type="button"
                onClick={() => {
                  const code = calculateSuggestedCode(editProductForm.category_id, editProductForm.price_min);
                  setEditProductForm((prev) => ({ ...prev, code }));
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title="Kategoriya va minimal narx bo‘yicha kodni qayta hisoblash"
              >
                <Sparkles size={13} />
                <span>Avto-kod</span>
              </button>
            </div>
            <input data-api-field="code"
              type="text"
              placeholder="Masalan: 01/02/11"
              value={editProductForm.code}
              onChange={(e) => setEditProductForm({ ...editProductForm, code: e.target.value })}
              className="input-field"
              style={{ fontFamily: 'monospace', fontWeight: 600 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
              Format: {`{Ota kategoriya}/{Subkategoriya}/{Min narx // 1000}`}
            </span>
          </div>

          {(() => {
            const selectedCatObj = categories.find((c) => c.id === parseInt(editProductForm.category_id, 10));
            const cur = selectedCatObj?.currency || 'UZS';

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Hamkor Narxi ({cur}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                  </label>
                  <PriceInput data-api-field="price_partner"
                    value={editProductForm.price_partner}
                    onChange={(e) => setEditProductForm({ ...editProductForm, price_partner: e.target.value })}
                    className="input-field"
                    required
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                    1-narx (ulgurji)
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Minimal Narx ({cur}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                  </label>
                  <PriceInput data-api-field="price_min"
                    value={editProductForm.price_min}
                    onChange={(e) => handleEditProductMinPriceChange(e.target.value)}
                    className="input-field"
                    required
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                    Chegara narxi
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Sotuv Narxi ({cur}) <span style={{ color: 'var(--accent-rose)' }}>*</span>
                  </label>
                  <PriceInput data-api-field="price_recommended"
                    value={editProductForm.price_recommended}
                    onChange={(e) => setEditProductForm({ ...editProductForm, price_recommended: e.target.value })}
                    className="input-field"
                    required
                  />
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                    Tavsiya narx
                  </span>
                </div>
              </div>
            );
          })()}

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Shtrix-Kod (Skaner uchun)
              </label>
              <button
                type="button"
                onClick={() => {
                  setScannerTarget('edit_barcode');
                  setCameraScannerOpen(true);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--primary)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                title="Kameradan shtrix-kodni o‘qish"
              >
                <Camera size={13} />
                <span>Kameradan o‘qish</span>
              </button>
            </div>
            <input data-api-field="barcode"
              type="text"
              placeholder="Masalan: 4780001234567"
              value={editProductForm.barcode}
              onChange={(e) => setEditProductForm({ ...editProductForm, barcode: e.target.value })}
              className="input-field"
            />
          </div>

          <FiscalMetadataFields value={editProductForm} onChange={setEditProductForm} idPrefix="edit-product" />

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Mahsulot Rasmi (MinIO Cloud Saqlash)
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setEditProductImage(e.target.files[0] || null)}
              className="input-field"
              style={{ padding: '8px 12px' }}
            />
            {editProductImage ? (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={URL.createObjectURL(editProductImage)}
                  alt="Yangi rasm"
                  style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border-subtle)' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Yangi: {editProductImage.name} ({Math.round(editProductImage.size / 1024)} KB)
                </span>
                <button
                  type="button"
                  onClick={() => setEditProductImage(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--accent-rose)',
                    fontSize: 12,
                    cursor: 'pointer',
                    marginLeft: 'auto',
                  }}
                >
                  Bekor qilish
                </button>
              </div>
            ) : editProductForm.current_image ? (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={resolveMediaUrl(editProductForm.current_image)}
                  alt="Mavjud rasm"
                  style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--border-subtle)' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Mavjud mahsulot rasmi
                </span>
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => {
                setEditProductModalOpen(false);
                setEditProductImage(null);
              }}
              className="btn btn-secondary"
            >
              Bekor Qilish
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
            >
              {submitting ? 'Saqlanmoqda...' : 'O‘zgarishlarni Saqlash'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Camera Barcode Scanner Modal */}
      <CameraBarcodeScanner
        isOpen={cameraScannerOpen}
        onClose={() => setCameraScannerOpen(false)}
        onScan={handleCameraScan}
        title={
          scannerTarget === 'product_barcode' || scannerTarget === 'edit_barcode'
            ? 'Mahsulot Shtrix-kodini O‘qish'
            : 'Katalog Shtrix-kod Skaneri'
        }
      />
    </div>
  );
}
