import { taxLine } from '../../domain/tax';
import { quantityMilli, parseQuantity } from '../../domain/quantity';
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isDesignPreview } from '../../dev/preview';
import { useAuth } from '../auth/AuthContext';
import { cartDraftKey, newDraft, readCartDraft, emptyPayment, type PaymentDraft } from './drafts';

export interface CartItem {
  variantId: number;
  productId: number;
  productName: string;
  variantName?: string;
  unit: string;
  defaultPrice: number;
  unitPrice: number; // Customer negotiated price for this sale
  quantity: number;
  barcode?: string;
  imageUrl?: string;
  currency?: 'UZS' | 'USD';
  minimumPrice?: number;
  partnerPrice?: number;
}

export interface SelectedCustomer {
  id: number;
  name: string;
  phoneNumber: string;
  targetTenantId?: number | null;
  targetTenantName?: string;
  debtDueDate?: string | null;
}

interface CartContextType {
  partner: boolean; setPartner: (value: boolean) => void;
  cartId: string; payment: PaymentDraft; setPayment: (patch: Partial<PaymentDraft>) => void;
  ready: boolean;
  saving: boolean;
  persistenceError: string | null;
  retryPersistence: () => void;
  flushDraft: () => Promise<void>;
  items: CartItem[];
  customer: SelectedCustomer | null;
  totalQuantity: number;
  totalTypes: number;
  totalAmount: number;
  addItem: (item: Omit<CartItem, 'quantity' | 'unitPrice'> & { quantity?: number; unitPrice?: number }) => void;
  updateQuantity: (variantId: number, quantity: number) => void;
  updateItemPrice: (variantId: number, newUnitPrice: number) => void;
  removeItem: (variantId: number) => void;
  clearCart: () => void;
  setCustomer: (customer: SelectedCustomer | null) => void;
  loadCanonicalFixture: () => void;
}

const CartContext = createContext<CartContextType>({
  partner: false, setPartner: () => {},
  cartId: '', payment: emptyPayment(), setPayment: () => {},
  ready: false, saving: false, persistenceError: null, retryPersistence: () => {}, flushDraft: async () => {},
  items: [],
  customer: null,
  totalQuantity: 0,
  totalTypes: 0,
  totalAmount: 0,
  addItem: () => {},
  updateQuantity: () => {},
  updateItemPrice: () => {},
  removeItem: () => {},
  clearCart: () => {},
  setCustomer: () => {},
  loadCanonicalFixture: () => {},
});

export const CANONICAL_CART_ITEMS: CartItem[] = [
  { variantId: 1, productId: 1, productName: 'Sut 1 L', unit: '1 L', defaultPrice: 12000, unitPrice: 12000, quantity: 2 },
  { variantId: 2, productId: 2, productName: 'Non', unit: '1 dona', defaultPrice: 4000, unitPrice: 4000, quantity: 3 },
  { variantId: 3, productId: 3, productName: 'Suv 1.5 L', unit: '1.5 L', defaultPrice: 5000, unitPrice: 5000, quantity: 2 },
  { variantId: 4, productId: 4, productName: 'Shakar 1 kg', unit: '1 kg', defaultPrice: 16000, unitPrice: 16000, quantity: 1 },
  { variantId: 5, productId: 5, productName: 'Choy 100 g', unit: '100 g', defaultPrice: 18000, unitPrice: 18000, quantity: 1 },
  { variantId: 6, productId: 6, productName: "Yog' 1 L", unit: '1 L', defaultPrice: 22000, unitPrice: 22000, quantity: 1 },
  { variantId: 7, productId: 7, productName: 'Guruch 1 kg', unit: '1 kg', defaultPrice: 15000, unitPrice: 15000, quantity: 2 },
  { variantId: 8, productId: 8, productName: 'Tuxum (10 dona)', unit: '10 dona', defaultPrice: 18000, unitPrice: 18000, quantity: 1 },
  { variantId: 9, productId: 9, productName: 'Tuz 1 kg', unit: '1 kg', defaultPrice: 3000, unitPrice: 3000, quantity: 1 },
  { variantId: 10, productId: 10, productName: 'Makaron 500 g', unit: '500 g', defaultPrice: 8000, unitPrice: 8000, quantity: 1 },
];

export const CANONICAL_CUSTOMER: SelectedCustomer = {
  id: 1,
  name: 'Ali Valiyev',
  phoneNumber: '+998 90 123 45 67',
};

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, activeTenant } = useAuth();
  const userId = user?.id, tenantId = activeTenant?.id;
  const scope = userId && tenantId ? cartDraftKey(userId, tenantId) : null;
  const [state, setState] = useState<{ scope: string | null; ready: boolean; id: string; partner: boolean; payment: PaymentDraft; items: CartItem[]; customer: SelectedCustomer | null }>({ scope: null, ready: false, id: '', partner: false, payment: emptyPayment(), items: [], customer: null });
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoreVersion, retryRestore] = useState(0);
  const writes = useRef<Promise<void>>(Promise.resolve());
  const currentScope = useRef(scope);
  useLayoutEffect(() => { currentScope.current = scope; }, [scope]);
  const skipInitialWrite = useRef(false);
  useEffect(() => {
    let active = true;
    (async () => {
      await writes.current.catch(() => {});
      try {
        const draft = userId && tenantId ? await readCartDraft(userId, tenantId) : null;
        if (!active) return;
        skipInitialWrite.current = Boolean(draft);
        const identity = draft || newDraft(userId || 1, tenantId || 1);
        setState({ scope, ready: true, id: identity.id, partner: identity.partner || false, payment: identity.payment,
          items: draft?.items ?? (isDesignPreview ? CANONICAL_CART_ITEMS.map(i => ({ ...i })) : []),
          customer: draft?.customer ?? (isDesignPreview ? { ...CANONICAL_CUSTOMER } : null),
        });
        setPersistenceError(null);
      } catch (error: any) {
        if (active) {
          setState({ scope, ready: false, id: '', partner: false, payment: emptyPayment(), items: [], customer: null });
          setPersistenceError(error.message || 'Savat qoralamasi yuklanmadi. Qayta urinib ko‘ring.');
        }
      }
    })();
    return () => { active = false; };
  }, [scope, userId, tenantId, restoreVersion]);

  useEffect(() => {
    if (!scope || !userId || !tenantId || state.scope !== scope || !state.ready) return;
    if (skipInitialWrite.current) { skipInitialWrite.current = false; return; }
    const snapshot = JSON.stringify(newDraft(userId, tenantId, state.items, state.customer, { id: state.id, payment: state.payment, partner: state.partner }));
    const pending = writes.current.catch(() => {}).then(async () => {
      setSaving(true);
      try {
        await AsyncStorage.setItem(scope, snapshot);
        if (currentScope.current === scope) setPersistenceError(null);
      } catch (error: any) {
        if (currentScope.current === scope) setPersistenceError(error.message || 'Qoralama saqlanmadi.');
        throw error;
      } finally { if (currentScope.current === scope) setSaving(false); }
    });
    writes.current = pending;
    void pending.catch(() => {});
  }, [scope, state, userId, tenantId]);

  const ready = state.scope === scope && state.ready;
  const current = ready ? state : { items: [], customer: null };
  const items = current.items, customer = current.customer;
  const mutate = (update: (previous: typeof state) => typeof state) => {
    if (!ready) throw Error('Savat yuklanishini kuting yoki qoralamani qayta tiklang.');
    setState(previous => previous.scope === scope && previous.ready ? update(previous) : previous);
  };
  const retryPersistence = () => {
    if (!ready) retryRestore(value => value + 1);
    else setState(previous => ({ ...previous }));
  };
  const flushDraft = async () => { await writes.current; };

  const removeItem = (variantId: number) => mutate(previous => ({ ...previous, items: previous.items.filter(i => i.variantId !== variantId) }));
  const addItem: CartContextType['addItem'] = item => {
    if (item.currency === 'USD') throw Error('USD tovar POS savdosiga qo‘shilmaydi.');
    const quantity = parseQuantity(item.quantity ?? 1), unitPrice = item.unitPrice ?? (state.partner ? item.partnerPrice : item.defaultPrice) ?? 0;
    if (state.partner && !item.partnerPrice) throw Error('Tovarga ulgurji narx belgilanmagan.');
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0) return;
    mutate(previous => ({ ...previous, items: previous.items.some(i => i.variantId === item.variantId)
      ? previous.items.map(i => i.variantId === item.variantId ? { ...i, quantity: Number(quantityMilli(i.quantity) + quantityMilli(quantity)) / 1000 } : i)
      : [...previous.items, { ...item, quantity, unitPrice }] }));
  };
  const updateQuantity = (variantId: number, quantity: number) => {
    if (!Number.isFinite(quantity)) return;
    if (quantity <= 0) { removeItem(variantId); return; }
    quantity = parseQuantity(quantity);
    mutate(previous => ({ ...previous, items: previous.items.map(i => i.variantId === variantId ? { ...i, quantity } : i) }));
  };
  const updateItemPrice = (variantId: number, unitPrice: number) => {
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) return;
    mutate(previous => ({ ...previous, items: previous.items.map(i => i.variantId === variantId ? { ...i, unitPrice } : i) }));
  };
  const clearCart = () => { const fresh = newDraft(userId || 1, tenantId || 1); mutate(previous => ({ ...previous, id: fresh.id, partner: false, payment: fresh.payment, items: [], customer: null })); };
  const setPayment = (patch: Partial<PaymentDraft>) => mutate(previous => ({ ...previous, payment: { ...previous.payment, ...patch } }));
  const setCustomer = (value: SelectedCustomer | null) => mutate(previous => ({ ...previous, customer: value, payment: { ...previous.payment, dueDate: previous.customer?.id === value?.id ? previous.payment.dueDate : value?.debtDueDate || '' } }));
  const loadCanonicalFixture = () => {
    if (!isDesignPreview && process.env.NODE_ENV !== 'test') return;
    mutate(previous => ({ ...previous, items: CANONICAL_CART_ITEMS.map(i => ({ ...i })), customer: { ...CANONICAL_CUSTOMER } }));
  };
  const setPartner = (partner: boolean) => {
    if (partner && items.some(item => !item.partnerPrice || item.partnerPrice <= 0)) throw Error('Ulgurji narxi yetishmayotgan tovarni katalogdan yangilab qo‘shing.');
    mutate(previous => ({ ...previous, partner, items: previous.items.map(item => ({ ...item,
      unitPrice: item.unitPrice === item.defaultPrice || item.unitPrice === item.partnerPrice ? (partner ? item.partnerPrice! : item.defaultPrice) : item.unitPrice,
    })) }));
  };
  const totalQuantity = Number(items.reduce((sum, item) => sum + quantityMilli(item.quantity), 0n)) / 1000;
  const totalAmount = Number(items.reduce((sum, item) => sum + taxLine(item.quantity, item.unitPrice, { is_vat_payer: false, vat_rate: '0.00', price_includes_vat: true }).totalMinor, 0n)) / 100;
  return <CartContext.Provider value={{ partner: ready ? state.partner : false, setPartner, cartId: state.scope === scope ? state.id : '', payment: ready ? state.payment : emptyPayment(), setPayment, ready, saving, persistenceError, retryPersistence, flushDraft, items, customer, totalQuantity, totalTypes: items.length, totalAmount, addItem, updateQuantity, updateItemPrice, removeItem, clearCart, setCustomer, loadCanonicalFixture }}>{children}</CartContext.Provider>;
};

export const useCart = () => useContext(CartContext);
