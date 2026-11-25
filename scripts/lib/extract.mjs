// Full-text extraction with Mozilla Readability (the Firefox Reader View engine) and a strict HTML whitelist.

import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchText } from './feeds.mjs';

const quiet = new VirtualConsole(); // swallow CSS/script parse noise from news pages

const KEEP = new Set([
  'P', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'STRONG', 'B', 'EM', 'I', 'A', 'IMG',
  'FIGURE', 'FIGCAPTION', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'PRE', 'CODE', 'SUP', 'SUB', 'HR',
]);
const DROP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SVG',
  'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'CANVAS', 'ASIDE', 'NAV', 'FOOTER',
]);
// Paragraphs that are site furniture, not article text.
const JUNK = /^(pročitajte (još|i)|прочитајте|погледајте|pogledajte (još|i)|povezane vesti|izvor:? ?$|foto:|tagovi|podeli|share|preuzmite aplikaciju|pratite nas|zapratite)/i;

function fixLazyImages(doc) {
  for (const img of doc.querySelectorAll('img')) {
    const lazy =
      img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') ||
      img.getAttribute('data-srcset')?.split(/\s+/)[0];
    const src = img.getAttribute('src') || '';
    if (lazy && (!src || src.startsWith('data:') || /placeholder|blank|lazy/i.test(src))) img.setAttribute('src', lazy);
  }
}

function sanitize(html, base) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: base, virtualConsole: quiet });
  const doc = dom.window.document;

  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) {
        child.remove();
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tagName = child.tagName;
      if (DROP.has(tagName)) {
        child.remove();
        continue;
      }
      walk(child);
      if (!KEEP.has(tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      const keep = {};
      if (tagName === 'A') {
        const href = child.href;
        if (/^https?:/i.test(href)) keep.href = href;
      } else if (tagName === 'IMG') {
        const src = child.src;
        if (!/^https?:/i.test(src) || /pixel|1x1|spacer|tracking/i.test(src)) {
          child.remove();
          continue;
        }
        keep.src = src;
        const alt = child.getAttribute('alt');
        if (alt) keep.alt = alt.slice(0, 200);
      }
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      for (const [k, v] of Object.entries(keep)) child.setAttribute(k, v);
    }
  };
  walk(doc.body);

  for (const p of doc.body.querySelectorAll('p, li, h2, h3, h4, figure')) {
    const text = p.textContent.trim();
    if (!text && !p.querySelector('img')) p.remove();
    else if (text.length < 120 && JUNK.test(text)) p.remove();
  }
  // Collapse duplicate images (lead image often repeats).
  const seen = new Set();
  for (const img of doc.body.querySelectorAll('img')) {
    if (seen.has(img.src)) img.remove();
    else seen.add(img.src);
  }
  return doc.body.innerHTML.replace(/\n{2,}/g, '\n').trim();
}

/** Returns { html, text, words, byline, image, published } or throws. */
export async function extractArticle(url) {
  const page = await fetchText(url);
  const dom = new JSDOM(page.text, { url: page.url, virtualConsole: quiet });
  const doc = dom.window.document;
  const meta = (sel) => doc.querySelector(sel)?.getAttribute('content') || '';
  const ogImage = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
  const published = Date.parse(meta('meta[property="article:published_time"]') || meta('meta[itemprop="datePublished"]'));
  fixLazyImages(doc);

  const art = new Readability(doc, { charThreshold: 300, keepClasses: false }).parse();
  if (!art || !art.content) throw new Error('readability: no content');
  const html = sanitize(art.content, page.url);
  const text = (art.textContent || '').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  if (words < 60) throw new Error(`too short (${words} words)`);
  return {
    html,
    words,
    excerpt: (art.excerpt || '').trim(),
    byline: (art.byline || '').trim().slice(0, 120),
    image: ogImage ? new URL(ogImage, page.url).href : '',
    published: Number.isFinite(published) ? published : null,
  };
}
