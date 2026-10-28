export type DashboardSummary = {
  kpi: Record<string, string | number>;
  chart: { date: string; total_sales_uzs: string; total_sales_usd: string; sales_count: number }[];
};
export function decimal(value: unknown, fallback = '0'): string {
  if (value == null) return fallback;
  const text = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) throw Error('Server son qiymatini tasdiqlamadi.');
  return text;
}
export function requiredDecimal(value: unknown): string {
  if (value == null) throw Error('Server zarur pul yoki miqdor qiymatini qaytarmadi.');
  return decimal(value);
}
export const formatAmount = (value: unknown, digits = 2) => Number(decimal(value)).toLocaleString('ru-RU', { maximumFractionDigits: digits });
export function parseDashboard(value: any): DashboardSummary {
  if (!value || typeof value !== 'object' || !value.kpi || typeof value.kpi !== 'object') throw Error('Server statistikani tasdiqlamadi.');
  const kpi = { ...value.kpi };
  for (const key of ['total_sales_uzs', 'total_sales_usd', 'cash_revenue_uzs', 'card_revenue_uzs', 'debt_sales_uzs', 'average_check_uzs', 'total_debt_uzs']) kpi[key] = requiredDecimal(kpi[key]);
  if (!Number.isInteger(Number(kpi.sales_count)) || Number(kpi.sales_count) < 0) throw Error('Savdolar soni tasdiqlanmadi.');
  kpi.sales_count = Number(kpi.sales_count);
  const rawChart = value.sales_chart || value.daily_chart || value.chart || [];
  if (!Array.isArray(rawChart)) throw Error('Statistika qatorlari tasdiqlanmadi.');
  return { kpi, chart: rawChart.map((row: any) => ({ date: String(row.date || ''), total_sales_uzs: decimal(row.total_sales_uzs), total_sales_usd: decimal(row.total_sales_usd), sales_count: Number(row.sales_count || 0) })) };
}
export function positiveId(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw Error('Server yozuv raqamini tasdiqlamadi.');
  return Number(value);
}
export type CashReport = { id: number; date: string; tenant_name?: string; closed_at?: string | null; closed_by_name?: string; is_closed: boolean; [key: string]: any };
export function parseCashReport(value: any): CashReport {
  if (!value || typeof value !== 'object') throw Error('Server hisobotni tasdiqlamadi.');
  if (value.is_closed === true) {
    for (const key of ['actual_cash_uzs', 'actual_cash_usd', 'expected_cash_uzs', 'expected_cash_usd', 'discrepancy_uzs', 'discrepancy_usd']) requiredDecimal(value[key]);
  }
  return { ...value, id: positiveId(value.id), date: String(value.date || ''), is_closed: value.is_closed === true };
}
export function escapeHtml(value: unknown) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!)); }
export function cashReportHtml(report: CashReport): string {
  if (!report.is_closed) throw Error('Faqat serverda yopilgan smena yakuniy Z-hisobot hisoblanadi.');
  const labels: [string, string][] = [
    ['opening_cash', 'Boshlang‘ich qoldiq'], ['total_sale_cash', 'Naqd savdo'], ['total_sale_card', 'Karta savdo'],
    ['total_sale_debt', 'Nasiya savdo'], ['collected_debt_cash', 'Qaytgan qarz'], ['refund_cash', 'Qaytarilgan pul'],
    ['total_extra_income', 'Qo‘shimcha kirim'], ['total_expenses', 'Xarajat'], ['expected_cash', 'Kutilgan naqd'],
    ['actual_cash', 'Sanab chiqilgan naqd'], ['discrepancy', 'Tafovut'],
  ];
  for (const [key] of labels) for (const currency of ['uzs', 'usd']) requiredDecimal(report[key + '_' + currency]);
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}</style></head><body><h1>${escapeHtml(report.tenant_name || 'ILBI')}</h1><h2>Z-hisobot #${report.id}</h2><p>${escapeHtml(report.date)} · ${escapeHtml(report.closed_by_name || '')}</p><table><tr><th>Ko‘rsatkich</th><th>UZS</th><th>USD</th></tr>${labels.map(([key, label]) => `<tr><td>${label}</td><td>${formatAmount(report[key + '_uzs'])}</td><td>${formatAmount(report[key + '_usd'])}</td></tr>`).join('')}</table><p>${escapeHtml(report.discrepancy_reason || '')}</p><p>${escapeHtml(report.staff_notes || '')}</p></body></html>`;
}
