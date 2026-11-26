'use strict';

/* ---------- storage ---------- */
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('vesti:' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('vesti:' + k, JSON.stringify(v));
    } catch {}
  },
  del(k) {
    try {
      localStorage.removeItem('vesti:' + k);
    } catch {}
  },
};

const S = {
  meta: null,
  index: null,
  key: null,
  tab: 'top', // the app always opens on Najvažnije, all categories
  cat: '',
  hidden: new Set(store.get('hidden', [])),
  read: store.get('read', {}),
  prefs: Object.assign({ theme: 'auto', size: 18, latin: false }, store.get('prefs', {})),
  limit: 60,
  listScroll: 0,
  loading: false,
  lastLoad: 0,
};

const APP_VERSION = '2.1';
const APP_BUILD = '__BUILD__'; // replaced at build time with commit + date

const app = document.getElementById('app');

// Splash: stays at least 2 s (animation plus a moment to read the name), then fades once the first screen is drawn.
const splashStart = performance.now();
function hideSplash() {
  const el = document.getElementById('splash');
  if (!el || el.classList.contains('gone')) return;
  const wait = Math.max(0, 2000 - (performance.now() - splashStart));
  setTimeout(() => {
    el.classList.add('gone');
    setTimeout(() => el.remove(), 400);
  }, wait);
}
setTimeout(hideSplash, 8000); // never block the app if something goes wrong

/* ---------- usage stats (GoatCounter) ---------- */
// Pageviews count devices (GoatCounter dedupes visitors per day); events count actions.
// Paths are fixed names: no titles, URLs or anything from the link fragment leave the device.
const trackQueue = [];
function track(name, isEvent = true) {
  const send = () => window.goatcounter.count({ path: name, title: name, event: isEvent });
  if (window.goatcounter?.count) send();
  else if (trackQueue.length < 20) trackQueue.push(send);
}
(function flushWhenReady(tries = 0) {
  if (window.goatcounter?.count) return trackQueue.splice(0).forEach((f) => f());
  if (tries < 40) setTimeout(() => flushWhenReady(tries + 1), 500);
})();
const $ = (s, r = document) => r.querySelector(s);

/* ---------- text ---------- */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CYR = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'đ', 'е': 'e', 'ж': 'ž', 'з': 'z', 'и': 'i', 'ј': 'j', 'к': 'k',
  'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'ć', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'č', 'џ': 'dž', 'ш': 'š', 'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Ђ': 'Đ',
  'Е': 'E', 'Ж': 'Ž', 'З': 'Z', 'И': 'I', 'Ј': 'J', 'К': 'K', 'Л': 'L', 'Љ': 'Lj', 'М': 'M', 'Н': 'N', 'Њ': 'Nj', 'О': 'O',
  'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'Ћ': 'Ć', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'C', 'Ч': 'Č', 'Џ': 'Dž', 'Ш': 'Š',
};
const lat = (s) => (S.prefs.latin && s ? String(s).replace(/[Ѐ-ӿ]/g, (c) => CYR[c] ?? c) : s);
function latinizeNode(root) {
  if (!S.prefs.latin) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) if (/[Ѐ-ӿ]/.test(n.nodeValue)) n.nodeValue = lat(n.nodeValue);
}

function ago(t) {
  const d = Date.now() - t;
  if (d < 60e3) return 'upravo';
  if (d < 3600e3) return `pre ${Math.floor(d / 60e3)} min`;
  const date = new Date(t);
  const hm = date.toLocaleTimeString('sr-Latn-RS', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return d < 6 * 3600e3 ? `pre ${Math.floor(d / 3600e3)} h` : `danas ${hm}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return `juče ${hm}`;
  return `${date.getDate()}.${date.getMonth() + 1}. ${hm}`;
}

/* ---------- icons ---------- */
const I = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 6h2v12H7zM20 6.8v10.4a.8.8 0 0 1-1.2.7L10.6 12.7a.8.8 0 0 1 0-1.4l8.2-5.2a.8.8 0 0 1 1.2.7z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 6h2v12h-2zM4 6.8v10.4a.8.8 0 0 0 1.2.7l8.2-5.2a.8.8 0 0 0 0-1.4L5.2 6.1A.8.8 0 0 0 4 6.8z"/></svg>',
  headphones: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4.5" height="7" rx="1.5"/><rect x="16.5" y="14" width="4.5" height="7" rx="1.5"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1z"/></svg>',
  bookmarkOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1z"/></svg>',
  thread: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="12" r="2.2"/><path d="M6 8.2v7.6M8 6.8c5 .4 8 2.4 8.4 3.6M8 17.2c5-.4 8-2.4 8.4-3.6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  install: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M12 7v7"/><path d="M9 11l3 3 3-3"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="4" y="17" font-size="13" font-family="serif" fill="currentColor" stroke="none">A</text><path d="M15 12h6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><text x="2" y="18" font-size="17" font-family="serif" fill="currentColor" stroke="none">A</text><path d="M15 12h6M18 9v6"/></svg>',
};

/* ---------- prefs ---------- */
function applyPrefs() {
  const dark = S.prefs.theme === 'dark' || (S.prefs.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--size', S.prefs.size + 'px');
  document.documentElement.dataset.readfont = S.prefs.readfont === 'serif' ? 'serif' : 'sans';
  const tc = $('meta[name="theme-color"]');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.removeAttribute('media'));
  if (tc) tc.content = dark ? '#0d0d0f' : '#f4f4f2';
}
function savePrefs() {
  store.set('prefs', S.prefs);
  applyPrefs();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyPrefs);

function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

/* ---------- crypto ---------- */
const b64 = {
  dec: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  enc: (u8) => btoa(String.fromCharCode(...new Uint8Array(u8))),
};

async function keyFor(meta, pass) {
  const cached = store.get('key');
  if (!pass && cached && cached.salt === meta.salt && cached.iter === meta.iter) {
    return crypto.subtle.importKey('raw', b64.dec(cached.k), 'AES-GCM', false, ['decrypt']);
  }
  pass = pass || store.get('pass');
  if (!pass) return null;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64.dec(meta.salt), iterations: meta.iter },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt'],
  );
  store.set('key', { salt: meta.salt, iter: meta.iter, k: b64.enc(await crypto.subtle.exportKey('raw', key)) });
  store.set('pass', pass);
  return key;
}

async function decrypt(buf) {
  const u8 = new Uint8Array(buf);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, S.key, u8.slice(12));
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

async function getBin(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.arrayBuffer();
}

/* ---------- data ---------- */
async function load(pass) {
  if (S.loading) return;
  S.loading = true;
  document.querySelector('[data-act="refresh"]')?.classList.add('spin');
  try {
    const meta = await (await fetch('data/meta.json', { cache: 'no-cache' })).json();
    S.meta = meta;
    S.key = await keyFor(meta, pass);
    if (!S.key) return renderUnlock();
    let index;
    try {
      index = await decrypt(await getBin('data/index.bin', { cache: 'no-cache' }));
    } catch (e) {
      if (e.name === 'OperationError') {
        store.del('key');
        store.del('pass');
        S.key = null;
        return renderUnlock(pass ? 'Pogrešna lozinka.' : 'Lozinka je promenjena. Unesi novu.');
      }
      throw e;
    }
    S.index = index;
    S.lastLoad = Date.now();
    if (!S.counted) {
      S.counted = true;
      track(isStandalone() ? 'open-app' : 'open-browser', false);
    }
    if (pass) track(S.fromLink ? 'unlock-link' : 'unlock-password');
    document.title = index.title || 'Vesti';
    pruneRead();
    route();
    prefetch();
    navigator.serviceWorker?.controller?.postMessage({ type: 'keep', ids: Object.keys(index.items) });
  } catch (e) {
    console.error(e);
    if (S.index) toast('Nema veze. Prikazujem sačuvane vesti.');
    else app.innerHTML = `<div class="wrap"><p class="empty">Vesti trenutno nisu dostupne.<br><small>${esc(e.message)}</small></p>
      <button class="more" onclick="location.reload()">Pokušaj ponovo</button></div>`;
    hideSplash();
  } finally {
    S.loading = false;
    document.querySelector('[data-act="refresh"]')?.classList.remove('spin');
  }
}

function pruneRead() {
  const live = new Set(S.index.clusters.map((c) => c.id));
  for (const id of Object.keys(S.read)) if (!live.has(id)) delete S.read[id];
  store.set('read', S.read);
}

const srcById = (id) => S.index.sources.find((s) => s.id === id) || { id, name: id };
const visible = (itemId) => !S.hidden.has(S.index.items[itemId]?.s);

// Entertainment/health ("fun") and sponsored ("promo") categories are off unless switched on in Settings.
function catAllowed(cat) {
  const g = S.index.groups?.[cat];
  if (!g) return true;
  return g === 'fun' ? !!S.prefs.fun : g === 'promo' ? !!S.prefs.promo : true;
}

function viewClusters() {
  const out = [];
  for (const c of S.index.clusters) {
    const items = c.it.filter(visible);
    if (!items.length) continue;
    const rep = items.includes(c.r) ? c.r : items[0];
    const srcs = [...new Set(items.map((id) => S.index.items[id].s))];
    const votes = {};
    for (const id of items) {
      const k = S.index.items[id].c || 'Ostalo';
      if (k !== 'Ostalo') votes[k] = (votes[k] || 0) + (id === rep ? 1.5 : 1);
    }
    const cat = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Ostalo';
    if (!catAllowed(cat)) continue;
    out.push({ ...c, items, rep, srcs, cat });
  }
  if (S.prefs.threads === false) return out;
  // Developing stories: the newest step stands in for the whole thread.
  const byThread = new Map();
  for (const c of out) if (c.th) byThread.set(c.th, [...(byThread.get(c.th) || []), c]);
  const hide = new Set();
  for (const steps of byThread.values()) {
    if (steps.length < 2) continue;
    steps.sort((a, b) => a.l - b.l);
    const newest = steps[steps.length - 1];
    newest.steps = steps.map((x) => x.id);
    newest.rankSrc = Math.max(...steps.map((x) => x.srcs.length)); // a big story stays big as it develops
    for (const x of steps.slice(0, -1)) hide.add(x.id);
  }
  return out.filter((c) => !hide.has(c.id));
}

// All visible steps of a thread, oldest first (for the reader timeline).
function threadSteps(th) {
  if (!th || S.prefs.threads === false) return [];
  return S.index.clusters.filter((c) => c.th === th && c.it.some(visible)).sort((a, b) => a.l - b.l);
}

function ranked() {
  const list = viewClusters().filter((c) => !S.cat || c.cat === S.cat);
  if (S.tab === 'new') return list.sort((a, b) => b.l - a.l);
  const now = Date.now();
  return list
    .filter((c) => now - c.l < (S.cat ? 14 * 24 : 30) * 3600e3)
    .map((c) => {
      const age = (now - c.l) / 3600e3;
      const score = ((c.rankSrc || c.srcs.length) + 0.25 * (c.items.length - c.srcs.length)) * Math.exp(-age / 14);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

// Big image for heroes and lead cards; the feed image is often a small thumbnail.
const bigImg = (it) => it.h || it.i || '';

// First sentence or two of a lead, about 220 characters at most.
function summarize(text, max = 220) {
  if (!text) return '';
  const t = String(text).replace(/\s+/g, ' ').trim();
  const parts = t.split(/(?<=[.!?…])\s+(?=[„"«A-ZČĆŠŽĐА-ЯЂЈЉЊЋЏ0-9])/);
  let out = '';
  for (const p of parts) {
    if (out && (out + ' ' + p).length > max) break;
    out = out ? out + ' ' + p : p;
    if (out.length > max * 0.6) break;
  }
  if (out.length > max + 40) out = out.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return out;
}
const bestLead = (c) => {
  const leads = c.items.map((id) => S.index.items[id].l || '').filter(Boolean);
  const rep = S.index.items[c.rep].l;
  return rep && rep.length > 60 ? rep : leads.sort((a, b) => b.length - a.length)[0] || '';
};

// "Ukratko": the server's list (same as the future voice briefing), minus stories from hidden sources.
function briefing() {
  if (!S.index.brief) return briefingLocal();
  const byId = new Map(S.index.clusters.map((c) => [c.id, c]));
  const out = [];
  for (const b of S.index.brief) {
    const c = byId.get(b.c);
    if (!c) continue;
    const items = c.it.filter(visible);
    if (!items.length) continue;
    const rep = items.includes(c.r) ? c.r : items[0];
    out.push({ ...c, items, rep, srcs: [...new Set(items.map((id) => S.index.items[id].s))], summary: b.s });
  }
  return out;
}
function briefingLocal() {
  const now = Date.now();
  return viewClusters()
    .filter((c) => now - c.l < 24 * 3600e3)
    .map((c) => ({ c, score: ((c.rankSrc || c.srcs.length) + 0.25 * (c.items.length - c.srcs.length)) * Math.exp(-(now - c.l) / 3600e3 / 18) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((x) => x.c);
}
// Swipe / next-previous follow the screen the story was opened from.
const storyOrder = () =>
  S.ctx === 'brief' ? briefing() : S.ctx === 'search' ? S.results || [] : S.ctx === 'saved' ? savedOrder() : listOrder();

/* ---------- search ---------- */
// Fold for matching: Cyrillic -> Latin, no diacritics, lowercase. Keeps a map back to original positions
// so matches can be highlighted in the original text.
const FOLD1 = { 'đ': 'dj', 'č': 'c', 'ć': 'c', 'š': 's', 'ž': 'z' };
function foldMap(str) {
  let f = '';
  const idx = [];
  for (let i = 0; i < str.length; i++) {
    let ch = str[i];
    if (/[\u0400-\u04FF]/.test(ch)) ch = CYR[ch] ?? ch;
    ch = ch.toLowerCase();
    let out = '';
    for (const c of ch) out += FOLD1[c] ?? c.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    for (let k = 0; k < out.length; k++) {
      f += out[k];
      idx.push(i);
    }
  }
  return { f, idx };
}
const foldStr = (s) => foldMap(s || '').f;

function searchIndex() {
  if (S.hay && S.hayFor === S.index.generated) return S.hay;
  const clusterOf = new Map();
  for (const c of S.index.clusters) for (const id of c.it) clusterOf.set(id, c.id);
  S.hay = Object.entries(S.index.items).map(([id, it]) => ({ id, cid: clusterOf.get(id), t: foldStr(it.t), l: foldStr(it.l) }));
  S.hayFor = S.index.generated;
  return S.hay;
}

function runSearch(q) {
  const words = foldStr(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  if (!words.length) return [];
  const now = Date.now();
  const best = new Map(); // cluster id -> { score, itemId }
  for (const h of searchIndex()) {
    const it = S.index.items[h.id];
    if (!visible(h.id) || !catAllowed(it.c || 'Ostalo')) continue;
    let score = 0;
    let all = true;
    for (const w of words) {
      const re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const inT = h.t.includes(w);
      const inL = h.l.includes(w);
      if (!inT && !inL) {
        all = false;
        break;
      }
      score += (inT ? 3 : 0) + (inL ? 1 : 0) + (re.test(h.t) ? 2 : re.test(h.l) ? 0.5 : 0);
    }
    if (!all) continue;
    score += 2 * Math.exp(-(now - it.p) / 3600e3 / 24); // newer first among equals
    const prev = best.get(h.cid);
    if (!prev || score > prev.score) best.set(h.cid, { score, itemId: h.id });
  }
  const clusters = new Map(S.index.clusters.map((c) => [c.id, c]));
  return [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 100)
    .map(([cid, b]) => {
      const c = clusters.get(cid);
      const items = c.it.filter(visible);
      return { ...c, items, rep: b.itemId, srcs: [...new Set(items.map((id) => S.index.items[id].s))], hit: b.itemId };
    });
}

// Wraps matches of the query words in <mark>, working on the original (unfolded) text.
function highlight(text, q, max) {
  text = lat(text || '');
  const words = foldStr(q).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
  const { f, idx } = foldMap(text);
  const ranges = [];
  for (const w of words) {
    let from = 0;
    let at;
    while ((at = f.indexOf(w, from)) !== -1) {
      ranges.push([idx[at], idx[at + w.length - 1] + 1]);
      from = at + w.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let start = 0;
  if (max && text.length > max && ranges.length) start = Math.max(0, ranges[0][0] - 60);
  let end = max ? Math.min(text.length, start + max) : text.length;
  let out = start > 0 ? '…' : '';
  let pos = start;
  for (const [a, b] of ranges) {
    if (a < pos || a >= end) continue;
    out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>';
    pos = b;
  }
  out += esc(text.slice(pos, end)) + (end < text.length ? '…' : '');
  return out;
}

function renderSearch() {
  app.innerHTML =
    bar(`<a class="icon-btn" href="#/" aria-label="Nazad">${I.back}</a>
      <form class="search-box" role="search"><span class="sb-icon">${I.search}</span>
        <input id="q" type="search" placeholder="Pretraži vesti" value="${esc(S.query || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
        <button type="button" class="sb-clear" aria-label="Obriši"${S.query ? '' : ' hidden'}>×</button></form>`) +
    `<main class="wrap"><div id="results"></div></main>`;
  const input = $('#q');
  let timer;
  const update = () => {
    S.query = input.value;
    $('.sb-clear').hidden = !S.query;
    renderResults();
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 120);
  });
  $('.search-box').addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur();
    rememberSearch(input.value);
  });
  $('.sb-clear').addEventListener('click', () => {
    input.value = '';
    update();
    input.focus();
  });
  renderResults();
  hideSplash();
  if (!S.query) input.focus();
  else requestAnimationFrame(() => {
    const li = S.lastStory && document.querySelector(`#results .card[data-id="${S.lastStory}"]`);
    if (li) li.scrollIntoView({ block: 'center' });
  });
}

function rememberSearch(q) {
  q = (q || '').trim();
  if (q.length < 2) return;
  const recent = store.get('recentSearches', []).filter((x) => x.toLowerCase() !== q.toLowerCase());
  recent.unshift(q);
  store.set('recentSearches', recent.slice(0, 6));
}

function renderResults() {
  const box = $('#results');
  if (!box) return;
  const q = (S.query || '').trim();
  if (q.length < 2) {
    const recent = store.get('recentSearches', []);
    S.results = [];
    box.innerHTML = `<p class="search-hint">Pretražuje naslove i uvode svih vesti u aplikaciji. Latinica i ćirilica, sa kvačicama ili bez.</p>
      ${recent.length ? `<div class="panel-label">Skorašnje pretrage</div><div class="chips recent">${recent.map((r) => `<button data-recent="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}`;
    return;
  }
  const results = runSearch(q);
  S.results = results;
  if (!results.length) {
    box.innerHTML = `<p class="empty">Nema rezultata za „${esc(q)}“.</p>`;
    return;
  }
  box.innerHTML = `<div class="list-tools"><span>${results.length === 100 ? '100+' : results.length} ${results.length === 1 ? 'vest' : 'vesti'}</span></div>
    <ul class="list">${results
      .map((c) => {
        const it = S.index.items[c.hit];
        const src = srcById(it.s);
        return `<li class="card${isUnread(c) ? '' : ' read'}" data-id="${c.id}"><a href="#/a/${c.hit}/${c.id}" data-remember>
          <div class="txt"><div class="meta">${sourceBadge(c, src)}<span>${ago(it.p)}</span></div>
          <h2>${highlight(it.t, q)}</h2>${it.l ? `<p class="lead">${highlight(it.l, q, 180)}</p>` : ''}</div></a></li>`;
      })
      .join('')}</ul>`;
}

// The home list's order. With "Sakrij pročitane", read stories drop out, except the ones opened
// since leaving the list (so swiping keeps working while you read).
function listOrder() {
  const list = ranked();
  if (S.prefs.readMode !== 'hide') return list;
  return list.filter((c) => isUnread(c) || S.keep?.has(c.id));
}

const isUnread = (c) => !S.read[c.id] || c.l > S.read[c.id] + 1000;

/* ---------- views ---------- */
function bar(left, right = '') {
  return `<header class="bar"><div class="bar-in">${left}${right}</div></header>`;
}

const imgKey = (src) => {
  try {
    return new URL(src, location.href).pathname.split('/').pop().split('.')[0]
      .replace(/^\d{2,4}z\d{2,4}_(cb_)?/i, '')
      .replace(/-e\d{10,13}(?=-|$)/i, '')
      .replace(/[-_](\d{2,4}x\d{2,4}|scaled|thumb|large|medium|small|w\d+|h\d+)$/i, '')
      .replace(/[-_]\d{2,4}x\d{2,4}/i, '')
      .toLowerCase();
  } catch {
    return src;
  }
};
const imgTag = (src, cls) =>
  src ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : '';

function sourceBadge(c, src) {
  const others = c.srcs.length - 1;
  if (others <= 0) return `<span class="src" style="--c:${esc(src.color)}">${esc(src.name)}</span>`;
  const dots = c.srcs.slice(0, 4).map((id) => `<i style="--c:${esc(srcById(id).color || 'var(--faint)')}"></i>`).join('');
  return `<span class="src" style="--c:${esc(src.color)}">${esc(src.name)}</span>
    <span class="stack"><span class="dots">${dots}</span>${c.srcs.length} izvora</span>`;
}

function briefCard() {
  const list = briefing();
  if (list.length < 3) return '';
  const unread = list.filter(isUnread).length;
  const mins = Math.max(2, Math.round(list.length * 0.35));
  return `<div class="brief-card${unread ? '' : ' done'}"><a class="bc-link" href="#/brief">
    <div class="bc-head"><span class="bc-badge">Ukratko</span><span>${unread ? `${unread} od ${list.length} nepročitano` : 'Sve pročitano'} · oko ${mins} min</span></div>
    <div class="bc-title">Najvažnije u poslednja 24 sata</div>
    <ol>${list.slice(0, 3).map((c) => `<li>${esc(lat(S.index.items[c.rep].t))}</li>`).join('')}</ol></a>
    <div class="bc-actions"><a class="bc-go" href="#/brief">Pročitaj ukratko →</a>
      ${Voice.supported ? `<button class="bc-listen" data-act="listen-brief">${I.headphones}Poslušaj</button>` : ''}</div></div>`;
}

function renderBrief() {
  const idx = S.index;
  const list = briefing();
  const now = new Date();
  const day = now.toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long' });
  app.innerHTML =
    bar(`<a class="icon-btn" href="#/" aria-label="Nazad">${I.back}</a><span class="crumb"></span>`) +
    `<main class="wrap brief">
      <div class="brief-date">${esc(day.charAt(0).toUpperCase() + day.slice(1))}</div>
      <h1 class="page-title">Ukratko</h1>
      <p class="brief-sub">${list.length} najvažnijih vesti iz poslednja 24 sata, po tome koliko ih medija prenosi. Samo vesti, bez zabave i reklama.</p>
      ${Voice.supported ? `<button class="listen-big" data-act="listen-brief">${I.play}<span>Poslušaj Ukratko<small>${briefFull() ? 'cele vesti' : 'samo sažeci'}, oko ${briefListenMin(list)} min</small></span></button>` : ''}
      <ol class="brief-list">${list
        .map((c, i) => {
          const it = idx.items[c.rep];
          const dots = c.srcs.slice(0, 5).map((id) => `<i style="--c:${esc(srcById(id).color || 'var(--faint)')}"></i>`).join('');
          return `<li class="${isUnread(c) ? '' : 'read'}" data-id="${c.id}"><a href="#/a/${c.rep}/${c.id}">
            <span class="num">${i + 1}</span>
            <div class="txt"><h2>${esc(lat(it.t))}</h2>
              <p>${esc(lat(c.summary ?? summarize(bestLead(c))))}</p>
              <div class="meta"><span class="stack"><span class="dots">${dots}</span>${c.srcs.length > 1 ? `${c.srcs.length} izvora` : esc(srcById(it.s).name)}</span><span>${ago(c.l)}</span></div></div></a></li>`;
        })
        .join('')}</ol>
      <button class="more" data-act="brief-done">Označi kao pročitano i nazad</button>
    </main>`;
  hideSplash();
  requestAnimationFrame(() => {
    const li = S.lastStory && document.querySelector(`.brief-list li[data-id="${S.lastStory}"]`);
    if (li) li.scrollIntoView({ block: 'center' });
    else window.scrollTo(0, 0);
  });
}

function renderList() {
  S.keep = new Set();
  const idx = S.index;
  const pass = store.get('pass');
  if (pass && !isStandalone()) {
    const want = '#k=' + encodeURIComponent(pass);
    if (location.hash !== want) history.replaceState(null, '', location.pathname + location.search + want);
  }
  const list = listOrder();
  const shown = list.slice(0, S.limit);
  const unread = list.filter(isUnread).length;
  const thumbs = S.prefs.thumbs !== false;
  const cards = shown
    .map((c, i) => {
      const it = idx.items[c.rep];
      const src = srcById(it.s);
      const un = isUnread(c);
      const fresh = S.read[c.id] && un;
      const img = bigImg(it) || c.items.map((id) => bigImg(idx.items[id])).find(Boolean) || '';
      const lead = i === 0 && S.tab === 'top' && thumbs && img && un;
      const meta = `<div class="meta">${fresh ? '<span class="dot-new" title="Novi izvori"></span>' : ''}${sourceBadge(c, src)}<span>${ago(c.l)}</span>${c.steps ? `<span class="dev">${I.thread}Razvoj priče · ${c.steps.length}</span>` : ''}</div>`;
      const txt = `<div class="txt">${meta}<h2>${esc(lat(it.t))}</h2>${it.l ? `<p class="lead">${esc(lat(it.l))}</p>` : ''}</div>`;
      return lead
        ? `<li class="card lead-story" data-id="${c.id}"><a href="#/a/${c.rep}/${c.id}">${imgTag(img, 'hero-img')}${txt}</a></li>`
        : `<li class="card${un ? '' : ' read'}" data-id="${c.id}"><a href="#/a/${c.rep}/${c.id}">${txt}${thumbs ? imgTag(img, 'thumb') : ''}</a></li>`;
    })
    .join('');
  const all = viewClusters();
  const counts = {};
  for (const c of all) counts[c.cat] = (counts[c.cat] || 0) + 1;
  const cats = (idx.categories || []).filter((k) => counts[k]);
  const chips = `<div class="chips" role="tablist">${[['', 'Sve', all.length], ...cats.map((k) => [k, k, counts[k]])]
    .map(([k, label, n]) => `<button data-cat="${esc(k)}" aria-pressed="${S.cat === k}">${esc(label)}<span>${n}</span></button>`)
    .join('')}</div>`;
  const today = new Date().toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long' });

  app.innerHTML = `<header class="home-head">
      <div class="t"><div class="date">${esc(today.charAt(0).toUpperCase() + today.slice(1))}</div>
        <h1>${esc(idx.title || 'Vesti')}</h1>
        <div class="sub">Ažurirano ${ago(idx.generated)} · ${unread} nepročitanih</div></div>
      <div class="actions"><a class="icon-btn" href="#/search" aria-label="Pretraga">${I.search}</a>
        <a class="icon-btn" href="#/saved" aria-label="Sačuvano">${I.bookmark}</a>
        <button class="icon-btn" data-act="refresh" aria-label="Osveži">${I.refresh}</button>
        <a class="icon-btn" href="#/settings" aria-label="Podešavanja">${I.gear}</a></div>
    </header>
    <main class="wrap">
      ${inAppHint()}
      ${store.get('seenVersion') && store.get('seenVersion') !== APP_VERSION ? `<a class="update-note" href="#/changelog"><span class="cl-k new">Novo</span><span><b>Ažurirano na ${APP_VERSION}</b> · Šta je novo</span><button class="x" data-act="seen-version" aria-label="Zatvori">×</button></a>` : ''}
      ${!isInAppBrowser() && canOfferInstall() && !store.get('installDismissed') ? `<div class="install-banner">${I.install}
        <div class="grow"><b>Instaliraj Vesti</b><span>Kao prava aplikacija, bez pregledača</span></div>
        <button class="pill-btn" data-act="install">Instaliraj</button><button class="x" data-act="install-dismiss" aria-label="Zatvori">×</button></div>` : ''}
      <div class="seg-tabs" role="tablist">
        <button role="tab" data-tab="top" aria-selected="${S.tab === 'top'}">Najvažnije</button>
        <button role="tab" data-tab="new" aria-selected="${S.tab === 'new'}">Najnovije</button>
      </div>
      ${chips}
      ${S.tab === 'top' && !S.cat ? briefCard() : ''}
      <div class="list-tools"><span>${list.length} vesti</span><button class="link-btn" data-act="allread">Označi sve kao pročitano</button></div>
      ${shown.length ? `<ul class="list">${cards}</ul>` : `<p class="empty">${S.prefs.readMode === 'hide' ? 'Sve vesti su pročitane. Nove stižu svakih 30 minuta.' : 'Nema vesti za prikaz.'}</p>`}
      ${list.length > S.limit ? `<button class="more" data-act="more">Prikaži još (${list.length - S.limit})</button>` : ''}
      <p class="foot">${Object.keys(idx.items).length} članaka iz ${idx.sources.length} izvora, spojeno u ${idx.clusters.length} vesti</p>
    </main>`;
  hideSplash();
  requestAnimationFrame(() => {
    window.scrollTo(0, S.listScroll);
    const card = S.lastStory && S.lastStory !== S.leftFrom && document.querySelector(`.card[data-id="${S.lastStory}"]`);
    if (card) card.scrollIntoView({ block: 'center' });
    S.leftFrom = S.lastStory = null;
    document.querySelector('.chips [aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}

// "Tok priče": the steps of a developing story, oldest first.
function timelineBlock(cluster) {
  const steps = threadSteps(cluster?.th);
  if (steps.length < 2) return '';
  const rows = steps
    .map((c) => {
      const items = c.it.filter(visible);
      const rep = items.includes(c.r) ? c.r : items[0];
      const o = S.index.items[rep];
      const here = c.id === cluster.id;
      const inner = `<span class="tl-dot"></span><div class="tl-body"><div class="tl-when">${ago(c.l)}${here ? ' · <b>čitaš</b>' : ''}</div><div class="tl-t">${esc(lat(o.t))}</div></div>`;
      return here ? `<div class="tl-row here">${inner}</div>` : `<a class="tl-row" href="#/a/${rep}/${c.id}">${inner}</a>`;
    })
    .join('');
  const isNewest = steps[steps.length - 1].id === cluster.id;
  return `<details class="timeline"${S.prefs.timelineOpen !== false ? ' open' : ''}>
    <summary>${I.thread}<span>Tok priče</span><span class="cmp-n">${steps.length} koraka${isNewest ? '' : ' · ima novijih'}</span><span class="chev">▾</span></summary>
    <div class="tl-list">${rows}</div></details>`;
}

// "Kako ko piše": every outlet's headline for the same story, collapsed under the title.
function compareBlock(cluster, currentId) {
  const ids = cluster.it.filter(visible).sort((a, b) => S.index.items[a].p - S.index.items[b].p);
  const rows = ids
    .map((id) => {
      const o = S.index.items[id];
      const os = srcById(o.s);
      const here = id === currentId;
      const first = summarize(o.l, 140);
      const inner = `<div class="meta"><span class="src" style="--c:${esc(os.color)}">${esc(os.name)}</span><span>${ago(o.p)}</span>${here ? '<span class="here">čitaš</span>' : ''}</div>
        <div class="t">${esc(lat(o.t))}</div>${first ? `<div class="l">${esc(lat(first))}</div>` : ''}`;
      return here ? `<div class="cmp-row here">${inner}</div>` : `<a class="cmp-row" href="#/a/${id}/${cluster.id}">${inner}</a>`;
    })
    .join('');
  return `<details class="compare"${S.prefs.compareOpen ? ' open' : ''}>
    <summary><span class="stack"><span class="dots">${ids.slice(0, 5).map((id) => `<i style="--c:${esc(srcById(S.index.items[id].s).color || 'var(--faint)')}"></i>`).join('')}</span>Kako ko piše</span>
      <span class="cmp-n">${ids.length} izvora</span><span class="chev">▾</span></summary>
    <div class="cmp-list">${rows}</div></details>`;
}

async function renderArticle(itemId, clusterId) {
  const idx = S.index;
  const it = idx.items[itemId] || savedAsItem(itemId); // saved stories outlive the 3-day index
  if (!it) return (location.hash = '#/');
  const src = it._src || srcById(it.s);
  const saved = savedAll()[itemId];
  S.cur = { id: itemId, article: null };
  const cluster = idx.clusters.find((c) => c.id === clusterId) || idx.clusters.find((c) => c.it.includes(itemId));
  if (cluster) {
    S.read[cluster.id] = Math.max(Date.now(), cluster.l);
    store.set('read', S.read);
  }
  const others = (cluster?.it || []).filter((id) => id !== itemId && visible(id));
  S.lastStory = cluster?.id || null;
  if (cluster) (S.keep ||= new Set()).add(cluster.id);
  const order = storyOrder();
  const pos = order.findIndex((c) => c.id === (S.ctx === 'saved' ? clusterId : cluster?.id));
  const prev = pos > 0 ? order[pos - 1] : null;
  const next = pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null;
  const navCard = (c, dir) => {
    if (!c) return '<span></span>';
    const o = idx.items[c.rep] || savedAsItem(c.rep);
    return `<a class="nav-card ${dir}" href="#/a/${c.rep}/${c.id}" data-go="${dir === 'prev' ? -1 : 1}">
      <span class="nav-dir">${dir === 'prev' ? '← Prethodna' : 'Sledeća →'}</span><span class="nav-t">${esc(lat(o.t))}</span></a>`;
  };
  const slide = S.slide;
  S.slide = null;

  app.innerHTML =
    bar(
      `<a class="icon-btn" href="#/" data-act="back" aria-label="Nazad">${I.back}</a>
       <span class="crumb" data-idle="${pos >= 0 ? `${pos + 1} / ${order.length}` : ''}">${pos >= 0 ? `${pos + 1} / ${order.length}` : ''}</span>`,
      `<span class="size-ctl"><button data-act="smaller" aria-label="Manji tekst">A</button><button data-act="bigger" aria-label="Veći tekst">A</button></span>
       <button class="icon-btn" data-act="share-article" aria-label="Podeli">${I.share}</button>
       <a class="pill-btn" href="${esc(it.u)}" target="_blank" rel="noopener noreferrer">Original ${I.ext}</a>`,
    ) +
    `<main class="wrap"><article class="reader${slide ? ' slide-' + slide : ''}">
      <div class="kicker"><span class="src" style="--c:${esc(src.color)}">${esc(src.name)}</span><span>${ago(it.p)}</span>
        ${it.w ? `<span>${Math.max(1, Math.round(it.w / 220))} min čitanja</span>` : ''}<span class="byline"></span></div>
      <h1>${esc(lat(it.t))}</h1>
      <div class="actions-row">
        ${Voice.supported ? `<button class="act" data-act="listen">${I.headphones}<span>Slušaj</span></button>` : ''}
        <button class="act${saved ? ' on' : ''}" data-act="save">${saved ? I.bookmarkOn : I.bookmark}<span>${saved ? 'Sačuvano' : 'Sačuvaj'}</span></button>
      </div>
      ${timelineBlock(cluster)}
      ${others.length ? compareBlock(cluster, itemId) : ''}
      <div class="content">${it.x ? '<p class="notice">Učitavam…</p>' : ''}</div>
      ${prev || next ? `<nav class="story-nav">${navCard(prev, 'prev')}${navCard(next, 'next')}</nav>
        <p class="swipe-hint">Prevuci levo ili desno za sledeću vest</p>` : ''}
    </article></main>`;
  window.scrollTo(0, 0);

  const box = $('.content');
  const heroTag = (src) => `<img class="hero" src="${esc(src)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`;
  const fallback = (why) => {
    box.innerHTML = `${bigImg(it) ? heroTag(bigImg(it)) : ''}
      ${it.l ? `<div class="body"><p>${esc(lat(it.l))}</p></div>` : ''}
      <p class="notice">${why}</p>
      <a class="cta" href="${esc(it.u)}" target="_blank" rel="noopener noreferrer">Otvori na sajtu ${I.ext}</a>`;
  };
  if (!it.x) return fallback('Pun tekst ovog članka nije dostupan (plaćeni sadržaj, video ili sajt blokira preuzimanje).');
  try {
    const a = saved?.html ? { html: saved.html, byline: saved.byline, image: saved.image } : await decrypt(await getBin(`data/a/${itemId}.bin`));
    S.cur = { id: itemId, article: a };
    if (location.hash.split('/')[2] !== itemId) return; // user navigated away
    const body = document.createElement('div');
    body.className = 'body';
    body.innerHTML = a.html;
    for (const img of body.querySelectorAll('img')) {
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => (img.closest('figure') || img).remove();
    }
    for (const l of body.querySelectorAll('a')) {
      l.target = '_blank';
      l.rel = 'noopener noreferrer';
    }
    latinizeNode(body);
    // Lead image: skip it when the article already opens with a picture or contains the same one.
    const hero = a.image || bigImg(it);
    // Any picture before the first real paragraph means the article brings its own lead image.
    let first = null;
    for (const el of body.children) {
      if (el.tagName === 'IMG' || el.querySelector('img')) {
        first = el;
        break;
      }
      if (el.textContent.trim().length > 80) break;
    }
    const opensWithImage = !!first;
    const contains = hero && [...body.querySelectorAll('img')].some((im) => imgKey(im.getAttribute('src')) === imgKey(hero));
    box.innerHTML = hero && !opensWithImage && !contains ? heroTag(hero) : '';
    if (opensWithImage) first.classList.add('first-media');
    box.appendChild(body);
    box.insertAdjacentHTML('beforeend', `<a class="cta" href="${esc(it.u)}" target="_blank" rel="noopener noreferrer">Otvori original na ${esc(src.name)} ${I.ext}</a>`);
    if (a.byline) $('.byline').textContent = lat(a.byline);
  } catch (e) {
    fallback(navigator.onLine ? 'Članak nije moguće učitati.' : 'Niste na mreži, a ovaj članak nije sačuvan.');
  }
}

function voiceSettings() {
  const seg = (name, val, opts) =>
    `<div class="seg">${opts.map(([v, l]) => `<button data-pref="${name}" data-val="${v}" aria-pressed="${val === v}">${l}</button>`).join('')}</div>`;
  const local = Voice.localVoices();
  const cur = Voice.pick();
  const opts = (local.length ? local : Voice.voices())
    .map((v) => `<option value="${esc(v.voiceURI)}"${cur && v.voiceURI === cur.voiceURI ? ' selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`)
    .join('');
  return `<div class="panel-label">Čitanje naglas</div>
    <section class="panel">
      <div class="row"><div class="grow">Glas${local.length ? '' : '<div class="hint warn">Na telefonu nema srpskog glasa. Android: Podešavanja → Pristupačnost → Pretvaranje teksta u govor → Google → instaliraj srpski.</div>'}</div>
        <select class="sel" data-act="voice">${opts || '<option>Nema glasova</option>'}</select></div>
      <div class="row"><div class="grow">Brzina<div class="hint">${(S.prefs.rate || 1).toFixed(1)}×</div></div>
        <input type="range" min="0.7" max="1.6" step="0.1" value="${S.prefs.rate || 1}" data-act="rate"></div>
      <div class="row"><div class="grow">Poslušaj Ukratko<div class="hint">Cele vesti, jedna za drugom, ili samo naslov i sažetak</div></div>${seg('briefVoice', briefFull() ? 'full' : 'short', [['full', 'Cele vesti'], ['short', 'Sažeci']])}</div>
      <button class="row" data-act="voice-test"><div class="grow">Probaj glas</div>${I.play}</button>
    </section>`;
}

/* ---------- changelog ---------- */
async function renderChangelog() {
  store.set('seenVersion', APP_VERSION);
  app.innerHTML =
    bar(`<a class="icon-btn" href="#/settings" aria-label="Nazad">${I.back}</a><span class="crumb"></span>`) +
    `<main class="wrap"><h1 class="page-title">Šta je novo</h1><div id="cl"><p class="empty">Učitavam…</p></div></main>`;
  hideSplash();
  let log = [];
  try {
    log = await (await fetch('changelog.json', { cache: 'no-cache' })).json();
  } catch {
    $('#cl').innerHTML = '<p class="empty">Spisak promena trenutno nije dostupan.</p>';
    return;
  }
  const kind = { Novo: 'new', Promena: 'chg', Ispravka: 'fix' };
  $('#cl').innerHTML = log
    .map((r) => `<section class="panel cl-ver"><div class="cl-head"><span class="cl-v">${esc(r.v)}</span>
        <div><b>${esc(r.title)}</b><span>${esc(r.date)}${r.v === APP_VERSION ? ' · instalirano' : ''}</span></div></div>
      <ul>${r.items.map(([k, t]) => `<li><span class="cl-k ${kind[k] || ''}">${esc(k)}</span>${esc(t)}</li>`).join('')}</ul></section>`)
    .join('');
}

function renderSettings() {
  const idx = S.index;
  const repo = idx.repo;
  const statusOf = (s) => {
    if (s.mode === 'failed') return ['bad', `Ne radi: ${s.error || 'nepoznata greška'}`];
    if (s.mode === 'rss') return ['ok', `RSS · ${s.count} članaka`];
    if (s.mode === 'scrape') return ['warn', `Bez RSS-a, naslovi sa naslovne strane · ${s.count}`];
    return ['warn', `RSS pronađen automatski · ${s.count} članaka`];
  };
  const seg = (name, val, opts) =>
    `<div class="seg">${opts.map(([v, l]) => `<button data-pref="${name}" data-val="${v}" aria-pressed="${val === v}">${l}</button>`).join('')}</div>`;

  app.innerHTML =
    bar(`<a class="icon-btn" href="#/" aria-label="Nazad">${I.back}</a><span class="crumb"></span>`) +
    `<main class="wrap">
      <h1 class="page-title">Podešavanja</h1>
      <div class="panel-label">Izgled</div>
      <section class="panel">
        <div class="row"><div class="grow">Tema</div>${seg('theme', S.prefs.theme, [['auto', 'Auto'], ['light', 'Svetla'], ['dark', 'Tamna']])}</div>
        <div class="row"><div class="grow">Font za čitanje</div>${seg('readfont', S.prefs.readfont || 'sans', [['sans', 'Moderan'], ['serif', 'Klasičan']])}</div>
        <div class="row"><div class="grow">Veličina teksta<div class="hint">${S.prefs.size}px</div></div>
          <input type="range" min="15" max="24" step="1" value="${S.prefs.size}" data-act="size"></div>
        <div class="row"><div class="grow">Pročitane vesti<div class="hint">Zatamni ih ili ih potpuno skloni iz liste</div></div>${seg('readMode', S.prefs.readMode === 'hide' ? 'hide' : 'dim', [['dim', 'Zatamni'], ['hide', 'Sakrij']])}</div>
        <div class="row"><div class="grow">Slike u listi<div class="hint">Isključi za manju potrošnju podataka</div></div>
          <input type="checkbox" class="switch" data-act="thumbs" ${S.prefs.thumbs !== false ? 'checked' : ''}></div>
        <div class="row"><div class="grow">Zabava i zdravlje<div class="hint">Estrada, rijaliti, horoskop i zdravlje, kao kategorije Zabava i Zdravlje</div></div>
          <input type="checkbox" class="switch" data-act="fun" ${S.prefs.fun ? 'checked' : ''}></div>
        <div class="row"><div class="grow">Sponzorisani tekstovi<div class="hint">PR članci i akcije koje mediji objavljuju kao vesti (kategorija Promo)</div></div>
          <input type="checkbox" class="switch" data-act="promo" ${S.prefs.promo ? 'checked' : ''}></div>
        <div class="row"><div class="grow">Spoji razvoj priče<div class="hint">Nastavak iste priče (npr. hapšenje pa pritvor) prikazuje se kao jedna vest sa tokom priče</div></div>
          <input type="checkbox" class="switch" data-act="threads" ${S.prefs.threads !== false ? 'checked' : ''}></div>
        <div class="row"><div class="grow">Sve latinicom<div class="hint">Ćirilične naslove i tekstove prikazuje latinicom</div></div>
          <input type="checkbox" class="switch" data-act="latin" ${S.prefs.latin ? 'checked' : ''}></div>
      </section>

      ${Voice.supported ? voiceSettings() : ''}
      <div class="panel-label">Izvori</div>
      <section class="panel">
        ${idx.sources.map((s) => {
          const [cls, txt] = statusOf(s);
          return `<div class="row"><span class="status ${cls}"></span>
            <div class="grow"><strong>${esc(s.name)}</strong><div class="hint">${esc(txt)}</div></div>
            <input type="checkbox" class="switch" data-src="${esc(s.id)}" aria-label="Prikaži ${esc(s.name)}" ${S.hidden.has(s.id) ? '' : 'checked'}></div>`;
        }).join('')}
        <div class="row"><div class="grow hint">Isključeni izvori se skrivaju samo na ovom uređaju.</div></div>
      </section>

      <div class="panel-label">Dodaj izvor</div>
      <section class="panel">
        <label class="field"><span>Naziv</span><input id="ns-name" placeholder="npr. RTS" autocomplete="off"></label>
        <label class="field"><span>Adresa sajta</span><input id="ns-home" type="url" inputmode="url" placeholder="https://www.rts.rs/" autocomplete="off"></label>
        <label class="field"><span>RSS adresa (nije obavezno)</span><input id="ns-feed" type="url" inputmode="url" placeholder="Pronalazi se automatski" autocomplete="off"></label>
        <a class="primary" id="ns-go" target="_blank" rel="noopener" aria-disabled="true" href="#">Dodaj preko GitHuba</a>
        <p class="row hint" style="border:0;min-height:0;padding:0 0 14px">${repo
          ? 'Otvara GitHub sa pripremljenim fajlom. Potvrdi sa Commit changes. Izvor se pojavljuje posle sledećeg ažuriranja.'
          : 'Dostupno kada aplikacija radi sa GitHub Pages.'}</p>
      </section>

      <div class="panel-label">Podeli i instaliraj</div>
      <section class="panel">
        ${isStandalone() ? `<div class="row"><span class="status ok"></span><div class="grow">Aplikacija je instalirana</div></div>` : canOfferInstall()
          ? `<button class="row" data-act="install"><div class="grow">Instaliraj aplikaciju<div class="hint">Ikonica na početnom ekranu, otvara se bez pregledača</div></div>${I.install}</button>`
          : `<div class="row"><div class="grow">Instaliraj aplikaciju<div class="hint">U Chrome meniju ⋮ izaberi „Instaliraj aplikaciju“ ili „Dodaj na početni ekran“</div></div></div>`}
        <button class="row" data-act="share"><div class="grow">Pošalji link porodici i prijateljima<div class="hint">Link sadrži lozinku, pa se aplikacija otključava sama. Šalji ga samo ljudima kojima veruješ.</div></div>${I.share}</button>
      </section>

      <div class="panel-label">Održavanje</div>
      <section class="panel">
        ${repo ? `<a class="row" href="https://github.com/${esc(repo)}/tree/main/sources" target="_blank" rel="noopener"><div class="grow">Uredi ili ukloni izvore<div class="hint">Fajlovi u folderu sources na GitHubu</div></div>${I.ext}</a>
        <a class="row" href="https://github.com/${esc(repo)}/actions/workflows/update.yml" target="_blank" rel="noopener"><div class="grow">Ažuriraj odmah<div class="hint">Run workflow na GitHub Actions</div></div>${I.ext}</a>` : ''}
        <button class="row" data-act="logout"><div class="grow">Zaboravi lozinku na ovom uređaju</div></button>
      </section>
      <div class="panel-label">O aplikaciji</div>
      <section class="panel"><a class="row" href="#/changelog"><div class="grow">Šta je novo<div class="hint">Sve verzije i promene, od prve do ${APP_VERSION}</div></div><span class="go">›</span></a></section>
      <section class="panel about">
        <div class="about-head"><img src="icon.svg" alt="" width="52" height="52">
          <div><b>Pametniji čitač vesti</b><span>Verzija ${APP_VERSION}${APP_BUILD.startsWith('__') ? '' : ` · ${esc(APP_BUILD)}`}</span></div></div>
        <p>Vesti iz ${idx.sources.length} srpskih medija na jednom mestu, bez reklama i bez ponavljanja. Za par minuta znaš šta je važno danas.</p>
        <h3 class="about-h">Zašto je pametniji</h3>
        <ul class="benefits">
          <li><b>Bez reklama i iskačućih prozora.</b> Samo tekst i fotografije, bez kolačića i bez „pročitajte još“. Zabava, zdravlje i sponzorisani tekstovi su isključeni dok ih sam ne uključiš.</li>
          <li><b>Svaka vest samo jednom.</b> Kada više medija piše o istom događaju, priče se spajaju u jednu karticu. Lista je skoro duplo kraća.</li>
          <li><b>Svi važni mediji na jednom mestu.</b> Od dnevnih portala do istraživačkih redakcija, bez skakanja po sajtovima.</li>
          <li><b>Ukratko.</b> Dvadeset najvažnijih vesti iz poslednja 24 sata, sa po dve rečenice, za nekoliko minuta.</li>
          <li><b>Kako ko piše.</b> Uporedi naslove različitih medija o istom događaju i sam proceni.</li>
          <li><b>Tok priče.</b> Kada se priča razvija (hapšenje, pa pritvor, pa optužnica), vidiš samo najnoviji korak, a ceo tok je u članku.</li>
          <li><b>Pretraga.</b> Nađi bilo koju vest za sekund, latinicom ili ćirilicom, sa kvačicama ili bez.</li>
          <li><b>Najvažnije prvo.</b> Vesti koje prenosi najviše medija su na vrhu, a kategorije čuvaju vreme kad tražiš samo jednu temu.</li>
          <li><b>Brzo i štedljivo.</b> Učitava samo tekst, a pročitane vesti rade i bez interneta.</li>
          <li><b>Lako deljenje.</b> Pošalji kratak opis i link na ceo tekst preko Vibera, WhatsAppa, e-pošte ili LinkedIna.</li>
          <li><b>Privatno.</b> Bez naloga i bez praćenja. Beleži se samo anonimni broj otvaranja aplikacije.</li>
        </ul>
        <h3 class="about-h">Kako se koristi</h3>
        <ul>
          <li><b>Najvažnije</b> i <b>Najnovije</b> menjaju redosled, a <b>kategorije</b> ispod njih filtriraju po temi.</li>
          <li>Oznaka <span class="stack-ex"><i></i><i></i><i></i></span> <b>3 izvora</b> znači da vest prenose tri medija. Dodirni <b>Kako ko piše</b> u članku da vidiš sve verzije.</li>
          <li>U članku <b>prevuci levo ili desno</b> za sledeću ili prethodnu vest. Pročitana priča je pročitana u svim izvorima.</li>
          <li>Oznaka <b>Razvoj priče · 3</b> znači da je to treći korak iste priče. Prethodni koraci su u članku, pod <b>Tok priče</b>.</li>
          <li><b>Lupa</b> na početnom ekranu otvara pretragu.</li>
          <li><b>Slušaj</b> u članku čita tekst naglas, a <b>Poslušaj</b> u Ukratko čita svih 20 vesti, za put do posla.</li>
          <li><b>Sačuvaj</b> čuva vest za kasnije, i bez interneta. Sve sačuvano je pod ikonicom zastavice na početnom ekranu.</li>
          <li><b>Original</b> otvara članak na sajtu izvora, a <b>⤴</b> ga deli.</li>
          <li><b>↻</b> donosi najnovije vesti. Ako su starije od 5 minuta, pokreće novo prikupljanje (oko 2 minuta).</li>
        </ul>
        <p class="hint">Tekstovi i fotografije pripadaju izdavačima. Aplikacija je namenjena ličnoj upotrebi i uvek vodi na originalni članak.</p>
      </section>
      <p class="foot">Poslednje ažuriranje vesti: ${new Date(idx.generated).toLocaleString('sr-Latn-RS')}</p>
    </main>`;

  const name = $('#ns-name'), home = $('#ns-home'), feed = $('#ns-feed'), go = $('#ns-go');
  const update = () => {
    let ok = false;
    try {
      ok = !!repo && name.value.trim() && /^https?:$/.test(new URL(home.value.trim()).protocol);
    } catch {}
    go.setAttribute('aria-disabled', String(!ok));
    if (!ok) return;
    const slug = name.value.trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'izvor';
    const json = { name: name.value.trim(), home: home.value.trim(), feeds: feed.value.trim() ? [feed.value.trim()] : [] };
    go.href = `https://github.com/${repo}/new/main/sources?filename=${encodeURIComponent(slug + '.json')}&value=${encodeURIComponent(JSON.stringify(json, null, 2) + '\n')}`;
  };
  [name, home, feed].forEach((el) => el.addEventListener('input', update));
}

function renderUnlock(err = '') {
  app.innerHTML = `<main class="unlock"><form class="box" id="unlock">
    <h1>Vesti</h1><p>Unesi lozinku ili nalepi link koji si dobio.</p>
    ${inAppHint()}
    <label class="field"><span>Lozinka ili link</span><input id="pass" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required></label>
    <label class="show-pass"><input type="checkbox" id="showpass"> Prikaži</label>
    <div class="err">${esc(err)}</div>
    <button class="primary" type="submit">Otključaj</button></form></main>`;
  hideSplash();
  $('#showpass').addEventListener('change', (e) => ($('#pass').type = e.target.checked ? 'text' : 'password'));
  $('#unlock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#unlock button');
    btn.textContent = 'Otključavam…';
    btn.disabled = true;
    let v = $('#pass').value.trim();
    const m = /#k=([^\s#]+)/.exec(v);
    S.fromLink = !!m;
    if (m) {
      try {
        v = decodeURIComponent(m[1]);
      } catch {}
    }
    await load(v);
  });
  $('#pass').focus();
}

/* ---------- refresh: ask GitHub for a fresh build ---------- */
async function refreshNow() {
  if (S.updating) return toast('Ažuriranje je već u toku…');
  const idx = S.index;
  const age = Date.now() - (idx?.generated || 0);
  const last = store.get('lastDispatch', 0);
  // Only start a build when the data is older than 5 min and this device hasn't asked in the last 10.
  if (!idx?.dispatch || !idx.repo || age < 5 * 60e3 || Date.now() - last < 10 * 60e3) return load();
  try {
    const r = await fetch(`https://api.github.com/repos/${idx.repo}/actions/workflows/update.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idx.dispatch}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (r.status === 401 || r.status === 403) {
      toast('Token za ažuriranje je istekao. Prikazujem poslednje vesti.');
      return load();
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    return load(); // offline or GitHub unreachable: just reload what's published
  }
  store.set('lastDispatch', Date.now());
  track('refresh-dispatch');
  await waitForBuild(idx.generated);
}

async function waitForBuild(since) {
  S.updating = true;
  const btn = () => document.querySelector('[data-act="refresh"]');
  btn()?.classList.add('spin');
  const sub = document.querySelector('.home-head .sub');
  if (sub) sub.textContent = 'Prikupljam najnovije vesti… (oko 2 min)';
  toast('Prikupljam najnovije vesti, oko 2 minuta');
  const started = Date.now();
  try {
    while (Date.now() - started < 6 * 60e3) {
      await new Promise((r) => setTimeout(r, 15000));
      try {
        const m = await (await fetch('data/meta.json', { cache: 'no-store' })).json();
        if (m.generated > since) {
          S.updating = false;
          await load();
          return toast('Vesti su ažurirane');
        }
      } catch {}
      btn()?.classList.add('spin'); // re-applied after re-renders
    }
    toast('Ažuriranje kasni. Proveri ponovo za par minuta.');
  } finally {
    S.updating = false;
    btn()?.classList.remove('spin');
  }
}

/* ---------- share one article ---------- */
async function shareArticle() {
  const [, , itemId] = (location.hash || '').split('/');
  const it = S.index?.items[itemId];
  if (!it) return;
  const src = srcById(it.s).name;
  // Prefer the opening paragraph of the article itself, else the feed lead.
  const firstP = [...document.querySelectorAll('.body p')].map((p) => p.textContent.trim()).find((t) => t.length > 60);
  const note = summarize(firstP || it.l, 240);
  const title = lat(it.t);
  const text = `${title} (${src})${note ? `\n\n${lat(note)}` : ''}`;
  track('share-article');
  if (navigator.share) {
    try {
      return await navigator.share({ title, text: `${text}\n\nCeo tekst:`, url: it.u });
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const full = `${text}\n\nCeo tekst: ${it.u}`;
  const enc = encodeURIComponent;
  showSheet(`<h2>Podeli vest</h2>
    <div class="share-grid">
      <a href="https://wa.me/?text=${enc(full)}" target="_blank" rel="noopener">WhatsApp</a>
      <a href="viber://forward?text=${enc(full)}">Viber</a>
      <a href="mailto:?subject=${enc(title)}&body=${enc(full)}">E-mail</a>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(it.u)}" target="_blank" rel="noopener">LinkedIn</a>
    </div>
    <button class="share-copy" data-copy="${esc(full)}">Kopiraj tekst i link</button>`);
  document.querySelector('.share-copy').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(e.target.dataset.copy);
      toast('Kopirano');
    } catch {}
  });
}

/* ---------- read aloud (Web Speech API) ---------- */
// Text is queued as short segments: Chrome on Android cuts off long utterances, and short segments
// make skipping to the next paragraph or story instant. Segments carry a `group` (paragraph or story).
const ORD = ['Prva', 'Druga', 'Treća', 'Četvrta', 'Peta', 'Šesta', 'Sedma', 'Osma', 'Deveta', 'Deseta',
  'Jedanaesta', 'Dvanaesta', 'Trinaesta', 'Četrnaesta', 'Petnaesta', 'Šesnaesta', 'Sedamnaesta', 'Osamnaesta', 'Devetnaesta', 'Dvadeseta'];

const Voice = {
  q: [],
  i: 0,
  playing: false,
  token: 0,
  title: '',
  wake: null,
  supported: 'speechSynthesis' in window,

  voices() {
    return this.supported ? speechSynthesis.getVoices() : [];
  },
  // Serbian first, then the closest languages a Serbian listener understands.
  localVoices() {
    const rank = (v) => ['sr', 'hr', 'bs', 'sh', 'cnr', 'sl', 'mk'].indexOf(v.lang.toLowerCase().split(/[-_]/)[0]);
    return this.voices().filter((v) => rank(v) >= 0).sort((a, b) => rank(a) - rank(b) || (b.localService ? 1 : 0) - (a.localService ? 1 : 0));
  },
  pick() {
    const all = this.voices();
    return all.find((v) => v.voiceURI === S.prefs.voice) || this.localVoices()[0] || null;
  },

  chunks(text, group, extra = {}) {
    const t = lat(String(text || '')).replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const out = [];
    let cur = '';
    for (const s of t.split(/(?<=[.!?…:;])\s+/)) {
      if (cur && (cur + ' ' + s).length > 220) {
        out.push(cur);
        cur = s;
      } else cur = cur ? cur + ' ' + s : s;
    }
    if (cur) out.push(cur);
    return out.flatMap((c) => (c.length > 300 ? c.match(/.{1,240}(\s|$)/g) : [c])).map((text) => ({ text: text.trim(), group, ...extra }));
  },

  async start(segments, title) {
    if (!this.supported) return toast('Ovaj pregledač ne podržava čitanje naglas');
    this.stop(true);
    this.q = segments;
    this.i = 0;
    this.title = title;
    this.playing = true;
    try {
      this.wake = await navigator.wakeLock?.request('screen'); // keep the screen (and speech) on in the car
    } catch {}
    this.bar();
    this.speak();
  },

  speak() {
    if (!this.playing) return;
    if (this.i >= this.q.length) return this.stop();
    const seg = this.q[this.i];
    seg.onStart?.();
    const u = new SpeechSynthesisUtterance(seg.text);
    const v = this.pick();
    if (v) u.voice = v;
    u.lang = v?.lang || 'sr-RS';
    u.rate = S.prefs.rate || 1;
    const token = ++this.token;
    u.onend = () => {
      if (token !== this.token || !this.playing) return;
      this.i++;
      this.speak();
    };
    u.onerror = (e) => {
      if (token !== this.token || e.error === 'interrupted' || e.error === 'canceled') return;
      this.i++;
      this.speak();
    };
    speechSynthesis.speak(u);
    this.bar();
  },

  // Android Chrome's pause() is unreliable: pausing cancels and resuming restarts the current segment.
  toggle() {
    if (this.playing) {
      this.playing = false;
      this.token++;
      speechSynthesis.cancel();
    } else {
      this.playing = true;
      this.speak();
    }
    this.bar();
  },
  skip(dir) {
    const g = this.q[this.i]?.group;
    let j = this.i;
    if (dir > 0) while (j < this.q.length && this.q[j].group === g) j++;
    else {
      while (j > 0 && this.q[j - 1].group === g) j--; // start of this group
      if (this.i - j < 1 && j > 0) {
        const pg = this.q[j - 1].group;
        j--;
        while (j > 0 && this.q[j - 1].group === pg) j--;
      }
    }
    this.i = Math.max(0, j);
    this.token++;
    speechSynthesis.cancel();
    this.playing = true;
    this.speak();
  },
  stop(silent) {
    this.playing = false;
    this.token++;
    if (this.supported) speechSynthesis.cancel();
    this.wake?.release?.().catch(() => {});
    this.wake = null;
    if (!silent) {
      document.querySelector('.player')?.remove();
      document.querySelectorAll('.speaking').forEach((el) => el.classList.remove('speaking'));
    }
  },

  bar() {
    let el = document.querySelector('.player');
    if (!el) {
      el = document.createElement('div');
      el.className = 'player';
      el.innerHTML = `<div class="pl-txt"><b></b><span></span></div>
        <button data-pl="prev" aria-label="Prethodno">${I.prev}</button>
        <button data-pl="toggle" class="pl-main" aria-label="Pauza"></button>
        <button data-pl="next" aria-label="Sledeće">${I.next}</button>
        <button data-pl="stop" aria-label="Zaustavi">×</button>`;
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pl]');
        if (!b) return;
        const a = b.dataset.pl;
        if (a === 'toggle') this.toggle();
        else if (a === 'stop') this.stop();
        else this.skip(a === 'next' ? 1 : -1);
      });
      document.body.appendChild(el);
    }
    const seg = this.q[this.i];
    el.querySelector('b').textContent = this.title;
    el.querySelector('span').textContent = seg?.label || '';
    el.querySelector('.pl-main').innerHTML = this.playing ? I.pause : I.play;
  },
};

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && Voice.playing && !Voice.wake) {
    try {
      Voice.wake = await navigator.wakeLock?.request('screen');
    } catch {}
  }
});
if (Voice.supported) speechSynthesis.onvoiceschanged = () => {
  if (location.hash === '#/settings') renderSettings();
};

function readArticleAloud(it) {
  const body = document.querySelector('.body');
  const title = lat(it.t);
  const blocks = body ? [...body.querySelectorAll('p, h2, h3, h4, li, blockquote')].map((el) => el.textContent).filter((t) => t.trim().length > 2) : [it.l];
  const total = blocks.length;
  const segs = [...Voice.chunks(title + '.', 0, { label: 'Naslov' })];
  blocks.forEach((b, n) => segs.push(...Voice.chunks(b, n + 1, { label: `Pasus ${n + 1} od ${total}` })));
  track('listen-article');
  Voice.start(segs, title);
}

// Which version of a story to read in full: the representative if it has text, else the longest one that does.
const fullItem = (c) => {
  const ids = c.items || c.it || [c.rep];
  if (S.index.items[c.rep]?.x) return c.rep;
  return ids.filter((id) => S.index.items[id]?.x).sort((a, b) => (S.index.items[b].w || 0) - (S.index.items[a].w || 0))[0] || null;
};
const briefFull = () => S.prefs.briefVoice !== 'short';
// Listening time in minutes (~150 words a minute at normal speed).
function briefListenMin(list) {
  if (!briefFull()) return Math.max(3, Math.round(list.length * 0.6));
  const words = list.reduce((n, c) => {
    const id = fullItem(c);
    return n + 15 + (id ? S.index.items[id].w || 250 : 50);
  }, 0);
  return Math.max(3, Math.round(words / 150 / (S.prefs.rate || 1)));
}
// Article HTML → paragraphs to read.
function htmlBlocks(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('figure, figcaption, script, style, .gallery').forEach((el) => el.remove());
  return [...doc.body.querySelectorAll('p, h2, h3, h4, li, blockquote')]
    .filter((el) => !el.querySelector('p, li')) // innermost blocks only, no double reading
    .map((el) => el.textContent.trim())
    .filter((t) => t.length > 2);
}

async function readBriefAloud() {
  const list = briefing();
  if (!list.length) return;
  const full = briefFull();
  // Load every article first, so nothing has to be fetched while driving.
  const texts = new Map();
  if (full) {
    toast(`Pripremam ${list.length} vesti…`);
    const loadOne = async (c) => {
      const id = fullItem(c);
      if (!id) return;
      try {
        const a = await decrypt(await getBin(`data/a/${id}.bin`));
        const blocks = htmlBlocks(a.html);
        if (blocks.length) texts.set(c.id, blocks);
      } catch {}
    };
    const queue = [...list];
    await Promise.all(Array.from({ length: 5 }, async () => { while (queue.length) await loadOne(queue.shift()); }));
  }
  const now = new Date();
  const part = now.getHours() < 11 ? 'Dobro jutro' : now.getHours() < 18 ? 'Dobar dan' : 'Dobro veče';
  const day = now.toLocaleDateString('sr-Latn-RS', { weekday: 'long', day: 'numeric', month: 'long' });
  const segs = Voice.chunks(`${part}. Ukratko, ${list.length} najvažnijih vesti, ${day}.`, -1, { label: 'Uvod' });
  list.forEach((c, n) => {
    const it = S.index.items[c.rep];
    const onStart = () => {
      S.read[c.id] = Math.max(Date.now(), c.l); // heard = read
      store.set('read', S.read);
      document.querySelectorAll('.brief-list li.speaking').forEach((el) => el.classList.remove('speaking'));
      const li = document.querySelector(`.brief-list li[data-id="${c.id}"]`);
      if (li) {
        li.classList.add('speaking', 'read');
        li.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    const label = `Vest ${n + 1} od ${list.length}`;
    const story = Voice.chunks(`${ORD[n] || n + 1 + '.'} vest. ${it.t}.`, n, { label });
    story[0].onStart = onStart;
    segs.push(...story);
    const body = texts.get(c.id);
    if (body) body.forEach((b) => segs.push(...Voice.chunks(b, n, { label })));
    else segs.push(...Voice.chunks(c.summary ?? summarize(bestLead(c)), n, { label }));
  });
  segs.push(...Voice.chunks('To je sve za sada. Srećan put.', 999, { label: 'Kraj' }));
  track('listen-brief');
  Voice.start(segs, 'Ukratko');
}

/* ---------- saved for later ---------- */
// Saved stories keep their own copy (text + metadata) on the device, so they stay readable offline
// and after they drop out of the 3-day news window.
const SAVED_MAX = 80;
const savedAll = () => store.get('saved', {});
const isSaved = (id) => !!savedAll()[id];

function saveArticle(id, article) {
  const it = S.index.items[id];
  if (!it) return;
  const all = savedAll();
  const src = srcById(it.s);
  all[id] = {
    t: it.t, s: it.s, u: it.u, p: it.p, l: it.l, i: it.i, h: it.h, c: it.c, w: it.w,
    srcName: src.name, srcColor: src.color || '',
    html: article?.html || '', byline: article?.byline || '', image: article?.image || '',
    savedAt: Date.now(),
  };
  const ids = Object.keys(all).sort((a, b) => all[b].savedAt - all[a].savedAt);
  for (const old of ids.slice(SAVED_MAX)) delete all[old];
  try {
    localStorage.setItem('vesti:saved', JSON.stringify(all));
  } catch {
    delete all[id];
    return toast('Nema mesta za čuvanje. Obriši nešto iz Sačuvanog.');
  }
  track('save-article');
  toast('Sačuvano za kasnije');
}
function unsaveArticle(id) {
  const all = savedAll();
  delete all[id];
  store.set('saved', all);
}
// A saved story in the same shape as an index item (used when it is no longer in the index).
function savedAsItem(id) {
  const s = savedAll()[id];
  if (!s) return null;
  return { t: s.t, s: s.s, u: s.u, p: s.p, l: s.l, i: s.i, h: s.h, c: s.c, w: s.w, x: s.html ? 1 : 0, _src: { name: s.srcName, color: s.srcColor }, _saved: s };
}
function savedOrder() {
  const all = savedAll();
  return Object.keys(all)
    .sort((a, b) => all[b].savedAt - all[a].savedAt)
    .map((id) => ({ id: 'saved:' + id, rep: id }));
}

function renderSaved() {
  const all = savedAll();
  const ids = Object.keys(all).sort((a, b) => all[b].savedAt - all[a].savedAt);
  app.innerHTML =
    bar(`<a class="icon-btn" href="#/" aria-label="Nazad">${I.back}</a><span class="crumb"></span>`) +
    `<main class="wrap">
      <h1 class="page-title">Sačuvano</h1>
      <p class="brief-sub">${ids.length ? `${ids.length} ${ids.length === 1 ? 'vest' : 'vesti'}, dostupne i bez interneta.` : 'Ovde se čuvaju vesti za kasnije. U članku dodirni <b>Sačuvaj</b>.'}</p>
      <ul class="list">${ids
        .map((id) => {
          const s = all[id];
          return `<li class="card saved-card" data-id="${id}"><a href="#/a/${id}/saved:${id}">
            <div class="txt"><div class="meta"><span class="src" style="--c:${esc(s.srcColor)}">${esc(s.srcName)}</span><span>sačuvano ${ago(s.savedAt)}</span>${s.html ? '' : '<span>samo uvod</span>'}</div>
            <h2>${esc(lat(s.t))}</h2></div>${S.prefs.thumbs !== false ? imgTag(s.h || s.i, 'thumb') : ''}</a>
            <button class="unsave" data-unsave="${id}" aria-label="Ukloni">×</button></li>`;
        })
        .join('')}</ul>
    </main>`;
  hideSplash();
}

/* ---------- next / previous story ---------- */
function goStory(dir) {
  const parts = (location.hash || '').slice(2).split('/');
  if (parts[0] !== 'a') return false;
  const order = storyOrder();
  const i = order.findIndex((c) => c.id === parts[2]);
  const t = i >= 0 ? order[i + dir] : null;
  if (!t) {
    toast(dir > 0 ? 'Nema više vesti' : 'Ovo je prva vest');
    return false;
  }
  S.slide = dir > 0 ? 'next' : 'prev';
  S.replacing = true; // keep Back pointed at the list
  location.replace(`#/a/${t.rep}/${t.id}`);
  return true;
}

// Horizontal swipe in the reader. Edges are left to Android's back gesture.
let swipe = null;
document.addEventListener('touchstart', (e) => {
  const reader = document.querySelector('.reader');
  const t = e.touches[0];
  if (!reader || e.touches.length > 1 || t.clientX < 28 || t.clientX > innerWidth - 28) return;
  if (e.target.closest('table, pre, .size-ctl, .bar')) return;
  swipe = { x: t.clientX, y: t.clientY, dir: null, el: reader };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!swipe) return;
  const t = e.touches[0];
  const dx = t.clientX - swipe.x;
  const dy = t.clientY - swipe.y;
  if (!swipe.dir) {
    if (Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy) * 1.6) swipe.dir = 'h';
    else if (Math.abs(dy) > 12) return (swipe = null);
    else return;
  }
  swipe.dx = dx;
  swipe.el.style.transition = 'none';
  swipe.el.style.transform = `translateX(${dx * 0.55}px)`;
  swipe.el.style.opacity = String(1 - Math.min(Math.abs(dx) / 700, 0.35));
}, { passive: true });
document.addEventListener('touchend', () => {
  if (!swipe) return;
  const { el, dx = 0, dir } = swipe;
  swipe = null;
  if (dir === 'h' && Math.abs(dx) > 80 && goStory(dx < 0 ? 1 : -1)) return;
  el.style.transition = 'transform .2s ease, opacity .2s ease';
  el.style.transform = '';
  el.style.opacity = '';
});

/* ---------- routing ---------- */
let current = '';
function route() {
  if (!S.index) return;
  const h = location.hash || '#/';
  const isArt = (x) => (x || '').startsWith('#/a/');
  // Remember which screen a story was opened from, and how many history steps lead back to it.
  if (isArt(h) && !isArt(current)) {
    S.from = current || '#/';
    S.hops = 1;
    S.ctx = { '#/brief': 'brief', '#/search': 'search', '#/saved': 'saved' }[current] || 'list';
  } else if (isArt(h) && isArt(current) && h !== current && !S.replacing) S.hops = (S.hops || 0) + 1;
  else if (!isArt(h)) S.hops = 0;
  S.replacing = false;
  if (isListHash(current) && !isListHash(h)) {
    S.listScroll = window.scrollY;
    S.leftFrom = h.split('/')[3] || null;
  }
  current = h;
  const parts = h.slice(2).split('/');
  hideSplash();
  if (parts[0] === 'a' && parts[1]) return renderArticle(parts[1], parts[2]);
  if (parts[0] === 'settings') return renderSettings();
  if (parts[0] === 'brief') return renderBrief();
  if (parts[0] === 'search') return renderSearch();
  if (parts[0] === 'saved') return renderSaved();
  if (parts[0] === 'changelog') return renderChangelog();
  renderList();
}
window.addEventListener('hashchange', route);

/* ---------- events ---------- */
app.addEventListener('click', (e) => {
  const uns = e.target.closest('[data-unsave]');
  if (uns) {
    unsaveArticle(uns.dataset.unsave);
    return renderSaved();
  }
  const rec = e.target.closest('[data-recent]');
  if (rec) {
    $('#q').value = rec.dataset.recent;
    S.query = rec.dataset.recent;
    $('.sb-clear').hidden = false;
    return renderResults();
  }
  if (e.target.closest('[data-remember]')) rememberSearch(S.query);
  const go = e.target.closest('[data-go]');
  if (go) {
    e.preventDefault();
    return goStory(+go.dataset.go);
  }
  const t = e.target.closest('[data-act],[data-tab],[data-pref],[data-cat]');
  if (!t) return;
  if (t.dataset.cat !== undefined) {
    S.cat = t.dataset.cat;
    store.set('cat', S.cat);
    S.limit = 60;
    S.listScroll = 0;
    return renderList();
  }
  if (t.dataset.tab) {
    S.tab = t.dataset.tab;
    store.set('tab', S.tab);
    S.limit = 60;
    S.listScroll = 0;
    return renderList();
  }
  if (t.dataset.pref) {
    S.prefs[t.dataset.pref] = t.dataset.val;
    savePrefs();
    return renderSettings();
  }
  switch (t.dataset.act) {
    case 'refresh':
      return refreshNow();
    case 'more':
      S.limit += 60;
      S.listScroll = window.scrollY;
      return renderList();
    case 'allread':
      for (const c of S.index.clusters) S.read[c.id] = c.l;
      store.set('read', S.read);
      S.listScroll = window.scrollY;
      renderList();
      return toast('Sve označeno kao pročitano');
    case 'back':
      e.preventDefault();
      if (S.hops > 0 && history.length > S.hops) history.go(-S.hops); // back to the list or Ukratko, scroll kept
      else location.hash = S.from || '#/';
      return;
    case 'voice-test':
      return Voice.start(Voice.chunks('Dobro jutro. Ovo je Pametniji čitač vesti. Ovako će zvučati Ukratko na putu do posla.', 0, { label: 'Proba glasa' }), 'Proba glasa');
    case 'share-article':
      return shareArticle();
    case 'listen': {
      const [, , id] = location.hash.split('/');
      const it = S.index.items[id] || savedAsItem(id);
      if (it) readArticleAloud(it);
      return;
    }
    case 'listen-brief':
      e.preventDefault();
      if (!location.hash.startsWith('#/brief')) location.hash = '#/brief';
      return setTimeout(readBriefAloud, 50);
    case 'save': {
      const id = S.cur?.id;
      if (!id) return;
      if (isSaved(id)) {
        unsaveArticle(id);
        toast('Uklonjeno iz Sačuvanog');
      } else saveArticle(id, S.cur.article);
      const on = isSaved(id);
      t.classList.toggle('on', on);
      t.innerHTML = `${on ? I.bookmarkOn : I.bookmark}<span>${on ? 'Sačuvano' : 'Sačuvaj'}</span>`;
      return;
    }
    case 'brief-done': {
      for (const c of briefing()) S.read[c.id] = Math.max(Date.now(), c.l);
      store.set('read', S.read);
      location.hash = '#/';
      return;
    }
    case 'smaller':
    case 'bigger':
      S.prefs.size = Math.min(24, Math.max(15, S.prefs.size + (t.dataset.act === 'bigger' ? 1 : -1)));
      return savePrefs();
    case 'seen-version':
      e.preventDefault();
      store.set('seenVersion', APP_VERSION);
      return renderList();
    case 'install':
      return doInstall();
    case 'install-dismiss':
      store.set('installDismissed', true);
      return renderList();
    case 'share':
      return doShare();
    case 'logout':
      store.del('key');
      store.del('pass');
      history.replaceState(null, '', location.pathname + location.search + '#/');
      S.key = null;
      S.index = null;
      return renderUnlock();
  }
});
app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.act === 'rate') {
    S.prefs.rate = +t.value;
    store.set('prefs', S.prefs);
    t.closest('.row').querySelector('.hint').textContent = S.prefs.rate.toFixed(1) + '×';
    return;
  }
  if (t.dataset.act === 'size') {
    S.prefs.size = +t.value;
    savePrefs();
    t.closest('.row').querySelector('.hint').textContent = S.prefs.size + 'px';
  }
});
app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.act === 'voice') {
    S.prefs.voice = t.value;
    store.set('prefs', S.prefs);
  } else if (t.dataset.act === 'fun' || t.dataset.act === 'promo') {
    S.prefs[t.dataset.act] = t.checked;
    savePrefs();
  } else if (t.dataset.act === 'threads') {
    S.prefs.threads = t.checked;
    savePrefs();
  } else if (t.dataset.act === 'thumbs') {
    S.prefs.thumbs = t.checked;
    savePrefs();
  } else if (t.dataset.act === 'latin') {
    S.prefs.latin = t.checked;
    savePrefs();
  } else if (t.dataset.src) {
    if (t.checked) S.hidden.delete(t.dataset.src);
    else S.hidden.add(t.dataset.src);
    store.set('hidden', [...S.hidden]);
  }
});

// Sticky bar: hairline once scrolled; in the reader, show the headline in the bar after it scrolls away.
window.addEventListener('scroll', () => {
  const bar = document.querySelector('.bar');
  if (!bar) return;
  bar.classList.toggle('scrolled', window.scrollY > 8);
  const h1 = document.querySelector('.reader h1, .page-title');
  const crumb = bar.querySelector('.crumb');
  if (h1 && crumb) {
    const past = h1.getBoundingClientRect().bottom < 60;
    crumb.textContent = past ? h1.textContent : crumb.dataset.idle || '';
  }
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') goStory(e.key === 'ArrowRight' ? 1 : -1);
});

app.addEventListener('toggle', (e) => {
  if (e.target.classList?.contains('compare')) {
    S.prefs.compareOpen = e.target.open;
    store.set('prefs', S.prefs);
  }
  if (e.target.classList?.contains('timeline')) {
    S.prefs.timelineOpen = e.target.open;
    store.set('prefs', S.prefs);
  }
}, true);

// Refresh when coming back to the app after a while.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.key && Date.now() - S.lastLoad > 10 * 60e3) load();
});

/* ---------- offline prefetch ---------- */
async function prefetch() {
  if (!navigator.onLine || navigator.connection?.saveData) return;
  const ids = ranked()
    .slice(0, 40)
    .map((c) => c.rep)
    .filter((id) => S.index.items[id].x);
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        await fetch(`data/a/${id}.bin`);
      } catch {}
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/* ---------- install + share ---------- */
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  if (S.index && !location.hash.startsWith('#/a/')) route(); // reveal the install button / banner, never mid-article
});
window.addEventListener('appinstalled', () => {
  track('installed');
  installEvt = null;
  store.set('installDismissed', true);
  toast('Aplikacija je instalirana');
  if (S.index) route();
});
const canOfferInstall = () => !isStandalone() && (installEvt || isIOS());

async function doInstall() {
  if (installEvt) {
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    track(outcome === 'accepted' ? 'install-accepted' : 'install-declined');
    installEvt = null;
    if (outcome === 'accepted') store.set('installDismissed', true);
    return route();
  }
  track('install-ios-guide');
  showSheet(`<h2>Instaliraj na iPhone</h2>
    <ol class="steps"><li>Dodirni dugme <b>Deli</b> <span class="ios-share">${I.share}</span> na dnu Safarija</li>
    <li>Izaberi <b>Dodaj na početni ekran</b></li><li>Potvrdi sa <b>Dodaj</b></li></ol>
    <p class="hint">Radi samo iz Safarija. Aplikacija se zatim otvara preko celog ekrana, bez pregledača.</p>`);
}

function shareLink() {
  const pass = store.get('pass');
  return pass ? `${location.origin}${location.pathname}#k=${encodeURIComponent(pass)}` : '';
}
async function doShare() {
  const url = shareLink();
  if (!url) return toast('Lozinka nije sačuvana na ovom uređaju');
  track('share-link');
  const text = 'Vesti bez reklama, sa svih portala na jednom mestu. Otvori link i instaliraj aplikaciju:';
  if (navigator.share) {
    try {
      return await navigator.share({ title: 'Vesti', text, url });
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Link je kopiran');
  } catch {
    showSheet(`<h2>Link za deljenje</h2><textarea class="share-box" readonly>${esc(url)}</textarea>`);
    $('.share-box').select();
  }
}

function showSheet(html) {
  document.querySelector('.sheet-wrap')?.remove();
  const w = document.createElement('div');
  w.className = 'sheet-wrap';
  w.innerHTML = `<div class="sheet" role="dialog">${html}<button class="primary" data-close>U redu</button></div>`;
  w.addEventListener('click', (e) => {
    if (e.target === w || e.target.closest('[data-close]')) w.remove();
  });
  document.body.appendChild(w);
}

// A shared link carries the password after "#k=". Take it, then remove it from the address bar and history.
function takeLinkPassword() {
  const m = /^#k=(.+)$/.exec(location.hash);
  if (!m) return null;
  let pass = null;
  try {
    pass = decodeURIComponent(m[1]);
  } catch {}
  // Installed app: drop it from the address bar. Browser: keep it, so "Open in Chrome" and
  // iPhone's "Add to Home Screen" carry the password into the app.
  if (isStandalone()) history.replaceState(null, '', location.pathname + location.search + '#/');
  return pass;
}

const isListHash = (h) => !h || h === '#' || h === '#/' || h.startsWith('#k=');
// In-app browsers (Viber, WhatsApp, Instagram, Facebook...) keep their own storage and can't install apps.
const isInAppBrowser = () => /; wv\)|FBAN|FBAV|Instagram|Viber|WhatsApp|Line\/|Telegram/i.test(navigator.userAgent);
const inAppHint = () =>
  isInAppBrowser()
    ? `<div class="notice inapp">Otvoreno je u pregledaču unutar druge aplikacije. Za instalaciju otvori ovu stranu u Chrome-u: meni <b>⋮</b> → <b>Otvori u Chrome-u</b> (ili „Otvori u pregledaču“).</div>`
    : '';

/* ---------- boot ---------- */
// Existing users (they have settings) come from 1.9 and get the "what's new" note once; new users don't.
if (!store.get('seenVersion')) store.set('seenVersion', store.get('prefs') ? '2.0' : APP_VERSION);
applyPrefs();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!('DecompressionStream' in window) || !crypto.subtle) {
  app.innerHTML = '<p class="empty">Ovaj pregledač je prestar za aplikaciju.</p>';
} else {
  const linkPass = takeLinkPassword();
  S.fromLink = !!linkPass;
  if (linkPass && linkPass !== store.get('pass')) store.del('key'); // a different password in the link wins
  load(linkPass || undefined);
}
