// Radio news bulletin: Ukratko stories -> Gemini script (Serbian Cyrillic) -> Google Chirp 3 HD MP3.
//
// Two ways to run:
//  - Inside the regular build (update.yml), after build.mjs: SITE=dist, BULLETIN=auto|now. The result is encrypted with
//    the site key, kept in .cache/bulletin/ and published as dist/data/bulletin/<id>.bin (+ .audio.bin) with metadata in
//    meta.json (see lib/bulletin-store.mjs). auto = once per workday between 06:30 and 07:40 Belgrade time; now = on demand
//    (the app's "Napravi nove" button). A failure never fails the build: the previous bulletin stays and meta gets the error.
//  - Manual test (bulletin.yml): SITE = live site URL, BULLETIN=test, files in out/bulletin.
// Env: NEWS_KEY, GEMINI_API_KEY, GOOGLE_TTS_KEY (optional: without it the app reads the script with the phone's voice),
//      VOICE (default sr-RS-Chirp3-HD-Aoede), MINUTES (20), RATE (1.0), GEMINI_MODEL, DRY=1 (prompt only).

import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { deriveKey, encryptJson, encryptBytes } from './lib/crypto.mjs';
import { readInfo, writeInfo, saveBulletin, publishBulletin } from './lib/bulletin-store.mjs';

const MODE = process.env.BULLETIN || 'test';
const RAW_SITE = process.env.SITE || 'https://alecfleurs.github.io/vesti/';
const LOCAL = !/^https?:/.test(RAW_SITE);
const SITE = LOCAL ? path.resolve(RAW_SITE) : RAW_SITE.replace(/\/?$/, '/');
const CACHE = path.resolve(process.env.CACHE_DIR || '.cache');
// Voice engine: Google Cloud Chirp 3 HD when GOOGLE_TTS_KEY is set (needs Cloud billing), otherwise Gemini speech on the
// same free AI Studio key as the script (no card). TTS_ENGINE=cloud|gemini|none overrides.
// Preferred: Azure Speech (free F0 tier, sr-RS-SophieNeural) when AZURE_SPEECH_KEY is set.
const ENGINE = process.env.TTS_ENGINE || (process.env.AZURE_SPEECH_KEY ? 'azure' : process.env.GOOGLE_TTS_KEY ? 'cloud' : process.env.GEMINI_API_KEY ? 'gemini' : 'none');
const VOICE = process.env.VOICE || { azure: 'sr-RS-SophieNeural', cloud: 'sr-RS-Chirp3-HD-Aoede' }[ENGINE] || 'Kore';
const AZURE_REGION = process.env.AZURE_SPEECH_REGION || 'northeurope';
const TTS_MODELS = process.env.GEMINI_TTS_MODEL ? [process.env.GEMINI_TTS_MODEL] : ['gemini-3.1-flash-tts-preview'];
const MINUTES = Number(process.env.MINUTES || 20);
const RATE = Number(process.env.RATE || 1);
const WPM = 130; // Serbian neural voices read about 130 words per minute
const MODELS = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];
const OUT = 'out/bulletin';
const log = (...a) => console.log('[bilten]', ...a);

const belgrade = (d = new Date()) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}${p.minute}`, weekday: p.weekday };
};

if (MODE === 'off') process.exit(0);
if (MODE === 'auto') {
  const t = belgrade();
  const info = await readInfo(CACHE);
  const workday = !['Sat', 'Sun'].includes(t.weekday);
  const inWindow = t.hm >= '0630' && t.hm <= '0740';
  if (!workday || !inWindow || info?.date === t.date) {
    log(`not due (${t.weekday} ${t.hm}, last ${info?.date || 'none'})`);
    process.exit(0);
  }
  log(`morning bulletin due (${t.weekday} ${t.hm})`);
}
if (!process.env.NEWS_KEY) throw new Error('NEWS_KEY is missing');
mkdirSync(OUT, { recursive: true });

// In the build a failure must not stop the deploy: log it, record it in meta.json, keep the previous bulletin.
if (MODE === 'auto' || MODE === 'now') {
  process.on('uncaughtException', async (e) => {
    log('FAILED:', e.message);
    try {
      const info = (await readInfo(CACHE)) || {};
      await writeInfo(CACHE, { ...info, error: e.message.slice(0, 200), errorAt: Date.now(), requested: MODE });
      await publishBulletin(CACHE, SITE, JSON.parse(readFileSync(path.join(SITE, 'data', 'meta.json'), 'utf8')).salt);
    } catch (e2) {
      log('could not record the failure:', e2.message);
    }
    process.exit(0);
  });
}

// ---------- read the encrypted site ----------
const readRaw = async (p) => {
  if (LOCAL) return new Uint8Array(readFileSync(path.join(SITE, p)));
  const res = await fetch(SITE + p);
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};
const meta = JSON.parse(new TextDecoder().decode(await readRaw('data/meta.json')));
const key = await deriveKey(process.env.NEWS_KEY, meta.salt, meta.iter);
async function getEnc(p) {
  const buf = await readRaw(p);
  const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
  return JSON.parse(gunzipSync(Buffer.from(plain)).toString('utf8'));
}
const index = await getEnc('data/index.bin');
const srcName = Object.fromEntries(index.sources.map((s) => [s.id, s.name]));
const clusters = new Map(index.clusters.map((c) => [c.id, c]));

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const htmlText = (html) =>
  html
    .replace(/<figure[\s\S]*?<\/figure>/gi, ' ')
    .replace(/<\/(p|h\d|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCharCode(+e.slice(1)) : ENT[e.toLowerCase()] ?? m))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
const cap = (t, words) => {
  const w = t.split(/\s+/);
  return w.length <= words ? t : w.slice(0, words).join(' ') + ' …';
};

// Up to 3 versions per story from different outlets; extracted articles first.
const stories = [];
for (const [rank, b] of (index.brief || []).entries()) {
  const c = clusters.get(b.c);
  if (!c) continue;
  const items = c.it.map((id) => ({ id, ...index.items[id] })).filter((it) => it.t);
  items.sort((a, z) => (z.x || 0) - (a.x || 0) || (z.w || 0) - (a.w || 0));
  const picked = [];
  for (const it of items) {
    if (picked.length >= 3 || picked.some((p) => p.s === it.s)) continue;
    picked.push(it);
  }
  const versions = [];
  for (const it of picked) {
    let body = it.l || '';
    if (it.x) {
      try {
        body = htmlText((await getEnc(`data/a/${it.id}.bin`)).html || '') || body;
      } catch (e) {
        log('article fallback to lead:', it.id, e.message);
      }
    }
    versions.push({ source: srcName[it.s] || it.s, title: it.t, url: it.u, text: cap(body, rank < 5 ? 700 : 450) });
  }
  stories.push({ rank: rank + 1, sources: c.n || versions.length, versions });
}
log(`stories: ${stories.length}`);

// ---------- prompt ----------
const now = new Date();
const dateStr = now.toLocaleDateString('sr-Cyrl-RS', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Belgrade' });
const hour = Number(now.toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/Belgrade' }));
const greeting = hour < 11 ? 'Добро јутро' : hour < 18 ? 'Добар дан' : 'Добро вече';
const words = Math.round(MINUTES * WPM);

const system = `Ti si urednica i spikerka jutarnjih radio vesti na srpskom jeziku. Pišeš tekst koji će pročitati sintetički glas, za slušaoca koji vozi na posao.

Pravila:
- Piši isključivo na srpskom, ćirilicom, ekavski. Strana imena piši fonetski ćirilicom po srpskom pravopisu (Вашингтон, Трамп, Мерц).
- Koristi samo činjenice iz priloženih tekstova. Ne dodaji ništa iz svog znanja, ne nagađaj, ne komentariši.
- Tvrdnje i ocene pripiši izvoru ili akteru („према писању Н1“, „како тврди министарство“). Kada se izvori razlikuju, kratko navedi obe verzije.
- Ignoriši reklame, promotivne delove, pozive na pretplatu, „pročitajte još“, linkove, opise fotografija i sve što nije sama vest.
- Piši za uho: kratke rečenice, bez zagrada, bez navodnika gde nisu potrebni, bez skraćenica. Brojeve, datume, procente, valute i godine piši rečima, u pravilnom padežu. Skraćenice raspiši ili ih piši kako se izgovaraju (СНС → Српска напредна странка, ЕУ → Европска унија).
- Bez naslova, oznaka, emodžija, markdown-a i nabrajanja.

Oblik:
- Uvod u jednoj ili dve rečenice: „${greeting}, данас је ${dateStr}. Ово су најважније вести.“ i najava tri glavne teme.
- Zatim vesti redom kako su date (najvažnije prve). Prve tri vesti imaju po 200 do 280 reči, ostale 90 do 160. Ako vest nema dovoljno sadržaja, budi kraći. Ako je ukupno predugo, izostavi poslednje vesti.
- Svaku vest počni jasnom rečenicom o tome šta se dogodilo. Između vesti koristi kratke prelaze, različite svaki put, bez fraze „sledeća vest“.
- Kraj: jedna rečenica odjave, na primer „То су биле вести за данас. Срећан пут.“
- Ukupna dužina oko ${words} reči.

Izlaz: samo tekst za čitanje. Uvod, svaku vest i odjavu odvoji linijom koja sadrži samo tri crtice: ---`;

const user =
  `Vesti za ${dateStr}, poređane po važnosti (broj medija koji prenose vest):\n\n` +
  stories
    .map(
      (s) =>
        `=== VEST ${s.rank} (prenosi ${s.sources} medija) ===\n` +
        s.versions.map((v) => `--- Izvor: ${v.source}\nNaslov: ${v.title}\n${v.text}`).join('\n\n'),
    )
    .join('\n\n');

writeFileSync(`${OUT}/prompt.txt`, `${system}\n\n=====\n\n${user}`);
writeFileSync(`${OUT}/stories.json`, JSON.stringify(stories.map((s) => ({ rank: s.rank, sources: s.versions.map((v) => ({ source: v.source, title: v.title, url: v.url })) })), null, 2));
log(`prompt: ${user.split(/\s+/).length} words of source text, target ${words} words`);
if (process.env.DRY) process.exit(0);

// ---------- Gemini ----------
if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing');
// Streaming (SSE): the first bytes arrive quickly, so a 4-minute generation can't hit fetch's header timeout.
async function gemini(model) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 32768 },
      }),
    });
  } catch (e) {
    const err = new Error(`Gemini ${model}: network ${e.cause?.code || e.message}`);
    err.status = 599;
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(`Gemini ${model}: HTTP ${res.status} ${body.error?.message || ''}`);
    err.status = res.status;
    throw err;
  }
  let raw;
  try {
    raw = await res.text();
  } catch (e) {
    const err = new Error(`Gemini ${model}: stream broke ${e.cause?.code || e.message}`);
    err.status = 599;
    throw err;
  }
  let text = '', usage, finish;
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    let ev;
    try {
      ev = JSON.parse(line.slice(5));
    } catch {
      continue;
    }
    if (ev.error) {
      const err = new Error(`Gemini ${model}: ${ev.error.message}`);
      err.status = ev.error.code || 500;
      throw err;
    }
    const c = ev.candidates?.[0];
    text += (c?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (c?.finishReason) finish = c.finishReason;
    if (ev.usageMetadata) usage = ev.usageMetadata;
  }
  if (!text.trim()) {
    const err = new Error(`Gemini ${model}: empty answer (${finish || 'no candidate'})`);
    err.status = 598;
    throw err;
  }
  if (finish && finish !== 'STOP') log(`warning: finishReason ${finish}`);
  return { text, usage };
}
// Free tier: 503 (high demand) and 429 (rate limit) are common and short; retry, then try the next model.
let script, usedModel;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
models: for (const m of MODELS) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await gemini(m);
      script = r.text;
      usedModel = m;
      log(`model ${m}, tokens`, JSON.stringify(r.usage || {}));
      break models;
    } catch (e) {
      log(e.message);
      if (e.status === 503 || e.status === 429 || e.status >= 500) {
        if (attempt < 3) await sleep(attempt * 30e3);
        continue;
      }
      if (e.status === 404 || e.status === 400) continue models;
      throw e;
    }
  }
}
if (!script) throw new Error('no Gemini model answered');

// Anything still in Latin script (rare) goes through a simple transliteration; digraphs first.
const LAT = [['dž', 'џ'], ['Dž', 'Џ'], ['DŽ', 'Џ'], ['lj', 'љ'], ['Lj', 'Љ'], ['LJ', 'Љ'], ['nj', 'њ'], ['Nj', 'Њ'], ['NJ', 'Њ']];
const LAT1 = Object.fromEntries([...'abvgdđežzijklmnoprstćufhcčš'].map((c, i) => [c, [...'абвгдђежзијклмнопрстћуфхцчш'][i]]));
const toCyr = (s) => {
  for (const [a, b] of LAT) s = s.split(a).join(b);
  return s.replace(/[A-Za-zĐđŽžĆćČčŠš]/g, (c) => {
    const low = LAT1[c.toLowerCase()];
    return low ? (c === c.toLowerCase() ? low : low.toUpperCase()) : c;
  });
};
const segments = script
  .replace(/\*\*|__|#+ /g, '')
  .split(/^\s*-{3,}\s*$/m)
  .map((s) => toCyr(s.trim()))
  .filter(Boolean);
const scriptWords = segments.join(' ').split(/\s+/).length;
writeFileSync(`${OUT}/script.txt`, segments.join('\n\n---\n\n') + '\n');
log(`script: ${segments.length} segments, ${scriptWords} words (~${Math.round(scriptWords / WPM)} min), model ${usedModel}`);

// ---------- Google Cloud TTS ----------
// Requests are capped at 5,000 bytes; Cyrillic is 2 bytes per letter, so chunks stay under ~1,800 characters.
const chunksOf = (text) => {
  const out = [];
  let cur = '';
  for (const s of text.match(/[^.!?…]+[.!?…]+["“”»]*\s*|[^.!?…]+$/g) || [text]) {
    if ((cur + s).length > 1800 && cur) out.push(cur.trim()), (cur = '');
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
async function tts(text) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(process.env.GOOGLE_TTS_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'sr-RS', name: VOICE },
        audioConfig: { audioEncoding: 'MP3', speakingRate: RATE, sampleRateHertz: 24000 },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return Buffer.from(body.audioContent, 'base64');
    if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, attempt * 5e3));
      continue;
    }
    throw new Error(`TTS: HTTP ${res.status} ${body.error?.message || ''}`);
  }
}
// Gemini speech: returns raw PCM (24 kHz, mono, 16-bit). Several segments go into one request (fewer calls on the
// free tier); each segment's share of that request's audio is estimated from its length in characters.
const GEMINI_STYLE = 'Read the following Serbian news text aloud, in Serbian, in the calm, clear voice of a radio newsreader, at a natural pace:';
// News is full of crime, war and accidents; the chat safety filters would refuse to read it aloud.
const SAFETY_OFF = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map((category) => ({ category, threshold: 'BLOCK_NONE' }));
async function geminiSpeech(text) {
  let last;
  for (const model of TTS_MODELS) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      let res, body;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${GEMINI_STYLE}\n\n${text}` }] }],
            safetySettings: SAFETY_OFF,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
            },
          }),
        });
        body = await res.json().catch(() => ({}));
      } catch (e) {
        last = `network ${e.cause?.code || e.message}`;
        await new Promise((r) => setTimeout(r, attempt * 15e3));
        continue;
      }
      const data = (body.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data)?.inlineData;
      if (res.ok && data) {
        if (TTS_MODELS[0] !== model) TTS_MODELS.splice(TTS_MODELS.indexOf(model), 1), TTS_MODELS.unshift(model); // keep using what works
        return { pcm: Buffer.from(data.data, 'base64'), model, mime: data.mimeType };
      }
      last = `${model}: HTTP ${res.status} ${body.error?.message || body.candidates?.[0]?.finishReason || 'no audio'}`;
      log('speech', last);
      if (res.status === 429 && /quota/i.test(body.error?.message || '')) {
        const err = new Error(`Gemini speech quota exhausted (${model})`);
        err.quota = true;
        throw err;
      }
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, attempt * 30e3));
        continue;
      }
      break; // 400/404: try the next model
    }
  }
  throw new Error(`Gemini speech failed: ${last}`);
}
function pcmToMp3(pcm) {
  return execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', 'pipe:1'], { input: pcm, maxBuffer: 200e6 });
}

// Azure Speech: one request per story (SSML, MP3 48 kbps), a short pause after each. The free tier allows
// 20 requests a minute and 0.5M characters a month; when it says no (quota), publish the script only.
const xml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function azureSpeech(text) {
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="sr-RS"><voice name="${VOICE}"><prosody rate="${Math.round((RATE - 1) * 100)}%">${xml(text)}</prosody><break time="900ms"/></voice></speak>`;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`https://${AZURE_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
          'User-Agent': 'vesti-bilten',
        },
        body: ssml,
      });
    } catch (e) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 5e3));
        continue;
      }
      throw new Error(`Azure speech: network ${e.cause?.code || e.message}`);
    }
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const msg = (await res.text().catch(() => '')).slice(0, 200);
    // 429 on F0 is either the per-minute limit (wait and retry) or the monthly quota (give up).
    if (res.status === 429 && attempt < 4 && !/quota/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 20e3));
      continue;
    }
    if (res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 5e3));
      continue;
    }
    const err = new Error(`Azure speech: HTTP ${res.status} ${msg}`);
    err.quota = res.status === 429 || res.status === 403;
    throw err;
  }
}

let mp3 = null;
let ttsModel = null;
const segBytes = [];
if (ENGINE === 'azure') {
  const parts = [];
  let chars = 0;
  const t0 = Date.now();
  try {
    for (const [i, seg] of segments.entries()) {
      if (i) await new Promise((r) => setTimeout(r, 3200)); // under 20 requests per minute
      const b = await azureSpeech(seg);
      parts.push(b);
      segBytes.push(b.length);
      chars += seg.length;
    }
    mp3 = Buffer.concat(parts);
    ttsModel = `azure-${AZURE_REGION}`;
    log(`audio: ${parts.length} requests in ${Math.round((Date.now() - t0) / 1000)} s, ${chars} characters, ${(mp3.length / 1e6).toFixed(1)} MB, voice ${VOICE}`);
  } catch (e) {
    log(`speech stopped (${e.message}); publishing the script only`);
    segBytes.length = 0;
    mp3 = null;
  }
} else if (ENGINE === 'cloud') {
  const parts = [];
  let chars = 0;
  for (const seg of segments) {
    let n = 0;
    for (const ch of chunksOf(seg)) {
      const b = await tts(ch);
      parts.push(b);
      n += b.length;
      chars += ch.length;
    }
    segBytes.push(n);
  }
  mp3 = Buffer.concat(parts); // MP3 frames concatenate cleanly
  ttsModel = 'cloud-chirp3-hd';
  log(`audio: ${parts.length} requests, ${chars} characters, ${(mp3.length / 1e6).toFixed(1)} MB, voice ${VOICE}`);
} else if (ENGINE === 'gemini') {
  // Groups of whole segments up to ~2,800 characters (about 3 to 4 minutes of speech per request).
  const groups = [];
  for (const [i, seg] of segments.entries()) {
    const g = groups[groups.length - 1];
    if (g && g.chars + seg.length <= 2800) g.idx.push(i), (g.chars += seg.length);
    else groups.push({ idx: [i], chars: seg.length });
  }
  const pcms = [];
  const t0 = Date.now();
  const skipped = new Set();
  let calls = 0;
  let quotaHit = false;
  const speak = async (txt) => {
    if (calls++) await new Promise((r) => setTimeout(r, 4000)); // stay under the free tier's per-minute limit
    return geminiSpeech(txt);
  };
  for (const [gi, g] of groups.entries()) {
    try {
      const { pcm, model } = await speak(g.idx.map((i) => segments[i]).join('\n\n'));
      ttsModel = model;
      pcms.push(pcm);
      for (const i of g.idx) segBytes[i] = (pcm.length * segments[i].length) / g.chars;
      log(`speech ${gi + 1}/${groups.length}: ${g.chars} chars -> ${(pcm.length / 48000).toFixed(0)} s (${model})`);
    } catch (e) {
      if (e.quota || Date.now() - t0 > 8 * 60e3) {
        log(`speech stopped: ${e.quota ? 'free quota used up' : 'took too long'}; publishing the script only`);
        pcms.length = 0;
        break;
      }
      // One refused story shouldn't sink the bulletin: read the group's stories one by one, skip the ones that still fail.
      log(`speech ${gi + 1}/${groups.length} failed (${e.message}); trying story by story`);
      for (const i of g.idx) {
        try {
          const { pcm, model } = await speak(segments[i]);
          ttsModel = model;
          pcms.push(pcm);
          segBytes[i] = pcm.length;
        } catch (e2) {
          if (e2.quota) {
            quotaHit = true;
            break;
          }
          skipped.add(i);
          segBytes[i] = 0;
          log(`  skipped segment ${i}: ${e2.message}`);
        }
      }
      if (quotaHit) {
        log('speech stopped: free quota used up; publishing the script only');
        pcms.length = 0;
        break;
      }
    }
  }
  if (pcms.length) {
    if (skipped.size) log(`skipped ${skipped.size} of ${segments.length} segments`);
    for (const i of [...skipped].sort((x, y) => y - x)) segments.splice(i, 1), segBytes.splice(i, 1);
    mp3 = pcmToMp3(Buffer.concat(pcms));
  } else segBytes.length = 0;
  if (mp3) log(`audio: ${groups.length} requests in ${Math.round((Date.now() - t0) / 1000)} s, ${(mp3.length / 1e6).toFixed(1)} MB, voice ${VOICE}, ${ttsModel}`);
} else log('no voice key: script only (the app reads it with the phone voice)');
if (mp3) writeFileSync(`${OUT}/bulletin.mp3`, mp3);

if (MODE === 'auto' || MODE === 'now') {
  const t = belgrade();
  const id = `${t.date}-${t.hm}`;
  // Each segment's start as a share of the audio (MP3 is constant bitrate, so bytes track time).
  let acc = 0;
  const total = segBytes.reduce((a, b) => a + b, 0) || 1;
  const label = (txt, i) =>
    i === 0 ? 'Uvod' : i === segments.length - 1 ? 'Odjava' : txt.split(/(?<=[.!?…])\s/)[0].slice(0, 90);
  const segs = segments.map((text, i) => {
    const start = mp3 ? acc / total : null;
    acc += segBytes[i] || 0;
    return { text, label: label(text, i), start };
  });
  const data = { id, date: t.date, generated: Date.now(), model: usedModel, voice: mp3 ? `${VOICE} (${ttsModel})` : null, segments: segs, stories: stories.map((s) => ({ rank: s.rank, sources: s.versions.map((v) => ({ source: v.source, title: v.title, url: v.url })) })) };
  await saveBulletin(
    CACHE,
    { id, date: t.date, generated: data.generated, minutes: Math.round(scriptWords / WPM), audio: !!mp3, bytes: mp3?.length || 0, segments: segs.length, requested: MODE, salt: meta.salt },
    await encryptJson(key, data),
    mp3 ? await encryptBytes(key, mp3) : null,
  );
  const pub = await publishBulletin(CACHE, SITE, meta.salt);
  log(`published bulletin ${pub.id} (${pub.minutes} min, audio ${pub.audio ? 'yes' : 'no'})`);
}
