// Minimalist dark-urban UI: menu, HUD, touch controls, pause, inventory,
// progression, settings, mission tracker, damage vignette, prompts.
import { InputManager } from '../input/input';

export type LayoutPreset = 'default' | 'compact' | 'large';

export class UI {
  root: HTMLElement;
  els: Record<string, HTMLElement> = {};
  promptT = 0;
  dmgT = 0;
  onAction: (a: string) => void = () => undefined;
  /** minimap zoom level (central drawMinimap reads this; 1=wide, 3=tight) */
  minimapZoom: 1 | 2 | 3 = 1;
  layout: LayoutPreset = 'default';
  private stealthTierCache = -1;
  private stealthLabelCache = '';
  private flashTimers = new Map<string, number>();
  /** act-grid button scale multiplier (transient; central owns persistence). 1 = preset default. */
  private buttonScale = 1;
  private bossCache = '';
  private noiseCache = -1;
  private promptPulseTimer: number | null = null;

  constructor(private input: InputManager) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = this.html();
    this.root.setAttribute('style', this.css());
    for (const id of ['menu', 'hud', 'pause', 'help', 'over', 'complete', 'progression', 'inventory', 'settings',
      'btn-start', 'btn-continue', 'btn-settings', 'btn-help', 'objectives', 'xpbar', 'detection', 'prompt',
      'vignette', 'toast', 'debug', 'mission-title', 'mission-brief', 'hpbar', 'stambar', 'tool-smoke', 'tool-knife',
      'joy-zone', 'cam-zone', 'joy-base', 'joy-knob', 'minimap', 'killfeed']) {
      const el = this.root.querySelector<HTMLElement>('#' + id);
      if (el) this.els[id] = el;
    }
    this.bind();
  }

  private css(): string {
    return `position:fixed;inset:0;pointer-events:none;z-index:10;color:#e8edf5;
      --acc:#e63946;--panel:rgba(10,14,20,.86);font-family:system-ui,sans-serif;`;
  }

  private btn(id: string, label: string, extra = ''): string {
    return `<button id="${id}" data-act="${id}" style="${extra};pointer-events:auto;background:rgba(20,28,40,.85);border:1px solid #3a4a63;color:#e8edf5;border-radius:10px;padding:10px 14px;font-size:15px;min-width:64px;min-height:48px">${label}</button>`;
  }

  private html(): string {
    return `
    <div id="menu" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 30%,#1a2436 0%,#0a0e14 70%);pointer-events:auto">
      <div style="text-align:center;max-width:520px;padding:24px">
        <div style="font-size:13px;letter-spacing:5px;color:#8fa3c1">PORTO SCURO · 02:47</div>
        <h1 style="font-size:52px;margin:6px 0;letter-spacing:6px">SHADOWLINE</h1>
        <div style="font-size:16px;color:var(--acc);letter-spacing:3px;margin-bottom:8px">— KESTREL —</div>
        <p style="color:#9fb0c9;font-size:14px">Stealth · Parkour · Katana. Osserva, pianifica, colpisci. L'intelligenza batte la forza.</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
          ${this.btn('btn-start', '▶ Nuova partita')}
          ${this.btn('btn-continue', '⤺ Continua')}
        </div>
        <div style="display:flex;gap:10px;justify-content:center;margin-top:10px">
          ${this.btn('btn-settings', '⚙ Impostazioni')}
          ${this.btn('btn-help', '? Comandi')}
        </div>
        <div id="menu-save" style="margin-top:10px;color:#7d8ea8;font-size:13px"></div>
        <div id="menu-slots" style="display:flex;gap:8px;justify-content:center;margin-top:8px"></div>
        <div style="margin-top:8px;color:#5b6b85;font-size:12px">Offline · Si installa come app · Touch + Controller</div>
      </div>
    </div>
    <div id="hud" style="position:absolute;inset:0;display:none">
      <div id="objectives" style="position:absolute;top:calc(10px + env(safe-area-inset-top));left:12px;background:var(--panel);border-left:3px solid var(--acc);padding:8px 12px;border-radius:0 8px 8px 0;max-width:min(46vw,340px);font-size:13px"></div>
      <div id="detection" style="position:absolute;top:calc(10px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);font-size:26px;display:none">👁</div>
      <div id="stat-block" style="position:absolute;top:calc(182px + env(safe-area-inset-top));right:12px;width:min(34vw,210px)">
        <div style="height:8px;background:#222c3b;border-radius:4px;overflow:hidden"><div id="hpbar" style="height:100%;width:100%;background:linear-gradient(90deg,#e63946,#ff7a5c)"></div></div>
        <div style="height:6px;background:#222c3b;border-radius:3px;overflow:hidden;margin-top:4px"><div id="stambar" style="height:100%;width:100%;background:#59c2ff"></div></div>
        <div id="xpbar" style="margin-top:4px;font-size:11px;color:#9fb0c9"></div>
        <div style="display:flex;gap:6px;margin-top:6px;font-size:12px"><span id="tool-smoke">FUMx2</span><span id="tool-knife">COLx3</span></div>
      </div>
      <div id="minimap" style="position:absolute;top:calc(64px + env(safe-area-inset-top));right:12px;width:110px;height:110px;border-radius:50%;background:rgba(10,14,20,.7);border:1px solid #3a4a63;overflow:hidden"></div>
      <div id="killfeed" style="position:absolute;right:12px;top:280px;font-size:13px;text-align:right;color:#ffd98a"></div>
      <div id="prompt" style="position:absolute;bottom:32%;left:50%;transform:translateX(-50%);background:var(--panel);padding:8px 16px;border-radius:8px;border:1px solid #3a4a63;display:none;font-size:14px"></div>
      <div id="toast" style="position:absolute;top:22%;left:50%;transform:translateX(-50%);background:var(--panel);padding:10px 18px;border-radius:10px;display:none;font-size:15px;border:1px solid var(--acc)"></div>
      <div id="vignette" style="position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(230,57,70,.55) 100%);opacity:0"></div>
      <!-- touch controls -->
      <div id="joy-zone" style="position:absolute;left:0;bottom:0;width:42vw;height:52vh;pointer-events:auto">
        <div id="joy-base" style="position:absolute;left:34px;bottom:calc(30px + env(safe-area-inset-bottom));width:120px;height:120px;border-radius:50%;border:2px solid #3a4a63;background:rgba(20,28,40,.4)">
          <div id="joy-knob" style="position:absolute;left:50%;top:50%;width:54px;height:54px;border-radius:50%;background:rgba(140,170,210,.5);transform:translate(-50%,-50%)"></div>
        </div>
      </div>
      <div id="cam-zone" style="position:absolute;right:0;bottom:0;width:58vw;height:62vh;pointer-events:auto"></div>
      <div id="act-grid" style="position:absolute;right:10px;bottom:calc(24px + env(safe-area-inset-bottom));display:grid;grid-template-columns:repeat(3,64px);gap:8px;pointer-events:auto">
        ${this.btn('t-jump', 'SALTO', '')}
        ${this.btn('t-attack', 'ATT', 'border-color:var(--acc)')}
        ${this.btn('t-heavy', 'PES', '')}
        ${this.btn('t-dodge', 'SCHIV', '')}
        ${this.btn('t-parry', 'PAR', '')}
        ${this.btn('t-crouch', 'CHIN', '')}
        ${this.btn('t-assass', 'ASS', 'border-color:var(--acc)')}
        ${this.btn('t-interact', 'USA', '')}
        ${this.btn('t-smoke', 'FUMO', '')}
        ${this.btn('t-lure', 'ESCA', '')}
        ${this.btn('t-special', 'FALCE', 'border-color:var(--acc)')}
      </div>
      <div id="sys-row" style="position:absolute;left:10px;top:calc(120px + env(safe-area-inset-top));display:flex;gap:8px;pointer-events:auto">
        ${this.btn('t-sprint', 'CORSA', '')}
        ${this.btn('t-knife', 'COLT', '')}
        ${this.btn('t-pause', 'II', '')}
      </div>
    </div>
    <div id="pause" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,8,12,.8);pointer-events:auto">
      <div style="background:var(--panel);padding:22px;border-radius:14px;border:1px solid #3a4a63;text-align:center;min-width:280px">
        <h2>⏸ Pausa</h2>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${this.btn('btn-resume', '▶ Riprendi')}
          ${this.btn('btn-inv', '🎒 Inventario')}
          ${this.btn('btn-prog', '⬆ Potenziamenti')}
          ${this.btn('btn-set2', '⚙ Impostazioni')}
          ${this.btn('btn-restart', '↻ Riavvia missione')}
          ${this.btn('btn-quit', '🏠 Menu')}
        </div>
      </div>
    </div>
    <div id="inventory" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,8,12,.8);pointer-events:auto"><div style="background:var(--panel);padding:20px;border-radius:12px;max-width:420px"><h3>🎒 Inventario</h3><div id="inv-body"></div><div style="margin-top:10px">${this.btn('btn-close-inv', 'Chiudi')}</div></div></div>
    <div id="progression" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,8,12,.8);pointer-events:auto"><div style="background:var(--panel);padding:20px;border-radius:12px;max-width:460px;max-height:80vh;overflow:auto"><h3>⬆ Potenziamenti</h3><div id="prog-body"></div><div style="margin-top:10px">${this.btn('btn-close-prog', 'Chiudi')}</div></div></div>
    <div id="settings" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,8,12,.8);pointer-events:auto"><div style="background:var(--panel);padding:20px;border-radius:12px;max-width:420px"><h3>⚙ Impostazioni</h3><div id="set-body"></div><div style="margin-top:10px">${this.btn('btn-close-set', 'Chiudi')}</div></div></div>
    <div id="help" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,8,12,.8);pointer-events:auto"><div style="background:var(--panel);padding:20px;border-radius:12px;max-width:440px"><h3>? Comandi</h3><div style="font-size:14px;color:#c6d3e6">WASD muovi · Mouse trascina camera · Shift sprint · C accovacciati · Spazio salto/vault · J attacco · K pesante · L parata · U schivata · E interagisci · Q assassinio · G fumogeno · F coltello · Esc pausa.<br><br>Touch: joystick sinistra, trascina destra per la camera.<br>Controller: stick + A salta, X attacco, B schivata, LB parata, Y pesante.</div><div style="margin-top:10px">${this.btn('btn-close-help', 'Chiudi')}</div></div></div>
    <div id="over" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(20,4,8,.85);pointer-events:auto"><div style="text-align:center"><h1 style="color:var(--acc)">SEI CADUTO</h1><div id="over-reason" style="color:#c6d3e6"></div><div style="display:flex;gap:8px;justify-content:center;margin-top:12px">${this.btn('btn-retry', '↻ Riprova dal checkpoint')}${this.btn('btn-quit2', '🏠 Menu')}</div></div></div>
    <div id="complete" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(4,16,8,.85);pointer-events:auto"><div style="text-align:center"><h1 style="color:#7dff9e">MISSIONE COMPLETATA</h1><div id="complete-body" style="color:#c6d3e6"></div><div style="display:flex;gap:8px;justify-content:center;margin-top:12px">${this.btn('btn-next', '▶ Prossima missione')}${this.btn('btn-quit3', '🏠 Menu')}</div></div></div>
    <div id="debug" style="position:absolute;left:8px;top:38%;font-size:11px;background:rgba(0,0,0,.6);padding:6px 8px;border-radius:6px;display:none;white-space:pre;color:#7dff9e"></div>`;
  }

  private bind(): void {
    this.root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (!b) return;
      this.onAction(b.dataset.act!);
    });
    const tap = (id: string, fn: () => void): void => {
      const el = this.els[id] ?? this.root.querySelector<HTMLElement>('#' + id);
      if (!el) return;
      this.els[id] = el;
      const fire = (e: Event): void => { e.preventDefault(); fn(); this.flashButton(id); };
      el.addEventListener('touchstart', fire as EventListener, { passive: false });
      el.addEventListener('mousedown', fire as EventListener);
    };
    tap('t-jump', () => this.input.tap('jump'));
    tap('t-attack', () => this.input.tap('attack'));
    tap('t-heavy', () => this.input.tap('heavy'));
    tap('t-dodge', () => this.input.tap('dodge'));
    tap('t-parry', () => this.input.tap('parry'));
    tap('t-crouch', () => this.input.setHold('crouch', true));
    tap('t-assass', () => this.input.tap('assassinate'));
    tap('t-interact', () => this.input.tap('interact'));
    tap('t-smoke', () => this.input.tap('smoke'));
    tap('t-lure', () => this.input.tap('lure'));
    tap('t-special', () => this.input.tap('special'));
    tap('t-sprint', () => { this.input.state.sprint = !this.input.state.sprint; });
    tap('t-knife', () => this.input.tap('knife'));
    tap('t-pause', () => this.input.tap('pause'));
  }

  show(id: string, v = true): void { const el = this.els[id]; if (el) el.style.display = v ? (id === 'hud' ? 'block' : 'flex') : 'none'; if (id === 'hud' && el) el.style.display = v ? 'block' : 'none'; }
  hideMenu(): void { this.show('menu', false); }
  showHud(v: boolean): void { const el = this.els['hud']; if (el) el.style.display = v ? 'block' : 'none'; }

  setObjectives(title: string, objs: string[], cur: number): void {
    this.els['objectives']!.innerHTML = `<div style="color:#8fa3c1;font-size:11px;letter-spacing:2px">${title}</div>` +
      objs.map((o, i) => `<div style="color:${i < cur ? '#5b6b85;text-decoration:line-through' : i === cur ? '#fff' : '#8fa3c1'}">${i < cur ? '✓' : i === cur ? '▸' : '·'} ${o}</div>`).join('');
  }
  setBars(hp: number, hpMax: number, st: number, stMax: number, xpTxt: string, smoke: number, knives: number): void {
    (this.els['hpbar'] as HTMLElement).style.width = `${(hp / hpMax) * 100}%`;
    (this.els['stambar'] as HTMLElement).style.width = `${(st / stMax) * 100}%`;
    this.els['xpbar']!.textContent = xpTxt;
    this.els['tool-smoke']!.textContent = `FUMx${smoke}`;
    this.els['tool-knife']!.textContent = `COLx${knives}`;
  }
  setDetection(level: number, combat: boolean): void {
    const el = this.els['detection']!;
    if (level <= 0.02 && !combat) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.textContent = combat ? '⚔' : level > 0.7 ? '👁' : '◔';
    el.style.color = combat ? '#e63946' : level > 0.7 ? '#ffb45e' : '#8fa3c1';
  }
  prompt(txt: string | null): void {
    const el = this.els['prompt']!;
    if (!txt) { el.style.display = 'none'; return; }
    el.style.display = 'block'; el.textContent = txt;
  }
  toast(txt: string, ms = 2200): void {
    const el = this.els['toast']!;
    el.style.display = 'block'; el.textContent = txt;
    window.setTimeout(() => { el.style.display = 'none'; }, ms);
  }
  damageFlash(v: number): void { this.dmgT = Math.max(this.dmgT, v); }
  /** persistent status line (benchmark, hidden state) — throttled by caller */
  toastStatus(txt: string): void {
    let el = this.root.querySelector<HTMLElement>('#status-line');
    if (!el) {
      el = document.createElement('div');
      el.id = 'status-line';
      el.setAttribute('style', 'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.65);padding:4px 12px;border-radius:6px;font-size:12px;color:#7dff9e;white-space:nowrap');
      this.els['hud']?.appendChild(el);
    }
    el.style.display = 'block';
    if (el.textContent !== txt) el.textContent = txt;
  }
  hideStatus(): void { this.root.querySelector<HTMLElement>('#status-line')?.remove(); }
  /** contextual buttons: highlight ASS/USA only when usable, dim empty tools */
  setContext(canAssass: boolean, canUse: boolean, smoke: number, knives: number): void {
    const set = (id: string, on: boolean, dim: boolean): void => {
      const el = this.root.querySelector<HTMLElement>('#' + id);
      if (!el) return;
      el.style.opacity = dim ? '0.35' : on ? '1' : '0.55';
      el.style.borderColor = on ? '#e63946' : '#3a4a63';
    };
    set('t-assass', canAssass, false);
    set('t-interact', canUse, false);
    set('t-smoke', false, smoke <= 0);
    set('t-knife', false, knives <= 0);
  }
  /** left-handed mode: mirror joystick/camera zones + button clusters */
  setLefty(lefty: boolean): void {
    const swap = (id: string, left: string, right: string): void => {
      const el = this.root.querySelector<HTMLElement>('#' + id);
      if (!el) return;
      el.style.left = lefty ? right : left;
      el.style.right = lefty ? left : right;
    };
    swap('joy-zone', '0', 'auto'); swap('cam-zone', 'auto', '0');
    const jz = this.root.querySelector<HTMLElement>('#joy-zone');
    const cz = this.root.querySelector<HTMLElement>('#cam-zone');
    if (jz && cz) {
      jz.style.left = lefty ? 'auto' : '0'; jz.style.right = lefty ? '0' : 'auto';
      cz.style.left = lefty ? '0' : 'auto'; cz.style.right = lefty ? 'auto' : '0';
      const jb = this.root.querySelector<HTMLElement>('#joy-base');
      if (jb) { jb.style.left = lefty ? 'auto' : '34px'; jb.style.right = lefty ? '34px' : 'auto'; }
    }
    swap('act-grid', 'auto', '10px'); swap('sys-row', '10px', 'auto');
    const ag = this.root.querySelector<HTMLElement>('#act-grid');
    if (ag) { ag.style.left = lefty ? '10px' : 'auto'; ag.style.right = lefty ? 'auto' : '10px'; }
    const sr = this.root.querySelector<HTMLElement>('#sys-row');
    if (sr) { sr.style.left = lefty ? 'auto' : '10px'; sr.style.right = lefty ? '10px' : 'auto'; }
  }
  setUiScale(s: number): void { this.root.style.fontSize = `${16 * s}px`; }
  /** "NASCOSTO" badge when fully concealed */
  setHidden(v: boolean): void {
    let el = this.root.querySelector<HTMLElement>('#hidden-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hidden-badge';
      el.textContent = 'NASCOSTO';
      el.setAttribute('style', 'position:absolute;bottom:26%;left:50%;transform:translateX(-50%);font-size:12px;letter-spacing:3px;color:#7dff9e;background:rgba(4,20,10,.7);border:1px solid #2c5a3a;padding:4px 14px;border-radius:12px;display:none');
      this.els['hud']?.appendChild(el);
    }
    el.style.display = v ? 'block' : 'none';
  }
  /** offscreen threat arrow: -1 left, 1 right, 2 behind, 0 none/visible */
  setThreat(dir: number): void {
    let el = this.root.querySelector<HTMLElement>('#threat-arrow');
    if (!el) {
      el = document.createElement('div');
      el.id = 'threat-arrow';
      el.setAttribute('style', 'position:absolute;top:50%;font-size:22px;color:#e63946;display:none;text-shadow:0 0 8px #e63946');
      this.els['hud']?.appendChild(el);
    }
    if (dir === 0) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.textContent = dir === 2 ? '!!' : dir < 0 ? '◀ !' : '! ▶';
    el.style.left = dir < 0 ? '8px' : 'auto';
    el.style.right = dir > 0 ? '8px' : 'auto';
  }
  killfeed(txt: string): void {
    const el = this.els['killfeed']!;
    const d = document.createElement('div'); d.textContent = txt;
    el.prepend(d);
    while (el.children.length > 4) el.lastChild?.remove();
    window.setTimeout(() => d.remove(), 4000);
  }
  /** Button layout presets: resize/reposition act-grid + sys-row. Persist via save settings.layout. */
  setLayoutPreset(p: LayoutPreset): void {
    this.layout = p;
    const grid = this.root.querySelector<HTMLElement>('#act-grid');
    const sys = this.root.querySelector<HTMLElement>('#sys-row');
    if (!grid) return;
    const cfg = {
      default: { cols: 64, gap: 8, bottom: 24, right: 10, font: 15 },
      compact: { cols: 52, gap: 6, bottom: 12, right: 6, font: 13 },
      large: { cols: 76, gap: 10, bottom: 28, right: 12, font: 16 },
    }[p];
    grid.style.gridTemplateColumns = `repeat(3,${cfg.cols}px)`;
    grid.style.gap = `${cfg.gap}px`;
    grid.style.bottom = `calc(${cfg.bottom}px + env(safe-area-inset-bottom))`;
    grid.style.right = `${cfg.right}px`;
    for (const b of Array.from(grid.querySelectorAll<HTMLElement>('button'))) {
      b.style.minWidth = `${Math.round(cfg.cols * this.buttonScale)}px`;
      const h = p === 'compact' ? 42 : p === 'large' ? 56 : 48;
      b.style.minHeight = `${Math.round(h * this.buttonScale)}px`;
      b.style.fontSize = `${cfg.font}px`;
      b.style.padding = p === 'compact' ? '6px 8px' : '10px 14px';
    }
    if (sys) {
      sys.style.top = p === 'compact' ? 'calc(96px + env(safe-area-inset-top))' : 'calc(120px + env(safe-area-inset-top))';
      for (const b of Array.from(sys.querySelectorAll<HTMLElement>('button'))) {
        b.style.fontSize = `${cfg.font}px`;
        b.style.minHeight = p === 'compact' ? '40px' : '48px';
      }
    }
    // compact: dock stat block left of the minimap so it never overlaps the buttons on short screens
    const stats = this.root.querySelector<HTMLElement>('#stat-block');
    if (stats) {
      if (p === 'compact') {
        stats.style.top = 'calc(64px + env(safe-area-inset-top))';
        stats.style.right = '130px';
        stats.style.width = '150px';
      } else {
        stats.style.top = 'calc(182px + env(safe-area-inset-top))';
        stats.style.right = '12px';
        stats.style.width = '';
      }
    }
  }
  /** Pick compact automatically on short screens (central calls on resize). Returns applied preset. */
  autoLayout(): LayoutPreset {
    const short = window.innerHeight < 500 || window.innerWidth <= 360;
    const p: LayoutPreset = short ? 'compact' : 'default';
    this.setLayoutPreset(p);
    return p;
  }
  /** Stealth suspicion tier badge near detection icon. Throttle-friendly: DOM writes only on change. */
  setStealthTier(tier: 0 | 1 | 2, label: string): void {
    if (tier === this.stealthTierCache && label === this.stealthLabelCache) return;
    this.stealthTierCache = tier;
    this.stealthLabelCache = label;
    let el = this.root.querySelector<HTMLElement>('#stealth-tier');
    if (!el) {
      el = document.createElement('div');
      el.id = 'stealth-tier';
      el.setAttribute('style', 'position:absolute;top:calc(46px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);font-size:11px;letter-spacing:1px;color:#8fa3c1;background:rgba(10,14,20,.7);border:1px solid #3a4a63;padding:3px 10px;border-radius:10px;display:none;white-space:nowrap');
      this.els['hud']?.appendChild(el);
    }
    if (tier === 0 && !label) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const segs = tier === 0 ? '○○○' : tier === 1 ? '●●○' : '●●●';
    const color = tier === 0 ? '#8fa3c1' : tier === 1 ? '#ffb45e' : '#e63946';
    const txt = `${segs} ${label}`;
    if (el.textContent !== txt) el.textContent = txt;
    if (el.style.color !== color) el.style.color = color;
    el.style.borderColor = color;
  }
  /** Mission tracker with optional survive timer. setObjectives() keeps working independently. */
  setTracker(title: string, lines: string[], cur: number, timer?: string): void {
    const el = this.els['objectives'];
    if (!el) return;
    const body = `<div style="color:#8fa3c1;font-size:11px;letter-spacing:2px">${title}</div>` +
      lines.map((o, i) => `<div style="color:${i < cur ? '#5b6b85;text-decoration:line-through' : i === cur ? '#fff' : '#8fa3c1'}">${i < cur ? '✓' : i === cur ? '▸' : '·'} ${o}</div>`).join('');
    const t = timer !== undefined ? `<div style="margin-top:4px;color:#ffd98a;font-size:13px;font-weight:700">⏱ ${timer}</div>` : '';
    const html = body + t;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  /** Minimap zoom store (central drawMinimap reads minimapZoom). */
  setMinimapZoom(z: 1 | 2 | 3): void { this.minimapZoom = z; }
  /** Button position/size configurability: scale act-grid button min sizes.
   *  s in [0.5, 2]; transient only (central owns save). Re-applies current
   *  layout preset sizes multiplied by s. Throttle-friendly: no-op when unchanged. */
  setButtonScale(s: number): void {
    const v = Math.min(2, Math.max(0.5, Number.isFinite(s) ? s : 1));
    if (v === this.buttonScale) return;
    this.buttonScale = v;
    const grid = this.root.querySelector<HTMLElement>('#act-grid');
    if (!grid) return;
    const base = this.layout === 'compact' ? 52 : this.layout === 'large' ? 76 : 64;
    const baseH = this.layout === 'compact' ? 42 : this.layout === 'large' ? 56 : 48;
    for (const b of Array.from(grid.querySelectorAll<HTMLElement>('button'))) {
      b.style.minWidth = `${Math.round(base * v)}px`;
      b.style.minHeight = `${Math.round(baseH * v)}px`;
    }
  }
  /** Prompt box pulse on new objective (call instead of prompt() when objective changes). */
  flashPrompt(): void {
    const el = this.els['prompt'] ?? this.root.querySelector<HTMLElement>('#prompt');
    if (!el) return;
    if (!this.els['prompt']) this.els['prompt'] = el;
    el.style.transition = 'box-shadow 120ms ease, border-color 120ms ease';
    el.style.boxShadow = '0 0 0 2px #e63946, 0 0 18px rgba(230,57,70,.8)';
    el.style.borderColor = '#e63946';
    if (this.promptPulseTimer !== null) window.clearTimeout(this.promptPulseTimer);
    this.promptPulseTimer = window.setTimeout(() => {
      el.style.boxShadow = '';
      el.style.borderColor = '#3a4a63';
      this.promptPulseTimer = null;
    }, 320);
  }
  /** Thin top boss HP bar for m8; central updates each frame. Pass null to hide.
   *  Throttle-friendly: DOM writes only on name/rounded-frac change. */
  setBossBar(name: string | null, frac: number): void {
    let wrap = this.root.querySelector<HTMLElement>('#boss-bar');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'boss-bar';
      wrap.setAttribute('style', 'position:absolute;top:calc(6px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);width:min(52vw,420px);display:none;text-align:center');
      wrap.innerHTML = '<div id="boss-name" style="font-size:11px;letter-spacing:2px;color:#ffb45e"></div>' +
        '<div style="height:5px;background:#222c3b;border-radius:3px;overflow:hidden;margin-top:3px"><div id="boss-fill" style="height:100%;width:100%;background:linear-gradient(90deg,#e63946,#ffb45e)"></div></div>';
      this.els['hud']?.appendChild(wrap);
    }
    if (name === null) {
      if (wrap.style.display !== 'none') wrap.style.display = 'none';
      this.bossCache = '';
      return;
    }
    const f = Math.min(1, Math.max(0, frac));
    const key = `${name}|${Math.round(f * 200)}`;
    if (key === this.bossCache) return;
    this.bossCache = key;
    wrap.style.display = 'block';
    const nm = wrap.querySelector<HTMLElement>('#boss-name');
    const fill = wrap.querySelector<HTMLElement>('#boss-fill');
    if (nm && nm.textContent !== name) nm.textContent = name;
    if (fill) fill.style.width = `${f * 100}%`;
  }
  /** Subtle 'RUMORE' indicator when player is loud (sprint/fight). 0=hidden,1=soft,2=loud.
   *  Minimal visual noise: single small badge, change-guarded. */
  setNoiseRing(level: 0 | 1 | 2): void {
    if (level === this.noiseCache) return;
    this.noiseCache = level;
    let el = this.root.querySelector<HTMLElement>('#noise-ring');
    if (!el) {
      el = document.createElement('div');
      el.id = 'noise-ring';
      el.setAttribute('style', 'position:absolute;top:calc(64px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);font-size:10px;letter-spacing:2px;color:#8fa3c1;background:rgba(10,14,20,.55);border:1px solid #3a4a63;padding:2px 10px;border-radius:10px;display:none;white-space:nowrap');
      this.els['hud']?.appendChild(el);
    }
    if (level === 0) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const txt = level === 1 ? '· RUMORE' : '·· RUMORE';
    if (el.textContent !== txt) el.textContent = txt;
    const color = level === 1 ? '#8fa3c1' : '#ffb45e';
    if (el.style.color !== color) el.style.color = color;
  }
  /** Visual active-state flash on tap (central may call; auto-called by touch bindings). */
  flashButton(id: string): void {
    const el = this.els[id] ?? this.root.querySelector<HTMLElement>('#' + id);
    if (!el) return;
    el.style.filter = 'brightness(1.8)';
    el.style.borderColor = '#e63946';
    const prev = this.flashTimers.get(id);
    if (prev) window.clearTimeout(prev);
    this.flashTimers.set(id, window.setTimeout(() => {
      el.style.filter = '';
      el.style.borderColor = '';
      this.flashTimers.delete(id);
    }, 120));
  }
  updateVignette(dt: number, hp: number, hpMax: number): void {
    this.dmgT = Math.max(0, this.dmgT - dt * 1.5);
    const low = hp / hpMax < 0.35 ? 0.4 + Math.sin(performance.now() / 300) * 0.15 : 0;
    (this.els['vignette'] as HTMLElement).style.opacity = `${Math.min(1, this.dmgT + low)}`;
  }
}
