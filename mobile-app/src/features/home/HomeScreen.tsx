import { hasPermission } from '../auth/permissions';
import { usePermissions } from '../auth/usePermissions';
import React, { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation } from '../../navigation/useAppNavigation';
import { Clock, FileText, Package, Plus, Receipt } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { request } from '../../api/client';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { formatAmount, positiveId, requiredDecimal } from '../reports/model';
import { NotificationBell } from '../notifications/NotificationBell';

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { user, activeTenant } = useAuth();
  const { canOpen } = usePermissions();
  const canDashboard = hasPermission(user, activeTenant, 'analytics.view_dashboard');
  const canSales = hasPermission(user, activeTenant, 'sales.view_sale');

  const [refreshing, setRefreshing] = useState(false), [loadError, setLoadError] = useState('');
  const dashboard = useScopedQuery(canDashboard ? '/analytics/dashboard/?period=today' : null, homeDashboard);
  const sales = useScopedQuery(canSales ? '/sales/?page=1&page_size=5' : null, homeSales);
  const metrics = dashboard.data || { todaySales: '—', salesCount: '—', debtSum: '—' };
  const recentSales = sales.data || [];
  const onRefresh = async () => {
    setRefreshing(true); setLoadError('');
    await Promise.all([dashboard.reload(), sales.reload()]);
    setRefreshing(false);
  };

  const todayDateStr = new Date().toLocaleDateString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Asia/Tashkent',
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        onOpenDrawer={() => navigation.openDrawer()}
        rightAction={
          <View style={styles.headerRight}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Do‘konni almashtirish" onPress={() => navigation.navigate('Stores')} style={[styles.storeBadge, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
              <Text style={[styles.storeBadgeText, { color: colors.text }]} numberOfLines={1}>
                {activeTenant?.name ? activeTenant.name.slice(0, 8) : 'Markaziy'} ∨
              </Text>
            </TouchableOpacity>
            <NotificationBell />
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {(loadError || dashboard.error || sales.error) ? <View style={{ padding: 16, gap: 8 }}><Text accessibilityRole="alert" style={{ color: colors.danger }}>{loadError || dashboard.error?.message || sales.error?.message}</Text><Button title="Ma’lumotlarni qayta yuklash" variant="secondary" onPress={onRefresh} /></View> : null}
        {/* Title row */}
        <View style={styles.titleRow}>
          <Text style={[styles.pageTitle, { color: colors.text }]}>Bugungi holat</Text>
          <Text style={[styles.dateText, { color: colors.textSecondary }]}>{todayDateStr}</Text>
        </View>

        {/* Dashboard Metrics Cards (Expo Dashboard 2-column grid style) */}
        {canDashboard && (
          <View style={styles.metricsGrid}>
            {/* KPI 1: Bugungi savdo */}
            <TouchableOpacity
              activeOpacity={0.8}
              accessibilityRole="button"
              disabled={!canOpen('Reports')}
              accessibilityState={{ disabled: !canOpen('Reports') }}
              onPress={() => navigation.navigate('Reports')}
              style={[
                styles.kpiCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <View style={styles.kpiHeaderRow}>
                <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Bugungi savdo</Text>
                <View style={[styles.kpiBadge, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.kpiBadgeText, { color: colors.primaryAction }]}>so‘m</Text>
                </View>
              </View>
              <Text style={[styles.kpiValue, { color: colors.text }]} numberOfLines={1}>
                {metrics.todaySales}
              </Text>
              <Text style={[styles.kpiSubtext, { color: colors.textSecondary }]}>
                Umumiy savdo tushumi
              </Text>
            </TouchableOpacity>

            {/* KPI 2: Savdolar soni */}
            <TouchableOpacity
              activeOpacity={0.8}
              accessibilityRole="button"
              disabled={!canOpen('Documents')}
              accessibilityState={{ disabled: !canOpen('Documents') }}
              onPress={() => navigation.navigate('Documents')}
              style={[
                styles.kpiCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <View style={styles.kpiHeaderRow}>
                <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Savdolar soni</Text>
                <View style={[styles.kpiBadge, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.kpiBadgeText, { color: colors.success }]}>↑ cheklar</Text>
                </View>
              </View>
              <Text style={[styles.kpiValue, { color: colors.text }]} numberOfLines={1}>
                {metrics.salesCount}
              </Text>
              <Text style={[styles.kpiSubtext, { color: colors.textSecondary }]}>
                Muvaffaqiyatli xaridlar
              </Text>
            </TouchableOpacity>

            {/* KPI 3: Mijozlar qarzi */}
            {canOpen('Qarz') ? (
              <TouchableOpacity
                activeOpacity={0.8}
                accessibilityRole="button"
                onPress={() => navigation.navigate('Qarz')}
                style={[
                  styles.kpiCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.borderSubtle,
                  },
                ]}
              >
                <View style={styles.kpiHeaderRow}>
                  <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Mijozlar qarzi</Text>
                  <View style={[styles.kpiBadge, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[styles.kpiBadgeText, { color: colors.danger }]}>nasiya</Text>
                  </View>
                </View>
                <Text style={[styles.kpiValue, { color: colors.text }]} numberOfLines={1}>
                  {metrics.debtSum}
                </Text>
                <Text style={[styles.kpiSubtext, { color: colors.textSecondary }]}>
                  Kutilayotgan summa
                </Text>
              </TouchableOpacity>
            ) : null}

            {/* KPI 4: Faol do'kon */}
            <TouchableOpacity
              activeOpacity={0.8}
              accessibilityRole="button"
              onPress={() => navigation.navigate('Stores')}
              style={[
                styles.kpiCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.borderSubtle,
                },
              ]}
            >
              <View style={styles.kpiHeaderRow}>
                <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Faol do‘kon</Text>
                <View style={[styles.kpiBadge, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[styles.kpiBadgeText, { color: colors.success }]}>● faol</Text>
                </View>
              </View>
              <Text style={[styles.kpiValue, { color: colors.text }]} numberOfLines={1}>
                {activeTenant?.name ? (activeTenant.name.length > 11 ? activeTenant.name.slice(0, 10) + '…' : activeTenant.name) : 'Markaziy'}
              </Text>
              <Text style={[styles.kpiSubtext, { color: colors.textSecondary }]}>
                Joriy savdo nuqtasi
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Primary Action Button: Yangi savdo */}
        {canOpen('Savdo') && <Button
          title="Yangi savdo"
          icon={<Plus size={18} color={colors.primaryActionText} />}
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('Savdo')}
          style={styles.newSaleBtn}
        />}

        {/* Quick Actions (Tovar, Qarz, Hujjatlar) */}
        <View style={styles.quickActionsRow}>
          {canOpen('Tovar') && <TouchableOpacity accessibilityRole="button"
            onPress={() => navigation.navigate('Tovar')}
            style={[styles.quickActionBtn, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}
          >
            <View style={[styles.quickActionIconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <Package size={20} color={colors.text} />
            </View>
            <Text style={[styles.quickActionText, { color: colors.text }]}>Tovar</Text>
          </TouchableOpacity>}

          {canOpen('Qarz') && <TouchableOpacity accessibilityRole="button"
            onPress={() => navigation.navigate('Qarz')}
            style={[styles.quickActionBtn, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}
          >
            <View style={[styles.quickActionIconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <Clock size={20} color={colors.text} />
            </View>
            <Text style={[styles.quickActionText, { color: colors.text }]}>Qarz</Text>
          </TouchableOpacity>}

          {canOpen('Documents') && <TouchableOpacity accessibilityRole="button"
            onPress={() => navigation.navigate('Documents')}
            style={[styles.quickActionBtn, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}
          >
            <View style={[styles.quickActionIconWrap, { backgroundColor: colors.surfaceSecondary }]}>
              <FileText size={20} color={colors.text} />
            </View>
            <Text style={[styles.quickActionText, { color: colors.text }]}>Hujjatlar</Text>
          </TouchableOpacity>}
        </View>

        {/* Recent Sales Section */}
        {canSales && <><View style={styles.recentSectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>So&#39;nggi savdolar</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('Documents')}>
            <Text style={[styles.viewAllText, { color: colors.textSecondary }]}>Barchasi ›</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.salesListCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {recentSales.map((sale, idx) => (
            <TouchableOpacity accessibilityRole="button"
              key={sale.id}
              style={[
                styles.saleRow,
                idx < recentSales.length - 1 && { borderBottomColor: colors.borderSubtle, borderBottomWidth: 1 },
              ]}
              onPress={() => {
                request('/sales/' + sale.id + '/').then(record => navigation.navigate('ReceiptView', { sale: record })).catch(error => setLoadError(error.message));
              }}
            >
              <View style={[styles.receiptIconWrapper, { backgroundColor: colors.surfaceSecondary }]}>
                <Receipt size={18} color={colors.text} />
              </View>

              <View style={styles.saleDetails}>
                <View style={styles.saleTitleRow}>
                  <Text style={[styles.saleReceiptNum, { color: colors.text }]}>{sale.receiptNumber}</Text>
                  <Text style={[styles.saleCustomer, { color: colors.text }]} numberOfLines={1}>
                    {sale.customerName}
                  </Text>
                </View>
                <Text style={[styles.saleSubtext, { color: colors.textSecondary }]}>
                  {sale.time} • {sale.itemsCount} ta tovar
                </Text>
              </View>

              <View style={styles.saleAmountWrapper}>
                <Text style={[styles.saleAmount, { color: colors.text }]}>{sale.amount} {sale.currency}</Text>
                <Text style={[styles.saleChevron, { color: colors.textMuted }]}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View></>}
      </ScrollView>
    </View>
  );
};

function homeDashboard(value: any) {
  const kpi = value?.kpi || value;
  if (!kpi || (kpi.total_sales_uzs == null && kpi.today_sales_sum == null)) throw Error('Server bosh sahifa statistikasini tasdiqlamadi.');
  return { todaySales: formatAmount(kpi.total_sales_uzs ?? kpi.today_sales_sum), salesCount: kpi.sales_count == null ? '—' : String(kpi.sales_count), debtSum: kpi.total_debt_uzs == null && kpi.debt_sum == null ? '—' : formatAmount(kpi.total_debt_uzs ?? kpi.debt_sum) };
}
function homeSales(value: any) {
  const rows = Array.isArray(value) ? value : value?.results;
  if (!Array.isArray(rows)) throw Error('Server so‘nggi savdolarni tasdiqlamadi.');
  return rows.map((sale: any) => ({ id: positiveId(sale.id), receiptNumber: '#' + (sale.receipt_number || sale.id), customerName: sale.counterparty_name || 'Umumiy mijoz', time: sale.created_at ? new Date(sale.created_at).toLocaleString('uz-UZ') : '', itemsCount: sale.items?.length ?? '—', amount: formatAmount(requiredDecimal(sale.total_amount)), currency: sale.currency || 'UZS' }));
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  storeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginRight: spacing.sm,
  },
  storeBadgeText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  bellBtn: {
    padding: spacing.xs,
    position: 'relative',
  },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  pageTitle: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
  },
  dateText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  kpiCard: {
    width: '47.5%',
    flexGrow: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  kpiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  kpiLabel: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.medium,
  },
  kpiBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  kpiBadgeText: {
    fontSize: 10,
    fontWeight: typography.weight.semibold,
  },
  kpiValue: {
    fontSize: typography.size.xl,
    fontWeight: typography.weight.bold,
    marginVertical: 4,
  },
  kpiSubtext: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  newSaleBtn: {
    marginBottom: spacing.lg,
  },
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  quickActionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  quickActionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  quickActionText: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
  },
  recentSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.size.md,
    fontWeight: typography.weight.bold,
  },
  viewAllText: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  salesListCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  receiptIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  saleDetails: {
    flex: 1,
  },
  saleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saleReceiptNum: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
    marginRight: spacing.sm,
  },
  saleCustomer: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
    flex: 1,
  },
  saleSubtext: {
    fontSize: typography.size.xs,
    marginTop: 2,
  },
  saleAmountWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saleAmount: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.bold,
  },
  saleChevron: {
    fontSize: typography.size.md,
    marginLeft: spacing.xs,
  },
});
