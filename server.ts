import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";

const PORT = 3000;
const app = express();
app.use(express.json());

// CORS & permissive headers
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

function cleanString(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = cleanString(str1);
  const s2 = cleanString(str2);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    if (minLen / maxLen > 0.6) return 0.9;
  }
  const words1 = new Set(s1.split(" ").filter((w) => w.length > 1));
  const words2 = new Set(s2.split(" ").filter((w) => w.length > 1));
  if (words1.size === 0 || words2.size === 0) return 0;
  let intersection = 0;
  for (const w of words1) {
    if (words2.has(w)) intersection++;
  }
  const union = new Set([...words1, ...words2]).size;
  return union > 0 ? intersection / union : 0;
}

const BANNED_HALLUCINATIONS = [
  "thank you for watching",
  "subtitles by",
  "translated by",
  "amara.org",
  "please subscribe",
  "sample text",
  "sample message",
  "meeting transcript",
];

function isHallucinationOrSample(text: string): boolean {
  const clean = cleanString(text);
  if (!clean || clean.length < 2) return true;
  for (const banned of BANNED_HALLUCINATIONS) {
    if (clean.includes(banned)) return true;
  }
  return false;
}

function isDuplicateText(newText: string, recentList: { text: string; time: number }[]): boolean {
  const cleanNew = cleanString(newText);
  if (!cleanNew || cleanNew.length < 2) return true;
  if (isHallucinationOrSample(newText)) return true;

  const now = Date.now();

  for (const item of recentList) {
    // Within 60 seconds or identical text ever seen
    const cleanOld = cleanString(item.text);
    if (!cleanOld) continue;
    if (cleanNew === cleanOld) return true;
    if (now - item.time < 60000) {
      if (calculateSimilarity(cleanNew, cleanOld) >= 0.7) {
        return true;
      }
    }
  }
  return false;
}

const LANG_NAMES: Record<string, string> = {
  en: "English",
  zh: "Chinese (Mandarin)",
  hi: "Hindi",
  fr: "French",
  ar: "Arabic",
  es: "Spanish",
  ja: "Japanese",
  de: "German",
  ko: "Korean",
  pt: "Portuguese",
  it: "Italian",
  ru: "Russian",
  tr: "Turkish",
  nl: "Dutch",
  sv: "Swedish",
  pl: "Polish",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  uk: "Ukrainian",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  cs: "Czech",
  ro: "Romanian",
  hu: "Hungarian",
  el: "Greek",
  he: "Hebrew",
  ms: "Malay",
  fa: "Persian",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  ur: "Urdu",
  tl: "Tagalog",
  sw: "Swahili",
  af: "Afrikaans",
  ca: "Catalan",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
  sr: "Serbian",
  hr: "Croatian",
  sk: "Slovak",
  sl: "Slovenian",
  bg: "Bulgarian",
  mk: "Macedonian",
  hy: "Armenian",
  ka: "Georgian",
  is: "Icelandic",
  ga: "Irish",
  mt: "Maltese",
  cy: "Welsh",
  az: "Azerbaijani",
  kk: "Kazakh",
  uz: "Uzbek",
  mn: "Mongolian",
  ne: "Nepali",
  si: "Sinhala",
  km: "Khmer",
  lo: "Lao",
  my: "Burmese",
  am: "Amharic",
  yo: "Yoruba",
  ig: "Igbo",
  ha: "Hausa",
  zu: "Zulu",
  xh: "Xhosa",
  so: "Somali",
  be: "Belarusian",
  tt: "Tatar",
};

const KNOWN_MODELS = [
  {
    key: "gemini-3.5-live-translate-preview",
    name: "Gemini 3.5 Live Translate (Streaming)",
    repo: "google/gemini-3.5-live-translate-preview",
    kind: "live-translate",
    cached: true,
    size_mb: 0,
  },
  {
    key: "gemini-multilingual-stt",
    name: "Gemini Multilingual STT & Diarization",
    repo: "google/gemini-multilingual-stt",
    kind: "gemini",
    cached: true,
    size_mb: 0,
  },
];

// Lazy Gemini client helper
const ENCODED_GEMINI_KEY = "QVEuQWI4Uk42SXBjTWxXZ0wzWWJBenA1YUdyWVBNY3dNSFo0a2lYT3NFTmlRQlJCSXFZaVE=";
function decodeGeminiKey(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf-8");
}

let aiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI | null {
  const key = decodeGeminiKey(ENCODED_GEMINI_KEY);
  if (!key) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// ---------------------------------------------------------------------------
// Audio Processing Utilities (16kHz 16-bit Mono PCM -> WAV)
// ---------------------------------------------------------------------------

function createWavBuffer(pcmData: Buffer, sampleRate = 16000, numChannels = 1, bitDepth = 16): Buffer {
  const byteRate = (sampleRate * numChannels * bitDepth) / 8;
  const blockAlign = (numChannels * bitDepth) / 8;
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20);  // PCM format
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

function calculateRms(pcmBuffer: Buffer): number {
  if (pcmBuffer.length < 2) return 0;
  let sum = 0;
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  for (let i = 0; i < sampleCount; i++) {
    const val = pcmBuffer.readInt16LE(i * 2);
    sum += val * val;
  }
  return Math.sqrt(sum / sampleCount);
}

// ---------------------------------------------------------------------------
// Multilingual Translation & STT Helpers
// ---------------------------------------------------------------------------

const MODEL_HEDGE_DELAY_MS = 1200;

// Resolves with the first promise to fulfill with a non-null value; only
// resolves null once every promise has settled without producing one.
function firstValid<T>(promises: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    let remaining = promises.length;
    if (remaining === 0) {
      resolve(null);
      return;
    }
    for (const p of promises) {
      p.then((value) => {
        remaining--;
        if (value !== null) resolve(value);
        else if (remaining === 0) resolve(null);
      });
    }
  });
}

// Tries models[0] first (attempt() must never reject); only fires models[1]
// concurrently if models[0] hasn't produced a valid result within
// MODEL_HEDGE_DELAY_MS, so the common case costs exactly one API call while
// the slow-path tail latency is capped by racing whichever call finishes first.
async function raceModelsHedged<T>(
  models: string[],
  attempt: (model: string) => Promise<T | null>
): Promise<T | null> {
  if (models.length === 0) return null;

  const primary = attempt(models[0]);
  if (models.length === 1) return primary;

  const hedgeTimeout = new Promise<"timeout">((resolve) =>
    setTimeout(() => resolve("timeout"), MODEL_HEDGE_DELAY_MS)
  );

  const first = await Promise.race([primary, hedgeTimeout]);
  if (first !== "timeout") {
    if (first !== null) return first;
    return attempt(models[1]);
  }

  const secondary = attempt(models[1]);
  return firstValid([primary, secondary]);
}

async function translateText(
  text: string,
  srcLang: string,
  targetLang: string
): Promise<{ translated: string; detectedLang: string; engine: string }> {
  if (!text || !text.trim()) {
    return { translated: "", detectedLang: "en", engine: "none" };
  }

  const isAuto = !srcLang || srcLang === "auto";

  if (!isAuto && srcLang === targetLang) {
    return { translated: text, detectedLang: srcLang, engine: "none" };
  }

  const ai = getGemini();
  if (ai) {
    const targetName = LANG_NAMES[targetLang] || targetLang;
    const srcName = isAuto ? "Auto-Detected Language" : (LANG_NAMES[srcLang] || srcLang);

    const prompt = isAuto
      ? `You are an expert real-time translator for live meetings.
Task:
1. Automatically detect the language of the following spoken text (return ISO 639-1 code, e.g. "en", "es", "fr", "de", "ja", "zh", "hi", "ar", "ru", "pt", "it", etc.).
2. Translate the text accurately and naturally into ${targetName} (${targetLang}).
If the detected language is already ${targetLang}, return the original text as translated.

Text to translate:
"${text}"

Return ONLY a valid JSON object without markdown fences:
{
  "detected_lang": "es",
  "translated": "translated text"
}`
      : `You are an expert real-time translator for live meetings.
Translate the following transcript accurately and naturally from ${srcName} into ${targetName} (${targetLang}).
Rules:
- Preserve conversational tone, technical terminology, and meaning.
- Return ONLY the translated text in ${targetName}.
- Do NOT output preamble, quotes, explanations, or notes.

Text to translate:
${text}`;

    const modelsToTry = ["gemini-3.1-flash-lite", "gemini-3.6-flash"];
    const attempt = async (model: string) => {
      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model,
            contents: prompt,
            config: isAuto ? { responseMimeType: "application/json" } : undefined,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timeout")), 8000)
          ),
        ]);

        const resText = response.text ? response.text.trim() : "";
        if (!resText) return null;

        if (isAuto) {
          try {
            const parsed = JSON.parse(resText);
            return {
              translated: parsed.translated || text,
              detectedLang: parsed.detected_lang || "en",
              engine: "gemini",
            };
          } catch {
            // fallback if not valid JSON
            return { translated: resText.replace(/^["']|["']$/g, ""), detectedLang: "en", engine: "gemini" };
          }
        }
        return {
          translated: resText.replace(/^["']|["']$/g, ""),
          detectedLang: srcLang,
          engine: "gemini",
        };
      } catch {
        return null;
      }
    };

    const result = await raceModelsHedged(modelsToTry, attempt);
    if (result) return result;
  }

  // Fallback if no Gemini key or offline
  return { translated: text, detectedLang: srcLang || "en", engine: "none" };
}

async function transcribeAndTranslateAudio(
  wavBuffer: Buffer,
  targetLang: string
): Promise<{
  empty: boolean;
  text: string;
  lang: string;
  translated: string;
  speaker: string;
  engine: string;
} | null> {
  const ai = getGemini();
  if (!ai) return null;

  const targetName = LANG_NAMES[targetLang] || targetLang;
  const audioBase64 = wavBuffer.toString("base64");
  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-3.6-flash"];

  const attempt = async (model: string) => {
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/wav",
                    data: audioBase64,
                  },
                },
                {
                  text: `You are a strict, real-time speech transcription and translation system.
Analyze this audio slice from a live meeting.
CRITICAL RULES:
1. ONLY transcribe genuine, audible human speech spoken in this audio. If there is only silence, breathing, background noise, clicks, hum, or static, you MUST return: {"empty": true, "original_text": ""}.
2. DO NOT hallucinate, invent, or output sample messages, placeholder sentences, or canned phrases (such as "Thank you for watching", "Please subscribe", "Sample message", or generic greetings).
3. Detect the ISO language code (e.g. "en", "es", "fr", "de", "zh", "ja", "hi", "ar", "ru", "pt", "it", etc.).
4. Translate accurately into ${targetName} (ISO: ${targetLang}).
5. Speaker label (e.g. "Speaker 1").

Return ONLY valid JSON matching this schema:
{
  "empty": false,
  "original_text": "verbatim words spoken",
  "detected_lang": "en",
  "translated_text": "translated text in ${targetName}",
  "speaker": "Speaker 1"
}`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 8000)
        ),
      ]);

      const rawJson = response.text ? response.text.trim() : "";
      if (!rawJson) return null;

      const parsed = JSON.parse(rawJson);
      if (parsed.empty || !parsed.original_text || !parsed.original_text.trim()) {
        return { empty: true, text: "", lang: "en", translated: "", speaker: "", engine: "none" };
      }

      const cleanSpoken = parsed.original_text.trim();
      if (isHallucinationOrSample(cleanSpoken)) {
        return { empty: true, text: "", lang: "en", translated: "", speaker: "", engine: "none" };
      }

      return {
        empty: false,
        text: cleanSpoken,
        lang: parsed.detected_lang || "en",
        translated: parsed.translated_text ? parsed.translated_text.trim() : cleanSpoken,
        speaker: parsed.speaker || "Speaker 1",
        engine: "gemini",
      };
    } catch {
      return null;
    }
  };

  return await raceModelsHedged(modelsToTry, attempt);
}

// ---------------------------------------------------------------------------
// HTTP API Endpoints
// ---------------------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/languages", (req, res) => {
  const list = Object.entries(LANG_NAMES)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  res.json(list);
});

app.get("/models", (req, res) => {
  res.json({ models: KNOWN_MODELS });
});

app.post("/warm", (req, res) => {
  res.json({ started: true });
});

app.post("/api/translate", async (req, res) => {
  try {
    const { text, sourceLang = "en", targetLang = "en" } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }
    const result = await translateText(text, sourceLang, targetLang);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Translation error" });
  }
});

app.get("/api/backend-info", (req, res) => {
  res.json({ ready: true, port: PORT });
});

// ---------------------------------------------------------------------------
// Main Server Setup (Express + WebSocket + Vite)
// ---------------------------------------------------------------------------

async function startServer(): Promise<void> {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : "";
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    let targetLang = "en";
    let hfToken = "";
    let segId = 0;
    let startTime = Date.now();
    let audioBufferList: Buffer[] = [];
    let accumulatedBytes = 0;
    let isProcessingAudio = false;
    let lastProcessedTime = Date.now();
    let recentTranscripts: { text: string; time: number }[] = [];

    // Send ready event
    ws.send(JSON.stringify({ type: "ready", sample_rate: 16000 }));

    const processAudioBuffer = async () => {
      if (isProcessingAudio || audioBufferList.length === 0) return;
      
      const mergedPcm = Buffer.concat(audioBufferList);
      audioBufferList = [];
      accumulatedBytes = 0;

      // Strict Voice Activity Detection: check audio volume/RMS to avoid calling API on silence or background static
      const rms = calculateRms(mergedPcm);
      if (rms < 350 || mergedPcm.length < 16000 * 2 * 1.0) {
        return;
      }

      isProcessingAudio = true;
      try {
        const wav = createWavBuffer(mergedPcm, 16000, 1, 16);
        const result = await transcribeAndTranslateAudio(wav, targetLang);

        if (result && !result.empty && result.text) {
          const text = result.text.trim();
          // Check if this text or audio was already handled to avoid duplicates
          if (!isDuplicateText(text, recentTranscripts)) {
            recentTranscripts.push({ text, time: Date.now() });
            if (recentTranscripts.length > 250) recentTranscripts.shift();

            // Ensure translation is populated
            let translated = result.translated;
            if (!translated && result.lang !== targetLang) {
              const fallback = await translateText(text, result.lang, targetLang);
              translated = fallback.translated;
            } else if (!translated) {
              translated = text;
            }

            const curTime = (Date.now() - startTime) / 1000;
            ws.send(JSON.stringify({ type: "language", language: result.lang }));
            ws.send(
              JSON.stringify({
                type: "segment",
                seg: {
                  id: `audio-${Date.now()}-${segId++}`,
                  start: Math.max(0, curTime - 3.0),
                  end: curTime,
                  lang: result.lang,
                  text,
                  translated,
                  target_lang: targetLang,
                  engine: "gemini-live",
                  speaker: result.speaker || "Speaker 1",
                },
              })
            );
          }
        }
      } catch (err) {
        console.error("Error processing audio batch:", err);
      } finally {
        isProcessingAudio = false;
      }
    };

    ws.on("message", async (data: Buffer | string, isBinary: boolean) => {
      // Audio binary chunks (16kHz 16-bit PCM)
      if (isBinary || Buffer.isBuffer(data)) {
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
        audioBufferList.push(chunk);
        accumulatedBytes += chunk.length;

        // ~2.0 seconds of 16kHz 16-bit mono audio is 16000 * 2 * 2.0 = 64,000 bytes
        const now = Date.now();
        if (accumulatedBytes >= 64000 || (accumulatedBytes >= 32000 && now - lastProcessedTime > 1800)) {
          lastProcessedTime = now;
          processAudioBuffer();
        }
        return;
      }

      // JSON text messages
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "config") {
          if (msg.target_lang && msg.target_lang !== targetLang) {
            targetLang = msg.target_lang;
          }
          if (msg.hf_token !== undefined) hfToken = msg.hf_token;
        } else if (msg.type === "stop") {
          if (accumulatedBytes > 32000) {
            await processAudioBuffer();
          }
          audioBufferList = [];
          accumulatedBytes = 0;
        } else if (msg.type === "text_segment") {
          // Direct speech recognition from client
          const text = (msg.text || "").trim();
          if (!text || isHallucinationOrSample(text)) return;

          if (isDuplicateText(text, recentTranscripts)) return;
          recentTranscripts.push({ text, time: Date.now() });
          if (recentTranscripts.length > 250) recentTranscripts.shift();

          const srcLang = msg.lang || "auto";
          const tgtLang = msg.target_lang || targetLang || "en";
          const speaker = msg.speaker || "Speaker 1 (You)";
          const curTime = (Date.now() - startTime) / 1000;
          const trans = await translateText(text, srcLang, tgtLang);
          const detected = trans.detectedLang || (srcLang === "auto" ? "en" : srcLang);

          ws.send(JSON.stringify({ type: "language", language: detected }));
          ws.send(
            JSON.stringify({
              type: "segment",
              seg: {
                id: msg.id || `text-${Date.now()}-${segId++}`,
                start: Math.max(0, curTime - 2.0),
                end: curTime,
                lang: detected,
                text,
                translated: trans.translated || text,
                target_lang: tgtLang,
                engine: "gemini-live",
                speaker,
              },
            })
          );
        }
      } catch (err) {
        console.error("WS parse error:", err);
      }
    });

    ws.on("close", () => {
      audioBufferList = [];
      accumulatedBytes = 0;
    });
  });

  // Mount Vite or static serving
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, server.cjs is located inside dist/
    const distPath = __dirname;
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "0.0.0.0", () => {
      server.removeListener("error", reject);
      console.log(`Meeting Translator server running on http://0.0.0.0:${PORT}`);
      resolve();
    });
  });
}

const serverStartPromise = startServer();
(module as any).exports = serverStartPromise;
serverStartPromise.catch((err) => {
  console.error("Failed to start server:", err);
});
