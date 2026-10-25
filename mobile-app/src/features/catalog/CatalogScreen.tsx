import { BarcodeScanner } from '../scanner/BarcodeScanner';
import { useLocalSearchParams, router } from 'expo-router';
import { useFeedback } from '../../hooks/useFeedback';
import { useDebounced, usePagedResource } from '../../hooks/usePagedResource';
import { ListState } from '../../components/ui/ListState';
import { usePermissions } from '../auth/usePermissions';
import React, { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation } from '../../navigation/useAppNavigation';
import { Plus, Search, X } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { useCart } from '../cart/CartContext';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';




import { parseVariant, variantToCart, type CatalogVariant } from './model';

export const CatalogScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { addItem, ready, partner } = useCart();
  const { can } = usePermissions();

  const [search, setSearch] = useState('');
  const { message: toastMessage, type: toastType, show: setToastMessage } = useFeedback();
  const params = useLocalSearchParams<{ categoryId?: string; categoryName?: string; scan?: string }>();
  const categoryId = /^\d+$/.test(params.categoryId || '') ? params.categoryId : '';
  const [scanning, setScanning] = useState(false);
  const closeScanner = () => { setScanning(false); router.setParams({ scan: '' }); };
  const [archived, setArchived] = useState(false);
  const [exactBarcode, setExactBarcode] = useState(false);
  const query = useDebounced(search.trim());
  const catalog = usePagedResource<CatalogVariant>('/catalog/variants/?' + (exactBarcode ? 'barcode=' : 'search=') + encodeURIComponent(query) + (categoryId ? '&category=' + categoryId : '') + (archived ? '&archived=true' : ''), parseVariant);

  const handleAddToCart = (product: CatalogVariant) => {
    if (archived || product.is_active === false) return;
    if (!can('sales.add_sale')) { setToastMessage('Savdo uchun vakolat berilmagan.'); return; }
    if (product.currency !== 'UZS') { setToastMessage('USD tovar POS savdosiga qo‘shilmaydi.'); return; }
    if (!ready) { setToastMessage('Savat yuklanishini kuting yoki qoralamani qayta tiklang.'); return; }
    try { addItem(variantToCart(product, partner)); }
    catch (error: any) { setToastMessage(error.message, 'error'); return; }
    setToastMessage(`"${product.product_name}" savatga qo'shildi`, 'success');
  };


  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader onOpenDrawer={() => navigation.openDrawer()} />

      <Toast
        type={toastType}
        visible={Boolean(toastMessage)}
        message={toastMessage || ''}
        onDismiss={() => setToastMessage(null)}
      />

      {/* Search & Scan Header */}
      <View style={styles.searchSection}>
        <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Search size={18} color={colors.textMuted} />
          <TextInput
            accessibilityLabel="Tovar qidirish"
            placeholder="Nom yoki shtrix-kod bo'yicha qidirish..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {search ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Tovar qidiruvini tozalash" onPress={() => setSearch('')}>
              <X size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Button title={exactBarcode ? "Aniq shtrix-kod: yoqilgan" : "Aniq shtrix-kod bo‘yicha"} variant="ghost" onPress={() => setExactBarcode(value => !value)} />
      </View>

      <View style={{ paddingHorizontal: spacing.lg, gap: 8 }}>
        {can('catalog.view_category') ? <Button title="Kategoriyalar" variant="secondary" onPress={() => navigation.navigate('Categories')} /> : null}
        {categoryId ? <Button title={(params.categoryName || 'Kategoriya') + ': filtrni tozalash'} variant="ghost" onPress={() => router.setParams({ categoryId: '', categoryName: '' })} /> : null}
      </View>
      <View style={{ paddingHorizontal: spacing.lg, gap: 8 }}>
        {can('catalog.add_product') ? <Button title="Yangi mahsulot" onPress={() => navigation.navigate('NewProduct')} /> : null}
        {can('catalog.archive_product') ? <Button title={archived ? 'Faol tovarlarni ko‘rish' : 'Arxivlangan tovarlar'} variant="ghost" onPress={() => setArchived(value => !value)} /> : null}
      </View>
      <View style={{ paddingHorizontal: spacing.lg }}><Button title="Kameradan skanerlash" variant="secondary" onPress={() => setScanning(true)} /></View>
      {(scanning || params.scan === '1') ? <BarcodeScanner onClose={closeScanner} onCode={code => { setSearch(code); setExactBarcode(true); setArchived(false); router.setParams({ categoryId: '', categoryName: '' }); }} /> : null}
      {/* Products List */}
      <FlatList
        data={catalog.rows}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={catalog.loading} onRefresh={catalog.reload} />}
        onEndReached={() => { void catalog.loadMore(); }}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={<ListState loading={catalog.loading} error={catalog.error} empty emptyLabel={exactBarcode && query ? 'Bu shtrix-kod bo‘yicha tovar topilmadi. Kodni tekshiring yoki nomidan qidiring.' : 'Tovar topilmadi'} onRetry={catalog.retry} />}
        ListFooterComponent={catalog.rows.length ? <><ListState loading={catalog.loadingMore} error={catalog.error} onRetry={catalog.retry} />{catalog.hasMore && !catalog.error && <Button title="Yana yuklash" variant="secondary" onPress={() => { void catalog.loadMore(); }} />}</> : undefined}
        renderItem={({ item }) => (
          <View
            style={[
              styles.productCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={[styles.thumbBox, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={{ fontSize: 20 }}>📦</Text>
            </View>

            <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.product_name + ': batafsil'} onPress={() => navigation.navigate('Product', { id: String(item.product) })} style={styles.productInfo}>
              <Text style={[styles.productName, { color: colors.text }]}>{item.product_name}</Text>
              <Text style={[styles.productSubtext, { color: colors.textSecondary }]}>
                {item.unit} • Qoldiq: {item.stock_quantity}
              </Text>
              <Text style={[styles.priceTag, { color: colors.text }]}>
                {Number(item.price_recommended).toLocaleString('ru-RU')} {item.currency === 'UZS' ? 'so‘m' : item.currency}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button"
              disabled={archived || item.is_active === false || !ready || !can('sales.add_sale') || item.currency !== 'UZS'}
              accessibilityLabel={item.product_name + ': savatga qo‘shish'}
              onPress={() => handleAddToCart(item)}
              style={[styles.addBtn, { backgroundColor: colors.primaryAction }]}
            >
              <Plus size={18} color={colors.primaryActionText} />
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 44,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: typography.size.sm,
  },
  listContent: {
    padding: spacing.lg,
  },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  thumbBox: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
  },
  productSubtext: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  priceTag: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
    marginTop: 4,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
});
