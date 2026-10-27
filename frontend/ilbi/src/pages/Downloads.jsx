import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Download,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Laptop,
} from 'lucide-react';
import IlbiLogo from '../components/common/IlbiLogo';
import RecoveryNotice, { RetryButton } from '../components/common/RecoveryNotice';
import { desktopRequest } from '../components/sync/desktopApi';
import { useAuth } from '../hooks/useAuth';
import { mobileReleaseURL, releaseSize, releaseURL } from '../utils/downloads';
import { version } from '../../package.json';
import './Downloads.css';

function isNewerVersion(latest, current) {
  if (!latest || !current) return false;
  const p1 = latest.split('.').map(Number);
  const p2 = current.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return true;
    if (n1 < n2) return false;
  }
  return false;
}

function formatLastChecked(date) {
  if (!date) return 'Hali tekshirilmadi';
  const d = new Date(date);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `Bugun, ${hours}:${minutes}`;
}

export default function Downloads() {
  const { isAuthenticated } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);

  const bridge = typeof window !== 'undefined' ? window.ilbiDesktop : null;
  const currentVersion = bridge?.version || version;
  const isDesktop = Boolean(bridge);

  const requestedTab = searchParams.get('tab');
  const activeTab = isAuthenticated
    ? (requestedTab === 'downloads' ? 'downloads' : 'updates')
    : 'downloads';

  const setTab = (tab) => {
    if (!isAuthenticated) return;
    const nextParams = new URLSearchParams(searchParams);
    if (tab === 'downloads') {
      nextParams.set('tab', 'downloads');
    } else {
      nextParams.delete('tab');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const [updateStatus, setUpdateStatus] = useState(() => ({
    phase: 'idle',
    version: null,
    bytes: null,
    progress: null,
    message: '',
    lastChecked: null,
  }));
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (!bridge?.getUpdateStatus) return;

    let alive = true;
    const receive = (val) => {
      if (!alive || !val) return;
      setUpdateStatus((prev) => ({
        ...prev,
        ...val,
        lastChecked: prev.lastChecked || new Date(),
      }));
    };

    const unsubscribe = bridge.onUpdateStatus?.(receive) || (() => {});
    bridge.getUpdateStatus().then(receive).catch(() => {});

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [isAuthenticated, bridge]);

  const handleCheckUpdates = async () => {
    if (checking) return;
    setChecking(true);
    setUpdateStatus((prev) => ({
      ...prev,
      phase: 'checking',
      message: 'Yangilanish tekshirilmoqda…',
    }));

    try {
      if (bridge?.checkForUpdates) {
        const result = await bridge.checkForUpdates();
        setUpdateStatus((prev) => ({
          ...prev,
          ...(result || {}),
          lastChecked: new Date(),
        }));
      } else {
        const response = await fetch('/downloads/releases.json', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Yangilanish serveriga ulanib bo‘lmadi.');
        }
        const manifest = await response.json();
        const latestWin = manifest?.windows?.version;
        const latestLinux = manifest?.linux?.version;
        const latestVer = latestWin || latestLinux;

        if (latestVer && isNewerVersion(latestVer, version)) {
          setUpdateStatus((prev) => ({
            ...prev,
            phase: 'available',
            version: latestVer,
            bytes: manifest?.windows?.bytes || manifest?.linux?.bytes,
            message: `ILBI v${latestVer} yangi relizi chiqdi.`,
            lastChecked: new Date(),
          }));
        } else {
          setUpdateStatus((prev) => ({
            ...prev,
            phase: 'current',
            message: 'Siz ILBI tizimining eng so‘nggi talqinidan foydalanmoqdasiz.',
            lastChecked: new Date(),
          }));
        }
      }
    } catch (err) {
      setUpdateStatus((prev) => ({
        ...prev,
        phase: 'error',
        message: err.message || 'Yangilanishlarni tekshirib bo‘lmadi.',
        lastChecked: new Date(),
      }));
    } finally {
      setChecking(false);
    }
  };

  const handleStartUpdate = async () => {
    if (!bridge?.updateApp) return;
    try {
      await bridge.updateApp();
    } catch (err) {
      setUpdateStatus((prev) => ({
        ...prev,
        phase: 'error',
        message: err.message || 'Yangilash jarayonida xatolik yuz berdi.',
      }));
    }
  };

  const isBusy = ['downloading', 'verifying', 'preparing', 'installing'].includes(updateStatus.phase);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    async function load() {
      setState(previous => ({ ...previous, loading: true }));
      try {
        let manifest, origin = window.location.origin;
        if (window.ilbiDesktop) {
          const result = await desktopRequest('releases', undefined, { signal: controller.signal });
          manifest = result.release; origin = result.origin;
        } else {
          const response = await fetch('/downloads/releases.json', { signal: controller.signal, cache: 'no-store' });
          if (response.status === 404) { if (alive) setState({ loading: false, origin }); return; }
          if (!response.ok) throw Error('Yuklab olish serveri vaqtincha javob bermayapti. Birozdan keyin qayta urinib ko‘ring.');
          manifest = await response.json();
        }
        if (manifest?.schema !== 1) throw Error('Yuklamalar ro‘yxatini o‘qib bo‘lmadi. Birozdan keyin qayta tekshiring.');
        if (alive) setState({ loading: false, origin, manifest });
      } catch (error) {
        if (alive && error.name !== 'AbortError') setState({ loading: false, error: error instanceof TypeError
          ? 'Yuklab olish serveriga ulanib bo‘lmadi. Internet ishlayotgan bo‘lsa ham, server bilan ulanish vaqtincha uzilishi mumkin.'
          : error.message || 'Yuklamalar ro‘yxatini ochib bo‘lmadi. Qayta urinib ko‘ring.' });
      }
    }
    void load();
    return () => { alive = false; controller.abort(); };
  }, [attempt]);

  const windows = state.manifest?.windows;
  const linux = state.manifest?.linux;
  const mobile = state.manifest?.mobile;
  const android = mobile?.android || (mobile?.url ? mobile : null);
  const ios = mobile?.ios;
  const windowsURL = releaseURL(windows?.url, state.origin);
  const linuxURL = releaseURL(linux?.url, state.origin);
  const androidURL = state.origin ? mobileReleaseURL(android?.url, state.origin, 'android') : null;
  const iosURL = state.origin ? mobileReleaseURL(ios?.url, state.origin, 'ios') : null;

  return <div className="downloads-page">
    <header className="downloads-header">
      <Link to="/" aria-label="ILBI bosh sahifa"><IlbiLogo size={38} showText /></Link>
      <Link className="downloads-back" to={isAuthenticated ? '/dashboard' : '/'}>
        <ArrowLeft size={16} />{isAuthenticated ? 'Ish stoliga' : 'Asosiy sahifaga'}
      </Link>
    </header>

    {isAuthenticated && (
      <div className="downloads-tabs-container">
        <div className="downloads-tabs-nav" role="tablist" aria-label="Yuklamalar va yangilanishlar bo‘limi">
          <button
            type="button"
            role="tab"
            id="tab-updates"
            aria-selected={activeTab === 'updates'}
            aria-controls="panel-updates"
            className={`downloads-tab-pill ${activeTab === 'updates' ? 'active' : ''}`}
            onClick={() => setTab('updates')}
          >
            <RefreshCw size={15} className={checking || isBusy ? 'updates-spinner' : ''} />
            <span>Yangilanish</span>
            {updateStatus.phase === 'available' && <span className="downloads-tab-badge">Yangi</span>}
          </button>
          <button
            type="button"
            role="tab"
            id="tab-downloads"
            aria-selected={activeTab === 'downloads'}
            aria-controls="panel-downloads"
            className={`downloads-tab-pill ${activeTab === 'downloads' ? 'active' : ''}`}
            onClick={() => setTab('downloads')}
          >
            <Download size={15} />
            <span>Yuklab olish</span>
          </button>
        </div>
      </div>
    )}

    <main className="downloads-main">
      {activeTab === 'updates' ? (
        <section id="panel-updates" role="tabpanel" aria-labelledby="tab-updates" className="updates-tab-content">
          <span className="downloads-eyebrow">Dastur holati va yangilanishlar</span>
          <h1>Yangilanishlarni tekshirish</h1>
          <p className="downloads-intro">
            ILBI dasturining eng so‘nggi imkoniyatlari, xavfsizlik va tezlik yangilanishlaridan foydalaning.
          </p>

          <article className="updates-card">
            <div className="updates-header-row">
              <div className="updates-app-icon">
                <img src="/brand/ilbi-desktop.svg" width="48" height="48" alt="ILBI" />
              </div>
              <div className="updates-meta">
                <h2>{isDesktop ? 'ILBI Desktop' : 'ILBI Tizimi'}</h2>
                <div className="updates-version">Joriy talqin: <strong>v{currentVersion}</strong></div>
              </div>
              <span className="updates-platform-badge">
                {isDesktop ? 'Desktop ilovasi' : 'Veb ilova (Bulut)'}
              </span>
            </div>

            <div className="updates-status-box">
              {updateStatus.phase === 'checking' || checking ? (
                <div className="updates-status-main">
                  <div className="updates-status-icon-wrap">
                    <RefreshCw size={24} className="updates-spinner" />
                  </div>
                  <div>
                    <h3 className="updates-status-title">Yangilanish tekshirilmoqda…</h3>
                    <p className="updates-status-desc">Rasmiy serverdan yangi relizlar tekshirilmoqda.</p>
                  </div>
                </div>
              ) : updateStatus.phase === 'available' ? (
                <div className="updates-status-main">
                  <div className="updates-status-icon-wrap">
                    <Download size={24} className="updates-status-icon-accent" />
                  </div>
                  <div>
                    <h3 className="updates-status-title">Yangi talqin mavjud: v{updateStatus.version}</h3>
                    <p className="updates-status-desc">
                      ILBI ning yangi imkoniyatlari va tezlik yaxshilanishlari tayyor.
                      {updateStatus.bytes && ` Hajmi: ${releaseSize(updateStatus.bytes)}.`}
                    </p>
                    <div className="updates-action-row">
                      {bridge ? (
                        <button
                          type="button"
                          className="btn btn-primary updates-action-btn"
                          onClick={handleStartUpdate}
                        >
                          <Download size={16} />
                          Yuklab olish va yangilash
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-primary updates-action-btn"
                          onClick={() => setTab('downloads')}
                        >
                          <Download size={16} />
                          Yuklab olish bo‘limiga o‘tish
                        </button>
                      )}
                      <small className="updates-notice-text">
                        Ochiq shakllarni saqlang. Yangilanish o‘rnatilgach ilova qayta ochiladi.
                      </small>
                    </div>
                  </div>
                </div>
              ) : isBusy ? (
                <div className="updates-status-main">
                  <div className="updates-status-icon-wrap">
                    <RefreshCw size={24} className="updates-spinner" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 className="updates-status-title">Yangilanish tayyorlanmoqda…</h3>
                    <p className="updates-status-desc">
                      {updateStatus.message || 'Fayllar yuklanmoqda va tekshirilmoqda…'}
                    </p>
                    {updateStatus.progress !== null && (
                      <div className="updates-progress-wrap">
                        <progress max="100" value={updateStatus.progress ?? undefined} />
                        <span>{updateStatus.progress}%</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : updateStatus.phase === 'updated' ? (
                <div className="updates-status-main">
                  <div className="updates-status-icon-wrap">
                    <CheckCircle2 size={24} className="updates-status-icon-success" />
                  </div>
                  <div>
                    <h3 className="updates-status-title">ILBI muvaffaqiyatli yangilandi!</h3>
                    <p className="updates-status-desc">
                      Siz dasturning eng so‘nggi talqinidan (v{currentVersion}) foydalanmoqdasiz.
                    </p>
                  </div>
                </div>
              ) : updateStatus.phase === 'error' ? (
                <div className="updates-status-main">
                  <div className="updates-status-icon-wrap">
                    <AlertCircle size={24} className="updates-status-icon-error" />
                  </div>
                  <div>
                    <h3 className="updates-status-title">Yangilanishlarni tekshirib bo‘lmadi</h3>
                    <p className="updates-status-desc">
                      {updateStatus.message || 'Serverga ulanishda muammo yuz berdi. Internetni tekshirib qayta urinib ko‘ring.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="updates-status-main">
                  <div className="updates-status-icon-wrap">
                    <CheckCircle2 size={24} className="updates-status-icon-success" />
                  </div>
                  <div>
                    <h3 className="updates-status-title">Siz ILBI ning eng so‘nggi talqinidan foydalanmoqdasiz</h3>
                    <p className="updates-status-desc">
                      Barcha tizim yangilanishlari va xavfsizlik sozlamalari dolzarb holatda.
                    </p>
                    {updateStatus.lastChecked && (
                      <div className="updates-status-time">
                        Oxirgi tekshiruv: {formatLastChecked(updateStatus.lastChecked)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="updates-bottom-actions">
              <button
                type="button"
                className="btn btn-primary updates-check-btn"
                disabled={checking || isBusy}
                onClick={handleCheckUpdates}
              >
                <RefreshCw size={16} className={checking || isBusy ? 'updates-spinner' : ''} />
                <span>{checking ? 'Tekshirilmoqda…' : 'Yangilanishlarni tekshirish'}</span>
              </button>
            </div>
          </article>

          <div className="updates-switch-banner">
            <div className="updates-switch-info">
              <div className="updates-switch-icon-box">
                <Laptop size={24} />
              </div>
              <div>
                <h3>Boshqa kompyuterga o‘rnatmoqchimisiz?</h3>
                <p>ILBI dasturini yangi kassa yoki boshqa ishchi kompyuterga o‘rnatish uchun o‘rnatuvchi fayllarni yuklab oling.</p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary updates-switch-btn"
              onClick={() => setTab('downloads')}
            >
              <Download size={16} />
              <span>Yuklab olish bo‘limiga o‘tish</span>
            </button>
          </div>
        </section>
      ) : (
        <section id="panel-downloads" role="tabpanel" aria-labelledby="tab-downloads">
          <span className="downloads-eyebrow">ILBI sizning qurilmangizda</span>
          <h1>Yuklab olish</h1>
          <p className="downloads-intro">Qurilmangiz uchun rasmiy ILBI ilovasini tanlang. Kompyuter va mobil ilova versiyalari alohida yuritiladi.</p>
          {state.error && <RecoveryNotice className="downloads-notice" title="Yuklamalar ro‘yxati ochilmadi" actions={<>
            <RetryButton loading={state.loading} onClick={() => setAttempt(value => value + 1)}>Qayta tekshirish</RetryButton>
            {window.ilbiDesktop?.openDownloads && <button className="btn btn-secondary downloads-open-site" type="button" onClick={() => {
              void window.ilbiDesktop.openDownloads().catch(() => setState(previous => ({ ...previous, error: 'Rasmiy saytni brauzerda ochib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring.' })));
            }}><ExternalLink size={16} aria-hidden="true" />Saytda ochish</button>}
          </>}>{state.error}</RecoveryNotice>}
          <div className="downloads-grid">
            <article className="downloads-card"><div className="downloads-platform-icon"><img src="/brand/ilbi-desktop.svg" width="52" height="52" alt="ILBI ilovasi belgisi" /></div>
              <div className="downloads-card-heading"><h2>Windows uchun ILBI</h2><span>v{windows?.version || version}</span></div>
              <p>Klassik va Tezkor ish stoli. Savdo, ombor, nasiya va sinxronlash navbati bir dasturda.</p>
              <div className="downloads-details"><span>Windows · 64 bit</span>{releaseSize(windows?.bytes) && <span>{releaseSize(windows.bytes)}</span>}{windowsURL && windows?.channel === 'preview' && <span className="downloads-preview">Sinov nusxasi</span>}</div>
              {windowsURL ? <a className="btn btn-primary downloads-button" href={windowsURL} target="_blank" rel="noopener noreferrer"><Download size={18} />Windows uchun yuklab olish</a>
                : <button type="button" className="btn btn-primary downloads-button" disabled>{state.loading ? 'Tekshirilmoqda…' : 'Yuklab olish hali ochilmagan'}</button>}
              {windowsURL && windows?.channel === 'preview' && <small>Sinov nusxasi. Ishlab chiqarishdagi POS savdosi fiskal integratsiya tayyor bo‘lgach ochiladi.</small>}
            </article>
            <article className="downloads-card" data-platform="linux"><div className="downloads-platform-icon"><img src="/brand/ilbi-desktop.svg" width="52" height="52" alt="ILBI Linux ilovasi belgisi" /></div>
              <div className="downloads-card-heading"><h2>Linux uchun ILBI</h2><span>v{linux?.version || version}</span></div>
              <p>Arch Linux va Ubuntu 22.04+ uchun. Python va mahalliy baza ilovaning ichida; virtual mashina kerak emas.</p>
              <div className="downloads-details"><span>Linux · x86_64</span>{releaseSize(linux?.bytes) && <span>{releaseSize(linux.bytes)}</span>}{linuxURL && linux?.channel === 'preview' && <span className="downloads-preview">Sinov nusxasi</span>}</div>
              {linuxURL ? <a className="btn btn-primary downloads-button" href={linuxURL} target="_blank" rel="noopener noreferrer"><Download size={18} />Linux uchun yuklab olish</a>
                : <button type="button" className="btn btn-primary downloads-button" disabled>{state.loading ? 'Tekshirilmoqda…' : 'Linux yuklamasi hali ochilmagan'}</button>}
              <small>Arxiv va oddiy o‘rnatuvchi. <a href="#linux-install">Linux’da o‘rnatish — 4 qadam</a></small>
              {linuxURL && linux?.channel === 'preview' && <small>Sinov nusxasi. POS savdosiga mavjud fiskal integratsiya cheklovi amal qiladi.</small>}
            </article>
            <article className="downloads-card" data-platform="android"><div className="downloads-platform-icon"><img src="/brand/ilbi-icon-512.png" width="52" height="52" alt="ILBI mobil ilovasi belgisi" /></div>
              <div className="downloads-card-heading"><h2>Android uchun ILBI</h2><span>{androidURL ? `v${android.version}` : 'Hozircha mavjud emas'}</span></div>
              <p>Telefon va planshetda savdo hamda do‘kon boshqaruvi. Mobil ilova platformadan alohida versiyalanadi.</p>
              <div className="downloads-details"><span>Android</span>{android?.buildNumber && <span>Yig‘ilma {android.buildNumber}</span>}{releaseSize(android?.bytes) && <span>{releaseSize(android.bytes)}</span>}{androidURL && android?.channel === 'preview' && <span className="downloads-preview">Sinov nusxasi</span>}</div>
              {androidURL ? <a className="btn btn-primary downloads-button" href={androidURL} target="_blank" rel="noopener noreferrer"><Download size={18} />Android uchun yuklab olish</a>
                : <button type="button" className="btn btn-primary downloads-button" disabled>Android yuklamasi hali joylanmagan</button>}
              {androidURL && <small>APK’ni yuklab, qurilmada oching yoki Google Play’dan yangilang. Mavjud ILBI’ni o‘chirish shart emas.</small>}
            </article>
            <article className="downloads-card" data-platform="ios"><div className="downloads-platform-icon"><img src="/brand/ilbi-icon-512.png" width="52" height="52" alt="ILBI iPhone ilovasi belgisi" /></div>
              <div className="downloads-card-heading"><h2>iPhone va iPad uchun ILBI</h2><span>{iosURL ? `v${ios.version}` : 'Hozircha mavjud emas'}</span></div>
              <p>iPhone va iPad uchun rasmiy ilova. O‘rnatish va yangilash App Store yoki TestFlight orqali bajariladi.</p>
              <div className="downloads-details"><span>iOS · iPadOS</span>{ios?.buildNumber && <span>Yig‘ilma {ios.buildNumber}</span>}{iosURL && ios?.channel === 'preview' && <span className="downloads-preview">Sinov nusxasi</span>}</div>
              {iosURL ? <a className="btn btn-primary downloads-button" href={iosURL} target="_blank" rel="noopener noreferrer"><ExternalLink size={18} />Ilovalar do‘konida ochish</a>
                : <button type="button" className="btn btn-primary downloads-button" disabled>iPhone ilovasi hali joylanmagan</button>}
            </article>
          </div>
          <section className="downloads-linux-install" id="linux-install" aria-labelledby="linux-install-heading"><h2 id="linux-install-heading">Linux’da o‘rnatish — 4 qadam</h2><ol>
            <li>Yuklangan <code>.tar.gz</code> arxivni papkaga oching.</li>
            <li>Ichidagi <strong>ILBI</strong> papkasida o‘ng tugma → <strong>Terminalda ochish</strong>.</li>
            <li><code>bash install.sh</code> yozib, Enter bosing. <code>sudo</code> kerak emas.</li>
            <li>Ilovalar menyusidan <strong>ILBI</strong>ni oching.</li>
          </ol><p>Menyuda ko‘rinmasa: <code>~/.local/bin/ilbi</code>.</p>
            <p>Paket Linux x86_64 uchun. GNOME Keyring yoki KWallet ochiq bo‘lsin. Yangilashda ILBI’ni yoping va yangi arxivdagi <code>install.sh</code> faylini yana ishga tushiring — ma’lumotlar saqlanadi.</p>
            <Link className="downloads-linux-guide" to="/desktop-guide#7-linux-uchun-batafsil-qollanma"><BookOpen size={18} aria-hidden="true" /><span>Linux uchun batafsil qo‘llanma<small>Arch, boshqa Linux’lar va parollar omborini sozlash.</small></span><ArrowLeft size={16} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} /></Link>
          </section>
          <section className="downloads-help" aria-labelledby="download-start"><h2 id="download-start">Birinchi ishga tushirish</h2>
            <ol><li>ILBI’ni o‘rnating va <strong>Ishni boshlash</strong> tugmasini bosing.</li><li>Do‘kon egasi internet orqali kirib, <strong>Internetsiz ishlashni yoqish</strong>ni bossin. Alohida offline parol kerak emas.</li><li>Bitta kompyuter uchun shu yetarli. Keyinchalik <strong>ILBI → Kassalar va xavfsizlik</strong>dan bir martalik kod bilan boshqa kompyuterni ulaysiz. Birinchi ulashda ikkala kompyuterda ham internet kerak.</li></ol>
            <p>Bir nechta kassa ishlatilganda asosiy kompyuter va undagi ILBI ochiq turadi. Offline ruxsat internet orqali yangilanib turadi; uning muddati 7 kun.</p>
            <Link className="downloads-guide-link" to="/desktop-guide"><BookOpen size={19} /><span><strong>Ilovani sozlash — rasmli qo‘llanma</strong><small>Internetsiz ishlash, kod bilan ulash, xavfsizlik, zaxira va yangilash.</small></span><ArrowLeft size={17} style={{ transform: 'rotate(180deg)' }} /></Link>
          </section>
        </section>
      )}
    </main>

    <footer className="downloads-footer">
      <span>ILBI · v{currentVersion}</span>
      <Link to="/support">Yordam markazi</Link>
      {isAuthenticated ? (
        <Link to="/dashboard">Ish stoli</Link>
      ) : (
        <Link to="/login">Tizimga kirish</Link>
      )}
    </footer>
  </div>;
}

