import IlbiLoader from './IlbiLoader';
import { useEffect, useState, useRef } from 'react';
import { catalogApi, resolveMediaUrl } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import Modal from './Modal';
import PriceInput from './PriceInput';
import CustomSelect from './CustomSelect';
import { Image as ImageIcon, Upload, Trash2, Plus, Layers, X } from 'lucide-react';

const emptyVariant = { name: '', unit: 'dona', price_partner: '0', price_min: '0', price_recommended: '0' };

export default function ProductToolsModal({ productId, onClose, onChanged }) {
  const toast = useToast();
  const fileInputRef = useRef(null);
  const [product, setProduct] = useState(null);
  const [variant, setVariant] = useState(emptyVariant);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setProduct(null);
    setVariant(emptyVariant);
    if (productId) {
      catalogApi.getProduct(productId).then((data) => {
        if (active) setProduct(data);
      }).catch((error) => {
        if (active) toast.error(error.message);
      });
    }
    return () => { active = false; };
  }, [productId, toast]);

  const perform = async (operation) => {
    setBusy(true);
    try {
      await operation();
      setProduct(await catalogApi.getProduct(productId));
      onChanged();
      toast.success('Saqlandi');
    } catch (error) {
      toast.error(error.message || 'Saqlashda xatolik');
    } finally {
      setBusy(false);
    }
  };

  const galleryImages = product?.gallery_images || [];

  return (
    <Modal isOpen={Boolean(productId)} onClose={onClose} title={product ? `${product.name} — Rasmlar & Variantlar` : 'Rasmlar va variantlar'} maxWidth={640}>
      {product ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Gallery Section */}
          <div style={{ background: 'var(--bg-surface)', padding: 18, borderRadius: 'var(--radius-md, 14px)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ImageIcon size={18} color="var(--primary)" />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Mahsulot Rasmlari ({galleryImages.length}/3)
                </h4>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Maksimal 3 ta rasm</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 14, paddingTop: 6, paddingRight: 6 }}>
              {galleryImages.map((image) => (
                <div
                  key={image.id}
                  style={{
                    position: 'relative',
                    aspectRatio: '1',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: 10,
                      overflow: 'hidden',
                      border: '1px solid var(--border-card)',
                      background: 'var(--bg-card)',
                    }}
                  >
                    <img
                      src={resolveMediaUrl(image.image)}
                      alt={product.name}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => perform(() => catalogApi.deleteProductImage(productId, image.id))}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 22,
                      height: 22,
                      padding: 0,
                      borderRadius: '50%',
                      background: '#09090b',
                      color: '#ffffff',
                      border: '1.5px solid #ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: busy ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.45)',
                      zIndex: 10,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!busy) {
                        e.currentTarget.style.background = 'var(--accent-rose)';
                        e.currentTarget.style.borderColor = '#ffffff';
                        e.currentTarget.style.transform = 'scale(1.15)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!busy) {
                        e.currentTarget.style.background = '#09090b';
                        e.currentTarget.style.borderColor = '#ffffff';
                        e.currentTarget.style.transform = 'scale(1)';
                      }
                    }}
                    title="Rasmni o‘chirish"
                    aria-label="Rasmni o‘chirish"
                  >
                    <X size={12} strokeWidth={2.6} />
                  </button>
                </div>
              ))}

              {galleryImages.length < 3 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    aspectRatio: '1',
                    borderRadius: 10,
                    border: '2px dashed var(--border-card)',
                    background: 'var(--bg-card)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: busy ? 'not-allowed' : 'pointer',
                    color: 'var(--text-muted)',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-card)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  <Upload size={20} />
                  <span style={{ fontSize: 11, fontWeight: 600 }}>Rasm yuklash</span>
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              disabled={busy || galleryImages.length >= 3}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append('image', file);
                form.append('order', galleryImages.length);
                perform(() => catalogApi.uploadProductImage(productId, form));
                event.target.value = '';
              }}
            />
          </div>

          {/* New Variant Form */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              perform(async () => {
                await catalogApi.createVariant(productId, variant);
                setVariant(emptyVariant);
              });
            }}
            style={{
              background: 'var(--bg-surface)',
              padding: 18,
              borderRadius: 'var(--radius-md, 14px)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Layers size={18} color="var(--primary)" />
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Yangi Variant Qo‘shish
                </h4>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                Boshqa rang, o‘lcham yoki hajm varianti. Qoldiq keyinchalik ombor kirimi orqali kiritiladi.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Variant Nomi <span style={{ color: 'var(--accent-rose)' }}>*</span>
                </label>
                <input data-api-field="name"
                  className="input-field"
                  required
                  maxLength={150}
                  placeholder="Masalan: Qora 128GB yoki XL"
                  value={variant.name}
                  onChange={(event) => setVariant({ ...variant, name: event.target.value })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  O‘lchov Birligi
                </label>
                <CustomSelect data-api-field="unit"
                  value={variant.unit}
                  onChange={(val) => setVariant({ ...variant, unit: val })}
                  options={['dona', 'kg', 'litr', 'metr'].map((unit) => ({ value: unit, label: unit }))}
                  size="sm"
                  fullWidth
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Hamkor narxi (1-narx)
                </label>
                <PriceInput data-api-field="price_partner"
                  min={0}
                  value={variant.price_partner}
                  onChange={(event) => setVariant({ ...variant, price_partner: event.target.value })}
                  className="input-field"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Minimal narx
                </label>
                <PriceInput data-api-field="price_min"
                  min={0}
                  value={variant.price_min}
                  onChange={(event) => setVariant({ ...variant, price_min: event.target.value })}
                  className="input-field"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Sotuv narxi <span style={{ color: 'var(--accent-rose)' }}>*</span>
                </label>
                <PriceInput data-api-field="price_recommended"
                  min={0}
                  required
                  value={variant.price_recommended}
                  onChange={(event) => setVariant({ ...variant, price_recommended: event.target.value })}
                  className="input-field"
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button className="btn btn-primary" disabled={busy} type="submit" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plus size={14} />
                <span>Variantni Saqlash</span>
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
          <IlbiLoader label="Yuklanmoqda..." />
        </div>
      )}
    </Modal>
  );
}
