import { parseQuantity, formatQuantity } from '../src/domain/quantity';
describe('Fractional stock quantity', () => {
  test.each([['0,125', 0.125], ['1.001', 1.001], ['12', 12]])('parses %s as %d', (input, output) => expect(parseQuantity(input)).toBe(output));
  test.each(['0', '-1', '1.0001', 'NaN', '1e3', '2..1'])('rejects %s', value => expect(() => parseQuantity(value)).toThrow());
  test('retains all three decimal places in display', () => expect(formatQuantity(0.125)).toBe('0,125'));
});
