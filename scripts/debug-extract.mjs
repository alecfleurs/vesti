// Prints what the reader view would show for the newest articles of each source.
//   node scripts/debug-extract.mjs [perSource=2] [sourceId]
import { readFile, readdir } from 'node:fs/promises';
import { loadSource } from './lib/feeds.mjs';
import { extractArticle } from './lib/extract.mjs';
import { fetchText } from './lib/feeds.mjs';
import { JSDOM } from 'jsdom';

// Prints the page's section hints: meta tags, breadcrumbs and elements named like sections.
async function sectionHints(url) {
  const { text } = await fetchText(url);
  const doc = new JSDOM(text).window.document;
  const out = [];
  for (const m of doc.querySelectorAll('meta[property^="article:"], meta[name*="section" i], meta[name*="categ" i], meta[name="keywords"]')) {
    out.push(`meta ${m.getAttribute('property') || m.getAttribute('name')}=${(m.getAttribute('content') || '').slice(0, 60)}`);
  }
  for (const el of [...doc.querySelectorAll('[class*="rubri" i], [class*="kategor" i], [class*="categ" i], [class*="section" i], [class*="crumb" i], [class*="kicker" i], [class*="supertitle" i]')].slice(0, 8)) {
    const t = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (t) out.push(`<${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 50)}"> ${t}`);
  }
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const m = /"articleSection"\s*:\s*("[^"]*"|\[[^\]]*\])/.exec(s.textContent);
    if (m) out.push('ld+json articleSection=' + m[1].slice(0, 60));
  }
  return out;
}

// LINKS_URL=<page>: list feed-like links on a page and stop.
if (process.env.LINKS_URL) {
  const { text, url } = await fetchText(process.env.LINKS_URL);
  for (const m of text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (new RegExp(process.env.LINKS_RE || "rss|feed|xml", "i").test(m[1])) console.log(new URL(m[1], url).href, '|', m[2].replace(/<[^>]+>/g, '').trim().slice(0, 40));
  }
  process.exit(0);
}
// TITLE_RE=<regex>: extract only matching articles and print their raw cleaned HTML head.
const titleRe = process.env.TITLE_RE ? new RegExp(process.env.TITLE_RE, 'i') : null;
const per = Number(process.argv[2] || 2);
const only = process.argv[3];
for (const f of (await readdir('sources')).filter((f) => f.endsWith('.json'))) {
  const id = f.replace('.json', '');
  if (only && id !== only) continue;
  const src = JSON.parse(await readFile(`sources/${f}`, 'utf8'));
  const { items } = await loadSource(src);
  const pick = titleRe ? items.filter((i) => titleRe.test(i.title)) : items.filter((i) => !/\/(english|sport|video)\//.test(i.url)).slice(0, per);
  for (const it of pick) {
    console.log(`\n=== ${id}: ${it.title}\n    ${it.url}`);
    try {
      const a = await extractArticle(it.url);
      const outline = a.html
        .replace(/<img[^>]*src="([^"]+)"[^>]*>/g, (_, s) => `\n[IMG ${s.split('/').pop().slice(0, 50)}]\n`)
        .replace(/<\/(p|h\d|li|blockquote|figcaption)>/g, '\n')
        .replace(/<(h\d)>/g, '\n## ').replace(/<li>/g, ' - ').replace(/<a [^>]*>/g, '[').replace(/<\/a>/g, ']')
        .replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
      if (process.env.HINTS) for (const h of await sectionHints(it.url)) console.log('    hint ' + h);
      console.log(`    section=${a.section || '-'}`);
      if (titleRe) console.log('    RAW: ' + a.html.slice(0, 1500).replace(/\s+/g, ' '));
      if (titleRe) console.log('    feedImg=' + it.image + '\n    ogImg=' + a.image);
      console.log(`    words=${a.words} feedImg=${(it.image || '').split('/').pop().slice(0, 40)} ogImg=${a.image.split('/').pop().slice(0, 40)}`);
      console.log(outline.split('\n').map((l) => '  | ' + l.slice(0, 150)).join('\n'));
    } catch (e) {
      console.log('  ! ' + e.message);
    }
  }
}
