import React from 'react';
import { Video, X } from 'lucide-react';

export default function MeetingDetectedBanner({ meetings, onStart, onDismiss }) {
  if (!meetings || meetings.length === 0) return null;

  return (
    <div className="meeting-banner">
      <div className="meeting-banner-head">
        <Video size={16} strokeWidth={2} />
        <span>
          {meetings.length === 1
            ? `Meeting detected in ${meetings[0].app}`
            : `${meetings.length} meetings detected`}
        </span>
        <button className="meeting-banner-close" onClick={onDismiss} title="Dismiss">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="meeting-banner-list">
        {meetings.map((m, i) => (
          <div className="meeting-banner-row" key={`${m.app}-${i}`}>
            <div className="meeting-banner-info">
              <span className="meeting-banner-app">{m.app}</span>
              {m.title && <span className="meeting-banner-title">{m.title}</span>}
            </div>
            <button className="btn primary" onClick={() => onStart(m)}>
              Start transcribing
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
