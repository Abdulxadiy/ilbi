export default function FiscalMetadataFields({ value, onChange, idPrefix }) {
  return (
    <fieldset style={{ margin: 0, padding: 12, border: '1px solid var(--border-card)', borderRadius: 10 }}>
      <legend style={{ padding: '0 6px', fontSize: 13, fontWeight: 600 }}>Fiskal rekvizitlar (ixtiyoriy)</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
        <label htmlFor={`${idPrefix}-mxik`} style={{ fontSize: 13, fontWeight: 600 }}>
          MXIK (IKPU)
          <input data-api-field="mxik"
            id={`${idPrefix}-mxik`}
            name="mxik"
            type="text"
            inputMode="numeric"
            maxLength={17}
            pattern="[0-9]{17}"
            title="MXIK 17 ta raqamdan iborat bo‘lishi kerak"
            value={value.mxik || ''}
            onChange={event => onChange({ ...value, mxik: event.target.value })}
            className="input-field"
            style={{ marginTop: 6, fontFamily: 'monospace' }}
          />
        </label>
        <label htmlFor={`${idPrefix}-package-code`} style={{ fontSize: 13, fontWeight: 600 }}>
          Qadoq kodi
          <input data-api-field="package_code"
            id={`${idPrefix}-package-code`}
            name="package_code"
            type="text"
            maxLength={20}
            value={value.package_code || ''}
            onChange={event => onChange({ ...value, package_code: event.target.value })}
            className="input-field"
            style={{ marginTop: 6, fontFamily: 'monospace' }}
          />
        </label>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
        Mahsulot va o‘lchov birligiga mos kodlarni{' '}
        <a href="https://tasnif.soliq.uz/" target="_blank" rel="noopener noreferrer">Soliq katalogidan</a> oling.
      </p>
    </fieldset>
  );
}
