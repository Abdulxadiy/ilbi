import IlbiLoader from '../common/IlbiLoader';
import { sessionStore } from '../../utils/brandStorage.js';
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Headphones,
  X,
  Send,
  Paperclip,
  Maximize2,
  Sparkles,
  MessageSquare,
  Plus,
  Mic,
  Smile,
  CornerUpLeft,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useTenant } from '../../context/TenantContext';
import { supportApi } from '../../api/support';
import { savedSupportLanguage, supportText } from './translations';
import { startSupportPolling } from './polling';
import VoiceRecorder from './VoiceRecorder';
import VoicePlayer from './VoicePlayer';
import StickerPicker, { StickerItem, STICKER_DICT } from './StickerPicker';
import CustomerProfileModal from './CustomerProfileModal';
import './support.css';

function PrivateImage({ api, conversationId, messageId }) {
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

  if (error) return <span style={{ fontSize: 11, color: 'var(--accent-rose)' }}>Rasm yuklanmadi</span>;
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block', marginTop: 6 }}>
      <img
        src={url}
        alt="Biriktirilgan rasm"
        style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, objectFit: 'cover', display: 'block' }}
      />
    </a>
  ) : (
    <IlbiLoader size={32} label="Rasm yuklanmoqda..." />
  );
}

const mergeMessages = (previous, incoming) =>
  Array.from(new Map([...previous, ...incoming].map((m) => [m.id, m])).values()).sort((a, b) => a.id - b.id);

function HelpLauncherContent() {
  const { isAuthenticated, isAdmin, loading, user } = useAuth();
  const { activeTenant } = useTenant();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [conversations, setConversations] = useState([]);
  const [activeConvId, setActiveConvId] = useState(null);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [image, setImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const [isStartingNew, setIsStartingNew] = useState(false);
  const [newForm, setNewForm] = useState({
    name: [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || '',
    subject: '',
    text: '',
  });

  const api = useMemo(() => supportApi(isAuthenticated, isAdmin), [isAuthenticated, isAdmin]);
  const hidden = pathname === '/support' || pathname.startsWith('/r/') || pathname.startsWith('/receipt/');

  const [customBottom, setCustomBottom] = useState(() => {
    try {
      const saved = sessionStore.getItem('support_launcher_bottom');
      return saved ? parseInt(saved, 10) : null;
    } catch (_) {
      return null;
    }
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ isDragging: false, startY: 0, startBottom: 0, hasMoved: false });

  // Default safe positions: in POS sits safely above checkout (125px), otherwise 38px
  const defaultBottom = pathname === '/pos' ? 125 : 38;
  const launcherBottom = customBottom ?? defaultBottom;
  const widgetBottom = Math.max(20, Math.min(launcherBottom + (pathname === '/pos' ? 56 : 54), typeof window !== 'undefined' ? window.innerHeight - 560 : 500));

  const handlePointerDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      isDragging: true,
      startY: e.clientY,
      startBottom: launcherBottom,
      hasMoved: false,
    };

    const handlePointerMove = (moveEvent) => {
      if (!dragRef.current.isDragging) return;
      const deltaY = dragRef.current.startY - moveEvent.clientY;
      if (Math.abs(deltaY) > 5) {
        dragRef.current.hasMoved = true;
        setIsDragging(true);
      }
      if (dragRef.current.hasMoved) {
        const newBottom = Math.max(20, Math.min(window.innerHeight - 80, dragRef.current.startBottom + deltaY));
        setCustomBottom(newBottom);
      }
    };

    const handlePointerUp = () => {
      dragRef.current.isDragging = false;
      setIsDragging(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (dragRef.current.hasMoved) {
        setCustomBottom((latest) => {
          if (latest) {
            try { sessionStore.setItem('support_launcher_bottom', String(latest)); } catch (_) {}
          }
          return latest;
        });
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleLauncherClick = (e) => {
    if (dragRef.current.hasMoved) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    setIsOpen((prev) => !prev);
  };

  const handleLauncherDoubleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCustomBottom(null);
    try { sessionStore.removeItem('support_launcher_bottom'); } catch (_) {}
  };

  // Listen for open event from anywhere in the app
  useEffect(() => {
    const handleOpenWidget = () => setIsOpen(true);
    window.addEventListener('open-support-widget', handleOpenWidget);
    return () => window.removeEventListener('open-support-widget', handleOpenWidget);
  }, []);

  // Ensure widget is closed when navigating to /support page
  useEffect(() => {
    if (pathname === '/support') {
      setIsOpen(false);
    }
  }, [pathname]);

  // Poll unread count when widget is closed
  useEffect(() => {
    if (hidden || loading) return;
    let active = true;
    const poller = startSupportPolling(async () => {
      const result = await api.list();
      if (active) setUnread(result.unread_total || 0);
    }, { intervalMs: 20000 });
    return () => { active = false; poller.stop(); };
  }, [api, hidden, loading]);

  // Load conversations when widget opens
  const loadConversations = useCallback(async () => {
    try {
      setLoadingConv(true);
      const result = await api.list('?page=1');
      setError('');
      const list = result.results || [];
      setConversations(list);
      if (list.length > 0 && !activeConvId) {
        // Find first open/active conversation or default to latest
        const openOne = list.find((c) => c.status !== 'closed') || list[0];
        setActiveConvId(openOne.id);
        setIsStartingNew(false);
      } else if (list.length === 0) {
        setIsStartingNew(true);
      }
    } catch (err) {
      setError(err.message || 'Suhbatlarni yuklab bo‘lmadi. Qayta urinib ko‘ring.');
      setIsStartingNew(true);
    } finally {
      setLoadingConv(false);
    }
  }, [api, activeConvId]);

  useEffect(() => {
    if (isOpen) {
      loadConversations();
    }
  }, [isOpen, loadConversations]);

  // Handle active conversation polling and messages
  useEffect(() => {
    if (!isOpen || !activeConvId) return;
    let active = true;
    const poller = startSupportPolling(async () => {
      try {
        const [detail, batch] = await Promise.all([
          api.detail(activeConvId),
          api.messages(activeConvId, messagesRef.current.length ? `?after_id=${messagesRef.current.at(-1)?.id}` : ''),
        ]);
        if (!active) return;
        setError('');
        setActiveConv(detail);
        if (batch.results.length) {
          messagesRef.current = mergeMessages(messagesRef.current, batch.results);
          setMessages([...messagesRef.current]);
        }
        const lastId = messagesRef.current.at(-1)?.id;
        if (lastId) {
          api.action(activeConvId, 'read', { through_id: lastId }).catch(() => {});
        }
      } catch (err) {
        if (active) setError(err.message || 'Xabarlarni yuklab bo‘lmadi.');
        throw err;
      }
    }, { intervalMs: 4000 });

    return () => { active = false; poller.stop(); };
  }, [isOpen, activeConvId, api]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Handle image attachment preview
  useEffect(() => {
    if (!image) { setImagePreview(null); return; }
    const url = URL.createObjectURL(image);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file && file.size <= 2 * 1024 * 1024) {
          setImage(file);
        }
        break;
      }
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    if (!draft.trim() && !image) return;
    if (busy || !activeConvId) return;

    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set('text', draft);
      body.set('client_id', crypto.randomUUID());
      if (image) body.set('image', image);
      if (replyingTo) body.set('reply_to_id', String(replyingTo.id));

      const sent = await api.send(activeConvId, body);
      messagesRef.current = mergeMessages(messagesRef.current, [sent]);
      setMessages([...messagesRef.current]);
      setDraft('');
      setImage(null);
      setReplyingTo(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err.message || 'Xabar yuborilmadi. Qayta urinib ko‘ring.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendVoice = async (audioBlob, duration) => {
    if (busy || !activeConvId) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set('client_id', crypto.randomUUID());
      body.set('voice', audioBlob, 'voice.webm');
      body.set('voice_duration', String(duration));
      if (replyingTo) body.set('reply_to_id', String(replyingTo.id));

      const sent = await api.send(activeConvId, body);
      messagesRef.current = mergeMessages(messagesRef.current, [sent]);
      setMessages([...messagesRef.current]);
      setReplyingTo(null);
      setIsRecordingVoice(false);
    } catch (err) {
      setError(err.message || 'Ovozli xabar yuborilmadi. Qayta urinib ko‘ring.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendSticker = async (stickerId) => {
    if (busy || !activeConvId) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set('client_id', crypto.randomUUID());
      body.set('sticker', stickerId);
      if (replyingTo) body.set('reply_to_id', String(replyingTo.id));

      const sent = await api.send(activeConvId, body);
      messagesRef.current = mergeMessages(messagesRef.current, [sent]);
      setMessages([...messagesRef.current]);
      setReplyingTo(null);
      setShowStickerPicker(false);
    } catch (err) {
      setError(err.message || 'Stiker yuborilmadi. Qayta urinib ko‘ring.');
    } finally {
      setBusy(false);
    }
  };

  const scrollToMessage = (msgId) => {
    const el = document.getElementById(`widget-msg-${msgId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('support-message-highlight');
      setTimeout(() => el.classList.remove('support-message-highlight'), 1200);
    }
  };

  const handleStartConversation = async (e) => {
    e.preventDefault();
    if (!newForm.text.trim() || busy) return;

    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set('name', newForm.name || (user?.username || 'Mijoz'));
      body.set('subject', newForm.subject || 'Yordam so‘rovi');
      body.set('text', newForm.text);
      body.set('language', savedSupportLanguage());
      body.set('consent', 'true');
      body.set('client_id', crypto.randomUUID());
      if (image) body.set('image', image);

      const created = await api.create(body, activeTenant?.id);
      setIsStartingNew(false);
      setActiveConvId(created.id);
      setActiveConv(created);
      messagesRef.current = [];
      setMessages([]);
      setDraft('');
      setImage(null);
      setNewForm((prev) => ({ ...prev, subject: '', text: '' }));
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError(err.message || 'Murojaat yuborilmadi. Qayta urinib ko‘ring.');
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (hidden) return null;
  const title = supportText[savedSupportLanguage()].title;

  return (
    <>
      {/* Floating Chat Popup Window */}
      {isOpen && (
        <div
          className="support-widget-window"
          style={{
            bottom: widgetBottom,
            right: pathname === '/pos' ? 20 : 24,
          }}
        >
          {/* Header */}
          <div className="support-widget-header">
            <div className="support-widget-header-info">
              <div className="support-widget-avatar">
                <Headphones size={18} />
              </div>
              <div>
                <h4 className="support-widget-title">Yordam markazi</h4>
                <div className="support-widget-status">
                  <span className="support-widget-status-dot" />
                  <span>Operatorlar onlayn · 24/7</span>
                </div>
              </div>
            </div>

            <div className="support-widget-header-actions">
              {conversations.length > 1 && !isStartingNew && (
                <button
                  type="button"
                  onClick={() => setIsStartingNew(true)}
                  className="support-widget-icon-btn"
                  title="Yangi suhbat ochish"
                >
                  <Plus size={16} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  navigate('/support' + (activeConvId ? `?conversation=${activeConvId}` : ''));
                }}
                className="support-widget-icon-btn"
                title="To‘liq sahifada ochish"
              >
                <Maximize2 size={15} />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="support-widget-icon-btn"
                title="Yopish"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          {/* Body Content */}
          <div className="support-widget-body">
            {error && <p role="alert" style={{ margin: '0 0 10px', color: 'var(--accent-rose)', fontSize: 13 }}>{error}</p>}
            {isStartingNew ? (
              /* New Conversation Starter Screen */
              <div className="support-widget-start">
                <div className="support-widget-welcome">
                  <div className="support-widget-welcome-icon">
                    <Sparkles size={24} color="var(--primary)" />
                  </div>
                  <h5>Sizga qanday yordam bera olamiz?</h5>
                  <p>Savolingiz yoki taklifingiz bo‘lsa, yozing. Texnik mutaxassislarimiz tezkor javob berishadi.</p>
                </div>

                <form onSubmit={handleStartConversation} className="support-widget-start-form">
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Mavzu (ixtiyoriy)
                    </label>
                    <input data-api-field="subject"
                      type="text"
                      className="input-field"
                      placeholder="Masalan: Kassa yoki hisob-kitob"
                      value={newForm.subject}
                      onChange={(e) => setNewForm({ ...newForm, subject: e.target.value })}
                      style={{ padding: '8px 12px', fontSize: 13 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Savolingiz matni <span style={{ color: 'var(--accent-rose)' }}>*</span>
                    </label>
                    <textarea data-api-field="text"
                      rows={3}
                      className="input-field"
                      required
                      placeholder="Savolingizni bu yerga batafsil yozing..."
                      value={newForm.text}
                      onChange={(e) => setNewForm({ ...newForm, text: e.target.value })}
                      style={{ padding: '8px 12px', fontSize: 13, resize: 'none' }}
                    />
                  </div>

                  {conversations.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsStartingNew(false)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', textAlign: 'left', padding: 0 }}
                    >
                      ← Oldingi suhbatga qaytish
                    </button>
                  )}

                  <button
                    type="submit"
                    disabled={busy || !newForm.text.trim()}
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 700, marginTop: 4 }}
                  >
                    {busy ? 'Yuborilmoqda...' : 'Suhbatni boshlash'}
                  </button>
                </form>
              </div>
            ) : loadingConv ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                <IlbiLoader label="Xabarlar yuklanmoqda..." />
              </div>
            ) : (
              /* Live Chat Thread */
              <div className="support-widget-messages">
                {messages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '30px 16px', color: 'var(--text-muted)', fontSize: 12.5 }}>
                    Muloqot boshlandi. Mutaxassis tez orada javob yozadi.
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOwn = isAdmin
                      ? (msg.sender === 'operator' || (msg.author && msg.author === user?.id))
                      : (msg.sender === 'visitor');
                    const isOperatorSender = msg.sender === 'operator' || msg.is_staff;
                    return (
                      <div
                        key={msg.id}
                        id={`widget-msg-${msg.id}`}
                        className={`support-widget-msg ${isOwn ? 'is-own from-user own' : 'from-staff other'}`}
                      >
                        <div className="support-msg-action-bar">
                          <button
                            type="button"
                            className="support-msg-reply-btn"
                            title="Javob yozish"
                            onClick={() => setReplyingTo(msg)}
                          >
                            <CornerUpLeft size={12} />
                          </button>
                        </div>
                        {!isOwn && (
                          <div
                            className={`support-widget-msg-avatar ${isAdmin ? 'admin-clickable' : ''}`}
                            title={isAdmin ? "Mijoz profilini ko'rish va boshqarish" : (isOperatorSender ? 'Operator' : 'Mijoz')}
                            onClick={() => {
                              if (isAdmin && activeConvId) {
                                setShowProfileModal(true);
                              }
                            }}
                          >
                            {isOperatorSender ? <Headphones size={13} /> : <span style={{ fontSize: 11, fontWeight: 700 }}>M</span>}
                          </div>
                        )}
                        <div className={`support-widget-bubble ${msg.sticker ? 'support-sticker-bubble' : ''}`}>
                          {msg.reply_to && (
                            <div
                              className="support-message-reply-quote"
                              onClick={() => scrollToMessage(msg.reply_to.id)}
                              title="Asl xabarga o‘tish"
                            >
                              <span className="support-message-reply-author">{msg.reply_to.author_name}</span>
                              <span className="support-message-reply-text">
                                {msg.reply_to.sticker
                                  ? `Stiker: ${STICKER_DICT[msg.reply_to.sticker]?.label || 'Stiker'}`
                                  : msg.reply_to.has_voice
                                  ? `Ovozli xabar (${msg.reply_to.voice_duration}s)`
                                  : msg.reply_to.has_image
                                  ? 'Rasm'
                                  : msg.reply_to.text}
                              </span>
                            </div>
                          )}
                          {msg.text && <div className="support-widget-bubble-text">{msg.text}</div>}
                          {msg.has_image && (
                            <PrivateImage
                              api={api}
                              conversationId={activeConvId}
                              messageId={msg.id}
                            />
                          )}
                          {msg.has_voice && (
                            <VoicePlayer
                              api={api}
                              conversationId={activeConvId}
                              messageId={msg.id}
                              duration={msg.voice_duration}
                              isOwn={isOwn}
                            />
                          )}
                          {msg.sticker && (
                            <StickerItem stickerId={msg.sticker} showLabel={false} />
                          )}
                          <div className="support-widget-bubble-time">
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Footer Input Bar (Visible during active conversation) */}
          {!isStartingNew && activeConv && (
            <div className="support-widget-footer" style={{ position: 'relative' }}>
              {replyingTo && (
                <div className="support-reply-banner">
                  <div className="support-reply-banner-content">
                    <span className="support-reply-banner-title">
                      {replyingTo.author_name || (replyingTo.sender === 'operator' || replyingTo.is_staff ? 'Operator' : 'Siz')}
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
                    <X size={13} />
                  </button>
                </div>
              )}

              {isRecordingVoice ? (
                <VoiceRecorder
                  onSend={handleSendVoice}
                  onCancel={() => setIsRecordingVoice(false)}
                  isCompact={true}
                />
              ) : (
                <>
                  {imagePreview && (
                    <div className="support-widget-image-preview">
                      <img src={imagePreview} alt="Preview" />
                      <button
                        type="button"
                        onClick={() => { setImage(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                        className="support-widget-remove-img"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleSendMessage} className="support-widget-input-row">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file && file.size <= 2 * 1024 * 1024) setImage(file);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="support-widget-attach-btn"
                      title="Rasm yuklash (maks. 2MB)"
                    >
                      <Paperclip size={18} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsRecordingVoice(true)}
                      className="support-widget-attach-btn"
                      title="Ovozli xabar yozish"
                    >
                      <Mic size={18} />
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowStickerPicker((prev) => !prev)}
                      className={`support-widget-attach-btn ${showStickerPicker ? 'active' : ''}`}
                      title="Stiker yuborish"
                    >
                      <Smile size={18} />
                    </button>

                    {showStickerPicker && (
                      <StickerPicker
                        onSelect={handleSendSticker}
                        onClose={() => setShowStickerPicker(false)}
                      />
                    )}

                    <textarea
                      rows={1}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      placeholder="Xabar yozing..."
                      className="support-widget-textarea"
                    />

                    <button
                      type="submit"
                      disabled={busy || (!draft.trim() && !image)}
                      className="support-widget-send-btn"
                      title="Xabarni yuborish"
                    >
                      <Send size={15} />
                    </button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Floating Toggle Launcher Button */}
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onClick={handleLauncherClick}
        onDoubleClick={handleLauncherDoubleClick}
        className={`support-launcher ${pathname === '/pos' ? 'compact' : ''} ${isOpen ? 'active-open' : ''} ${isDragging ? 'is-dragging' : ''}`}
        style={{
          bottom: launcherBottom,
          right: pathname === '/pos' ? 20 : 24,
        }}
        aria-label={`${title}${unread ? ` (${unread})` : ''}`}
        title={isOpen ? 'Chatni yopish' : `${title} (O‘rnini surish uchun bosing va torting, joyiga qaytarish uchun 2 marta bosing)`}
      >
        {isOpen ? (
          <X size={20} />
        ) : (
          <>
            <Headphones size={21} />
            <span>{title}</span>
            {unread > 0 && <b className="support-badge">{unread}</b>}
          </>
        )}
      </button>

      {/* Customer Profile Modal for Admin/Operator */}
      {showProfileModal && activeConvId && isAdmin && (
        <CustomerProfileModal
          conversationId={activeConvId}
          api={api}
          onClose={() => setShowProfileModal(false)}
        />
      )}
    </>
  );
}


export default function HelpLauncher() {
  const { isAuthenticated, user, loading, sessionError, sessionId } = useAuth();
  if (loading || sessionError) return null;
  // Never carry messages or pending UI work across authentication boundaries.
  return <HelpLauncherContent key={`${sessionId}:${isAuthenticated ? `${user.id}:${user.role}` : 'guest'}`} />;
}
