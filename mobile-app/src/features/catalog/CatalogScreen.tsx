import { BarcodeScanner } from '../scanner/BarcodeScanner';
import { useLocalSearchParams, router } from 'expo-router';
import { useFeedback } from '../../hooks/useFeedback';
import { useDebounced, usePagedResource } from '../../hooks/usePagedResource';
import { ListState } from '../../components/ui/ListState';
import { usePermissions } from '../auth/usePermissions';
import React, { useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation } from '../../navigation/useAppNavigation';
import { Archive, Barcode, FolderTree, Plus, Scan, Search, X } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { Toast } from '../../components/ui/Toast';
import { useCart } from '../cart/CartContext';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';




import { parseVariant, variantToCart, type CatalogVariant } from './model';

export const CatalogScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
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
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Tovar qidiruvini tozalash" onPress={() => setSearch('')} style={styles.searchClearBtn}>
              <X size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Kameradan skanerlash"
            onPress={() => setScanning(true)}
            style={[styles.scanIconBtn, { backgroundColor: colors.surfaceSecondary }]}
          >
            <Scan size={18} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Action & Filter Chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContainer}
          style={styles.chipsScroll}
        >
          {can('catalog.add_product') ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Yangi mahsulot"
              onPress={() => navigation.navigate('NewProduct')}
              style={[styles.chip, { backgroundColor: colors.primaryAction, borderColor: colors.primaryAction }]}
            >
              <Plus size={14} color={colors.primaryActionText} />
              <Text style={[styles.chipText, { color: colors.primaryActionText, fontWeight: '600' }]}>
                Yangi mahsulot
              </Text>
            </TouchableOpacity>
          ) : null}

          {can('catalog.view_category') ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={categoryId ? (params.categoryName || 'Kategoriya') + ': filtrni tozalash' : 'Kategoriyalar'}
              onPress={() => {
                if (categoryId) {
                  router.setParams({ categoryId: '', categoryName: '' });
                } else {
                  navigation.navigate('Categories');
                }
              }}
              style={[
                styles.chip,
                {
                  backgroundColor: categoryId ? (isDark ? '#262626' : '#0B0909') : colors.surface,
                  borderColor: categoryId ? (isDark ? '#3E3E3E' : '#0B0909') : colors.border,
                },
              ]}
            >
              <FolderTree size={14} color={categoryId ? '#FFFFFF' : colors.textSecondary} />
              <Text
                style={[
                  styles.chipText,
                  { color: categoryId ? '#FFFFFF' : colors.text, fontWeight: categoryId ? '600' : '500' },
                ]}
              >
                {categoryId ? (params.categoryName || 'Kategoriya') + ': filtrni tozalash' : 'Kategoriyalar'}
              </Text>
              {categoryId ? <X size={12} color="#FFFFFF" /> : null}
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={exactBarcode ? "Aniq shtrix-kod: yoqilgan" : "Aniq shtrix-kod bo‘yicha"}
            onPress={() => setExactBarcode(value => !value)}
            style={[
              styles.chip,
              {
                backgroundColor: exactBarcode ? (isDark ? '#262626' : '#0B0909') : colors.surface,
                borderColor: exactBarcode ? (isDark ? '#3E3E3E' : '#0B0909') : colors.border,
              },
            ]}
          >
            <Barcode size={14} color={exactBarcode ? '#FFFFFF' : colors.textSecondary} />
            <Text
              style={[
                styles.chipText,
                { color: exactBarcode ? '#FFFFFF' : colors.text, fontWeight: exactBarcode ? '600' : '500' },
              ]}
            >
              {exactBarcode ? "Aniq shtrix-kod: yoqilgan" : "Aniq shtrix-kod bo‘yicha"}
            </Text>
          </TouchableOpacity>

          {can('catalog.archive_product') ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={archived ? 'Faol tovarlarni ko‘rish' : 'Arxivlangan tovarlar'}
              onPress={() => setArchived(value => !value)}
              style={[
                styles.chip,
                {
                  backgroundColor: archived ? (isDark ? '#3B1515' : '#FEE2E2') : colors.surface,
                  borderColor: archived ? colors.danger : colors.border,
                },
              ]}
            >
              <Archive size={14} color={archived ? colors.danger : colors.textSecondary} />
              <Text
                style={[
                  styles.chipText,
                  { color: archived ? colors.danger : colors.text, fontWeight: archived ? '600' : '500' },
                ]}
              >
                {archived ? 'Faol tovarlarni ko‘rish' : 'Arxivlangan tovarlar'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>

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
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <View style={[styles.thumbBox, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={{ fontSize: 20 }}>📦</Text>
            </View>

            <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.product_name + ': batafsil'} onPress={() => navigation.navigate('Product', { id: String(item.product) })} style={styles.productInfo}>
              <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>{item.product_name}</Text>
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
              style={[
                styles.addBtn,
                {
                  backgroundColor: (archived || item.is_active === false || !ready || !can('sales.add_sale') || item.currency !== 'UZS')
                    ? colors.border
                    : colors.primaryAction,
                },
              ]}
            >
              <Plus size={18} color={(archived || item.is_active === false || !ready || !can('sales.add_sale') || item.currency !== 'UZS') ? colors.textMuted : colors.primaryActionText} />
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
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 44,
  },
  searchInput: {
    flex: 1,
    marginLeft: spacing.sm,
    fontSize: typography.size.sm,
    paddingVertical: 0,
  },
  searchClearBtn: {
    padding: spacing.xs,
    marginRight: 4,
  },
  scanIconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsScroll: {
    marginTop: 2,
    marginBottom: 4,
  },
  chipsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 32,
  },
  chipText: {
    fontSize: typography.size.xs + 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
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
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.semibold,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.md,
  },
});
