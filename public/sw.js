/* SHADOWLINE service worker — offline-first with install-time precaching.
 * CACHE v4: strategy change (navigate network-first + script stale-while-
 * revalidate + ignoreSearch normalized keys). Old caches purged on activate.
 *
 * - Navigation (request.mode === 'navigate') is handled FIRST, network-first
 *   with cache fallback; fresh index.html responses are cached so new hashed
 *   bundles are picked up after a rebuild (fixes reload-while-server-down
 *   update race).
 * - Navigation preload is OFF: never uses the preloaded navigation response;
 *   disables registration.navigationPreload on activate when available.
 * - Runtime cache keys are normalized (query/hash stripped) and lookups use
 *   caches.match(req, { ignoreSearch: true }) so `?v=` variants hit.
 * - Module scripts / styles (destination 'script'/'style') use
 *   stale-while-revalidate: serve cache immediately, refresh in background
 *   via event.waitUntil. Never rejects when a cache entry exists.
 * - Offline fallback is doc-only for HTML: documents fall back to cached
 *   index.html; script/style fall back to cached entry or a 503 Response
 *   (never HTML, avoids MIME-type breakage).
 * - Install is atomic-safe: cache.addAll(CORE) only; hashed assets scraped
 *   from index.html are cached best-effort individually (one failure never
 *   fails install).
 *
 * UPDATE PROTOCOL:
 * - App posts { type: 'SKIP_WAITING' } to activate the waiting worker.
 * - App listens for 'controllerchange' and shows a one-shot toast
 *   "Aggiornamento disponibile — ricarica" (no forced reload loop).
 */
const CACHE = 'shadowline-v5';
const CORE = ['./index.html', './manifest.webmanifest', './icon.svg'];
// Best-effort extras: referenced by manifest but may not exist in every build.
// Cached individually with catch() so a missing file NEVER fails install.
const EXTRA_BEST_EFFORT = ['./icon-512.png', './icon-192.png'];

function stripSearch(url) {
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  let end = url.length;
  if (q !== -1) end = Math.min(end, q);
  if (h !== -1) end = Math.min(end, h);
  return url.slice(0, end);
}

// Vary-stripping put: static servers/CDNs often send `Vary: Origin`, which can
// make caches.match() miss for cors-mode subresource requests carrying an
// Origin header. Same-origin game content never actually varies, so we store
// sanitized copies (body preserved byte-for-byte, only Vary removed).
function cachePut(key, res) {
  if (!res || !res.ok) return Promise.resolve();
  return res.arrayBuffer().then((buf) => {
    const h = new Headers(res.headers);
    h.delete('vary');
    return caches.open(CACHE).then((c) =>
      c.put(key, new Response(buf, { status: res.status, statusText: res.statusText, headers: h }))
    );
  }).catch(() => undefined);
}

async function precacheAll() {
  const cache = await caches.open(CACHE);
  // Atomic-safe: CORE only via addAll. Hashed assets below are best-effort.
  await cache.addAll(CORE);
  // png icons / extra assets: best-effort, never throw
  await Promise.all(
    EXTRA_BEST_EFFORT.map((u) =>
      fetch(u, { cache: 'no-cache' })
        .then((r) => (r && r.ok ? cachePut(u, r) : null))
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
    // Best-effort individually: one failure must not fail install.
    await Promise.all(
      [...urls].map((u) =>
        fetch(u, { cache: 'no-cache' })
          .then((r) => (r && r.ok ? cachePut(u, r) : null))
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
    (async () => {
      // Navigation preload OFF: never used in fetch handler; disable if present.
      try {
        if (self.registration && self.registration.navigationPreload) {
          await self.registration.navigationPreload.disable();
        }
      } catch {
        /* navigationPreload unsupported: ignore */
      }
      const ks = await caches.keys();
      await Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});
// Update-notify protocol: app posts { type: 'SKIP_WAITING' } to activate
// the waiting worker immediately; app shows toast on 'controllerchange'.
// Diagnostics: { type: 'DUMP' } -> port posts { v, keys, lastMiss }.
// Explicit precache: { type: 'PRECACHE', urls: [...] } (page-driven, deterministic:
// the page knows its own hashed scripts; install-time scraping is best-effort backup).
let lastMiss = '';
let lastPrecache = null;
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'DUMP' && e.ports && e.ports[0]) {
    caches.open(CACHE).then((c) => c.keys()).then((ks) => {
      e.ports[0].postMessage({ v: CACHE, keys: ks.map((k) => k.url), lastMiss, lastPrecache });
    });
  }
  if (e.data && e.data.type === 'PRECACHE' && Array.isArray(e.data.urls)) {
    const urls = e.data.urls;
    e.waitUntil(
      (async () => {
        let stored = 0; let err = '';
        for (const u of urls) {
          try {
            const r = await fetch(u, { cache: 'no-cache' });
            if (r && r.ok) { await cachePut(u, r); stored++; }
            else err += `bad:${u};`;
          } catch (err2) { err += `ex:${u}:${String(err2).slice(0, 60)};`; }
        }
        lastPrecache = { asked: urls.length, stored, err: err.slice(0, 300) };
      })()
    );
  }
});

function putRuntime(request, res) {
  if (!res || !res.ok) return Promise.resolve();
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return Promise.resolve();
    // Normalize cache keys: store by URL string ignoring search/hash
    // so `?v=` variants hit the same entry (Vary-stripped via cachePut).
    // NOTE: cachePut consumes res via arrayBuffer(); callers must not reuse res after.
    const key = stripSearch(request.url);
    return cachePut(key, res);
  } catch {
    return Promise.resolve();
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 1) Navigations FIRST: network-first with cache fallback.
  // NOTE: navigation preload is OFF — the preload slot is never consumed here.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            // Cache the fresh index.html so the new hashed bundle is picked up.
            e.waitUntil(cachePut('./index.html', res.clone()));
          }
          return res;
        })
        .catch(async () => {
          // Offline: cached navigation (ignoreSearch) or index.html fallback.
          const hit = await caches.match(request, { ignoreSearch: true });
          if (hit) return hit;
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
          return new Response('', { status: 503, statusText: 'offline' });
        })
    );
    return;
  }

  // 2) Module-script robustness: stale-while-revalidate for script/style.
  // Serve cache immediately, update in background. Never reject when cached.
  if (request.destination === 'script' || request.destination === 'style') {
    e.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => {
        const update = fetch(request)
          .then((res) => {
            if (res && res.ok) return putRuntime(request, res.clone()).then(() => res);
            return res;
          })
          .catch(() => null);
        if (cached) {
          // Background revalidate; cached response wins this load.
          e.waitUntil(update);
          return cached;
        }
        return update.then((res) => {
          if (res) return res;
          // Both cache and network failed: 503 (not HTML -> avoids MIME breakage).
          return caches.match(request, { ignoreSearch: true }).then(
            async (late) => {
              if (late) return late;
              // Miss diagnostics (read via DUMP): distinguish key-form vs Vary/header causes.
              let diag = '';
              try {
                const m1 = await caches.match(stripSearch(request.url));
                const m2 = await caches.match(request.url);
                const originHdr = request.headers.get('origin');
                diag = ` strKey=${!!m1} exactReq=${!!m2} originHdr=${originHdr} dest=${request.destination} mode=${request.mode}`;
              } catch (e2) { diag = 'diag-err'; }
              lastMiss = `${request.url} dest=${request.destination} mode=${request.mode} |${diag}`;
              return new Response('', { status: 503, statusText: 'offline' });
            }
          );
        });
      })
    );
    return;
  }

  // 3) Everything else same-origin GET: cache-first, then network + runtime cache.
  const isDoc = request.destination === 'document';
  e.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const key = stripSearch(request.url);
            e.waitUntil(cachePut(key, res.clone()));
          }
          return res;
        })
        .catch(async () => {
          const late = await caches.match(request, { ignoreSearch: true });
          if (late) return late;
          // Offline fallback: documents get cached index.html (doc-only fallback);
          // anything else gets 503, never HTML.
          if (isDoc) {
            const fallback = await caches.match('./index.html');
            if (fallback) return fallback;
          }
          return new Response('', { status: 503, statusText: 'offline' });
        });
    })
  );
});
