// Game orchestrator: renderer, loop, spawning, mission ticks, assassination,
// interactions, tools (smoke/knives), FX pool, minimap, debug overlay, saves.
import * as THREE from 'three';
import { CFG, NoiseEvent } from '../core/config';
import { clamp } from '../core/utils';
import { World } from '../world/world';
import { Player } from '../player/player';
import { ThirdPersonCamera } from '../camera/tpcamera';
import { InputManager } from '../input/input';
import { Enemy, EnemyKind } from '../ai/enemy';
import { CombatSystem } from '../combat/combat';
import { canAssassinate } from '../stealth/perception';
import { AudioEngine } from '../audio/audio';
import { SaveSystem } from '../save/save';
import { UI } from '../ui/ui';
import { MISSIONS } from '../missions/missions';
import { advanceObjective, currentObjective, failMission, MissionRuntime, startMission } from '../missions/framework';
import { addXp, availablePoints, buyUpgrade, upgradeEffects } from '../progression/progression';
import { UPGRADES } from '../core/config';

export type GameScreen = 'menu' | 'playing' | 'paused' | 'over' | 'complete';

export class Game {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  world!: World;
  player!: Player;
  cam!: ThirdPersonCamera;
  input = new InputManager();
  audio = new AudioEngine();
  save = new SaveSystem();
  ui!: UI;
  combat!: CombatSystem;
  enemies: Enemy[] = [];
  noises: NoiseEvent[] = [];
  screen: GameScreen = 'menu';
  mission!: MissionRuntime;
  missionIndex = 0;
  xp = { xp: 0, level: 1, upgrades: {} as Record<string, number> };
  smoke = 2; knives = 3;
  time = 0; aiAcc = 0; aiIdx = 0;
  debug = false;
  debugEl: HTMLElement | null = null;
  fps = 60; fpsAcc = 0; fpsN = 0; fpsT = 0; frameMs = 0;
  // fx pools
  private sparks: THREE.Points[] = [];
  private sparkVel: Float32Array[] = [];
  private sparkLife: number[] = [];
  private smokePuffs: THREE.Mesh[] = [];
  private dmgPool: HTMLElement[] = [];
  clock = new THREE.Clock();
  assassPrompt: Enemy | null = null;
  interactNear: string | null = null;
  alarmT = 0;
  quality: 'low' | 'med' | 'high' = 'med';

  constructor(private container: HTMLElement) {}

  async init(): Promise<void> {
    this.save.load();
    this.quality = this.save.data.settings.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality === 'low' ? 1 : CFG.perf.pixelRatioCap));
    this.container.appendChild(this.renderer.domElement);

    this.world = new World(this.scene);
    this.world.build();
    this.player = new Player({
      noise: (n) => this.noises.push(n),
      landed: () => undefined,
      died: () => this.onDeath(),
    }, this.audio);
    this.scene.add(this.player.obj);
    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.ui = new UI(this.input);
    this.debugEl = this.ui.els['debug'] ?? null;
    this.combat = new CombatSystem(this.audio, {
      slash: (at) => this.burst(at, 0xe63946, 14),
      spark: (at) => this.burst(at, 0xffd98a, 18),
      damageNum: (at, dmg, kind) => this.damageNum(at, `${dmg}${kind === 'colpo' ? '' : ' ' + kind}`),
    });
    this.ui.onAction = (a) => this.onUiAction(a);
    this.input.init(this.ui.root);
    this.input.sens = this.save.data.settings.cameraSens;
    this.input.invertY = this.save.data.settings.invertY;
    this.applySaveToState();
    this.buildSmokePool();
    this.refreshMenuSave();
    this.ui.show('menu', true);
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cam.resize(window.innerWidth, window.innerHeight);
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.screen === 'playing') this.pause(); });
    // keyboard shortcuts for panels/debug
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') { this.debug = !this.debug; if (this.debugEl) this.debugEl.style.display = this.debug ? 'block' : 'none'; }
      if (e.code === 'Backquote' && this.screen === 'playing') this.pause();
    });
    // register SW for PWA offline
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('./sw.js'); } catch { /* offline-less ok */ }
    }
  }

  private applySaveToState(): void {
    const d = this.save.data;
    this.missionIndex = clamp(d.missionIndex, 0, MISSIONS.length - 1);
    this.xp = { xp: d.xp, level: 1 + Math.floor(d.xp / 140), upgrades: { ...d.upgrades } };
    // recompute level properly
    let lvl = 1; let xp = d.xp;
    while (xp >= 100 + (lvl - 1) * 80) { xp -= 100 + (lvl - 1) * 80; lvl++; }
    this.xp.level = lvl;
    this.smoke = d.inventory.smoke; this.knives = d.inventory.knives;
    this.audio.setVolume(d.settings.volume);
  }

  private refreshMenuSave(): void {
    const el = this.ui.root.querySelector('#menu-save');
    if (el) el.textContent = this.save.data.missionsDone.length
      ? `Salvataggio: ${this.save.data.missionsDone.length}/5 missioni · Liv ${this.xp.level}`
      : 'Nessun salvataggio — inizia una nuova partita';
  }

  // ---------- mission lifecycle ----------
  startMission(i: number): void {
    this.missionIndex = clamp(i, 0, MISSIONS.length - 1);
    const def = MISSIONS[this.missionIndex];
    this.mission = startMission(def);
    this.enemies.forEach((e) => this.scene.remove(e.rig.group));
    this.enemies = [];
    this.noises = [];
    this.spawnEnemiesForMission(def.id);
    const eff = upgradeEffects(this.xp);
    this.player.speedMul = eff.speedMul; this.player.stealthMul = eff.stealthMul;
    this.player.staminaMax = eff.staminaMax; this.player.stamina = eff.staminaMax;
    this.player.dmgMul = eff.dmgMul; this.player.regenMul = eff.regenMul;
    this.player.hpMax = CFG.player.hpMax; this.player.hp = this.player.hpMax;
    this.player.reset(def.start.x, def.start.y, def.start.z);
    this.cam.yaw = Math.PI; this.cam.pitch = 0.32;
    // mission 5 starts with alarm
    if (def.id === 'm5-fuga') { this.alarmT = 45; this.alertAll(); this.ui.toast('⚠ ALLARME! Fuggi!'); }
    else this.alarmT = 0;
    this.audio.ensure(); this.audio.startMusic();
    this.screen = 'playing';
    this.ui.hideMenu();
    this.ui.show('pause', false); this.ui.show('over', false); this.ui.show('complete', false);
    this.ui.showHud(true);
    this.ui.toast(`${def.name} — ${def.briefing}`, 4200);
    this.save.data.checkpoint = { x: def.start.x, y: def.start.y, z: def.start.z, missionId: def.id };
    this.save.save();
  }

  private spawnEnemiesForMission(missionId: string): void {
    const routes = this.world.patrolRoutes;
    const mk = (kind: EnemyKind, routeIdx: number): void => {
      const e = new Enemy(kind, routes[routeIdx % routes.length]);
      // face along patrol route (away from spawn approaches where possible)
      const r = routes[routeIdx % routes.length];
      if (r.length > 1) e.yaw = Math.atan2(r[1].x - r[0].x, r[1].z - r[0].z) + Math.PI;
      this.enemies.push(e); this.scene.add(e.rig.group);
    };
    mk('guard', 0); mk('guard', 1); mk('guard', 2);
    if (missionId === 'm2-lama') {
      const lt = new Enemy('elite', [new THREE.Vector3(-4, 0, 16), new THREE.Vector3(4, 0, 20), new THREE.Vector3(-4, 0, 24)]);
      (lt as unknown as { tag?: string }).tag = 'target';
      (lt as unknown as Record<string, unknown>)['isTarget'] = true;
      this.enemies.push(lt); this.scene.add(lt.rig.group);
    } else {
      mk('guard', 4);
    }
    if (missionId === 'm3-verticale' || missionId === 'm4-sigillo') { mk('elite', 3); mk('guard', 4); }
    if (missionId === 'm5-fuga') { mk('elite', 0); mk('elite', 1); mk('captain', 4); }
    // place rooftop guard at its roof height
    for (const e of this.enemies) e.pos.y = this.world.groundHeight(e.pos.x, e.pos.z);
  }

  private alertAll(): void {
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.state = 'COMBAT' as never;
      e.lastKnown.copy(this.player.pos);
      e.lastKnownT = this.time;
    }
  }

  pause(): void {
    if (this.screen !== 'playing') return;
    this.screen = 'paused';
    this.ui.show('pause', true);
  }
  resume(): void {
    if (this.screen !== 'paused') return;
    this.screen = 'playing';
    this.ui.show('pause', false);
  }

  private onDeath(): void {
    if (this.screen !== 'playing') return;
    this.screen = 'over';
    this.ui.showHud(false);
    this.ui.show('over', true);
    const el = this.ui.root.querySelector('#over-reason');
    if (el) el.textContent = this.mission?.failReason || 'Kestrel è caduto. Riprova dal checkpoint.';
  }

  private completeMission(): void {
    const rt = this.mission;
    rt.done = true;
    const { levels } = addXp(this.xp, rt.def.rewardXp);
    if (rt.def.rewardTools?.smoke) this.smoke += rt.def.rewardTools.smoke;
    if (rt.def.rewardTools?.knives) this.knives += rt.def.rewardTools.knives;
    const d = this.save.data;
    if (!d.missionsDone.includes(rt.def.id)) d.missionsDone.push(rt.def.id);
    d.missionIndex = Math.min(this.missionIndex + 1, MISSIONS.length - 1);
    d.xp = this.xp.xp + (this.xp.level - 1) * 140;
    d.upgrades = { ...this.xp.upgrades };
    d.inventory.smoke = this.smoke; d.inventory.knives = this.knives;
    d.bestGhost[rt.def.id] = (d.bestGhost[rt.def.id] ?? true) && rt.ghost;
    this.save.save();
    this.screen = 'complete';
    this.ui.showHud(false);
    this.ui.show('complete', true);
    const el = this.ui.root.querySelector('#complete-body');
    if (el) el.innerHTML = `+${rt.def.rewardXp} XP · Livello ${this.xp.level}${levels ? ` (⬆ +${levels} punti!)` : ''}<br>${rt.ghost ? '👻 FANTASMA — mai individuato!' : ''}<br>Tempo: ${rt.time.toFixed(0)}s`;
    this.audio.stopMusic();
  }

  // ---------- UI actions ----------
  private onUiAction(a: string): void {
    this.audio.ensure(); this.audio.ui();
    switch (a) {
      case 'btn-start': this.xp = { xp: 0, level: 1, upgrades: {} }; this.save.wipe(); this.applySaveToState(); this.startMission(0); break;
      case 'btn-continue': this.startMission(this.save.data.missionIndex); break;
      case 'btn-settings': case 'btn-set2': this.openSettings(); break;
      case 'btn-help': this.ui.show('help', true); break;
      case 'btn-close-help': this.ui.show('help', false); break;
      case 'btn-resume': this.resume(); break;
      case 'btn-inv': this.openInventory(); break;
      case 'btn-prog': this.openProgression(); break;
      case 'btn-close-inv': this.ui.show('inventory', false); break;
      case 'btn-close-prog': this.ui.show('progression', false); break;
      case 'btn-close-set': this.ui.show('settings', false); break;
      case 'btn-restart': this.ui.show('pause', false); this.startMission(this.missionIndex); break;
      case 'btn-quit': case 'btn-quit2': case 'btn-quit3':
        this.screen = 'menu';
        this.ui.show('pause', false); this.ui.show('over', false); this.ui.show('complete', false);
        this.ui.showHud(false); this.ui.show('menu', true);
        this.refreshMenuSave(); this.audio.stopMusic();
        break;
      case 'btn-retry': {
        this.ui.show('over', false);
        const cp = this.save.data.checkpoint;
        this.startMission(this.missionIndex);
        if (cp && cp.missionId === MISSIONS[this.missionIndex].id) this.player.reset(cp.x, cp.y, cp.z);
        break;
      }
      case 'btn-next': this.ui.show('complete', false); this.startMission(Math.min(this.missionIndex + 1, MISSIONS.length - 1)); break;
      default:
        if (a.startsWith('buy-')) {
          const id = a.slice(4);
          if (buyUpgrade(this.xp, id, 3)) {
            this.save.data.upgrades = { ...this.xp.upgrades }; this.save.save();
            const eff = upgradeEffects(this.xp);
            this.player.speedMul = eff.speedMul; this.player.stealthMul = eff.stealthMul;
            this.player.staminaMax = eff.staminaMax; this.player.dmgMul = eff.dmgMul;
            this.player.regenMul = eff.regenMul;
            this.openProgression();
            this.ui.toast('Potenziamento acquisito');
          } else this.ui.toast('Punti insufficienti o max raggiunto');
        }
        if (a.startsWith('set-')) this.onSetting(a);
        break;
    }
  }

  private openInventory(): void {
    this.ui.show('inventory', true);
    const el = this.ui.root.querySelector('#inv-body')!;
    el.innerHTML = `<div style="font-size:14px">🗡 Katana del Corvo — danno ×${(this.player.dmgMul ?? 1).toFixed(2)}<br>💨 Fumogeni: ${this.smoke} (premi G / 🌫 per svanire)<br>🎯 Coltelli: ${this.knives} (premi F / 🎯)<br>📜 Sigillo: ${this.save.data.inventory.relic ? '✔' : '—'} · Documento: ${this.save.data.inventory.doc ? '✔' : '—'}</div>`;
  }

  private openProgression(): void {
    this.ui.show('progression', true);
    const el = this.ui.root.querySelector('#prog-body')!;
    el.innerHTML = `<div style="margin-bottom:8px">Livello ${this.xp.level} · Punti disponibili: <b>${availablePoints(this.xp)}</b></div>` +
      UPGRADES.map((u) => {
        const lv = this.xp.upgrades[u.id] ?? 0;
        return `<div style="border:1px solid #3a4a63;border-radius:8px;padding:8px;margin-bottom:6px"><b>${u.name}</b> ${'●'.repeat(lv)}${'○'.repeat(u.max - lv)}<br><span style="color:#9fb0c9;font-size:13px">${u.desc}</span><br><button data-act="buy-${u.id}" style="margin-top:6px;pointer-events:auto;background:#1c2940;color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 12px">Migliora</button></div>`;
      }).join('');
  }

  private openSettings(): void {
    this.ui.show('settings', true);
    this.renderSettings();
  }
  private renderSettings(): void {
    const s = this.save.data.settings;
    const el = this.ui.root.querySelector('#set-body')!;
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;font-size:14px">
        <label>Volume: <input id="set-vol" type="range" min="0" max="100" value="${s.volume * 100}" style="pointer-events:auto"></label>
        <div>Qualità: ${(['low', 'med', 'high'] as const).map((q) => `<button data-act="set-q-${q}" style="pointer-events:auto;margin-right:6px;background:${s.quality === q ? '#e63946' : '#1c2940'};color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">${q}</button>`).join('')}</div>
        <div><button data-act="set-invert" style="pointer-events:auto;background:#1c2940;color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">Inverti Y: ${s.invertY ? 'ON' : 'OFF'}</button></div>
        <label>Sensibilità camera: <input id="set-sens" type="range" min="30" max="200" value="${this.input.sens * 100}" style="pointer-events:auto"></label>
        <div><button data-act="set-wipe" style="pointer-events:auto;background:#3a0f16;color:#ffb0b0;border:1px solid #e63946;border-radius:8px;padding:6px 10px">Cancella salvataggio</button></div>
      </div>`;
    const vol = el.querySelector('#set-vol') as HTMLInputElement | null;
    vol?.addEventListener('input', () => { this.save.data.settings.volume = vol.valueAsNumber / 100; this.audio.setVolume(this.save.data.settings.volume); this.save.save(); });
    const sens = el.querySelector('#set-sens') as HTMLInputElement | null;
    sens?.addEventListener('input', () => { this.input.sens = sens.valueAsNumber / 100; this.save.data.settings.cameraSens = this.input.sens; this.save.save(); });
  }
  private onSetting(a: string): void {
    if (a === 'set-invert') { this.save.data.settings.invertY = !this.save.data.settings.invertY; this.input.invertY = this.save.data.settings.invertY; this.save.save(); this.renderSettings(); }
    if (a.startsWith('set-q-')) {
      const q = a.slice(6) as 'low' | 'med' | 'high';
      this.save.data.settings.quality = q; this.save.save(); this.renderSettings();
      this.ui.toast('Qualità applicata al riavvio missione');
    }
    if (a === 'set-wipe') { this.save.wipe(); this.applySaveToState(); this.renderSettings(); this.refreshMenuSave(); }
  }

  // ---------- FX ----------
  private burst(at: THREE.Vector3, color: number, n: number): void {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3); const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = at.x; pos[i * 3 + 1] = at.y + 1.2; pos[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2; const s = 2 + Math.random() * 4;
      vel[i * 3] = Math.cos(a) * s; vel[i * 3 + 1] = 2 + Math.random() * 3; vel[i * 3 + 2] = Math.sin(a) * s;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.14, transparent: true, opacity: 1 }));
    this.scene.add(pts);
    this.sparks.push(pts); this.sparkVel.push(vel); this.sparkLife.push(0.5);
  }

  private damageNum(at: THREE.Vector3, txt: string): void {
    const d = document.createElement('div');
    d.textContent = txt;
    d.setAttribute('style', 'position:fixed;color:#ffd98a;font-weight:700;font-size:15px;pointer-events:none;z-index:20;text-shadow:0 1px 3px #000');
    const v = at.clone().project(this.cam.camera);
    d.style.left = `${((v.x + 1) / 2) * window.innerWidth}px`;
    d.style.top = `${((1 - v.y) / 2) * window.innerHeight}px`;
    document.body.appendChild(d);
    this.dmgPool.push(d);
    let y = 0;
    const iv = window.setInterval(() => { y += 2; d.style.transform = `translateY(${-y}px)`; d.style.opacity = `${1 - y / 40}`; if (y > 40) { clearInterval(iv); d.remove(); } }, 30);
    if (this.dmgPool.length > 12) this.dmgPool.shift()?.remove();
  }

  private buildSmokePool(): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9aa7bd, transparent: true, opacity: 0.55 });
    const geo = new THREE.SphereGeometry(1.6, 10, 10);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, mat.clone());
      m.visible = false; this.scene.add(m); this.smokePuffs.push(m);
    }
  }

  private popSmoke(at: THREE.Vector3): void {
    let n = 0;
    for (const m of this.smokePuffs) {
      if (m.visible) continue;
      m.visible = true; m.position.set(at.x + (n - 1), 1.2, at.z + (n % 2));
      (m.material as THREE.MeshBasicMaterial).opacity = 0.6;
      m.scale.setScalar(1 + n * 0.4);
      if (++n >= 3) break;
    }
  }

  // ---------- assassination / interaction / tools ----------
  private nearestAssassinTarget(): Enemy | null {
    let best: Enemy | null = null; let bestD = 99;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best || bestD > CFG.combat.assassinRange + 1.6) return null;
    const blocked = this.world.losBlocked(
      this.player.pos.x, this.player.pos.y + 1.5, this.player.pos.z,
      best.pos.x, best.pos.y + 1.2, best.pos.z);
    const behind = best.isBehindOf(this.player.pos.x, this.player.pos.z);
    const fromAbove = this.player.pos.y - best.pos.y > 1.8;
    const check = canAssassinate({
      dist: bestD, blocked, enemyYaw: best.yaw, playerYaw: this.player.yaw,
      enemyAlert: best.inCombat, fromAbove,
      moving: best.moveAmt > 0.4 && !behind && !fromAbove,
    });
    void check;
    // stealth kill allowed when: behind OR crouched-unseen OR from above OR during traversal
    const unseen = !best.inCombat && best.suspicion < 60;
    const traversal = this.player.vaultT > 0 || this.player.airTime > 0.1;
    if (blocked || bestD > CFG.combat.assassinRange + (fromAbove ? 1.6 : 0)) return null;
    if (best.inCombat) return null;
    if (behind || fromAbove || traversal || (this.player.crouch && unseen)) return best;
    return null;
  }

  private tryAssassinate(): void {
    const t = this.nearestAssassinTarget();
    if (!t) { this.ui.toast('Nessun bersaglio furtivo — alle spalle, accovacciato o dall\u2019alto'); return; }
    t.assassinate(this.audio);
    this.burst(t.pos, 0x7dff9e, 16);
    this.ui.killfeed('☠ Eliminazione furtiva');
    this.combatFxKill(t);
    // corpse can be seen by others (handled in AI tick via seeCorpse)
    this.mission.progress++;
    this.checkAssassinateObjective();
    this.save.save();
  }

  private combatFxKill(_t: Enemy): void { this.cam.addShake(0.3); }

  private checkAssassinateObjective(): void {
    const o = currentObjective(this.mission);
    if (o?.kind === 'assassinate') {
      const need = o.count ?? 1;
      if (this.mission.progress >= need && advanceObjective(this.mission)) this.completeMission();
      else this.ui.toast('Obiettivo completato — sparisci!');
    }
  }

  private nearestInteract(): { id: string; label: string; d: number } | null {
    let best: { id: string; label: string; d: number } | null = null;
    for (const it of this.world.interactables) {
      if (it.taken) continue;
      const d = Math.hypot(it.pos.x - this.player.pos.x, it.pos.z - this.player.pos.z);
      if (d < it.radius && (!best || d < best.d)) best = { id: it.id, label: it.label, d };
    }
    return best;
  }

  private tryInteract(): void {
    const it = this.nearestInteract();
    if (!it) return;
    const w = this.world.interactables.find((i) => i.id === it.id)!;
    w.taken = true;
    if (w.mesh) w.mesh.visible = false;
    this.audio.pickup();
    if (it.id === 'relic') this.save.data.inventory.relic = true;
    if (it.id === 'documento' || it.id === 'doc') this.save.data.inventory.doc = true;
    this.ui.killfeed(`✔ ${it.label}`);
    const o = currentObjective(this.mission);
    if (o?.kind === 'collect') {
      const want = (o.target as string) ?? '';
      if (want === it.id || (want === 'documento' && it.id === 'doc') || o.target === undefined) {
        if (advanceObjective(this.mission)) this.completeMission();
        else this.ui.toast('Oggetto recuperato — vai al prossimo obiettivo');
      }
    }
    this.save.save();
  }

  private throwSmoke(): void {
    if (this.smoke <= 0) { this.ui.toast('Nessun fumogeno'); return; }
    this.smoke--;
    this.popSmoke(this.player.pos);
    this.audio.land(false);
    // break contact: all enemies lose player, suspicion halved
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.suspicion = Math.min(e.suspicion, 40);
      if (e.state === 'COMBAT' || e.state === 'ALERT') { e.state = 'SEARCHING'; e.investigate.copy(e.lastKnown); }
    }
    this.ui.toast('🌫 Fumogeno — rompi il contatto!');
  }

  private throwKnife(): void {
    if (this.knives <= 0) { this.ui.toast('Nessun coltello'); return; }
    const from = this.player.pos.clone();
    const hit = this.combat.throwKnife(from, this.player.yaw, this.enemies, (a, b) =>
      this.world.losBlocked(a.x, a.y, a.z, b.x, b.y, b.z));
    this.knives--;
    this.audio.swoosh();
    if (hit) {
      const killed = hit.takeDamage(CFG.combat.throwDmg * this.player.dmgMul, this.player.yaw, false, this.audio);
      this.burst(hit.pos, 0xffd98a, 10);
      this.ui.killfeed(killed ? '🎯 Uccisione con coltello' : '🎯 Coltello a segno');
      if (killed) { this.mission.progress++; this.checkAssassinateObjective(); }
    } else this.ui.toast('Coltello mancato');
  }

  // ---------- main loop ----------
  run(): void {
    this.clock.start();
    const loop = (): void => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.frame(dt);
    };
    loop();
  }

  private frame(dt: number): void {
    // fps meter
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    const t0 = performance.now();
    if (this.screen === 'playing') this.tick(dt);
    else {
      // menu idle: slow orbit around district
      this.time += dt;
      const c = this.cam.camera;
      c.position.set(Math.sin(this.time * 0.1) * 40, 18, Math.cos(this.time * 0.1) * 40);
      c.lookAt(0, 4, 0);
      for (const e of this.enemies) e.syncVisual(dt);
    }
    // fx always
    this.tickFx(dt);
    this.renderer.render(this.scene, this.cam.camera);
    this.frameMs = performance.now() - t0;
    if (this.debug && this.debugEl) this.renderDebug();
    this.save.update(dt);
  }

  private tick(dt: number): void {
    this.time += dt;
    const inp = this.input;
    inp.poll();
    if (inp.pressed.pause) { this.pause(); inp.lateClear(); return; }

    // camera mode
    const anyCombat = this.enemies.some((e) => !e.dead && e.inCombat);
    this.cam.mode = anyCombat ? 'combat' : this.player.crouch ? 'stealth' : 'explore';

    // player
    this.player.update(dt, inp, this.world, this.cam.yaw);
    this.cam.update(dt, inp.state, this.player.pos, this.world, this.player.crouch, this.player.sprinting);

    // fixed 10Hz brain ticks per enemy (accumulator — correct dt, cheap for ≤8 enemies)
    const now = this.time;
    const prefs = { pos: this.player.pos, crouch: this.player.crouch, sprinting: this.player.sprinting, dead: this.player.dead, elevated: this.player.elevated, moving: this.player.moving, yaw: this.player.yaw, attackT: this.player.attackT };
    for (const e of this.enemies) {
      e.acc += dt;
      if (e.acc < 0.1) continue;
      e.acc = Math.min(e.acc - 0.1, 0.2); // no spiral of death
      e.tick(0.1, now, prefs, this.world, this.audio,
        (en) => { this.mission.spotted = true; this.mission.ghost = false; this.ui.killfeed(`Occhio! Individuato dalla guardia #${en.id}!`); },
        () => this.ui.toast('…ti hanno perso di vista. Nasconditi!'));
      // corpse discovery
      for (const c of this.enemies) {
        if (c.dead) e.seeCorpse(c.pos.x, c.pos.z);
      }
    }
    // noises -> hearing (immediate, cheap: dist check)
    for (const n of this.noises) for (const e of this.enemies) e.hear(n);
    this.noises.length = 0;

    // combat
    const res = this.combat.updatePlayerAttack(this.player, this.enemies, this.cam);
    if (res.hits > 0) {
      this.noises.push({ x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, radius: 20, loudness: 1.2, kind: 'fight', t: now });
      if (res.kills > 0) { this.ui.killfeed(res.kills > 1 ? `⚔ ${res.kills} nemici abbattuti!` : '⚔ Nemico abbattuto'); this.mission.progress += res.kills; this.checkAssassinateObjective(); }
    }
    this.combat.updateEnemyAttacks(this.player, this.enemies, () => {
      this.ui.damageFlash(0.7); this.cam.addShake(0.4);
    });

    // assassination prompt + trigger
    this.assassPrompt = this.nearestAssassinTarget();
    if (inp.pressed.assassinate) this.tryAssassinate();
    if (inp.pressed.interact) this.tryInteract();
    if (inp.pressed.smoke) this.throwSmoke();
    if (inp.pressed.knife) this.throwKnife();

    // interact prompt
    const inter = this.nearestInteract();
    if (this.assassPrompt) this.ui.prompt('☠ Q / TAP — assassinio furtivo');
    else if (inter) this.ui.prompt(`✋ E / TAP — ${inter.label}`);
    else this.ui.prompt(null);

    // player attack noise already pushed; hp regen out of combat
    if (!anyCombat && this.player.hp < this.player.hpMax) this.player.heal(4 * this.player.regenMul * dt);

    // mission objective checks (reach / survive / escape)
    this.tickMission(dt, anyCombat);

    // detection HUD = max suspicion
    let maxS = 0;
    for (const e of this.enemies) if (!e.dead) maxS = Math.max(maxS, e.suspicion / 100);
    this.ui.setDetection(maxS, anyCombat);

    // visuals per frame
    for (const e of this.enemies) e.syncVisual(dt);

    // HUD
    const o = currentObjective(this.mission);
    this.ui.setObjectives(this.mission.def.name, this.mission.def.objectives.map((x) => x.text), this.mission.objIndex);
    void o;
    this.ui.setBars(this.player.hp, this.player.hpMax, this.player.stamina, this.player.staminaMax,
      `Liv ${this.xp.level} · +${this.mission.def.rewardXp} XP alla fine`, this.smoke, this.knives);
    this.ui.updateVignette(dt, this.player.hp, this.player.hpMax);
    this.drawMinimap();

    inp.lateClear();
  }

  private tickMission(dt: number, anyCombat: boolean): void {
    const rt = this.mission;
    if (!rt || rt.done || rt.failed) return;
    rt.time += dt;
    // autosave checkpoint periodically
    if (Math.floor(rt.time) % 15 === 0 && dt > 0) {
      this.save.data.checkpoint = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, missionId: rt.def.id };
    }
    const o = currentObjective(rt);
    if (!o) return;
    const p = this.player.pos;
    if (o.kind === 'reach' && o.target instanceof THREE.Vector3) {
      const d = Math.hypot(o.target.x - p.x, o.target.z - p.z);
      const dy = Math.abs((o.target.y ?? 0) - p.y);
      const r = o.radius ?? 4;
      if (d < r && (o.target.y === 0 || dy < 4)) {
        // special: m3 roof needs height
        if (rt.def.id === 'm3-verticale' && o.id === 'climb-roof' && p.y < 7) { /* not yet */ }
        else if (advanceObjective(rt)) this.completeMission();
        else { this.ui.toast('Obiettivo completato!'); this.audio.pickup(); }
      }
    } else if (o.kind === 'survive') {
      const need = o.count ?? 45;
      rt.progress = rt.time;
      if (this.alarmT > 0) { this.alarmT -= dt; if (Math.floor(this.alarmT) % 10 === 0) this.alertAll(); }
      if (rt.time >= need && advanceObjective(rt)) { /* next: escape */ this.ui.toast('Sei sopravvissuto — ora sparisci!'); }
    } else if (o.kind === 'escape' && o.target instanceof THREE.Vector3) {
      const d = Math.hypot(o.target.x - p.x, o.target.z - p.z);
      const nearEnemy = this.enemies.some((e) => !e.dead && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 12);
      if (d < (o.radius ?? 5) && (!anyCombat || !nearEnemy)) {
        if (advanceObjective(rt)) this.completeMission();
      } else if (d < (o.radius ?? 5) && anyCombat) {
        this.ui.prompt('⚔ Semina i nemici prima di sparire!');
      }
    } else if (o.kind === 'collect' && o.target === 'documento') {
      // ensure document interactable exists on east roof
      this.ensureDocument();
    }
    if (rt.def.failOnAlarm && rt.def.id !== 'm5-fuga' && (o.kind === 'ghost' || rt.def.failOnDeath === false)) { /* reserved */ }
  }

  private ensureDocument(): void {
    if (this.world.interactables.some((i) => i.id === 'doc')) return;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xf1fa8c, emissive: 0x554f00 }));
    mesh.position.set(20, 9.6, 0);
    this.scene.add(mesh);
    this.world.interactables.push({ id: 'doc', pos: new THREE.Vector3(20, 9.6, 0), radius: 3, label: 'Prendi il documento', kind: 'doc', taken: false, mesh });
  }

  private drawMinimap(): void {
    const el = this.ui.els['minimap'];
    if (!el) return;
    const S = 110; const R = 46 / (S / 2); // world units per px
    let html = '';
    const dot = (x: number, z: number, c: string, s = 5): string => {
      const dx = (x - this.player.pos.x) / R + S / 2;
      const dz = (z - this.player.pos.z) / R + S / 2;
      if (dx < 0 || dx > S || dz < 0 || dz > S) return '';
      return `<div style="position:absolute;left:${dx - s / 2}px;top:${dz - s / 2}px;width:${s}px;height:${s}px;border-radius:50%;background:${c}"></div>`;
    };
    html += dot(this.player.pos.x, this.player.pos.z, '#7dff9e', 7);
    for (const e of this.enemies) {
      if (e.dead) continue;
      html += dot(e.pos.x, e.pos.z, e.inCombat ? '#e63946' : e.suspicion > 35 ? '#ffb45e' : '#8fa3c1');
    }
    const o = currentObjective(this.mission);
    if (o?.target instanceof THREE.Vector3) html += dot(o.target.x, o.target.z, '#ffd98a', 8);
    if ((el as HTMLElement).dataset['h'] !== html) { el.innerHTML = html; (el as HTMLElement).dataset['h'] = html; }
  }

  private tickFx(dt: number): void {
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const pts = this.sparks[i]; const vel = this.sparkVel[i];
      this.sparkLife[i] -= dt;
      const pos = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < arr.length; j += 3) {
        arr[j] += vel[j] * dt; arr[j + 1] += vel[j + 1] * dt; arr[j + 2] += vel[j + 2] * dt;
        vel[j + 1] -= 9 * dt;
      }
      pos.needsUpdate = true;
      (pts.material as THREE.PointsMaterial).opacity = Math.max(0, this.sparkLife[i] * 2);
      if (this.sparkLife[i] <= 0) {
        this.scene.remove(pts); pts.geometry.dispose(); (pts.material as THREE.Material).dispose();
        this.sparks.splice(i, 1); this.sparkVel.splice(i, 1); this.sparkLife.splice(i, 1);
      }
    }
    for (const m of this.smokePuffs) {
      if (!m.visible) continue;
      m.scale.multiplyScalar(1 + dt * 0.6);
      (m.material as THREE.MeshBasicMaterial).opacity -= dt * 0.12;
      if ((m.material as THREE.MeshBasicMaterial).opacity <= 0) m.visible = false;
    }
  }

  private renderDebug(): void {
    const r = this.renderer.info;
    const aiSummary = this.enemies.map((e) => `#${e.id}:${e.kind[0]}:${e.state}:${Math.round(e.suspicion)}`).join(' ');
    this.debugEl!.textContent =
      `FPS ${this.fps.toFixed(0)} · ${this.frameMs.toFixed(1)}ms\n` +
      `draw ${r.render.calls} · tris ${(r.render.triangles / 1000).toFixed(1)}k · prog ${(r.programs ?? []).length}\n` +
      `mem ${(performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? (((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576).toFixed(0) + 'MB') : 'n/a'}\n` +
      `ply ${this.player.pos.x.toFixed(1)},${this.player.pos.y.toFixed(1)},${this.player.pos.z.toFixed(1)} ${this.player.state}\n` +
      `AI(${this.enemies.filter((e) => !e.dead).length}) ${aiSummary}\n` +
      `mis ${this.mission?.def.id} obj${this.mission?.objIndex} ghost:${this.mission?.ghost}`;
  }
}
