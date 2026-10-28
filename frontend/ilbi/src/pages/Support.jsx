import IlbiLoader from '../components/common/IlbiLoader';
import AppLoadingScreen from '../components/common/AppLoadingScreen';
import { RetryButton } from '../components/common/RecoveryNotice';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Headphones,
  Phone,
  Send,
  Paperclip,
  X,
  BookOpen,
  Search,
  ShieldCheck,
  Store,
  Users,
  User,
  FileText,
  Printer,
  Mic,
  Smile,
  CornerUpLeft,
  Sparkles,
  Plus,
  Filter,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTenant } from '../context/TenantContext';
import { request } from '../api/client';
import { publicSupportRequest, supportApi } from '../api/support';
import { supportText } from '../components/support/translations';
import MarkdownViewer from '../components/docs/MarkdownViewer';
import { startSupportPolling } from '../components/support/polling';
import VoiceRecorder from '../components/support/VoiceRecorder';
import VoicePlayer from '../components/support/VoicePlayer';
import StickerPicker, { StickerItem, STICKER_DICT } from '../components/support/StickerPicker';
import CustomerProfileModal from '../components/support/CustomerProfileModal';
import CustomSelect from '../components/common/CustomSelect';
import '../components/support/support.css';

function getDocIcon(key, category) {
  if (key.includes('admin')) return ShieldCheck;
  if (key.includes('owner')) return Store;
  if (key.includes('staff')) return Users;
  if (category === 'legal') return FileText;
  return BookOpen;
}

function PrivateImage({ api, conversationId, messageId, t }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl;
    api.image(conversationId, messageId).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [api, conversationId, messageId]);
  if (error) return <span>{t.imageError}</span>;
  return url ? <a href={url} target="_blank" rel="noreferrer"><img className="support-image" src={url} alt={t.image} /></a> : <IlbiLoader size={32} label={t.loading} />;
}

const mergeMessages = (previous, incoming) => Array.from(new Map([...previous, ...incoming].map((m) => [m.id, m])).values()).sort((a, b) => a.id - b.id);


function SupportCenter({ user, authenticated, operator }) {
  const { activeTenant } = useTenant();
  const language = 'uz';
  const t = supportText.uz;
  const api = useMemo(() => supportApi(authenticated, operator), [authenticated, operator]);
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState(params.get('conversation') || '');
  const [metadata, setMetadata] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [nextPage, setNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [mine, setMine] = useState(false);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showCustomerProfile, setShowCustomerProfile] = useState(false);
  const [newImage, setNewImage] = useState(null);
  const [newImagePreview, setNewImagePreview] = useState(null);
  const newFileRef = useRef(null);
  const [newForm, setNewForm] = useState(false);
  const [form, setForm] = useState({ name: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || '', subject: '', text: '', consent: false });
  const [tab, setTab] = useState(params.has('doc') ? 'guide' : 'chat');
  const [documents, setDocuments] = useState([]);
  const [docKey, setDocKey] = useState(params.get('doc') || 'yordam_uz');
  const [document, setDocument] = useState(null);
  const [docSearch, setDocSearch] = useState('');

  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      if (doc.key.startsWith('yordam_')) {
        return doc.key === 'yordam_uz';
      }
      return true;
    });
  }, [documents]);

  const searchedDocuments = useMemo(() => {
    if (!docSearch.trim()) return filteredDocuments;
    const q = docSearch.toLowerCase();
    return filteredDocuments.filter((doc) =>
      doc.title.toLowerCase().includes(q) || doc.key.toLowerCase().includes(q)
    );
  }, [filteredDocuments, docSearch]);

  const groupedDocuments = useMemo(() => {
    const groups = { practical: [], manual: [], legal: [] };
    searchedDocuments.forEach((doc) => {
      const cat = doc.category || 'practical';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(doc);
    });
    return groups;
  }, [searchedDocuments]);

  const activeDocMeta = useMemo(() => {
    return documents.find((d) => d.key === docKey) || null;
  }, [documents, docKey]);
  const endRef = useRef(null);
  const readRef = useRef(0);
  const startRequest = useRef(null);
  const sendRequest = useRef(null);
  const fileRef = useRef(null);
  const listPollerRef = useRef(null);
  const messagePollerRef = useRef(null);

  useEffect(() => {
    if (!image) { setImagePreview(null); return; }
    const url = URL.createObjectURL(image);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  useEffect(() => {
    if (!newImage) { setNewImagePreview(null); return; }
    const url = URL.createObjectURL(newImage);
    setNewImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [newImage]);

  const handlePaste = (e, setImageFn) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          setError(t.imageLimit);
          return;
        }
        setImageFn(file);
        break;
      }
    }
  };

  const listQuery = `?page=${page}&status=${filter}&mine=${mine}`;
  const loadList = useCallback(async () => {
    const result = await api.list(listQuery);
    setConversations(result.results);
    setNextPage(Boolean(result.next));
  }, [api, listQuery]);

  useEffect(() => { publicSupportRequest('/support/metadata/').then(setMetadata).catch(() => setError(t.unavailable)); }, [t.unavailable]);
  useEffect(() => {
    let active = true;
    const poller = startSupportPolling(async () => {
      const result = await api.list(listQuery);
      if (active) {
        setConversations(result.results);
        setNextPage(Boolean(result.next));
        setError('');
      }
    }, {
      intervalMs: 15000,
      onError: (err) => { if (active) setError(err.status >= 500 ? t.unavailable : err.message || t.unavailable); },
    });
    listPollerRef.current = poller;
    return () => { active = false; poller.stop(); listPollerRef.current = null; };
  }, [api, listQuery, t.unavailable]);

  const docRequest = useCallback((path) => authenticated ? request(path) : publicSupportRequest(path), [authenticated]);
  useEffect(() => {
    let active = true;
    docRequest('/docs/').then((data) => { if (active) setDocuments(data.documents); }).catch(() => {});
    return () => { active = false; };
  }, [docRequest]);
  useEffect(() => {
    if (tab !== 'guide') return;
    let active = true;
    setDocument(null);
    docRequest(`/docs/?doc=${encodeURIComponent(docKey)}`).then((data) => { if (active) setDocument(data); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [docKey, tab, docRequest]);

  useEffect(() => {
    setMessages([]); messagesRef.current = []; setConversation(null); setHasOlder(false); readRef.current = 0;
    if (!selected) return;
    let active = true;
    const poller = startSupportPolling(async () => {
        const latest = messagesRef.current.at(-1)?.id;
        const [detail, batch] = await Promise.all([
          api.detail(selected), api.messages(selected, latest ? `?after_id=${latest}` : ''),
        ]);
        if (!active) return;
        setConversation(detail);
        if (!latest) setHasOlder(batch.has_more);
        if (batch.results.length) {
          messagesRef.current = mergeMessages(messagesRef.current, batch.results);
          setMessages(messagesRef.current);
        }
        setError('');
        const through = messagesRef.current.at(-1)?.id || 0;
        if (globalThis.document.hasFocus() && through > readRef.current) {
          await api.action(selected, 'read', { through_id: through });
          if (active) readRef.current = through;
        }
    }, {
      intervalMs: 5000,
      onError: (err) => { if (active) setError(err.status >= 500 ? t.unavailable : err.message || t.unavailable); },
    });
    messagePollerRef.current = poller;
    return () => { active = false; poller.stop(); messagePollerRef.current = null; };
  }, [api, selected, t.unavailable]);
  const lastMessageId = messages.at(-1)?.id;
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [lastMessageId]);

  const choose = (id) => {
    setSelected(id); setParams(id ? { conversation: id } : {}, { replace: true });
    setNewForm(false); setDraft(''); setImage(null); setNewImage(null); sendRequest.current = null;
    setReplyingTo(null); setIsRecordingVoice(false); setShowStickerPicker(false);
    if (fileRef.current) fileRef.current.value = '';
    if (newFileRef.current) newFileRef.current.value = '';
  };
  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await loadList(); }
    catch (err) { setError(err.message || t.unavailable); }
    finally { setBusy(false); }
  };
  const start = (event) => {
    if (event) event.preventDefault();
    run(async () => {
      const signature = `${form.name}:${form.subject}:${form.text}:${newImage?.name}:${newImage?.size}`;
      if (startRequest.current?.signature !== signature) startRequest.current = { signature, id: crypto.randomUUID() };
      const body = new FormData();
      body.set('name', form.name);
      body.set('subject', form.subject);
      body.set('text', form.text);
      body.set('language', language);
      body.set('consent', form.consent ? 'true' : 'false');
      body.set('client_id', startRequest.current.id);
      if (newImage) body.set('image', newImage);
      const created = await api.create(body, activeTenant?.id);
      startRequest.current = null;
      choose(created.id);
      setForm((old) => ({ ...old, subject: '', text: '' }));
      setNewImage(null);
      if (newFileRef.current) newFileRef.current.value = '';
    });
  };
  const send = (event) => {
    if (event) event.preventDefault();
    if (!draft.trim() && !image) return;
    run(async () => {
      const signature = `${draft}:${image?.name}:${image?.size}:${image?.lastModified}:${replyingTo?.id || ''}`;
      if (sendRequest.current?.signature !== signature) sendRequest.current = { signature, id: crypto.randomUUID() };
      const body = new FormData(); body.set('text', draft); body.set('client_id', sendRequest.current.id);
      if (image) body.set('image', image);
      if (replyingTo) body.set('reply_to_id', String(replyingTo.id));
      const message = await api.send(selected, body);
      messagesRef.current = mergeMessages(messagesRef.current, [message]); setMessages(messagesRef.current);
      setDraft(''); setImage(null); setReplyingTo(null); sendRequest.current = null; if (fileRef.current) fileRef.current.value = '';
    });
  };
  const sendVoice = (audioBlob, duration) => {
    run(async () => {
      const body = new FormData();
      body.set('client_id', crypto.randomUUID());
      body.set('voice', audioBlob, 'voice.webm');
      body.set('voice_duration', String(duration));
      if (replyingTo) body.set('reply_to_id', String(replyingTo.id));
      const message = await api.send(selected, body);
      messagesRef.current = mergeMessages(messagesRef.current, [message]); setMessages(messagesRef.current);
      setReplyingTo(null); setIsRecordingVoice(false);
    });
  };
  const sendSticker = (stickerId) => {
    run(async () => {
      const body = new FormData();
      body.set('client_id', crypto.randomUUID());
      body.set('sticker', stickerId);
      if (replyingTo) body.set('reply_to_id', String(replyingTo.id));
      const message = await api.send(selected, body);
      messagesRef.current = mergeMessages(messagesRef.current, [message]); setMessages(messagesRef.current);
      setReplyingTo(null); setShowStickerPicker(false);
    });
  };
  const scrollToMessage = (msgId) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('support-message-highlight');
      setTimeout(() => el.classList.remove('support-message-highlight'), 1200);
    }
  };
  const action = (value) => run(async () => {
    const detail = await api.action(selected, value); setConversation(detail);
    const batch = await api.messages(selected, `?after_id=${messagesRef.current.at(-1)?.id || 0}`);
    messagesRef.current = mergeMessages(messagesRef.current, batch.results); setMessages(messagesRef.current);
  });
  const older = () => run(async () => {
    const batch = await api.messages(selected, `?before_id=${messages[0]?.id}`);
    messagesRef.current = mergeMessages(messagesRef.current, batch.results); setMessages(messagesRef.current); setHasOlder(batch.has_more);
  });
  const otherOperator = operator && conversation?.operator_id && conversation.operator_id !== user?.id;
  const canSend = conversation && conversation.status !== 'closed' && (!operator || (conversation.operator_id === user?.id && conversation.status === 'active'));
  return (
    <main className={`support-shell ${authenticated ? 'in-layout' : ''}`} lang={language}>
      <div className="support-top-bar">
        <div className="support-top-bar-left">
          {!authenticated && (
            <Link to="/login" className="support-back">
              <ArrowLeft size={16} />
              <span>{t.login}</span>
            </Link>
          )}
          {metadata && (
            <div className="support-contact-chips">
              <a className="btn btn-secondary support-chip-btn" href={`tel:${metadata.phone}`}>
                <Phone size={14} />
                <span>{metadata.phone}</span>
              </a>
              <a className="btn btn-secondary support-chip-btn" href={`https://t.me/${metadata.telegram_username}`} target="_blank" rel="noreferrer">
                <Send size={14} />
                <span>@{metadata.telegram_username}</span>
              </a>
            </div>
          )}
        </div>
      </div>

      {!authenticated && (
        <div className="support-heading">
          <Headphones size={30} />
          <div>
            <h1>{t.title}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>
      )}

      <div className="support-nav-row">
        <div className="support-tabs" style={{ margin: 0 }}>
          <button className={`btn ${tab === 'chat' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('chat')}>
            <Headphones size={16} />
            <span>{operator ? t.inbox : t.chat}</span>
          </button>
          <button className={`btn ${tab === 'guide' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('guide')}>
            <BookOpen size={16} />
            <span>{t.guide}</span>
          </button>
        </div>
        <p className="support-note" style={{ margin: 0 }}>
          {t.noHours}
        </p>
      </div>

      {!authenticated && <p className="support-note" style={{ marginBottom: 14 }}>{t.guest}</p>}

      {error && <div className="support-error" role="alert">{error}<RetryButton loading={busy} onClick={() => { setError(''); listPollerRef.current?.retry(); messagePollerRef.current?.retry(); }}>{t.retry}</RetryButton></div>}

      {tab === 'guide' ? (
        <div className="support-docs-workspace">
          <aside className="support-docs-sidebar">
            <div className="support-docs-search-wrap">
              <Search size={15} className="support-docs-search-icon" />
              <input
                type="text"
                className="input-field support-docs-search-input"
                placeholder={t.searchDocs || "Hujjatlarni qidirish..."}
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
              {docSearch && (
                <button
                  type="button"
                  onClick={() => setDocSearch('')}
                  className="support-docs-search-clear"
                  title="Tozalash"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {Object.entries(groupedDocuments).map(([catKey, catDocs]) => {
              if (!catDocs.length) return null;
              return (
                <div key={catKey} className="support-docs-category-group">
                  <div className="support-docs-category-title">
                    {t[catKey] || catKey}
                  </div>
                  <div className="support-docs-category-list">
                    {catDocs.map((doc) => {
                      const Icon = getDocIcon(doc.key, doc.category);
                      const isActive = docKey === doc.key;
                      return (
                        <button
                          key={doc.key}
                          type="button"
                          onClick={() => setDocKey(doc.key)}
                          className={`support-thread support-doc-thread ${isActive ? 'selected' : ''}`}
                        >
                          <Icon size={16} className="support-doc-icon" />
                          <span className="support-doc-title">{doc.title}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {!searchedDocuments.length && (
              <p className="support-note" style={{ padding: '16px 8px', textAlign: 'center' }}>
                {t.noDocs || "Hujjat topilmadi"}
              </p>
            )}
          </aside>

          <section className="support-docs-panel">
            {document ? (
              <>
                <div className="support-docs-header">
                  <div>
                    <span className="support-doc-badge">
                      {t[activeDocMeta?.category] || 'Qo‘llanma'}
                    </span>
                    <h2 className="support-docs-title">
                      {activeDocMeta?.title || document.title}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="btn btn-secondary doc-hide-print"
                    style={{ fontSize: 12.5, padding: '7px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    title={t.print || "Chop etish"}
                  >
                    <Printer size={15} />
                    <span>{t.print || "Chop etish"}</span>
                  </button>
                </div>
                <div className="support-docs-body">
                  <MarkdownViewer content={document.content} />
                </div>
              </>
            ) : (
              <div className="support-empty">
                <IlbiLoader label={t.loading} />
              </div>
            )}
          </section>
        </div>
      ) : <>
        <div className="support-ai-banner">
          <Sparkles size={16} className="support-ai-icon" />
          <span>{t.ai}</span>
        </div>
        <div className="support-workspace">
          <aside className="support-list" aria-label={operator ? t.inbox : t.chat}>
            {operator ? (
              <div className="support-filters">
                <CustomSelect
                  value={filter}
                  onChange={(val) => {
                    setPage(1);
                    setFilter(val);
                  }}
                  options={[
                    { value: '', label: t.all },
                    { value: 'waiting', label: t.waiting },
                    { value: 'active', label: t.active },
                    { value: 'closed', label: t.closed },
                  ]}
                  size="sm"
                  fullWidth
                />
                <label
                  className={`support-mine-pill ${mine ? 'active' : ''}`}
                  onClick={() => {
                    setPage(1);
                    setMine(!mine);
                  }}
                >
                  <span className="support-mine-check">{mine ? '✓' : ''}</span>
                  <span>{t.mine}</span>
                </label>
              </div>
            ) : (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => {
                  choose('');
                  setNewForm(true);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontWeight: 700 }}
              >
                <Plus size={16} />
                <span>{t.new}</span>
              </button>
            )}
            {!conversations.length && <p className="support-note">{t.empty}</p>}
            {conversations.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                onClick={() => choose(item.id)}
                className={`support-thread ${selected === item.id ? 'selected' : ''}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong style={{ fontSize: 13.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.subject}
                  </strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.name}</span>
                  <span className={`support-status ${item.status}`}>
                    {t[item.status]}
                    {item.unread_count > 0 && <b className="support-badge">{item.unread_count}</b>}
                  </span>
                </div>
              </button>
            ))}
            <div className="support-pages">
              {page > 1 && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => setPage(page - 1)}>
                  ←
                </button>
              )}
              {nextPage && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => setPage(page + 1)}>
                  {t.more}
                </button>
              )}
            </div>
          </aside>
          <section className="support-chat">
            {newForm && !operator ? <form className="support-start" onSubmit={start}>
              <h2>{t.new}</h2>
              {[['name', 100], ['subject', 160]].map(([key, limit]) => <label key={key}>{t[key]}<input className="input-field" value={form[key]} maxLength={limit} required onChange={(e) => setForm({ ...form, [key]: e.target.value })} /></label>)}
              <label>
                {t.question}
                <div className="support-tg-input-box">
                  {newImage && (
                    <div className="support-attachment-chip">
                      <img src={newImagePreview} alt="preview" className="support-attachment-thumb" />
                      <div className="support-attachment-info">
                        <span className="support-attachment-name">{newImage.name}</span>
                        <span className="support-attachment-size">{(newImage.size / 1024).toFixed(0)} KB</span>
                      </div>
                      <button
                        type="button"
                        className="support-attachment-remove"
                        title={t.remove}
                        onClick={() => {
                          setNewImage(null);
                          if (newFileRef.current) newFileRef.current.value = '';
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  )}
                  <textarea data-api-field="text"
                    className="support-tg-textarea"
                    rows={4}
                    maxLength={4000}
                    placeholder={t.placeholder}
                    value={form.text}
                    required
                    onChange={(e) => setForm({ ...form, text: e.target.value })}
                    onPaste={(e) => handlePaste(e, setNewImage)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (form.name && form.subject && form.text.trim() && form.consent && !busy) {
                          start(e);
                        }
                      }
                    }}
                  />
                  <div className="support-tg-toolbar">
                    <div className="support-tg-toolbar-left">
                      <label className="support-tg-clip-btn" title="Rasm biriktirish (PNG, JPEG, WebP, maks. 2 MB)">
                        <Paperclip size={18} />
                        <input
                          ref={newFileRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="support-file"
                          onChange={(e) => {
                            const file = e.target.files[0];
                            if (file && (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
                              setError(t.imageLimit);
                              e.target.value = '';
                              return;
                            }
                            setNewImage(file || null);
                          }}
                        />
                      </label>
                      <span className="support-tg-hint">
                        Enter — yuborish, Shift+Enter — yangi qator, Ctrl+V — rasm
                      </span>
                    </div>
                  </div>
                </div>
              </label>
              <label className="support-consent"><input type="checkbox" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />{t.consent}</label>
              <button type="button" className="support-link" onClick={() => { setDocKey('maxfiylik_siyosati'); setTab('guide'); }}>{t.privacy}</button>
              <p className="support-note">{t.safe}</p><button className="btn btn-primary" disabled={busy}>{busy ? t.loading : t.start}</button>
            </form> : conversation ? <>
              <div className="support-chat-header"><div><h2>{conversation.subject}</h2><span className={`support-status ${conversation.status}`}>{t[conversation.status]}</span>
                {conversation.operator_name && <small>{t.operator}: {conversation.operator_name}</small>}
                {operator && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: 10, padding: '3px 8px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    onClick={() => setShowCustomerProfile(true)}
                    title="Mijoz profilini ko‘rish va boshqarish"
                  >
                    <User size={12} />
                    Mijoz profili
                  </button>
                )}
                </div>
                <div className="support-actions">
                  {operator && conversation.status !== 'closed' && !conversation.operator_id && <button disabled={busy} className="btn btn-primary" onClick={() => action('claim')}>{t.claim}</button>}
                  {conversation.status === 'closed' ? <button disabled={busy} className="btn btn-secondary" onClick={() => action('reopen')}>{t.reopen}</button>
                    : !otherOperator && <button disabled={busy} className="btn btn-secondary" onClick={() => action('close')}>{t.close}</button>}
                </div>
              </div>
              <div className="support-messages" role="log" aria-live="polite" aria-label={t.chat}>
                {hasOlder && <button className="btn btn-secondary" disabled={busy} onClick={older}>{t.older}</button>}
                {messages.map((message) => message.sender === 'system' ? <p key={message.id} className="support-event">{t[`${message.event}Event`] || message.event}</p> :
                  <div
                    key={message.id}
                    id={`msg-${message.id}`}
                    className={`support-message-wrap ${message.sender === (operator ? 'operator' : 'visitor') ? 'own' : ''}`}
                  >
                    <div className="support-msg-action-bar">
                      <button
                        type="button"
                        className="support-msg-reply-btn"
                        title="Javob yozish"
                        onClick={() => setReplyingTo(message)}
                      >
                        <CornerUpLeft size={13} />
                      </button>
                    </div>
                    <article className={`support-message ${message.sender === (operator ? 'operator' : 'visitor') ? 'own' : ''} ${message.sticker ? 'support-sticker-bubble' : ''}`}>
                      {message.reply_to && (
                        <div
                          className="support-message-reply-quote"
                          onClick={() => scrollToMessage(message.reply_to.id)}
                          title="Asl xabarga o‘tish"
                        >
                          <span className="support-message-reply-author">{message.reply_to.author_name}</span>
                          <span className="support-message-reply-text">
                            {message.reply_to.sticker
                              ? `Stiker: ${STICKER_DICT[message.reply_to.sticker]?.label || 'Stiker'}`
                              : message.reply_to.has_voice
                              ? `Ovozli xabar (${message.reply_to.voice_duration}s)`
                              : message.reply_to.has_image
                              ? 'Rasm'
                              : message.reply_to.text}
                          </span>
                        </div>
                      )}
                      {!message.sticker && (
                        <small
                          className={operator && message.sender === 'visitor' ? 'support-msg-author admin-clickable' : ''}
                          title={operator && message.sender === 'visitor' ? "Mijoz profilini ko'rish va boshqarish" : undefined}
                          onClick={() => {
                            if (operator && message.sender === 'visitor') {
                              setShowCustomerProfile(true);
                            }
                          }}
                        >
                          {message.author_name || (message.sender === 'operator' ? t.operator : conversation.name)}
                        </small>
                      )}
                      {message.text && <p>{message.text}</p>}
                      {message.has_image && <PrivateImage api={api} conversationId={selected} messageId={message.id} t={t} />}
                      {message.has_voice && (
                        <VoicePlayer
                          api={api}
                          conversationId={selected}
                          messageId={message.id}
                          duration={message.voice_duration}
                          isOwn={message.sender === (operator ? 'operator' : 'visitor')}
                        />
                      )}
                      {message.sticker && (
                        <StickerItem stickerId={message.sticker} showLabel={false} />
                      )}
                      <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('uz-UZ')}</time>
                    </article>
                  </div>)}<div ref={endRef} />
              </div>
              {canSend ? <form className="support-compose" onSubmit={send}>
                <div className="support-tg-input-box" style={{ position: 'relative' }}>
                  {replyingTo && (
                    <div className="support-reply-banner">
                      <div className="support-reply-banner-content">
                        <span className="support-reply-banner-title">
                          {replyingTo.author_name || (replyingTo.sender === 'operator' ? t.operator : 'Mijoz')}
                        </span>
                        <span className="support-reply-banner-text">
                          {replyingTo.sticker
                            ? `Stiker: ${STICKER_DICT[replyingTo.sticker]?.label || 'Stiker'}`
                            : replyingTo.has_voice
                            ? `Ovozli xabar (${replyingTo.voice_duration}s)`
                            : replyingTo.has_image
                            ? 'Rasm'
                            : replyingTo.text}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="support-reply-banner-close"
                        onClick={() => setReplyingTo(null)}
                        title="Bekor qilish"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {isRecordingVoice ? (
                    <VoiceRecorder
                      onSend={sendVoice}
                      onCancel={() => setIsRecordingVoice(false)}
                    />
                  ) : (
                    <>
                      {image && (
                        <div className="support-attachment-chip">
                          <img src={imagePreview} alt="preview" className="support-attachment-thumb" />
                          <div className="support-attachment-info">
                            <span className="support-attachment-name">{image.name}</span>
                            <span className="support-attachment-size">{(image.size / 1024).toFixed(0)} KB</span>
                          </div>
                          <button
                            type="button"
                            className="support-attachment-remove"
                            title={t.remove}
                            onClick={() => {
                              setImage(null);
                              if (fileRef.current) fileRef.current.value = '';
                            }}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      )}
                      <textarea
                        className="support-tg-textarea"
                        aria-label={t.question}
                        placeholder={t.placeholder}
                        rows={2}
                        maxLength={4000}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onPaste={(e) => handlePaste(e, setImage)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (!busy && (draft.trim() || image)) {
                              send(e);
                            }
                          }
                        }}
                      />
                      <div className="support-tg-toolbar">
                        <div className="support-tg-toolbar-left" style={{ position: 'relative' }}>
                          <label className="support-tg-clip-btn" title="Rasm biriktirish (PNG, JPEG, WebP, maks. 2 MB)">
                            <Paperclip size={18} />
                            <input
                              ref={fileRef}
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              className="support-file"
                              onChange={(e) => {
                                const file = e.target.files[0];
                                if (file && (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
                                  setError(t.imageLimit);
                                  e.target.value = '';
                                  return;
                                }
                                setImage(file || null);
                              }}
                            />
                          </label>

                          <button
                            type="button"
                            className="support-tg-clip-btn"
                            title="Ovozli xabar yozish"
                            onClick={() => setIsRecordingVoice(true)}
                          >
                            <Mic size={18} />
                          </button>

                          <button
                            type="button"
                            className={`support-tg-clip-btn ${showStickerPicker ? 'active' : ''}`}
                            title="Stiker yuborish"
                            onClick={() => setShowStickerPicker((prev) => !prev)}
                          >
                            <Smile size={18} />
                          </button>

                          {showStickerPicker && (
                            <StickerPicker
                              onSelect={sendSticker}
                              onClose={() => setShowStickerPicker(false)}
                            />
                          )}

                          <span className="support-tg-hint">
                            Enter — yuborish, Shift+Enter — yangi qator, Ctrl+V — rasm
                          </span>
                        </div>
                        <button
                          type="submit"
                          className="btn btn-primary support-tg-send-btn"
                          disabled={busy || (!draft.trim() && !image)}
                          title={t.send}
                        >
                          <Send size={16} />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </form> : <p className="support-note support-compose">{otherOperator ? t.busy : t[conversation.status]}</p>}
            </> : <div className="support-empty">{selected ? <IlbiLoader label={t.loading} /> : <><Headphones size={44} /><p>{t.select}</p></>}</div>}
          </section>
        </div>
      </>}

      {/* Customer Profile Modal for Operator */}
      {showCustomerProfile && selected && operator && (
        <CustomerProfileModal
          conversationId={selected}
          api={api}
          onClose={() => setShowCustomerProfile(false)}
        />
      )}
    </main>
  );
}

export default function Support() {
  const { user, isAuthenticated, isAdmin, loading, sessionId } = useAuth();
  if (loading) return <AppLoadingScreen />;
  return <SupportCenter key={`${sessionId}:${user?.id || 'guest'}:${isAuthenticated}`} user={user} authenticated={isAuthenticated} operator={isAdmin} />;
}

