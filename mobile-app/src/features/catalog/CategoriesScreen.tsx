import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { getServerScope } from '../../api/environment';
import { request } from '../../api/client';
import { ApiPicker } from '../../components/ui/ApiPicker';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { ChoiceField } from '../../components/ui/ChoiceField';
import { Input } from '../../components/ui/Input';
import { ListState } from '../../components/ui/ListState';
import { Loading, Notice, Page, Retry } from '../../components/ui/Page';
import { useApiResource } from '../../hooks/useApiResource';
import { useApiAction } from '../../hooks/useApiAction';
import { useDebounced, usePagedResource } from '../../hooks/usePagedResource';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { Category, categoryPayload, parseCategory } from './categories';

function CategoryFields({ category, initialParent, onClose }: { category: Category | null; initialParent: Category | null; onClose: () => void }) {
  const [name, setName] = useState(category?.name || ''), [kod, setKod] = useState(category?.kod || '');
  const [parent, setParent] = useState<Category | null>(initialParent), [currency, setCurrency] = useState<'UZS' | 'USD'>(category?.currency || initialParent?.currency || 'UZS');
  const { can } = usePermissions(), action = useApiAction(category ? 'catalog.change_category' : 'catalog.add_category');
  const [confirmDelete, setConfirmDelete] = useState(false), remove = useApiAction('catalog.archive_category');
  const save = async () => {
    const saved = await action.run(() => request(category ? `/catalog/categories/${category.id}/` : '/catalog/categories/', { method: category ? 'PATCH' : 'POST', body: JSON.stringify(categoryPayload({ name, kod, parent, currency, id: category?.id })) }));
    if (saved !== undefined) onClose();
  };
  return <BottomSheet visible title={category ? 'Kategoriyani tahrirlash' : 'Yangi kategoriya'} onClose={() => { if (!action.busy && !remove.busy) onClose(); }} scrollable>
    <Input label="Kategoriya nomi" value={name} onChangeText={setName} maxLength={150} editable={!action.busy} />
    <Input label="Kategoriya kodi (ixtiyoriy)" value={kod} onChangeText={setKod} maxLength={20} editable={!action.busy} />
    <ApiPicker label="Ota kategoriya" endpoint="/catalog/categories/?parent=null" value={parent} optional disabled={action.busy} onChange={value => { const selected = value ? parseCategory(value) : null; setParent(selected); if (selected) setCurrency(selected.currency); }} />
    <ChoiceField label="Valyuta" value={parent?.currency || currency} onChange={setCurrency} disabled={Boolean(parent) || action.busy} options={[{ value: 'UZS', label: 'UZS' }, { value: 'USD', label: 'USD' }]} />
    <Notice>Ichki kategoriya ota kategoriya valyutasidan foydalanadi. Eng ko‘pi bilan 2 bosqich.</Notice>
    {action.error ? <Notice error>{action.error}</Notice> : null}
    <Button title="Kategoriyani saqlash" loading={action.busy} disabled={remove.busy} onPress={() => { void save(); }} />
    {category && can('catalog.archive_category') ? <>
      <Button title="Kategoriyani o‘chirish" variant="danger" disabled={action.busy || remove.busy} onPress={() => setConfirmDelete(true)} />
      {confirmDelete ? <><Notice error>“{category.name}” o‘chirilsinmi? Faol tovar yoki ichki kategoriya bo‘lsa server amalni rad etadi.</Notice><Button title="O‘chirishni tasdiqlash" variant="danger" loading={remove.busy} onPress={() => { void remove.run(() => request(`/catalog/categories/${category.id}/`, { method: 'DELETE' })).then(result => { if (result !== undefined) onClose(); }); }} /><Button title="Bekor qilish" variant="secondary" onPress={() => setConfirmDelete(false)} /></> : null}
      {remove.error ? <Notice error>{remove.error}</Notice> : null}
    </> : null}
  </BottomSheet>;
}
function CategoryForm(props: { category: Category | null; initialParent: Category | null; onClose: () => void }) {
  const neededParent = props.category?.parent && props.initialParent?.id !== props.category.parent;
  const resource = useApiResource(neededParent ? `/catalog/categories/${props.category!.parent}/` : null, parseCategory);
  if (neededParent && !resource.data) return <BottomSheet visible title="Kategoriya yuklanmoqda" onClose={props.onClose}>{resource.error ? <Retry error={resource.error} retry={() => { void resource.reload(); }} /> : <Loading />}</BottomSheet>;
  return <CategoryFields {...props} initialParent={neededParent ? resource.data : props.initialParent} />;
}
function CategoriesBody() {
  const navigation = useAppNavigation(), { colors } = useTheme(), { can } = usePermissions();
  const [parent, setParent] = useState<Category | null>(null), [search, setSearch] = useState('');
  const [form, setForm] = useState<{ category: Category | null; parent: Category | null } | null>(null);
  const query = useDebounced(search.trim());
  const categories = usePagedResource('/catalog/categories/?' + (query ? 'search=' + encodeURIComponent(query) : 'parent=' + (parent?.id || 'null')), parseCategory);
  return <Page title="Kategoriyalar" onBack={navigation.goBack} insetBottom={false} scroll={false}>
    <View style={{ padding: 16, gap: 10 }}>
      <Input label="Kategoriya qidirish" value={search} onChangeText={setSearch} />
      {parent ? <Button title={'← Bosh kategoriyalar / ' + parent.name} variant="secondary" onPress={() => { setParent(null); setSearch(''); }} /> : null}
      {can('catalog.add_category') ? <Button title="Yangi kategoriya" onPress={() => setForm({ category: null, parent })} /> : null}
    </View>
    <FlatList data={categories.rows} keyExtractor={row => String(row.id)} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }} refreshing={categories.loading} onRefresh={categories.reload} onEndReached={() => { void categories.loadMore(); }}
      ListEmptyComponent={<ListState loading={categories.loading} error={categories.error} empty onRetry={categories.retry} />}
      ListFooterComponent={categories.rows.length ? <><ListState loading={categories.loadingMore} error={categories.error} onRetry={categories.retry} />{categories.hasMore ? <Button title="Yana yuklash" onPress={() => { void categories.loadMore(); }} /> : null}</> : undefined}
      renderItem={({ item }) => <View style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 10, gap: 8 }}>
        <Text style={{ color: colors.text, fontWeight: '700' }}>{item.parent ? '↳ ' : ''}{item.name}</Text><Notice>{item.kod} · {item.currency}</Notice>
        {item.parent === null ? <Button title={item.name + ': ichki kategoriyalar'} variant="secondary" onPress={() => { setSearch(''); setParent(item); }} /> : null}
        {can('catalog.view_product') ? <Button title={item.name + ': tovarlarni ko‘rish'} variant="ghost" onPress={() => navigation.navigate('Tovar', { categoryId: String(item.id), categoryName: item.name })} /> : null}
        {can('catalog.change_category') ? <Button title={item.name + ': tahrirlash'} variant="secondary" onPress={() => setForm({ category: item, parent: item.parent === parent?.id ? parent : null })} /> : null}
      </View>} />
    {form ? <CategoryForm category={form.category} initialParent={form.parent} onClose={() => setForm(null)} /> : null}
  </Page>;
}
export function CategoriesScreen() {
  const { user, activeTenant } = useAuth();
  return <CategoriesBody key={[getServerScope(), user?.id, activeTenant?.id].join(':')} />;
}
