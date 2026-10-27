import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { usePermissions } from '../auth/usePermissions';
import { useTheme } from '../../theme/ThemeContext';
import { Page, Notice } from '../../components/ui/Page';
import { Button } from '../../components/ui/Button';
import { ListState } from '../../components/ui/ListState';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { request, assertAuthScope, captureAuthScope } from '../../api/client';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { usePagedResource } from '../../hooks/usePagedResource';
import { cashReportHtml, formatAmount, parseCashReport, parseDashboard, type CashReport } from './model';

const periods = [['today', 'Bugun'], ['this_week', 'Haftalik'], ['this_month', 'Oylik'], ['this_year', 'Yillik']] as const;
export const ReportsScreen: React.FC = () => {
  const navigation = useAppNavigation(), { colors } = useTheme(), { can } = usePermissions();
  const [period, setPeriod] = useState<(typeof periods)[number][0]>('today');
  const analytics = useScopedQuery(can('analytics.view_dashboard') ? '/analytics/dashboard/?period=' + period : null, parseDashboard);
  const reports = usePagedResource(can('cashbox.view_cashbox') ? '/cashbox/reports/' : null, parseCashReport);
  const [selectedId, setSelectedId] = useState<number | null>(null), [sharing, setSharing] = useState(false), [shareError, setShareError] = useState('');
  const exportLock = useRef(false);
  const selected = useScopedQuery(selectedId && can('cashbox.view_cashbox') ? '/cashbox/reports/' + selectedId + '/' : null, parseCashReport);
  const share = async (report: CashReport) => {
    if (exportLock.current) return;
    exportLock.current = true; setSharing(true); setShareError('');
    const scope = captureAuthScope();
    try {
      // Read the authoritative finalized report immediately before export.
      const latest = parseCashReport(await request('/cashbox/reports/' + report.id + '/'));
      assertAuthScope(scope);
      if (latest.id !== report.id) throw Error('Server so‘ralgan hisobotni tasdiqlamadi.');
      const html = cashReportHtml(latest);
      if (!(await Sharing.isAvailableAsync())) throw Error('Ushbu qurilmada fayl ulashish mavjud emas.');
      const { uri } = await Print.printToFileAsync({ html });
      assertAuthScope(scope);
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Z-hisobotni ulashish', UTI: 'com.adobe.pdf' });
    } catch (failure: any) { setShareError(failure.message || 'Hisobotni ulashib bo‘lmadi.'); }
    finally { exportLock.current = false; setSharing(false); }
  };
  const kpi = analytics.data?.kpi;
  const card = { backgroundColor: colors.surface, borderColor: colors.border };
  return <Page title="Hisobotlar" onMenu={navigation.openDrawer} insetBottom={false}>
    {can('analytics.view_dashboard') && <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {periods.map(([value, label]) => <TouchableOpacity key={value} accessibilityRole="radio" accessibilityLabel={'Davr: ' + label} accessibilityState={{ checked: period === value }} onPress={() => setPeriod(value)} style={[styles.period, { backgroundColor: period === value ? colors.text : colors.surface, borderColor: colors.border }]}><Text style={{ color: period === value ? colors.surface : colors.text }}>{label}</Text></TouchableOpacity>)}
      </ScrollView>
      <ListState loading={analytics.loading} error={analytics.error} onRetry={analytics.reload} />
      {kpi && <View style={[styles.card, card]}>
        <Text style={[styles.heading, { color: colors.text }]}>Savdo statistikasi</Text>
        <Metric label="Jami savdo" value={formatAmount(kpi.total_sales_uzs) + ' UZS'} />
        {Number(kpi.total_sales_usd) !== 0 && <Metric label="Jami savdo (USD)" value={formatAmount(kpi.total_sales_usd) + ' USD'} />}
        <Metric label="Savdolar soni" value={String(kpi.sales_count)} />
        <Metric label="O‘rtacha chek" value={formatAmount(kpi.average_check_uzs) + ' UZS'} />
        <Metric label="Naqd savdo" value={formatAmount(kpi.cash_revenue_uzs) + ' UZS'} />
        <Metric label="Karta savdo" value={formatAmount(kpi.card_revenue_uzs) + ' UZS'} />
        <Metric label="Nasiya savdo" value={formatAmount(kpi.debt_sales_uzs) + ' UZS'} />
        <Metric label="Jami qaytmagan qarz" value={formatAmount(kpi.total_debt_uzs) + ' UZS'} />
        <Button title="Statistikani yangilash" variant="secondary" onPress={analytics.reload} />
      </View>}
      {analytics.data && analytics.data.chart.length > 0 && <View style={[styles.card, card]}>
        <Text style={[styles.heading, { color: colors.text }]}>Kunlar bo‘yicha savdo</Text>
        {analytics.data.chart.map((row, index) => <Metric key={row.date + ':' + index} label={row.date} value={formatAmount(row.total_sales_uzs) + ' UZS · ' + row.sales_count + ' ta'} />)}
      </View>}
    </>}
    {can('cashbox.view_cashbox') && <View style={[styles.card, card]}>
      <Text style={[styles.heading, { color: colors.text }]}>Saqlangan Z-hisobotlar</Text>
      <Notice>Quyidagi hujjatlar serverda yopilgan smenalarga tegishli. Statistika smenani yopmaydi.</Notice>
      <ListState loading={reports.loading} error={reports.error} empty={!reports.rows.length} onRetry={reports.retry} emptyLabel="Hali saqlangan smena hisoboti yo‘q." />
      {reports.rows.map(report => <TouchableOpacity key={report.id} accessibilityRole="button" accessibilityLabel={'Z-hisobot #' + report.id} onPress={() => { setSelectedId(report.id); setShareError(''); }} style={[styles.report, { borderColor: colors.border }]}>
        <Text style={{ color: colors.text, fontWeight: '600' }}>Z-hisobot #{report.id} · {report.date}</Text>
        <Text style={{ color: colors.textSecondary }}>{report.closed_by_name || '—'} · {report.is_closed ? 'Yopilgan' : 'Ochiq'}</Text>
        <Text style={{ color: colors.text }}>Naqd: {formatAmount(report.actual_cash_uzs)} UZS</Text>
      </TouchableOpacity>)}
      {reports.hasMore && <Button title="Yana hisobotlar" variant="secondary" loading={reports.loadingMore} onPress={reports.loadMore} />}
    </View>}
    {!can('analytics.view_dashboard') && !can('cashbox.view_cashbox') && <Notice error>Hisobotlarni ko‘rish uchun vakolat berilmagan.</Notice>}
    <BottomSheet visible={selectedId !== null} title={'Z-hisobot #' + selectedId} scrollable onClose={() => { if (!sharing) setSelectedId(null); }}>
      <ListState loading={selected.loading} error={selected.error} onRetry={selected.reload} />
      {selected.data && <View style={{ gap: 12 }}>
        <Notice>{selected.data.date} · {selected.data.closed_by_name || '—'}</Notice>
        <Metric label="Kutilgan naqd" value={formatAmount(selected.data.expected_cash_uzs) + ' UZS'} />
        <Metric label="Sanab chiqilgan naqd" value={formatAmount(selected.data.actual_cash_uzs) + ' UZS'} />
        <Metric label="Tafovut" value={formatAmount(selected.data.discrepancy_uzs) + ' UZS'} />
        {selected.data.discrepancy_reason ? <Notice>{selected.data.discrepancy_reason}</Notice> : null}
        {shareError ? <Notice error>{shareError}</Notice> : null}
        <Button title="Z-hisobotni PDF ulashish" disabled={!selected.data.is_closed} loading={sharing} onPress={() => share(selected.data!)} />
      </View>}
    </BottomSheet>
  </Page>;
};
function Metric({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return <View style={styles.metric}><Text style={{ color: colors.textSecondary, flex: 1 }}>{label}</Text><Text style={{ color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text></View>;
}
const styles = StyleSheet.create({ card: { padding: 16, borderWidth: 1, borderRadius: 16, gap: 14 }, heading: { fontSize: 17, fontWeight: '700' }, period: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderRadius: 12 }, metric: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, report: { borderTopWidth: 1, paddingVertical: 14, gap: 5 } });
