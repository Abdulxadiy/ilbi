import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ReceiptScreen } from '../src/features/receipts/ReceiptScreen';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request, assertAuthScope } from '../src/api/client';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getReceiptSnapshot } from '../src/navigation/useAppNavigation';
import { receiptView } from '../src/features/receipts/receiptModel';
let mockParams: any = { saleId: '1' };
jest.mock('expo-router', () => ({ useFocusEffect: (callback: () => void) => jest.requireActual('react').useEffect(callback, [callback]), useLocalSearchParams: () => mockParams }));
jest.mock('../src/navigation/useAppNavigation', () => ({ useAppNavigation: () => ({ goBack: jest.fn() }), getReceiptSnapshot: jest.fn(() => null) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: () => ({ server: 'https://ilbi.uz/api/v1' }), assertAuthScope: jest.fn() }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(async () => ({ uri: 'file:///one.pdf' })), printAsync: jest.fn(async () => {}) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
const sale = (id: number, payment_type = 'cash') => ({ id, receipt_number: 'R&' + id, currency: 'UZS', status: 'completed', total_amount: '100.00', refunded_amount: '0.00', net_amount: '100.00', payment_type, created_at: '2026-10-28T09:00:00+05:00', items: [{ id: id * 10, product_name: 'Item ' + id, quantity: '1.000', voided_quantity: '0.000', unit_price: '100.00', total_price: '100.00' }] });
describe('Receipt identity and payment display', () => {
  beforeEach(() => { jest.clearAllMocks(); jest.mocked(request).mockReset(); jest.mocked(getReceiptSnapshot).mockReturnValue(null); mockParams = { saleId: '1' }; jest.mocked(Print.printToFileAsync).mockResolvedValue({ uri: 'file:///one.pdf', numberOfPages: 1 }); });
  test.each([undefined, 'abc', '0', ['1', '2']])('missing or invalid ID %j shows an actionable error', async saleId => {
    mockParams = { saleId };
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    expect(screen.getByText('Chek raqami noto‘g‘ri yoki ko‘rsatilmagan.')).toBeTruthy();
    expect(screen.getByText('Orqaga')).toBeTruthy(); expect(request).not.toHaveBeenCalled();
  });
  test('request failure offers retry and renders the exact native header string', async () => {
    jest.mocked(request).mockRejectedValueOnce(Error('Offline')).mockResolvedValue(sale(1));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await fireEvent.press(await screen.findByText('Chekni qayta yuklash'));
    expect(await screen.findByText('Chek #R&1')).toBeTruthy();
  });
  test.each(['card', 'debt'])('%s receipts never label payment as cash or show change', async method => {
    jest.mocked(request).mockResolvedValue(sale(1, method));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    expect(await screen.findByText(method === 'card' ? 'Karta:' : 'Nasiya:')).toBeTruthy();
    expect(screen.queryByText('Naqd:')).toBeNull(); expect(screen.queryByText('Qaytim:')).toBeNull();
  });
  test('USD historical receipts retain currency and returned/tax status in screen and PDF', async () => {
    jest.mocked(request).mockResolvedValue({ ...sale(1, 'card'), currency: 'USD', status: 'partially_voided', tax_amount: '10.00', refunded_amount: '20.00', net_amount: '80.00' });
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    expect(await screen.findByText('Qisman qaytarilgan')).toBeTruthy();
    expect(screen.getByText('QQS:')).toBeTruthy();
    expect(screen.getByText('Qaytarilgan:')).toBeTruthy();
    expect(screen.getByText('Qolgan summa:')).toBeTruthy();
    expect(screen.getAllByText('100 USD').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('PDF tayyorlash'));
    const html = jest.mocked(Print.printToFileAsync).mock.calls[0][0]?.html || '';
    expect(html).toContain('USD'); expect(html).not.toContain("so'm"); expect(html).toContain('Qisman qaytarilgan'); expect(html).toContain('Qaytarilgan:');
  });
  test('changing sale ID resets PDF state and ignores old in-flight receipt data', async () => {
    jest.mocked(request).mockResolvedValue(sale(1));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&1');
    // PDF is a mocked adapter; this test checks identity/reset, not native file generation.
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('PDF tayyorlash'));
    expect(screen.getByText('PDF tayyor')).toBeTruthy();
    expect(jest.mocked(Print.printToFileAsync).mock.calls[0][0]?.html).toContain('R&amp;1');
    mockParams = { saleId: '2' };
    jest.mocked(request).mockResolvedValue(sale(2));
    await screen.rerender(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    expect(await screen.findByText('Chek #R&2')).toBeTruthy();
    expect(screen.queryByText('Item 1')).toBeNull();
    expect(screen.queryByText('PDF tayyor')).toBeNull();
    expect(Print.printToFileAsync).toHaveBeenCalledTimes(1);
  });
  test('saved receipt identity/layout wins over renamed current store and all PDF fields are escaped', async () => {
    const snapshot = { version: 1, store_name: 'Saved <store>', store_address: 'Old <street>', store_code: 'OLD1', seller_name: 'Original seller', seller_tax_identifier: '123456789', receipt_header: 'Hello <buyer>', receipt_footer: 'Keep <script>alert(1)</script>', receipt_phone: '+998901234567', receipt_paper_width: '80mm', receipt_show_customer: false, receipt_show_cashier: false, receipt_show_item_tax: true };
    jest.mocked(request).mockResolvedValue({ ...sale(1), tenant_name: 'Renamed current store', receipt_snapshot: snapshot, sold_by_name: 'Hidden cashier', counterparty_name: 'Hidden customer', total_amount: '112.00', net_amount: '112.00', tax_amount: '12.00', items: [{ ...sale(1).items[0], product_name: 'Item <one>', quantity: '1.000', unit: 'dona', unit_price: '100.00', total_price: '112.00', tax_amount: '12.00', tax_rate: '12.00' }] });
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    expect(await screen.findByText('Saved <store>')).toBeTruthy();
    expect(screen.getByText('Old <street>')).toBeTruthy();
    expect(screen.getByText('Keep <script>alert(1)</script>')).toBeTruthy();
    expect(screen.getByLabelText('Saqlangan chek: 80mm')).toBeTruthy();
    expect(screen.queryByText('Renamed current store')).toBeNull();
    expect(screen.queryByText(/Hidden cashier|Hidden customer/)).toBeNull();
    expect(screen.getByText('112')).toBeTruthy(); // Authoritative line total includes server VAT.
    expect(screen.getByText('QQS 12%: 12 so‘m')).toBeTruthy();
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('PDF tayyorlash'));
    const options = jest.mocked(Print.printToFileAsync).mock.calls[0][0]!;
    expect(options.width).toBe(227);
    expect(options.html).toContain('size: 80mm auto');
    expect(options.html).toContain('Saved &lt;store&gt;');
    expect(options.html).toContain('Keep &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(options.html).toContain('Item &lt;one&gt;');
    expect(options.html).not.toContain('<script>');
    expect(options.html).not.toContain('Hidden cashier'); expect(options.html).not.toContain('Hidden customer');
    expect(options.html).not.toContain('Renamed current store');
    expect(request).toHaveBeenCalledTimes(2); // Both requests are the selected saved sale, never today's settings.
    expect(jest.mocked(request).mock.calls.every(([path]) => path === '/sales/1/')).toBe(true);
  });
  test('saved visibility flags also hide item tax in screen and print; totals remain server values', async () => {
    jest.mocked(request).mockResolvedValue({ ...sale(1), total_amount: '112.00', net_amount: '112.00', receipt_snapshot: { version: 1, store_name: 'Saved store', receipt_paper_width: '58mm', receipt_show_cashier: true, receipt_show_customer: true, receipt_show_item_tax: false }, sold_by_name: 'Saved cashier', counterparty_name: 'Saved customer', items: [{ ...sale(1).items[0], product_name: 'VAT item', quantity: '1.000', unit_price: '100.00', total_price: '112.00', tax_amount: '12.00', tax_rate: '12.00' }] });
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    expect(await screen.findByText('Sotuvchi: Saved cashier')).toBeTruthy();
    expect(screen.getByText('Mijoz: Saved customer')).toBeTruthy();
    expect(screen.queryByText('QQS 12%: 12 so‘m')).toBeNull();
    await fireEvent.press(screen.getByText('Chop etish'));
    const options = jest.mocked(Print.printAsync).mock.calls[0][0]!;
    expect(options.width).toBe(165);
    expect(options.html).toContain('Saved cashier'); expect(options.html).not.toContain('QQS 12%:');
  });
  test('missing historical line totals are never reconstructed from price and quantity', () => {
    const view = receiptView({ ...sale(1), items: [{ product_name: 'Fractional taxed line', quantity: '1.250', unit_price: '100.00' }] });
    expect(view.items[0].lineTotal).toBe('—');
    expect(view.items[0].unitPrice).toBe('100');
  });
  test('late response for previous ID cannot replace the new receipt', async () => {
    let finish!: (v: any) => void;
    jest.mocked(request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue(sale(2));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    mockParams = { saleId: '2' }; await screen.rerender(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await act(async () => { finish(sale(1)); });
    expect(await screen.findByText('Chek #R&2')).toBeTruthy(); expect(screen.queryByText('Item 1')).toBeNull();
  });
  test('a cached list snapshot cannot bypass authoritative detail loading', async () => {
    jest.mocked(getReceiptSnapshot).mockReturnValue({ ...sale(1), receipt_number: 'STALE', status: 'completed' });
    let finish!: (v: any) => void;
    jest.mocked(request).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    expect(request).toHaveBeenCalledWith('/sales/1/', expect.anything());
    expect(screen.queryByText('Chek #STALE')).toBeNull();
    expect(Print.printToFileAsync).not.toHaveBeenCalled();
    await act(async () => finish({ ...sale(1), status: 'partially_voided', refunded_amount: '20.00', net_amount: '80.00' }));
    expect(await screen.findByText('Qisman qaytarilgan')).toBeTruthy();
  });
  test('export rechecks the saved sale and never prints stale totals after a return', async () => {
    jest.mocked(request).mockResolvedValueOnce(sale(1)).mockResolvedValueOnce({ ...sale(1), status: 'partially_voided', refunded_amount: '20.00', net_amount: '80.00' });
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&1');
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('PDF tayyorlash'));
    expect(request).toHaveBeenCalledTimes(2);
    const html = jest.mocked(Print.printToFileAsync).mock.calls[0][0]?.html || '';
    expect(html).toContain('Qisman qaytarilgan'); expect(html).toContain('80');
  });
  test('a failed authoritative recheck blocks PDF and retains a retry', async () => {
    jest.mocked(request).mockResolvedValueOnce(sale(1)).mockRejectedValueOnce(Error('Offline'));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&1');
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('PDF tayyorlash'));
    expect(Print.printToFileAsync).not.toHaveBeenCalled();
    expect(await screen.findByText('Offline')).toBeTruthy();
  });

  test('A4 selection changes the actual print dimensions and uses saved sale rows', async () => {
    jest.mocked(request).mockResolvedValue(sale(1, 'debt'));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&1');
    await fireEvent.press(screen.getByText('A4 faktura'));
    expect(screen.getByText('Nasiya savdo fakturasi')).toBeTruthy();
    await fireEvent.press(screen.getByText('Chop etish'));
    const options = jest.mocked(Print.printAsync).mock.calls[0][0]!;
    expect(options.width).toBe(595); expect(options.height).toBe(842);
    expect(options.html).toContain('size: A4'); expect(options.html).toContain('Item 1');
    expect(options.html).toContain('hali imzolanmagan');
  });
  test('malformed detail cannot become a displayed/exportable document', async () => {
    jest.mocked(request).mockResolvedValue({ ...sale(1), net_amount: '200.00' });
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    expect(await screen.findByText('Serverning savdo va qaytarish summalari mos kelmadi.')).toBeTruthy();
    expect(screen.queryByText('Ulashish')).toBeNull(); expect(Print.printToFileAsync).not.toHaveBeenCalled();
  });
  test('sharing creates a fresh PDF directly without requiring an earlier temporary file', async () => {
    jest.mocked(request).mockResolvedValue(sale(1));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&1');
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('Ilova orqali ulashish'));
    expect(Print.printToFileAsync).toHaveBeenCalledTimes(1);
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///one.pdf', expect.objectContaining({ mimeType: 'application/pdf' }));
    expect(request).toHaveBeenCalledTimes(2);
  });
  test('duplicate PDF presses during authority lookup cannot create two files', async () => {
    let finish!: (v: any) => void;
    jest.mocked(request).mockResolvedValueOnce(sale(1)).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&1');
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('PDF tayyorlash'));
    await fireEvent.press(screen.getByText('Chop etish'));
    expect(Print.printAsync).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => finish(sale(1)));
    expect(Print.printToFileAsync).toHaveBeenCalledTimes(1);
  });
  test('a late PDF result after navigation never opens or shares a different receipt', async () => {
    let finish!: (v: any) => void;
    jest.mocked(request).mockResolvedValue(sale(1));
    jest.mocked(Print.printToFileAsync).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&1');
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('PDF tayyorlash'));
    mockParams = { saleId: '2' }; jest.mocked(request).mockResolvedValue(sale(2));
    await screen.rerender(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&2');
    await act(async () => finish({ uri: 'file:///old.pdf', numberOfPages: 1 }));
    expect(screen.queryByText('PDF tayyor')).toBeNull(); expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
  test('a session change while creating PDF cannot hand the file to another app', async () => {
    jest.mocked(request).mockResolvedValue(sale(1));
    jest.mocked(Print.printToFileAsync).mockImplementationOnce(async () => {
      jest.mocked(assertAuthScope).mockImplementationOnce(() => { throw Error('Sessiya o‘zgargan.'); });
      return { uri: 'file:///old.pdf', numberOfPages: 1 };
    });
    const screen = await render(<ThemeProvider><ReceiptScreen /></ThemeProvider>);
    await screen.findByText('Chek #R&1');
    await fireEvent.press(screen.getByText('Ulashish'));
    await fireEvent.press(screen.getByText('Ilova orqali ulashish'));
    expect(await screen.findByText('Sessiya o‘zgargan.')).toBeTruthy();
    expect(Sharing.shareAsync).not.toHaveBeenCalled(); expect(screen.queryByText('PDF tayyor')).toBeNull();
  });

});
