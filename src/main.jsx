import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Polyfill window.api for browser environment
if (!window.api) {
  window.api = {
    getBackend: async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          return { ready: true, port: window.location.port || (window.location.protocol === 'https:' ? 443 : 80) };
        }
      } catch (e) {
        console.warn('Backend check error:', e);
      }
      return { ready: true, port: window.location.port || 3000 };
    },
    saveTxt: async (defaultName, content) => {
      try {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName || 'meeting-transcript.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return defaultName;
      } catch (err) {
        console.error('Failed to save file:', err);
        return null;
      }
    },
    getSettings: async () => {
      try {
        const data = localStorage.getItem('meeting_translator_settings');
        return data ? JSON.parse(data) : {};
      } catch {
        return {};
      }
    },
    setSettings: async (settings) => {
      try {
        localStorage.setItem('meeting_translator_settings', JSON.stringify(settings));
        return settings;
      } catch {
        return settings;
      }
    },
    openExternal: async (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    setRecordingState: () => {},
    onMeetingDetected: () => () => {},
    onMeetingDetectionPermissionNeeded: () => () => {}
  };
}

window.addEventListener('error', (e) => {
  console.log('[page-error]', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.log('[unhandled-rejection]', String(e.reason));
});

console.log('[renderer] booting');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);