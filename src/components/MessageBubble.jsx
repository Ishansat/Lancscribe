import React from 'react';

function initialsOf(name) {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function MessageBubble({ seg, targetLang, color }) {
  const time = new Date((seg.start || 0) * 1000).toISOString().substr(11, 8);
  const srcLang = (seg.lang || 'en').toUpperCase();
  const tgtLang = (seg.target_lang || targetLang || 'es').toUpperCase();
  const isSameLang = seg.lang && seg.target_lang && seg.lang === seg.target_lang;

  return (
    <div className="message" id={`msg-${seg.id}`}>
      <div
        className="avatar"
        style={{ borderColor: color, color: color }}
        title={seg.speaker}
      >
        {initialsOf(seg.speaker || 'You')}
      </div>
      <div className="bubble">
        <div className="bubble-head">
          <span className="speaker-name">{seg.speaker || 'Speaker 1 (You)'}</span>
          <span className="label" style={{ opacity: 0.5 }}>{time}</span>
          <div className="pill-group">
            <span className="pill" title="Spoken original language">{srcLang}</span>
            <span className="pill" title="Target translation language">{tgtLang}</span>
            {seg.engine && seg.engine !== 'none' && (
              <span className="pill" style={{ opacity: 0.6 }} title="Translation engine">
                {seg.engine === 'gemini-live' || seg.engine === 'gemini' ? 'Gemini 3.5' : seg.engine}
              </span>
            )}
          </div>
        </div>

        <div className="transcript-grid">
          {/* Original Transcript */}
          <div className="transcript-block">
            <span className="block-label">SPOKEN</span>
            <p className="source-text">{seg.text}</p>
          </div>

          {/* Simultaneous Translation */}
          <div className="transcript-block">
            <span className="block-label">TRANSLATED</span>
            {seg.translating ? (
              <p className="source-text">Translating...</p>
            ) : seg.translated ? (
              <p className="translated-text" lang={seg.target_lang || targetLang}>
                {seg.translated}
              </p>
            ) : isSameLang ? (
              <p className="translated-text" lang={seg.target_lang || targetLang}>
                {seg.text}
              </p>
            ) : (
              <p className="source-text">Generating translation...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
