// Source health: open a GitHub issue when a source stops working, close it when it recovers.
// GitHub emails the repo owner about new issues and comments, so problems surface without watching the logs.

const LABEL = 'izvor-ne-radi';
const FEED_DOWN_HOURS = 6;
const EXTRACT_WINDOW_HOURS = 24;
const EXTRACT_MIN_FAILED = 5;

const fmt = (t) => (t ? new Date(t).toLocaleString('sr-Latn-RS', { timeZone: 'Europe/Belgrade' }) : 'nikad');

/** Returns { [sourceId]: { title, body } } for every source that currently has a problem. */
export function findProblems(sources, state, now) {
  const problems = {};
  for (const src of sources) {
    const st = state.sources[src.id] || {};
    const since = st.ok || st.since || now;
    if (st.mode === 'failed' && now - since > FEED_DOWN_HOURS * 3600e3) {
      problems[src.id] = {
        title: `Izvor ne radi: ${src.name}`,
        body: [
          `**${src.name}** (\`sources/${src.id}.json\`) ne vraća vesti duže od ${FEED_DOWN_HOURS} sati.`,
          '',
          `- Poslednji uspeh: ${fmt(st.ok)}`,
          `- Greška: \`${st.error || 'nepoznata'}\``,
          '',
          'Moguće: sajt je promenio RSS adresu, blokira preuzimanje ili je privremeno nedostupan. ',
          'Proveri adresu iz `feeds`, ili pokreni **Actions → debug-extract** sa `links_url` = naslovna strana sajta.',
          '',
          '_Ovaj issue se zatvara sam kada izvor ponovo proradi._',
        ].join('\n'),
      };
      continue;
    }
    const recent = Object.values(state.items).filter(
      (it) => it.source === src.id && now - (it.firstSeen || 0) < EXTRACT_WINDOW_HOURS * 3600e3,
    );
    const failed = recent.filter((it) => !it.x && it.fail);
    const ok = recent.filter((it) => it.x);
    if (failed.length >= EXTRACT_MIN_FAILED && ok.length === 0) {
      const reasons = {};
      for (const it of failed) reasons[it.err || '?'] = (reasons[it.err || '?'] || 0) + 1;
      problems[src.id] = {
        title: `Članci se ne preuzimaju: ${src.name}`,
        body: [
          `Naslovi sa **${src.name}** stižu, ali nijedan od poslednjih ${failed.length} članaka (${EXTRACT_WINDOW_HOURS} h) nije preuzet. `,
          'U aplikaciji se vidi samo uvod i dugme za original.',
          '',
          ...Object.entries(reasons).slice(0, 5).map(([e, n]) => `- ${n}× \`${e}\``),
          '',
          'Primer: ' + failed[0].url,
          '',
          '_Ovaj issue se zatvara sam kada preuzimanje ponovo proradi._',
        ].join('\n'),
      };
    }
  }
  return problems;
}

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.status === 204 ? null : res.json();
}

/** Opens/closes issues so they match the current problems. Without a token it only logs. */
export async function syncIssues(problems, log) {
  const ids = Object.keys(problems);
  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPOSITORY) {
    log(`health: ${ids.length ? ids.join(', ') : 'all sources ok'} (dry run, no token)`);
    return;
  }
  try {
    const open = await api('GET', `/issues?labels=${LABEL}&state=open&per_page=100`);
    const openByTitle = new Map(open.map((i) => [i.title, i]));
    const wanted = new Set(Object.values(problems).map((p) => p.title));
    for (const p of Object.values(problems)) {
      if (openByTitle.has(p.title)) continue;
      await api('POST', '/issues', { title: p.title, body: p.body, labels: [LABEL] });
      log(`health: opened issue "${p.title}"`);
    }
    for (const issue of open) {
      if (wanted.has(issue.title)) continue;
      await api('POST', `/issues/${issue.number}/comments`, { body: 'Izvor ponovo radi. Zatvaram.' });
      await api('PATCH', `/issues/${issue.number}`, { state: 'closed', state_reason: 'completed' });
      log(`health: closed issue "${issue.title}"`);
    }
    if (!ids.length && !open.length) log('health: all sources ok');
  } catch (e) {
    log(`health: could not sync issues (${e.message})`);
  }
}
