import React from 'react';
import { Save, Building2, Info } from 'lucide-react';
import ReceiptSlip from './ReceiptSlip';
import CustomSelect from './CustomSelect';
import { calculateTaxLine } from '../../utils/receiptTax';

const TAX_REGIME_OPTIONS = [
  { value: 'unspecified', label: 'Belgilanmagan' },
  { value: 'general', label: 'Umumbelgilangan (QQS / foyda solig‘i)' },
  { value: 'turnover', label: 'Aylanmadan olinadigan soliq (AOS)' },
  { value: 'other', label: 'Boshqa soliq rejimi' },
];

const PRICE_VAT_OPTIONS = [
  { value: 'included', label: 'QQS narx ichiga kiritilgan' },
  { value: 'excluded', label: 'QQS narx ustiga qo‘shiladi' },
];

const PAPER_WIDTH_OPTIONS = [
  { value: '58mm', label: '58 mm (Ixcham lenta)' },
  { value: '80mm', label: '80 mm (Keng lenta)' },
];

const fieldStyle = {
  width: '100%',
  padding: '10px 13px',
  borderRadius: 9,
  border: '1px solid var(--border-card, #e2e8f0)',
  background: 'var(--bg-input, #fff)',
  color: 'var(--text-primary, #0f172a)',
  fontSize: 13.5,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const labelStyle = {
  display: 'grid',
  gap: 7,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-secondary, #475569)',
};

export const DEFAULT_RECEIPT_FOOTER = "Iltimos, chekni saqlab qo‘ying.\nSavdo nusxasi — fiskal chek emas";

export default function ReceiptSettingsPanel({ tenant, value, onChange, onSave, saving, previewDate }) {
  const set = (field, val) => onChange(previous => ({ ...previous, [field]: val }));
  const vatAllowed = ['general', 'other'].includes(value.tax_regime);
  const effectiveFooter = value.receipt_footer !== undefined
    ? value.receipt_footer
    : (tenant?.receipt_settings?.receipt_footer !== undefined ? tenant.receipt_settings.receipt_footer : DEFAULT_RECEIPT_FOOTER);
  const snapshot = {
    ...tenant.receipt_settings,
    ...value,
    receipt_header: '',
    receipt_footer: effectiveFooter,
    store_name: tenant.name,
    store_address: value.address,
  };
  const amounts = calculateTaxLine(1, 100000, snapshot);
  const preview = {
    id: 'settings-preview', receipt_number: 'NAMUNA', created_at: previewDate.toISOString(), currency: 'UZS',
    receipt_snapshot: snapshot, tenant_name: tenant.name, sold_by_name: 'Namuna kassir', counterparty_name: 'Namuna mijoz',
    payment_type: 'cash', total_amount: amounts.totalAmount, subtotal_amount: amounts.netAmount, tax_amount: amounts.taxAmount,
    items: [{ id: 'sample', product_name: 'Namuna mahsulot', quantity: 1, unit: 'dona', unit_price: 100000,
      total_price: amounts.totalAmount, tax_amount: amounts.taxAmount, tax_rate: value.is_vat_payer ? value.vat_rate : null }],
  };

  const percent = (field, label, disabled = false) => (
    <label style={labelStyle}>{label}
      <input type="number" min="0" max="100" step="0.01" value={value[field] ?? ''} disabled={disabled}
        onChange={e => set(field, e.target.value)} style={fieldStyle} />
    </label>
  );

  const toggle = (field, label, disabled = false) => (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 13,
      fontWeight: 500,
      color: 'var(--text-primary)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      userSelect: 'none',
      opacity: disabled ? 0.6 : 1,
    }}>
      <input
        type="checkbox"
        checked={Boolean(value[field])}
        disabled={disabled}
        onChange={e => set(field, e.target.checked)}
        style={{
          width: 17,
          height: 17,
          accentColor: 'var(--primary, #000)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          borderRadius: 4,
        }}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 20 }}>
      {/* Settings Form Card */}
      <div className="glass-card" style={{ padding: 24, display: 'grid', gap: 18, alignContent: 'start' }}>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
          Chek va soliq sozlamalari
        </h3>

        {/* Requisites Card */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            padding: '14px 16px',
            borderRadius: 12,
            background: 'var(--bg-surface, var(--bg-card))',
            border: '1px solid var(--border-subtle, var(--border-card))',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: 'var(--primary-light, rgba(0,0,0,0.05))',
              color: 'var(--primary, #0f172a)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Building2 size={20} />
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                {snapshot.seller_name || 'Profil biriktirilmagan'}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'var(--bg-chip, #f1f5f9)',
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace',
                }}
              >
                STIR: {snapshot.seller_tax_identifier || 'Kiritilmagan'}
              </span>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 4 }}>
              Rasmiy rekvizitlar do‘konga biriktirilgan sotuvchi profilidan olinadi.
            </div>
          </div>
        </div>

        {/* Tax Regime Selector */}
        <label style={labelStyle}>
          Soliq rejimi
          <CustomSelect data-api-field="tax_regime"
            fullWidth
            value={value.tax_regime}
            options={TAX_REGIME_OPTIONS}
            onChange={val => {
              const regime = typeof val === 'object' && val?.target ? val.target.value : val;
              onChange(previous => ({
                ...previous,
                tax_regime: regime,
                ...(!['general', 'other'].includes(regime) ? { is_vat_payer: false, profit_tax_enabled: false } : {}),
              }));
            }}
          />
        </label>

        {value.tax_regime === 'other' && (
          <label style={labelStyle}>
            Soliq rejimi nomi
            <input data-api-field="tax_regime_name"
              style={fieldStyle}
              maxLength={150}
              placeholder="Rejim nomini kiriting..."
              value={value.tax_regime_name || ''}
              onChange={e => set('tax_regime_name', e.target.value)}
            />
          </label>
        )}

        {/* VAT & Profit Tax Block */}
        {vatAllowed && (
          <div
            style={{
              display: 'grid',
              gap: 14,
              padding: '14px 16px',
              borderRadius: 12,
              background: 'var(--bg-surface, rgba(0,0,0,0.02))',
              border: '1px solid var(--border-subtle, var(--border-card))',
            }}
          >
            {toggle('is_vat_payer', 'Do‘kon QQS to‘lovchisi')}
            {value.is_vat_payer && (
              <div style={{ display: 'grid', gap: 14, paddingLeft: 8, borderLeft: '2px solid var(--primary-light, #cbd5e1)' }}>
                {percent('vat_rate', 'QQS stavkasi (%)')}
                <label style={labelStyle}>
                  Katalog va POSdagi kiritilgan narxlar
                  <CustomSelect
                    fullWidth
                    value={value.price_includes_vat ? 'included' : 'excluded'}
                    options={PRICE_VAT_OPTIONS}
                    onChange={val => {
                      const selected = typeof val === 'object' && val?.target ? val.target.value : val;
                      set('price_includes_vat', selected === 'included');
                    }}
                  />
                </label>
              </div>
            )}
            <div style={{ height: 1, background: 'var(--border-subtle, rgba(0,0,0,0.06))' }} />
            {toggle('profit_tax_enabled', 'Foyda solig‘i to‘laydi')}
            {value.profit_tax_enabled && (
              <div style={{ paddingLeft: 8, borderLeft: '2px solid var(--primary-light, #cbd5e1)' }}>
                {percent('profit_tax_rate', 'Foyda solig‘i stavkasi (%)')}
              </div>
            )}
          </div>
        )}

        {value.tax_regime === 'turnover' && percent('turnover_tax_rate', 'AOS stavkasi (%)')}

        {/* Tax Explanatory Notice */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--primary-light, rgba(0,0,0,0.03))',
            border: '1px solid var(--border-subtle, var(--border-card))',
            fontSize: 12,
            lineHeight: 1.55,
            color: 'var(--text-muted)',
          }}
        >
          <Info size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--accent-blue, var(--primary))' }} />
          <div>
            AOS va foyda solig‘i sotuvchining soliq sozlamalari sifatida saqlanadi; xaridor summasiga qo‘shilmaydi.
            Foyda solig‘i bazasi davr daromadlari va chegiriladigan xarajatlarga bog‘liq; bitta chekdan hisoblanmaydi.
            Stavkalarni amaldagi soliq maqomingizga mos kiriting. O‘zgarishlar yangi savdolarga qo‘llanadi.
          </div>
        </div>

        {/* Store Address */}
        <label style={labelStyle}>
          Do‘konning to‘liq manzili
          <input data-api-field="address"
            style={fieldStyle}
            maxLength={255}
            placeholder="Masalan: Toshkent sh., Chilonzor tumani, 9-mavze"
            value={value.address || ''}
            onChange={e => set('address', e.target.value)}
          />
        </label>

        {/* Receipt Footer Text */}
        <label style={labelStyle}>
          Chek pastki qismidagi matn (Footer)
          <textarea
            style={{ ...fieldStyle, resize: 'vertical', minHeight: 74, lineHeight: 1.5 }}
            rows={3}
            spellCheck={false}
            placeholder={`Iltimos, chekni saqlab qo‘ying.\nSavdo nusxasi — fiskal chek emas`}
            value={value.receipt_footer !== undefined ? value.receipt_footer : DEFAULT_RECEIPT_FOOTER}
            onChange={e => set('receipt_footer', e.target.value)}
          />
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 400, marginTop: -2 }}>
            «XARIDINGIZ UCHUN RAHMAT!» va «ilbi.uz» o‘rtasida chiqadi. Istalgancha o‘zgartirishingiz yoki o‘chirishingiz mumkin.
          </span>
        </label>

        {/* Contact Phone */}
        <label style={labelStyle}>
          Aloqa telefoni
          <input data-api-field="receipt_phone"
            style={fieldStyle}
            maxLength={30}
            placeholder="+998 90 123 45 67"
            value={value.receipt_phone || ''}
            onChange={e => set('receipt_phone', e.target.value)}
          />
        </label>

        {/* Paper Width Selector */}
        <label style={labelStyle}>
          Standart chek qog‘ozi
          <CustomSelect data-api-field="receipt_paper_width"
            fullWidth
            value={value.receipt_paper_width}
            options={PAPER_WIDTH_OPTIONS}
            onChange={val => {
              const width = typeof val === 'object' && val?.target ? val.target.value : val;
              set('receipt_paper_width', width);
            }}
          />
        </label>

        {/* Checkbox Toggles Group */}
        <div
          style={{
            display: 'grid',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 10,
            background: 'var(--bg-surface, rgba(0,0,0,0.02))',
            border: '1px solid var(--border-subtle, var(--border-card))',
          }}
        >
          {toggle('receipt_show_item_tax', 'Har bir mahsulotda QQS foizi va summasini ko‘rsatish')}
          {toggle('receipt_show_cashier', 'Kassir nomini ko‘rsatish')}
          {toggle('receipt_show_customer', 'Ichki chekda mijoz nomini ko‘rsatish')}
        </div>

        {/* Submit Save Button */}
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={onSave}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '12px 20px',
            fontWeight: 600,
            fontSize: 14,
            borderRadius: 10,
            marginTop: 6,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          <Save size={16} />
          {saving ? 'Saqlanmoqda...' : 'Chek va soliq sozlamalarini saqlash'}
        </button>
      </div>

      {/* Receipt Slip Preview Card (Sticky) */}
      <div
        className="glass-card"
        style={{
          padding: 24,
          position: 'sticky',
          top: 20,
          alignSelf: 'start',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
              Chek namunasi
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              100 000 so‘mlik kiritilgan narx asosida. Fiskal chek emas.
            </p>
          </div>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              padding: '3px 9px',
              borderRadius: 999,
              background: 'var(--primary-light, rgba(0,0,0,0.06))',
              color: 'var(--primary, #0f172a)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {value.receipt_paper_width || '58mm'} lenta
          </span>
        </div>

        {/* Centered Preview Canvas */}
        <div
          style={{
            background: 'var(--bg-app, #f1f0eb)',
            border: '1px dashed var(--border-subtle, rgba(0,0,0,0.12))',
            borderRadius: 12,
            padding: '24px 16px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            minHeight: 460,
            overflowX: 'auto',
            boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.03)',
          }}
        >
          <ReceiptSlip
            id="receipt-settings-preview"
            sales={[preview]}
            paperWidth={value.receipt_paper_width}
            showQrCode={false}
          />
        </div>
      </div>
    </div>
  );
}
