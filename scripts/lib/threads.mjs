// Developing stories: links same-story clusters that follow each other over several days
// ("uhapšen X" → "određen pritvor X" → "optužnica protiv X") into one thread.
// A link needs a RARE shared name (appears in few clusters, so "Vučić" or "Beograd" can't chain things)
// plus overlapping vocabulary with the thread so far.

import { tokens, casedTokens, slugWords } from './text.mjs';

function normalize(vec) {
  let n = 0;
  for (const v of vec.values()) n += v * v;
  n = Math.sqrt(n) || 1;
  const out = new Map();
  for (const [k, v] of vec) out.set(k, v / n);
  return out;
}

function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w) s += v * w;
  }
  return s;
}

/**
 * @param items   Map id -> { title, lead, url, time }
 * @param clusters [{ id, items: [ids], first, last }]
 * @returns { threadOf: Map clusterId -> threadId, threads: Map threadId -> [clusterIds by time], debug: [] }
 */
export function threadClusters(items, clusters, opts = {}) {
  const windowMs = (opts.windowHours ?? 72) * 3600e3;
  const threshold = opts.threshold ?? 0.15;
  const maxSize = opts.maxSize ?? 8;

  // Words ever seen lowercase are ordinary words, not names.
  const lowerSeen = new Set();
  for (const it of items.values()) for (const { t, cap } of [...casedTokens(it.title), ...casedTokens(it.lead)]) if (!cap) lowerSeen.add(t);

  const info = clusters.map((c) => {
    const tf = new Map();
    const names = new Set();
    for (const id of c.items) {
      const it = items.get(id);
      if (!it) continue;
      const add = (toks, w) => {
        for (const t of new Set(toks)) tf.set(t, (tf.get(t) || 0) + w);
      };
      add(tokens(it.title), 2);
      add(tokens(slugWords(it.url)), 1.5);
      add(tokens(it.lead).slice(0, 45), 1);
      for (const { t, cap } of casedTokens(it.title)) if (cap && !lowerSeen.has(t) && t.length >= 4) names.add(t);
    }
    return { c, tf, names };
  });

  // Cluster frequency of names and of all terms.
  const cf = new Map();
  const df = new Map();
  for (const x of info) {
    for (const n of x.names) cf.set(n, (cf.get(n) || 0) + 1);
    for (const k of x.tf.keys()) df.set(k, (df.get(k) || 0) + 1);
  }
  const N = info.length || 1;
  const rareMax = Math.max(6, Math.round(N * 0.012));
  for (const x of info) {
    const v = new Map();
    for (const [k, w] of x.tf) v.set(k, w * Math.log(1 + N / df.get(k)));
    x.vec = normalize(v);
    x.rare = new Set([...x.names].filter((n) => cf.get(n) >= 2 && cf.get(n) <= rareMax));
  }

  info.sort((a, b) => a.c.first - b.c.first);
  const threads = [];
  const debug = [];
  for (const x of info) {
    const fits = [];
    if (x.rare.size) {
      for (const t of threads) {
        if (t.dead || x.c.first - t.last > windowMs) continue;
        const shared = [...x.rare].filter((n) => t.rare.has(n));
        if (!shared.length) continue;
        const s = cosine(x.vec, t.norm);
        if (s >= threshold) fits.push({ t, s, shared });
      }
    }
    fits.sort((a, b) => b.s - a.s);
    let best = fits[0]?.t || null;
    const bestS = fits[0]?.s || 0;
    const bestShared = fits[0]?.shared || null;
    if (best && best.members.length >= maxSize) best = null;
    // The new step fits several threads: they are the same story told from different angles, merge them.
    if (best) {
      for (const { t } of fits.slice(1)) {
        if (best.members.length + t.members.length >= maxSize) continue;
        best.members.push(...t.members);
        for (const [k, w] of t.sum) best.sum.set(k, (best.sum.get(k) || 0) + w);
        for (const n of t.rare) best.rare.add(n);
        best.last = Math.max(best.last, t.last);
        t.dead = true;
        debug.push({ merged: t.id, into: best.id });
      }
    }
    if (best) {
      best.members.push(x);
      for (const [k, w] of x.vec) best.sum.set(k, (best.sum.get(k) || 0) + w);
      best.norm = normalize(best.sum);
      for (const n of x.rare) best.rare.add(n);
      best.last = Math.max(best.last, x.c.last);
      debug.push({ joined: x.c.id, thread: best.id, s: +bestS.toFixed(2), via: bestShared });
    } else {
      threads.push({ id: x.c.id, members: [x], sum: new Map(x.vec), norm: x.vec, rare: new Set(x.rare), last: x.c.last });
    }
  }

  const threadOf = new Map();
  const out = new Map();
  for (const t of threads) {
    if (t.dead || t.members.length < 2) continue;
    const ids = t.members.sort((a, b) => a.c.last - b.c.last).map((m) => m.c.id);
    out.set(t.id, ids);
    for (const id of ids) threadOf.set(id, t.id);
  }
  return { threadOf, threads: out, debug };
}
