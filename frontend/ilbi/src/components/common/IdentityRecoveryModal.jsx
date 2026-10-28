import IlbiLoader from './IlbiLoader';
import React, { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import PhoneInput from './PhoneInput';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../hooks/useAuth';
import '../platform/platform-admin.css';

export default function IdentityRecoveryModal({ userId, onClose, onSaved }) {
  const { user, logout } = useAuth();
  const [account, setAccount] = useState(null);
  const [form, setForm] = useState({ phone_number: '', telegram_chat_id: '', telegram_action: 'replace', reason: '', admin_password: '', ownership_verified: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    platformApi.identity(userId).then(data => {
      if (cancelled) return;
      setError('');
      setAccount(data);
      setForm({ phone_number: data.phone_number, telegram_chat_id: data.telegram_chat_id || '', telegram_action: 'replace', reason: '', admin_password: '', ownership_verified: false });
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [userId]);
  const change = (key, value) => setForm(previous => ({ ...previous, [key]: value }));
  const close = () => { if (!saving) { change('admin_password', ''); onClose(); } };
  async function save(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await platformApi.recoverIdentity(userId, { ...form, expected_phone_number: account.phone_number, expected_version: account.security_version });
      change('admin_password', ''); onSaved?.(); onClose();
      if (Number(userId) === Number(user?.id)) logout();
    } catch (err) { setError(err.message || 'O‘zgarishni saqlab bo‘lmadi.'); }
    finally { setSaving(false); }
  }
  return <Modal isOpen={Boolean(userId)} onClose={close} title="Login va Telegram ulanishi" maxWidth={570}>
    {!account ? <div role={error ? 'alert' : 'status'}>{error || <IlbiLoader label="Hisob yuklanmoqda..." />}</div> : <form className="admin-form" onSubmit={save}>
      <div className="admin-note"><KeyRound size={20} /><div><strong>{account.name}</strong><div className="admin-muted">{account.username || 'Login raqami'} · {account.phone_number}</div></div></div>
      <label className="admin-field">Login telefon raqami<PhoneInput data-api-field="phone_number" value={form.phone_number} required onChange={event => change('phone_number', event.target.value)} /></label>
      <label className="admin-check"><input type="checkbox" checked={form.telegram_action === 'unlink'} onChange={event => change('telegram_action', event.target.checked ? 'unlink' : 'replace')} />Telegram ulanishini uzish, keyin botdan qayta ulash</label>
      {form.telegram_action === 'replace' && <label className="admin-field">Shaxsiy Telegram chat ID<input data-api-field="telegram_chat_id" className="input-field" inputMode="numeric" required pattern="[1-9][0-9]*" value={form.telegram_chat_id} onChange={event => change('telegram_chat_id', event.target.value)} placeholder="Masalan: 123456789" /><span className="admin-muted">Botdagi /status orqali oling. Guruh ID si kirish kodi uchun ishlatilmaydi.</span></label>}
      <div className="admin-note admin-warning"><AlertTriangle size={18} /><span>Bu hisobning barcha do‘konlaridagi login o‘zgaradi. Eski sessiyalar va parol havolalari bekor qilinadi. Savdo tarixi saqlanadi.</span></div>
      <label className="admin-field">O‘zgartirish sababi<textarea data-api-field="reason" className="input-field" required minLength={5} maxLength={500} rows={2} value={form.reason} onChange={event => change('reason', event.target.value)} placeholder="Murojaat va tekshiruvning qisqa sababi" /></label>
      <label className="admin-check"><input type="checkbox" required checked={form.ownership_verified} onChange={event => change('ownership_verified', event.target.checked)} />Hisob egasi va yangi raqamga egaligini tekshirdim</label>
      <label className="admin-field">Administrator parolingiz<input data-api-field="admin_password" className="input-field" type="password" autoComplete="current-password" required value={form.admin_password} onChange={event => change('admin_password', event.target.value)} /></label>
      {error && <div className="admin-error" role="alert">{error}</div>}
      <div className="admin-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={close}>Bekor qilish</button><button className="btn btn-primary" disabled={saving}><ShieldCheck size={16} />{saving ? 'Saqlanmoqda...' : 'Tekshirib yangilash'}</button></div>
    </form>}
  </Modal>;
}
