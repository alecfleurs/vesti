// Site-furniture removal that works on any DOM (jsdom in CI, a real browser in tests).
// preClean runs on the full page before Readability; postClean runs on the sanitized article body.

import { fold } from './text.mjs';

// Class/id tokens of ad slots and "more news" widgets.
const AD_TOKEN = /(^|[-_])(ad|ads|adv|advert|advertisement|adsense|adslot|adunit|banner|billboard|oglas|oglasi|reklama|reklame|promo|sponsor|sponsored|dfp|gpt|taboola|outbrain|midas|teads|nativ|native-ad)([-_]|$|\d)/i;
const WIDGET_TOKEN = /(^|[-_])(related|recommended|recommendations?|preporuka|preporuceno|read-?more|more-?news|more-?articles|similar|also-?read|procitajte|povezane|newsletter|share|sharing|social|socials|tags?|comments?|breadcrumbs?|author-?box|most-?read|najcitanije|latest|najnovije|widget|sidebar|teaser-?list|card-?list)([-_]|$)/i;

// Headings that introduce a block of links to other articles (folded: no diacritics, Latin).
export const RELATED_HEAD = /^(mozda vas (zanima|interesuje)|procitajte (jos|i|takodje|vise)|takodje procitajte|povezane (vesti|teme)|vezane vesti|slicne vesti|najcitanije|najnovije( vesti)?|preporucujemo|preporuka|ne propustite|pogledajte (jos|i)|vise (vesti )?iz rubrike|izdvajamo|iz rubrike|tagovi|teme|komentari|podeli( vest)?|jos vesti|ostale vesti|vesti dana|iz minuta u minut|pratite nas|zapratite nas|vazno)\s*[:.!]?$/;

const AD_LABEL = /^(oglas|oglasi|reklama|advertisement|advertising|ad|sponzorisano|sponzorisan sadrzaj|promo|promocija|pr tekst|marketing|placeni sadrzaj)$/;
const DATE_ONLY = /^(\d{1,2}[:.]\d{2}h?|\d{1,2}\.\s?\d{1,2}\.\s?(\d{2,4}\.?)?|\d+\s?(d|h|min|s|dan|dana|sat|sati|sata|minuta)|pre \d+ ?\w*|juce|danas|upravo|\d+ komentar\w*)$/;
const JUNK_LINE = /^(procitajte (jos|i)|pogledajte (jos|i)|foto:?|video:?|izvor:?|podeli|share|preuzmite aplikaciju|pratite nas|zapratite nas|prijavite se na newsletter|skini aplikaciju)\b/;

const norm = (s) => fold(s || '').replace(/\s+/g, ' ').trim();

function tokensOf(el) {
  const c = typeof el.className === 'string' ? el.className : el.getAttribute?.('class') || '';
  return (c + ' ' + (el.id || '')).split(/\s+/).filter(Boolean);
}

function paragraphText(root) {
  let n = 0;
  for (const p of root.querySelectorAll('p')) n += p.textContent.trim().length;
  return n;
}

/** Remove ads and related-article widgets from a full page. Mutates doc. */
export function preClean(doc) {
  const body = doc.body;
  if (!body) return;
  const total = paragraphText(body) || 1;
  const safeToRemove = (el) =>
    el !== body &&
    !el.querySelector('h1') &&
    el.tagName !== 'ARTICLE' &&
    el.tagName !== 'MAIN' &&
    paragraphText(el) < total * 0.35;

  // 1. Ad slots, embeds and widgets by class/id.
  for (const el of [...body.querySelectorAll('[class],[id]')]) {
    if (!el.isConnected) continue;
    const toks = tokensOf(el);
    if (toks.some((t) => AD_TOKEN.test(t) || WIDGET_TOKEN.test(t)) && safeToRemove(el)) el.remove();
  }
  for (const el of [...body.querySelectorAll('ins, iframe, aside, [data-ad], [data-ad-slot], [data-google-query-id]')]) el.remove();

  // 2. Short ad labels ("Oglas") wherever they are.
  for (const el of [...body.querySelectorAll('div, span, p, small, section')]) {
    if (!el.isConnected || el.children.length > 2) continue;
    if (AD_LABEL.test(norm(el.textContent))) el.remove();
  }

  // 3. "Možda vas zanima" style blocks: remove the heading with its whole (small) container.
  for (const el of [...body.querySelectorAll('h2, h3, h4, h5, h6, p, div, span, strong, b, header')]) {
    if (!el.isConnected) continue;
    const t = norm(el.textContent);
    if (t.length > 45 || !RELATED_HEAD.test(t)) continue;
    let box = el;
    while (box.parentElement && box.parentElement !== body && box.parentElement.textContent.length < 1400) {
      box = box.parentElement;
    }
    if (box !== el && safeToRemove(box) && box.querySelector('a')) box.remove();
    else if (el.isConnected) {
      // Inline in the article: drop the heading and the run of link-only siblings after it.
      let next = el.nextElementSibling;
      el.remove();
      while (next && isLinkOnly(next)) {
        const n = next.nextElementSibling;
        next.remove();
        next = n;
      }
    }
  }
}

function isLinkOnly(el) {
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const links = el.querySelectorAll ? [...el.querySelectorAll('a')] : [];
  if (el.tagName === 'A') return text.length < 160;
  if (!links.length) return false;
  const linkText = links.map((a) => a.textContent).join('').replace(/\s+/g, ' ').trim();
  return linkText.length >= text.length - 2 && text.length < 160;
}

function imageKey(src) {
  try {
    const u = new URL(src);
    const file = u.pathname.split('/').pop() || '';
    return file
      .replace(/\.(jpe?g|png|webp|avif|gif)$/i, '')
      .replace(/[-_](\d{2,4}x\d{2,4}|scaled|thumb|large|medium|small|w\d+|h\d+)$/i, '')
      .replace(/[-_]\d{2,4}x\d{2,4}/i, '')
      .toLowerCase();
  } catch {
    return src;
  }
}
export { imageKey };

const BLOCK = new Set(['P', 'H2', 'H3', 'H4', 'UL', 'OL', 'BLOCKQUOTE', 'FIGURE', 'TABLE', 'PRE', 'HR', 'IMG']);

/** Tidy an already-sanitized article body (whitelisted tags only). Mutates root. */
export function postClean(root, doc) {
  // Wrap stray top-level inline content (left over from unwrapped divs) in <p>.
  let run = [];
  const flush = (before) => {
    if (run.some((n) => (n.textContent || '').trim() || n.nodeName === 'IMG')) {
      const p = doc.createElement('p');
      before ? root.insertBefore(p, before) : root.appendChild(p);
      for (const n of run) p.appendChild(n);
    } else for (const n of run) n.remove();
    run = [];
  };
  for (const n of [...root.childNodes]) {
    if (n.nodeType === 1 && BLOCK.has(n.nodeName)) flush(n);
    else if (n.nodeName === 'BR') {
      flush(n);
      n.remove();
    } else run.push(n);
  }
  flush(null);

  // Junk blocks.
  for (const el of [...root.querySelectorAll('p, h2, h3, h4, li, figcaption, blockquote')]) {
    if (!root.contains(el)) continue;
    const t = norm(el.textContent);
    const hasImg = !!el.querySelector('img');
    if (!t && !hasImg) {
      el.remove();
      continue;
    }
    if (hasImg) continue;
    if (AD_LABEL.test(t) || DATE_ONLY.test(t)) el.remove();
    else if (t.length < 60 && RELATED_HEAD.test(t)) {
      let next = el.nextElementSibling;
      el.remove();
      while (next && (isLinkOnly(next) || DATE_ONLY.test(norm(next.textContent)))) {
        const n = next.nextElementSibling;
        next.remove();
        next = n;
      }
    } else if (t.length < 120 && JUNK_LINE.test(t)) el.remove();
    else if (el.tagName !== 'LI' && isLinkOnly(el) && !/[.!?]$/.test(t)) el.remove();
  }
  // Lists left with only links (related article lists).
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    const items = [...list.children];
    if (items.length && items.every(isLinkOnly)) list.remove();
  }
  // Duplicate images.
  const seen = new Set();
  for (const img of [...root.querySelectorAll('img')]) {
    const k = imageKey(img.getAttribute('src'));
    if (seen.has(k)) (img.closest('figure') || img).remove();
    else seen.add(k);
  }
  for (const f of [...root.querySelectorAll('figure')]) if (!f.querySelector('img') && !f.textContent.trim()) f.remove();
  // Leading/trailing horizontal rules.
  while (root.firstElementChild?.tagName === 'HR') root.firstElementChild.remove();
  while (root.lastElementChild?.tagName === 'HR') root.lastElementChild.remove();
}
