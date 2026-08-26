import React, { useEffect, useState } from 'react';

export default function SettingsModal({
  languages,
  targetLang,
  onTargetChange,
  models,
  onExport,
  onClose,
  notice
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Meeting & Translation Settings</h2>
          <button className="ctrl-btn" style={{ width: 32, height: 32 }} onClick={onClose} title="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <section className="modal-section">
          <h3>Target Translation Language</h3>
          <p className="hint">
            The source language is automatically detected from live spoken audio. Spoken speech is translated into the language you select here in real time.
          </p>
          <select
            className="text-input"
            value={targetLang}
            onChange={(e) => onTargetChange(e.target.value)}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </section>

        <section className="modal-section">
          <h3>Live Translation Engine</h3>
          <p className="hint">
            Powered by Gemini 3.5 Live Translate API for ultra-low latency speech transcription, auto language detection, and translation without requiring heavy local model weights or gigabytes of disk storage.
          </p>
          <div className="model-list">
            <div className="model-row">
              <div className="model-info">
                <span className="model-name">Gemini 3.5 Live Translate Preview</span>
                <span className="model-size">Cloud Streaming API • 0 MB local storage</span>
              </div>
              <span className="model-cached">Active ✓</span>
            </div>
            <div className="model-row">
              <div className="model-info">
                <span className="model-name">Real-Time Multilingual Speech Engine</span>
                <span className="model-size">70+ Languages Supported</span>
              </div>
              <span className="model-cached">Active ✓</span>
            </div>
          </div>
        </section>

        <section className="modal-section">
          <h3>Export Meeting Transcript</h3>
          <p className="hint">
            Download the complete transcript with speaker tags, original speech, and translated text.
          </p>
          <button className="btn primary" onClick={onExport}>
            Export transcript (.txt)
          </button>
        </section>

        {notice && <div className="modal-notice">{notice}</div>}

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
