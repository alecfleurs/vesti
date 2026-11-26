// "Ukratko": the most covered news stories of the last 24 h, with a short summary each.
// Computed at build time so the app and the (future) voice briefing use exactly the same list and text.

// First sentence or two of a lead, about `max` characters at most.
export function summarize(text, max = 220) {
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

/** Majority category of a cluster, ignoring 'Ostalo' (same rule as the app). */
export function clusterCategory(c, items) {
  const votes = {};
  for (const id of c.items) {
    const k = items.get(id)?.cat || 'Ostalo';
    if (k !== 'Ostalo') votes[k] = (votes[k] || 0) + (id === c.rep ? 1.5 : 1);
  }
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Ostalo';
}

/**
 * @param clusters  [{ id, rep, items, sources, last }]
 * @param items     Map id -> item (title, lead, source, cat)
 * @param threadOf  Map clusterId -> threadId
 * @param hiddenCats Set of categories never included (entertainment, health, promo)
 */
export function buildBrief(clusters, items, threadOf, hiddenCats, opts = {}) {
  const size = opts.size ?? 20;
  const hours = opts.hours ?? 24;
  const halfLife = opts.halfLifeHours ?? 18;
  const now = opts.now ?? Date.now();

  // A developing story counts once: its newest step, ranked by its biggest step.
  const byThread = new Map();
  for (const c of clusters) {
    const th = threadOf.get(c.id);
    if (th) byThread.set(th, [...(byThread.get(th) || []), c]);
  }
  const hidden = new Set();
  const rankSrc = new Map();
  for (const steps of byThread.values()) {
    steps.sort((a, b) => a.last - b.last);
    rankSrc.set(steps.at(-1).id, Math.max(...steps.map((s) => s.sources)));
    for (const s of steps.slice(0, -1)) hidden.add(s.id);
  }

  return clusters
    .filter((c) => !hidden.has(c.id) && now - c.last < hours * 3600e3)
    .filter((c) => !hiddenCats.has(clusterCategory(c, items)))
    .map((c) => {
      const srcs = rankSrc.get(c.id) || c.sources;
      const score = (srcs + 0.25 * (c.items.length - c.sources)) * Math.exp(-(now - c.last) / 3600e3 / halfLife);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, size)
    .map(({ c }) => {
      const rep = items.get(c.rep);
      const leads = c.items.map((id) => items.get(id)?.lead || '').filter(Boolean);
      const lead = rep?.lead && rep.lead.length > 60 ? rep.lead : leads.sort((a, b) => b.length - a.length)[0] || '';
      return { c: c.id, s: summarize(lead) };
    });
}
