/** Money is parsed into integer minor units; never delete punctuation/signs to guess a value. */
export class MoneyInputError extends Error {
  constructor() { super('Summani to‘g‘ri kiriting (masalan, 11 500,25).'); }
}

export function parseMoneyMinor(input: string | number, allowNegative = false): number {
  let text = String(input).trim().replace(/[\s\u00a0\u202f]/g, '');
  if (!text || !/^-?\d[\d.,]*$/.test(text)) throw new MoneyInputError();
  const negative = text.startsWith('-');
  if (negative && !allowNegative) throw new MoneyInputError();
  if (negative) text = text.slice(1);
  const separators = [...text.matchAll(/[.,]/g)];
  let whole = text, fraction = '';
  if (separators.length) {
    const last = separators.at(-1)!;
    const tail = text.slice(last.index! + 1);
    if (tail.length <= 2) {
      fraction = tail;
      whole = text.slice(0, last.index);
      // Before the decimal, separators must be consistent three-digit groups.
      if (/[.,]/.test(whole) && !/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(whole)) throw new MoneyInputError();
      if (whole.includes(last[0])) throw new MoneyInputError();
    } else if (!/^\d{1,3}([.,])\d{3}(?:\1\d{3})*$/.test(text)) throw new MoneyInputError();
  }
  whole = whole.replace(/[.,]/g, '');
  if (!/^\d+$/.test(whole) || !/^\d{0,2}$/.test(fraction)) throw new MoneyInputError();
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyInputError();
  return Number(negative ? -minor : minor);
}

export function parseMoney(input: string | number, allowNegative = false): number {
  return parseMoneyMinor(input, allowNegative) / 100;
}

export function tryMoney(input: string | number): number | null {
  try { return parseMoney(input); } catch { return null; }
}

export function moneyDifference(received: number, due: number): number {
  return (parseMoneyMinor(received) - parseMoneyMinor(due)) / 100;
}

export function formatMoney(value: string | number): string {
  return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
