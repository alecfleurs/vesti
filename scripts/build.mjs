// Fetch all sources, extract full text, cluster duplicates, write the encrypted site to dist/.
// State between runs lives in .cache/ (restored by actions/cache in CI).
//
//   NEWS_KEY=... node scripts/build.mjs

import { readFile, writeFile, mkdir, readdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { loadSource } from './lib/feeds.mjs';
import { clusterItems } from './lib/cluster.mjs';
import { deriveKey, encryptJson, randomSalt, ITERATIONS } from './lib/crypto.mjs';
import { truncate, fold } from './lib/text.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache');
const ART = path.join(CACHE, 'articles');
const DIST = path.join(ROOT, 'dist');
const now = Date.now();
const log = (...a) => console.log(...a);

const key = process.env.NEWS_KEY;
if (!key || key.length < 8) {
  console.error('NEWS_KEY is missing or shorter than 8 characters. Add it under Settings > Secrets and variables > Actions.');
  process.exit(1);
}

const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
const globalExclude = (config.exclude || []).map((r) => new RegExp(r, 'i'));
const catRules = (config.categories || []).map((c) => ({ name: c.name, re: new RegExp(c.match, 'i'), weak: !!c.weak }));
const slug = (t) => '/' + fold(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '/';
// URL section first, then the feed's own category tags, then the source default.
function categorize(it, src) {
  let path = '';
  try {
    path = new URL(it.url).pathname.toLowerCase();
  } catch {}
  // A "weak" rule (generic sections like /vesti/) loses to a specific signal or the source default.
  let weak = null;
  for (const r of catRules) {
    if (!r.re.test(path)) continue;
    if (!r.weak) return r.name;
    weak = r.name;
    break;
  }
  let weakTag = null;
  for (const c of [it.section, ...(it.cats || [])].filter(Boolean)) {
    for (const r of catRules) {
      if (!r.re.test(slug(c))) continue;
      if (!r.weak) return r.name;
      weakTag ||= r.name;
    }
  }
  return src?.category || weak || weakTag || 'Ostalo';
}

// ---------- sources ----------
const sources = [];
for (const f of (await readdir(path.join(ROOT, 'sources'))).filter((f) => f.endsWith('.json')).sort()) {
  try {
    const s = JSON.parse(await readFile(path.join(ROOT, 'sources', f), 'utf8'));
    if (s.enabled === false) continue;
    s.id = f.replace(/\.json$/, '');
    s.name ||= s.id;
    if (!s.home && !s.feeds?.length) throw new Error('needs "home" or "feeds"');
    s.exclude = (s.exclude || []).map((r) => new RegExp(r, 'i'));
    sources.push(s);
  } catch (e) {
    log(`! sources/${f}: ${e.message}`);
  }
}
const order = (config.sourceOrder || []).concat(sources.map((s) => s.id));
sources.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

// ---------- state ----------
await mkdir(ART, { recursive: true });
let state = { salt: randomSalt(), items: {}, sources: {} };
try {
  state = JSON.parse(await readFile(path.join(CACHE, 'state.json'), 'utf8'));
  log(`state: ${Object.keys(state.items).length} items cached`);
} catch {
  log('state: starting fresh');
}

function canonical(u) {
  const url = new URL(u);
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|ref|amp)/i.test(k)) url.searchParams.delete(k);
  }
  url.hostname = url.hostname.toLowerCase();
  return url.href;
}
const idOf = (u) => createHash('sha1').update(u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')).digest('hex').slice(0, 12);
const itemTime = (it) => Math.min(it.published ?? it.firstSeen, now);

// ---------- 1. fetch feeds ----------
const maxPerSource = config.maxItemsPerSource ?? 80;
await Promise.all(
  sources.map(async (src) => {
    const t0 = Date.now();
    const res = await loadSource(src, log);
    let added = 0;
    let kept = 0;
    // Newest first across all of the source's feeds, then cap.
    const fresh = [...res.items].sort((a, b) => (b.time || 0) - (a.time || 0));
    for (const raw of fresh.slice(0, src.maxItems || maxPerSource)) {
      let url;
      try {
        url = canonical(raw.url);
      } catch {
        continue;
      }
      const p = new URL(url).pathname;
      if (src.exclude.some((r) => r.test(url)) || globalExclude.some((r) => r.test(p))) continue;
      if (raw.time && raw.time < now - config.retainHours * 3600e3) continue;
      kept++;
      const id = idOf(url);
      const prev = state.items[id];
      if (prev) {
        prev.title = raw.title || prev.title;
        if (raw.lead) prev.lead = raw.lead;
        if (raw.image) prev.image = raw.image;
        if (raw.cats?.length) prev.cats = raw.cats;
        continue;
      }
      state.items[id] = {
        id, source: src.id, url, title: raw.title, lead: raw.lead || '', image: raw.image || '',
        published: raw.time, firstSeen: now, cats: raw.cats || [],
      };
      added++;
    }
    state.sources[src.id] = {
      mode: res.mode, feeds: res.feeds, count: kept, error: res.error || '', checked: now,
      ok: res.mode !== 'failed' ? now : state.sources[src.id]?.ok || 0,
    };
    log(`${src.id.padEnd(12)} ${res.mode.padEnd(14)} ${String(kept).padStart(3)} items, ${added} new  (${Date.now() - t0} ms)${res.error ? '  ' + res.error : ''}`);
  }),
);

// ---------- 2. prune ----------
const active = new Set(sources.map((s) => s.id));
let pruned = 0;
for (const [id, it] of Object.entries(state.items)) {
  const src = sources.find((x) => x.id === it.source);
  const path = (() => {
    try {
      return new URL(it.url).pathname;
    } catch {
      return '';
    }
  })();
  const excluded = src && (src.exclude.some((r) => r.test(it.url)) || globalExclude.some((r) => r.test(path)));
  if (!active.has(it.source) || excluded || itemTime(it) < now - config.retainHours * 3600e3) {
    delete state.items[id];
    await rm(path.join(ART, `${id}.json`), { force: true });
    pruned++;
  }
}
for (const id of Object.keys(state.sources)) if (!active.has(id)) delete state.sources[id];
log(`pruned ${pruned}`);

// ---------- 3. extract full text ----------
let extractArticle = null;
let EV = 0;
try {
  ({ extractArticle, EXTRACT_VERSION: EV } = await import('./lib/extract.mjs'));
} catch (e) {
  log(`! extraction disabled (${e.code || e.message}); run npm install`);
}
if (extractArticle) {
  const due = Object.values(state.items)
    // Missing bodies first, then bodies made by an older version of the cleaner.
    .filter((it) => (!it.x || it.ev !== EV) && itemTime(it) > now - config.extractHours * 3600e3)
    .filter((it) => !it.fail || (it.fail < 3 && now - it.lastTry > 2 * 3600e3))
    .sort((a, b) => (a.x ? 1 : 0) - (b.x ? 1 : 0) || itemTime(b) - itemTime(a))
    .slice(0, config.maxExtractPerRun ?? 150);
  const bySource = new Map();
  for (const it of due) bySource.set(it.source, [...(bySource.get(it.source) || []), it]);
  let ok = 0;
  let bad = 0;
  await Promise.all(
    [...bySource.values()].map(async (list) => {
      for (const it of list) {
        it.lastTry = now;
        try {
          const a = await extractArticle(it.url);
          await writeFile(path.join(ART, `${it.id}.json`), JSON.stringify(a));
          it.x = 1;
          it.ev = EV;
          it.words = a.words;
          if (!it.lead && a.excerpt) it.lead = a.excerpt;
          if (a.image) it.hi = a.image;
          if (a.section) it.section = a.section;
          if (!it.image && a.image) it.image = a.image;
          if (!it.published && a.published) it.published = a.published;
          delete it.fail;
          ok++;
        } catch (e) {
          it.fail = (it.fail || 0) + 1;
          it.err = String(e.message).slice(0, 120);
          bad++;
        }
      }
    }),
  );
  log(`extracted ${ok}, failed ${bad}, queued ${due.length}`);
}

// ---------- 4. categorize + cluster ----------
const srcMap = Object.fromEntries(sources.map((s) => [s.id, s]));
const catLog = {};
for (const it of Object.values(state.items)) {
  it.cat = categorize(it, srcMap[it.source]);
  const l = (catLog[it.source] ||= { counts: {}, other: [] });
  l.counts[it.cat] = (l.counts[it.cat] || 0) + 1;
  if (it.cat === 'Ostalo' && l.other.length < 3) l.other.push(new URL(it.url).pathname.slice(0, 70) + ([it.section, ...(it.cats || [])].filter(Boolean).length ? ` [${[it.section, ...(it.cats || [])].filter(Boolean).join(', ')}]` : ''));
}
for (const [id, l] of Object.entries(catLog)) {
  log(`cat ${id.padEnd(10)} ${Object.entries(l.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  for (const o of l.other) log(`    ostalo: ${o}`);
}

const all = Object.values(state.items).map((it) => ({ ...it, time: itemTime(it) }));
const clusters = clusterItems(all, config.cluster || {}).sort((a, b) => b.last - a.last);
log(`clusters: ${clusters.length} from ${all.length} items (${clusters.filter((c) => c.sources > 1).length} multi-source)`);

// ---------- 5. write site ----------
await rm(DIST, { recursive: true, force: true });
await cp(path.join(ROOT, 'public'), DIST, { recursive: true });
await mkdir(path.join(DIST, 'data', 'a'), { recursive: true });
await writeFile(path.join(DIST, '.nojekyll'), '');

const cryptoKey = await deriveKey(key, state.salt, ITERATIONS);
const index = {
  v: 1,
  generated: now,
  title: config.title || 'Vesti',
  repo: process.env.GITHUB_REPOSITORY || config.repo || '',
  categories: catRules.map((r) => r.name).concat('Ostalo'),
  sources: sources.map((s) => ({
    id: s.id, name: s.name, home: s.home || '', color: s.color || '', ...state.sources[s.id],
  })),
  items: Object.fromEntries(
    all.map((it) => [it.id, {
      s: it.source, t: it.title, u: it.url, p: it.time, l: truncate(it.lead, 260), i: it.image || '', h: it.hi || '', c: it.cat,
      x: it.x ? 1 : 0, w: it.words || 0,
    }]),
  ),
  clusters: clusters.map((c) => ({ id: c.id, r: c.rep, it: c.items, n: c.sources, f: c.first, l: c.last })),
};
await writeFile(path.join(DIST, 'data', 'index.bin'), await encryptJson(cryptoKey, index));

let bodies = 0;
for (const it of all) {
  if (!it.x) continue;
  try {
    const a = JSON.parse(await readFile(path.join(ART, `${it.id}.json`), 'utf8'));
    await writeFile(path.join(DIST, 'data', 'a', `${it.id}.bin`), await encryptJson(cryptoKey, a));
    bodies++;
  } catch {
    it.x = 0;
    delete state.items[it.id].x;
  }
}
await writeFile(
  path.join(DIST, 'data', 'meta.json'),
  JSON.stringify({ v: 1, salt: state.salt, iter: ITERATIONS, generated: now }),
);
await writeFile(path.join(CACHE, 'state.json'), JSON.stringify(state));
log(`wrote dist: index + ${bodies} articles`);

if (sources.length && sources.every((s) => state.sources[s.id]?.mode === 'failed')) {
  console.error('Every source failed. Network problem?');
  process.exit(1);
}
