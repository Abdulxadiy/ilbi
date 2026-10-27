import { useFeedback } from '../../hooks/useFeedback';
import { formatQuantity, parseQuantity } from '../../domain/quantity';
import { taxLine } from '../../domain/tax';
import { tryMoney } from '../../domain/money';
import { isDesignPreview } from '../../dev/preview';
import React, { useState } from 'react';
import { FlatList, Image, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation } from '../../navigation/useAppNavigation';
import { Barcode, Info, MoreVertical, Pencil, Plus, Scan, ShoppingBag, Trash2, User as UserIcon, X } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Toast } from '../../components/ui/Toast';
import { CartItem, useCart } from './CartContext';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { CustomerPickerSheet } from '../checkout/CustomerPickerSheet';

export const CartScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const {
    partner, setPartner,
    items,
    customer,
    totalQuantity,
    totalTypes,
    totalAmount,
    updateItemPrice,
    updateQuantity,
    removeItem,
    clearCart,
    setCustomer,
    loadCanonicalFixture,
  } = useCart();

  const [quantityItem, setQuantityItem] = useState<CartItem | null>(null);
  const [quantityText, setQuantityText] = useState('');
  const [quantityError, setQuantityError] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingItem, setEditingItem] = useState<CartItem | null>(null);
  const [editedPriceStr, setEditedPriceStr] = useState('');
  const [priceError, setPriceError] = useState('');
  const { message: toastMessage, type: toastType, show: setToastMessage } = useFeedback();
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [activeItemMenu, setActiveItemMenu] = useState<number | null>(null);

  // Open price edit sheet
  const handleOpenPriceSheet = (item: CartItem) => {
    setPriceError('');
    setEditingItem(item);
    setEditedPriceStr(String(item.unitPrice));
  };

  // Apply new customer unit price
  const handleApplyPrice = () => {
    if (!editingItem) return;
    const parsed = tryMoney(editedPriceStr);
    if (parsed === null || parsed <= 0) { setPriceError('Dona narxini 0 dan katta summa sifatida kiriting.'); return; }
    updateItemPrice(editingItem.variantId, parsed);
    setToastMessage('Narx yangilandi', 'success');
    setEditingItem(null);
  };

  const previewPrice = tryMoney(editedPriceStr) ?? 0;
  const previewTotal = editingItem ? Math.round(editingItem.quantity * previewPrice * 100) / 100 : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        onOpenDrawer={() => navigation.openDrawer()}
        rightAction={
          <TouchableOpacity accessibilityRole="button"
            accessibilityLabel="Tovar qo‘shish"
            onPress={() => navigation.navigate('Tovar')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerActionBtn}
          >
            <Barcode size={22} color={colors.text} />
          </TouchableOpacity>
        }
      />

      <BottomSheet visible={confirmClear} onClose={() => setConfirmClear(false)} title="Savatni tozalash">
        <Text style={{ color: colors.text, marginBottom: 16 }}>{totalTypes} tur tovar va to‘lov qoralamasi tozalanadi. Natijasi noma’lum yuborilgan amallar jurnalda saqlanadi.</Text>
        <Button title="Savatni saqlab qolish" variant="secondary" onPress={() => setConfirmClear(false)} />
        <Button title="Ha, savatni tozalash" variant="danger" onPress={() => { clearCart(); setConfirmClear(false); }} style={{ marginTop: 12 }} />
      </BottomSheet>
      <BottomSheet scrollable visible={Boolean(quantityItem)} onClose={() => setQuantityItem(null)} title="Miqdorni o‘zgartirish">
        <Text style={{ color: colors.text, marginBottom: 10 }}>{quantityItem?.productName} · {quantityItem?.unit}</Text>
        <TextInput accessibilityLabel="Yangi miqdor" value={quantityText} aria-invalid={Boolean(quantityError)} onChangeText={value => { setQuantityText(value); setQuantityError(''); }} keyboardType="decimal-pad" style={{ color: colors.text, backgroundColor: quantityError ? colors.dangerSurface : colors.surface, borderColor: quantityError ? colors.danger : colors.border, borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 20 }} />
        {quantityError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{quantityError}</Text> : null}
        <Text style={{ color: colors.textSecondary, marginVertical: 10 }}>Masalan: 0,125 kg. Ko‘pi bilan 3 kasr xonasi.</Text>
        <Button title="Miqdorni qo‘llash" onPress={() => { try { if (quantityItem) updateQuantity(quantityItem.variantId, parseQuantity(quantityText)); setQuantityItem(null); } catch (error: any) { setQuantityError(error.message); } }} />
      </BottomSheet>
      {/* Toast Notification */}
      <Toast
        type={toastType}
        visible={Boolean(toastMessage)}
        message={toastMessage || ''}
        onDismiss={() => setToastMessage(null)}
      />

      {/* Cart Title & Stats Row */}
      <View style={styles.topInfoBar}>
        <View>
          <Text style={[styles.title, { color: colors.text }]}>Savat</Text>
          <Text style={[styles.subStats, { color: colors.textSecondary }]}>
            {totalTypes} tur • {totalQuantity} dona
          </Text>
        </View>

        <TouchableOpacity accessibilityRole="button"
          onPress={() => setConfirmClear(true)}
          disabled={items.length === 0}
          style={[styles.clearBtn, items.length === 0 && { opacity: 0.4 }]}
        >
          <Trash2 size={16} color={colors.danger} />
          <Text style={[styles.clearText, { color: colors.danger }]}>Tozalash</Text>
        </TouchableOpacity>
      </View>

      {/* Customer & Wholesale Controls */}
      <View style={[styles.controlsCard, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}>
        <TouchableOpacity accessibilityRole="button"
          onPress={() => setShowCustomerPicker(true)}
          activeOpacity={0.7}
          style={styles.customerRow}
        >
          <View style={[styles.customerAvatar, { backgroundColor: colors.surfaceSecondary }]}>
            <UserIcon size={16} color={colors.textSecondary} />
          </View>
          <View style={styles.customerInfoCol}>
            <Text style={[styles.customerMicroLabel, { color: colors.textSecondary }]}>Mijoz</Text>
            <Text
              style={[
                styles.customerName,
                { color: customer ? colors.text : colors.textMuted },
              ]}
              numberOfLines={1}
            >
              {customer ? customer.name : 'Mijoz tanlash'}
            </Text>
          </View>
          <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
        </TouchableOpacity>

        <View style={[styles.controlDivider, { backgroundColor: colors.borderSubtle }]} />

        <View style={styles.wholesaleRow}>
          <View style={styles.wholesaleInfo}>
            <Text style={[styles.wholesaleTitle, { color: colors.text }]}>Ulgurji narxlar</Text>
            <Text style={[styles.wholesaleSubtext, { color: colors.textSecondary }]}>Ulgurji tarif bo‘yicha hisoblash</Text>
          </View>
          <Switch
            accessibilityLabel="Ulgurji narxlar"
            value={partner || false}
            onValueChange={value => {
              try { setPartner(value); }
              catch (error: any) { setToastMessage(error.message, 'error'); }
            }}
          />
        </View>
      </View>

      {/* Quick Add / Search Product Input Bar */}
      <View style={[styles.searchAddBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <TextInput
          accessibilityLabel="Savatga tovar qidirish"
          placeholder="Tovar qo'shish (shtrix-kod, nom yoki kod)"
          placeholderTextColor={colors.textMuted}
          style={[styles.searchAddInput, { color: colors.text }]}
          onFocus={() => navigation.navigate('Tovar')}
        />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Shtrix-kod skanerlash"
          onPress={() => navigation.navigate('Tovar', { scan: '1' })}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.scanIconBtn}
        >
          <Scan size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      {items.length === 0 ? (
        /* Empty Cart State (Board 27C) */
        <ScrollView contentContainerStyle={styles.emptyContainer} showsVerticalScrollIndicator={false}>
          <View style={[styles.emptyBasketWrapper, { backgroundColor: colors.surfaceSecondary }]}>
            <ShoppingBag size={44} color={colors.textMuted} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Savat hozircha bo&#39;sh</Text>
          <Text style={[styles.emptySubtext, { color: colors.textSecondary }]}>
            Tovar qidiring yoki shtrix-kodini skanerlang
          </Text>

          <Button
            title="Tovar qo'shish"
            icon={<Plus size={18} color={colors.primaryActionText} />}
            fullWidth
            accessibilityLabel="Tovar qo‘shish"
            onPress={() => navigation.navigate('Tovar')}
            style={styles.emptyAddBtn}
          />

          <Button
            title="Skanerlash"
            variant="secondary"
            icon={<Scan size={18} color={colors.text} />}
            fullWidth
            accessibilityLabel="Shtrix-kod skanerlash"
            onPress={() => navigation.navigate('Tovar', { scan: '1' })}
            style={styles.emptyScanBtn}
          />

          {isDesignPreview && <TouchableOpacity accessibilityRole="button" onPress={loadCanonicalFixture} style={styles.loadFixtureBtn}>
            <Text style={[styles.loadFixtureText, { color: colors.textSecondary }]}>
              + 10 ta kanonik tovarlarni yuklash (Test ma&#39;lumot)
            </Text>
          </TouchableOpacity>}
        </ScrollView>
      ) : (
        /* Compact Cart Table (Board 22A & 22C) */
        <View style={styles.cartContent}>
          {/* Table Headers */}
          <View style={[styles.tableHeaderRow, { borderBottomColor: colors.borderSubtle }]}>
            <Text style={[styles.tableColHeader, styles.colProduct, { color: colors.textSecondary }]}>
              Tovar
            </Text>
            <Text style={[styles.tableColHeader, styles.colPrice, { color: colors.textSecondary }]}>
              Dona narxi
            </Text>
            <Text style={[styles.tableColHeader, styles.colQty, { color: colors.textSecondary }]}>
              Soni
            </Text>
            <Text style={[styles.tableColHeader, styles.colTotal, { color: colors.textSecondary }]}>
              Jami
            </Text>
            <View style={styles.colAction} />
          </View>

          {/* Items FlatList with 24-28pt thumbnails */}
          <FlatList
            data={items}
            keyExtractor={(item) => String(item.variantId)}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={[styles.cartRow, { borderBottomColor: colors.borderSubtle }]}>
                {/* Product thumbnail & Name */}
                <View style={[styles.productCell, styles.colProduct]}>
                  <View style={[styles.thumbBox, { backgroundColor: colors.surfaceSecondary }]}>
                    <>{item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: 26, height: 26, borderRadius: 4 }} /> : <Text style={styles.thumbEmoji}>📦</Text>}</>
                  </View>
                  <View style={styles.productTextWrapper}>
                    <Text style={[styles.productName, { color: colors.text }]} numberOfLines={1}>
                      {item.productName}
                    </Text>
                    <Text style={[styles.productUnit, { color: colors.textSecondary }]}>
                      {item.unit}
                    </Text>
                  </View>
                </View>

                {/* Editable Unit Price Button (Board 22A) */}
                <View style={styles.colPrice}>
                  <TouchableOpacity accessibilityRole="button"
                    accessibilityLabel={item.productName + ': sotuv narxi'}
                    onPress={() => handleOpenPriceSheet(item)}
                    style={[
                      styles.priceEditBtn,
                      {
                        backgroundColor: colors.surfaceSecondary,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.priceText, { color: colors.text }]}>
                      {item.unitPrice.toLocaleString('ru-RU')}
                    </Text>
                    <Pencil size={11} color={colors.textSecondary} style={{ marginLeft: 3 }} />
                  </TouchableOpacity>
                </View>

                {/* Quantity */}
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.productName + ': miqdorni o‘zgartirish'} onPress={() => { setQuantityItem(item); setQuantityText(String(item.quantity)); setQuantityError(''); }} style={[styles.colQty, { minHeight: 44, justifyContent: 'center' }]}>
                  <Text style={[styles.qtyText, { color: colors.text }]}>
                    {formatQuantity(item.quantity)} ×
                  </Text>
                </TouchableOpacity>

                {/* Line Total */}
                <View style={styles.colTotal}>
                  <Text style={[styles.lineTotalText, { color: colors.text }]}>
                    {(Number(taxLine(item.quantity, item.unitPrice, { is_vat_payer: false, vat_rate: '0.00', price_includes_vat: true }).totalMinor) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}
                  </Text>
                </View>

                {/* 3-dots Menu for Remove/Stepper */}
                <View style={styles.colAction}>
                  <TouchableOpacity accessibilityRole="button"
                    accessibilityLabel={item.productName + ': amallar'}
                    onPress={() =>
                      setActiveItemMenu(activeItemMenu === item.variantId ? null : item.variantId)
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <MoreVertical size={16} color={colors.textMuted} />
                  </TouchableOpacity>

                  {/* Context Stepper/Delete Menu */}
                  {activeItemMenu === item.variantId ? (
                    <View
                      style={[
                        styles.rowMenuPopup,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <TouchableOpacity accessibilityRole="button"
                        onPress={() => updateQuantity(item.variantId, item.quantity + 1)}
                        style={styles.menuAction}
                      >
                        <Text style={[styles.menuActionText, { color: colors.text }]}>+1 qo&#39;shish</Text>
                      </TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button"
                        onPress={() => updateQuantity(item.variantId, item.quantity - 1)}
                        style={styles.menuAction}
                      >
                        <Text style={[styles.menuActionText, { color: colors.text }]}>-1 kamaytirish</Text>
                      </TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button"
                        onPress={() => {
                          removeItem(item.variantId);
                          setActiveItemMenu(null);
                        }}
                        style={styles.menuAction}
                      >
                        <Text style={[styles.menuActionText, { color: colors.danger }]}>O&#39;chirish</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              </View>
            )}
          />
        </View>
      )}

      {/* Sticky Bottom Total & Checkout Bar (Board 22A & 22C) */}
      <View
        style={[
          styles.stickyBottomBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        ]}
      >
        <View style={styles.totalWrapper}>
          <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Jami:</Text>
          <Text style={[styles.totalAmountText, { color: colors.text }]}>
            {totalAmount.toLocaleString('ru-RU')} so&#39;m
          </Text>
        </View>

        <Button
          title="To'lovga o'tish"
          icon={<ShoppingBag size={18} color={colors.primaryActionText} />}
          disabled={items.length === 0}
          onPress={() => navigation.navigate('Checkout')}
          style={styles.checkoutBtn}
        />
      </View>

      {/* Customer Price Entry Sheet (Board 22B) */}
      <BottomSheet
        scrollable
        visible={Boolean(editingItem)}
        onClose={() => setEditingItem(null)}
        title="Mijozga sotuv narxi"
      >
        {editingItem ? (
          <View style={styles.priceSheetContent}>
            {/* Product Header in Sheet */}
            <View style={styles.sheetProductHeader}>
              <View style={[styles.sheetThumbBox, { backgroundColor: colors.surfaceSecondary }]}>
                <Text style={{ fontSize: 20 }}>📦</Text>
              </View>
              <View style={styles.sheetProductText}>
                <Text style={[styles.sheetProductName, { color: colors.text }]}>
                  {editingItem.productName}
                </Text>
                <Text style={[styles.sheetProductUnit, { color: colors.textSecondary }]}>
                  {editingItem.unit}
                </Text>
              </View>
            </View>

            {/* Price Input */}
            <Text style={[styles.sheetInputLabel, { color: colors.textSecondary }]}>
              Dona narxi
            </Text>
            <View
              style={[
                styles.sheetInputContainer,
                {
                  backgroundColor: priceError ? colors.dangerSurface : colors.surfaceSecondary,
                  borderColor: priceError ? colors.danger : colors.border,
                },
              ]}
            >
              <TextInput
                accessibilityLabel="Yangi sotuv narxi"
                value={editedPriceStr}
                onChangeText={value => { setEditedPriceStr(value); setPriceError(''); }}
                aria-invalid={Boolean(priceError)}
                keyboardType="decimal-pad"
                style={[styles.sheetInputField, { color: colors.text }]}
                autoFocus
              />
              {editedPriceStr ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Sotuv narxini tozalash" onPress={() => setEditedPriceStr('')} style={styles.sheetClearBtn}>
                  <X size={16} color={colors.textMuted} />
                </TouchableOpacity>
              ) : null}
              <Text style={[styles.sheetSuffix, { color: colors.textSecondary }]}>
                so&#39;m / {editingItem.unit}
              </Text>
            </View>

            {/* Live Calculation Preview */}
            <Text style={[styles.previewFormula, { color: colors.text }]}>
              {editingItem.quantity} {editingItem.unit} × {previewPrice.toLocaleString('ru-RU')} ={' '}
              <Text style={{ fontWeight: typography.weight.bold }}>
                {previewTotal.toLocaleString('ru-RU')} so&#39;m
              </Text>
            </Text>

            {/* Faqat shu savdo uchun Notice */}
            <View style={[styles.sheetNotice, { backgroundColor: colors.surfaceSecondary }]}>
              <Info size={16} color={colors.textSecondary} style={{ marginRight: spacing.sm }} />
              <Text style={[styles.noticeText, { color: colors.textSecondary }]}>
                Faqat shu savdo uchun
              </Text>
            </View>

            {priceError ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{priceError}</Text> : null}
            {/* Apply Button */}
            <Button
              title="Qo'llash"
              fullWidth
              size="lg"
              onPress={handleApplyPrice}
              style={styles.applyBtn}
            />
          </View>
        ) : null}
      </BottomSheet>

      {/* Customer Picker Sheet */}
      <CustomerPickerSheet
        visible={showCustomerPicker}
        onClose={() => setShowCustomerPicker(false)}
        selectedCustomerId={customer?.id}
        onSelectCustomer={(cust) => {
          setCustomer(cust);
          setShowCustomerPicker(false);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerActionBtn: {
    padding: spacing.xs,
  },
  topInfoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  subStats: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  clearText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    marginLeft: 4,
  },
  controlsCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  customerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerInfoCol: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  customerMicroLabel: {
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  customerName: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
    marginTop: 1,
  },
  chevron: {
    fontSize: typography.size.md,
  },
  controlDivider: {
    height: 1,
  },
  wholesaleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    minHeight: 44,
  },
  wholesaleInfo: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  wholesaleTitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  wholesaleSubtext: {
    fontSize: typography.size.xs,
    marginTop: 1,
  },
  searchAddBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    paddingLeft: spacing.md,
    paddingRight: 6,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  searchAddInput: {
    flex: 1,
    fontSize: typography.size.sm,
    paddingVertical: 0,
  },
  scanIconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartContent: {
    flex: 1,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
  },
  tableColHeader: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  colProduct: {
    flex: 2.2,
  },
  colPrice: {
    flex: 1.5,
    alignItems: 'center',
  },
  colQty: {
    flex: 0.9,
    alignItems: 'center',
  },
  colTotal: {
    flex: 1.4,
    alignItems: 'flex-end',
  },
  colAction: {
    width: 24,
    alignItems: 'center',
    position: 'relative',
  },
  listContent: {
    paddingBottom: 80,
  },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 7, // compact row height
    borderBottomWidth: 1,
  },
  productCell: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumbBox: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  thumbEmoji: {
    fontSize: 14,
  },
  productTextWrapper: {
    flex: 1,
  },
  productName: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  productUnit: {
    fontSize: 11,
  },
  priceEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  priceText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  qtyText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  lineTotalText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
  },
  rowMenuPopup: {
    position: 'absolute',
    right: 20,
    top: -20,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.xs,
    zIndex: 10,
    width: 120,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  menuAction: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  menuActionText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  stickyBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
  },
  totalWrapper: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  totalLabel: {
    fontSize: typography.size.sm,
    marginRight: 6,
  },
  totalAmountText: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
  },
  checkoutBtn: {
    minWidth: 160,
  },
  emptyContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl * 1.5,
  },
  emptyBasketWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.bold,
    marginBottom: spacing.xs,
  },
  emptySubtext: {
    fontSize: typography.size.sm,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  emptyAddBtn: {
    marginBottom: spacing.sm,
  },
  emptyScanBtn: {
    marginBottom: spacing.lg,
  },
  loadFixtureBtn: {
    padding: spacing.sm,
  },
  loadFixtureText: {
    fontSize: typography.size.xs,
    textDecorationLine: 'underline',
  },
  priceSheetContent: {
    paddingVertical: spacing.sm,
  },
  sheetProductHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  sheetThumbBox: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  sheetProductText: {
    flex: 1,
  },
  sheetProductName: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
  },
  sheetProductUnit: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  sheetInputLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    marginBottom: spacing.xs,
  },
  sheetInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    height: 48,
    marginBottom: spacing.md,
  },
  sheetInputField: {
    flex: 1,
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  sheetClearBtn: {
    padding: spacing.xs,
    marginRight: spacing.sm,
  },
  sheetSuffix: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  previewFormula: {
    fontSize: typography.size.sm,
    marginBottom: spacing.md,
  },
  sheetNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xl,
  },
  noticeText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  applyBtn: {
    marginBottom: spacing.md,
  },
});
