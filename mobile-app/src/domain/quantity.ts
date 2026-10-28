export function quantityMilli(value: string | number, allowZero = false): bigint {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(text)) throw Error('Miqdorni ko‘pi bilan 3 kasr xonasi bilan kiriting.');
  const [whole, fraction = ''] = text.split('.');
  const units = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if ((!allowZero && units <= 0n) || units > 99999999999999n) throw Error('Miqdor ruxsat etilgan chegaradan tashqarida.');
  return units;
}
export const parseQuantity = (value: string | number) => Number(quantityMilli(value)) / 1000;
export const formatQuantity = (value: string | number) => (Number(quantityMilli(value, true)) / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
