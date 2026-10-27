import React, { Component } from 'react';
import { RetryButton } from './RecoveryNotice';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    document.getElementById('ilbi-boot-loader')?.remove();
    console.error('ILBI render failed.');
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
              Sahifani qayta yuklab ko‘ring. Kiritgan ma’lumotlaringizni qayta tekshirish kerak bo‘lishi mumkin.
            </p>
            <RetryButton variant="primary" onClick={() => window.location.reload()}>Qayta yuklash</RetryButton>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

