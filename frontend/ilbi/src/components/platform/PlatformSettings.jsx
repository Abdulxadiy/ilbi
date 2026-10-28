import IlbiLoader from '../common/IlbiLoader';
import React, { useEffect, useState } from 'react';
import { Bell, Send, Save, ShieldCheck, KeyRound } from 'lucide-react';
import { platformApi } from '../../api/platform';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../context/ToastContext';
import IdentityRecoveryModal from '../common/IdentityRecoveryModal';
import CustomSelect from '../common/CustomSelect';
import './platform-admin.css';

export default function PlatformSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const payload = data ? { enabled: data.enabled, target: data.target, group_chat_id: data.group_chat_id } : {};
  const dirty = JSON.stringify(payload) !== saved;
  useEffect(() => {
    let cancelled = false;
    platformApi.supportSettings().then(value => {
      if (cancelled) return;
      setData(value); setSaved(JSON.stringify({ enabled: value.enabled, target: value.target, group_chat_id: value.group_chat_id }));
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, []);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const value = await platformApi.saveSupportSettings(payload);
      setData(value); setSaved(JSON.stringify({ enabled: value.enabled, target: value.target, group_chat_id: value.group_chat_id }));
      toast.success('Yordam bildirishnomalari saqlandi.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError('');
    try { const response = await platformApi.testSupportTelegram(); toast.success(response.detail); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="admin-page">
    <section className="glass-card admin-card admin-form">
      <div className="admin-heading"><span className="admin-icon"><Bell size={22} /></span><div><h3>Yordam markazi bildirishnomalari</h3><div className="admin-muted">Platformadagi yangi murojaat va mijoz xabarlari uchun Telegram xabarnomasi.</div></div></div>
      {!data ? <div role={error ? 'alert' : 'status'}>{error || <IlbiLoader label="Sozlamalar yuklanmoqda..." />}</div> : <form className="admin-form" onSubmit={save}>
        <label className="admin-check"><input type="checkbox" checked={data.enabled} onChange={event => setData({ ...data, enabled: event.target.checked })} /><span><strong>Telegram orqali xabardor qilish</strong><div className="admin-muted">Barcha do‘konlar va mehmonlarning yordam murojaatlari uchun.</div></span></label>
        <div className="admin-grid">
          <label className="admin-field">Qayerga yuborilsin?<CustomSelect data-api-field="target" fullWidth aria-label="Bildirishnoma manzili" value={data.target} onChange={target => setData({ ...data, target })} options={[{ value: 'personal', label: 'Mening shaxsiy Telegramimga' }, { value: 'group', label: 'Belgilangan guruhga' }, { value: 'both', label: 'Shaxsiy chat va guruhga' }]} /></label>
          {data.target !== 'personal' && <label className="admin-field">Guruh chat ID si<input data-api-field="group_chat_id" className="input-field" inputMode="text" placeholder="-1001234567890" pattern="-[1-9][0-9]*" required={data.enabled} value={data.group_chat_id} onChange={event => setData({ ...data, group_chat_id: event.target.value })} /><span className="admin-muted">Botni guruhga qo‘shing va xabar yuborishiga ruxsat bering.</span></label>}
        </div>
        {data.target !== 'group' && <div className="admin-note"><ShieldCheck size={18} /><span>{data.personal_linked ? 'Shaxsiy Telegramingiz ulangan.' : 'Shaxsiy Telegram ulanmagan. Botga /start yuborib, o‘z raqamingizni ulashing.'}</span></div>}
        {!data.bot_configured && <div className="admin-error">Telegram bot serverda sozlanmagan. Avval bot sozlamasini tekshiring.</div>}
        <div className="admin-note"><Bell size={18} /><span>Telegramga yangi xabar kelgani va murojaat havolasi boradi. Yozishma, rasmlar va shaxsiy ma’lumotlar yordam markazida qoladi.</span></div>
        {error && <div className="admin-error" role="alert">{error}</div>}
        <div className="admin-actions"><button type="button" className="btn btn-secondary" disabled={busy || dirty || !data.enabled} onClick={test}><Send size={15} />Sinov xabari</button><button className="btn btn-primary" disabled={busy || !dirty}><Save size={15} />{busy ? 'Kutilmoqda...' : 'Sozlamalarni saqlash'}</button></div>
      </form>}
    </section>
    <section className="glass-card admin-card admin-form"><div className="admin-heading"><span className="admin-icon"><KeyRound size={22} /></span><div><h3>Hisob va kirish xavfsizligi</h3><div className="admin-muted">Login raqami, shaxsiy Telegram va hisobni tiklash amallari auditda saqlanadi.</div></div></div><div className="admin-toolbar"><button className="btn btn-secondary" onClick={() => setIdentityOpen(true)}>O‘z login va Telegramimni boshqarish</button><a className="admin-link" href="/accounts">Barcha hisoblarni boshqarish →</a></div></section>
    <IdentityRecoveryModal key={identityOpen ? 'open' : 'closed'} userId={identityOpen ? user?.id : null} onClose={() => setIdentityOpen(false)} />
  </div>;
}
