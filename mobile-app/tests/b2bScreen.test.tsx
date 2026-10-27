import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { B2BScreen } from '../src/features/b2b/B2BScreen';
import { B2BActionSheet } from '../src/features/b2b/B2BActionSheet';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { request } from '../src/api/client';
import { confirmFinancialIdentity, withFinancialIdentity } from '../src/api/financialIdentity';
import { parseB2BSale } from '../src/features/b2b/model';
const mockTenant = { id: 1, name: 'A', is_owner: true, permissions: [] };
const mockUser = { id: 1, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/api/client', () => ({ request: jest.fn(), captureAuthScope: jest.fn(() => ({})), assertAuthScope: jest.fn() }));
jest.mock('../src/api/financialIdentity', () => ({ withFinancialIdentity: jest.fn(async (_operation, payload) => ({ ...payload, idempotency_key: 'original-key' })), getFinancialIntent: jest.fn(async () => null), confirmFinancialIdentity: jest.fn(async () => {}), rejectFinancialIdentity: jest.fn(async () => {}) }));
const sale = { id: 10, receipt_number: 'B10', status: 'b2b_pending', currency: 'UZS', source_tenant_name: 'Source', b2b_target_tenant_name: 'Destination', total_amount: '1000.00', refunded_amount: '0.00', net_amount: '1000.00', items: [{ id: 51, product_name: 'Rice', product_variant_name: 'Standard', quantity: '5.000', unit: 'kg', unit_price: '200.00', b2b_accepted_quantity: '0.000', voided_quantity: '0.000', b2b_rejected_quantity: '0.000', b2b_return_pending_quantity: '0.000', b2b_discrepancy_closed_quantity: '0.000' }] };
describe('Real B2B screen and safe action forms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(confirmFinancialIdentity).mockReset().mockResolvedValue(undefined);
    jest.mocked(request).mockImplementation(async (path, options) => {
      if (path === '/sales/b2b/capabilities/') return { b2b_mutations: 1, operations: ['accept', 'reject', 'receive', 'close_discrepancy'] };
      if (path.includes('/mapping/categories/')) return { results: [{ id: 2, name: 'Grocery', currency: 'UZS' }], count: 1, next: null };
      if (path.includes('/mapping/variants/')) return { results: [], count: 0, next: null };
      if (options?.method === 'POST') return { ...sale, status: 'b2b_partially_accepted', b2b_operation: { operation_id: options.body.operation_id, kind: path.includes('reject') ? 'reject' : 'accept', actor_id: 1, tenant_id: 1, sale_id: 10, resource_id: null } };
      if (path === '/sales/b2b/10/') return { direction: 'incoming', sale };
      return { results: [sale], count: 1, next: null };
    });
  });
  test('incoming/outgoing lists load real scoped endpoints and saved detail', async () => {
    const screen = await render(<ThemeProvider><B2BScreen /></ThemeProvider>);
    await screen.findByText('#B10');
    expect(jest.mocked(request).mock.calls.some(([path]) => path.startsWith('/sales/b2b/inbox/?') && path.includes('all_statuses=true'))).toBe(true);
    await fireEvent.press(screen.getByLabelText('Hujjatni ochish: B10'));
    await screen.findByText('Rice · Standard');
    expect(request).toHaveBeenCalledWith('/sales/b2b/10/', expect.anything());
    await fireEvent.press(screen.getByLabelText('B2B hujjatini yopish'));
    await fireEvent.press(screen.getByLabelText('Yo‘nalish: Chiquvchi'));
    await waitFor(() => expect(jest.mocked(request).mock.calls.some(([path]) => path.startsWith('/sales/b2b/outgoing/?'))).toBe(true));
  });
  test('invalid acceptance quantity and absent destination mapping turn exact controls red', async () => {
    const screen = await render(<ThemeProvider><B2BActionSheet sale={parseB2BSale(sale)} kind="accept" onClose={jest.fn()} onDone={jest.fn()} /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Miqdor: Rice'), '8');
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    await screen.findByText(/Miqdor mavjud qoldiqdan oshmasin/);
    expect(screen.getByLabelText('Miqdor: Rice').props['aria-invalid']).toBe(true);
    expect(withFinancialIdentity).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Miqdor: Rice'), '1.250');
    expect(screen.getByLabelText('Miqdor: Rice').props['aria-invalid']).toBe(false);
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    await screen.findByText('Mavjud tovar yoki yangi tovar uchun kategoriya tanlang.');
    expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
  test('category mapping sends selected destination and local-ack retry never re-posts acceptance', async () => {
    const done = jest.fn();
    jest.mocked(confirmFinancialIdentity).mockRejectedValueOnce(Error('Disk unavailable'));
    const screen = await render(<ThemeProvider><B2BActionSheet sale={parseB2BSale(sale)} kind="accept" onClose={jest.fn()} onDone={done} /></ThemeProvider>);
    await fireEvent.changeText(screen.getByLabelText('Miqdor: Rice'), '1.250');
    await fireEvent.press(screen.getByText('Yangi tovar kategoriyasi: Rice: Tanlang'));
    await fireEvent.press(await screen.findByLabelText('Grocery'));
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    await screen.findByText('Disk unavailable');
    expect(request).toHaveBeenCalledWith('/sales/b2b/10/accept/', { method: 'POST', body: { operation_id: 'original-key', items: [{ sale_item_id: 51, accepted_quantity: '1.250', target_category_id: 2 }] } });
    await fireEvent.press(screen.getByText('Mahalliy tasdiqni saqlash'));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(jest.mocked(request).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  });
  test('reject requires a visible reason and explains physical return before sending', async () => {
    const screen = await render(<ThemeProvider><B2BActionSheet sale={parseB2BSale(sale)} kind="reject" onClose={jest.fn()} onDone={jest.fn()} /></ThemeProvider>);
    expect(screen.getByText(/jo‘natuvchi omboriga tovarni avtomatik qaytarmaydi/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Amalni tasdiqlash'));
    await screen.findByText('Amal sababini kiriting.');
    expect(screen.getByLabelText('Amal sababi').props['aria-invalid']).toBe(true);
    expect(withFinancialIdentity).not.toHaveBeenCalled();
  });
});
