import IlbiLoader from '../common/IlbiLoader';
import React, { useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowRightLeft, Check, Plus, RotateCcw, Send, Store, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import RemoteVariantSelect from '../common/RemoteVariantSelect';
import { inventoryApi, catalogApi } from '../../api/client';
import CustomSelect from '../common/CustomSelect';

const statusLabels = {
  pending: 'Qabul kutilmoqda',
  delivered: 'Qabul qilindi',
  delivered_owner: 'Yetkazildi',
  discrepancy: 'Tafovut bor',
  closed: 'Tafovut yopildi',
};

function sameCatalogProduct(sourceLine, variant) {
  return String(variant.product_name || '').toLocaleLowerCase() === String(sourceLine.source_product_name || '').toLocaleLowerCase()
    && String(variant.name || variant.variant_name || '').toLocaleLowerCase() === String(sourceLine.source_variant_name || '').toLocaleLowerCase();
}

export default function TenantTransfersPanel({ activeTenant, isOwner, transfers, targets, categories, loading, reload, toast, confirm }) {
  const [variants, setVariants] = useState([]);
  const [destinationId, setDestinationId] = useState('');
  const [draftRows, setDraftRows] = useState([{ source_variant_id: '', quantity: '1', destination_category_id: '' }]);
  const [busyId, setBusyId] = useState(null);
  const requestKey = useRef(null);

  const pendingIncoming = useMemo(() => (transfers || []).filter((transfer) => (
    transfer.status === 'pending' && String(transfer.destination_tenant) === String(activeTenant?.id)
  )), [transfers, activeTenant?.id]);

  const updateDraft = (index, key, value) => setDraftRows((rows) => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const addDraftRow = () => setDraftRows((rows) => [...rows, { source_variant_id: '', quantity: '1', destination_category_id: '' }]);
  const removeDraftRow = (index) => setDraftRows((rows) => (rows.length > 1 ? rows.filter((_, i) => i !== index) : rows));

  const dispatch = async (event) => {
    event.preventDefault();
    if (!destinationId || draftRows.some((row) => !row.source_variant_id || Number(row.quantity) <= 0)) {
      toast.warning('Manzil do‘kon, mahsulot va miqdorni tanlang');
      return;
    }
    const confirmed = await confirm({
      title: 'Transferni tasdiqlash',
      message: isOwner
        ? 'Siz ikkala do‘kon egasisiz. Tasdiqlansa, manba qoldig‘i kamayadi va manzil qoldig‘i shu amalda oshadi. Davom etasizmi?'
        : 'Tasdiqlansa, mahsulot manba omboridan yechilib, qabul qiluvchi do‘konda “Qabul kutilmoqda” holatida turadi. Ma’lumotlar to‘g‘riligiga ishonchingiz komilmi?',
      confirmText: 'Ha, transferni yuborish', cancelText: 'Tekshirish', type: 'warning',
    });
    if (!confirmed) return;
    try {
      setBusyId('dispatch');
      if (!requestKey.current) requestKey.current = crypto.randomUUID();
      const transfer = await inventoryApi.createTransfer({
        request_key: requestKey.current,
        destination_tenant_id: Number(destinationId),
        items: draftRows.map((row) => ({
          source_variant_id: Number(row.source_variant_id),
          quantity: row.quantity,
          ...(isOwner && row.destination_category_id ? { destination_category_id: Number(row.destination_category_id) } : {}),
        })),
      });
      requestKey.current = null;
      setDraftRows([{ source_variant_id: '', quantity: '1', destination_category_id: '' }]);
      toast.success(isOwner ? 'Transfer yetkazildi' : 'Transfer #' + transfer.id + ' qabulni kutmoqda');
      await reload();
    } catch (error) {
      toast.error(error.message || 'Transfer yuborilmadi. Qayta urinishda ayni amalni tekshiring.');
    } finally {
      setBusyId(null);
    }
  };

  const receive = async (transfer) => {
    const payload = [];
    for (const item of transfer.items) {
      let sourceVariant = variants.find((variant) => sameCatalogProduct(item, variant));
      if (!sourceVariant) {
        try {
          const result = await catalogApi.getVariants({ product_name: item.source_product_name,
            variant_name: item.source_variant_name, page: 1, page_size: 1 });
          sourceVariant = result.results[0];
        } catch (error) { toast.error(error.message); return; }
      }
      const received = window.prompt(item.source_product_name + ' / ' + item.source_variant_name + ': real qabul qilingan miqdor (yuborildi ' + item.quantity_sent + ')', String(item.quantity_sent));
      if (received === null) return;
      const quantity = Number(received);
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > Number(item.quantity_sent)) {
        toast.warning('Qabul miqdori 0 va yuborilgan miqdor orasida bo‘lishi kerak');
        return;
      }
      let destination_category_id;
      if (quantity > 0 && !sourceVariant) {
        const categoryNumber = window.prompt('Mahsulot manzil katalogida yo‘q. Uni qaysi kategoriyaga qo‘shamiz?\n' + categories.map((category, index) => (index + 1) + ': ' + category.name).join('\n'));
        if (categoryNumber === null) return;
        const category = categories[Number(categoryNumber) - 1];
        if (!category) {
          toast.warning('Ro‘yxatdagi kategoriya raqamini kiriting');
          return;
        }
        destination_category_id = category.id;
      }
      let discrepancy_reason = '';
      if (quantity !== Number(item.quantity_sent)) {
        discrepancy_reason = window.prompt('Kamomad yoki qisman qabul sababi:') || '';
        if (!discrepancy_reason.trim()) {
          toast.warning('Tafovut sababini kiritish shart');
          return;
        }
      }
      payload.push({
        item_id: item.id,
        received_quantity: String(quantity),
        discrepancy_reason,
        ...(destination_category_id ? { destination_category_id } : {}),
      });
    }
    const confirmed = await confirm({
      title: 'Qabulni yakunlash',
      message: 'Kiritilgan real miqdorlar manzil omboriga qo‘shiladi. Tafovut bo‘lsa, u qayd etiladi; manba qoldig‘i avtomatik tiklanmaydi.',
      confirmText: 'Qabulni tasdiqlash', cancelText: 'Ortga qaytish', type: 'info',
    });
    if (!confirmed) return;
    try {
      setBusyId(transfer.id);
      await inventoryApi.acceptTransfer(transfer.id, { items: payload });
      toast.success('Qabul natijasi qayd etildi');
      await reload();
    } catch (error) {
      toast.error(error.message || 'Qabul qayd etilmadi');
    } finally {
      setBusyId(null);
    }
  };

  const startReturn = async (transfer) => {
    const items = [];
    for (const item of transfer.items) {
      const available = Number(item.quantity_received) - Number(item.quantity_returned) - Number(item.quantity_return_in_transit);
      if (available <= 0) continue;
      const value = window.prompt(item.source_product_name + ' / ' + item.source_variant_name + ': jismonan qaytariladigan miqdor (ko‘pi bilan ' + available + ')', String(available));
      if (value === null) return;
      const quantity = Number(value);
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > available) {
        toast.warning('Qaytarish miqdori mavjud qabul qilingan qoldiqdan oshdi');
        return;
      }
      if (quantity > 0) items.push({ original_item_id: item.id, quantity: String(quantity) });
    }
    if (!items.length) {
      toast.warning('Jismonan qaytariladigan qabul qilingan mahsulot miqdori yo‘q');
      return;
    }
    const confirmed = await confirm({
      title: 'Qaytish transferini boshlash',
      message: 'Qaytarish alohida transfer bo‘ladi. Tovar manzil do‘kon qoldig‘idan yechiladi; asl jo‘natuvchida faqat jismonan qabul qilingach ko‘payadi.',
      confirmText: 'Qaytishni yuborish', cancelText: 'Bekor qilish', type: 'warning',
    });
    if (!confirmed) return;
    try {
      setBusyId(transfer.id);
      await inventoryApi.returnTransfer(transfer.id, { request_key: crypto.randomUUID(), items });
      toast.success('Qaytish transferi jo‘natildi');
      await reload();
    } catch (error) {
      toast.error(error.message || 'Qaytish transferi yuborilmadi');
    } finally {
      setBusyId(null);
    }
  };

  const closeDiscrepancy = async (transfer) => {
    const reason = window.prompt('Tafovutni yakuniy yopish sababini kiriting:');
    if (!reason?.trim()) return;
    try {
      setBusyId(transfer.id);
      await inventoryApi.closeTransferDiscrepancy(transfer.id, reason.trim());
      toast.success('Tafovut auditi bilan yopildi');
      await reload();
    } catch (error) {
      toast.error(error.message || 'Tafovut yopilmadi');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ padding: 20, display: 'grid', gap: 20 }}>
      <section style={{ padding: 18, border: '1px solid var(--border-card)', borderRadius: 14, background: 'var(--bg-card)' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0, color: 'var(--text-primary)' }}><Send size={17} /> Do‘konlararo ichki transfer</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Faqat bir xil tasdiqlangan sotuvchi profiliga bog‘langan do‘konlar ko‘rinadi. Bu savdo yoki qarz yaratmaydi.</p>
        {!loading && targets.length === 0 && (
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: 'rgba(var(--warning-rgb), 0.08)',
              border: '1px solid rgba(var(--warning-rgb), 0.25)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              color: 'var(--text-primary)',
              fontSize: 13,
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            <AlertCircle size={20} style={{ color: 'var(--accent-amber)', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                Transfer uchun boshqa filial do‘kon topilmadi
              </div>
              <div style={{ color: 'var(--text-secondary)' }}>
                O‘zbekiston soliq qonunchiligiga ko‘ra, do‘konlararo ichki transfer faqat bir xil tasdiqlangan yuridik shaxs yoki YTT (Sotuvchi profili)ga bog‘langan do‘konlar o‘rtasida amalga oshiriladi.
                Boshqa filial do‘konlaringizni ayni profilga ulash orqali bu yerda chiqarishingiz mumkin.
              </div>
              {isOwner && (
                <div style={{ marginTop: 8 }}>
                  <Link
                    to="/my-tenants"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      color: 'var(--brand-primary, var(--accent-purple))',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    <Store size={15} /> Mening do‘konlarim bo‘limiga o‘tish &rarr;
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
        <form onSubmit={dispatch} style={{ display: 'grid', gap: 10 }}>
          <CustomSelect
            value={destinationId}
            onChange={(val) => setDestinationId(val)}
            options={[
              { value: '', label: targets.length ? 'Manzil do‘konni tanlang' : 'Mavjud filial do‘konlar topilmadi' },
              ...targets.map((tenant) => ({
                value: String(tenant.id),
                label: `${tenant.name}${tenant.address ? ' — ' + tenant.address : ''}`,
              })),
            ]}
            disabled={targets.length === 0}
            size="md"
            fullWidth
          />
          {draftRows.map((row, index) => {
            const variant = variants.find((item) => String(item.id) === String(row.source_variant_id));
            return (
              <div
                key={index}
                style={{
                  display: 'grid',
                  gridTemplateColumns: draftRows.length > 1
                    ? 'minmax(220px, 1fr) 130px minmax(180px, 1fr) 42px'
                    : 'minmax(220px, 1fr) 130px minmax(180px, 1fr)',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <RemoteVariantSelect value={row.source_variant_id}
                  onChange={val => updateDraft(index, 'source_variant_id', val)}
                  onVariant={variant => { if (variant) setVariants(prev => [...prev.filter(v => v.id !== variant.id), variant]); }}
                  placeholder="Manba mahsulot/varianti" fullWidth />
                <input data-api-field="quantity"
                  type="number"
                  min="0.001"
                  step="0.001"
                  className="form-input"
                  placeholder="Miqdor"
                  style={{
                    marginTop: 0,
                    height: 42,
                    fontSize: 14,
                    padding: '8px 12px',
                    borderRadius: 10,
                    boxSizing: 'border-box',
                  }}
                  value={row.quantity}
                  onChange={(event) => updateDraft(index, 'quantity', event.target.value)}
                  required
                />
                {isOwner && variant ? (
                  <CustomSelect data-api-field="destination_category_id"
                    value={row.destination_category_id}
                    onChange={(val) => updateDraft(index, 'destination_category_id', val)}
                    options={[
                      { value: '', label: 'Mavjud mos mahsulotni topish' },
                      ...categories.map((category) => ({
                        value: String(category.id),
                        label: `${category.name} (yangi katalog nusxasi)`,
                      })),
                    ]}
                    size="md"
                    fullWidth
                  />
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12, alignSelf: 'center', paddingLeft: 4 }}>
                    Kategoriya topilmasa qabul qiluvchi tanlaydi
                  </span>
                )}
                {draftRows.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => removeDraftRow(index)}
                    title="Qatorni o‘chirish"
                    style={{
                      height: 42,
                      width: 42,
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-rose)',
                      borderColor: 'rgba(var(--danger-rgb), 0.25)',
                      borderRadius: 10,
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={addDraftRow}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '9px 18px',
                fontSize: 13.5,
              }}
            >
              <Plus size={15} />
              <span>Yana mahsulot qo‘shish</span>
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busyId === 'dispatch' || !targets.length}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '9px 22px',
                fontSize: 13.5,
              }}
            >
              <Send size={15} />
              <span>{busyId === 'dispatch' ? 'Yuborilmoqda…' : 'Transferni yuborish'}</span>
            </button>
          </div>
          {!targets.length && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Transfer uchun boshqa tasdiqlangan profilingizga bog‘langan do‘kon kerak.</span>}
        </form>
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Transferlar ({pendingIncoming.length} qabul kutilmoqda)</h3>
        {loading ? <p><IlbiLoader label="Yuklanmoqda…" /></p> : transfers.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>Transferlar mavjud emas.</p> : transfers.map((transfer) => {
          const incoming = String(transfer.destination_tenant) === String(activeTenant?.id);
          const canReceive = incoming && transfer.status === 'pending';
          const canReturn = !incoming && transfer.kind === 'internal' && ['delivered', 'delivered_owner', 'discrepancy', 'closed'].includes(transfer.status);
          const canClose = isOwner && !incoming && transfer.status === 'discrepancy';
          return <article key={transfer.id} style={{ padding: 16, border: '1px solid var(--border-card)', borderRadius: 14, background: 'var(--bg-card)', display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <strong style={{ color: 'var(--primary)' }}>#{transfer.id}</strong>
              <span>{transfer.source_tenant_name} <ArrowRightLeft size={13} style={{ verticalAlign: 'middle' }} /> {transfer.destination_tenant_name}</span>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: 999,
                  background: transfer.status === 'pending' ? 'rgba(234, 179, 8, 0.12)' : 'rgba(34, 197, 94, 0.12)',
                  color: transfer.status === 'pending' ? 'var(--accent-amber)' : 'var(--accent-emerald)',
                  border: transfer.status === 'pending' ? '1px solid rgba(var(--primary-rgb), 0.25)' : '1px solid rgba(var(--success-rgb), 0.25)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {statusLabels[transfer.status] || transfer.status}
              </span>
              {transfer.kind === 'return' && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Qaytish transferi</span>}
            </div>
            <div style={{ display: 'grid', gap: 4 }}>{transfer.items.map((item) => <div key={item.id} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {item.source_product_name} / {item.source_variant_name}: yuborildi {item.quantity_sent}, qabul qilindi {item.quantity_received}
              {Number(item.quantity_returned) > 0 && ', qaytarildi ' + item.quantity_returned}
              {item.discrepancy_reason && <span style={{ color: 'var(--accent-rose)' }}> — {item.discrepancy_reason}</span>}
            </div>)}</div>
            {transfer.note && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Izoh: {transfer.note}</div>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
              {canReceive && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busyId === transfer.id}
                  onClick={() => receive(transfer)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    fontSize: 13,
                    background: 'var(--accent-emerald)',
                    borderColor: 'var(--accent-emerald)',
                  }}
                >
                  <Check size={14} />
                  <span>Qabulni qayd etish</span>
                </button>
              )}
              {canReturn && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyId === transfer.id}
                  onClick={() => startReturn(transfer)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    fontSize: 13,
                  }}
                >
                  <RotateCcw size={14} />
                  <span>Qaytish transferi</span>
                </button>
              )}
              {canClose && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busyId === transfer.id}
                  onClick={() => closeDiscrepancy(transfer)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    fontSize: 13,
                    color: 'var(--accent-amber)',
                    borderColor: 'rgba(var(--primary-rgb), 0.3)',
                  }}
                >
                  <span>Tafovutni yopish</span>
                </button>
              )}
            </div>
          </article>;
        })}
      </section>
    </div>
  );
}
