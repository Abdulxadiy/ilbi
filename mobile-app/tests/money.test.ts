import { parseMoney, parseMoneyMinor, moneyDifference } from '../src/domain/money';

describe('Financial input preserves the intended amount', () => {
  test.each([
    ['11.50', 1150], ['11,50', 1150], ['1 234 567,89', 123456789],
    ['1,234.50', 123450], ['1.234,50', 123450], ['12\u00a0000', 1200000],
    ['1,234', 123400], ['0.01', 1], ['0', 0], ['11500.', 1150000],
  ])('%s is parsed without deleting decimals', (input, minor) => expect(parseMoneyMinor(input)).toBe(minor));
  test.each(['-5', 'NaN', '1e3', '+10', '12/50', '1.23.45', '1,2,3', '', 'Infinity', '1234.5678'])('rejects invalid/sign-changing input %s', input => expect(() => parseMoney(input)).toThrow());
  test('explicit credit corrections may use a negative amount', () => expect(parseMoney('-5.25', true)).toBe(-5.25));
  test('change is calculated in cents', () => expect(moneyDifference(200000.75, 160000.50)).toBe(40000.25));
});
