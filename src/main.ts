// Entry point: loading screen -> menu -> load area -> gameplay.
import { Game } from './core/game';
import './style.css';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const load = document.createElement('div');
  load.setAttribute('style', 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0e14;color:#e8edf5;z-index:50;font-family:system-ui');
  load.innerHTML = '<div style="text-align:center"><div style="font-size:34px;letter-spacing:6px">SHADOWLINE</div><div id="load-msg" style="color:#8fa3c1;margin-top:8px">Caricamento…</div></div>';
  document.body.appendChild(load);
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
