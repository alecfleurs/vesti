// Offline support. App shell: stale-while-revalidate. Index: network first. Articles: cache first.
const SHELL = 'vesti-shell-v10';
const DATA = 'vesti-data-v1';
const SHELL_FILES = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'logo.svg', 'icon-192.png', 'fonts/inter-400.woff', 'fonts/inter-500.woff', 'fonts/inter-600.woff', 'fonts/inter-display-700.woff'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The app sends the ids still in the index; cached articles for anything else are dropped.
self.addEventListener('message', async (e) => {
  if (e.data?.type !== 'keep') return;
  const keep = new Set(e.data.ids);
  const cache = await caches.open(DATA);
  for (const req of await cache.keys()) {
    const m = /\/data\/a\/([0-9a-f]+)\.bin$/.exec(new URL(req.url).pathname);
    if (m && !keep.has(m[1])) await cache.delete(req);
  }
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const p = url.pathname;

  if (/\/data\/(index\.bin|meta\.json)$/.test(p)) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(DATA);
        try {
          const res = await fetch(e.request, { cache: 'no-cache' });
          if (res.ok) await cache.put(url.pathname, res.clone());
          return res;
        } catch {
          return (await cache.match(url.pathname)) || Response.error();
        }
      })(),
    );
    return;
  }

  if (/\/data\/a\/[0-9a-f]+\.bin$/.test(p)) {
    e.respondWith(
      (async () => {
        const cache = await caches.open(DATA);
        const hit = await cache.match(url.pathname);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) await cache.put(url.pathname, res.clone());
        return res;
      })(),
    );
    return;
  }

  // App shell: network first so a new deploy shows up on the next open; cache when offline.
  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const key = p.endsWith('/') ? './' : e.request;
      try {
        const res = await fetch(e.request, { cache: 'no-cache' });
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        return (await cache.match(key, { ignoreSearch: true })) || Response.error();
      }
    })(),
  );
});
