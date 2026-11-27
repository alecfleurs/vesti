// Radio-style news bulletin (test): Ukratko stories -> Gemini script (Serbian Cyrillic) -> Google Chirp 3 HD MP3.
//
// Reads the live encrypted site (same data the app shows), so it needs no build state.
// Env:
//   NEWS_KEY        site password (decrypts index and articles)
//   GEMINI_API_KEY  Google AI Studio key (free tier is enough)
//   GOOGLE_TTS_KEY  Google Cloud API key with Cloud Text-to-Speech enabled (optional: without it only the script is made)
//   SITE            default https://alecfleurs.github.io/vesti/
//   VOICE           default sr-RS-Chirp3-HD-Aoede (female)
//   MINUTES         target length, default 20
//   GEMINI_MODEL    optional; otherwise the first available of MODELS below
//   RATE            speaking rate, default 1.0
//   DRY=1           stop after building the prompt (no API calls)
// Output: out/bulletin/{bulletin.mp3, script.txt, prompt.txt, stories.json}

import { gunzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deriveKey } from './lib/crypto.mjs';

const SITE = (process.env.SITE || 'https://alecfleurs.github.io/vesti/').replace(/\/?$/, '/');
const VOICE = process.env.VOICE || 'sr-RS-Chirp3-HD-Aoede';
const MINUTES = Number(process.env.MINUTES || 20);
const RATE = Number(process.env.RATE || 1);
const WPM = 130; // Serbian neural voices read about 130 words per minute
const MODELS = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-latest'];
const OUT = 'out/bulletin';
const log = (...a) => console.log('[bilten]', ...a);

if (!process.env.NEWS_KEY) throw new Error('NEWS_KEY is missing');
mkdirSync(OUT, { recursive: true });

// ---------- read the encrypted site ----------
const meta = await (await fetch(SITE + 'data/meta.json')).json();
const key = await deriveKey(process.env.NEWS_KEY, meta.salt, meta.iter);
async function getEnc(path) {
  const res = await fetch(SITE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
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
async function gemini(model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 32768 },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gemini ${model}: HTTP ${res.status} ${body.error?.message || ''}`);
    err.status = res.status;
    throw err;
  }
  const text = (body.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  if (!text.trim()) throw new Error(`Gemini ${model}: empty answer (${body.candidates?.[0]?.finishReason || 'no candidate'})`);
  return { text, usage: body.usageMetadata };
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
if (!process.env.GOOGLE_TTS_KEY) {
  log('GOOGLE_TTS_KEY missing: script only');
  process.exit(0);
}
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
  if (!res.ok) throw new Error(`TTS: HTTP ${res.status} ${body.error?.message || ''}`);
  return Buffer.from(body.audioContent, 'base64');
}
const parts = [];
let chars = 0;
for (const seg of segments) {
  for (const ch of chunksOf(seg)) {
    parts.push(await tts(ch));
    chars += ch.length;
  }
}
const mp3 = Buffer.concat(parts); // MP3 frames concatenate cleanly
writeFileSync(`${OUT}/bulletin.mp3`, mp3);
log(`audio: ${parts.length} requests, ${chars} characters, ${(mp3.length / 1e6).toFixed(1)} MB, voice ${VOICE}`);
