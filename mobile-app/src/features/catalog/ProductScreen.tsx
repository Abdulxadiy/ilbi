import { useRef, useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Archive, Box, Camera, Pencil, Plus, Trash2 } from 'lucide-react-native';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import { pickImageUpload } from '../../api/imageUpload';
import { formError, type FieldErrors } from '../../api/validation';
import { getServerScope } from '../../api/environment';
import { ApiPicker, PickValue } from '../../components/ui/ApiPicker';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { Input } from '../../components/ui/Input';
import { Loading, Notice, Page, Retry } from '../../components/ui/Page';
import { useApiAction } from '../../hooks/useApiAction';
import { useApiResource } from '../../hooks/useApiResource';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { CatalogProduct, parseProduct, VariantDraft, variantDraft, variantPayload } from './editorModel';
import { CatalogVariant } from './model';

function VariantFields({ value, onChange, disabled = false, errors = {}, clearField }: { value: VariantDraft; onChange: (value: VariantDraft) => void; disabled?: boolean; errors?: FieldErrors; clearField?: (key: string) => void }) {
  const input = (key: keyof VariantDraft, label: string, numeric = false, limit = 64) => <Input key={key} label={label} value={value[key]} editable={!disabled} error={errors[key]} onChangeText={text => { clearField?.(key); onChange({ ...value, [key]: text }); }} keyboardType={numeric ? 'decimal-pad' : 'default'} maxLength={limit} autoCapitalize="none" />;
  return <>
    {input('name', 'Variant nomi', false, 150)}
    <ChoiceField label="O‘lchov birligi" value={value.unit} options={[{ value: 'dona', label: 'Dona' }, { value: 'kg', label: 'Kg' }, { value: 'litr', label: 'Litr' }, { value: 'metr', label: 'Metr' }]} error={errors.unit} onChange={unit => { clearField?.('unit'); onChange({ ...value, unit }); }} disabled={disabled} />
    {input('price_recommended', 'Tavsiya sotuv narxi', true)}
    {input('price_partner', 'Ulgurji sotuv narxi', true)}
    {input('price_min', 'Minimal narx (tavsiya)', true)}
    <Notice>Bu katalog narxlari keyingi savdolarda ishlatiladi. Savatdagi kelishilgan narx va eski chek o‘zgarmaydi. Minimal narx tavsiya, savdoni taqiqlovchi chegara emas.</Notice>
    {input('code', 'Mahsulot kodi')}{input('barcode', 'Shtrix-kod')}
    <Notice>SKU server tomonidan yaratiladi. Mahsulot kodi narx o‘zgarganda avtomatik o‘zgarmaydi.</Notice>
    {input('mxik', 'MXIK (ixtiyoriy)', false, 17)}{input('package_code', 'Qadoq kodi (ixtiyoriy)', false, 20)}
  </>;
}
function VariantEditor({ product, variant, onClose }: { product: CatalogProduct; variant: CatalogVariant | null; onClose: () => void }) {
  const [draft, setDraft] = useState(() => variantDraft(variant));
  const action = useApiAction('catalog.change_product');
  const save = async () => {
    const result = await action.run(() => request(variant ? `/catalog/variants/${variant.id}/` : `/catalog/products/${product.id}/variants/`, { method: variant ? 'PATCH' : 'POST', body: JSON.stringify(variantPayload(draft)) }));
    if (result !== undefined) onClose();
  };
  return <BottomSheet visible title={variant ? 'Variantni tahrirlash' : 'Yangi variant'} onClose={() => { if (!action.busy) onClose(); }} scrollable>
    {variant?.sku ? <Notice>SKU: {variant.sku}</Notice> : null}
    <VariantFields value={draft} onChange={setDraft} disabled={action.busy} errors={action.fields} clearField={action.clearField} />
    {action.error ? <Notice error>{action.error}</Notice> : null}
    <Button title="Variantni saqlash" loading={action.busy} onPress={() => { void save(); }} />
  </BottomSheet>;
}
type Lifecycle = { endpoint: string; method: 'POST' | 'DELETE'; label: string; description: string };
function ProductEditor({ product, onSaved, onDeleted }: { product: CatalogProduct | null; onSaved: () => void; onDeleted: () => void }) {
  const { colors } = useTheme(), { can, requirePermission } = usePermissions();
  const { user, activeTenant } = useAuth();
  const editable = can(product ? 'catalog.change_product' : 'catalog.add_product');
  const [name, setName] = useState(product?.name || '');
  const [category, setCategory] = useState<PickValue | null>(product ? { id: product.category, name: product.variants[0]?.category_name || 'Kategoriya #' + product.category, currency: product.variants[0]?.currency } : null);
  const [draft, setDraft] = useState(() => variantDraft());
  const [variantForm, setVariantForm] = useState<{ variant: CatalogVariant | null } | null>(null);
  const [confirm, setConfirm] = useState<Lifecycle | null>(null), [saved, setSaved] = useState('');
  const action = useApiAction(product ? 'catalog.change_product' : 'catalog.add_product'), lifecycle = useApiAction('catalog.archive_product');
  const save = async () => {
    setSaved('');
    const result = await action.run(() => {
      if (!name.trim() || name.trim().length > 200) throw formError({ name: 'Mahsulot nomi 1–200 belgidan iborat bo‘lsin.' });
      if (!category) throw formError({ category_id: 'Kategoriyani tanlang.' });
      const fields: any = { name: name.trim(), category_id: category.id };
      if (!product) {
        let payload;
        try { payload = variantPayload(draft); } catch (failure: any) {
          const detail = failure.data?.error?.details;
          if (detail?.name) { detail.variant_name = detail.name; delete detail.name; }
          throw failure;
        }
        const { name: variantName, ...variant } = payload; Object.assign(fields, variant, { variant_name: variantName });
      }
      return request(product ? `/catalog/products/${product.id}/` : '/catalog/products/', { method: product ? 'PATCH' : 'POST', body: JSON.stringify(fields) });
    });
    if (result !== undefined) { setSaved('Mahsulot saqlandi.'); onSaved(); }
  };
  const [imageUploading, setImageUploading] = useState(false);
  const [imageError, setImageError] = useState('');
  const imageLock = useRef(false);

  const pickProductImage = async () => {
    if (!product || !editable || action.busy || lifecycle.busy || imageLock.current) return;
    imageLock.current = true;
    setImageUploading(true);
    setImageError('');
    const scope = captureAuthScope(user?.id, activeTenant?.id);
    try {
      assertAuthScope(scope);
      requirePermission('catalog.change_product');
      const formData = await pickImageUpload('image', () => assertAuthScope(scope));
      if (!formData) return;
      assertAuthScope(scope);
      requirePermission('catalog.change_product');
      await request(`/catalog/products/${product.id}/`, {
        method: 'PATCH',
        body: formData,
      });
      assertAuthScope(scope);
      setSaved('Rasm yuklandi.');
      onSaved();
    } catch (err: any) {
      setImageError(err.message || 'Rasmni yuklab bo‘lmadi.');
    } finally {
      imageLock.current = false;
      setImageUploading(false);
    }
  };

  const performLifecycle = async () => {
    if (!confirm || imageLock.current) return;
    const result = await lifecycle.run(() => request(confirm.endpoint, { method: confirm.method, ...(confirm.method === 'POST' ? { body: '{}' } : {}) }));
    if (result !== undefined) { const deleted = confirm.method === 'DELETE'; setConfirm(null); setSaved('Amal serverda tasdiqlandi.'); if (deleted) onDeleted(); }
  };
  const ask = (type: 'products' | 'variants', id: number, verb: 'archive' | 'unarchive' | 'delete', title: string) => { if (imageLock.current) return; setConfirm({ endpoint: `/catalog/${type}/${id}/` + (verb === 'delete' ? '' : verb + '/'), method: verb === 'delete' ? 'DELETE' : 'POST', label: verb === 'delete' ? 'O‘chirishni tasdiqlash' : verb === 'archive' ? 'Arxivlashni tasdiqlash' : 'Tiklashni tasdiqlash', description: '“' + title + '” ' + (verb === 'delete' ? 'o‘chirilsinmi? Harakat tarixi bor mahsulot arxivlanadi va tarixi saqlanadi. Tarixi yo‘q mahsulot butunlay o‘chiriladi.' : verb === 'archive' ? 'arxivlansinmi? POS ro‘yxatidan yashiriladi. Tarix saqlanadi.' : 'tiklansinmi? Mahsulot tiklansa barcha variantlari ham tiklanadi.') }); };

  return <>
    {/* Product Image Section */}
    {product ? (
      <View style={[prodStyles.imageCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {product.image ? (
          <View style={prodStyles.imageRow}>
            <Image
              source={{ uri: product.image }}
              style={prodStyles.productImage}
              accessibilityLabel={product.name + ' rasmi'}
            />
            <View style={prodStyles.imageInfoCol}>
              <Text style={[prodStyles.imageTitle, { color: colors.text }]}>Mahsulot rasmi</Text>
              <Text style={[prodStyles.imageSubtext, { color: colors.textSecondary }]}>
                Asosiy vizual ko‘rinish
              </Text>
              {editable ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={imageUploading || action.busy || lifecycle.busy}
                  onPress={pickProductImage}
                  style={[prodStyles.changeImageBtn, { backgroundColor: colors.surfaceSecondary }]}
                >
                  <Camera size={14} color={colors.text} />
                  <Text style={[prodStyles.changeImageText, { color: colors.text }]}>
                    {imageUploading ? 'Yuklanmoqda...' : 'O‘zgartirish'}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!editable || imageUploading || action.busy || lifecycle.busy}
            onPress={pickProductImage}
            style={prodStyles.uploadPlaceholder}
          >
            <View style={[prodStyles.uploadIconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <Camera size={24} color={colors.textSecondary} />
            </View>
            <Text style={[prodStyles.uploadTitle, { color: colors.text }]}>
              {imageUploading ? 'Rasm yuklanmoqda...' : 'Mahsulot rasmini yuklash'}
            </Text>
            <Text style={[prodStyles.uploadHint, { color: colors.textMuted }]}>
              Galereyadan rasm tanlash uchun bosing
            </Text>
          </TouchableOpacity>
        )}
        {imageError ? <Notice error>{imageError}</Notice> : null}
      </View>
    ) : null}

    {product && !product.is_active ? <Notice>Mahsulot arxivlangan.</Notice> : null}
    <Input label="Mahsulot nomi" value={name} error={action.fields.name} onChangeText={value => { setName(value); action.clearField('name'); }} maxLength={200} editable={editable && !action.busy && !imageUploading} />
    <ApiPicker label="Mahsulot kategoriyasi" endpoint="/catalog/categories/" value={category} error={action.fields.category_id || action.fields.category} onChange={value => { setCategory(value); action.clearField('category_id'); action.clearField('category'); }} disabled={!editable || action.busy || imageUploading || !can('catalog.view_category')} />
    {category?.currency ? <Notice>Valyuta: {category.currency}</Notice> : null}
    {!product ? <VariantFields value={draft} onChange={setDraft} disabled={!editable || action.busy} errors={{ ...action.fields, name: action.fields.variant_name }} clearField={key => action.clearField(key === 'name' ? 'variant_name' : key)} /> : null}
    {action.error ? <Notice error>{action.error}</Notice> : null}
    {saved ? <Notice>{saved}</Notice> : null}
    {editable ? <Button title="Mahsulotni saqlash" loading={action.busy} disabled={lifecycle.busy || imageUploading} onPress={() => { void save(); }} /> : null}

    {product ? <>
      <View style={prodStyles.sectionHeaderRow}>
        <Text style={[prodStyles.sectionTitle, { color: colors.text }]}>Variantlar</Text>
        {can('catalog.change_product') ? (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={imageUploading || action.busy || lifecycle.busy}
            onPress={() => setVariantForm({ variant: null })}
            style={[prodStyles.addVariantChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderSubtle }]}
          >
            <Plus size={14} color={colors.text} />
            <Text style={[prodStyles.addVariantChipText, { color: colors.text }]}>Yangi variant</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={prodStyles.variantsList}>
        {product.variants.map(variant => (
          <View key={variant.id} style={[prodStyles.variantCard, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={prodStyles.variantHeader}>
              <View style={[prodStyles.variantIconWrap, { backgroundColor: colors.surfaceSecondary }]}>
                <Box size={18} color={colors.text} />
              </View>

              <View style={prodStyles.variantDetails}>
                <View style={prodStyles.variantTitleRow}>
                  <Text style={[prodStyles.variantName, { color: colors.text }]}>{variant.name}</Text>
                  {variant.is_active === false && (
                    <View style={[prodStyles.archiveBadge, { backgroundColor: colors.surfaceSecondary }]}>
                      <Text style={[prodStyles.archiveBadgeText, { color: colors.danger }]}>Arxiv</Text>
                    </View>
                  )}
                </View>
                <Text style={[prodStyles.variantMeta, { color: colors.textSecondary }]}>
                  {variant.unit} · Qoldiq: {variant.stock_quantity} · {variant.price_recommended} {variant.currency}
                </Text>
                <Text style={[prodStyles.variantSubMeta, { color: colors.textMuted }]}>
                  Ulgurji: {variant.price_partner} · Minimal tavsiya: {variant.price_min}
                </Text>
              </View>
            </View>

            <View style={prodStyles.variantActionsRow}>
              {can('catalog.change_product') ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={lifecycle.busy || imageUploading}
                  onPress={() => setVariantForm({ variant })}
                  style={[prodStyles.actionChip, { backgroundColor: colors.surfaceSecondary }]}
                >
                  <Pencil size={13} color={colors.text} />
                  <Text style={[prodStyles.actionChipText, { color: colors.text }]}>
                    {variant.name}: tahrirlash
                  </Text>
                </TouchableOpacity>
              ) : null}

              {can('catalog.archive_product') ? (
                <>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => ask('variants', variant.id, variant.is_active === false ? 'unarchive' : 'archive', variant.name)}
                    style={[prodStyles.actionChip, { backgroundColor: colors.surfaceSecondary }]}
                  >
                    <Archive size={13} color={colors.textSecondary} />
                    <Text style={[prodStyles.actionChipText, { color: colors.textSecondary }]}>
                      {variant.name + (variant.is_active === false ? ': tiklash' : ': arxivlash')}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => ask('variants', variant.id, 'delete', variant.name)}
                    style={[prodStyles.actionChip, { backgroundColor: colors.surfaceSecondary }]}
                  >
                    <Trash2 size={13} color={colors.danger} />
                    <Text style={[prodStyles.actionChipText, { color: colors.danger }]}>
                      {variant.name}: o‘chirish
                    </Text>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {/* Lifecycle Actions Box (Archive / Delete Product) */}
      {can('catalog.archive_product') ? (
        <View style={[prodStyles.lifecycleCard, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
          <Text style={[prodStyles.lifecycleTitle, { color: colors.textSecondary }]}>Mahsulot holati va xavfli amallar</Text>
          <View style={prodStyles.lifecycleButtonsRow}>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={action.busy || imageUploading}
              onPress={() => ask('products', product.id, product.is_active ? 'archive' : 'unarchive', product.name)}
              style={[prodStyles.lifecycleBtn, { backgroundColor: colors.surfaceSecondary }]}
            >
              <Archive size={14} color={colors.text} />
              <Text style={[prodStyles.lifecycleBtnText, { color: colors.text }]}>
                {product.is_active ? 'Mahsulotni arxivlash' : 'Mahsulotni tiklash'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              disabled={action.busy || imageUploading}
              onPress={() => ask('products', product.id, 'delete', product.name)}
              style={[prodStyles.lifecycleBtn, { backgroundColor: colors.surfaceSecondary }]}
            >
              <Trash2 size={14} color={colors.danger} />
              <Text style={[prodStyles.lifecycleBtnText, { color: colors.danger }]}>
                Mahsulotni o‘chirish
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {variantForm ? <VariantEditor key={variantForm.variant?.id || 'new'} product={product} variant={variantForm.variant} onClose={() => setVariantForm(null)} /> : null}
    </> : null}

    <BottomSheet visible={Boolean(confirm)} title="Amalni tasdiqlash" onClose={() => { if (!lifecycle.busy) setConfirm(null); }}>
      <Notice>{confirm?.description}</Notice>
      {lifecycle.error ? <Notice error>{lifecycle.error}</Notice> : null}
      <Button title={confirm?.label || 'Tasdiqlash'} variant={confirm?.method === 'DELETE' ? 'danger' : 'primary'} loading={lifecycle.busy} onPress={() => { void performLifecycle(); }} />
      <Button title="Bekor qilish" variant="secondary" disabled={lifecycle.busy || imageUploading} onPress={() => setConfirm(null)} />
    </BottomSheet>
  </>;
}
function ProductBody({ id }: { id: number | null }) {
  const navigation = useAppNavigation(), { can } = usePermissions();
  const [creation, setCreation] = useState(0);
  const allowed = can(id ? 'catalog.view_product' : 'catalog.add_product');
  const product = useApiResource(allowed && id ? `/catalog/products/${id}/` : null, parseProduct);
  return <Page title={id ? 'Mahsulot' : 'Yangi mahsulot'} onBack={navigation.goBack} insetBottom={false}>
    {!allowed ? <Notice error>Bu amal uchun vakolat berilmagan.</Notice> : id && !product.data ? product.error ? <Retry error={product.error} retry={() => { void product.reload(); }} /> : <Loading /> : <>
      {product.error ? <Retry error={product.error} retry={() => { void product.reload(); }} /> : null}
      <ProductEditor key={id || 'new-' + creation} product={product.data} onSaved={() => { if (!id) { setCreation(value => value + 1); navigation.goBack(); } }} onDeleted={navigation.goBack} />
    </>}
  </Page>;
}
export function ProductScreen({ id = null }: { id?: number | null }) {
  const { user, activeTenant } = useAuth();
  return <ProductBody key={[getServerScope(), user?.id, activeTenant?.id, id].join(':')} id={id} />;
}

const prodStyles = StyleSheet.create({
  imageCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  imageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  productImage: {
    width: 72,
    height: 72,
    borderRadius: 12,
  },
  imageInfoCol: {
    flex: 1,
    gap: 4,
  },
  imageTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  imageSubtext: {
    fontSize: 12,
  },
  changeImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 4,
  },
  changeImageText: {
    fontSize: 12,
    fontWeight: '500',
  },
  uploadPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    gap: 6,
  },
  uploadIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  uploadHint: {
    fontSize: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  addVariantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  addVariantChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  variantsList: {
    gap: 10,
    marginBottom: 16,
  },
  variantCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  variantHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  variantIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  variantDetails: {
    flex: 1,
    gap: 2,
  },
  variantTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  variantName: {
    fontSize: 15,
    fontWeight: '600',
  },
  archiveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  archiveBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  variantMeta: {
    fontSize: 12,
  },
  variantSubMeta: {
    fontSize: 11,
  },
  variantActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  lifecycleCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    marginTop: 6,
    marginBottom: 16,
  },
  lifecycleTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  lifecycleButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  lifecycleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  lifecycleBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
