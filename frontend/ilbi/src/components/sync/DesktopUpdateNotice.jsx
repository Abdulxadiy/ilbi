import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X, CheckCircle2 } from 'lucide-react';
import { claimUpdateReminder, updateDay } from '../../utils/updateReminder';
import './DesktopUpdateNotice.css';

export default function DesktopUpdateNotice({ accountId, sessionId }) {
  const bridge = window.ilbiDesktop;
  const [status, setStatus] = useState(null);
  const [reminder, setReminder] = useState(null);
  const claimed = useRef('');
  const [day, setDay] = useState(updateDay);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  useEffect(() => {
    const refresh = () => { setDay(updateDay()); setVisible(document.visibilityState !== 'hidden'); };
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh); window.addEventListener('focus', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    if (!bridge?.getUpdateStatus) return;
    let alive = true;
    const receive = value => { if (alive && value) setStatus(previous => ({ ...previous, ...value })); };
    const unsubscribe = bridge.onUpdateStatus(receive);
    bridge.getUpdateStatus().then(receive).catch(() => {});
    const online = () => { bridge.checkForUpdates().catch(() => {}); };
    window.addEventListener('online', online);
    return () => { alive = false; unsubscribe(); window.removeEventListener('online', online); };
  }, [bridge]);
  useEffect(() => { if (accountId && bridge?.checkForUpdates) void bridge.checkForUpdates().catch(() => {}); }, [accountId, sessionId, bridge]);
  const eligible = status?.phase === 'available' || status?.phase === 'error' && Boolean(status.bytes);
  const installed = status && [status.installedVersion || bridge?.version, status.installedBuild || ''].join(':');
  const offered = status && [status.version, status.availableBuild || ''].join(':');
  const id = [accountId, installed, offered, day].join('|');
  useEffect(() => {
    if (!eligible || !accountId || !visible || claimed.current === id) return;
    // A canceled/hidden render must not consume today's reminder.
    const frame = requestAnimationFrame(() => {
      claimed.current = id;
      let storage; try { storage = window.localStorage; } catch {}
      if (claimUpdateReminder(storage, { account: accountId, installed, offered, day })) setReminder({ id, visible: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [accountId, day, eligible, id, installed, offered, visible]);
  const busy = ['downloading', 'verifying', 'preparing', 'installing'].includes(status?.phase);
  const shown = reminder?.id === id && reminder.visible;
  if (!bridge?.getUpdateStatus || !status || !accountId || !busy && !shown || !['available', 'downloading', 'verifying', 'preparing', 'installing', 'updated', 'error'].includes(status.phase)) return null;
  // A background connectivity error should not interrupt a store with no known update.
  if (status.phase === 'error' && !status.bytes) return null;
  const action = () => bridge.updateApp().catch(error => setStatus(previous => ({ ...previous, phase: 'error', message: error.message })));
  return <aside className="desktop-update-notice" aria-label="ILBI yangilanishi">
    <div className="desktop-update-heading">{status.phase === 'updated' ? <CheckCircle2 size={20} /> : busy ? <RefreshCw size={20} className="desktop-update-spinner" /> : <Download size={20} />}<strong>{status.phase === 'updated' ? 'ILBI yangilandi' : 'ILBI yangilanishi'}</strong>
      {!busy && <button type="button" className="desktop-update-close" aria-label="Yangilanish xabarini yopish" onClick={() => setReminder({ id, visible: false })}><X size={17} /></button>}</div>
    <p role="status" aria-live="polite">{status.message}</p>
    {busy && <progress aria-label="Yangilanish yuklanishi" max="100" value={status.progress ?? undefined} />}
    {busy && status.progress !== null && <small>{status.progress}%</small>}
    {!busy && status.phase !== 'updated' && <><small>Ochiq shakllarni saqlang. Yuklashdan keyin ILBI qisqa yopilib, o‘zi qayta ochiladi.</small><button className="btn btn-primary" type="button" onClick={action}><Download size={16} />{status.phase === 'error' ? 'Qayta urinish' : 'Yuklab olish va yangilash'}</button></>}
  </aside>;
}
