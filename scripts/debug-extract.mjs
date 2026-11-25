// Prints what the reader view would show for the newest articles of each source.
//   node scripts/debug-extract.mjs [perSource=2] [sourceId]
import { readFile, readdir } from 'node:fs/promises';
import { loadSource } from './lib/feeds.mjs';
import { extractArticle } from './lib/extract.mjs';

const per = Number(process.argv[2] || 2);
const only = process.argv[3];
for (const f of (await readdir('sources')).filter((f) => f.endsWith('.json'))) {
  const id = f.replace('.json', '');
  if (only && id !== only) continue;
  const src = JSON.parse(await readFile(`sources/${f}`, 'utf8'));
  const { items } = await loadSource(src);
  for (const it of items.filter((i) => !/\/(english|sport|video)\//.test(i.url)).slice(0, per)) {
    console.log(`\n=== ${id}: ${it.title}\n    ${it.url}`);
    try {
      const a = await extractArticle(it.url);
      const outline = a.html
        .replace(/<img[^>]*src="([^"]+)"[^>]*>/g, (_, s) => `\n[IMG ${s.split('/').pop().slice(0, 50)}]\n`)
        .replace(/<\/(p|h\d|li|blockquote|figcaption)>/g, '\n')
        .replace(/<(h\d)>/g, '\n## ').replace(/<li>/g, ' - ').replace(/<a [^>]*>/g, '[').replace(/<\/a>/g, ']')
        .replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
      console.log(`    words=${a.words} feedImg=${(it.image || '').split('/').pop().slice(0, 40)} ogImg=${a.image.split('/').pop().slice(0, 40)}`);
      console.log(outline.split('\n').map((l) => '  | ' + l.slice(0, 150)).join('\n'));
    } catch (e) {
      console.log('  ! ' + e.message);
    }
  }
}
