// Calibration for developing-story threads on real headlines (24-25 Nov 2026).
import { readFileSync } from 'node:fs';
import { clusterItems } from './lib/cluster.mjs';
import { threadClusters } from './lib/threads.mjs';

const items = readFileSync(new URL('./fixtures/headlines.txt', import.meta.url), 'utf8').trim().split('\n').map((l, i) => {
  const [source, ts, title, url] = l.split('|');
  return { id: `${source}-${i}`, source, time: Date.parse(ts), title, url, lead: '' };
});
const clusters = clusterItems(items, { threshold: 0.25 });
const byId = new Map(items.map((i) => [i.id, i]));
const T = Number(process.argv[2] || 0.16);
const { threads, debug } = threadClusters(byId, clusters, { threshold: T });
const title = (cid) => byId.get(clusters.find((c) => c.id === cid).rep).title.slice(0, 70);
const tOf = new Map();
for (const [tid, ids] of threads) for (const id of ids) tOf.set(id, tid);
const cOf = (prefix) => clusters.find((c) => c.items.some((id) => byId.get(id).title.startsWith(prefix)))?.id;
const sameThread = (a, b) => { const x = tOf.get(cOf(a)); return !!x && x === tOf.get(cOf(b)); };

console.log(`threshold ${T}: ${threads.size} threads`);
for (const [tid, ids] of threads) console.log('  THREAD\n' + ids.map((id) => '    - ' + title(id)).join('\n'));
const SHOULD = [
  ['Uhapšen Pavle Bihali', 'Određen pritvor Bihaliju'],
  ['Pucnjava u školi u Kragujevcu', 'Sutra izmenjena nastava'],
  ['Priveden Dragan J. Vučićević', 'Novi skup podrške uhapšenom Draganu'],
];
const SHOULDNT = [
  ['Određen pritvor Bihaliju', 'Volkovu određen'],
  ['Priveden Dragan J. Vučićević', 'Krivična prijava protiv Vučića'],
  ['Čupić sutra raspisuje', 'Selaković i Mesarović'],
];
let bad = 0;
for (const p of SHOULD) if (!sameThread(...p)) console.log('  MISSED', p.join(' <> '));
for (const p of SHOULDNT) if (sameThread(...p)) (bad++, console.log('  WRONG ', p.join(' <> ')));
if (bad) process.exitCode = 1;
