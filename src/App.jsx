import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, ArrowLeftRight, Settings } from 'lucide-react';
import { BackendSocket } from './services/backend.js';
import { SystemAudioCapture } from './services/audioCapture.js';
import TranscriptView from './components/TranscriptView.jsx';
import ControlBar from './components/ControlBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import MeetingDetectedBanner from './components/MeetingDetectedBanner.jsx';

const AVATAR_COLORS = [
  '#10b981', '#0ea5e9', '#f59e0b', '#8b5cf6',
  '#ef4444', '#14b8a6', '#f97316', '#ec4899',
  '#84cc16', '#6366f1'
];

const POPULAR_LANGS = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hi', name: 'Hindi' },
];

function cleanText(t) {
  return (t || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeSimilarity(s1, s2) {
  const c1 = cleanText(s1);
  const c2 = cleanText(s2);
  if (!c1 || !c2) return 0;
  if (c1 === c2) return 1.0;
  if (c1.includes(c2) || c2.includes(c1)) {
    const minLen = Math.min(c1.length, c2.length);
    const maxLen = Math.max(c1.length, c2.length);
    if (minLen / maxLen > 0.6) return 0.9;
  }
  const w1 = new Set(c1.split(' ').filter((w) => w.length > 1));
  const w2 = new Set(c2.split(' ').filter((w) => w.length > 1));
  if (w1.size === 0 || w2.size === 0) return 0;
  let matches = 0;
  for (const w of w1) {
    if (w2.has(w)) matches++;
  }
  const union = new Set([...w1, ...w2]).size;
  return union > 0 ? matches / union : 0;
}

const BANNED_PATTERNS = [
  'thank you for watching',
  'subtitles by',
  'translated by',
  'amara.org',
  'sample text',
  'sample message',
  'meeting transcript',
];

function isSampleOrHallucination(t) {
  const c = cleanText(t);
  if (!c || c.length < 2) return true;
  return BANNED_PATTERNS.some((p) => c.includes(p));
}

export default function App() {
  const [backend, setBackend] = useState({ ready: false, port: null });
  const [backendError, setBackendError] = useState(null);
  const [languages, setLanguages] = useState([]);
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState(() => {
    return localStorage.getItem('meeting_target_lang') || 'en';
  });
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [segments, setSegments] = useState([]);
  const [detectedLang, setDetectedLang] = useState('en');
  const [models, setModels] = useState(null);
  const [warmProgress, setWarmProgress] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [detectedMeetings, setDetectedMeetings] = useState([]);

  const sockRef = useRef(null);
  const captureRef = useRef(null);
  const speechRecRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(0);
  const segmentsRef = useRef([]);
  const sourceLangRef = useRef(sourceLang);
  const targetLangRef = useRef(targetLang);
  const recentTextsRef = useRef([]);
  const isRecordingRef = useRef(false);

  const isRecentSpoken = useCallback((text) => {
    if (!text || isSampleOrHallucination(text)) return true;
    const clean = cleanText(text);
    if (!clean || clean.length < 2) return true;
    const now = Date.now();
    const list = recentTextsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      if (item.clean === clean) return true;
      if (now - item.time < 60000) {
        if (computeSimilarity(clean, item.clean) >= 0.7) {
          return true;
        }
      }
    }
    // Also check if text matches any existing segment in current session
    for (const seg of segmentsRef.current) {
      if (seg.text && computeSimilarity(seg.text, text) >= 0.8) {
        return true;
      }
    }
    return false;
  }, []);

  const recordRecentSpoken = useCallback((text) => {
    const clean = cleanText(text);
    if (!clean) return;
    recentTextsRef.current.push({ clean, time: Date.now() });
    if (recentTextsRef.current.length > 200) {
      recentTextsRef.current.shift();
    }
  }, []);

  useEffect(() => {
    sourceLangRef.current = sourceLang;
  }, [sourceLang]);

  useEffect(() => {
    targetLangRef.current = targetLang;
  }, [targetLang]);

  const setSegs = useCallback((updater) => {
    setSegments((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      segmentsRef.current = next;
      return next;
    });
  }, []);

  // Helper to translate an individual segment by ID with Auto-Detect support
  const translateSegment = useCallback(async (segId, text, srcLang, tgtLang) => {
    if (!text || !tgtLang) {
      setSegs((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, translated: text, translating: false } : s))
      );
      return;
    }

    const effectiveSrc = srcLang || sourceLangRef.current || 'auto';
    if (effectiveSrc !== 'auto' && effectiveSrc === tgtLang) {
      setSegs((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, translated: text, translating: false } : s))
      );
      return;
    }

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          sourceLang: effectiveSrc,
          targetLang: tgtLang,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.detectedLang) {
          setDetectedLang(data.detectedLang);
        }
        setSegs((prev) =>
          prev.map((s) =>
            s.id === segId
              ? {
                  ...s,
                  lang: data.detectedLang || s.lang || 'en',
                  translated: data.translated || text,
                  translating: false,
                  engine: data.engine || 'gemini-live',
                }
              : s
          )
        );
      }
    } catch (err) {
      console.warn('Translate segment error:', err);
      setSegs((prev) =>
        prev.map((s) => (s.id === segId ? { ...s, translating: false } : s))
      );
    }
  }, [setSegs]);

  // Swap language function
  const swapLanguages = () => {
    const curTarget = targetLang;
    const curSource = sourceLang === 'auto' ? (detectedLang || 'es') : sourceLang;
    changeTargetLang(curSource);
    setSourceLang(curTarget);
  };

  // ---- connect to backend on mount ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await window.api.getBackend();
        if (cancelled) return;
        if (!info || !info.ready) {
          setBackendError('Local AI backend failed to start. Check the console for details.');
          return;
        }
        setBackend({ ready: true, port: info.port || 3000 });

        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.host || `127.0.0.1:${info.port || 3000}`;
        const sock = new BackendSocket(`${wsProto}//${wsHost}/ws`);
        sockRef.current = sock;

        sock.on('ready', () => {
          setListening(true);
          sock.emit('config', { target_lang: targetLangRef.current });
        });

        sock.on('segment', (m) => {
          if (!m.seg || !m.seg.text) return;
          const incoming = m.seg;
          const incomingClean = cleanText(incoming.text);
          if (!incomingClean) return;

          setSegs((prev) => {
            // Check if matching any existing segment
            const existingIdx = prev.findIndex((s) => {
              if (s.id === incoming.id) return true;
              const sClean = cleanText(s.text);
              if (sClean === incomingClean) return true;
              if (
                sClean.length > 5 &&
                incomingClean.length > 5 &&
                Math.abs((s.start || 0) - (incoming.start || 0)) < 10
              ) {
                if (sClean.includes(incomingClean) || incomingClean.includes(sClean)) {
                  return true;
                }
              }
              return false;
            });

            if (existingIdx !== -1) {
              const copy = [...prev];
              const existing = copy[existingIdx];
              copy[existingIdx] = {
                ...existing,
                ...incoming,
                id: existing.id, // preserve existing id
                translated: incoming.translated || existing.translated,
                translating: false,
              };
              return copy;
            }

            // If not found in prev, check if it was recently spoken by user (avoid audio loopback duplicates)
            if (isRecentSpoken(incoming.text)) {
              // Find the latest recent bubble to attach translation to if it lacks one
              const lastIdx = prev.length - 1;
              if (lastIdx >= 0) {
                const copy = [...prev];
                if (!copy[lastIdx].translated && incoming.translated) {
                  copy[lastIdx] = {
                    ...copy[lastIdx],
                    translated: incoming.translated,
                    translating: false,
                  };
                  return copy;
                }
              }
              return prev; // drop duplicate
            }

            recordRecentSpoken(incoming.text);

            const needTranslate =
              !incoming.translated &&
              incoming.lang &&
              incoming.target_lang &&
              incoming.lang !== incoming.target_lang;

            if (needTranslate) {
              // Trigger background translation immediately
              translateSegment(
                incoming.id,
                incoming.text,
                incoming.lang,
                incoming.target_lang || targetLangRef.current
              );
            }

            return [...prev, { ...incoming, translating: needTranslate }];
          });
        });

        sock.on('language', (m) => {
          if (m.language) setDetectedLang(m.language);
        });

        sock.on('model', (m) => {
          setWarmProgress((p) => ({
            ...p,
            [m.repo]: { done: m.done, total: m.total },
          }));
        });

        sock.on('error', (m) => setNotice(m.message));

        await sock.connect();

        const langsRes = await fetch('/languages');
        const langsJson = await langsRes.json();
        if (!cancelled) setLanguages(langsJson);
        const modelsRes = await fetch('/models');
        setModels((await modelsRes.json()).models);
      } catch (e) {
        if (!cancelled) setBackendError(String(e.message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setSegs, isRecentSpoken, recordRecentSpoken, translateSegment]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (captureRef.current) captureRef.current.stop();
      if (sockRef.current) sockRef.current.close();
    };
  }, []);

  useEffect(() => {
    const unsubscribe = window.api.onMeetingDetected((data) => {
      setDetectedMeetings(data && data.meetings ? data.meetings : []);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.api.onMeetingDetectionPermissionNeeded((message) => {
      setNotice(message);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (captureRef.current) {
      captureRef.current.toggleMicrophone(isMuted).catch((err) => {
        if (!isMuted) {
          setNotice('Could not start microphone: ' + (err.message || err));
          setIsMuted(true); // revert
        }
      });
    }

    if (speechRecRef.current) {
      if (isMuted) {
        try { speechRecRef.current.abort(); } catch {}
      } else if (isRecordingRef.current) {
        try { speechRecRef.current.start(); } catch {}
      }
    }
  }, [isMuted]);

  // ---- target language change ----
  const changeTargetLang = async (code) => {
    setTargetLang(code);
    targetLangRef.current = code;
    try {
      localStorage.setItem('meeting_target_lang', code);
    } catch {
      /* ignore */
    }

    if (sockRef.current) {
      sockRef.current.emit('config', { target_lang: code });
    }

    // Re-translate all existing transcript segments into the newly selected target language
    const currentSegs = segmentsRef.current;
    if (currentSegs.length > 0 && code) {
      // Mark existing items as translating
      setSegs((prev) =>
        prev.map((s) => ({
          ...s,
          target_lang: code,
          translating: s.lang !== code,
        }))
      );

      try {
        const updated = await Promise.all(
          currentSegs.map(async (seg) => {
            if (seg.lang === code) {
              return { ...seg, target_lang: code, translated: seg.text, translating: false };
            }
            try {
              const res = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text: seg.text,
                  sourceLang: seg.lang || detectedLang || 'en',
                  targetLang: code,
                }),
              });
              if (res.ok) {
                const data = await res.json();
                return {
                  ...seg,
                  target_lang: code,
                  translated: data.translated || seg.text,
                  translating: false,
                  engine: data.engine || seg.engine,
                };
              }
            } catch (err) {
              console.warn('Re-translation item error:', err);
            }
            return { ...seg, target_lang: code, translating: false };
          })
        );
        setSegs(updated);
      } catch (err) {
        console.warn('Batch translation error:', err);
      }
    }
  };

  // ---- record toggle ----
  const toggleRecording = async () => {
    if (recording) {
      stopRecording();
      return;
    }
    try {
      isRecordingRef.current = true;
      recentTextsRef.current = [];
      setDetectedMeetings([]);
      window.api.setRecordingState(true);

      const capture = new SystemAudioCapture(
        (chunk) => sockRef.current?.sendAudio(chunk),
        () => {
          stopRecording();
        }
      );
      captureRef.current = capture;
      await capture.start();
      
      try {
        await capture.toggleMicrophone(isMuted);
      } catch (err) {
        setIsMuted(true);
        setNotice('Microphone permission denied. Continuing without mic.');
      }

      // Configure WebSocket for target language
      if (sockRef.current) {
        sockRef.current.emit('config', { target_lang: targetLangRef.current });
      }

      // Browser Speech Recognition for instantaneous real-time transcription + translation
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        try {
          const rec = new SpeechRecognition();
          rec.continuous = true;
          rec.interimResults = false;
          rec.lang = navigator.language || 'en-US';

          rec.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                const text = event.results[i][0].transcript.trim();
                if (!text) continue;

                if (isRecentSpoken(text)) continue;
                recordRecentSpoken(text);

                const currentTgt = targetLangRef.current || 'en';
                const currentSrc = sourceLangRef.current || 'auto';
                const curTime = (Date.now() - (startedAtRef.current || Date.now())) / 1000;
                const tempId = `spk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

                // 1. Create single segment with translating state
                const newSeg = {
                  id: tempId,
                  start: Math.max(0, curTime - 2.0),
                  end: curTime,
                  lang: currentSrc === 'auto' ? 'auto' : currentSrc,
                  text,
                  target_lang: currentTgt,
                  translated: '',
                  translating: true,
                  speaker: 'Speaker 1 (You)',
                  engine: 'gemini-live',
                };

                setSegs((prev) => [...prev, newSeg]);

                // 2. Notify backend to track in recent transcripts
                if (sockRef.current) {
                  sockRef.current.emit('text_segment', {
                    id: tempId,
                    text,
                    lang: currentSrc,
                    target_lang: currentTgt,
                    speaker: 'Speaker 1 (You)',
                  });
                }

                // 3. Immediately translate with auto language detection
                translateSegment(tempId, text, currentSrc, currentTgt);
              }
            }
          };

          rec.onerror = (e) => {
            console.warn('Speech recognition status:', e.error);
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
              setNotice('Microphone access denied. Please check permissions.');
              stopRecording();
            } else if (e.error !== 'no-speech') {
              setNotice(`Speech recognition error: ${e.error}`);
            }
          };

          rec.onend = () => {
            if (isRecordingRef.current && speechRecRef.current && !isMuted) {
              try {
                rec.start();
              } catch {
                /* already running or stopped */
              }
            }
          };

          if (!isMuted) {
            rec.start();
          }
          speechRecRef.current = rec;
        } catch (err) {
          console.warn('SpeechRecognition init error:', err);
        }
      }

      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 500);
    } catch (e) {
      isRecordingRef.current = false;
      window.api.setRecordingState(false);
      setNotice(String(e.message || e));
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    window.api.setRecordingState(false);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (captureRef.current) {
      captureRef.current.stop();
      captureRef.current = null;
    }
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        /* ignore */
      }
      speechRecRef.current = null;
    }
    if (sockRef.current) sockRef.current.emit('stop');
    setRecording(false);
  };

  // ---- export TXT ----
  const exportTxt = async () => {
    const segs = segmentsRef.current;
    if (segs.length === 0) {
      setNotice('Nothing to export yet.');
      return;
    }
    const langNameStr = (languages.find((l) => l.code === targetLang) || {}).name || targetLang;
    const lines = [];
    lines.push('Meeting Transcript');
    lines.push(`Target language: ${langNameStr}`);
    lines.push('='.repeat(40));
    lines.push('');
    for (const s of segs) {
      const t = new Date((s.start || 0) * 1000).toISOString().substr(11, 8);
      lines.push(`[${t}] ${s.speaker} (${(s.lang || 'en').toUpperCase()} → ${(s.target_lang || targetLang).toUpperCase()}):`);
      lines.push(`Original: ${s.text}`);
      if (s.translated) {
        lines.push(`Translated: ${s.translated}`);
      }
      lines.push('');
    }
    const fileName = `meeting-transcript-${new Date().toISOString().slice(0, 10)}.txt`;
    await window.api.saveTxt(fileName, lines.join('\n'));
  };

  return (
    <div className="app-container">
      <header id="main-header">
        <div className="header-left">
          <span className={`record-dot ${recording ? '' : 'hidden'}`} id="live-record-dot" />
          <span className={`timer ${recording ? '' : 'timer-idle'}`} id="meeting-timer">
            {formatTime(elapsed)}
          </span>
          {recording && (
            <span className="live-badge" title="Live audio stream active">
              LIVE
            </span>
          )}
        </div>

        <div className="header-right" id="header-language-controls">
          {/* 1. Source Language / Auto-Detect selector */}
          <div
            className="lang-control"
            id="source-language-box"
            title="Automatically detect spoken language in real time"
          >
            <Globe size={14} strokeWidth={2} />
            <select
              id="select-source-language"
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
            >
              <option value="auto">
                {sourceLang === 'auto' && detectedLang && detectedLang !== 'en'
                  ? `Auto (${(languages.find((l) => l.code === detectedLang) || {}).name || detectedLang.toUpperCase()})`
                  : 'Auto-Detect'}
              </option>
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Swap languages button */}
          <button
            id="btn-swap-languages"
            className="ctrl-btn"
            style={{ width: '36px', height: '36px', borderRadius: '8px' }}
            onClick={swapLanguages}
            title="Swap source and target languages"
          >
            <ArrowLeftRight size={14} strokeWidth={2} />
          </button>

          {/* 3. Target Language selector */}
          <div
            className="lang-control"
            id="target-language-box"
            title="Choose target translation language"
          >
            <select
              id="select-target-language"
              value={targetLang}
              onChange={(e) => changeTargetLang(e.target.value)}
            >
              {languages.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Settings icon button */}
          <button
            id="btn-open-settings"
            className="ctrl-btn"
            style={{ width: '36px', height: '36px', borderRadius: '8px', marginLeft: '8px' }}
            onClick={() => setShowSettings(true)}
            title="Settings & Export"
          >
            <Settings size={14} strokeWidth={2} />
          </button>
        </div>
      </header>

      <MeetingDetectedBanner
        meetings={detectedMeetings}
        onStart={() => {
          setDetectedMeetings([]);
          if (!recording) toggleRecording();
        }}
        onDismiss={() => setDetectedMeetings([])}
      />

      <main className="content">
        {backendError ? (
          <div className="empty-state">
            <p className="empty-title">Backend failed to start</p>
            <p className="empty-sub">{backendError}</p>
          </div>
        ) : !listening ? (
          <div className="empty-state">
            <p className="empty-title">Connecting to Gemini Live Translate…</p>
            <p className="empty-sub">Initializing real-time multilingual meeting engine.</p>
          </div>
        ) : (
          <TranscriptView
            segments={segments}
            targetLang={targetLang}
            avatarColors={AVATAR_COLORS}
          />
        )}
      </main>

      <ControlBar
        recording={recording}
        onRecord={toggleRecording}
        onStop={stopRecording}
        onMenu={() => setShowSettings(true)}
        isMuted={isMuted}
        onToggleMute={() => setIsMuted((prev) => !prev)}
      />

      {showSettings && (
        <SettingsModal
          languages={languages}
          targetLang={targetLang}
          onTargetChange={changeTargetLang}
          models={models}
          onExport={exportTxt}
          onClose={() => setShowSettings(false)}
          notice={notice}
        />
      )}

      {notice && !showSettings && (
        <div className="toast" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </div>
  );
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
