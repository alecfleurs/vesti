// Calibration test on real headlines from 24-25 Nov 2026 (titles + URLs only, no leads: the harder case).
import { clusterItems } from './lib/cluster.mjs';

import { readFileSync } from 'node:fs';
const raw = readFileSync(new URL('./fixtures/headlines.txt', import.meta.url), 'utf8');

const items = raw.trim().split('\n').map((l, i) => {
  const [source, ts, title, url] = l.split('|');
  return { id: `${source}-${i}`, source, time: Date.parse(ts), title, url };
});

// Pairs that are the same story and SHOULD merge (by id-substring title match).
const SHOULD = [
  ['Pavlu Bihaliju', 'Određen pritvor Bihaliju'],
  ['Pavlu Bihaliju', 'Одређен притвор Павлу'],
  ['Tragedija u Egiptu', 'Jeziva eksplozija kod Kaira'],
  ['Uhapšeno troje rukovodilaca', 'Uhapšeno rukovodstvo MSK'],
  ['Čupić sutra raspisuje', 'Čupić raspisuje predsedničke'],
  ['Čupić sutra raspisuje', 'Чупић сутра'],
  ['Vojska SAD detonirala', 'Eksplozija u fabrici municije'],
  ['Pucnjava u školi u Kragujevcu', 'Stručnjaci o pucnjavi'],
];
// Pairs that look alike but are different stories and SHOULD NOT merge.
const SHOULDNT = [
  ['Bratu vlasnika Alta banke', 'Određen pritvor Bihaliju'],
  ['Volkovu određen', 'Određen pritvor Bihaliju'],
  ['Tragedija u Egiptu', 'Snažne eksplozije odjeknule'],
];

const byTitle = (s) => items.find((x) => x.title.startsWith(s))?.id;

function run(opts, verbose) {
  const clusters = clusterItems(items, opts);
  const where = new Map();
  clusters.forEach((c, ci) => c.items.forEach((id) => where.set(id, ci)));
  const same = ([a, b]) => where.get(byTitle(a)) === where.get(byTitle(b));
  const hit = SHOULD.filter(same).length;
  const bad = SHOULDNT.filter(same).length;
  if (verbose) {
    for (const p of SHOULD) if (!same(p)) console.log('  MISSED  ', p.join('  <>  '));
    for (const p of SHOULDNT) if (same(p)) console.log('  WRONG   ', p.join('  <>  '));
    console.log('\n  Multi-item clusters:');
    for (const c of clusters.filter((c) => c.items.length > 1)) {
      console.log(`  [${c.sources} src] ` + c.items.map((id) => {
        const it = items.find((x) => x.id === id);
        return `${it.source}: ${it.title.slice(0, 55)}`;
      }).join('\n           '));
    }
  }
  return { hit, bad, clusters: clusters.length };
}

console.log('threshold  merged/' + SHOULD.length + '  false/' + SHOULDNT.length + '  clusters');
for (const t of [0.15, 0.2, 0.25, 0.3, 0.35, 0.4]) {
  const r = run({ threshold: t });
  console.log(`  ${t.toFixed(2)}       ${r.hit}          ${r.bad}        ${r.clusters}`);
}
const T = Number(process.argv[2] || 0.25);
console.log(`\nDetail at threshold ${T}:`);
const r = run({ threshold: T }, true);
if (r.bad > 0 || r.hit < SHOULD.length - 1) process.exitCode = 1;
