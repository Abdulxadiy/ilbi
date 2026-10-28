/** Explicit synthetic B2B service for the opt-in design preview. Never a live API fallback. */
export function createPreviewB2B(userId: number, tenantId: number) {
  const line = (id: number) => ({ id, product_name: 'Demo guruch', product_variant_name: 'Standart', unit: 'kg', quantity: '5.000', unit_price: '200.00', b2b_accepted_quantity: '0.000', voided_quantity: '0.000', b2b_rejected_quantity: '0.000', b2b_return_pending_quantity: '0.000', b2b_discrepancy_closed_quantity: '0.000' });
  const make = (id: number, direction: 'incoming' | 'outgoing') => ({ id, receipt_number: 'DEMO-B2B-' + id, status: direction === 'incoming' ? 'b2b_pending' : 'b2b_return_pending', currency: 'UZS', source_tenant_name: 'Demo hamkor', b2b_target_tenant_name: 'Demo hamkor', total_amount: '1000.00', refunded_amount: '0.00', net_amount: '1000.00', b2b_expires_at: null, items: [{ ...line(id * 10), ...(direction === 'outgoing' ? { b2b_return_pending_quantity: '5.000' } : {}) }], _preview: true });
  const records = new Map([[6101, { direction: 'incoming' as const, sale: make(6101, 'incoming') }], [6201, { direction: 'outgoing' as const, sale: make(6201, 'outgoing') }]]);
  const receipts = new Map<string, { fingerprint: string; result: any }>();
  const copy = (value: any) => JSON.parse(JSON.stringify(value));
  const pending = (item: any) => Number(item.quantity) - ['b2b_accepted_quantity', 'voided_quantity', 'b2b_rejected_quantity', 'b2b_return_pending_quantity', 'b2b_discrepancy_closed_quantity'].reduce((sum, key) => sum + Number(item[key]), 0);
  return (url: URL, method: string, body: any) => {
    const path = url.pathname;
    if (!path.startsWith('/sales/b2b/')) return { handled: false, data: null };
    let data: any;
    if (method === 'GET' && path === '/sales/b2b/capabilities/') data = { b2b_mutations: 1, operations: ['accept', 'reject', 'receive', 'close_discrepancy'] };
    else if (method === 'GET' && path.startsWith('/sales/b2b/mapping/')) data = { results: path.includes('/categories/') ? [{ id: 21, name: 'Demo oziq-ovqat', currency: 'UZS' }] : [{ id: 31, name: 'Demo mavjud guruch', currency: 'UZS', unit: 'kg' }], count: 1, next: null };
    else if (method === 'GET' && ['/sales/b2b/inbox/', '/sales/b2b/outgoing/'].includes(path)) {
      const direction = path.includes('/inbox/') ? 'incoming' : 'outgoing', search = (url.searchParams.get('search') || '').toLowerCase(), status = url.searchParams.get('status');
      const rows = [...records.values()].filter(row => row.direction === direction && (!status || row.sale.status === status) && (!search || [row.sale.receipt_number, row.sale.source_tenant_name, row.sale.b2b_target_tenant_name].join(' ').toLowerCase().includes(search))).map(row => copy(row.sale));
      data = { results: rows, count: rows.length, next: null };
    } else {
      const match = /^\/sales\/b2b\/(\d+)\/(accept\/|reject\/|returns\/receive\/|returns\/close-discrepancy\/)?$/.exec(path);
      const record = match && records.get(Number(match[1]));
      if (!record) throw Error('Demo B2B hujjati topilmadi.');
      if (method === 'GET' && !match![2]) data = copy(record);
      else if (method === 'POST' && match![2]) {
        const key = body.operation_id;
        if (!key) throw Error('Demo B2B amal kaliti kerak.');
        const fingerprint = JSON.stringify({ path, body }), old = receipts.get(key);
        if (old) { if (old.fingerprint !== fingerprint) throw Error('Demo kalit boshqa amal uchun ishlatilgan.'); return { handled: true, data: copy(old.result) }; }
        const kind = match![2] === 'accept/' ? 'accept' : match![2] === 'reject/' ? 'reject' : match![2] === 'returns/receive/' ? 'receive' : 'close_discrepancy';
        if (['accept', 'reject'].includes(kind) && (record.direction !== 'incoming' || !['b2b_pending', 'b2b_partially_accepted'].includes(record.sale.status))) throw Error('Demo kiruvchi B2B ochiq emas.');
        if (['receive', 'close_discrepancy'].includes(kind) && (record.direction !== 'outgoing' || record.sale.status !== 'b2b_return_pending')) throw Error('Demo qaytish kutilmayapti.');
        if (kind !== 'accept' && !String(body.reason || '').trim()) throw Error('Demo amal sababi kerak.');
        const next = copy(record.sale);
        if (kind === 'reject') for (const item of next.items) item.b2b_return_pending_quantity = String(Number(item.b2b_return_pending_quantity) + pending(item));
        else for (const submitted of body.items || []) {
          const item = next.items.find((row: any) => row.id === submitted.sale_item_id), quantity = Number(submitted[kind === 'accept' ? 'accepted_quantity' : 'quantity']);
          if (!item || !Number.isFinite(quantity) || quantity <= 0 || quantity > (kind === 'accept' ? pending(item) : Number(item.b2b_return_pending_quantity))) throw Error('Demo B2B miqdori noto‘g‘ri.');
          if (kind === 'accept') item.b2b_accepted_quantity = String(Number(item.b2b_accepted_quantity) + quantity);
          else { item.b2b_return_pending_quantity = String(Number(item.b2b_return_pending_quantity) - quantity); const field = kind === 'receive' ? 'b2b_rejected_quantity' : 'b2b_discrepancy_closed_quantity'; item[field] = String(Number(item[field]) + quantity); next.refunded_amount = String(Number(next.refunded_amount) + quantity * Number(item.unit_price)); }
        }
        next.net_amount = String(Number(next.total_amount) - Number(next.refunded_amount));
        next.status = next.items.some((row: any) => Number(row.b2b_return_pending_quantity) > 0) ? 'b2b_return_pending' : next.items.every((row: any) => Number(row.b2b_accepted_quantity) === Number(row.quantity)) ? 'b2b_accepted' : next.items.some((row: any) => Number(row.b2b_accepted_quantity) > 0) ? 'b2b_partially_accepted' : 'b2b_rejected';
        record.sale = next;
        const resourceId = ['accept', 'reject'].includes(kind) ? null : 7000 + receipts.size;
        data = { ...(['accept', 'reject'].includes(kind) ? copy(next) : { [kind === 'receive' ? 'receipt_id' : 'closure_id']: resourceId, sale: copy(next) }), b2b_operation: { operation_id: key, kind, actor_id: userId, tenant_id: tenantId, sale_id: next.id, resource_id: resourceId }, _preview: true };
        receipts.set(key, { fingerprint, result: copy(data) });
      } else throw Error('Demo B2B yo‘li qo‘llanmaydi.');
    }
    return { handled: true, data };
  };
}
