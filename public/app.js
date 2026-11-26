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
  tab: store.get('tab', 'top'),
  cat: store.get('cat', ''),
  hidden: new Set(store.get('hidden', [])),
  read: store.get('read', {}),
  prefs: Object.assign({ theme: 'auto', size: 18, latin: false }, store.get('prefs', {})),
  limit: 60,
  listScroll: 0,
  loading: false,
  lastLoad: 0,
};

const app = document.getElementById('app');
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
    out.push({ ...c, items, rep, srcs, cat });
  }
  return out;
}

function ranked() {
  const list = viewClusters().filter((c) => !S.cat || c.cat === S.cat);
  if (S.tab === 'new') return list.sort((a, b) => b.l - a.l);
  const now = Date.now();
  return list
    .filter((c) => now - c.l < (S.cat ? 14 * 24 : 30) * 3600e3)
    .map((c) => {
      const age = (now - c.l) / 3600e3;
      const score = (c.srcs.length + 0.25 * (c.items.length - c.srcs.length)) * Math.exp(-age / 14);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

// Big image for heroes and lead cards; the feed image is often a small thumbnail.
const bigImg = (it) => it.h || it.i || '';

const isUnread = (c) => !S.read[c.id] || c.l > S.read[c.id] + 1000;

/* ---------- views ---------- */
function bar(left, right = '') {
  return `<header class="bar"><div class="bar-in">${left}${right}</div></header>`;
}

const imgKey = (src) => {
  try {
    return new URL(src, location.href).pathname.split('/').pop().split('.')[0]
      .replace(/^\d{2,4}z\d{2,4}_(cb_)?/i, '')
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

function renderList() {
  const idx = S.index;
  const list = ranked();
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
      const meta = `<div class="meta">${fresh ? '<span class="dot-new" title="Novi izvori"></span>' : ''}${sourceBadge(c, src)}<span>${ago(c.l)}</span></div>`;
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
      <div class="actions"><button class="icon-btn" data-act="refresh" aria-label="Osveži">${I.refresh}</button>
        <a class="icon-btn" href="#/settings" aria-label="Podešavanja">${I.gear}</a></div>
    </header>
    <main class="wrap">
      <div class="seg-tabs" role="tablist">
        <button role="tab" data-tab="top" aria-selected="${S.tab === 'top'}">Najvažnije</button>
        <button role="tab" data-tab="new" aria-selected="${S.tab === 'new'}">Najnovije</button>
      </div>
      ${chips}
      <div class="list-tools"><span>${list.length} vesti</span><button class="link-btn" data-act="allread">Označi sve kao pročitano</button></div>
      ${shown.length ? `<ul class="list">${cards}</ul>` : '<p class="empty">Nema vesti za prikaz.</p>'}
      ${list.length > S.limit ? `<button class="more" data-act="more">Prikaži još (${list.length - S.limit})</button>` : ''}
      <p class="foot">${Object.keys(idx.items).length} članaka iz ${idx.sources.length} izvora, spojeno u ${idx.clusters.length} vesti</p>
    </main>`;
  requestAnimationFrame(() => {
    window.scrollTo(0, S.listScroll);
    const card = S.lastStory && S.lastStory !== S.leftFrom && document.querySelector(`.card[data-id="${S.lastStory}"]`);
    if (card) card.scrollIntoView({ block: 'center' });
    S.leftFrom = S.lastStory = null;
    document.querySelector('.chips [aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}

async function renderArticle(itemId, clusterId) {
  const idx = S.index;
  const it = idx.items[itemId];
  if (!it) return (location.hash = '#/');
  const src = srcById(it.s);
  const cluster = idx.clusters.find((c) => c.id === clusterId) || idx.clusters.find((c) => c.it.includes(itemId));
  if (cluster) {
    S.read[cluster.id] = Math.max(Date.now(), cluster.l);
    store.set('read', S.read);
  }
  const others = (cluster?.it || []).filter((id) => id !== itemId && visible(id));
  S.lastStory = cluster?.id || null;
  const order = ranked();
  const pos = cluster ? order.findIndex((c) => c.id === cluster.id) : -1;
  const prev = pos > 0 ? order[pos - 1] : null;
  const next = pos >= 0 && pos < order.length - 1 ? order[pos + 1] : null;
  const navCard = (c, dir) => {
    if (!c) return '<span></span>';
    const o = idx.items[c.rep];
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
       <a class="pill-btn" href="${esc(it.u)}" target="_blank" rel="noopener noreferrer">Original ${I.ext}</a>`,
    ) +
    `<main class="wrap"><article class="reader${slide ? ' slide-' + slide : ''}">
      <div class="kicker"><span class="src" style="--c:${esc(src.color)}">${esc(src.name)}</span><span>${ago(it.p)}</span>
        ${it.w ? `<span>${Math.max(1, Math.round(it.w / 220))} min čitanja</span>` : ''}<span class="byline"></span></div>
      <h1>${esc(lat(it.t))}</h1>
      <div class="content">${it.x ? '<p class="notice">Učitavam…</p>' : ''}</div>
      ${others.length ? `<section class="also"><h3>Ista vest, drugi izvori</h3><ul class="list">${others
        .map((id) => {
          const o = idx.items[id];
          const os = srcById(o.s);
          return `<li class="card"><a href="#/a/${id}/${cluster.id}"><div class="txt"><div class="meta"><span class="src" style="--c:${esc(os.color)}">${esc(os.name)}</span><span>${ago(o.p)}</span></div><h2>${esc(lat(o.t))}</h2></div>${S.prefs.thumbs !== false ? imgTag(o.i, 'thumb') : ''}</a></li>`;
        })
        .join('')}</ul></section>` : ''}
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
    const a = await decrypt(await getBin(`data/a/${itemId}.bin`));
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
    const first = [...body.children].find((el) => el.textContent.trim() || el.querySelector('img') || el.tagName === 'IMG');
    const opensWithImage = first && (first.tagName === 'IMG' || first.tagName === 'FIGURE' || (!first.textContent.trim() && first.querySelector('img')));
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
        <div class="row"><div class="grow">Slike u listi<div class="hint">Isključi za manju potrošnju podataka</div></div>
          <input type="checkbox" class="switch" data-act="thumbs" ${S.prefs.thumbs !== false ? 'checked' : ''}></div>
        <div class="row"><div class="grow">Sve latinicom<div class="hint">Ćirilične naslove i tekstove prikazuje latinicom</div></div>
          <input type="checkbox" class="switch" data-act="latin" ${S.prefs.latin ? 'checked' : ''}></div>
      </section>

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

      <div class="panel-label">Održavanje</div>
      <section class="panel">
        ${repo ? `<a class="row" href="https://github.com/${esc(repo)}/tree/main/sources" target="_blank" rel="noopener"><div class="grow">Uredi ili ukloni izvore<div class="hint">Fajlovi u folderu sources na GitHubu</div></div>${I.ext}</a>
        <a class="row" href="https://github.com/${esc(repo)}/actions/workflows/update.yml" target="_blank" rel="noopener"><div class="grow">Ažuriraj odmah<div class="hint">Run workflow na GitHub Actions</div></div>${I.ext}</a>` : ''}
        <button class="row" data-act="logout"><div class="grow">Zaboravi lozinku na ovom uređaju</div></button>
      </section>
      <p class="foot">Poslednje ažuriranje: ${new Date(idx.generated).toLocaleString('sr-Latn-RS')}</p>
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
    <h1>Vesti</h1><p>Unesi lozinku (NEWS_KEY) da otključaš vesti na ovom uređaju.</p>
    <label class="field"><span>Lozinka</span><input id="pass" type="password" autocomplete="current-password" required></label>
    <div class="err">${esc(err)}</div>
    <button class="primary" type="submit">Otključaj</button></form></main>`;
  $('#unlock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#unlock button');
    btn.textContent = 'Otključavam…';
    btn.disabled = true;
    await load($('#pass').value);
  });
  $('#pass').focus();
}

/* ---------- next / previous story ---------- */
function goStory(dir) {
  const parts = (location.hash || '').slice(2).split('/');
  if (parts[0] !== 'a') return false;
  const order = ranked();
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
  if (current && h !== current && !S.replacing) S.navs = h === '#/' ? 0 : (S.navs || 0) + 1;
  S.replacing = false;
  if (current === '#/' && h !== '#/') {
    S.listScroll = window.scrollY;
    S.leftFrom = h.split('/')[3] || null;
  }
  current = h;
  const parts = h.slice(2).split('/');
  if (parts[0] === 'a' && parts[1]) return renderArticle(parts[1], parts[2]);
  if (parts[0] === 'settings') return renderSettings();
  renderList();
}
window.addEventListener('hashchange', route);

/* ---------- events ---------- */
app.addEventListener('click', (e) => {
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
      return load();
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
      if (S.navs === 1) {
        e.preventDefault();
        history.back();
      }
      return;
    case 'smaller':
    case 'bigger':
      S.prefs.size = Math.min(24, Math.max(15, S.prefs.size + (t.dataset.act === 'bigger' ? 1 : -1)));
      return savePrefs();
    case 'logout':
      store.del('key');
      store.del('pass');
      S.key = null;
      S.index = null;
      return renderUnlock();
  }
});
app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.act === 'size') {
    S.prefs.size = +t.value;
    savePrefs();
    t.closest('.row').querySelector('.hint').textContent = S.prefs.size + 'px';
  }
});
app.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.act === 'thumbs') {
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

/* ---------- boot ---------- */
applyPrefs();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (!('DecompressionStream' in window) || !crypto.subtle) {
  app.innerHTML = '<p class="empty">Ovaj pregledač je prestar za aplikaciju.</p>';
} else {
  app.innerHTML = '<p class="empty">Učitavam…</p>';
  load();
}
