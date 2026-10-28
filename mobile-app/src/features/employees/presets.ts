/** Qualified server codes only. IDs are resolved from the current server choices. */
const cash = ['cashbox.manage_shift', 'cashbox.view_cashbox', 'cashbox.record_income', 'cashbox.record_expense'];
const catalog = ['catalog.view_product', 'catalog.view_category'];
const sales = ['sales.add_sale', 'sales.view_sale', 'sales.record_debt_payment'];
const stock = ['inventory.view_stock', 'inventory.add_stock_intake', 'inventory.adjust_stock', 'inventory.transfer_stock'];
export const teamPresets = [
  { name: 'Kassir', codes: [...cash, ...catalog, ...sales] },
  { name: 'Katta kassir', codes: [...cash, ...catalog, ...sales, 'sales.void_sale', 'sales.manage_counterparty'] },
  { name: 'Omborchi', codes: [...stock, ...catalog, 'catalog.add_product', 'catalog.change_product'] },
  { name: 'Bosh omborchi', codes: [...stock, ...catalog, 'catalog.add_product', 'catalog.change_product', 'catalog.archive_product', 'catalog.view_cost_price', 'inventory.view_supplier', 'sales.manage_b2b'] },
  { name: 'Menejer', codes: [...cash, ...catalog, ...sales, ...stock, 'sales.void_sale', 'sales.manage_counterparty', 'catalog.add_product', 'catalog.change_product', 'catalog.add_category', 'inventory.view_supplier', 'analytics.view_dashboard', 'analytics.view_reports'] },
  { name: 'Buxgalter', codes: [...cash, ...catalog, 'sales.view_sale', 'sales.record_debt_payment', 'catalog.view_cost_price', 'inventory.view_supplier', 'inventory.view_stock', 'analytics.view_dashboard', 'analytics.view_reports'] },
  { name: 'Operator', codes: [...catalog, ...sales, 'sales.manage_counterparty', 'sales.manage_b2b', 'inventory.view_stock'] },
];
