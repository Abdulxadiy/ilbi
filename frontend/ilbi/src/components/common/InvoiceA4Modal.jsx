import { savedReceiptIdentity } from '../../utils/receiptIdentity.js';
import { localStore } from '../../utils/brandStorage.js';
import React, { useState, useEffect, useRef } from 'react';
import {
  Printer,
  FileText,
  PenTool,
  RotateCcw,
  Check,
  ChevronRight,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import Modal from './Modal';
import ShareDocumentButton from './ShareDocumentButton';
import { useAuth } from '../../hooks/useAuth';
import { useTenant } from '../../context/TenantContext';
import { numberToWordsUzbek } from '../../utils/numberToWordsUzbek';

/**
 * Print A4 invoice in a clean, fully isolated hidden iframe.
 * Guarantees zero bleed of web UI, dark mode styling, buttons or headers into the printed document or exported PDF!
 */
export function printInvoiceA4(elementId = 'printable-invoice-a4', title = 'ILBI Hisob-Faktura') {
  const printEl = document.getElementById(elementId);
  if (!printEl) {
    window.print();
    return;
  }

  const existingIframe = document.getElementById('ilbi-invoice-a4-iframe');
  if (existingIframe) {
    existingIframe.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'ilbi-invoice-a4-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="uz">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          @page {
            size: A4 portrait;
            margin: 12mm 15mm 12mm 15mm;
          }
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }
          html, body {
            background: #ffffff !important;
            color: #111827 !important;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.35;
            width: 100%;
            margin: 0;
            padding: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          table {
            width: 100%;
            border-collapse: collapse;
          }
          thead {
            display: table-header-group;
          }
          tfoot {
            display: table-footer-group;
          }
          tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          th, td {
            border: 1px solid #374151;
            padding: 5px 8px;
            font-size: 10pt;
          }
          th {
            background-color: #f3f4f6 !important;
            font-weight: 700;
            text-align: center;
          }
          .invoice-summary-block,
          .invoice-signatures-block {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
          img {
            max-width: 100%;
            height: auto;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .font-bold { font-weight: 700; }
        </style>
      </head>
      <body>
        ${printEl.innerHTML}
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      window.print();
    }
  }, 250);
}

/**
 * High-definition Canvas Signature Pad for Touch & Mouse drawing
 */
function SignaturePad({ onSave, onCancel, title, signerName, isStep1 = true }) {
  const canvasRef = useRef(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const isDrawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 2;
    canvas.width = 520 * ratio;
    canvas.height = 200 * ratio;
    canvas.style.width = '100%';
    canvas.style.maxWidth = '520px';
    canvas.style.height = '200px';
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a'; // authentic navy dark ink
    ctx.lineWidth = 2.6;
    ctx.clearRect(0, 0, 520, 200);
    setHasDrawn(false);
  }, [title, signerName]);

  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
    isDrawingRef.current = true;
    setHasDrawn(true);
    e.target.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = (e) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    try {
      e.target.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 2;
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    setHasDrawn(false);
  };

  const handleConfirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--bg-card)',
        padding: 20,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-card)',
      }}
    >
      <div style={{ width: '100%', marginBottom: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
          Mas’ul shaxs: <strong style={{ color: 'var(--primary)' }}>{signerName}</strong>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          (Sichqoncha yoki sensorli ekran orqali pastdagi katakchaga imzo chizing)
        </div>
      </div>

      {/* Drawing Canvas Box */}
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          height: 200,
          background: '#ffffff',
          borderRadius: 8,
          border: '2px dashed #94a3b8',
          position: 'relative',
          touchAction: 'none',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.06)',
          cursor: 'crosshair',
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
        />

        {/* Faint signature baseline guide */}
        <div
          style={{
            position: 'absolute',
            bottom: 36,
            left: 30,
            right: 30,
            borderBottom: '1px dashed #cbd5e1',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            left: 32,
            fontSize: 10,
            color: '#94a3b8',
            fontFamily: 'monospace',
            pointerEvents: 'none',
            textTransform: 'uppercase',
          }}
        >
          X Imzo chizig‘i
        </div>

        {!hasDrawn && (
          <div
            style={{
              position: 'absolute',
              top: '40%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#94a3b8',
              fontSize: 13,
              pointerEvents: 'none',
              textAlign: 'center',
            }}
          >
            Ushbu maydonga imzo qo‘ying
          </div>
        )}
      </div>

      {/* Buttons */}
      <div
        style={{
          width: '100%',
          maxWidth: 520,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 14,
        }}
      >
        <button
          type="button"
          onClick={clearCanvas}
          disabled={!hasDrawn}
          title="Chizilgan chiziqlarni tozalab qaytadan chizish"
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-xs)',
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: hasDrawn ? 'var(--text-secondary)' : 'var(--text-muted)',
            fontSize: 12,
            fontWeight: 600,
            cursor: hasDrawn ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <RotateCcw size={13} />
          <span>Qayta chizish</span>
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--border-card)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isStep1 ? 'Bekor qilish' : '← Orqaga'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!hasDrawn}
            style={{
              padding: '8px 20px',
              borderRadius: 'var(--radius-xs)',
              border: 'none',
              background: hasDrawn ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
              color: hasDrawn ? 'var(--primary-foreground)' : 'var(--text-muted)',
              fontSize: 12,
              fontWeight: 700,
              cursor: hasDrawn ? 'pointer' : 'not-allowed',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {isStep1 ? (
              <>
                <span>Keyingi: Qabul qiluvchi imzosiga</span>
                <ChevronRight size={14} />
              </>
            ) : (
              <>
                <Check size={14} />
                <span>Imzolarni Fakturaga biriktirish</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Standard A4 Outgoing Invoice / Consignment Note Modal
 */
export default function InvoiceA4Modal({
  isOpen,
  onClose,
  sale,
  tenantName = null,
}) {
  const { user } = useAuth();
  const { activeTenant } = useTenant();

  // Signature state
  const [signingModalOpen, setSigningModalOpen] = useState(false);
  const [signStep, setSignStep] = useState('sender'); // 'sender' | 'receiver'
  const [tempSenderSig, setTempSenderSig] = useState(null);
  const [signatures, setSignatures] = useState({
    sender: null,
    receiver: null,
    signedAt: null,
  });

  // Load existing signature for this sale from localStore
  useEffect(() => {
    if (!sale?.id) {
      setSignatures({ sender: null, receiver: null, signedAt: null });
      return;
    }
    const saved = localStore.getItem(`ilbi_invoice_signatures_${activeTenant?.id || 'pending'}_${sale.id}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSignatures(parsed);
      } catch {
        setSignatures({ sender: null, receiver: null, signedAt: null });
      }
    } else {
      setSignatures({ sender: null, receiver: null, signedAt: null });
    }
  }, [sale?.id, activeTenant?.id]);

  if (!isOpen || !sale) return null;

  const identity = savedReceiptIdentity(sale, {
    store: tenantName || user?.tenant_name || user?.tenant?.name || 'ILBI SAVDO TIZIMI',
    phone: user?.contact_phone || user?.phone_number || '',
    cashier: user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : 'Sotuvchi',
  });
  const store = identity.store || '—', storePhone = identity.phone;
  const cashier = identity.cashier || '—';
  const buyerName = identity.customer || identity.recipient || 'Chakana xaridor';
  const buyerPhone = identity.customerPhone || '—';

  const receiptNum = sale.receipt_number || String(sale.id || '');
  const invoiceNumber = receiptNum.startsWith('REC-') ? receiptNum.replace('REC-', 'INV-') : `INV-${receiptNum}`;

  const dateObj = sale.created_at ? new Date(sale.created_at) : new Date();
  const monthsUz = [
    'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
    'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'
  ];
  const dateFormatted = `${dateObj.getDate()}-${monthsUz[dateObj.getMonth()]} ${dateObj.getFullYear()}-yil`;
  const timeFormatted = `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

  const isDebt = String(sale.payment_type || '').toLowerCase() === 'debt';
  const isPartner = Boolean(sale.is_partner_sale);

  // Dynamic Document Title based on business type
  const documentTitle = (() => {
    if (isDebt) return 'NASIYA CHIQIM FAKTURASI / YUK XATI';
    if (isPartner && String(sale.payment_type || '').toLowerCase() === 'cash') {
      return 'ULGURJI HAMKOR CHIQIM FAKTURASI (NAQD TO‘LANGAN)';
    }
    if (isPartner && String(sale.payment_type || '').toLowerCase() === 'card') {
      return 'ULGURJI HAMKOR CHIQIM FAKTURASI (BANK O‘TKAZMASI / KARTA)';
    }
    return 'CHIQIM HISOB-FAKTURASI / YUK XATI';
  })();

  const paymentTypeLabel = (() => {
    const p = String(sale.payment_type || 'cash').toLowerCase();
    if (p === 'debt') return 'Nasiya (Qarz hisobiga — to‘lov muddati shartnoma bo‘yicha)';
    if (isPartner && p === 'cash') return 'To‘langan: Naqd pul (Ulgurji 1-Narx / Hamkor savdosi)';
    if (isPartner && p === 'card') return 'To‘langan: Bank plastik kartasi (Ulgurji 1-Narx)';
    if (p === 'card') return 'To‘langan: Bank plastik kartasi';
    return 'To‘langan: Naqd pul';
  })();

  const items = Array.isArray(sale.items) ? sale.items : [];
  const currency = String(sale.currency || 'UZS').toUpperCase();
  const totalAmount = Number(sale.net_amount ?? sale.total_amount ?? 0);

  const totalQuantity = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);
  const wordsAmount = numberToWordsUzbek(totalAmount, currency);

  const handlePrint = () => {
    printInvoiceA4('printable-invoice-a4', `Hisob-faktura ${invoiceNumber}`);
  };

  const hasSignatures = Boolean(signatures.sender && signatures.receiver);

  // Start Multi-step Signature Flow
  const startSigning = () => {
    // Once invoice is signed by both parties, updating is strictly blocked
    if (hasSignatures) return;
    setSignStep('sender');
    setTempSenderSig(null);
    setSigningModalOpen(true);
  };

  const handleSenderSave = (sigDataUrl) => {
    setTempSenderSig(sigDataUrl);
    setSignStep('receiver');
  };

  const handleReceiverSave = (sigDataUrl) => {
    if (hasSignatures) return;
    const finalSigs = {
      sender: tempSenderSig,
      receiver: sigDataUrl,
      signedAt: new Date().toLocaleString('uz-UZ'),
    };
    setSignatures(finalSigs);
    if (sale?.id) {
    localStore.setItem(`ilbi_invoice_signatures_${activeTenant?.id || 'pending'}_${sale.id}`, JSON.stringify(finalSigs));
    }
    setSigningModalOpen(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Rasmiy Hisob-Faktura (A4 format)"
      maxWidth={900}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Top Control Bar */}
        <div
          className="no-print"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'var(--bg-input)',
            padding: '10px 16px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <FileText size={18} style={{ color: 'var(--primary)' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              Faktura № {invoiceNumber}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              ({items.length} ta tovar pozitsiyasi)
            </span>
            {hasSignatures && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: 'var(--accent-emerald)',
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                <CheckCircle2 size={12} />
                <span>2 tomonlama imzolangan</span>
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {/* Signature button / Locked status */}
            {hasSignatures ? (
              <div
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  background: 'rgba(16, 185, 129, 0.12)',
                  color: 'var(--accent-emerald)',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  userSelect: 'none',
                }}
                title="Hujjat rasman imzolangan va qulflangan. Imzolarni qayta yangilash yoki o‘zgartirish butunlay taqiqlangan."
              >
                <Lock size={14} />
                <span>Imzolangan (O‘zgartirib bo‘lmaydi)</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={startSigning}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--primary)',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <PenTool size={14} />
                <span>Ekranda elektron imzolash</span>
              </button>
            )}

            <ShareDocumentButton
              elementId="printable-invoice-a4"
              title={`Hisob-faktura ${invoiceNumber}`}
              format="invoice"
            />

            <button
              type="button"
              onClick={handlePrint}
              style={{
                padding: '8px 18px',
                borderRadius: 'var(--radius-xs)',
                border: 'none',
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
              }}
            >
              <Printer size={15} />
              <span>Chop etish / PDF saqlash</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-secondary)',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Yopish
            </button>
          </div>
        </div>

        {/* Modal: Interactive Signature Drawer (if signing open) */}
        {signingModalOpen && (
          <div className="no-print" style={{ marginBottom: 8 }}>
            {signStep === 'sender' ? (
              <SignaturePad
                key="signature-step-sender"
                title="1-bosqich (1/2): Topshiruvchi (Sotuvchi) Imzosi"
                signerName={cashier}
                isStep1={true}
                onSave={handleSenderSave}
                onCancel={() => setSigningModalOpen(false)}
              />
            ) : (
              <SignaturePad
                key="signature-step-receiver"
                title="2-bosqich (2/2): Qabul qiluvchi (Xaridor / Hamkor) Imzosi"
                signerName={buyerName}
                isStep1={false}
                onSave={handleReceiverSave}
                onCancel={() => setSignStep('sender')}
              />
            )}
          </div>
        )}

        {/* Realistic A4 Paper Preview Container */}
        <div
          style={{
            maxHeight: signingModalOpen ? '48vh' : '72vh',
            overflow: 'auto',
            background: 'var(--bg-input, #334155)',
            padding: '24px 16px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            transition: 'max-height 0.2s ease',
          }}
        >
          {/* Printable A4 Document Sheet */}
          <div
            id="printable-invoice-a4"
            style={{
              width: '100%',
              maxWidth: '750px',
              minHeight: '960px',
              height: 'fit-content',
              alignSelf: 'flex-start',
              background: '#ffffff',
              color: '#111827',
              padding: '36px 42px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
              borderRadius: 2,
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
              fontSize: '13px',
              lineHeight: 1.4,
              boxSizing: 'border-box',
            }}
          >
            {/* Header: Store details & Invoice title */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                borderBottom: '2px solid #111827',
                paddingBottom: 16,
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', letterSpacing: '-0.02em' }}>
                  {store}
                </div>
                <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>
                  Savdo va ombor hisobi tizimi
                </div>
                {storePhone && (
                  <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>
                    Aloqa: <strong>{storePhone}</strong>
                  </div>
                )}
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#111827', textTransform: 'uppercase' }}>
                  {documentTitle}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#2563eb', fontFamily: 'monospace', marginTop: 3 }}>
                  № {invoiceNumber}
                </div>
                <div style={{ fontSize: 12, color: '#4b5563', marginTop: 2 }}>
                  Sana: <strong>{dateFormatted}</strong> ({timeFormatted})
                </div>
              </div>
            </div>

            {/* Parties Table / Requisites */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
                marginBottom: 20,
                background: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                padding: '12px 16px',
              }}
            >
              {/* Supplier / Seller */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                  Yetkazib beruvchi (Sotuvchi):
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                  {store}
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>
                  Mas’ul xodim: <strong>{cashier}</strong>
                </div>
                {identity.legacyMessage && <div style={{ fontSize: 10, marginTop: 6 }}>{identity.legacyMessage}</div>}
              </div>

              {/* Buyer / Customer */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                  Qabul qiluvchi (Xaridor / Hamkor):
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
                  {buyerName}
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>
                  Telefon: <strong>{buyerPhone}</strong>
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>
                  To‘lov holati: <strong>{paymentTypeLabel}</strong>
                </div>
              </div>
            </div>

            {/* Goods Table */}
            <div style={{ marginBottom: 20 }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: '12px',
                  color: '#111827',
                }}
              >
                <thead>
                  <tr style={{ background: '#f3f4f6', borderTop: '1px solid #374151', borderBottom: '1px solid #374151' }}>
                    <th style={{ padding: '7px 8px', border: '1px solid #374151', width: 34, textAlign: 'center' }}>№</th>
                    <th style={{ padding: '7px 10px', border: '1px solid #374151', textAlign: 'left' }}>Tovar nomi va tavsifi</th>
                    <th style={{ padding: '7px 8px', border: '1px solid #374151', width: 100, textAlign: 'center' }}>Kodi / Shtrixkod</th>
                    <th style={{ padding: '7px 8px', border: '1px solid #374151', width: 55, textAlign: 'center' }}>Birligi</th>
                    <th style={{ padding: '7px 8px', border: '1px solid #374151', width: 65, textAlign: 'center' }}>Miqdori</th>
                    <th style={{ padding: '7px 10px', border: '1px solid #374151', width: 110, textAlign: 'right' }}>Narxi ({currency})</th>
                    <th style={{ padding: '7px 10px', border: '1px solid #374151', width: 125, textAlign: 'right' }}>Jami qiymati ({currency})</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => {
                    const displayName = it.product_name || 'Tovar';
                    const variantSuffix =
                      it.product_variant_name && it.product_variant_name !== it.product_name
                        ? ` (${it.product_variant_name})`
                        : '';
                    const code = it.product_code || it.product_sku || '—';
                    const unit = it.unit || 'dona';
                    const qty = Number(it.quantity || 0);
                    const unitPrice = Number(it.unit_price || 0);
                    const lineTotal = Number(it.total_price || 0);

                    return (
                      <tr key={it.id || idx} style={{ borderBottom: '1px solid #d1d5db', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                        <td style={{ padding: '7px 8px', border: '1px solid #374151', textAlign: 'center', color: '#6b7280' }}>
                          {idx + 1}
                        </td>
                        <td style={{ padding: '7px 10px', border: '1px solid #374151', fontWeight: 600 }}>
                          {displayName}{variantSuffix}
                        </td>
                        <td style={{ padding: '7px 8px', border: '1px solid #374151', textAlign: 'center', fontFamily: 'monospace', fontSize: 11, color: '#4b5563' }}>
                          {code}
                        </td>
                        <td style={{ padding: '7px 8px', border: '1px solid #374151', textAlign: 'center' }}>
                          {unit}
                        </td>
                        <td style={{ padding: '7px 8px', border: '1px solid #374151', textAlign: 'center', fontWeight: 700 }}>
                          {qty.toLocaleString()}
                          {Number(it.voided_quantity || 0) > 0 && (
                            <div style={{ fontSize: 10, color: '#dc2626' }}>
                              (-{it.voided_quantity} qayt.)
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '7px 10px', border: '1px solid #374151', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {unitPrice.toLocaleString()}
                        </td>
                        <td style={{ padding: '7px 10px', border: '1px solid #374151', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {lineTotal.toLocaleString()}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Summary Totals Row */}
                  <tr style={{ background: '#f9fafb', fontWeight: 700, borderTop: '2px solid #374151', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                    <td colSpan={4} style={{ padding: '8px 10px', border: '1px solid #374151', textAlign: 'right', textTransform: 'uppercase', fontSize: 11 }}>
                      Jami tovarlar soni va qiymati:
                    </td>
                    <td style={{ padding: '8px 8px', border: '1px solid #374151', textAlign: 'center' }}>
                      {totalQuantity.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px 10px', border: '1px solid #374151', textAlign: 'right' }}>
                      —
                    </td>
                    <td style={{ padding: '8px 10px', border: '1px solid #374151', textAlign: 'right', fontSize: 13, color: '#111827' }}>
                      {totalAmount.toLocaleString()} {currency}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Total in words and terms block */}
            <div
              className="invoice-summary-block"
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 4,
                padding: '12px 16px',
                marginBottom: 24,
                background: '#fafafa',
                pageBreakInside: 'avoid',
                breakInside: 'avoid',
              }}
            >
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                {Number(sale.refunded_amount || 0) > 0 && <div>Chekning asl summasi: {sale.total_amount} {currency} · Qaytarilgan: {sale.refunded_amount} {currency}</div>}
                <strong style={{ color: '#111827' }}>Jami to‘lanishi lozim bo‘lgan summa:</strong>{' '}
                <span style={{ fontSize: 14, fontWeight: 800, color: '#111827' }}>
                  {totalAmount.toLocaleString()} {currency}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#374151', fontStyle: 'italic', marginBottom: 8 }}>
                <strong>So‘z bilan ifodasi:</strong> {wordsAmount}
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', borderTop: '1px dashed #e5e7eb', paddingTop: 6 }}>
                Tovarlar to‘liq miqdorda, soz va butun holatda topshirildi hamda qabul qilindi. Mahsulotlarning sifati, to‘liqligi va miqdori bo‘yicha tomonlar o‘rtasida hech qanday e’tirozlar yo‘q.
              </div>
            </div>

            {/* Signatures & Stamp area with Electronic Signatures */}
            <div
              className="invoice-signatures-block"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 32,
                marginTop: 16,
                paddingTop: 12,
                pageBreakInside: 'avoid',
                breakInside: 'avoid',
              }}
            >
              {/* Handed over by (Seller) */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 2 }}>
                  Topshirdi (Yetkazib beruvchi):
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
                  Moddiy javobgar shaxs / Sotuvchi
                </div>

                {signatures.sender ? (
                  <div style={{ minHeight: 64, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <img
                      src={signatures.sender}
                      alt="Topshiruvchi imzosi"
                      style={{ maxHeight: 52, maxWidth: 170, objectFit: 'contain', display: 'block', margin: '0 auto 2px 0' }}
                    />
                    <div style={{ borderBottom: '1px solid #111827', display: 'flex', justifyContent: 'space-between', paddingBottom: 2 }}>
                      <span style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>✓ Elektron imzo</span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>/ {cashier} /</span>
                    </div>
                    {signatures.signedAt && (
                      <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
                        Tasdiqlandi: {signatures.signedAt}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #111827', paddingBottom: 4, marginTop: 24 }}>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Imzo:</span>
                      <span style={{ flex: 1 }}></span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>/ {cashier} /</span>
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, fontStyle: 'italic' }}>
                  M.O‘. (Muhr o‘rni)
                </div>
              </div>

              {/* Received by (Buyer) */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', marginBottom: 2 }}>
                  Qabul qilib oldi (Oluvchi):
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
                  Xaridor / Hamkor
                </div>

                {signatures.receiver ? (
                  <div style={{ minHeight: 64, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <img
                      src={signatures.receiver}
                      alt="Qabul qiluvchi imzosi"
                      style={{ maxHeight: 52, maxWidth: 170, objectFit: 'contain', display: 'block', margin: '0 auto 2px 0' }}
                    />
                    <div style={{ borderBottom: '1px solid #111827', display: 'flex', justifyContent: 'space-between', paddingBottom: 2 }}>
                      <span style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>✓ Elektron imzo</span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>/ {buyerName} /</span>
                    </div>
                    {signatures.signedAt && (
                      <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>
                        Qabul qilindi: {signatures.signedAt}
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #111827', paddingBottom: 4, marginTop: 24 }}>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>Imzo:</span>
                      <span style={{ flex: 1 }}></span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>/ {buyerName} /</span>
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, fontStyle: 'italic' }}>
                  Sana: {signatures.signedAt ? signatures.signedAt.split(' ')[0] : '______________________'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
