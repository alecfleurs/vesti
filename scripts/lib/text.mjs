// Serbian text helpers: Cyrillic -> Latin, normalization, tokenizing, light stemming.

const CYR = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'đ', 'е': 'e', 'ж': 'ž', 'з': 'z', 'и': 'i',
  'ј': 'j', 'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r',
  'с': 's', 'т': 't', 'ћ': 'ć', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'č', 'џ': 'dž', 'ш': 'š',
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Ђ': 'Đ', 'Е': 'E', 'Ж': 'Ž', 'З': 'Z', 'И': 'I',
  'Ј': 'J', 'К': 'K', 'Л': 'L', 'Љ': 'Lj', 'М': 'M', 'Н': 'N', 'Њ': 'Nj', 'О': 'O', 'П': 'P', 'Р': 'R',
  'С': 'S', 'Т': 'T', 'Ћ': 'Ć', 'У': 'U', 'Ф': 'F', 'Х': 'H', 'Ц': 'C', 'Ч': 'Č', 'Џ': 'Dž', 'Ш': 'Š',
};
const CYR_RE = /[Ѐ-ӿ]/g;

export function toLatin(s) {
  return s ? s.replace(CYR_RE, (c) => CYR[c] ?? c) : s;
}

// ASCII-fold to match URL slugs: đ -> dj, č/ć -> c, š -> s, ž -> z.
export function fold(s) {
  return toLatin(s)
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .replace(/[čć]/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

const STOP = new Set(`
a i u na je se da za od sa su o ali iz do po kao sto li ne ce bi biti bio bila bilo bili
koji koja koje kojeg kojem kojoj kojima ko sta kako posle nakon pre kod ili ga mu joj im ih njih njegov njegova
on ona oni ono one to taj ta ovo ova ovaj ovog ovom tog tom te vec jos samo sve svi sva svih ima imaju nema
moze mogu jer dok kada kad gde zbog protiv prema izmedju bez preko oko ka evo kaze kazao rekao rekla izjavio
izjavila foto video uzivo blog najnovije vesti vest danas sutra juce godine godina godini dan dana dva tri
sam smo ste si nije nisu bice bude budu jedan jedna jedno vise manje sada tada ovde tamo the of and in for
on with by from at is are was be vs nesto neko niko nista toga tome tim tako takodje novi nova novo nove
prvi prva prvo kroz uz pod nad pri cak bas vrlo veoma dalje kojim
`.split(/\s+/).filter(Boolean));

// Longest first. Strips one inflectional ending; keeps a stem of at least 4 chars.
const SUFFIXES = [
  'ovima', 'evima', 'ijama', 'iju', 'ija', 'ije', 'ama', 'ima', 'ova', 'eva', 'oga', 'ome', 'emu',
  'om', 'em', 'og', 'eg', 'ih', 'im', 'oj', 'ju', 'ja', 'je', 'ji', 'a', 'e', 'i', 'u', 'o',
];

export function stem(w) {
  if (/^\d+$/.test(w)) return w;
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w.length > 7 ? w.slice(0, 7) : w;
}

export function tokens(text) {
  if (!text) return [];
  const out = [];
  for (const raw of fold(text).split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    if (raw.length < 3 && !/^\d+$/.test(raw)) continue;
    if (/^\d+$/.test(raw) && (raw.length > 4 || /^20\d\d$/.test(raw))) continue; // ids and years are noise
    const s = stem(raw);
    if (s.length >= 3 || /^\d+$/.test(s)) out.push(s);
  }
  return out;
}

// Like tokens(), but keeps whether the source word started with a capital letter.
export function casedTokens(text) {
  if (!text) return [];
  const out = [];
  for (const raw of toLatin(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const [t] = tokens(raw);
    if (t) out.push({ t, cap: /^\p{Lu}/u.test(raw) });
  }
  return out;
}

// Words from a URL slug: "/info/svet/288126/zapalio-se-kamion-cisterna/vest" -> "zapalio se kamion cisterna".
export function slugWords(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    let best = '';
    for (const p of parts) {
      if (p.split('-').length > best.split('-').length) best = p;
    }
    return best.split('-').length >= 3 ? best.replace(/-/g, ' ') : '';
  } catch {
    return '';
  }
}

export function stripHtml(html) {
  if (!html) return '';
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—',
  bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', laquo: '«', raquo: '»',
  scaron: 'š', Scaron: 'Š', zcaron: 'ž', Zcaron: 'Ž', ccaron: 'č', Ccaron: 'Č', cacute: 'ć', Cacute: 'Ć',
  dstrok: 'đ', Dstrok: 'Đ', euro: '€', copy: '©', reg: '®', deg: '°', middot: '·', bull: '•',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e] ?? m;
  });
}

export function truncate(s, n) {
  if (!s || s.length <= n) return s || '';
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…';
}
