import streamifier from 'streamifier';
import cloudinary from '../config/cloudinary.js';
import { buildDataContext } from './dataFileExtractor.service.js';
import { composeFactCard } from './factCard.service.js';

const TWELVELABS_MODEL = process.env.TWELVELABS_MODEL || 'pegasus1.5';
const TWELVELABS_API_BASE = 'https://api.twelvelabs.io/v1.3';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';

// Only languages eleven_multilingual_v2 actually documents support for —
// picking one outside this list would produce a voice that doesn't know
// how to pronounce the script. India-relevant options (and the Hinglish
// blend) are listed first since that's this app's primary audience;
// `elevenLabsCode` is what actually goes to the TTS API, `instruction` is
// what tells the script-writing AI how to actually write it — a blend
// like Hinglish needs real writing guidance, not just a language flag.
export const VOICEOVER_LANGUAGES = {
  en: { label: 'English', elevenLabsCode: 'en', instruction: 'Write the voiceover_script entirely in natural, fluent English.' },
  hi: { label: 'Hindi (हिन्दी)', elevenLabsCode: 'hi', instruction: 'Write the voiceover_script entirely in natural, fluent Hindi, in Devanagari script.' },
  hinglish: {
    label: 'Hinglish (Hindi + English blend)',
    elevenLabsCode: 'hi',
    instruction: 'Write the voiceover_script in natural Hinglish — the way urban Indian bilingual speakers actually talk on social media, blending Hindi (Devanagari script) with common English words and phrases mixed naturally into the same sentences, not a formal word-for-word translation. Keep it warm, energetic, and conversational, the way a popular Indian science-outreach reel would actually sound.',
  },
  ta: { label: 'Tamil (தமிழ்)', elevenLabsCode: 'ta', instruction: 'Write the voiceover_script entirely in natural, fluent Tamil script.' },
  ja: { label: 'Japanese', elevenLabsCode: 'ja', instruction: 'Write the voiceover_script entirely in natural, fluent Japanese.' },
  zh: { label: 'Chinese', elevenLabsCode: 'zh', instruction: 'Write the voiceover_script entirely in natural, fluent Mandarin Chinese.' },
  fr: { label: 'French', elevenLabsCode: 'fr', instruction: 'Write the voiceover_script entirely in natural, fluent French.' },
  de: { label: 'German', elevenLabsCode: 'de', instruction: 'Write the voiceover_script entirely in natural, fluent German.' },
  es: { label: 'Spanish', elevenLabsCode: 'es', instruction: 'Write the voiceover_script entirely in natural, fluent Spanish.' },
  pt: { label: 'Portuguese', elevenLabsCode: 'pt', instruction: 'Write the voiceover_script entirely in natural, fluent Portuguese.' },
  ko: { label: 'Korean', elevenLabsCode: 'ko', instruction: 'Write the voiceover_script entirely in natural, fluent Korean.' },
  ar: { label: 'Arabic', elevenLabsCode: 'ar', instruction: 'Write the voiceover_script entirely in natural, fluent Arabic.' },
  ru: { label: 'Russian', elevenLabsCode: 'ru', instruction: 'Write the voiceover_script entirely in natural, fluent Russian.' },
  id: { label: 'Indonesian', elevenLabsCode: 'id', instruction: 'Write the voiceover_script entirely in natural, fluent Indonesian.' },
  it: { label: 'Italian', elevenLabsCode: 'it', instruction: 'Write the voiceover_script entirely in natural, fluent Italian.' },
  nl: { label: 'Dutch', elevenLabsCode: 'nl', instruction: 'Write the voiceover_script entirely in natural, fluent Dutch.' },
  tr: { label: 'Turkish', elevenLabsCode: 'tr', instruction: 'Write the voiceover_script entirely in natural, fluent Turkish.' },
  uk: { label: 'Ukrainian', elevenLabsCode: 'uk', instruction: 'Write the voiceover_script entirely in natural, fluent Ukrainian.' },
  pl: { label: 'Polish', elevenLabsCode: 'pl', instruction: 'Write the voiceover_script entirely in natural, fluent Polish.' },
};

function resolveVoiceoverLanguage(code) {
  return VOICEOVER_LANGUAGES[code] || VOICEOVER_LANGUAGES.en;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTwelveLabsKey() {
  const apiKey = String(process.env.TWELVELABS_API_KEY || '').trim();
  if (!apiKey) throw new Error('TWELVELABS_API_KEY is not configured');
  return apiKey;
}

function extractJson(text, source = 'TwelveLabs') {
  const cleaned = String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1) {
    console.warn(`Studio: ${source} response had no parseable JSON. Raw response (first 500 chars): ${cleaned.slice(0, 500)}`);
    throw new Error(`${source} returned an unexpected (non-JSON) response — see server logs for the raw text`);
  }

  return JSON.parse(cleaned.slice(first, last + 1));
}

function getStatus(error) {
  return Number(error?.status || error?.code || error?.response?.status || 0);
}

async function withRetry(fn, { retries = 4, label = 'TwelveLabs' } = {}) {
  let lastError;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = getStatus(error);

      if (![429, 500, 502, 503, 504].includes(status) || attempt === retries - 1) {
        throw error;
      }

      const delay = 2000 * Math.pow(2, attempt);
      console.log(`${label} temporarily unavailable (${status}). Retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }

  throw lastError;
}

function formatTwelveLabsError(error, prefix = 'TwelveLabs request failed') {
  const status = getStatus(error);
  const message = error?.message || String(error || 'Unknown TwelveLabs error');

  if (status === 401 || status === 403) {
    return new Error(
      `${prefix}: TwelveLabs rejected the API key (${status}). Check TWELVELABS_API_KEY in server/.env and restart the server. Original error: ${message}`,
    );
  }

  return new Error(`${prefix}${status ? ` (${status})` : ''}: ${message}`);
}

function isCloudinaryUrl(url = '') {
  return /res\.cloudinary\.com\//i.test(url) && /\/upload\//i.test(url);
}

// TwelveLabs requires at least 360 px on both dimensions. For Cloudinary-hosted
// source videos, ask Cloudinary to deliver a 640x360 analysis copy with padding.
// This avoids rejecting low-resolution landscape clips such as 624x352 while
// preserving the original source URL for the final render.
function getAnalysisVideoUrl(url) {
  if (!isCloudinaryUrl(url)) return url;
  if (/\/upload\/c_pad,w_640,h_360,vc_h264,q_auto\//i.test(url)) return url;
  return url.replace(
    /\/upload\//i,
    '/upload/c_pad,w_640,h_360,vc_h264,q_auto/',
  );
}

async function requestAnalysis(video, prompt) {
  const analysisUrl = getAnalysisVideoUrl(video.url);

  const response = await withRetry(async () => {
    const res = await fetch(`${TWELVELABS_API_BASE}/analyze`, {
      method: 'POST',
      headers: {
        'x-api-key': getTwelveLabsKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_name: TWELVELABS_MODEL,
        video: {
          type: 'url',
          url: analysisUrl,
        },
        prompt,
        stream: false,
        // Was 2300 — a single response has to carry a title, caption,
        // summary, voiceover script, AND up to 6 segments as one JSON
        // object, which could run past 2300 tokens and get cut off
        // mid-JSON. Raised to lower how often that happens; the retry
        // below is the backstop for when it still does.
        max_tokens: 3200,
        temperature: 0.35,
      }),
    });

    let body;
    try {
      body = await res.json();
    } catch {
      body = { message: await res.text().catch(() => '') };
    }

    if (!res.ok) {
      const error = new Error(body?.message || body?.error?.message || JSON.stringify(body).slice(0, 600));
      error.status = res.status;
      throw error;
    }

    return body;
  });

  return response?.data || response?.text || response?.output || '';
}

async function analyzeVideo(video, videoIndex, notes = '', languageCode = 'en') {
  if (!video?.url) throw new Error(`Video ${videoIndex + 1} has no public URL`);

  const language = resolveVoiceoverLanguage(languageCode);

  const prompt = `You are the NCPOR social-video editor.
Analyze this researcher-uploaded polar-science video and propose the strongest moments for a natural 9:16 short-form reel.

Requirements:
- Use only facts visible/audible in the footage or explicitly present in the researcher notes.
- Do not invent scientific facts.
- Pick 3 to 6 visually meaningful clips.
- Every clip must have an accurate start timestamp in seconds and a duration between 2 and 8 seconds.
- Prefer a mix of establishing, action, detail, people/research work, and visually strong moments when available.
- Write short, natural on-screen text in English suitable for a public science reel.
- Also provide a catchy public-outreach title, caption, and a factual 2-4 sentence summary — all in English.
- ${language.instruction} It should run roughly 35-45 seconds when spoken aloud, and must be factual, engaging, and easy to understand. Everything else (title, caption, summary, on-screen text) stays in English regardless of this language — only voiceover_script uses it.
- Keep the total suggested clip duration for this video at or below 30 seconds.

Researcher notes: ${notes || 'None'}

Return ONLY valid JSON with this exact shape:
{"title":"...","caption":"...","summary":"...","voiceover_script":"...","segments":[{"start":0,"duration":4,"overlay_text":"...","importance":10}]}

importance must be a number from 1 to 10.`;

  let text = await requestAnalysis(video, prompt);
  if (!text) throw new Error(`TwelveLabs returned no analysis for video ${videoIndex + 1}`);

  let parsed;
  try {
    parsed = extractJson(text);
  } catch (firstError) {
    // Most likely cause: the response got cut off mid-JSON. A retry is
    // non-deterministic (temperature 0.35), so it's a reasonable chance of
    // getting a complete response the second time, rather than failing the
    // whole video's analysis over what might just be one truncated reply.
    console.warn(`TwelveLabs: analysis JSON parse failed for video ${videoIndex + 1}, retrying once:`, firstError.message);
    text = await requestAnalysis(video, prompt);
    if (!text) throw new Error(`TwelveLabs returned no analysis for video ${videoIndex + 1} (retry)`);
    parsed = extractJson(text); // let this one throw for real if it fails again
  }

  const segments = Array.isArray(parsed.segments) ? parsed.segments : [];

  return {
    videoIndex,
    title: String(parsed.title || '').trim(),
    caption: String(parsed.caption || '').trim(),
    summary: String(parsed.summary || '').trim(),
    voiceoverScript: String(parsed.voiceover_script ?? parsed.voiceoverScript ?? '').trim().slice(0, 1800),
    segments: segments.map((segment, index) => ({
      videoIndex,
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(2, Math.min(8, Number(segment.duration) || 4)),
      overlayText: String(segment.overlay_text ?? segment.overlayText ?? '').slice(0, 90),
      importance: Math.max(1, Math.min(10, Number(segment.importance) || 7)),
      localOrder: index,
    })),
  };
}

function combineAnalyses(analyses, videoCount) {
  const allSegments = analyses.flatMap((analysis) => analysis.segments || []);

  const byVideo = new Map();
  for (let i = 0; i < videoCount; i += 1) byVideo.set(i, []);
  for (const segment of allSegments) {
    if (!byVideo.has(segment.videoIndex)) byVideo.set(segment.videoIndex, []);
    byVideo.get(segment.videoIndex).push(segment);
  }

  for (const list of byVideo.values()) {
    list.sort((a, b) => b.importance - a.importance || a.localOrder - b.localOrder);
  }

  const selected = [];
  let total = 0;
  let round = 0;
  let addedInRound = true;

  while (total < 45 && addedInRound) {
    addedInRound = false;

    for (let videoIndex = 0; videoIndex < videoCount && total < 45; videoIndex += 1) {
      const candidate = byVideo.get(videoIndex)?.[round];
      if (!candidate) continue;

      const remaining = 45 - total;
      if (remaining < 1.5) break;

      const duration = Math.min(candidate.duration, remaining);
      selected.push({
        videoIndex: candidate.videoIndex,
        start: candidate.start,
        duration,
        overlayText: candidate.overlayText,
      });
      total += duration;
      addedInRound = true;
    }

    round += 1;
  }

  if (!selected.length && videoCount) {
    selected.push({
      videoIndex: 0,
      start: 0,
      duration: 12,
      overlayText: 'Polar science in the field',
    });
  }

  const primary = analyses.find((item) => item.title || item.caption || item.summary) || {};
  const summaries = analyses.map((item) => item.summary).filter(Boolean);
  const voiceoverParts = analyses.map((item) => item.voiceoverScript).filter(Boolean);

  return {
    title: String(primary.title || 'NCPOR Field Story').slice(0, 100),
    caption: String(
      primary.caption ||
        'A glimpse into polar research and the science behind the expedition. #NCPOR #PolarScience',
    ).slice(0, 5000),
    summary: String(
      summaries.length
        ? summaries.join(' ').slice(0, 1800)
        : 'A short-form outreach reel created from researcher-uploaded expedition media.',
    ),
    voiceoverScript: String(
      voiceoverParts.length
        ? voiceoverParts.join(' ').slice(0, 1800)
        : 'From the polar field, researchers turn observations into knowledge that helps us understand our changing planet.',
    ),
    segments: selected,
  };
}

// The no-video path: nothing here needs TwelveLabs (there's no footage to
// analyze) or Creatomate (there's nothing to render) or ElevenLabs (no
// voiceover without a video for it to sit under). Just a caption/summary,
// grounded in whatever reports/datasets were attached, written by Gemini —
// the same model+endpoint the rest of this app already uses in
// ai.controller.js, reused here rather than adding a second AI provider
// for what's fundamentally the same kind of call.
const GEMINI_MODEL = 'gemini-3.6-flash';

export async function createTextPlan({ dataFiles = [], notes = '' }) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured — required to generate a post with no video attached');

  const dataContext = dataFiles?.length ? await buildDataContext(dataFiles) : '';
  if (!dataContext && !notes?.trim()) {
    throw new Error('Add researcher notes or attach a report/dataset — a post needs something to write about.');
  }

  const prompt = `You are writing a social media post for NCPOR (National Centre for Polar and Ocean Research)'s public science outreach account. No video was provided for this one — base everything only on the material below. Do not invent facts beyond what's stated here.

${notes ? `Researcher notes: ${notes}\n\n` : ''}${dataContext ? `Attached report/dataset material:\n${dataContext}` : ''}

Return ONLY valid JSON with this exact shape, no markdown fences:
{"title":"<short internal title>","caption":"<engaging 1-3 sentence social caption with 3-5 relevant hashtags, under 280 characters>","summary":"<2-4 sentence factual summary, for an internal archive>"}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // Was 800 — too tight. Confirmed from a real failure: the
          // response we got back was cut off mid-word, consistent with
          // the model's internal reasoning eating into a token budget
          // that left too little room for the actual answer. Newer Gemini
          // models "think" before answering (a real, documented behavior,
          // not specific to this app), and that reasoning can consume
          // part of maxOutputTokens depending on the model generation.
          maxOutputTokens: 2048,
          // Best-effort — asks the model to keep reasoning minimal so
          // more of the budget above goes to the actual answer. Harmless
          // if this specific model generation doesn't recognize the
          // field; the fixes below don't depend on it working.
          thinkingConfig: { thinkingLevel: 'MINIMAL' },
        },
      }),
    }
  );
  const data = await response.json();
  if (data.error) throw new Error(`Gemini API error: ${data.error.message}`);

  // The actual fix for what we saw in the logs: don't assume the answer is
  // entirely in parts[0]. Some responses split content across multiple
  // parts, and any part flagged `thought: true` is the model's internal
  // reasoning, not the answer — skip those and join what's left. Reading
  // only parts[0].text (the previous code) is exactly what produced a
  // fragment starting mid-sentence.
  const allParts = data.candidates?.[0]?.content?.parts || [];
  const text = allParts
    .filter((part) => !part.thought)
    .map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response');

  const parsed = extractJson(text, 'Gemini');
  return {
    title: String(parsed.title || 'NCPOR Post').slice(0, 120),
    caption: String(parsed.caption || '').slice(0, 5000),
    summary: String(parsed.summary || '').slice(0, 1800),
  };
}

// Pollinations.ai — genuinely free, no API key, no billing account needed.
// Confirmed: GET https://image.pollinations.ai/prompt/{prompt} returns raw
// image bytes directly, no auth header, no ?key= param on the anonymous
// tier. That tier is rate-limited to roughly one request per 15s and may
// carry a small watermark — registering at auth.pollinations.ai removes
// both but isn't required for this to work.
//
// Real limitation versus the Gemini version this replaced: this is
// text-to-image only — no documented free image-to-image/restyling
// endpoint was found. So when a photo IS uploaded, there's nothing to
// meaningfully generate — the researcher's own photo is used directly as
// the post image instead of an AI-restyled version. Only the no-photo,
// generate-from-scratch case actually calls Pollinations.
const POLLINATIONS_BASE = 'https://image.pollinations.ai/prompt';

// If a photo was uploaded, it becomes the post image directly — no AI
// step, see the file-level comment above for why. If no photo exists at
// all (report/dataset only), Pollinations generates an illustration from
// scratch — explicitly asked to read as an illustration rather than a
// fabricated "photo" of an event that didn't happen, since this goes out
// under a real research institute's name.
// AI writes the card's CONTENT ONLY (headline, facts, callout) — never the
// pixels of any text. factCard.service.js draws it. This split exists
// because image-generation models are unreliable at rendering accurate
// text (misspelled words, garbled numbers), which is a real problem for a
// card whose entire point is showing correct facts from a report/dataset.
async function buildFactCardContent({ dataFiles = [], notes = '' }) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured — required to write the fact card content');

  const dataContext = dataFiles?.length ? await buildDataContext(dataFiles) : '';
  if (!dataContext && !notes?.trim()) {
    throw new Error('Add researcher notes or attach a report/dataset — the card needs something to pull facts from.');
  }

  const prompt = `You are writing the content for a social-media "info card" graphic for a polar/ocean scientific research institute's public outreach account, based on the material below. Every fact must come only from that material — never invent a number, date, or finding not stated there.

${notes ? `Researcher notes: ${notes}\n\n` : ''}${dataContext ? `Attached report/dataset material:\n${dataContext}` : ''}

Return ONLY valid JSON, no markdown fences, in this exact shape:
{"eyebrow":"<a short 2-4 word category label, e.g. FIELD REPORT or EXPEDITION UPDATE>","headline":"<a punchy 4-8 word headline>","subheadline":"<one supporting sentence, under 90 characters>","facts":["<short factual line pulled from the material, under 70 characters>","<a second one>","<optionally a third>"],"callout":"<one short, resonant closing line for the bottom of the card, under 90 characters>"}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200, thinkingConfig: { thinkingLevel: 'MINIMAL' } },
      }),
    }
  );
  const data = await response.json();
  if (data.error) throw new Error(`Gemini API error: ${data.error.message}`);

  const allParts = data.candidates?.[0]?.content?.parts || [];
  const text = allParts.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty response');

  return extractJson(text, 'Gemini (fact card content)');
}

// If a photo was uploaded, it's the card's background — real content,
// AI only adds the text overlay on top. If not, Pollinations generates a
// backdrop from the same report/dataset material, explicitly asked for as
// an atmospheric/illustrative image rather than a fabricated "photo" of a
// specific unphotographed event, since this goes out under a real
// institute's name.
async function getCardBackground({ images = [], dataFiles = [], notes = '' }) {
  if (images?.length > 0) {
    const res = await fetch(images[0].url);
    if (!res.ok) throw new Error(`Could not fetch uploaded photo (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  const dataContext = dataFiles?.length ? await buildDataContext(dataFiles) : '';
  const prompt = `Atmospheric backdrop photo-style image (illustration/graphic style, not presented as a real photograph of a specific event), moody and uncluttered so text can be readable over it, representing polar/ocean scientific research. Context: ${dataContext || notes || 'Antarctic expedition, ice, research station.'}`.slice(0, 2000);
  const url = `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?width=1080&height=1350&model=flux&nologo=true`;

  const response = await withRetry(async () => {
    const res = await fetch(url);
    if (!res.ok) {
      const error = new Error(`Pollinations image generation failed (HTTP ${res.status})`);
      error.status = res.status;
      throw error;
    }
    return res;
  }, { label: 'Pollinations' });

  return Buffer.from(await response.arrayBuffer());
}

export async function createSocialImage({ images = [], dataFiles = [], notes = '' }) {
  const [content, background] = await Promise.all([
    buildFactCardContent({ dataFiles, notes }),
    getCardBackground({ images, dataFiles, notes }),
  ]);

  const cardBuffer = await composeFactCard(background, content);
  const uploaded = await uploadBufferToCloudinary(cardBuffer, {
    resource_type: 'image',
    folder: 'ncpor/studio/posts',
  });

  return { imageUrl: uploaded.secure_url, wasGenerated: true };
}

export async function createAiEditPlan({ videos, dataFiles = [], notes = '', voiceoverLanguage = 'en' }) {
  getTwelveLabsKey();
  if (!videos?.length) throw new Error('At least one video is required to generate a reel');

  let combinedNotes = notes || '';
  if (dataFiles?.length) {
    console.log(`Studio: reading ${dataFiles.length} attached data file(s) for context...`);
    const dataContext = await buildDataContext(dataFiles);
    if (dataContext) {
      combinedNotes = [
        notes,
        `The researcher also attached the following report/dataset material — use it as factual grounding for the caption, summary, and voiceover script (do not invent numbers or findings beyond what's stated here):\n${dataContext}`,
      ].filter(Boolean).join('\n\n');
    }
  }

  try {
    const analyses = [];
    for (let index = 0; index < Math.min(videos.length, 5); index += 1) {
      console.log(`TwelveLabs: analyzing video ${index + 1}/${Math.min(videos.length, 5)}...`);
      analyses.push(await analyzeVideo(videos[index], index, combinedNotes, voiceoverLanguage));
    }

    return combineAnalyses(analyses, Math.min(videos.length, 5));
  } catch (error) {
    throw formatTwelveLabsError(error, 'TwelveLabs analysis failed');
  }
}

function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

export async function createVoiceover(text, languageCode = 'en') {
  const script = String(text || '').trim();
  if (!script) return null;

  const apiKey = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!apiKey) {
    console.warn('Studio voiceover skipped: ELEVENLABS_API_KEY is not configured.');
    return null;
  }

  const voiceId = String(process.env.ELEVENLABS_VOICE_ID || ELEVENLABS_VOICE_ID).trim();
  const language = resolveVoiceoverLanguage(languageCode);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: script,
        model_id: ELEVENLABS_MODEL,
        // Top-level, not nested in voice_settings — matches ElevenLabs'
        // documented request shape. Tells the model which language's
        // phonetics/pronunciation to apply; for a blend like Hinglish this
        // is the base language (Hindi) since there's no distinct code for
        // the blend itself — the actual code-switching comes from how the
        // script text was written, not from this parameter.
        language_code: language.elevenLabsCode,
        voice_settings: {
          stability: 0.48,
          similarity_boost: 0.75,
          style: 0.18,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    let details = '';
    try { details = await response.text(); } catch {}
    throw new Error(`Voiceover generation failed (${response.status}): ${details.slice(0, 500)}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const uploaded = await uploadBufferToCloudinary(audioBuffer, {
    resource_type: 'video',
    folder: 'ncpor/studio/voiceovers',
    format: 'mp3',
  });

  return uploaded.secure_url;
}

function buildRenderScript({ videos, plan, voiceoverUrl }) {
  let cursor = 0;
  const elements = [];

  plan.segments.forEach((segment, index) => {
    const source = videos[segment.videoIndex]?.url;
    if (!source) return;

    elements.push({
      type: 'video',
      track: 1,
      source,
      trim_start: segment.start,
      trim_duration: segment.duration,
      duration: segment.duration,
      fit: 'cover',
      // Keep a little field audio beneath the narration. If no voiceover was
      // generated, preserve the original footage at full volume.
      volume: voiceoverUrl ? '18%' : '100%',
      ...(index
        ? { animations: [{ duration: 0.22, transition: true, type: 'fade' }] }
        : {}),
    });

    if (segment.overlayText) {
      elements.push({
        type: 'text',
        track: 3,
        time: cursor + 0.35,
        duration: Math.max(1.3, segment.duration - 0.7),
        text: segment.overlayText,
        x: '50%',
        y: '78%',
        width: '84%',
        height: '18%',
        fill_color: '#ffffff',
        stroke_color: '#061923',
        stroke_width: '0.65 vmin',
        font_family: 'Montserrat',
        font_weight: '700',
        font_size: '5.1 vmin',
        text_alignment: 'center',
      });
    }

    cursor += segment.duration;
  });

  if (voiceoverUrl) {
    elements.push({
      type: 'audio',
      track: 2,
      time: 0,
      duration: cursor,
      source: voiceoverUrl,
      volume: '100%',
      audio_fade_out: 0.5,
    });
  }

  elements.push({
    type: 'text',
    track: 4,
    time: 0.3,
    duration: Math.min(3.2, cursor),
    text: plan.title,
    x: '50%',
    y: '10%',
    width: '86%',
    height: '12%',
    fill_color: '#ffffff',
    stroke_color: '#061923',
    stroke_width: '0.65 vmin',
    font_family: 'Montserrat',
    font_weight: '800',
    font_size: '5.5 vmin',
    text_alignment: 'center',
  });

  return {
    output_format: 'mp4',
    width: 1080,
    height: 1920,
    frame_rate: 30,
    duration: Math.min(45, cursor),
    elements,
  };
}

export async function startRender({ videos, plan, voiceoverUrl, webhookUrl, metadata }) {
  if (!process.env.CREATOMATE_API_KEY) {
    throw new Error('CREATOMATE_API_KEY is not configured');
  }

  const body = {
    ...buildRenderScript({ videos, plan, voiceoverUrl }),
    metadata,
  };

  if (webhookUrl) body.webhook_url = webhookUrl;

  const response = await fetch('https://api.creatomate.com/v2/renders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Video render failed to start: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return Array.isArray(data) ? data[0] : data;
}

export async function getRender(renderId) {
  if (!process.env.CREATOMATE_API_KEY) {
    throw new Error('CREATOMATE_API_KEY is not configured');
  }

  const response = await fetch(
    `https://api.creatomate.com/v2/renders/${encodeURIComponent(renderId)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}`,
      },
    },
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || 'Could not fetch render status');
  }

  return data;
}
