import { savedReceiptIdentity } from '../../utils/receiptIdentity.js';
import { localStore } from '../../utils/brandStorage.js';
import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import IlbiLogo from './IlbiLogo';
import { useAuth } from '../../hooks/useAuth';
import ReceiptTaxSummary from './ReceiptTaxSummary';
import ReceiptItemCodes from './ReceiptItemCodes';
import { receiptShareURL } from '../../utils/documentShare';

/**
 * High-resolution QR Code generator optimized for thermal printer heads (203 DPI)
 * Encodes the direct electronic receipt / PDF link for the customer.
 */
export function ReceiptQRCode({ value = '', size = 84 }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(value, {
      width: size * 2, // 2x multiplier ensures crisp 1-bit thermal print
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => setDataUrl(url))
      .catch((err) => console.error('QR code generation error:', err));
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div style={{ width: size, height: size, margin: '6px auto', background: '#ffffff', border: '1px dashed #000000' }} />
    );
  }

  return (
    <div style={{ textAlign: 'center', marginTop: 8, marginBottom: 4, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <div
        className="receipt-qr-card"
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '6px 10px',
          border: '1px dashed #000000',
          borderRadius: 4,
          background: '#ffffff',
          textAlign: 'center',
          breakInside: 'avoid',
          pageBreakInside: 'avoid',
        }}
      >
        <img
          src={dataUrl}
          alt="Elektron savdo nusxasi QR kodi"
          width={size}
          height={size}
          style={{ display: 'block', margin: '0 auto', imageRendering: 'pixelated' }}
        />
        <div style={{ fontSize: 8.5, fontWeight: 700, color: '#000000', marginTop: 4, letterSpacing: '0.02em', whiteSpace: 'nowrap', fontFamily: "'JetBrains Mono', monospace" }}>
          Savdo nusxasi: skaner qiling
        </div>
      </div>
    </div>
  );
}

/**
 * Print receipt slip in a completely isolated hidden iframe.
 * Supports both standard 58mm (small portable/USB thermal printer like Uzum)
 * and 80mm (large POS thermal printer).
 * Guarantees zero leakage of web page UI, buttons, modals, or headers into the printout!
 */
export function printReceiptSlip(
  elementId = 'printable-pos-receipt',
  title = 'ILBI Savdo Cheki',
  customPaperWidth = null
) {
  const printEl = document.getElementById(elementId);
  if (!printEl) {
    window.print();
    return;
  }

  // Paper width: 58mm default (matching Uzum 58mm thermal printers) or 80mm
  const storedWidth =
    customPaperWidth ||
    printEl.dataset.paperWidth ||
    (typeof window !== 'undefined' ? localStore.getItem('ilbi_receipt_paper_width') : null) ||
    '58mm';

  const is58mm = storedWidth === '58mm';
  const paperWidth = is58mm ? '58mm' : '80mm';

  // Remove any previously created print iframe
  const existingIframe = document.getElementById('ilbi-thermal-print-iframe');
  if (existingIframe) {
    existingIframe.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'ilbi-thermal-print-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = paperWidth;
  iframe.style.height = '10000px'; // Give ample space for unconstrained height measurement
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.zIndex = '-9999';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="uz">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        <style id="receipt-dynamic-page-size">
          @page {
            size: ${paperWidth} auto;
            margin: 0mm;
          }
          @media print {
            @page {
              size: ${paperWidth} auto;
              margin: 0mm;
            }
          }
        </style>
        <style>
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          html {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            background: #ffffff !important;
            color: #000000 !important;
          }
          body {
            background: #ffffff !important;
            color: #000000 !important;
            font-family: 'JetBrains Mono', 'SF Mono', Consolas, 'Courier New', monospace !important;
            margin: 0 auto !important;
            padding: 0 !important;
            width: 100% !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: flex-start !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            -webkit-font-smoothing: antialiased;
          }
          .receipt-print-wrapper {
            width: 100% !important;
            max-width: ${is58mm ? '54mm' : '76mm'} !important;
            margin: 0 auto !important;
            padding: ${is58mm ? '1.5mm 2mm 2mm 2mm' : '2mm 3mm 3mm 3mm'} !important;
            box-sizing: border-box !important;
            text-align: left;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .receipt-footer-section,
          .receipt-qr-card,
          .receipt-barcode-wrap {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          .no-print {
            display: none !important;
          }
          img, svg {
            display: block;
            margin: 0 auto;
            max-width: 100%;
          }
          @media print {
            html, body {
              width: 100% !important;
              height: auto !important;
              overflow: visible !important;
            }
            .receipt-print-wrapper {
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
            .receipt-footer-section,
            .receipt-qr-card,
            .receipt-barcode-wrap {
              break-inside: avoid !important;
              page-break-inside: avoid !important;
            }
            .receipt-dashed-line {
              border-top: 1px dashed #000000 !important;
            }
            .receipt-total-box {
              background: transparent !important;
              border: 1px solid #000000 !important;
            }
            .receipt-qr-card {
              background: transparent !important;
              border: 1px dashed #000000 !important;
            }
            .receipt-tag {
              border: 1px solid #000000 !important;
              background: transparent !important;
              color: #000000 !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="receipt-print-wrapper" id="receipt-print-wrapper">
          ${printEl.innerHTML}
        </div>
      </body>
    </html>
  `);
  doc.close();

  const executePrint = async () => {
    try {
      // 1. Wait for web fonts to load
      if (doc.fonts && doc.fonts.ready) {
        await doc.fonts.ready;
      }

      // 2. Wait for any inline QR code images
      const images = Array.from(doc.images || []);
      if (images.length > 0) {
        await Promise.all(
          images.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((resolve) => {
                  img.onload = resolve;
                  img.onerror = resolve;
                })
          )
        );
      }

      // 3. Measure the REAL rendered height of the receipt content inside the 58mm/80mm print iframe
      const wrapper = doc.getElementById('receipt-print-wrapper') || doc.body;
      const rect = wrapper.getBoundingClientRect();
      const actualHeightPx = Math.ceil(
        Math.max(rect.height || 0, wrapper.scrollHeight || 0, wrapper.offsetHeight || 0)
      );

      // 1px = 0.2645833 mm (at standard 96 DPI CSS scale).
      // Minimal compact buffer (+4mm) ensures Chrome stays strictly on 1 page without leaving any large blank tail!
      const contentHeightMm = Math.ceil(actualHeightPx * 0.2646);
      const targetHeightMm = Math.max(30, contentHeightMm + 4);

      // 4. Update the dynamic page rule with the TRUE measured height
      const dynamicStyle = doc.getElementById('receipt-dynamic-page-size');
      if (dynamicStyle) {
        dynamicStyle.textContent = `
          @page {
            size: ${paperWidth} ${targetHeightMm}mm;
            margin: 0mm;
          }
          @media print {
            @page {
              size: ${paperWidth} ${targetHeightMm}mm;
              margin: 0mm;
            }
          }
        `;
      }

      // 5. Trigger print dialog
      setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      }, 80);
    } catch {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }
  };

  // Wait a short tick for iframe DOM layout and font initialization, then execute
  setTimeout(executePrint, 150);
}

/**
 * Procedural barcode visual SVG generator with guard bars and mathematically centered bars
 */
export function ReceiptBarcode({ value = 'POS-00000', width = 145 }) {
  const seedStr = value || 'ILBI';
  // Standard structured retail barcode simulation with solid start & stop guard bars
  const elements = [{ w: 2.2, gap: false }];
  for (let i = 0; i < 36; i++) {
    const charCode = seedStr.charCodeAt(i % seedStr.length);
    const w = ((charCode + i * 7) % 3) + 1.2;
    const isGap = (i + charCode) % 4 === 0;
    elements.push({ w, gap: isGap });
  }
  elements.push({ w: 2.2, gap: false });

  // Compute exact total pattern width and startX for 100% mathematical center alignment
  const totalPatternWidth = elements.reduce(
    (acc, el, idx) => acc + el.w + (idx < elements.length - 1 ? 1.2 : 0),
    0
  );
  const startX = Math.max(0, (width - totalPatternWidth) / 2);

  const drawnBars = [];
  let curX = startX;
  elements.forEach((el, idx) => {
    if (!el.gap) {
      drawnBars.push(
        <rect key={idx} x={curX.toFixed(2)} y="2" width={el.w.toFixed(2)} height="26" fill="#000000" />
      );
    }
    curX += el.w + 1.2;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: 10, textAlign: 'center', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
      <svg
        width={width}
        height="30"
        viewBox={`0 0 ${width} 30`}
        style={{ margin: '0 auto', display: 'block' }}
      >
        <rect width={width} height="30" fill="#ffffff" />
        <g fill="#000000">{drawnBars}</g>
      </svg>
      <div style={{ fontSize: 9, letterSpacing: '0.12em', color: '#000000', marginTop: 3, fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, monospace", whiteSpace: 'nowrap', textAlign: 'center', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Reusable Thermal POS Receipt Component
 */
export default function ReceiptSlip({
  sales = [],
  paidAmountUZS = null,
  paidAmountUSD = null,
  changeDueUZS = null,
  changeDueUSD = null,
  storeName = null,
  cashierName = null,
  id = 'printable-pos-receipt',
  className = '',
  paperWidth = null,
  showQrCode = true,
}) {
  const { user } = useAuth();

  const effectivePaperWidth =
    paperWidth ||
    (Array.isArray(sales) ? sales[0] : sales)?.receipt_snapshot?.receipt_paper_width ||
    (typeof window !== 'undefined' ? localStore.getItem('ilbi_receipt_paper_width') : null) ||
    '58mm';
  const is58mm = effectivePaperWidth === '58mm';

  // Normalize sales to array
  const salesList = Array.isArray(sales) ? sales : sales ? [sales] : [];

  const store = storeName || user?.tenant_name || user?.tenant?.name || '';
  const cashier =
    cashierName ||
    (user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user?.username || 'Kassir');

  const formatMoney = (val, cur = 'UZS') => {
    const num = Number(val || 0);
    if (cur === 'USD') {
      return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return `${num.toLocaleString('uz-UZ', { maximumFractionDigits: 2 })} UZS`;
  };

  const formatQty = (qty, unit) => {
    const n = Number(qty || 0);
    const unitStr = unit || 'ta';
    return `${Number.isInteger(n) ? n : n.toFixed(2)} ${unitStr}`;
  };

  const formatPaymentType = (type) => {
    const t = String(type || 'cash').toLowerCase();
    if (t === 'card') return 'BANK KARTASI';
    if (t === 'debt') return 'NASIYA (QARZ)';
    return 'NAQD PUL';
  };

  const formatDate = (dateStr) => {
    const d = dateStr ? new Date(dateStr) : new Date();
    return d.toLocaleString('uz-UZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div
      id={id}
      data-paper-width={effectivePaperWidth}
      className={`thermal-receipt-paper ${className}`}
      style={{
        background: '#ffffff',
        color: '#000000',
        padding: is58mm ? '12px 10px 16px 10px' : '16px 14px 20px 14px',
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, 'Courier New', monospace",
        fontSize: is58mm ? 10 : 11,
        lineHeight: 1.35,
        width: '100%',
        maxWidth: is58mm ? 260 : 340,
        margin: '0 auto',
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.18)',
        border: '1px solid #e5e7eb',
        textAlign: 'left',
        userSelect: 'text',
        boxSizing: 'border-box',
      }}
    >
      {salesList.map((sale, sIdx) => {
        const config = sale?.receipt_snapshot || {};
        const cur = sale?.currency || 'UZS';
        const isUsd = cur === 'USD';
        const receiptNo = sale?.receipt_number || sale?.id || `POS-${Date.now()}`;
        const items = sale?.items || [];
        const totalAmount = Number(sale?.total_amount || 0);
        const identity = savedReceiptIdentity(sale, { store, cashier });
        const counterparty = identity.customer;

        return (
          <div
            key={sale?.id || sIdx}
            style={{
              marginBottom: sIdx < salesList.length - 1 ? 20 : 0,
              paddingBottom: sIdx < salesList.length - 1 ? 16 : 0,
              borderBottom: sIdx < salesList.length - 1 ? '1px dashed #000000' : 'none',
            }}
          >
            {/* Header: Logo & Store Info */}
            <div style={{ textAlign: 'center', marginBottom: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 4 }}>
                <IlbiLogo size={26} textColor="#000000" />
              </div>
              {(config.store_name || sale?.tenant_name || store) && (
                <div
                  style={{
                    fontSize: is58mm ? 14 : 15.5,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: '#000000',
                    marginTop: 3,
                    letterSpacing: '0.02em',
                  }}
                >
                  {identity.store || '—'}
                </div>
              )}
              {config.seller_name && <div style={{ fontSize: 10, marginTop: 3 }}>Sotuvchi: {config.seller_name}</div>}
              {config.seller_tax_identifier && <div style={{ fontSize: 10, marginTop: 2 }}>STIR / JShShIR: {config.seller_tax_identifier}</div>}
              {(config.store_address || sale?.tenant_address) && (
                <div style={{ fontSize: is58mm ? 8.5 : 9.5, color: '#000000', marginTop: 2 }}>
                  {config.version ? config.store_address : sale.tenant_address}
                </div>
              )}
              {(config.receipt_phone || sale?.tenant_phone) && (
                <div style={{ fontSize: is58mm ? 8.5 : 9.5, color: '#000000', marginTop: 1 }}>
                  Tel: {config.version ? config.receipt_phone : sale.tenant_phone}
                </div>
              )}
            </div>

            {/* Separator */}
            <div
              style={{
                borderTop: '1px dashed #000000',
                margin: '6px 0',
              }}
            />

            {/* Receipt Meta Details */}
            <div style={{ fontSize: is58mm ? 9.5 : 10.5, color: '#000000', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span>Chek:</span>
                <span style={{ fontWeight: 700 }}>#{receiptNo}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span>Sana:</span>
                <span>{formatDate(sale?.created_at)}</span>
              </div>
              {identity.legacyMessage && (config.receipt_show_cashier !== false || config.receipt_show_customer !== false) && <div style={{ fontSize: 9, marginTop: 5 }}>{identity.legacyMessage}</div>}
              {config.receipt_show_cashier !== false && <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span>Kassir:</span>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '65%' }}>
                  {identity.cashier || '—'}
                </span>
              </div>}
              {counterparty && config.receipt_show_customer !== false && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>Mijoz:</span>
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '65%' }}>
                    {counterparty}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span>To‘lov:</span>
                <span style={{ fontWeight: 700 }}>
                  {formatPaymentType(sale?.payment_type)}
                </span>
              </div>
            </div>

            {/* Separator */}
            <div
              style={{
                borderTop: '1px dashed #000000',
                margin: '6px 0',
              }}
            />

            {/* Items Column Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: is58mm ? 9.5 : 10.5,
                fontWeight: 700,
                textTransform: 'uppercase',
                borderBottom: '1px solid #000000',
                paddingBottom: 3,
                marginBottom: 5,
              }}
            >
              <span style={{ flex: 1 }}>TOVAR NOMI</span>
              <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>JAMI</span>
            </div>

            {/* Items List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {items.map((it, idx) => {
                const name =
                  it.product_name ||
                  it.product_variant_name ||
                  it.variant_name ||
                  it.name ||
                  `Tovar #${it.product_variant || it.id || idx + 1}`;
                const variantExtra =
                  it.product_variant_name && it.product_variant_name !== name && it.product_variant_name.toLowerCase() !== 'standart'
                    ? ` (${it.product_variant_name})`
                    : '';
                const qty = Number(it.quantity || 1);
                const unitPrice = Number(it.unit_price || 0);
                const lineTotal = Number(it.total_price || (unitPrice * qty) || 0);
                const unit = it.unit || it.unit_type || 'ta';

                return (
                  <div key={idx} style={{ fontSize: is58mm ? 9.5 : 10.5 }}>
                    <div style={{ fontWeight: 700, color: '#000000', wordBreak: 'break-word', lineHeight: 1.25 }}>
                      {idx + 1}. {name}{variantExtra}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', color: '#000000', marginTop: 1, paddingLeft: 6 }}>
                      <span style={{ fontSize: is58mm ? 9 : 10 }}>
                        {formatQty(qty, unit)} × {formatMoney(unitPrice, cur)}
                        {config.is_vat_payer && !config.price_includes_vat && ' (QQSsiz)'}
                      </span>
                      <span style={{ fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {formatMoney(lineTotal, cur)}
                      </span>
                    </div>
                    <ReceiptItemCodes item={it} />
                    {config.is_vat_payer && config.receipt_show_item_tax !== false && it.tax_rate != null && (
                      <div style={{ fontSize: 9, paddingLeft: 6, marginTop: 2 }}>
                        QQS {Number(it.tax_rate)}%: {formatMoney(it.tax_amount, cur)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Separator */}
            <div
              style={{
                borderTop: '1px dashed #000000',
                margin: '7px 0 5px',
              }}
            />

            {/* Total, Payment, QR & Barcode Footer Section (Never split across pages) */}
            <div
              className="receipt-footer-section"
              style={{
                breakInside: 'avoid',
                pageBreakInside: 'avoid',
              }}
            >
              {/* Total Section (Pure receipt text, NO gray boxes/frames!) */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  padding: '2px 0',
                }}
              >
                <span style={{ fontSize: is58mm ? 12 : 13, fontWeight: 700, textTransform: 'uppercase' }}>
                  JAMI:
                </span>
                <span style={{ fontSize: is58mm ? 14 : 16, fontWeight: 700, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {formatMoney(totalAmount, cur)}
                </span>
              </div>

              {Number(sale?.refunded_amount || 0) > 0 && <>
                <div>Qaytarilgan: {formatMoney(sale.refunded_amount, cur)}</div>
                <div><strong>Qaytarishdan keyingi summa: {formatMoney(sale.net_amount ?? totalAmount - Number(sale.refunded_amount), cur)}</strong></div>
              </>}
              <ReceiptTaxSummary sale={sale} formatMoney={formatMoney} />
              {Number(sale?.refunded_amount || 0) > 0 && config.is_vat_payer && <div style={{ fontSize: 9 }}>QQS yuqorida asl savdo uchun ko‘rsatilgan.</div>}

              {/* Optional Cash & Change Breakdown */}
              {sale?.payment_type === 'cash' && (isUsd ? paidAmountUSD : paidAmountUZS) && (
                <div
                  style={{
                    borderTop: '1px dotted #000000',
                    marginTop: 4,
                    paddingTop: 4,
                    fontSize: is58mm ? 9.5 : 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span>Naqd:</span>
                    <span>{formatMoney(isUsd ? paidAmountUSD : paidAmountUZS, cur)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontWeight: 700 }}>
                    <span>Qaytim:</span>
                    <span>{formatMoney(isUsd ? (changeDueUSD || 0) : (changeDueUZS || 0), cur)}</span>
                  </div>
                </div>
              )}

              {/* Separator */}
              <div
                style={{
                  borderTop: '1px dashed #000000',
                  margin: '7px 0 5px',
                }}
              />

              {/* QR Code (Has dashed border frame!) */}
              {showQrCode && sale?.public_token && (
                <ReceiptQRCode
                  value={receiptShareURL(sale.public_token) || ''}
                  size={is58mm ? 84 : 105}
                />
              )}

              <div style={{ textAlign: 'center', marginTop: 8, fontSize: 9, color: '#000000', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ fontWeight: 700, fontSize: is58mm ? 9.5 : 10.5 }}>XARIDINGIZ UCHUN RAHMAT!</div>
                {config.receipt_footer && (
                  <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4, margin: '2px 0', fontSize: is58mm ? 8.5 : 9.5 }}>
                    {config.receipt_footer}
                  </div>
                )}
                <div style={{ marginTop: 2, fontSize: 8.5, color: '#000000' }}>ilbi.uz</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
