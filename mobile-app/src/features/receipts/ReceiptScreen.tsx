import { useFeedback } from '../../hooks/useFeedback';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import { getServerScope } from '../../api/environment';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation, getReceiptSnapshot } from '../../navigation/useAppNavigation';
import { useLocalSearchParams } from 'expo-router';
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
import { request } from '../../api/client';
import * as Clipboard from 'expo-clipboard';

export const ReceiptScreen: React.FC = () => {
  const params = useLocalSearchParams<{ saleId?: string; mode?: string }>();
  const { user, activeTenant } = useAuth();
  return <SafeAreaView edges={['bottom']} style={{ flex: 1 }}><ReceiptBody key={[getServerScope(), user?.id, activeTenant?.id, params.saleId, params.mode].join(':')} params={params} /></SafeAreaView>;
};
const ReceiptBody: React.FC<{ params: { saleId?: string; mode?: string } }> = ({ params }) => {
  const navigation = useNavigation();
  const validId = typeof params.saleId === 'string' && /^[1-9]\d*$/.test(params.saleId) && Number.isSafeInteger(Number(params.saleId));
  const { colors } = useTheme();

  const [saleRecord, setSaleRecord] = useState<any>(() => {
    const cached = getReceiptSnapshot();
    return cached && String(cached.id) === params.saleId ? cached : null;
  });
  const [loadError, setLoadError] = useState(validId ? '' : 'Chek raqami noto‘g‘ri yoki ko‘rsatilmagan.');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    if (!saleRecord && validId) {
      void Promise.resolve().then(async () => {
        if (abort.signal.aborted) return;
        setLoadError('');
        try {
          const value = await request('/sales/' + params.saleId + '/', { signal: abort.signal });
          if (abort.signal.aborted) return;
          if (!value || String(value.id) !== params.saleId) throw Error('Server so‘ralgan chekni tasdiqlamadi.');
          setSaleRecord(value);
        } catch (error: any) { if (!abort.signal.aborted) setLoadError(error.message || 'Chek yuklanmadi.'); }
      });
    }
    return () => abort.abort();
  }, [params.saleId, validId, saleRecord, attempt]);
  const sale = saleRecord || { items: [], total_amount: 0 };
  const receiptItems: { productName: string; quantity: number; unitPrice: number }[] = (sale.items || []).map((item: any) => ({
    productName: item.product_name || '', quantity: Number(item.quantity), unitPrice: Number(item.unit_price),
  }));
  const currencyLabel = sale.currency === 'USD' ? 'USD' : sale.currency === 'UZS' || !sale.currency ? 'so‘m' : String(sale.currency);
  const statusLabel = ({ completed: 'Yakunlangan', voided: 'Bekor qilingan', partially_voided: 'Qisman qaytarilgan', b2b_pending: 'B2B: qabul kutilmoqda', b2b_rejected: 'B2B: rad etilgan', b2b_accepted: 'B2B: qabul qilingan', b2b_partially_accepted: 'B2B: qisman qabul qilingan', b2b_cancelled: 'B2B: bekor qilingan', b2b_return_pending: 'B2B: qaytarish kutilmoqda' } as Record<string, string>)[sale.status] || sale.status || '';
  const paymentLabel = ({ cash: 'Naqd', card: 'Karta', debt: 'Nasiya' } as Record<string, string>)[sale.payment_type] || 'To‘lov';
  const paymentAmount = sale.payment_type === 'cash' ? sale.cash_received : sale.total_amount;
  const publicToken = typeof sale.public_token === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(sale.public_token) ? sale.public_token : null;
  const receiptUrl = publicToken && !sale._preview ? 'https://ilbi.uz/r/' + publicToken : null;
  const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

  const [showShareModal, setShowShareModal] = useState(params.mode === 'ShareSheet' || params.mode === 'PdfExport');
  const [pdfReady, setPdfReady] = useState(false);
  const { message: toastMessage, type: toastType, show: setToastMessage } = useFeedback();
  const [pdfUri, setPdfUri] = useState<string | null>(null);

  const generateHtml = () => `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
        <style>
          body { font-family: monospace; padding: 20px; font-size: 13px; max-width: 320px; margin: auto; }
          .center { text-align: center; }
          .bold { font-weight: bold; }
          .row { display: flex; justify-content: space-between; margin: 4px 0; }
          .divider { border-top: 1px dashed #000; margin: 8px 0; }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: 16px;">ilbi.uz</div>
        <div class="center">${escapeHtml(sale.tenant_name || '—')}</div>
        <div class="center">${escapeHtml(sale.created_at || '')}</div>
        <div class="divider"></div>
        <div class="bold">Chek #${escapeHtml(sale.receipt_number || sale.id || '—')}</div>
        ${statusLabel ? `<div>Holat: ${escapeHtml(statusLabel)}</div>` : ''}
        <div>Mijoz: ${escapeHtml(sale.counterparty_name || 'Umumiy mijoz')}</div>
        <div class="divider"></div>
        ${receiptItems.map(
          (item: any) => `
          <div class="row">
            <span>${escapeHtml(item.productName)}</span>
            <span>${(item.quantity * item.unitPrice).toLocaleString('ru-RU')}</span>
          </div>
          <div style="font-size: 11px; color: #555;">${item.quantity} x ${item.unitPrice.toLocaleString('ru-RU')}</div>
        `
        ).join('')}
        <div class="divider"></div>
        <div class="row bold" style="font-size: 15px;">
          <span>Jami:</span>
          <span>${Number(sale.total_amount).toLocaleString('ru-RU')} ${escapeHtml(currencyLabel)}</span>
        </div>
        ${Number(sale.tax_amount) > 0 ? `<div class="row"><span>QQS:</span><span>${Number(sale.tax_amount).toLocaleString('ru-RU')} ${escapeHtml(currencyLabel)}</span></div>` : ''}
        ${Number(sale.refunded_amount) > 0 ? `<div class="row"><span>Qaytarilgan:</span><span>${Number(sale.refunded_amount).toLocaleString('ru-RU')} ${escapeHtml(currencyLabel)}</span></div>` : ''}
        ${Number(sale.refunded_amount) > 0 && sale.net_amount != null ? `<div class="row"><span>Qolgan summa:</span><span>${Number(sale.net_amount).toLocaleString('ru-RU')} ${escapeHtml(currencyLabel)}</span></div>` : ''}
        <div class="row">
          <span>${paymentLabel}:</span>
          <span>${paymentAmount == null ? '—' : Number(paymentAmount).toLocaleString('ru-RU')} ${escapeHtml(currencyLabel)}</span>
        </div>
        ${sale.payment_type === 'cash' ? `<div class="row">
          <span>Qaytim:</span>
          <span>${sale.change == null ? '—' : Number(sale.change).toLocaleString('ru-RU')} ${escapeHtml(currencyLabel)}</span>
        </div>` : ''}
        <div class="divider"></div>
        <div class="center" style="font-size: 10px; margin-top: 10px;">
          Elektron chek. Ushbu chek ilbi.uz tizimida yaratilgan.
        </div>
      </body>
    </html>
  `;

  // Real PDF generation using expo-print
  const handleExportPdf = async () => {
    setShowShareModal(false);
    try {
      const { uri } = await Print.printToFileAsync({ html: generateHtml() });
      setPdfUri(uri);
      setPdfReady(true);
      setToastMessage('PDF tayyorlandi (vaqtinchalik fayl)', 'success');
    } catch {
      setPdfReady(false);
      setToastMessage('PDF yaratilmadi. Native ilovadagi eksportni tekshiring.', 'error');
    }
  };

  const handlePrint = async () => {
    try {
      await Print.printAsync({ html: generateHtml() });
    } catch {
      setToastMessage('Chop etish bekor qilindi');
    }
  };

  const handleNativeShare = async () => {
    setShowShareModal(false);
    try {
      if (pdfUri && (await Sharing.isAvailableAsync())) {
        await Sharing.shareAsync(pdfUri);
      } else {
        setToastMessage('Avval PDF yarating. Ushbu platformada fayl ulashish mavjudligini tekshiring.');
      }
    } catch {
      setToastMessage('Ulashish bekor qilindi');
    }
  };

  const handleCopyLink = async () => {
    setShowShareModal(false);
    if (!receiptUrl) { setToastMessage('Bu chek uchun tasdiqlangan ochiq havola hali yo‘q'); return; }
    try { await Clipboard.setStringAsync(receiptUrl); setToastMessage('Chek havolasi nusxalandi'); }
    catch { setToastMessage('Havolani nusxalab bo‘lmadi', 'error'); }
  };
  if (!saleRecord) return <View style={{ flex: 1, padding: 24, backgroundColor: colors.background }}>
    <Button title="Orqaga" onPress={() => navigation.goBack()} />
    <Text accessibilityRole={loadError ? 'alert' : undefined} style={{ color: loadError ? colors.danger : colors.text }}>{loadError || 'Chek ma’lumotlari yuklanmoqda…'}</Text>
    {loadError && validId ? <Button title="Chekni qayta yuklash" onPress={() => setAttempt(value => value + 1)} /> : null}
  </View>;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title={pdfReady ? 'PDF tayyor' : `Chek #${sale.receipt_number || sale.id || '—'}`}
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
                  Chek-{sale.receipt_number || sale.id || '—'}.pdf
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
                <Text style={styles.miniStoreName}>{sale.tenant_name || (sale._preview ? 'Demo do‘kon' : '—')}</Text>
                <Text style={styles.miniDate}>{sale.created_at ? new Date(sale.created_at).toLocaleString('uz-UZ') : '—'}</Text>
              </View>

              <View style={styles.miniDivider} />

              <View style={styles.miniItems}>
                {receiptItems.map((item, index) => <Text key={index} style={styles.miniItemRow}>{item.productName}  {(item.quantity * item.unitPrice).toLocaleString('ru-RU')}</Text>)}
              </View>
              <View style={styles.miniDivider} />
              <Text style={styles.miniTotal}>Jami: {Number(sale.total_amount).toLocaleString('ru-RU')} {currencyLabel}</Text>
            </View>

            {/* Action Buttons (Board 26C) */}
            <View style={styles.pdfActionsRow}>
              <Button
                title="PDFni ulashish"
                variant="secondary"
                icon={<FileText size={18} color={colors.text} />}
                onPress={handleNativeShare}
                style={{ flex: 1, marginRight: spacing.sm }}
              />
              <Button
                title="Ulashish"
                icon={<Share2 size={18} color={colors.primaryActionText} />}
                onPress={handleNativeShare}
                style={{ flex: 1 }}
              />
            </View>

            <Button
              title="Chop etish"
              variant="secondary"
              icon={<Printer size={18} color={colors.text} />}
              fullWidth
              onPress={handlePrint}
              style={{ marginTop: spacing.md }}
            />
          </View>
        ) : (
          /* Board 26A: Thermal Receipt Viewer */
          <View style={styles.receiptViewContainer}>
            {/* White Paper Receipt Container */}
            <View style={[styles.receiptPaper, { backgroundColor: colors.paperBackground }]}>
              {/* Header */}
              <View style={styles.receiptHeader}>
                <IlbiLogo height={22} monochromeColor="#0B0909" />
                <Text style={styles.receiptStoreTitle}>{sale.tenant_name || (sale._preview ? 'Demo do‘kon' : '—')}</Text>
                <Text style={styles.receiptTimestamp}>{sale.created_at ? new Date(sale.created_at).toLocaleString('uz-UZ') : '—'}</Text>
              </View>

              <View style={styles.receiptDashedLine} />

              {/* Items List */}
              <View style={styles.receiptItemsList}>
                {receiptItems.map((item, index) => (
                  <View key={index} style={styles.receiptItemRow}>
                    <View>
                      <Text style={styles.receiptItemName}>{item.productName}</Text>
                      <Text style={styles.receiptItemCalc}>
                        {item.quantity} × {item.unitPrice.toLocaleString('ru-RU')}
                      </Text>
                    </View>
                    <Text style={styles.receiptItemTotal}>
                      {(item.quantity * item.unitPrice).toLocaleString('ru-RU')}
                    </Text>
                  </View>
                ))}

              </View>

              <View style={styles.receiptDashedLine} />

              {/* Totals */}
              <View style={styles.receiptTotalRow}>
                <Text style={styles.receiptTotalLabel}>Jami:</Text>
                <Text style={styles.receiptTotalValue}>
                  {Number(sale.total_amount ?? 0).toLocaleString('ru-RU')} {currencyLabel}
                </Text>
              </View>

              {statusLabel ? <View style={styles.receiptSubRow}><Text style={styles.receiptSubLabel}>Holat:</Text><Text style={styles.receiptSubValue}>{statusLabel}</Text></View> : null}
              {Number(sale.tax_amount) > 0 ? <View style={styles.receiptSubRow}><Text style={styles.receiptSubLabel}>QQS:</Text><Text style={styles.receiptSubValue}>{Number(sale.tax_amount).toLocaleString('ru-RU')} {currencyLabel}</Text></View> : null}
              {Number(sale.refunded_amount) > 0 ? <View style={styles.receiptSubRow}><Text style={styles.receiptSubLabel}>Qaytarilgan:</Text><Text style={styles.receiptSubValue}>{Number(sale.refunded_amount).toLocaleString('ru-RU')} {currencyLabel}</Text></View> : null}
              {Number(sale.refunded_amount) > 0 && sale.net_amount != null ? <View style={styles.receiptSubRow}><Text style={styles.receiptSubLabel}>Qolgan summa:</Text><Text style={styles.receiptSubValue}>{Number(sale.net_amount).toLocaleString('ru-RU')} {currencyLabel}</Text></View> : null}
              <View style={styles.receiptSubRow}>
                <Text style={styles.receiptSubLabel}>{paymentLabel}:</Text>
                <Text style={styles.receiptSubValue}>
                  {paymentAmount == null ? '—' : Number(paymentAmount).toLocaleString('ru-RU')} {currencyLabel}
                </Text>
              </View>

              {sale.payment_type === 'cash' && <View style={styles.receiptSubRow}>
                <Text style={styles.receiptSubLabel}>Qaytim:</Text>
                <Text style={styles.receiptSubValue}>
                  {sale.change == null ? '—' : Number(sale.change).toLocaleString('ru-RU')} {currencyLabel}
                </Text>
              </View>}

              <View style={styles.receiptDashedLine} />

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
                onPress={handlePrint}
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
            Chek #{sale.receipt_number || sale.id || '—'} • {Number(sale.total_amount ?? 0).toLocaleString('ru-RU')} {currencyLabel}
          </Text>

          {/* Option 1: PDF yuklab olish */}
          <TouchableOpacity accessibilityRole="button"
            activeOpacity={0.7}
            onPress={handleExportPdf}
            style={[styles.shareOptionCard, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
          >
            <Download size={22} color={colors.text} />
            <View style={styles.shareOptionTextCol}>
              <Text style={[styles.shareOptionTitle, { color: colors.text }]}>PDF yuklab olish</Text>
              <Text style={[styles.shareOptionSub, { color: colors.textSecondary }]}>
                Chekni PDF fayl sifatida saqlash
              </Text>
            </View>
            <Text style={[styles.chevron, { color: colors.textMuted }]}>›</Text>
          </TouchableOpacity>

          {/* Option 2: Havolani nusxalash */}
          <TouchableOpacity accessibilityRole="button"
            activeOpacity={0.7}
            onPress={handleCopyLink}
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
            onPress={handleNativeShare}
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
