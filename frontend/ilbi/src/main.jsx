import React, { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { RetryButton } from './components/common/RecoveryNotice';
import { installFormValidation } from './utils/formValidation.js';

installFormValidation();

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    document.getElementById('ilbi-boot-loader')?.remove();
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-app)',
          color: 'var(--text-primary)',
          padding: 24,
          fontFamily: 'system-ui, sans-serif'
        }}>
          <div style={{
            maxWidth: 540,
            background: 'var(--bg-card)',
            border: '1px solid rgba(var(--danger-rgb), 0.3)',
            borderRadius: 16,
            padding: 28,
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
          }}>
            <h2 style={{ margin: '0 0 12px', color: 'var(--accent-rose)', fontSize: 20 }}>
              Kutilmagan xatolik yuz berdi
            </h2>
            <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 14 }}>
              Ilovani yuklashda xatolik aniqlandi:
            </p>
            <pre style={{
              background: 'var(--bg-input)',
              padding: 14,
              borderRadius: 8,
              color: 'var(--accent-rose)',
              fontSize: 12,
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              margin: '0 0 20px'
            }}>
              {this.state.error?.message || String(this.state.error)}
            </pre>
            <RetryButton variant="primary" onClick={() => window.location.reload()}>Qayta yuklash</RetryButton>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
