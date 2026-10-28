import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '../src/theme/ThemeContext';
import { DebtAdjustmentSheet } from '../src/features/debts/DebtAdjustmentSheet';
import { acknowledgeAdjustment, fetchAdjustmentQuote, submitAdjustment, type AcceptedAdjustment } from '../src/features/debts/adjustments';
import { PendingOperationError } from '../src/api/financialIdentity';
import { formError } from '../src/api/validation';
import { parseCustomer } from '../src/features/customers/model';
import contract from './contracts/debt-adjustments.json';
import customers from './contracts/customers.json';
const mockTenant = { id: contract.tenant, name: 'Source', is_owner: true, permissions: [] };
const mockUser = { id: contract.actor, role: 'owner', terms_accepted: true, tenants: [mockTenant] };
const customer = parseCustomer({ ...customers.customer, id: contract.customer, debt_balance_uzs: '100.00', debt_balance_usd: '-10.00' });
const mockNavigate = jest.fn(), mockClose = jest.fn(), mockDone = jest.fn();
const mockPresses: Record<string, () => Promise<void>> = {};
jest.mock('../src/components/ui/Button', () => ({ Button: (props: any) => {
  mockPresses[props.title] = props.onPress;
  return jest.requireActual('react').createElement(jest.requireActual('../src/components/ui/Button').Button, props);
} }));
jest.mock('../src/features/auth/AuthContext', () => ({ useAuth: () => ({ user: mockUser, activeTenant: mockTenant }) }));
jest.mock('../src/navigation/useAppNavigation', () => ({ useAppNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('../src/features/debts/adjustments', () => ({ fetchAdjustmentQuote: jest.fn(), submitAdjustment: jest.fn(), acknowledgeAdjustment: jest.fn() }));
const show = (kind: 'credit_refund' | 'correction' = 'credit_refund') => render(<ThemeProvider><DebtAdjustmentSheet customer={customer} kind={kind} onClose={mockClose} onDone={mockDone} /></ThemeProvider>);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchAdjustmentQuote).mockImplementation(async (_id, body) => ({ ...contract.quote, ...body, protocol: 'ilbi-debt-adjustment-quote-v1', expected_quote: contract.quote.expected_quote }));
  jest.mocked(submitAdjustment).mockResolvedValue(contract.result as any);
  jest.mocked(acknowledgeAdjustment).mockResolvedValue(contract.result as any);
});
test('refund defaults to credited USD, shows actual balance quote before confirmation, never renders opaque nonce', async () => {
  const screen = await show();
  expect(screen.getByLabelText('Qaytariladigan summa').props.value).toBe('10');
  await fireEvent.changeText(screen.getByLabelText('Qaytariladigan summa'), '3');
  await fireEvent.changeText(screen.getByLabelText('Tuzatish sababi'), contract.payload.note);
  await fireEvent.press(screen.getByText('Tuzatishni hisoblash'));
  expect(fetchAdjustmentQuote).toHaveBeenCalledWith(customer.id, { ...contract.payload, branch_id: mockTenant.id }, mockUser, mockTenant);
  expect(submitAdjustment).not.toHaveBeenCalled();
  expect(screen.getByText('Yangi balans: 100 UZS / -7 USD')).toBeTruthy();
  expect(screen.queryByText(contract.quote.expected_quote)).toBeNull();
  const confirm = mockPresses['Tuzatishni tasdiqlash'];
  await act(async () => { await confirm(); await confirm(); });
  expect(submitAdjustment).toHaveBeenCalledTimes(1); expect(mockDone).toHaveBeenCalledTimes(1);
  expect(jest.mocked(submitAdjustment).mock.calls[0][1]).toEqual({ ...contract.payload, branch_id: mockTenant.id, expected_quote: contract.quote.expected_quote });
});
test('signed correction requires amount and reason; edits invalidate a calculated quote', async () => {
  const screen = await show('correction');
  await fireEvent.press(screen.getByText('Tuzatishni hisoblash'));
  expect(screen.getByLabelText('Tuzatish summasi').props['aria-invalid']).toBe(true);
  expect(screen.getByLabelText('Tuzatish sababi').props['aria-invalid']).toBe(true);
  expect(fetchAdjustmentQuote).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText('Tuzatish summasi'), '-1,25');
  await fireEvent.changeText(screen.getByLabelText('Tuzatish sababi'), 'Counting correction');
  await fireEvent.press(screen.getByText('Tuzatishni hisoblash'));
  expect(jest.mocked(fetchAdjustmentQuote).mock.calls[0][1]).toEqual({ kind: 'correction', amount: '-1.25', currency: 'UZS', payment_type: 'none', branch_id: mockTenant.id, note: 'Counting correction' });
  await fireEvent.changeText(screen.getByLabelText('Tuzatish summasi'), '-2');
  expect(screen.queryByText('Tuzatishni tasdiqlash')).toBeNull();
  expect(screen.getByText('Tuzatishni hisoblash')).toBeTruthy(); expect(submitAdjustment).not.toHaveBeenCalled();
});
test('server field error marks amount red and never continues to a commit', async () => {
  jest.mocked(fetchAdjustmentQuote).mockRejectedValue(formError({ amount: 'Available credit exceeded' }));
  const screen = await show(); await fireEvent.press(screen.getByText('Tuzatishni hisoblash'));
  expect(screen.getByLabelText('Qaytariladigan summa').props['aria-invalid']).toBe(true);
  expect(screen.getByText('Available credit exceeded')).toBeTruthy(); expect(submitAdjustment).not.toHaveBeenCalled();
});
test('unknown commit freezes fields, blocks concurrent presses and reuses the original body', async () => {
  let finish!: () => void;
  jest.mocked(submitAdjustment).mockImplementationOnce(async (_operation, body, _user, _tenant, _accepted, recorded) => {
    recorded?.(true, body); await new Promise<void>(resolve => { finish = resolve; }); throw Error('Network disconnected');
  });
  const screen = await show(); await fireEvent.press(screen.getByText('Tuzatishni hisoblash'));
  const confirm = mockPresses['Tuzatishni tasdiqlash'];
  let pending!: Promise<void>;
  await act(async () => { pending = confirm(); });
  await act(async () => { await confirm(); });
  expect(submitAdjustment).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); await pending; });
  expect(screen.getByLabelText('Qaytariladigan summa').props.editable).toBe(false);
  const first = jest.mocked(submitAdjustment).mock.calls[0];
  await fireEvent.changeText(screen.getByLabelText('Qaytariladigan summa'), '99');
  await fireEvent.press(screen.getByText('Amal natijasini qayta tekshirish'));
  expect(jest.mocked(submitAdjustment).mock.calls[1].slice(0, 4)).toEqual(first.slice(0, 4));
  expect(fetchAdjustmentQuote).toHaveBeenCalledTimes(1); expect(mockDone).toHaveBeenCalledTimes(1);
});
test('accepted server write with local acknowledgement failure retries storage only', async () => {
  const accepted = { result: contract.result } as unknown as AcceptedAdjustment;
  jest.mocked(submitAdjustment).mockImplementationOnce(async (_operation, body, _user, _tenant, received, recorded) => {
    recorded?.(true, body); received?.(accepted); throw Error('Storage full');
  });
  const screen = await show(); await fireEvent.press(screen.getByText('Tuzatishni hisoblash')); await fireEvent.press(screen.getByText('Tuzatishni tasdiqlash'));
  expect(screen.queryByLabelText('Qaytariladigan summa')).toBeNull();
  await fireEvent.press(screen.getByText('Tasdiqni telefonga qayta saqlash'));
  expect(acknowledgeAdjustment).toHaveBeenCalledWith(accepted); expect(submitAdjustment).toHaveBeenCalledTimes(1); expect(mockDone).toHaveBeenCalledTimes(1);
});
test('blocked earlier journal offers explicit navigation without recording another command', async () => {
  jest.mocked(submitAdjustment).mockRejectedValueOnce(new PendingOperationError({ operation: 'debt:old' } as any));
  const screen = await show(); await fireEvent.press(screen.getByText('Tuzatishni hisoblash')); await fireEvent.press(screen.getByText('Tuzatishni tasdiqlash'));
  await fireEvent.press(screen.getByText('Amallar jurnalini ochish'));
  expect(mockClose).toHaveBeenCalledTimes(1); expect(mockNavigate).toHaveBeenCalledWith('Sync'); expect(mockDone).not.toHaveBeenCalled();
});
