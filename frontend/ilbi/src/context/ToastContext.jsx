import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { safeDisplayText } from '../utils/safePresentation.js';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const recentMapRef = useRef(new Map());

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    if (!message || typeof message !== 'string') return;
    message = safeDisplayText(message);

    // Deduplicate identical message within 2.5 seconds to prevent spam
    const now = Date.now();
    const key = `${type}:${message.slice(0, 100)}`;
    const lastTime = recentMapRef.current.get(key);
    if (lastTime && now - lastTime < 2500) {
      return;
    }
    recentMapRef.current.set(key, now);

    const id = Date.now() + Math.random().toString(36).substring(2, 9);
    setToasts((prev) => {
      // Keep maximum 4 toasts visible at a time
      const next = [...prev, { id, message, type }];
      return next.slice(-4);
    });

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useMemo(
    () => ({
      success: (msg, duration) => addToast(msg, 'success', duration),
      error: (msg, duration) => addToast(msg, 'error', duration),
      warning: (msg, duration) => addToast(msg, 'warning', duration),
      info: (msg, duration) => addToast(msg, 'info', duration),
    }),
    [addToast]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" role="region" aria-live="polite">
        {toasts.map((item) => {
          let Icon = Info;
          let color = 'var(--primary)';
          if (item.type === 'success') {
            Icon = CheckCircle2;
            color = 'var(--accent-emerald)';
          } else if (item.type === 'error') {
            Icon = XCircle;
            color = 'var(--accent-rose)';
          } else if (item.type === 'warning') {
            Icon = AlertTriangle;
            color = 'var(--accent-amber)';
          }

          return (
            <div
              key={item.id}
              className="toast-item"
              style={{
                borderLeft: `4px solid ${color}`,
              }}
            >
              <Icon size={18} color={color} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, lineHeight: 1.4, wordBreak: 'break-word' }}>
                {item.message}
              </span>
              <button
                onClick={() => removeToast(item.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                }}
                aria-label="Yopish"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

