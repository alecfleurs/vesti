// Fetching, feed parsing (RSS 2.0 / Atom / RDF), feed autodiscovery and homepage scraping.
// Parsing is regex based on purpose: news feeds are often not well-formed XML.

import { decodeEntities, stripHtml } from './text.mjs';

export const UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

export async function fetchText(url, { timeout = 20000, accept } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.6',
      Accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const ctype = res.headers.get('content-type') || '';
  let charset = /charset=([\w-]+)/i.exec(ctype)?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
    charset = /<\?xml[^>]+encoding=["']([\w-]+)/i.exec(head)?.[1] || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  }
  let text;
  try {
    text = new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    text = new TextDecoder('utf-8').decode(buf);
  }
  return { text, url: res.url || url, type: ctype };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function unCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function tag(block, name) {
  const m = new RegExp(`<${esc(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(name)}>`, 'i').exec(block);
  return m ? unCdata(m[1]).trim() : '';
}

function attr(block, name, attrName, filter) {
  const re = new RegExp(`<${esc(name)}\\b([^>]*)>`, 'gi');
  let m;
  while ((m = re.exec(block))) {
    const attrs = m[1];
    if (filter && !filter(attrs)) continue;
    const v = new RegExp(`\\b${esc(attrName)}\\s*=\\s*["']([^"']+)["']`, 'i').exec(attrs);
    if (v) return decodeEntities(v[1]);
  }
  return '';
}

function absolute(u, base) {
  try {
    return new URL(u, base).href;
  } catch {
    return '';
  }
}

export function looksLikeFeed(text) {
  const head = text.slice(0, 1500);
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(head) && /<(item|entry)[\s>]/i.test(text);
}

export function parseFeed(xml, base) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = stripHtml(decodeEntities(tag(b, 'title')));
    let link = decodeEntities(tag(b, 'link'));
    if (!link || !/^https?:/i.test(link)) {
      link = attr(b, 'link', 'href', (a) => !/rel\s*=\s*["'](?!alternate)/i.test(a)) || '';
    }
    if (!link) {
      const guid = tag(b, 'guid');
      if (/^https?:/i.test(guid)) link = guid;
    }
    link = absolute(link, base);
    if (!title || !link) continue;
    const dateStr = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    const time = Date.parse(dateStr);
    const descHtml = decodeEntities(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content'));
    let image =
      attr(b, 'media:content', 'url', (a) => !/medium\s*=\s*["'](?!image)/i.test(a) && !/youtube/i.test(a)) ||
      attr(b, 'media:thumbnail', 'url') ||
      attr(b, 'enclosure', 'url', (a) => /type\s*=\s*["']image/i.test(a)) ||
      /<img[^>]+src=["']([^"']+)["']/i.exec(descHtml)?.[1] ||
      /<img[^>]+src=["']([^"']+)["']/i.exec(decodeEntities(tag(b, 'content:encoded')))?.[1] ||
      '';
    image = image ? absolute(decodeEntities(image), base) : '';
    const cats = [...b.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map((m) => stripHtml(unCdata(m[1]))).filter(Boolean);
    const term = attr(b, 'category', 'term');
    if (term) cats.push(term);
    items.push({
      title,
      url: link,
      time: Number.isFinite(time) ? time : null,
      lead: stripHtml(descHtml),
      image,
      cats: cats.slice(0, 6),
    });
  }
  return items;
}

export function discoverFeeds(html, base) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[0];
    if (!/rel\s*=\s*["']?alternate/i.test(t)) continue;
    if (!/type\s*=\s*["']application\/(rss|atom)\+xml/i.test(t)) continue;
    if (/comments?/i.test(t)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(t)?.[1];
    if (href) out.push(absolute(decodeEntities(href), base));
  }
  return [...new Set(out)];
}

export const COMMON_FEED_PATHS = ['/feed/', '/rss', '/rss/', '/rss.xml', '/feed.xml', '/index.rss', '/atom.xml'];

// Fallback for sites without feeds: article-looking links on the homepage.
export function scrapeHome(html, base) {
  const host = new URL(base).hostname.replace(/^www\./, '');
  const seen = new Set();
  const items = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = /href\s*=\s*["']([^"'#]+)["']/i.exec(m[1])?.[1];
    if (!href) continue;
    const url = absolute(decodeEntities(href), base);
    if (!url) continue;
    let u;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (u.hostname.replace(/^www\./, '') !== host) continue;
    const path = u.pathname;
    const segs = path.split('/').filter(Boolean);
    const slugish = segs.some((s) => s.split('-').length >= 4) || /\d{4,}/.test(path);
    if (!slugish || segs.length < 1) continue;
    if (/\/(tag|tema|autor|author|kategorija|category|page|strana|search|pretraga)\//i.test(path)) continue;
    const title = stripHtml(m[2]).replace(/\s+/g, ' ').trim();
    if (title.length < 25 || title.length > 220) continue;
    const key = u.origin + u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ title, url: key, time: null, lead: '', image: '' });
    if (items.length >= 60) break;
  }
  return items;
}

/**
 * Resolve a source to a list of items. Tries configured feeds, then autodiscovery,
 * then common feed paths, then a homepage scrape. Returns { items, mode, feeds, error }.
 */
export async function loadSource(src, log = () => {}) {
  const tried = new Set();
  const errors = [];

  async function tryFeed(url) {
    if (!url || tried.has(url)) return null;
    tried.add(url);
    try {
      const r = await fetchText(url, { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' });
      if (!looksLikeFeed(r.text)) return null;
      const items = parseFeed(r.text, r.url);
      return items.length ? items : null;
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
      return null;
    }
  }

  // 1. Configured feeds (merged). A feed may be "url" or { "url": ..., "category": ... }.
  const configured = (src.feeds || []).map((f) => (typeof f === 'string' ? { url: f } : f));
  let all = [];
  const used = [];
  for (const f of configured) {
    const items = await tryFeed(f.url);
    if (items) {
      if (f.category) for (const it of items) it.cats = [f.category, ...(it.cats || [])];
      all = all.concat(items);
      used.push(f.url);
    }
  }
  if (all.length) return { items: all, mode: 'rss', feeds: used };

  // 2. Autodiscovery and 3. common paths.
  let home = null;
  if (src.home) {
    try {
      home = await fetchText(src.home);
    } catch (e) {
      errors.push(`${src.home}: ${e.message}`);
    }
  }
  const candidates = home ? discoverFeeds(home.text, home.url) : [];
  if (src.home) for (const p of COMMON_FEED_PATHS) candidates.push(absolute(p, src.home));
  for (const f of candidates) {
    const items = await tryFeed(f);
    if (items) {
      log(`  discovered feed ${f}`);
      return { items, mode: configured.length ? 'rss-discovered (configured feed failed)' : 'rss-discovered', feeds: [f] };
    }
  }

  // 4. Homepage scrape.
  if (home) {
    const items = scrapeHome(home.text, home.url);
    if (items.length) return { items, mode: 'scrape', feeds: [] };
  }
  return { items: [], mode: 'failed', feeds: [], error: errors.slice(0, 3).join(' | ') || 'no feed or articles found' };
}
