import React from 'react';
import { Mic, Square, MoreHorizontal } from 'lucide-react';

export default function ControlBar({ recording, onRecord, onStop, onMenu, isMuted, onToggleMute }) {
  return (
    <footer id="meeting-controls">
      {/* 1. Microphone Toggle Button */}
      <button
        id="btn-mic-toggle"
        className={`ctrl-btn mic-btn ${isMuted ? 'muted' : ''}`}
        onClick={onToggleMute || onRecord}
        title={isMuted ? 'Microphone muted' : 'Microphone active'}
      >
        <Mic size={20} strokeWidth={2} />
      </button>

      {/* 2. Stop Button */}
      <button
        id="btn-stop-record"
        className="ctrl-btn stop-btn"
        onClick={onStop}
        disabled={!recording}
        title="Stop recording"
      >
        <Square size={14} fill="currentColor" strokeWidth={0} />
      </button>

      {/* 3. Main Red Record Button */}
      <button
        id="btn-main-record"
        className="record-btn"
        onClick={onRecord}
        title={recording ? 'Stop recording' : 'Start recording'}
      >
        {recording ? (
          <div className="record-square" />
        ) : (
          <div className="record-circle" />
        )}
      </button>

      {/* 4. More Options Button */}
      <button
        id="btn-more-options"
        className="ctrl-btn menu-btn"
        onClick={onMenu}
        title="Settings & Export"
      >
        <MoreHorizontal size={20} strokeWidth={2} />
      </button>
    </footer>
  );
}