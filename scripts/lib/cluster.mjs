// Groups items that report the same story across sources.
// TF-IDF over stemmed title + URL slug + lead, greedy chronological clustering against cluster centroids.
// A merge also needs a shared "anchor" (a proper name or a number), so stock phrases like
// "određen pritvor" cannot glue unrelated stories together.

import { tokens, casedTokens, slugWords } from './text.mjs';

function features(item) {
  const f = new Map();
  const add = (toks, w) => {
    for (const t of new Set(toks)) f.set(t, Math.max(f.get(t) || 0, w));
  };
  add(tokens(item.lead).slice(0, 45), 1);
  add(tokens(slugWords(item.url)), 1.5);
  add(tokens(item.title), 2);
  return f;
}

function normalize(vec) {
  let n = 0;
  for (const v of vec.values()) n += v * v;
  n = Math.sqrt(n) || 1;
  const out = new Map();
  for (const [k, v] of vec) out.set(k, v / n);
  return out;
}

function compare(a, b, anchorsA, anchorsB) {
  if (a.size > b.size) [a, b, anchorsA, anchorsB] = [b, a, anchorsB, anchorsA];
  let s = 0;
  let shared = 0;
  let anchored = false;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w) {
      s += v * w;
      shared++;
      if (anchorsA.has(k) || anchorsB.has(k)) anchored = true;
    }
  }
  return { s, shared, anchored };
}

/**
 * @param {Array<{id:string,title:string,lead?:string,url:string,source:string,time:number}>} items
 * @param {{threshold?:number, strongThreshold?:number, windowHours?:number, minShared?:number}} opts
 */
export function clusterItems(items, opts = {}) {
  const threshold = opts.threshold ?? 0.25;
  const strong = opts.strongThreshold ?? 0.5;
  const windowMs = (opts.windowHours ?? 36) * 3600e3;
  const minShared = opts.minShared ?? 2;

  // Words seen lowercase anywhere are common words, even when capitalized at a sentence start.
  const cased = items.map((it) => [...casedTokens(it.title), ...casedTokens(it.lead)]);
  const lowerSeen = new Set();
  for (const list of cased) for (const { t, cap } of list) if (!cap) lowerSeen.add(t);
  const anchors = items.map((it) => {
    const a = new Set();
    for (const { t, cap } of casedTokens(it.title)) {
      if (/^\d{2,4}$/.test(t) || (cap && !lowerSeen.has(t))) a.add(t);
    }
    return a;
  });

  const feats = items.map(features);
  const df = new Map();
  for (const f of feats) for (const k of f.keys()) df.set(k, (df.get(k) || 0) + 1);
  const N = items.length || 1;
  const vecs = feats.map((f) => {
    const v = new Map();
    // Unique tokens stay in the vector: they cannot link items, but they keep the norm honest.
    for (const [k, w] of f) v.set(k, w * Math.log(1 + N / df.get(k)));
    return normalize(v);
  });

  const order = items.map((_, i) => i).sort((a, b) => items[a].time - items[b].time);
  const clusters = [];

  for (const i of order) {
    const v = vecs[i];
    let best = null;
    let bestS = 0;
    if (v.size) {
      for (const c of clusters) {
        if (items[i].time - c.last > windowMs) continue;
        const { s, shared, anchored } = compare(v, c.norm, anchors[i], c.anchors);
        if (shared < minShared || s <= bestS) continue;
        if (s >= strong || (s >= threshold && anchored)) {
          bestS = s;
          best = c;
        }
      }
    }
    if (best) {
      best.members.push(i);
      for (const [k, w] of v) best.sum.set(k, (best.sum.get(k) || 0) + w);
      for (const a of anchors[i]) best.anchors.add(a);
      best.norm = normalize(best.sum);
      best.last = Math.max(best.last, items[i].time);
    } else {
      clusters.push({
        members: [i], sum: new Map(v), norm: v, anchors: new Set(anchors[i]),
        first: items[i].time, last: items[i].time,
      });
    }
  }

  return clusters.map((c) => {
    // Representative: the member closest to the centroid, which tends to be the most neutral headline.
    let rep = c.members[0];
    if (c.members.length > 2) {
      let repS = -1;
      for (const m of c.members) {
        const { s } = compare(vecs[m], c.norm, anchors[m], c.anchors);
        if (s > repS + 1e-9) {
          repS = s;
          rep = m;
        }
      }
    }
    return {
      id: items[c.members[0]].id,
      rep: items[rep].id,
      items: c.members.map((m) => items[m].id),
      sources: new Set(c.members.map((m) => items[m].source)).size,
      first: c.first,
      last: c.last,
    };
  });
}
