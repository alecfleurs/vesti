// Local UI preview: builds an encrypted site (password "test") from scripts/fixtures/headlines.txt with
// synthetic leads, bodies and placeholder pictures. Usage: node scripts/mock-site.mjs . /tmp/vesti-mock
// then serve the folder (python3 -m http.server --directory /tmp/vesti-mock) and open /#k=test.
import { readFileSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const REPO = path.resolve(process.argv[2] || '.');
const OUT = path.resolve(process.argv[3] || '/tmp/vesti-mock');
const lib = (f) => import(pathToFileURL(path.join(REPO, 'scripts/lib', f)).href);
const { clusterItems } = await lib('cluster.mjs');
const { threadClusters } = await lib('threads.mjs');
const { buildBrief } = await lib('brief.mjs');
const { deriveKey, encryptJson, randomSalt, ITERATIONS } = await lib('crypto.mjs');

const config = JSON.parse(readFileSync(path.join(REPO, 'config.json'), 'utf8'));
const lines = readFileSync(path.join(REPO, 'scripts/fixtures/headlines.txt'), 'utf8').trim().split('\n');
const times = lines.map((l) => Date.parse(l.split('|')[1]));
const shift = Date.now() - 10 * 60e3 - Math.max(...times);
const catOf = (u) => /sport/.test(u) ? 'Sport' : /svet|world/.test(u) ? 'Svet' : /ekonom|biz/.test(u) ? 'Ekonomija' : /hronika|crna/.test(u) ? 'Hronika' : /politi/.test(u) ? 'Politika' : /kultur/.test(u) ? 'Kultura' : 'Srbija';
const hues = [12, 200, 140, 280, 35, 330, 90, 240];
rmSync(OUT, { recursive: true, force: true });
cpSync(path.join(REPO, 'public'), OUT, { recursive: true });
mkdirSync(path.join(OUT, 'data/a'), { recursive: true });
mkdirSync(path.join(OUT, 'img'), { recursive: true });
const items = lines.map((l, i) => {
  const [source, ts, title, url] = l.split('|');
  const img = i % 3 === 2 ? '' : `img/p${i}.svg`;
  if (img) {
    const h = hues[i % hues.length];
    writeFileSync(path.join(OUT, img), `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},45%,55%)"/><stop offset="1" stop-color="hsl(${h + 40},40%,30%)"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><circle cx="${300 + (i * 97) % 600}" cy="300" r="180" fill="rgba(255,255,255,.15)"/></svg>`);
  }
  return { id: `${source}-${i}`, source, time: Date.parse(ts) + shift, title, url, image: img, cat: catOf(url),
    lead: `${title}. Prema navodima izvora, događaj je izazvao brojne reakcije u javnosti, a nadležni su najavili nove informacije tokom dana.` };
});
const clusters = clusterItems(items, config.cluster || {}).sort((a, b) => b.last - a.last);
const itemMap = new Map(items.map((it) => [it.id, it]));
const { threadOf } = threadClusters(itemMap, clusters, config.threads || {});
const cats = config.categories || [];
const brief = buildBrief(clusters, itemMap, threadOf, new Set(cats.filter((r) => r.group).map((r) => r.name)), config.brief || {});
const srcIds = [...new Set(items.map((i) => i.source))];
const srcConf = (id) => { try { return JSON.parse(readFileSync(path.join(REPO, 'sources', id + '.json'), 'utf8')); } catch { return { name: id }; } };
const salt = randomSalt();
const key = await deriveKey('test', salt, ITERATIONS);
const index = {
  v: 1, generated: Date.now(), title: 'Vesti', repo: '',
  categories: cats.map((r) => r.name).concat('Ostalo'),
  groups: Object.fromEntries(cats.filter((r) => r.group).map((r) => [r.name, r.group])),
  brief, dispatch: '',
  sources: srcIds.map((id) => { const s = srcConf(id); return { id, name: s.name, home: s.home || '', color: s.color || '' }; }),
  items: Object.fromEntries(items.map((it) => [it.id, { s: it.source, t: it.title, u: it.url, p: it.time, l: it.lead, i: it.image, h: '', c: it.cat, x: 1, w: 420 }])),
  clusters: clusters.map((c) => ({ id: c.id, r: c.rep, it: c.items, n: c.sources, f: c.first, l: c.last, ...(threadOf.has(c.id) ? { th: threadOf.get(c.id) } : {}) })),
};
writeFileSync(path.join(OUT, 'data/index.bin'), await encryptJson(key, index));
const para = 'Tokom prepodneva stigle su nove informacije o ovom slučaju. Sagovornici sa kojima smo razgovarali kažu da je situacija i dalje neizvesna, ali da očekuju da se do kraja nedelje stvari razjasne. Nadležne institucije za sada nisu izdale zvanično saopštenje.';
for (const it of items) {
  const html = `<p>${it.lead}</p><p>${para}</p><h2>Reakcije</h2><p>${para}</p><blockquote>„Ovo je pitanje od javnog interesa i očekujemo odgovore", rekao je jedan od sagovornika.</blockquote><p>${para}</p>`;
  writeFileSync(path.join(OUT, `data/a/${it.id}.bin`), await encryptJson(key, { html, byline: 'Redakcija', image: it.image }));
}
writeFileSync(path.join(OUT, 'data/meta.json'), JSON.stringify({ v: 1, salt, iter: ITERATIONS, generated: Date.now() }));
console.log(`items ${items.length}, clusters ${clusters.length}, threads ${new Set(threadOf.values()).size}, brief ${brief.length}`);
