import { useFeedback } from '../../hooks/useFeedback';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { getApiBaseUrl, getServerScope } from '../../api/environment';
import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation } from '../../navigation/useAppNavigation';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Copy, Download, FileCheck, FileText, Printer, Share2 } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Toast } from '../../components/ui/Toast';
import { IlbiLogo } from '../../components/brand/IlbiLogo';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { assertAuthScope, captureAuthScope, request } from '../../api/client';
import * as Clipboard from 'expo-clipboard';
import { receiptMoney, receiptView } from './receiptModel';
import { documentDate, documentHtml, documentPrintOptions, invoiceTitle, parseDocumentSale, publicReceiptUrl, DocumentFormat } from './documentModel';
import type { SavedSale } from '../sales/model';
import { saleStatuses } from '../sales/model';
import { observeResource } from '../../api/invalidation';

export const ReceiptScreen: React.FC = () => {
  const params = useLocalSearchParams<{ saleId?: string; mode?: string }>();
  const { user, activeTenant } = useAuth();
  return <SafeAreaView edges={['bottom']} style={{ flex: 1 }}><ReceiptBody key={[getServerScope(), user?.id, activeTenant?.id, params.saleId, params.mode].join(':')} params={params} /></SafeAreaView>;
};
const ReceiptBody: React.FC<{ params: { saleId?: string; mode?: string } }> = ({ params }) => {
  const navigation = useNavigation();
  const validId = typeof params.saleId === 'string' && /^[1-9]\d*$/.test(params.saleId) && Number.isSafeInteger(Number(params.saleId));
  const { colors } = useTheme();

  const [saleRecord, setSaleRecord] = useState<SavedSale | null>(null);
  const [loadError, setLoadError] = useState(validId ? '' : 'Chek raqami noto‘g‘ri yoki ko‘rsatilmagan.');
  const reloadRef = useRef<() => void>(() => {});
  const [pdfReady, setPdfReady] = useState(false);
  const [format, setFormat] = useState<DocumentFormat>(params.mode === 'InvoiceA4' ? 'a4' : 'receipt');
  const [busy, setBusy] = useState(false), busyRef = useRef(false), mounted = useRef(false), focusEpoch = useRef(0), loadSequence = useRef(0);
  const { user, activeTenant } = useAuth();
  const [scope] = useState(() => captureAuthScope(user?.id, activeTenant?.id));
  const freshSale = useCallback(async (signal?: AbortSignal) => {
    const epoch = focusEpoch.current;
    assertAuthScope(scope);
    const value = await request('/sales/' + params.saleId + '/', { signal, expectedServerScope: scope.server });
    assertAuthScope(scope);
    if (!mounted.current || epoch !== focusEpoch.current || signal?.aborted) throw Error('Hujjat oynasi yopilgan.');
    return parseDocumentSale(value, Number(params.saleId));
  }, [params.saleId, scope]);
  useFocusEffect(useCallback(() => {
    mounted.current = true; focusEpoch.current++;
    const abort = new AbortController();
    const load = async () => {
      const sequence = ++loadSequence.current;
      setSaleRecord(null); setPdfReady(false);
      if (!validId) return;
      setLoadError('');
      try { const value = await freshSale(abort.signal); if (!abort.signal.aborted && sequence === loadSequence.current) setSaleRecord(value); }
      catch (error: any) { if (!abort.signal.aborted && sequence === loadSequence.current) setLoadError(error.message || 'Chek yuklanmadi.'); }
    };
    reloadRef.current = () => { void load(); };
    void load();
    const unsubscribe = observeResource('/sales/', () => { void load(); });
    return () => { mounted.current = false; focusEpoch.current++; loadSequence.current++; abort.abort(); unsubscribe(); };
  }, [freshSale, validId]));
  const sale: Partial<SavedSale> = saleRecord || { items: [], total_amount: '0.00' };
  const savedReceipt = receiptView(sale), receiptItems = savedReceipt.items;
  const currencyLabel = sale.currency === 'USD' ? 'USD' : sale.currency === 'UZS' || !sale.currency ? 'so‘m' : String(sale.currency);
  const statusLabel = saleRecord ? saleStatuses[saleRecord.status] : '';
  const paymentLabel = ({ cash: 'Naqd', card: 'Karta', debt: 'Nasiya' } as Record<string, string>)[sale.payment_type || ''] || 'To‘lov';
  const paymentAmount = sale.payment_type === 'cash' ? sale.cash_received : sale.total_amount;

  const [showShareModal, setShowShareModal] = useState(params.mode === 'ShareSheet' || params.mode === 'PdfExport');
  const { message: toastMessage, type: toastType, show: setToastMessage } = useFeedback();

  // Every external action rechecks the selected transaction, even after an earlier PDF.
  // A completed native chooser does not prove a file was saved or physically printed.
  const action = async (run: (current: SavedSale, check: () => void) => Promise<void>) => {
    if (busyRef.current) return;
    const epoch = focusEpoch.current;
    const sequence = ++loadSequence.current;
    const check = () => { assertAuthScope(scope); if (!mounted.current || epoch !== focusEpoch.current || sequence !== loadSequence.current) throw Error('Hujjat o‘zgargan. Qayta tekshiring.'); };
    busyRef.current = true; setBusy(true); setLoadError(''); setPdfReady(false);
    try { const current = await freshSale(); check(); setSaleRecord(current); await run(current, check); }
    catch (error: any) { if (mounted.current && epoch === focusEpoch.current) { setPdfReady(false); setLoadError(error.message || 'Hujjat amali bajarilmadi.'); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const createPdf = async (current: SavedSale, check: () => void) => {
    check();
    const result = await Print.printToFileAsync({ html: documentHtml(current, format), ...documentPrintOptions(current, format) });
    check();
    if (!result?.uri || !result.uri.startsWith('file://')) throw Error('PDF fayl yaratilgani tasdiqlanmadi.');
    setPdfReady(true); return result.uri;
  };
  const handleExportPdf = () => { setShowShareModal(false); return action(async (current, check) => {
    await createPdf(current, check); setToastMessage('PDF tayyorlandi (vaqtinchalik fayl)', 'success');
  }); };
  const handlePrint = () => action(async (current, check) => {
    await Print.printAsync({ html: documentHtml(current, format), ...documentPrintOptions(current, format) });
    check(); setToastMessage('Chop etish oynasi ochildi.');
  });
  const handleNativeShare = () => { setShowShareModal(false); return action(async (current, check) => {
    if (!await Sharing.isAvailableAsync()) throw Error('Bu qurilmada fayl ulashish mavjud emas.');
    check();
    const uri = await createPdf(current, check);
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: format === 'a4' ? 'A4 fakturani ulashish' : 'Chekni ulashish' });
  }); };
  const handleCopyLink = () => { setShowShareModal(false); return action(async (current, check) => {
    const url = publicReceiptUrl(current, getApiBaseUrl());
    if (!url) throw Error('Bu serverda tasdiqlangan ochiq chek havolasi mavjud emas.');
    check(); await Clipboard.setStringAsync(url); check(); setToastMessage('Chek havolasi nusxalandi');
  }); };
  if (!saleRecord) return <View style={{ flex: 1, padding: 24, backgroundColor: colors.background }}>
    <Button title="Orqaga" onPress={() => navigation.goBack()} />
    <Text accessibilityRole={loadError ? 'alert' : undefined} style={{ color: loadError ? colors.danger : colors.text }}>{loadError || 'Chek ma’lumotlari yuklanmoqda…'}</Text>
    {loadError && validId ? <Button title="Chekni qayta yuklash" onPress={() => reloadRef.current()} /> : null}
  </View>;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title={pdfReady ? 'PDF tayyor' : format === 'a4' ? 'Savdo hujjati' : `Chek #${sale.receipt_number || sale.id || '—'}`}
        showLogo={false}
        onGoBack={() => {
          if (pdfReady) setPdfReady(false);
          else navigation.goBack();
        }}
      />

      <Toast
        type={toastType}
        visible={Boolean(toastMessage)}
        message={toastMessage || ''}
        onDismiss={() => setToastMessage(null)}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loadError ? <Text accessibilityRole="alert" style={{ color: colors.danger, marginBottom: 12 }}>{loadError}</Text> : null}
        {busy ? <Text style={{ color: colors.textSecondary }}>Hujjat tekshirilmoqda…</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {(['receipt', 'a4'] as const).map(value => <Button key={value} title={value === 'a4' ? 'A4 faktura' : 'Kassa cheki'} disabled={busy} variant={format === value ? 'primary' : 'secondary'} size="sm" onPress={() => { setFormat(value); setPdfReady(false); }} />)}
        </View>
        {pdfReady ? (
          /* Board 26C: PDF Tayyor Screen */
          <View style={styles.pdfReadyContainer}>
            {/* File Info Card */}
            <View
              style={[
                styles.pdfFileCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.pdfIconWrapper, { backgroundColor: colors.surfaceSecondary }]}>
                <FileCheck size={24} color={colors.text} />
              </View>
              <View style={styles.pdfFileDetails}>
                <Text style={[styles.pdfFileName, { color: colors.text }]}>
                  {format === 'a4' ? 'Faktura' : 'Chek'}-{sale.receipt_number || sale.id || '—'}.pdf
                </Text>
                <Text style={[styles.pdfFileSize, { color: colors.textSecondary }]}>
                  PDF hujjat • vaqtinchalik fayl
                </Text>
              </View>
              <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
            </View>

            {/* Receipt Preview Thumbnail Card */}
            <View style={[styles.miniReceiptCard, { backgroundColor: colors.paperBackground }]}>
              <View style={styles.miniReceiptTop}>
                <IlbiLogo height={16} monochromeColor="#0B0909" />
                <Text style={styles.miniStoreName}>{savedReceipt.storeName || '—'}</Text>
                <Text style={styles.miniDate}>{sale.created_at ? documentDate(sale.created_at) : '—'}</Text>
              </View>

              <View style={styles.miniDivider} />

              <View style={styles.miniItems}>
                {receiptItems.map((item, index) => <Text key={index} style={styles.miniItemRow}>{item.productName}  {item.lineTotal}</Text>)}
              </View>
              <View style={styles.miniDivider} />
              <Text style={styles.miniTotal}>Jami: {receiptMoney(sale.total_amount)} {currencyLabel}</Text>
            </View>

            {/* Action Buttons (Board 26C) */}
            <View style={styles.pdfActionsRow}>
              <Button
                title="PDFni ulashish"
                variant="secondary"
                icon={<FileText size={18} color={colors.text} />}
                disabled={busy} onPress={() => { void handleNativeShare(); } }
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <Button
                title="Ulashish"
                icon={<Share2 size={18} color={colors.primaryActionText} />}
                disabled={busy} onPress={() => { void handleNativeShare(); } }
                style={{ flex: 1 }}
              />
            </View>

            <Button
              title="Chop etish"
              variant="secondary"
              icon={<Printer size={18} color={colors.text} />}
              fullWidth
              disabled={busy} onPress={() => { void handlePrint(); } }
              style={{ marginTop: spacing.md }}
            />
          </View>
        ) : (
          /* Board 26A: Thermal Receipt Viewer */
          <View style={styles.receiptViewContainer}>
            {/* White Paper Receipt Container */}
            <View accessibilityLabel={'Saqlangan chek: ' + savedReceipt.paperWidth} style={[styles.receiptPaper, { maxWidth: savedReceipt.paperWidth === '80mm' ? 380 : 300, backgroundColor: colors.paperBackground }]}>
              {/* Header */}
              <View style={styles.receiptHeader}>
                <IlbiLogo height={22} monochromeColor="#0B0909" />
                <Text style={styles.receiptStoreTitle}>{savedReceipt.storeName || '—'}</Text>
                {format === 'a4' && saleRecord ? <Text style={styles.receiptStoreTitle}>{invoiceTitle(saleRecord)}</Text> : null}
                {savedReceipt.sellerName ? <Text style={styles.receiptTimestamp}>{savedReceipt.sellerName}</Text> : null}
                {savedReceipt.sellerTaxIdentifier ? <Text style={styles.receiptTimestamp}>STIR: {savedReceipt.sellerTaxIdentifier}</Text> : null}
                {savedReceipt.storeCode ? <Text style={styles.receiptTimestamp}>Do‘kon: {savedReceipt.storeCode}</Text> : null}
                {savedReceipt.address ? <Text style={styles.receiptTimestamp}>{savedReceipt.address}</Text> : null}
                {savedReceipt.phone ? <Text style={styles.receiptTimestamp}>{savedReceipt.phone}</Text> : null}
                {savedReceipt.header ? <Text style={styles.receiptTimestamp}>{savedReceipt.header}</Text> : null}
                <Text style={styles.receiptTimestamp}>{sale.created_at ? documentDate(sale.created_at) : '—'}</Text>
              </View>

              {!savedReceipt.hasSnapshot ? <Text style={styles.receiptTimestamp}>Eski hujjat: sotuv paytidagi do‘kon rekvizitlari saqlanmagan.</Text> : null}
              {format === 'a4' ? <Text style={styles.receiptTimestamp}>Hali imzolanmagan · asl qatorlar va qaytarish alohida ko‘rsatilgan.</Text> : null}
              {savedReceipt.showCashier ? <Text style={styles.receiptTimestamp}>Sotuvchi: {sale.sold_by_name || '—'}</Text> : null}
              {savedReceipt.showCustomer ? <Text style={styles.receiptTimestamp}>Mijoz: {sale.counterparty_name || 'Umumiy mijoz'}</Text> : null}

              <View style={styles.receiptDashedLine} />

              {/* Items List */}
              <View style={styles.receiptItemsList}>
                {receiptItems.map((item, index) => (
                  <View key={index} style={styles.receiptItemRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.receiptItemName}>{item.productName}</Text>
                      {[item.variantName, item.code && 'Kod: ' + item.code, item.sku && 'SKU: ' + item.sku, item.barcode && 'Shtrix-kod: ' + item.barcode, item.mxik && 'MXIK: ' + item.mxik, item.packageCode && 'Qadoq: ' + item.packageCode].filter(Boolean).map((line, key) => <Text key={key} style={styles.receiptItemCalc}>{line}</Text>)}
                      {Number(item.returnedQuantity) > 0 ? <Text style={styles.receiptItemCalc}>Qaytarilgan miqdor: {item.returnedQuantity}</Text> : null}
                      <Text style={styles.receiptItemCalc}>
                        {item.quantity} {item.unit} × {item.unitPrice}
                      </Text>
                      {savedReceipt.showItemTax && item.taxAmount !== '—' ? <Text style={styles.receiptItemCalc}>QQS{item.taxRate !== '—' ? ' ' + item.taxRate + '%' : ''}: {item.taxAmount} {currencyLabel}</Text> : null}
                    </View>
                    <Text style={styles.receiptItemTotal}>
                      {item.lineTotal}
                    </Text>
                  </View>
                ))}

              </View>

              <View style={styles.receiptDashedLine} />
              {/* Totals */}
              <View style={styles.receiptTotalRow}>
                <Text style={styles.receiptTotalLabel}>Jami:</Text>
                <Text style={styles.receiptTotalValue}>
                  {receiptMoney(sale.total_amount)} {currencyLabel}
                </Text>
              </View>

              {statusLabel ? <View style={styles.receiptSubRow}><Text style={styles.receiptSubLabel}>Holat:</Text><Text style={styles.receiptSubValue}>{statusLabel}</Text></View> : null}
              {Number(sale.tax_amount) > 0 ? <View style={styles.receiptSubRow}><Text style={styles.receiptSubLabel}>QQS:</Text><Text style={styles.receiptSubValue}>{receiptMoney(sale.tax_amount)} {currencyLabel}</Text></View> : null}
              {Number(sale.refunded_amount) > 0 ? <View style={styles.receiptSubRow}><Text style={styles.receiptSubLabel}>Qaytarilgan:</Text><Text style={styles.receiptSubValue}>{receiptMoney(sale.refunded_amount)} {currencyLabel}</Text></View> : null}
              {Number(sale.refunded_amount) > 0 && sale.net_amount != null ? <View style={styles.receiptSubRow}><Text style={styles.receiptSubLabel}>Qolgan summa:</Text><Text style={styles.receiptSubValue}>{receiptMoney(sale.net_amount)} {currencyLabel}</Text></View> : null}
              <View style={styles.receiptSubRow}>
                <Text style={styles.receiptSubLabel}>{paymentLabel}:</Text>
                <Text style={styles.receiptSubValue}>
                  {paymentAmount == null ? '—' : receiptMoney(paymentAmount)} {currencyLabel}
                </Text>
              </View>

              {sale.payment_type === 'cash' && <View style={styles.receiptSubRow}>
                <Text style={styles.receiptSubLabel}>Qaytim:</Text>
                <Text style={styles.receiptSubValue}>
                  {sale.change == null ? '—' : receiptMoney(sale.change)} {currencyLabel}
                </Text>
              </View>}

              <View style={styles.receiptDashedLine} />

              {savedReceipt.footer ? <Text style={styles.receiptTimestamp}>{savedReceipt.footer}</Text> : null}
              <Text style={styles.receiptTimestamp}>Elektron savdo nusxasi. Fiskal chek emas.</Text>

              {/* Electronic QR section */}
              <View style={styles.qrSection}>
                <View style={styles.qrBox}>
                  <FileText size={32} color="#0B0909" />
                </View>
                <View style={styles.qrTextCol}>
                  <Text style={styles.qrTitle}>Elektron chek</Text>
                  <Text style={styles.qrSub}>{sale._preview ? 'Demo chek · haqiqiy savdo emas' : 'Chek havolasini ulashish bo‘limidan oching.'}</Text>
                </View>
              </View>
            </View>

            {/* Bottom Actions Row (Board 26A) */}
            <View style={styles.receiptActionsBar}>
              <Button
                title="Chop etish"
                variant="secondary"
                icon={<Printer size={18} color={colors.text} />}
                disabled={busy} onPress={() => { void handlePrint(); } }
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <Button
                title="Ulashish"
                icon={<Share2 size={18} color={colors.primaryActionText} />}
                onPress={() => setShowShareModal(true)}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Share Choices Bottom Sheet (Board 26B) */}
      <BottomSheet
        visible={showShareModal}
        onClose={() => setShowShareModal(false)}
        title="Chekni ulashish"
      >
        <View style={styles.shareSheetContent}>
          <Text style={[styles.shareHeaderMeta, { color: colors.textSecondary }]}>
            Chek #{sale.receipt_number || sale.id || '—'} • {receiptMoney(sale.total_amount)} {currencyLabel}
          </Text>

          {/* Option 1: PDF yuklab olish */}
          <TouchableOpacity accessibilityRole="button"
            activeOpacity={0.7}
            disabled={busy} onPress={() => { void handleExportPdf(); } }
            style={[styles.shareOptionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Download size={22} color={colors.text} />
            <View style={styles.shareOptionTextCol}>
              <Text style={[styles.shareOptionTitle, { color: colors.text }]}>PDF tayyorlash</Text>
              <Text style={[styles.shareOptionSub, { color: colors.textSecondary }]}>
                Vaqtinchalik PDF yaratish; keyin ulashish mumkin
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* Option 2: Havolani nusxalash */}
          <TouchableOpacity accessibilityRole="button"
            activeOpacity={0.7}
            disabled={busy} onPress={() => { void handleCopyLink(); } }
            style={[styles.shareOptionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Copy size={22} color={colors.text} />
            <View style={styles.shareOptionTextCol}>
              <Text style={[styles.shareOptionTitle, { color: colors.text }]}>Havolani nusxalash</Text>
              <Text style={[styles.shareOptionSub, { color: colors.textSecondary }]}>
                Onlayn havolani nusxalash
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* Option 3: Ilova orqali ulashish */}
          <TouchableOpacity accessibilityRole="button"
            activeOpacity={0.7}
            disabled={busy} onPress={() => { void handleNativeShare(); } }
            style={[styles.shareOptionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Share2 size={22} color={colors.text} />
            <View style={styles.shareOptionTextCol}>
              <Text style={[styles.shareOptionTitle, { color: colors.text }]}>Ilova orqali ulashish</Text>
              <Text style={[styles.shareOptionSub, { color: colors.textSecondary }]}>
                Telegram, WhatsApp va boshqalar
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  receiptViewContainer: {
    width: '100%',
    alignItems: 'center',
  },
  receiptPaper: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.md,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    marginBottom: spacing.xl,
  },
  receiptHeader: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  receiptStoreTitle: {
    fontSize: typography.size.sm,
    fontWeight: 'bold',
    color: '#0B0909',
    marginTop: 4,
  },
  receiptTimestamp: {
    fontSize: 11,
    color: '#4B5563',
    marginTop: 2,
  },
  receiptDashedLine: {
    height: 1,
    borderWidth: 0.5,
    borderStyle: 'dashed',
    borderColor: '#9CA3AF',
    marginVertical: spacing.md,
  },
  receiptItemsList: {
    marginVertical: spacing.xs,
  },
  receiptItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  receiptItemName: {
    fontSize: typography.size.sm,
    fontWeight: 'bold',
    color: '#0B0909',
  },
  receiptItemCalc: {
    fontSize: 11,
    color: '#4B5563',
  },
  receiptItemTotal: {
    fontSize: typography.size.sm,
    fontWeight: 'bold',
    color: '#0B0909',
  },
  receiptTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  receiptTotalLabel: {
    fontSize: typography.size.md,
    fontWeight: 'bold',
    color: '#0B0909',
  },
  receiptTotalValue: {
    fontSize: typography.size.lg,
    fontWeight: 'bold',
    color: '#0B0909',
  },
  receiptSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  receiptSubLabel: {
    fontSize: typography.size.xs,
    color: '#4B5563',
  },
  receiptSubValue: {
    fontSize: typography.size.xs,
    fontWeight: 'bold',
    color: '#0B0909',
  },
  qrSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  qrBox: {
    marginRight: spacing.md,
  },
  qrTextCol: {
    flex: 1,
  },
  qrTitle: {
    fontSize: typography.size.xs,
    fontWeight: 'bold',
    color: '#0B0909',
  },
  qrSub: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 2,
  },
  receiptActionsBar: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 340,
  },
  shareSheetContent: {
    paddingVertical: spacing.sm,
  },
  shareHeaderMeta: {
    fontSize: typography.size.xs,
    marginBottom: spacing.lg,
  },
  shareOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  shareOptionTextCol: {
    flex: 1,
    marginLeft: spacing.md,
  },
  shareOptionTitle: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
  },
  shareOptionSub: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  chevron: {
    fontSize: typography.size.lg,
  },
  pdfReadyContainer: {
    width: '100%',
    alignItems: 'center',
  },
  pdfFileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.xl,
  },
  pdfIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  pdfFileDetails: {
    flex: 1,
  },
  pdfFileName: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
  },
  pdfFileSize: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  miniReceiptCard: {
    width: 220,
    borderRadius: radius.sm,
    padding: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: spacing.xl,
  },
  miniReceiptTop: {
    alignItems: 'center',
    marginBottom: 6,
  },
  miniStoreName: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#0B0909',
    marginTop: 2,
  },
  miniDate: {
    fontSize: 8,
    color: '#6B7280',
  },
  miniDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 6,
  },
  miniItems: {
    marginVertical: 4,
  },
  miniItemRow: {
    fontSize: 8,
    color: '#0B0909',
    marginBottom: 2,
  },
  miniTotal: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#0B0909',
    textAlign: 'right',
  },
  pdfActionsRow: {
    flexDirection: 'row',
    width: '100%',
  },
});
