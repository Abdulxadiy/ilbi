import { KeyboardRegion } from '../../components/ui/KeyboardRegion';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRetailQuote } from './useRetailQuote';
import { acceptedRetailSale } from './saleResponse';
import { isIsoDate } from '../../domain/date';
import { usePermissions } from '../auth/usePermissions';
import { tryMoney, moneyDifference, parseMoney } from '../../domain/money';
import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation } from '../../navigation/useAppNavigation';
import { Banknote, Check, Clock, CreditCard, Download, Plus, Receipt, Share2, X } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { useCart } from '../cart/CartContext';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { request, captureAuthScope, assertAuthScope } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { withFinancialIdentity, confirmFinancialIdentity, rejectFinancialIdentity, getFinancialIntent } from '../../api/financialIdentity';
import { useFormErrors } from '../../hooks/useFormErrors';
import { formError } from '../../api/validation';
import { Input } from '../../components/ui/Input';

export type PaymentMethod = 'cash' | 'card' | 'debt';

export const CheckoutScreen: React.FC = () => <SafeAreaView edges={['bottom']} style={{ flex: 1 }}><CheckoutBody /></SafeAreaView>;
const CheckoutBody: React.FC = () => {
  const navigation = useNavigation();
  const { user, activeTenant } = useAuth();
  const submitting = useRef(false);
  const { requirePermission } = usePermissions();
  const { colors } = useTheme();
  const {
    cartId, partner, payment, setPayment, flushDraft, ready,
    items,
    customer,
    totalAmount,
    totalQuantity,
    totalTypes,
    clearCart,
  } = useCart();

  const quoteState = useRetailQuote(items, partner);
  const payableTotal = quoteState.quote?.totalAmount ?? totalAmount;
  const [expiryConsent, setExpiryConsent] = useState('');
  const validation = useFormErrors();
  const paymentMethod = payment.method, cashReceivedStr = payment.cashReceived;
  const setPaymentMethod = (method: PaymentMethod) => { setPayment({ method }); validation.clear(); };
  const setCashReceivedStr = (value: string) => { setPayment({ cashReceived: value }); validation.clear('cash_received'); };
  const [loading, setLoading] = useState(false);
  const [confirmedSale, setConfirmedSale] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completionWarning, setCompletionWarning] = useState<string | null>(null);
  const [confirmationIntent, setConfirmationIntent] = useState<{ operation: string; key: string } | null>(null);

  const parsedCash = tryMoney(cashReceivedStr);
  const cashReceived = parsedCash ?? 0;
  const change = Math.max(0, moneyDifference(cashReceived, payableTotal));

  const persistConfirmation = async (sale: any, operation: string, key: string) => {
    try {
      await confirmFinancialIdentity(operation, user?.id, activeTenant?.id, key, sale);
      clearCart(); setCompletionWarning(null);
    } catch (error: any) {
      setCompletionWarning('Savdo serverda tasdiqlandi, qurilmaga yozish yakunlanmadi. Savdoni qayta yaratmang. ' + (error.message || 'Qayta saqlang.'));
    }
  };
  const handleCompleteSale = async () => {
    if (submitting.current) return;
    validation.clear();
    if (!ready || !cartId) { setError('Savat qoralamasi tayyor emas.'); return; }
    if (!items.length) { setError('Savat bo‘sh'); return; }
    if (paymentMethod === 'debt' && !customer) { setError('Nasiya savdo uchun mijoz tanlanishi shart'); return; }
    if (paymentMethod === 'debt' && payment.dueDate && !isIsoDate(payment.dueDate)) { validation.setErrors({ debt_due_date: 'Qaytarish sanasini YYYY-MM-DD ko‘rinishida kiriting.' }); return; }
    if (paymentMethod === 'cash' && parsedCash === null) { validation.setErrors({ cash_received: 'Berilgan summani to‘g‘ri kiriting' }); return; }
    submitting.current = true; setError(null); setLoading(true);
    const operation = 'sale:' + cartId;
    const authScope = captureAuthScope();
    let identity: string | null = null;
    const payload = {
      is_partner_sale: partner, payment_type: paymentMethod, counterparty_id: customer?.id || null,
      ...(paymentMethod === 'debt' ? { debt_due_date: payment.dueDate || null } : {}),
      items: items.map(i => ({ product_variant_id: i.variantId, quantity: i.quantity, unit_price: i.unitPrice })),
    };
    try {
      requirePermission('sales.add_sale');
      await flushDraft();
      assertAuthScope(authScope);
      const saved = user && activeTenant ? await getFinancialIntent(operation, user.id, activeTenant.id) : null;
      const replay = saved && (saved.status === 'pending' || saved.status === 'confirmed');
      const fresh = replay ? null : await quoteState.reload();
      if (fresh && paymentMethod === 'cash' && cashReceived < fresh.totalAmount) throw formError({ cash_received: 'To‘lov summasi yetarli emas. Yangilangan yakuniy summani tekshiring.' });
      if (fresh?.warnings.length && expiryConsent !== fresh.warningKey) throw Error('Muddati o‘tgan partiyalar ogohlantirishini o‘qib, tasdiqlang.');
      const tax = (replay ? (saved.payload as any)?.expected_tax_settings : fresh?.settings) || quoteState.quote?.settings;
      if (!tax) throw Error('Soliq sozlamalari tasdiqlanmadi. Qayta tekshiring.');
      assertAuthScope(authScope);
      const body = await withFinancialIdentity(operation, { ...payload, expected_tax_settings: tax }, user?.id, activeTenant?.id);
      identity = body.idempotency_key;
      assertAuthScope(authScope);
      const result = saved?.status === 'confirmed' && saved.result?.id ? saved.result : acceptedRetailSale(await request('/sales/', { method: 'POST', body }));
      assertAuthScope(authScope);
      if (!Number.isSafeInteger(Number(result?.id)) || Number(result.id) < 1) throw Error('Server savdoni tasdiqlamadi');
      const acceptedTotal = parseMoney(result.total_amount);
      const accepted = { ...result, counterparty_name: result.counterparty_name || customer?.name,
        counterparty_phone: result.counterparty_phone || customer?.phoneNumber,
        total_amount: acceptedTotal, ...(paymentMethod === 'cash' ? { cash_received: cashReceived, change: moneyDifference(cashReceived, acceptedTotal) } : {}),
      };
      setConfirmedSale(accepted); setConfirmationIntent({ operation, key: identity });
      await persistConfirmation(accepted, operation, identity);
    } catch (err: any) {
      validation.capture(err);
      let storageFailure = '';
      if (identity && user && activeTenant && err.status >= 400 && err.status < 500 && ![408, 409, 425, 429].includes(err.status)) {
        try { await rejectFinancialIdentity(operation, user.id, activeTenant.id, identity, err.message); }
        catch { storageFailure = ' Amalning rad etilgan holati qurilmaga yozilmadi; avvalgi yozuv saqlandi.'; }
      }
      setError((err.message || 'Savdoni yakunlashda xatolik yuz berdi') + storageFailure);
    } finally { submitting.current = false; setLoading(false); }
  };

  const handleStartNewSale = () => {
    if (completionWarning) return;
    setConfirmedSale(null);
    navigation.navigate('Savdo');
  };

  if (confirmedSale) {
    // Board 23C: Confirmed Sale View
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader onGoBack={handleStartNewSale} />

        <ScrollView contentContainerStyle={styles.confirmedContent}>
          {/* Success Checkmark Circle */}
          <View style={[styles.successIconWrapper, { backgroundColor: colors.surface }]}>
            <Check size={40} color={colors.text} strokeWidth={2.5} />
          </View>

          <Text style={[styles.successTitle, { color: colors.text }]}>{confirmedSale._preview ? 'Demo savdo yakunlandi' : 'Savdo yakunlandi'}</Text>
          <Text style={[styles.successSubtext, { color: colors.textSecondary }]}>
            Sotuv muvaffaqiyatli amalga oshirildi.
          </Text>

          {completionWarning ? <View style={{ gap: 12, marginBottom: 16 }}><Text accessibilityRole="alert" style={{ color: colors.danger }}>{completionWarning}</Text><Button title="Tasdiqni qurilmaga qayta saqlash" onPress={() => { if (confirmationIntent) void persistConfirmation(confirmedSale, confirmationIntent.operation, confirmationIntent.key); }} /></View> : null}
          {/* Details Card */}
          <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Chek raqami</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                #{confirmedSale.receipt_number || confirmedSale.id}
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Jami summa</Text>
              <Text style={[styles.detailValue, { color: colors.text, fontWeight: typography.weight.bold }]}>
                {Number(confirmedSale.total_amount).toLocaleString('ru-RU')} so&#39;m
              </Text>
            </View>

            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Mijoz</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {confirmedSale.counterparty_name || customer?.name || 'Umumiy mijoz'}
                </Text>
                <Text style={[styles.detailSubValue, { color: colors.textSecondary }]}>
                  {confirmedSale.counterparty_phone || customer?.phoneNumber || ''}
                </Text>
              </View>
            </View>

            <View style={styles.detailRow}>
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>To&#39;lov usuli</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {confirmedSale.payment_type === 'cash'
                  ? 'Naqd'
                  : confirmedSale.payment_type === 'card'
                  ? 'Karta'
                  : 'Nasiya'}
              </Text>
            </View>

            {confirmedSale.payment_type === 'cash' ? (
              <>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Berildi</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {Number(confirmedSale.cash_received).toLocaleString('ru-RU')} so&#39;m
                  </Text>
                </View>

                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{confirmedSale.change < 0 ? 'Yetishmayotgan to‘lov' : 'Qaytim'}</Text>
                  <Text style={[styles.detailValue, { color: colors.text, fontWeight: typography.weight.bold }]}>
                    {Math.abs(Number(confirmedSale.change)).toLocaleString('ru-RU')} so&#39;m
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {/* 3 Action Buttons (Chekni ochish, Ulashish, PDF yuklab olish) */}
          <View style={styles.confirmedActionsRow}>
            <TouchableOpacity accessibilityRole="button"
              onPress={() => navigation.navigate('ReceiptView', { sale: confirmedSale })}
              style={[styles.confirmedActionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Receipt size={22} color={colors.text} />
              <Text style={[styles.confirmedActionLabel, { color: colors.text }]}>Chekni ochish</Text>
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button"
              onPress={() => navigation.navigate('ShareSheet', { sale: confirmedSale })}
              style={[styles.confirmedActionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Share2 size={22} color={colors.text} />
              <Text style={[styles.confirmedActionLabel, { color: colors.text }]}>Ulashish</Text>
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button"
              onPress={() => navigation.navigate('PdfExport', { sale: confirmedSale })}
              style={[styles.confirmedActionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Download size={22} color={colors.text} />
              <Text style={[styles.confirmedActionLabel, { color: colors.text }]}>PDF yuklab olish</Text>
            </TouchableOpacity>
          </View>

          {/* Primary New Sale Button */}
          <Button
            disabled={Boolean(completionWarning)}
            title="Yangi savdo"
            icon={<Plus size={18} color={colors.primaryActionText} />}
            fullWidth
            size="lg"
            onPress={handleStartNewSale}
            style={styles.confirmedNewSaleBtn}
          />
        </ScrollView>
      </View>
    );
  }

  // Board 23B: Payment Screen
  return (
    <KeyboardRegion

      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScreenHeader onGoBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={[styles.pageTitle, { color: colors.text }]}>To&#39;lov</Text>

        {/* Customer Card */}
        <View style={[styles.customerCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.initialsCircle, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.initialsText, { color: colors.text }]}>
              {customer?.name ? customer.name.slice(0, 2).toUpperCase() : 'AV'}
            </Text>
          </View>
          <View style={styles.customerTextCol}>
            <Text style={[styles.customerCardName, { color: colors.text }]}>
              {customer?.name || 'Umumiy mijoz'}
            </Text>
            <Text style={[styles.customerCardStats, { color: colors.textSecondary }]}>
              {totalTypes} tur • {totalQuantity} dona
            </Text>
          </View>
          <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
        </View>

        {/* Grand Total */}
        <Text style={[styles.dueLabel, { color: colors.textSecondary }]}>Jami summa</Text>
        <Text style={[styles.dueAmount, { color: colors.text }]}>
          {payableTotal.toLocaleString('ru-RU')} so&#39;m
        </Text>

        {quoteState.loading && <Text style={{ color: colors.textSecondary }}>Qoldiq va soliq sozlamalari tekshirilmoqda…</Text>}
        {quoteState.error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: colors.danger }}>{quoteState.error}</Text><Button title="Qoldiq va soliqlarni qayta tekshirish" variant="secondary" onPress={() => { void quoteState.reload().catch(() => {}); }} /></View> : null}
        {quoteState.quote ? <Text style={{ color: colors.textSecondary, marginBottom: 16 }}>Soliqsiz: {quoteState.quote.subtotalAmount.toLocaleString('ru-RU')} · QQS: {quoteState.quote.taxAmount.toLocaleString('ru-RU')} · {quoteState.quote.settings.price_includes_vat ? 'QQS narx ichida' : 'QQS narxga qo‘shiladi'}</Text> : null}
        {quoteState.quote?.warnings.length ? <View style={{ gap: 10, padding: 12, marginBottom: 16, borderColor: colors.warning, borderWidth: 1, borderRadius: 10 }}><Text accessibilityRole="alert" style={{ color: colors.text }}>Muddati o‘tgan partiyalar: {quoteState.quote.warnings.join('; ')}</Text><TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: expiryConsent === quoteState.quote.warningKey }} onPress={() => setExpiryConsent(expiryConsent === quoteState.quote!.warningKey ? '' : quoteState.quote!.warningKey)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.text }}>{expiryConsent === quoteState.quote.warningKey ? '☑' : '☐'} Ogohlantirishni o‘qidim</Text></TouchableOpacity></View> : null}
        {/* 3 Payment Methods: Naqd, Karta, Nasiya */}
        <View style={styles.paymentMethodsRow}>
          <TouchableOpacity accessibilityRole="button"
            onPress={() => setPaymentMethod('cash')}
            style={[
              styles.methodBtn,
              {
                backgroundColor: paymentMethod === 'cash' ? colors.primaryAction : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Banknote
              size={20}
              color={paymentMethod === 'cash' ? colors.primaryActionText : colors.text}
            />
            <Text
              style={[
                styles.methodText,
                { color: paymentMethod === 'cash' ? colors.primaryActionText : colors.text },
              ]}
            >
              Naqd
            </Text>
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button"
            onPress={() => setPaymentMethod('card')}
            style={[
              styles.methodBtn,
              {
                backgroundColor: paymentMethod === 'card' ? colors.primaryAction : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <CreditCard
              size={20}
              color={paymentMethod === 'card' ? colors.primaryActionText : colors.text}
            />
            <Text
              style={[
                styles.methodText,
                { color: paymentMethod === 'card' ? colors.primaryActionText : colors.text },
              ]}
            >
              Karta
            </Text>
          </TouchableOpacity>

          <TouchableOpacity accessibilityRole="button"
            onPress={() => setPaymentMethod('debt')}
            style={[
              styles.methodBtn,
              {
                backgroundColor: paymentMethod === 'debt' ? colors.primaryAction : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Clock
              size={20}
              color={paymentMethod === 'debt' ? colors.primaryActionText : colors.text}
            />
            <Text
              style={[
                styles.methodText,
                { color: paymentMethod === 'debt' ? colors.primaryActionText : colors.text },
              ]}
            >
              Nasiya
            </Text>
          </TouchableOpacity>
        </View>

        {paymentMethod === 'debt' && <Input label="Qarzni qaytarish sanasi (ixtiyoriy)" accessibilityLabel="Qarzni qaytarish sanasi" placeholder="YYYY-MM-DD" value={payment.dueDate} error={validation.errors.debt_due_date} onChangeText={dueDate => { setPayment({ dueDate }); validation.clear('debt_due_date'); }} maxLength={10} />}
        {/* Cash Received Input & Change (For Cash) */}
        {paymentMethod === 'cash' ? (
          <View style={styles.cashSection}>
            <Text style={[styles.inputLabel, { color: colors.textSecondary }]}>Mijoz berdi</Text>
            <View
              style={[
                styles.cashInputBox,
                {
                  backgroundColor: validation.errors.cash_received ? colors.dangerSurface : colors.surface,
                  borderColor: validation.errors.cash_received ? colors.danger : colors.border,
                },
              ]}
            >
              <TextInput
                accessibilityLabel="Mijoz berdi"
                value={cashReceivedStr}
                onChangeText={setCashReceivedStr}
                keyboardType="decimal-pad"
                aria-invalid={Boolean(validation.errors.cash_received)}
                style={[styles.cashInputField, { color: colors.text }]}
              />
              {cashReceivedStr ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Berilgan summani tozalash" onPress={() => setCashReceivedStr('')} style={styles.clearIconBtn}>
                  <X size={18} color={colors.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>

            {validation.errors.cash_received ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{validation.errors.cash_received}</Text> : null}

            <View style={styles.changeRow}>
              <Text style={[styles.changeLabel, { color: colors.textSecondary }]}>Qaytim</Text>
              <Text style={[styles.changeValue, { color: colors.text }]}>
                {change.toLocaleString('ru-RU')} so&#39;m
              </Text>
            </View>
          </View>
        ) : null}

        {/* Aralash to'lov toggle */}
        <View style={[styles.mixedPaymentRow, { borderTopColor: colors.borderSubtle, borderBottomColor: colors.borderSubtle }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.mixedTitle, { color: colors.text }]}>Aralash to&#39;lov (hali tayyor emas)</Text>
            <Text style={[styles.mixedSubtitle, { color: colors.textSecondary }]}>
              Ikki yoki undan ortiq usulda
            </Text>
          </View>
          <Switch
            disabled
            value={false}
            onValueChange={() => {}}
            trackColor={{ false: colors.border, true: colors.primaryAction }}
          />
        </View>

        {error && error !== quoteState.error ? <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text> : null}

        {/* Complete Sale Button */}
        <Button
          title="Savdoni yakunlash"
          size="lg"
          fullWidth
          loading={loading}
          onPress={handleCompleteSale}
          style={styles.submitBtn}
        />
      </ScrollView>
    </KeyboardRegion>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  pageTitle: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    marginBottom: spacing.md,
  },
  customerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  initialsCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  initialsText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.bold,
  },
  customerTextCol: {
    flex: 1,
  },
  customerCardName: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
  },
  customerCardStats: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  chevron: {
    fontSize: typography.size.lg,
  },
  dueLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  dueAmount: {
    fontSize: typography.size.display,
    fontWeight: typography.weight.bold,
    marginBottom: spacing.xl,
  },
  paymentMethodsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  methodBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  methodText: {
    marginTop: spacing.xs,
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  cashSection: {
    marginBottom: spacing.lg,
  },
  inputLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
    marginBottom: spacing.xs,
  },
  cashInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 52,
    marginBottom: spacing.md,
  },
  cashInputField: {
    flex: 1,
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  clearIconBtn: {
    padding: spacing.xs,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  changeLabel: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.medium,
  },
  changeValue: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  mixedPaymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginBottom: spacing.xl,
  },
  mixedTitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.semibold,
  },
  mixedSubtitle: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  errorText: {
    fontSize: typography.size.sm,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  submitBtn: {
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  confirmedContent: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  successIconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  successTitle: {
    fontSize: typography.size.xxl,
    fontWeight: typography.weight.bold,
    marginBottom: spacing.xs,
  },
  successSubtext: {
    fontSize: typography.size.sm,
    marginBottom: spacing.xl,
  },
  detailsCard: {
    width: '100%',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.xl,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    fontSize: typography.size.sm,
  },
  detailValue: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  detailSubValue: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  confirmedActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: spacing.xl,
  },
  confirmedActionCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  confirmedActionLabel: {
    fontSize: 11,
    fontWeight: typography.weight.medium,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  confirmedNewSaleBtn: {
    marginBottom: spacing.xxl,
  },
});
