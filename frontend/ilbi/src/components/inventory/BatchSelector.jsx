import { useEffect, useState } from 'react';
import { inventoryApi } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import CustomSelect from '../common/CustomSelect';

export default function BatchSelector({ variantId, value, onChange, allowEmpty = false, 'data-api-field': apiField }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!variantId) return;
    let live = true;
    setLoading(true);
    inventoryApi.getBatches({ product_variant_id: variantId, include_empty: allowEmpty }).then(data => {
      if (live) setRows(data);
    }).catch(error => { if (live) toast.error(error.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [variantId, allowEmpty, toast]);
  if (!variantId) return null;
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Partiya (ixtiyoriy)</span>
      <CustomSelect
        data-api-field={apiField}
        value={value}
        disabled={loading}
        onChange={val => onChange(val)}
        options={[
          {
            value: '',
            label: loading
              ? 'Yuklanmoqda…'
              : allowEmpty
              ? 'Yangi, muddati noma’lum partiya'
              : 'Avval muddati ertaroq tugaydigan partiya',
          },
          ...rows.map(row => ({
            value: String(row.id),
            label: `${row.batch_code || `Partiya #${row.id}`} · ${row.expires_on || 'Sana yo‘q'} · ${row.quantity} ${row.unit}`,
          })),
        ]}
        size="md"
        fullWidth
      />
    </div>
  );
}
