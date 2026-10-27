import { useMemo, useState } from 'react';
import Modal from './Modal';
import { catalogApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { labelDocument, printLabelDocument } from '../../utils/productLabels';
import { Printer, Sparkles, Info } from 'lucide-react';
import CustomSelect from './CustomSelect';

export default function ProductLabelsModal({ variant: initialVariant, canGenerate, onClose, onChanged }) {
  const toast = useToast();
  const [variant, setVariant] = useState(initialVariant);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState({ format: 'a4', width: 50, height: 30, copies: 1, showName: true, showPrice: true });
  const update = (field, value) => setOptions(prev => ({ ...prev, [field]: value }));

  const preview = useMemo(() => {
    if (!variant.barcode) return { html: '', error: 'Bu mahsulotga hali shtrix-kod berilmagan.' };
    try { return { html: labelDocument(variant, { ...options, copies: 1 }, { preview: true }), error: '' }; }
    catch (error) { return { html: '', error: error.message }; }
  }, [variant, options]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await catalogApi.generateBarcode(variant.id, { force: true });
      setVariant(updated);
      onChanged?.();
      toast.success('Yangi raqamli EAN-13 shtrix-kod yaratildi');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    try {
      printLabelDocument(labelDocument(variant, options));
    } catch (error) {
      toast.error(error.message);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Shtrix-kod yorlig‘ini chop etish" maxWidth={680}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Product Info Banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            padding: '12px 16px',
            borderRadius: 'var(--radius-md, 12px)',
            background: 'var(--bg-chip)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {variant.product_name || variant.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              Variant: <strong>{variant.name}</strong>
            </div>
          </div>

          {(!variant.barcode || !/^\d{12,13}$/.test(variant.barcode)) && (
            canGenerate ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={generate}
                disabled={busy}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
              >
                <Sparkles size={14} />
                <span>
                  {busy
                    ? 'Kutilmoqda…'
                    : (!variant.barcode
                        ? 'Raqamli shtrix-kod yaratish'
                        : 'Raqamli EAN-13 kodiga o‘tkazish')}
                </span>
              </button>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--accent-rose)' }}>Shtrix-kodni yaratish uchun do‘kon egasiga murojaat qiling</span>
            )
          )}
        </div>

        {/* Print Settings Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 12,
            padding: 16,
            borderRadius: 'var(--radius-md, 12px)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Qog‘oz formati
            </label>
            <CustomSelect data-api-field="format"
              value={options.format}
              onChange={(val) => update('format', val)}
              options={[
                { value: 'a4', label: 'A4 (Varroqli)' },
                { value: 'label', label: 'Yorliq printeri' },
              ]}
              size="sm"
              fullWidth
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Eni (mm)
            </label>
            <input data-api-field="width"
              className="input-field"
              type="number"
              min="30"
              max="190"
              value={options.width}
              onChange={e => update('width', e.target.value)}
              style={{ padding: '8px 10px', fontSize: 13 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Bo‘yi (mm)
            </label>
            <input data-api-field="height"
              className="input-field"
              type="number"
              min="20"
              max="100"
              value={options.height}
              onChange={e => update('height', e.target.value)}
              style={{ padding: '8px 10px', fontSize: 13 }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Nusxa soni
            </label>
            <input data-api-field="copies"
              className="input-field"
              type="number"
              min="1"
              max="200"
              value={options.copies}
              onChange={e => update('copies', e.target.value)}
              style={{ padding: '8px 10px', fontSize: 13 }}
            />
          </div>
        </div>

        {/* Checkbox Options */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              userSelect: 'none',
              color: options.showName ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            <input
              type="checkbox"
              checked={options.showName}
              onChange={e => update('showName', e.target.checked)}
              style={{ accentColor: 'var(--primary)', width: 16, height: 16, cursor: 'pointer' }}
            />
            <span>Mahsulot nomini chiqarish</span>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              userSelect: 'none',
              color: options.showPrice ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            <input
              type="checkbox"
              checked={options.showPrice}
              onChange={e => update('showPrice', e.target.checked)}
              style={{ accentColor: 'var(--primary)', width: 16, height: 16, cursor: 'pointer' }}
            />
            <span>Mahsulot narxini chiqarish</span>
          </label>
        </div>

        {/* Preview Frame */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Yorliq namunasi (Preview):
          </span>
          {preview.error ? (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                borderRadius: 'var(--radius-md, 12px)',
                background: 'rgba(var(--danger-rgb), 0.08)',
                border: '1px dashed rgba(var(--danger-rgb), 0.3)',
                color: 'var(--accent-rose)',
                fontSize: 13,
              }}
              role="alert"
            >
              {preview.error}
            </div>
          ) : (
            <div
              style={{
                borderRadius: 'var(--radius-md, 12px)',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-chip, #f8fafc)',
                padding: 16,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 380,
                  aspectRatio: `${options.width || 50} / ${options.height || 30}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)',
                  background: '#ffffff',
                }}
              >
                <iframe
                  title="Yorliq namunasi"
                  sandbox=""
                  srcDoc={preview.html}
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Info size={13} style={{ flexShrink: 0, opacity: 0.7 }} />
          <span>Chop etish dialogida masshtabni 100% qiling va brauzerning sahifa sarlavhasi hamda pastki yozuvlarini o‘chirib qo‘ying.</span>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Bekor qilish
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !variant.barcode || !!preview.error}
            onClick={print}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Printer size={15} />
            <span>Chop Etish</span>
          </button>
        </div>
      </div>
    </Modal>
  );
}
