const text = value => typeof value === 'string' ? value : '';
/** Explicit legacy fallback; never replace known saved blanks with today's account/store. */
export function savedReceiptIdentity(sale, legacy = {}) {
  const snapshot = sale?.receipt_snapshot;
  const savedStore = Boolean(snapshot && typeof snapshot === 'object' && snapshot.version === 1);
  const parties = snapshot?.document_parties;
  const savedParties = Boolean(parties && typeof parties === 'object' && parties.version === 1);
  return {
    savedStore, savedParties,
    store: savedStore ? text(snapshot.store_name) : text(sale?.tenant_name) || text(legacy.store),
    phone: savedStore ? text(snapshot.receipt_phone) : text(sale?.tenant_phone) || text(legacy.phone),
    cashier: savedParties ? text(parties.cashier_name) : text(sale?.sold_by_name) || text(legacy.cashier),
    customer: savedParties ? text(parties.customer_name) : text(sale?.counterparty_name) || text(sale?.counterparty?.name),
    customerPhone: savedParties ? text(parties.customer_phone) : text(sale?.counterparty_phone),
    recipient: savedParties ? text(parties.recipient_store_name) : text(sale?.b2b_target_tenant_name),
    legacyMessage: savedParties ? '' : 'Eski hujjat: mijoz va kassirning sotuv paytidagi ma’lumotlari saqlanmagan; joriy ma’lumot ko‘rsatilgan.',
  };
}
