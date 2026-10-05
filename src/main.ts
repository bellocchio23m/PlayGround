// Entry point: loading screen -> menu -> load area -> gameplay.
import { Game } from './core/game';
import './style.css';

// PWA update wiring (owned by PWA/Offline Engineer):
// - Registers ./sw.js once.
// - Re-checks for updates when the tab becomes visible again.
// - On control change shows a single non-blocking toast
//   "Aggiornamento disponibile — ricarica" (max 1 per session, no reload loop).
let swToastShown = false;

function showSwToast(): void {
  if (swToastShown) return;
  swToastShown = true;
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = 'Aggiornamento disponibile — ricarica';
  el.setAttribute(
    'style',
    'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);' +
      'background:rgba(10,14,20,.92);color:#e8edf5;border:1px solid #2b3a55;' +
      'border-radius:10px;padding:10px 14px;font-size:13px;z-index:60;' +
      'font-family:system-ui;pointer-events:auto;cursor:pointer;max-width:88vw;text-align:center'
  );
  const dismiss = (): void => {
    el.remove();
  };
  el.addEventListener('click', dismiss);
  document.body.appendChild(el);
  window.setTimeout(dismiss, 9000);
}

function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  let reg: ServiceWorkerRegistration | null = null;
  void navigator.serviceWorker
    .register('./sw.js')
    .then((r) => {
      reg = r;
    })
    .catch(() => {
      /* offline-first boot: registration may fail with no network */
    });
  // Update check whenever the tab becomes visible again.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void (reg ? reg.update().catch(() => undefined) : navigator.serviceWorker.ready.then((r) => r.update().catch(() => undefined)));
    }
  });
  // Single-shot update toast; never force-reloads (no reload loop).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    showSwToast();
  });
  // Deterministic page-driven precache: the page knows its own hashed assets
  // (scripts + stylesheets). Sent once boot succeeds; SW fetches + stores them
  // Vary-stripped so offline subresource lookups always hit.
  void navigator.serviceWorker.ready.then((r) => {
    try {
      const urls = new Set<string>();
      document.querySelectorAll('script[src]').forEach((s) => {
        const src = (s as HTMLScriptElement).src;
        if (src) urls.add(src);
      });
      document.querySelectorAll('link[rel="stylesheet"][href]').forEach((l) => {
        const href = (l as HTMLLinkElement).href;
        if (href) urls.add(href);
      });
      urls.add(new URL('./manifest.webmanifest', location.href).toString());
      urls.add(new URL('./icon.svg', location.href).toString());
      r.active?.postMessage({ type: 'PRECACHE', urls: [...urls] });
    } catch {
      /* messaging best-effort */
    }
  }).catch(() => undefined);
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const load = document.createElement('div');
  load.setAttribute('style', 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0e14;color:#e8edf5;z-index:50;font-family:system-ui');
  load.innerHTML = '<div style="text-align:center"><div style="font-size:34px;letter-spacing:6px">SHADOWLINE</div><div id="load-msg" style="color:#8fa3c1;margin-top:8px">Caricamento…</div></div>';
  document.body.appendChild(load);
  setupServiceWorker();
  try {
    const game = new Game(app);
    const msg = load.querySelector('#load-msg')!;
    msg.textContent = 'Inizializzazione renderer…';
    await new Promise((r) => setTimeout(r, 30));
    await game.init();
    msg.textContent = 'Pronto';
    load.remove();
    (window as unknown as { __game?: Game }).__game = game;
    game.run();
  } catch (err) {
    const msg = load.querySelector('#load-msg');
    if (msg) msg.textContent = `Errore avvio: ${err instanceof Error ? err.message : err}`;
    console.error(err);
  }
}

void boot();
