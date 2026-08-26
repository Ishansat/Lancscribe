import React, { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble.jsx';

export default function TranscriptView({ segments, targetLang, avatarColors }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [segments.length]);

  if (segments.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-title">Ready to capture system audio</p>
        <p className="empty-sub">
          Press record and speak — everything said in the meeting will be
          transcribed and translated into your chosen language in real time.
        </p>
      </div>
    );
  }

  // group speaker labels -> color index
  const speakerIndex = {};
  let idx = 0;
  for (const s of segments) {
    if (!(s.speaker in speakerIndex)) {
      speakerIndex[s.speaker] = idx++;
    }
  }

  return (
    <>
      {segments.map((s) => (
        <MessageBubble
          key={s.id}
          seg={s}
          targetLang={targetLang}
          color={avatarColors[speakerIndex[s.speaker] % avatarColors.length]}
        />
      ))}
      <div ref={bottomRef} />
    </>
  );
}