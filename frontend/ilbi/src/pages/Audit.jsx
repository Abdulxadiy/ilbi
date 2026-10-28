import { RetryButton } from '../components/common/RecoveryNotice';
import IlbiLoader from '../components/common/IlbiLoader';
import RemoteTenantSelect from '../components/common/RemoteTenantSelect';
import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Eye } from 'lucide-react';
import { auditApi } from '../api/client';
import Modal from '../components/common/Modal';
import { useAuth } from '../hooks/useAuth';
import { redactSensitiveData, safeDisplayText } from '../utils/safePresentation.js';

export default function Audit() {
  const { isAdmin } = useAuth();
  const [logs, setLogs] = useState([]);
  const [selectedAction, setSelectedAction] = useState('');
  const [selectedTenant, setSelectedTenant] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [viewLog, setViewLog] = useState(null);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await auditApi.getLogs({
        action: selectedAction || undefined,
        tenant_id: isAdmin && selectedTenant ? selectedTenant : undefined,
        page,
      });
      const list = res.results || res;
      setLogs(Array.isArray(list) ? list : []);
      setTotal(Number(res.count ?? list.length ?? 0));
    } catch (error) {
      setLogs([]);
      setTotal(0);
      setLoadError(error.message || 'Audit jurnali yuklanmadi');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, page, selectedAction, selectedTenant]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const actionLabels = {
    catalog_create: 'Katalogga qo‘shildi',
    catalog_update: 'Katalog tahrirlandi',
    catalog_archive: 'Katalog arxivlandi',
    catalog_restore: 'Katalog tiklandi',
    catalog_delete: 'Katalogdan o‘chirildi',
    account_identity_update: 'Login va Telegram yangilandi',
    support_telegram_settings: 'Yordam bildirishnomalari sozlandi',
    catalog_import: 'Katalog fayldan yuklandi',
    barcode_generate: 'Shtrix-kod yaratildi',
    price_change: 'Narx o‘zgarishi',
    employee_hire: 'Xodim qabul qilindi',
    employee_fire: 'Xodim bo‘shatildi',
    employee_update: 'Xodim tahrirlandi',
    employee_block: 'Hisob bloklandi',
    employee_unblock: 'Hisob blokdan chiqarildi',
    employee_archive: 'Xodim o‘chirildi',
    employee_restore: 'Xodim yozuvi tiklandi',
    employee_invite: 'Email havolasi yuborish',
    owner_transfer: 'Egalik o‘tkazildi',
    tenant_create: 'Do‘kon yaratildi',
    void_sale: 'Savdo bekor qilindi',
    stock_adjustment: 'Ombor tuzatildi',
    cash_discrepancy: 'Kassa tafovuti',
    login_attempt: 'Kirish urinishi',
    password_reset: 'Parol yangilandi',
    receipt_token_rotate: 'Chek havolasi yangilandi',
    seller_profile_submit: 'Sotuvchi profili yuborildi',
    seller_profile_review: 'Sotuvchi profili tekshirildi',
    seller_profile_binding: 'Sotuvchi profili bog‘landi',
    tenant_transfer_dispatch: 'Transfer jo‘natildi',
    tenant_transfer_receive: 'Transfer qabul qilindi',
    tenant_transfer_discrepancy: 'Transfer tafovuti',
    tenant_transfer_return: 'Transfer qaytdi',
    b2b_return_pending: 'B2B qaytish kutilmoqda',
    b2b_return_receive: 'B2B qaytish qabul qilindi',
    b2b_return_discrepancy_close: 'B2B tafovuti yopildi',
  };

  const pageCount = Math.max(1, Math.ceil(total / 20));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Banner */}
      <div
        className="glass-card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
        }}
      >
        <ShieldCheck size={26} color="var(--primary)" />
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>
            Audit jurnali
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            Amallar ilova darajasida append-only saqlanadi. Muhim o‘zgarishlar, ijrochi va vaqtini shu yerda kuzating.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        <button
          onClick={() => { setSelectedAction(''); setPage(1); }}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            border: selectedAction === '' ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
            background: selectedAction === '' ? 'var(--primary)' : 'var(--bg-card)',
            color: selectedAction === '' ? 'var(--primary-foreground)' : 'var(--text-secondary)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Barcha Amallar
        </button>
        {Object.entries(actionLabels).map(([key, label]) => {
          const active = selectedAction === key;
          return (
            <button
              key={key}
              onClick={() => { setSelectedAction(key); setPage(1); }}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-full)',
                border: active ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
                background: active ? 'var(--primary)' : 'var(--bg-card)',
                color: active ? 'var(--primary-foreground)' : 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span>Do‘kon bo‘yicha:</span>
          <div style={{ width: 'min(360px, 100%)' }}>
            <RemoteTenantSelect allowAll value={selectedTenant}
              onChange={value => { setSelectedTenant(value); setPage(1); }} />
          </div>
        </div>
      )}

      {loadError && <div className="glass-card" role="alert" style={{ padding: 14, color: 'var(--accent-rose)' }}>{loadError} <RetryButton onClick={loadLogs} loading={loading}>Qayta urinish</RetryButton></div>}

      {/* Audit Log Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-responsive">
          <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', textAlign: 'left', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                <th style={{ padding: '14px 20px', whiteSpace: 'nowrap' }}>Amal</th>
                {isAdmin && <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Do‘kon</th>}
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Bajargan Shaxs</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Tafsilot / Tavsif</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>IP Manzil</th>
                <th style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>Sana & Vaqt</th>
                <th style={{ padding: '14px 20px', textAlign: 'right', whiteSpace: 'nowrap' }}>O‘zgarish</th>
              </tr>
            </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}><IlbiLoader label="Yuklanmoqda..." /></td>
              </tr>
            ) : logs.length > 0 ? (
              logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '14px 20px' }}>
                    <span
                      style={{
                        padding: '4px 9px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        background: 'var(--primary-light)',
                        color: 'var(--primary)',
                      }}
                    >
                      {actionLabels[log.action] || log.action}
                    </span>
                  </td>
                  {isAdmin && <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{log.tenant_name || (log.tenant ? `#${log.tenant}` : 'Platforma')}</td>}
                  <td style={{ padding: '14px 16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {log.actor_name || log.actor?.username || `Foydalanuvchi #${log.actor || 'Tizim'}`}
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: 13 }}>
                    {safeDisplayText(log.description || `${log.target_model || ''} #${log.target_id || ''}`)}
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>
                    {log.ip_address || '—'}
                  </td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: 12 }}>
                    {new Date(log.created_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}
                  </td>
                  <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                    {log.changes && Object.keys(log.changes).length > 0 ? (
                      <button
                        onClick={() => setViewLog(log)}
                        style={{
                          padding: '5px 10px',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--border-card)',
                          background: 'var(--bg-card)',
                          color: 'var(--text-primary)',
                          fontSize: 12,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Eye size={13} />
                        <span>Diff ko‘rish</span>
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Audit yozuvlari mavjud emas</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 13, color: 'var(--text-muted)' }}>
        <span>{total} ta yozuv · {page}/{pageCount} sahifa</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Oldingi</button>
          <button className="btn btn-secondary" disabled={loading || page >= pageCount} onClick={() => setPage((value) => value + 1)}>Keyingi</button>
        </div>
      </div>

      {/* Changes Diff Modal */}
      <Modal isOpen={Boolean(viewLog)} onClose={() => setViewLog(null)} title="Amal O‘zgarishlari Tafsiloti">
        {viewLog && (
          <div>
            <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
              <strong>Amal:</strong> {actionLabels[viewLog.action] || viewLog.action} | <strong>Bajargan:</strong> {viewLog.actor_name || 'Foydalanuvchi'}
            </div>
            <pre
              style={{
                background: 'var(--bg-card)',
                padding: 16,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--primary)',
                fontSize: 13,
                fontFamily: 'monospace',
                overflowX: 'auto',
                maxHeight: 300,
              }}
            >
              {JSON.stringify(redactSensitiveData(viewLog.changes), null, 2)}
            </pre>
            <div style={{ textAlign: 'right', marginTop: 16 }}>
              <button
                onClick={() => setViewLog(null)}
                style={{
                  padding: '8px 18px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Yopish
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
