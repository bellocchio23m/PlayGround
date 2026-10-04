/* SHADOWLINE service worker — offline-first with install-time precaching.
 * The bundle uses hashed filenames, so the SW scrapes index.html at install
 * and precaches every script/stylesheet it references. First visit works
 * online; every later load (including fully offline) is served from cache.
 * Navigation fallback applies ONLY to documents — never to JS/CSS (avoids
 * MIME-type breakage when an asset is genuinely missing). */
const CACHE = 'shadowline-v3';
const CORE = ['./index.html', './manifest.webmanifest', './icon.svg'];

async function precacheAll() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);
  try {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    const html = await res.text();
    const urls = new Set();
    const re = /(?:src|href)="([^"#]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = m[1];
      if (u.startsWith('./') || (!u.includes('://') && !u.startsWith('data:'))) urls.add(u);
    }
    await Promise.all(
      [...urls].map((u) =>
        fetch(u, { cache: 'no-cache' })
          .then((r) => (r.ok ? cache.put(u, r) : null))
          .catch(() => null)
      )
    );
  } catch {
    /* offline during install: CORE above is still cached */
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(precacheAll().then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const isDoc = request.mode === 'navigate' || request.destination === 'document';
  e.respondWith(
    caches.match(request, { ignoreSearch: false }).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok && new URL(request.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        }).catch(() => (isDoc ? caches.match('./index.html') : Promise.reject(new Error('offline'))))
    )
  );
});
