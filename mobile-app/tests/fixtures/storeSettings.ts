/** Deliberately non-default values expose accidental full-form overwrites. */
export const storeSettingsFixture = {
  id: 1, name: 'Original store', settings_revision: 'a'.repeat(64), address: 'Original address', description: 'Original description',
  receipt_phone: '+998901234567', receipt_header: 'Original header', receipt_footer: 'Original footer', receipt_paper_width: '80mm', receipt_show_cashier: false, receipt_show_customer: true, receipt_show_item_tax: false,
  tax_regime: 'general', tax_regime_name: '', is_vat_payer: true, vat_rate: '6.00', price_includes_vat: false, turnover_tax_rate: '0.00', profit_tax_enabled: true, profit_tax_rate: '15.00',
  auto_usd_rate: false, usd_rate: '13001.25', manual_usd_rate: '13001.25', cbu_rates: { USD: { rate: '13000.123456', date: '2026-10-27' } },
  telegram_group_id: '-100123456', notify_on_sale: true, notify_on_debt: false, notify_web_reports: false, notify_web_low_stock: true,
  daily_report_target: 'personal', shift_report_target: 'none', low_stock_report_target: 'group', daily_report_time: '21:45:00', low_stock_report_time: '08:30:00', low_stock_frequency: 'weekly', low_stock_weekday: 6, low_stock_day_of_month: 29,
  receipt_settings: { store_code: 'ORIGINAL', seller_name: 'Registered seller', seller_tax_identifier: '123456789' },
};
