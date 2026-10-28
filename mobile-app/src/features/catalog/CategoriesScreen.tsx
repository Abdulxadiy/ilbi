import { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Folder, FolderTree, Layers, MoreVertical, Package, Pencil } from 'lucide-react-native';
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
    <Input label="Kategoriya nomi" value={name} error={action.fields.name} onChangeText={value => { setName(value); action.clearField('name'); }} maxLength={150} editable={!action.busy} />
    <Input label="Kategoriya kodi (ixtiyoriy)" value={kod} error={action.fields.kod} onChangeText={value => { setKod(value); action.clearField('kod'); }} maxLength={20} editable={!action.busy} />
    <ApiPicker label="Ota kategoriya" endpoint="/catalog/categories/?parent=null" value={parent} error={action.fields.parent_id || action.fields.parent} optional disabled={action.busy} onChange={value => { action.clearField('parent_id'); action.clearField('parent'); const selected = value ? parseCategory(value) : null; setParent(selected); if (selected) setCurrency(selected.currency); }} />
    <ChoiceField label="Valyuta" value={parent?.currency || currency} error={action.fields.currency} onChange={value => { setCurrency(value); action.clearField('currency'); }} disabled={Boolean(parent) || action.busy} options={[{ value: 'UZS', label: 'UZS' }, { value: 'USD', label: 'USD' }]} />
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
  const [activeMenu, setActiveMenu] = useState<Category | null>(null);
  const query = useDebounced(search.trim());
  const categories = usePagedResource('/catalog/categories/?' + (query ? 'search=' + encodeURIComponent(query) : 'parent=' + (parent?.id || 'null')), parseCategory);

  return (
    <Page title="Kategoriyalar" onBack={navigation.goBack} insetBottom={false} scroll={false}>
      <View style={catStyles.headerSearchBox}>
        <Input label="Kategoriya qidirish" value={search} onChangeText={setSearch} />
        {parent ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => { setParent(null); setSearch(''); }}
            style={[catStyles.parentBackBtn, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Text style={[catStyles.parentBackText, { color: colors.text }]}>
              ← Bosh kategoriyalar / {parent.name}
            </Text>
          </TouchableOpacity>
        ) : null}
        {can('catalog.add_category') ? (
          <Button title="Yangi kategoriya" onPress={() => setForm({ category: null, parent })} />
        ) : null}
      </View>

      <FlatList
        data={categories.rows}
        keyExtractor={row => String(row.id)}
        contentContainerStyle={catStyles.listContent}
        refreshing={categories.loading}
        onRefresh={categories.reload}
        onEndReached={() => { void categories.loadMore(); }}
        ListEmptyComponent={<ListState loading={categories.loading} error={categories.error} empty onRetry={categories.retry} />}
        ListFooterComponent={categories.rows.length ? (
          <>
            <ListState loading={categories.loadingMore} error={categories.error} onRetry={categories.retry} />
            {categories.hasMore ? <Button title="Yana yuklash" onPress={() => { void categories.loadMore(); }} /> : null}
          </>
        ) : undefined}
        renderItem={({ item }) => (
          <View style={[catStyles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <View style={catStyles.cardHeader}>
              <View style={[catStyles.stickerWrap, { backgroundColor: colors.surfaceSecondary }]}>
                {item.parent ? (
                  <Layers size={20} color={colors.text} />
                ) : (
                  <Folder size={20} color={colors.text} />
                )}
              </View>

              <View style={catStyles.titleColumn}>
                <Text style={[catStyles.categoryName, { color: colors.text }]}>
                  {item.parent ? '↳ ' : ''}{item.name}
                </Text>
                <View style={catStyles.metaRow}>
                  <View style={[catStyles.codeBadge, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[catStyles.codeBadgeText, { color: colors.textSecondary }]}>
                      Kod: {item.kod}
                    </Text>
                  </View>
                  <Text style={[catStyles.currencyText, { color: colors.textMuted }]}>
                    {item.currency}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Kategoriya amallari"
                onPress={() => setActiveMenu(item)}
                style={catStyles.kebabBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MoreVertical size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={catStyles.actionChipsWrap}>
              {item.parent === null ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => { setSearch(''); setParent(item); }}
                  style={[catStyles.actionChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderSubtle }]}
                >
                  <FolderTree size={14} color={colors.textSecondary} />
                  <Text style={[catStyles.actionChipText, { color: colors.text }]}>
                    {item.name}: ichki kategoriyalar
                  </Text>
                </TouchableOpacity>
              ) : null}

              {can('catalog.view_product') ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('Tovar', { categoryId: String(item.id), categoryName: item.name })}
                  style={[catStyles.actionChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderSubtle }]}
                >
                  <Package size={14} color={colors.textSecondary} />
                  <Text style={[catStyles.actionChipText, { color: colors.text }]}>
                    {item.name}: tovarlarni ko‘rish
                  </Text>
                </TouchableOpacity>
              ) : null}

              {can('catalog.change_category') ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={() => setForm({ category: item, parent: item.parent === parent?.id ? parent : null })}
                  style={[catStyles.actionChip, { backgroundColor: colors.surfaceSecondary, borderColor: colors.borderSubtle }]}
                >
                  <Pencil size={14} color={colors.textSecondary} />
                  <Text style={[catStyles.actionChipText, { color: colors.text }]}>
                    {item.name}: tahrirlash
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
      />

      {/* 3-dots Kebab Action BottomSheet */}
      <BottomSheet
        visible={Boolean(activeMenu)}
        onClose={() => setActiveMenu(null)}
        title={activeMenu ? activeMenu.name : 'Amallar'}
      >
        {activeMenu ? (
          <View style={catStyles.sheetMenu}>
            {activeMenu.parent === null ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  const target = activeMenu;
                  setActiveMenu(null);
                  setSearch('');
                  setParent(target);
                }}
                style={[catStyles.sheetMenuItem, { backgroundColor: colors.surfaceSecondary }]}
              >
                <FolderTree size={18} color={colors.text} />
                <Text style={[catStyles.sheetMenuText, { color: colors.text }]}>
                  Ichki kategoriyalarni ko‘rish
                </Text>
              </TouchableOpacity>
            ) : null}

            {can('catalog.view_product') ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  const target = activeMenu;
                  setActiveMenu(null);
                  navigation.navigate('Tovar', { categoryId: String(target.id), categoryName: target.name });
                }}
                style={[catStyles.sheetMenuItem, { backgroundColor: colors.surfaceSecondary }]}
              >
                <Package size={18} color={colors.text} />
                <Text style={[catStyles.sheetMenuText, { color: colors.text }]}>
                  Ushbu kategoriya tovarlari
                </Text>
              </TouchableOpacity>
            ) : null}

            {can('catalog.change_category') ? (
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  const target = activeMenu;
                  setActiveMenu(null);
                  setForm({ category: target, parent: target.parent === parent?.id ? parent : null });
                }}
                style={[catStyles.sheetMenuItem, { backgroundColor: colors.surfaceSecondary }]}
              >
                <Pencil size={18} color={colors.text} />
                <Text style={[catStyles.sheetMenuText, { color: colors.text }]}>
                  Kategoriyani tahrirlash
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </BottomSheet>

      {form ? <CategoryForm category={form.category} initialParent={form.parent} onClose={() => setForm(null)} /> : null}
    </Page>
  );
}

const catStyles = StyleSheet.create({
  headerSearchBox: {
    padding: 16,
    gap: 10,
  },
  parentBackBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  parentBackText: {
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stickerWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleColumn: {
    flex: 1,
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  codeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  codeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  currencyText: {
    fontSize: 11,
  },
  kebabBtn: {
    padding: 6,
  },
  actionChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 4,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  sheetMenu: {
    gap: 10,
    paddingVertical: 8,
  },
  sheetMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 10,
  },
  sheetMenuText: {
    fontSize: 15,
    fontWeight: '500',
  },
});

export function CategoriesScreen() {
  const { user, activeTenant } = useAuth();
  return <CategoriesBody key={[getServerScope(), user?.id, activeTenant?.id].join(':')} />;
}
