import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import { installFormValidation } from './utils/formValidation.js';

installFormValidation();

createRoot(document.getElementById('root'), {
  onCaughtError: () => console.error('ILBI display error handled.'),
  onUncaughtError: () => console.error('ILBI display failed.'),
}).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
