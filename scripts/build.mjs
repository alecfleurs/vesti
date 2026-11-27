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
import { threadClusters } from './lib/threads.mjs';
import { buildBrief } from './lib/brief.mjs';
import { deriveKey, encryptJson, randomSalt, ITERATIONS } from './lib/crypto.mjs';
import { truncate, fold } from './lib/text.mjs';
import { findProblems, syncIssues } from './lib/health.mjs';
import { publishBulletin } from './lib/bulletin-store.mjs';

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
const promoTitles = (config.promoTitles || []).map((r) => new RegExp(r, 'i'));
const catRules = (config.categories || []).map((c) => ({ name: c.name, re: new RegExp(c.match, 'i'), weak: !!c.weak, group: c.group || '' }));
const optionalCats = new Set(catRules.filter((r) => r.group).map((r) => r.name)); // hidden unless switched on in the app
const slug = (t) => '/' + fold(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '/';
// URL section first, then the feed's own category tags, then the source default.
function categorize(it, src) {
  let path = '';
  try {
    path = new URL(it.url).pathname.toLowerCase();
  } catch {}
  if (promoTitles.some((r) => r.test(it.title) || r.test(fold(it.title)))) return 'Promo';
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
      if (raw.time && raw.time < now - (src.retainHours || config.retainHours) * 3600e3) continue;
      kept++;
      const id = idOf(url);
      const prev = state.items[id];
      if (prev) {
        prev.title = raw.title || prev.title;
        if (raw.lead) prev.lead = raw.lead;
        if (raw.image) prev.image = raw.image;
        if (raw.cats?.length) prev.cats = raw.cats;
        if (raw.full && !prev.x) prev.full = raw.full;
        continue;
      }
      state.items[id] = {
        id, source: src.id, url, title: raw.title, lead: raw.lead || '', image: raw.image || '',
        published: raw.time, firstSeen: now, cats: raw.cats || [],
        ...(raw.full ? { full: raw.full } : {}),
      };
      added++;
    }
    state.sources[src.id] = {
      mode: res.mode, feeds: res.feeds, count: kept, error: res.error || '', checked: now,
      ok: res.mode !== 'failed' ? now : state.sources[src.id]?.ok || 0,
      since: state.sources[src.id]?.since || now,
    };
    log(`${src.id.padEnd(12)} ${res.mode.padEnd(14)} ${String(kept).padStart(3)} items, ${added} new  (${Date.now() - t0} ms)${res.error ? '  ' + res.error : ''}`);
  }),
);

// ---------- 2. prune ----------
const active = new Set(sources.map((s) => s.id));
let pruned = 0;
for (const [id, it] of Object.entries(state.items)) {
  const src = sources.find((x) => x.id === it.source);
  const urlPath = (() => {
    try {
      return new URL(it.url).pathname;
    } catch {
      return '';
    }
  })();
  const excluded = src && (src.exclude.some((r) => r.test(it.url)) || globalExclude.some((r) => r.test(urlPath)));
  if (!active.has(it.source) || excluded || itemTime(it) < now - (src?.retainHours || config.retainHours) * 3600e3) {
    delete state.items[id];
    await rm(path.join(ART, `${id}.json`), { force: true });
    pruned++;
  }
}
for (const id of Object.keys(state.sources)) if (!active.has(id)) delete state.sources[id];
log(`pruned ${pruned}`);

// ---------- 3. extract full text ----------
let extractArticle = null;
let articleFromFeed = null;
let EV = 0;
try {
  ({ extractArticle, articleFromFeed, EXTRACT_VERSION: EV } = await import('./lib/extract.mjs'));
} catch (e) {
  log(`! extraction disabled (${e.code || e.message}); run npm install`);
}
if (extractArticle) {
  for (const it of Object.values(state.items)) {
    if (!it.x && /HTTP (429|503)/.test(it.err || '')) {
      delete it.fail;
      delete it.err;
    }
  }
  const due = Object.values(state.items)
    // Missing bodies first, then bodies made by an older version of the cleaner.
    .filter((it) => {
      const hours = Math.max(config.extractHours, sources.find((x) => x.id === it.source)?.retainHours || 0);
      if (sources.find((x) => x.id === it.source)?.extract === false) return false; // headlines-only source
      return (!it.x || it.ev !== EV) && itemTime(it) > now - hours * 3600e3;
    })
    .filter((it) => !it.fail || (it.full && it.fail < 4) || (it.fail < 3 && now - it.lastTry > 2 * 3600e3))
    .sort((a, b) => (a.x ? 1 : 0) - (b.x ? 1 : 0) || itemTime(b) - itemTime(a))
    .slice(0, config.maxExtractPerRun ?? 150);
  const bySource = new Map();
  for (const it of due) bySource.set(it.source, [...(bySource.get(it.source) || []), it]);
  let ok = 0;
  let bad = 0;
  const failures = {};
  let fromFeed = 0;
  await Promise.all(
    [...bySource.values()].map(async (list) => {
      for (const it of list) {
        it.lastTry = now;
        try {
          let a;
          try {
            a = await extractArticle(it.url);
          } catch (e) {
            if (!it.full) throw e;
            a = articleFromFeed(it.full, it.url); // page blocked or broken: use the feed's full text
            fromFeed++;
          }
          delete it.full;
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
          // Throttled: stop hitting this site for this run; the items retry next run without a strike.
          if (/HTTP (429|503)/.test(e.message)) {
            const k = `${it.source}: throttled (${e.message}), backing off`;
            failures[k] = (failures[k] || 0) + 1;
            delete it.lastTry;
            break;
          }
          it.fail = (it.fail || 0) + 1;
          it.err = String(e.message).slice(0, 120);
          const k = `${it.source}: ${it.err.replace(/\d{4,}/g, 'N').slice(0, 60)}`;
          failures[k] = (failures[k] || 0) + 1;
          bad++;
        }
        await new Promise((r) => setTimeout(r, config.politeDelayMs ?? 400)); // be gentle with each site
      }
    }),
  );
  log(`extracted ${ok} (${fromFeed} from feed text), failed ${bad}, queued ${due.length}`);
  for (const [k, n] of Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 8)) log(`    fail x${n} ${k}`);
  const pending = {};
  for (const it of Object.values(state.items)) {
    if (it.x || !it.fail) continue;
    const k = `${it.source}: ${String(it.err).replace(/\d{4,}/g, 'N').slice(0, 60)}`;
    pending[k] = (pending[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(pending).sort((a, b) => b[1] - a[1]).slice(0, 8)) log(`    without text x${n} ${k}`);
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
// Developing stories: link same-story clusters over a few days into threads.
const itemMap = new Map(all.map((it) => [it.id, it]));
const { threadOf, threads } = threadClusters(itemMap, clusters, config.threads || {});
{
  const repTitle = (cid) => itemMap.get(clusters.find((c) => c.id === cid).rep).title.slice(0, 80);
  log(`threads: ${threads.size} developing stories linking ${[...threads.values()].reduce((n, t) => n + t.length, 0)} clusters`);
  for (const ids of [...threads.values()].sort((a, b) => b.length - a.length).slice(0, 12)) {
    log(`  ${ids.length}× ${ids.map(repTitle).join('  →  ')}`.slice(0, 400));
  }
}
log(`clusters: ${clusters.length} from ${all.length} items (${clusters.filter((c) => c.sources > 1).length} multi-source)`);

const brief = buildBrief(
  clusters.map((c) => ({ ...c, rep: c.rep })),
  itemMap,
  threadOf,
  optionalCats,
  config.brief || {},
);
log(`ukratko: ${brief.length} stories`);

// ---------- 5. write site ----------
await rm(DIST, { recursive: true, force: true });
await cp(path.join(ROOT, 'public'), DIST, { recursive: true });
{
  // Stamp the build into the app (commit + date) for the About section.
  const sha = (process.env.GITHUB_SHA || '').slice(0, 7) || 'local';
  const stamp = `${sha} · ${new Date().toLocaleDateString('sr-Latn-RS', { timeZone: 'Europe/Belgrade' })}`;
  const appJs = path.join(DIST, 'app.js');
  await writeFile(appJs, (await readFile(appJs, 'utf8')).replace("'__BUILD__'", JSON.stringify(stamp)));
}
await mkdir(path.join(DIST, 'data', 'a'), { recursive: true });
await writeFile(path.join(DIST, '.nojekyll'), '');

const cryptoKey = await deriveKey(key, state.salt, ITERATIONS);
const index = {
  v: 1,
  generated: now,
  title: config.title || 'Vesti',
  repo: process.env.GITHUB_REPOSITORY || config.repo || '',
  categories: catRules.map((r) => r.name).concat('Ostalo'),
  groups: Object.fromEntries(catRules.filter((r) => r.group).map((r) => [r.name, r.group])),
  brief,
  // Token that may only start update.yml; lives inside the encrypted index, so only password holders get it.
  dispatch: process.env.DISPATCH_TOKEN || '',
  sources: sources.map((s) => ({
    id: s.id, name: s.name, home: s.home || '', color: s.color || '', ...state.sources[s.id],
  })),
  items: Object.fromEntries(
    all.map((it) => [it.id, {
      s: it.source, t: it.title, u: it.url, p: it.time, l: truncate(it.lead, 260), i: it.image || '', h: it.hi || '', c: it.cat,
      x: it.x ? 1 : 0, w: it.words || 0,
    }]),
  ),
  clusters: clusters.map((c) => ({ id: c.id, r: c.rep, it: c.items, n: c.sources, f: c.first, l: c.last, ...(threadOf.has(c.id) ? { th: threadOf.get(c.id) } : {}) })),
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
const bul = await publishBulletin(CACHE, DIST, state.salt);
if (bul) log(`bulletin: ${bul.id || '-'}${bul.error ? ` (last attempt failed: ${bul.error})` : ''}`);

await syncIssues(findProblems(sources, state, now), log);

if (sources.length && sources.every((s) => state.sources[s.id]?.mode === 'failed')) {
  console.error('Every source failed. Network problem?');
  process.exit(1);
}
