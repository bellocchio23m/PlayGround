/* SHADOWLINE service worker — offline-first with install-time precaching.
 * The bundle uses hashed filenames, so the SW scrapes index.html at install
 * and precaches every script/stylesheet it references. First visit works
 * online; every later load (including fully offline) is served from cache.
 * Navigation fallback applies ONLY to documents — never to JS/CSS (avoids
 * MIME-type breakage when an asset is genuinely missing).
 *
 * UPDATE PROTOCOL (for central wiring):
 * - Central (game.ts) posts { type: 'SKIP_WAITING' } to this SW when the user
 *   accepts an update prompt.
 * - Central listens for `navigator.serviceWorker.oncontrollerchange` (or the
 *   'controllerchange' event) and reloads once to pick up the new worker.
 * - CACHE name stays 'shadowline-v3': do NOT bump it unless the caching
 *   strategy itself changes (avoids churning every user install).
 * Precache coverage: scrape regex below catches src/href incl. .js/.css/fonts;
 * manifest icons (incl. .png like icon-512.png) are cached best-effort too. */
const CACHE = 'shadowline-v4';
// Phase-4 diagnostic channel: the SW posts {type:'SW_DIAG',...} to all clients
// on cache misses and fetch errors (used for offline-boot validation).
// Pages opt in with: navigator.serviceWorker.addEventListener('message', h).
function diag(info) {
  try {
    self.clients.matchAll({ includeUncontrolled: true }).then((cs) => {
      cs.forEach((c) => { try { c.postMessage({ type: 'SW_DIAG', ...info }); } catch { /* ignore */ } });
    });
  } catch { /* ignore */ }
}
const CORE = ['./index.html', './manifest.webmanifest', './icon.svg'];
// Best-effort extras: referenced by manifest but may not exist in every build.
// Cached individually with catch() so a missing file NEVER fails install.
const EXTRA_BEST_EFFORT = ['./icon-512.png', './icon-192.png'];

async function precacheAll() {
  const cache = await caches.open(CACHE);
  await cache.addAll(CORE);
  // png icons / extra assets: best-effort, never throw
  await Promise.all(
    EXTRA_BEST_EFFORT.map((u) =>
      fetch(u, { cache: 'no-cache' })
        .then((r) => (r.ok ? cache.put(u, r) : null))
        .catch(() => null)
    )
  );
  try {
    const res = await fetch('./index.html', { cache: 'no-cache' });
    const html = await res.text();
    const urls = new Set();
    // covers .js/.css/fonts/images: any relative src|href (incl. .png icons)
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
// Update-notify protocol: central posts { type: 'SKIP_WAITING' } to activate
// the waiting worker immediately; central reloads on 'controllerchange'.
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const isDoc = request.mode === 'navigate' || request.destination === 'document';
  e.respondWith(
    (async () => {
      try {
        const hit = await caches.match(request, { ignoreSearch: false });
        if (hit) return hit;
        // hardened: retry by raw URL string (covers key-format edge cases)
        const hit2 = await caches.match(request.url, { ignoreSearch: false });
        if (hit2) { diag({ ev: 'url-retry-hit', url: request.url }); return hit2; }
        diag({ ev: 'miss', url: request.url, dest: request.destination, mode: request.mode });
        try {
          const res = await fetch(request);
          if (res.ok && new URL(request.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        } catch (err) {
          diag({ ev: 'fetch-err', url: request.url, err: String(err) });
          if (isDoc) { const doc = await caches.match('./index.html'); if (doc) return doc; }
          return Promise.reject(new Error('offline'));
        }
      } catch (err) {
        diag({ ev: 'handler-err', url: request.url, err: String(err) });
        if (isDoc) { const doc = await caches.match('./index.html'); if (doc) return doc; }
        return Promise.reject(err instanceof Error ? err : new Error('offline'));
      }
    })()
  );
});
