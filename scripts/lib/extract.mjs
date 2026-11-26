// Full-text extraction with Mozilla Readability (the Firefox Reader View engine) and a strict HTML whitelist.

import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { fetchText } from './feeds.mjs';
import { preClean, postClean } from './clean.mjs';

export const EXTRACT_VERSION = 6;

const quiet = new VirtualConsole(); // swallow CSS/script parse noise from news pages

const KEEP = new Set([
  'P', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'STRONG', 'B', 'EM', 'I', 'A', 'IMG',
  'FIGURE', 'FIGCAPTION', 'BR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'PRE', 'CODE', 'SUP', 'SUB', 'HR',
]);
const DROP = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'FORM', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SVG',
  'OBJECT', 'EMBED', 'VIDEO', 'AUDIO', 'CANVAS', 'ASIDE', 'NAV', 'FOOTER',
]);

// Largest candidate from a srcset, capped so phones don't pull 4K originals.
function bestFromSrcset(srcset) {
  let best = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, desc = ''] = part.trim().split(/\s+/);
    const w = /^(\d+)w$/.test(desc) ? +desc.slice(0, -1) : /^(\d(\.\d+)?)x$/.test(desc) ? parseFloat(desc) * 800 : 1;
    if (!url || w > 2000) continue;
    if (!best || w > best.w) best = { url, w };
  }
  return best?.url;
}

function fixLazyImages(doc) {
  for (const img of doc.querySelectorAll('img')) {
    const set = img.getAttribute('data-srcset') || img.getAttribute('srcset') || img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset');
    const big = set && bestFromSrcset(set);
    if (big && !big.startsWith('data:')) {
      img.setAttribute('src', big);
      continue;
    }
    const lazy =
      img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original') ||
      null;
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

  postClean(doc.body, doc);
  return doc.body.innerHTML.replace(/\n{2,}/g, '\n').trim();
}

/** Returns { html, text, words, byline, image, published } or throws. */
export async function extractArticle(url) {
  const page = await fetchText(url);
  const dom = new JSDOM(page.text, { url: page.url, virtualConsole: quiet });
  const doc = dom.window.document;
  const meta = (sel) => doc.querySelector(sel)?.getAttribute('content') || '';
  const ogImage = meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]');
  const crumbs = [...doc.querySelectorAll('[class*="breadcrumb"] a, nav[aria-label*="bread" i] a, [itemtype*="BreadcrumbList"] [itemprop="name"]')]
    .map((a) => a.textContent.trim())
    .filter((t) => t && t.length < 40 && !/^(početna|naslovna|home|почетна|насловна)$/i.test(t));
  const section = (meta('meta[property="article:section"]') || meta('meta[name="section"]') || meta('meta[name="category"]') || crumbs[0] || '').slice(0, 60);
  const published = Date.parse(meta('meta[property="article:published_time"]') || meta('meta[itemprop="datePublished"]'));
  fixLazyImages(doc);
  preClean(doc);

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
    section,
  };
}

/** Builds an article from the full text carried in the feed (used when the page blocks downloads). */
export function articleFromFeed(html, url) {
  const clean = sanitize(html, url);
  const text = clean.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  if (words < 120) throw new Error(`feed text too short (${words} words)`);
  return { html: clean, words, excerpt: '', byline: '', image: '', published: null, section: '', fromFeed: true };
}
