import { hasPermission } from '../auth/permissions';
import { usePermissions } from '../auth/usePermissions';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppNavigation as useNavigation } from '../../navigation/useAppNavigation';
import { Bell, Clock, FileText, Package, Plus, Receipt, ShoppingCart } from 'lucide-react-native';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing, typography } from '../../theme/tokens';
import { request } from '../../api/client';

export const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { user, activeTenant } = useAuth();
  const { canOpen } = usePermissions();
  const canDashboard = hasPermission(user, activeTenant, 'analytics.view_dashboard');
  const canSales = hasPermission(user, activeTenant, 'sales.view_sale');

  const [refreshing, setRefreshing] = useState(false);
  const [metricData, setMetrics] = useState({ todaySales: '—', salesCount: '—', debtSum: '—' });
  const [salesData, setRecentSales] = useState<any[]>([]);
  const [dataScope, setDataScope] = useState<number | undefined>();
  const metrics = dataScope === activeTenant?.id ? metricData : { todaySales: '—', salesCount: '—', debtSum: '—' };
  const recentSales = dataScope === activeTenant?.id ? salesData : [];
  const [loadError, setLoadError] = useState('');
  const loadSequence = useRef(0), pendingRequest = useRef<AbortController | null>(null);
  const loadData = useCallback(async () => {
    const current = ++loadSequence.current;
    pendingRequest.current?.abort();
    const abort = new AbortController(); pendingRequest.current = abort;
    try {
      const [dashboard, salesRes] = await Promise.all([
        canDashboard ? request('/analytics/dashboard/?period=today', { signal: abort.signal }) : Promise.resolve({}), canSales ? request('/sales/?page=1&page_size=5', { signal: abort.signal }) : Promise.resolve([]),
      ]);
      if (current !== loadSequence.current || abort.signal.aborted) return;
      const kpi = dashboard.kpi || dashboard;
      setMetrics({
        todaySales: Number(kpi.total_sales_uzs ?? kpi.today_sales_sum ?? 0).toLocaleString('ru-RU'),
        salesCount: String(kpi.sales_count ?? 0),
        debtSum: Number(kpi.total_debt_uzs ?? kpi.debt_sum ?? 0).toLocaleString('ru-RU'),
      });
      const rows = Array.isArray(salesRes) ? salesRes : salesRes.results || [];
      setRecentSales(rows.map((s: any) => ({
        id: s.id, receiptNumber: '#' + (s.receipt_number || s.id), customerName: s.counterparty_name || 'Umumiy mijoz',
        time: s.created_at ? new Date(s.created_at).toLocaleString('uz-UZ') : '',
        itemsCount: s.items?.length ?? '—', amount: Number(s.total_amount).toLocaleString('ru-RU'),
      })));
      setLoadError(''); setDataScope(activeTenant?.id);
    } catch (error: any) { if (current !== loadSequence.current || abort.signal.aborted) return; setLoadError(error.message || 'Ma’lumotlar yuklanmadi'); }
  }, [activeTenant, canDashboard, canSales]);

  const cancel = useCallback(() => { loadSequence.current++; pendingRequest.current?.abort(); }, []);
  useEffect(() => {
    void Promise.resolve().then(loadData);
    return cancel;
  }, [loadData, activeTenant?.id, cancel]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const todayDateStr = new Date().toLocaleDateString('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
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
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Bildirishnomalar" disabled accessibilityState={{ disabled: true }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.bellBtn}>
              <Bell size={20} color={colors.text} />
              <View style={[styles.bellDot, { backgroundColor: colors.danger }]} />
            </TouchableOpacity>
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {loadError ? <Text style={{ color: colors.danger }}>{loadError}</Text> : null}
        {/* Title row */}
        <View style={styles.titleRow}>
          <Text style={[styles.pageTitle, { color: colors.text }]}>Bugungi holat</Text>
          <Text style={[styles.dateText, { color: colors.textSecondary }]}>{todayDateStr}</Text>
        </View>

        {/* Dashboard Metrics Card */}
        {canDashboard && <View
          style={[
            styles.metricCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <View style={styles.metricHeader}>
            <Text style={[styles.metricLabel, { color: colors.textSecondary }]}>Bugungi savdo</Text>
            <Text style={[styles.metricChevron, { color: colors.textMuted }]}>›</Text>
          </View>

          <Text style={[styles.metricValue, { color: colors.text }]}>
            {metrics.todaySales} <Text style={styles.metricCurrency}>so&#39;m</Text>
          </Text>

          <View style={[styles.metricDivider, { backgroundColor: colors.borderSubtle }]} />

          <View style={styles.subMetricsRow}>
            <View style={[styles.subMetric, { backgroundColor: colors.surfaceSecondary }]}>
              <ShoppingCart size={15} color={colors.textSecondary} />
              <Text style={[styles.subMetricText, { color: colors.text }]}>
                {metrics.salesCount} ta <Text style={{ color: colors.textSecondary, fontWeight: '400' }}>savdo</Text>
              </Text>
            </View>

            <View style={[styles.subMetric, { backgroundColor: colors.surfaceSecondary }]}>
              <Clock size={15} color={colors.textSecondary} />
              <Text style={[styles.subMetricText, { color: colors.text }]}>
                {metrics.debtSum} <Text style={{ color: colors.textSecondary, fontWeight: '400' }}>so&#39;m qarz</Text>
              </Text>
            </View>
          </View>
        </View>}

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
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('Savdo')}>
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
                <Text style={[styles.saleAmount, { color: colors.text }]}>{sale.amount} so&#39;m</Text>
                <Text style={[styles.saleChevron, { color: colors.textMuted }]}>›</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View></>}
      </ScrollView>
    </View>
  );
};

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
  metricCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  metricLabel: {
    fontSize: typography.size.sm,
    fontWeight: typography.weight.medium,
  },
  metricChevron: {
    fontSize: typography.size.lg,
  },
  metricValue: {
    fontSize: typography.size.display,
    fontWeight: typography.weight.bold,
    marginBottom: spacing.md,
  },
  metricCurrency: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.medium,
  },
  metricDivider: {
    height: 1,
    marginBottom: spacing.md,
  },
  subMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  subMetric: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  subMetricText: {
    marginLeft: spacing.xs + 2,
    fontSize: typography.size.xs + 1,
    fontWeight: typography.weight.semibold,
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
