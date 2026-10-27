import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { request } from '../../api/client';
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
  const { colors } = useTheme(), { can } = usePermissions();
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
  const performLifecycle = async () => {
    if (!confirm) return;
    const result = await lifecycle.run(() => request(confirm.endpoint, { method: confirm.method, ...(confirm.method === 'POST' ? { body: '{}' } : {}) }));
    if (result !== undefined) { const deleted = confirm.method === 'DELETE'; setConfirm(null); setSaved('Amal serverda tasdiqlandi.'); if (deleted) onDeleted(); }
  };
  const ask = (type: 'products' | 'variants', id: number, verb: 'archive' | 'unarchive' | 'delete', title: string) => setConfirm({ endpoint: `/catalog/${type}/${id}/` + (verb === 'delete' ? '' : verb + '/'), method: verb === 'delete' ? 'DELETE' : 'POST', label: verb === 'delete' ? 'O‘chirishni tasdiqlash' : verb === 'archive' ? 'Arxivlashni tasdiqlash' : 'Tiklashni tasdiqlash', description: '“' + title + '” ' + (verb === 'delete' ? 'o‘chirilsinmi? Harakat tarixi bor mahsulot arxivlanadi va tarixi saqlanadi. Tarixi yo‘q mahsulot butunlay o‘chiriladi.' : verb === 'archive' ? 'arxivlansinmi? POS ro‘yxatidan yashiriladi. Tarix saqlanadi.' : 'tiklansinmi? Mahsulot tiklansa barcha variantlari ham tiklanadi.') });
  return <>
    {product?.image ? <Image source={{ uri: product.image }} style={{ width: 80, height: 80, borderRadius: 10 }} accessibilityLabel={product.name + ' rasmi'} /> : null}
    {product && !product.is_active ? <Notice>Mahsulot arxivlangan.</Notice> : null}
    <Input label="Mahsulot nomi" value={name} error={action.fields.name} onChangeText={value => { setName(value); action.clearField('name'); }} maxLength={200} editable={editable && !action.busy} />
    <ApiPicker label="Mahsulot kategoriyasi" endpoint="/catalog/categories/" value={category} error={action.fields.category_id || action.fields.category} onChange={value => { setCategory(value); action.clearField('category_id'); action.clearField('category'); }} disabled={!editable || action.busy || !can('catalog.view_category')} />
    {category?.currency ? <Notice>Valyuta: {category.currency}</Notice> : null}
    {!product ? <VariantFields value={draft} onChange={setDraft} disabled={!editable || action.busy} errors={{ ...action.fields, name: action.fields.variant_name }} clearField={key => action.clearField(key === 'name' ? 'variant_name' : key)} /> : null}
    {action.error ? <Notice error>{action.error}</Notice> : null}
    {saved ? <Notice>{saved}</Notice> : null}
    {editable ? <Button title="Mahsulotni saqlash" loading={action.busy} disabled={lifecycle.busy} onPress={() => { void save(); }} /> : null}
    {product ? <>
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 18 }}>Variantlar</Text>
      {product.variants.map(variant => <View key={variant.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>{variant.name}{variant.is_active === false ? ' · Arxiv' : ''}</Text>
        <Notice>{variant.unit} · Qoldiq: {variant.stock_quantity} · {variant.price_recommended} {variant.currency}</Notice>
        <Notice>Ulgurji: {variant.price_partner} · Minimal tavsiya: {variant.price_min}</Notice>
        {can('catalog.change_product') ? <Button title={variant.name + ': tahrirlash'} variant="secondary" disabled={lifecycle.busy} onPress={() => setVariantForm({ variant })} /> : null}
        {can('catalog.archive_product') ? <><Button title={variant.name + (variant.is_active === false ? ': tiklash' : ': arxivlash')} variant="ghost" onPress={() => ask('variants', variant.id, variant.is_active === false ? 'unarchive' : 'archive', variant.name)} /><Button title={variant.name + ': o‘chirish'} variant="ghost" onPress={() => ask('variants', variant.id, 'delete', variant.name)} /></> : null}
      </View>)}
      {can('catalog.change_product') ? <Button title="Yangi variant" variant="secondary" onPress={() => setVariantForm({ variant: null })} /> : null}
      {can('catalog.archive_product') ? <><Button title={product.is_active ? 'Mahsulotni arxivlash' : 'Mahsulotni tiklash'} variant="secondary" disabled={action.busy} onPress={() => ask('products', product.id, product.is_active ? 'archive' : 'unarchive', product.name)} /><Button title="Mahsulotni o‘chirish" variant="danger" disabled={action.busy} onPress={() => ask('products', product.id, 'delete', product.name)} /></> : null}
      {variantForm ? <VariantEditor key={variantForm.variant?.id || 'new'} product={product} variant={variantForm.variant} onClose={() => setVariantForm(null)} /> : null}
    </> : null}
    <BottomSheet visible={Boolean(confirm)} title="Amalni tasdiqlash" onClose={() => { if (!lifecycle.busy) setConfirm(null); }}>
      <Notice>{confirm?.description}</Notice>
      {lifecycle.error ? <Notice error>{lifecycle.error}</Notice> : null}
      <Button title={confirm?.label || 'Tasdiqlash'} variant={confirm?.method === 'DELETE' ? 'danger' : 'primary'} loading={lifecycle.busy} onPress={() => { void performLifecycle(); }} />
      <Button title="Bekor qilish" variant="secondary" disabled={lifecycle.busy} onPress={() => setConfirm(null)} />
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
