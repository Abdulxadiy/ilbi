import { parseMoney } from '../../domain/money';
/** SaleListCreateView serializes many=True; retail UZS checkout expects exactly one saved receipt. */
export function acceptedRetailSale(response: unknown): any {
  if (!Array.isArray(response) || response.length !== 1) throw Error('Server javobidagi cheklar sonini tekshirish kerak. Savat saqlandi; yangi savdo yaratmang.');
  const sale = response[0];
  if (!sale || !Number.isSafeInteger(Number(sale.id)) || Number(sale.id) < 1 || (sale.currency && sale.currency !== 'UZS')) throw Error('Server savdo identifikatori yoki valyutasini tasdiqlamadi.');
  parseMoney(sale.total_amount);
  return sale;
}
