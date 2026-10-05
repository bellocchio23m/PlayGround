// Game orchestrator: renderer, loop, spawning, mission ticks, assassination,
// interactions, tools (smoke/knives), FX pool, minimap, debug overlay, saves.
import * as THREE from 'three';
import { CFG, NoiseEvent } from '../core/config';
import { clamp } from '../core/utils';
import { PROFILES, PerfProfile } from '../core/config';
import { BenchRunner, BenchResult } from '../debug/bench';

const _proj = new THREE.Vector3();
import { World } from '../world/world';
import { Player } from '../player/player';
import { ThirdPersonCamera } from '../camera/tpcamera';
import { InputManager } from '../input/input';
import { Enemy, EnemyKind } from '../ai/enemy';
import { Civilian, civilianSpots, SAFE_ZONES } from '../ai/civilian';
import { AdaptiveQuality } from '../debug/adaptive';
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
  civilians: Civilian[] = [];
  private civT = 0;
  noises: NoiseEvent[] = [];
  screen: GameScreen = 'menu';
  mission!: MissionRuntime;
  missionIndex = 0;
  xp = { xp: 0, level: 1, upgrades: {} as Record<string, number> };
  smoke = 2; knives = 3;
  time = 0; aiAcc = 0; aiIdx = 0;
  aiInterval = 0.1; aiMs = 0; // AI tick cost (EMA ms)
  debug = false;
  fxOn = true; npcOn = true;
  profile: PerfProfile = PROFILES['med'];
  particleMul = 0.8;
  botMode: 'off' | 'circle' | 'combat' | 'traverse' = 'off';
  bench: BenchRunner | null = null;
  adaptive = new AdaptiveQuality();
  lureFxT = 0;
  private botT = 0; private botAtkT = 0;
  private hudT = 0; private mapT = 0; private objCache = '';
  private lastCheckpointSave = -99;
  hitstop = 0;
  debugEl: HTMLElement | null = null;
  battTxt = 'n/a';
  fps = 60; fpsAcc = 0; fpsN = 0; fpsT = 0; frameMs = 0;
  // fx pools (see buildBurstPool/buildSmokePool)
  private smokePuffs: THREE.Mesh[] = [];
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
      noise: (n) => this.pushNoise(n),
      landed: () => undefined,
      died: () => this.onDeath(),
    }, this.audio);
    this.scene.add(this.player.obj);
    this.cam = new ThirdPersonCamera(window.innerWidth / window.innerHeight);
    this.ui = new UI(this.input);
    this.debugEl = this.ui.root.querySelector('#debug-text');
    // battery level for device validation (level only; temperature NOT exposed by browsers)
    try {
      (navigator as unknown as { getBattery?: () => Promise<{ level: number; addEventListener: (t: string, f: () => void) => void }> }).getBattery?.().then((b) => {
        const upd = (): void => { this.battTxt = `${Math.round(b.level * 100)}%`; };
        upd(); b.addEventListener('levelchange', upd);
      }).catch(() => { this.battTxt = 'n/a'; });
    } catch { this.battTxt = 'n/a'; }
    this.combat = new CombatSystem(this.audio, {
      slash: (at) => this.burst(at, 0xe63946, 14),
      spark: (at) => this.burst(at, 0xffd98a, 18),
      damageNum: (at, dmg, kind) => this.damageNum(at, `${dmg}${kind === 'colpo' ? '' : ' ' + kind}`),
    });
    this.ui.onAction = (a) => this.onUiAction(a);
    this.input.init(this.ui.root);
    this.input.sens = this.save.data.settings.cameraSens;
    this.input.invertY = this.save.data.settings.invertY;
    this.ui.setLefty(this.save.data.settings.lefty);
    this.ui.setUiScale(this.save.data.settings.uiScale);
    this.ui.setLayoutPreset(this.save.data.settings.layout);
    this.ui.setMinimapZoom(this.save.data.settings.minimapZoom);
    this.ui.autoLayout();
    this.applySaveToState();
    this.buildSmokePool();
    this.buildBurstPool();
    this.refreshMenuSave();
    this.ui.show('menu', true);
    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.cam.resize(window.innerWidth, window.innerHeight);
      this.ui.autoLayout();
    });
    // PWA update notify: new SW version available
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.ui.toast('Aggiornamento installato — ricarica per la nuova versione', 5000);
      });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'playing') this.pause();
      if (document.hidden) this.audio.suspend(); else this.audio.resume();
    });
    // keyboard shortcuts for panels/debug/bench
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') this.toggleDebug();
      if (e.code === 'Backquote' && this.screen === 'playing') this.pause();
      if (e.code === 'F4' && this.screen === 'playing') this.runBench();
      if (e.code === 'F5' && this.screen === 'playing') { this.fxOn = !this.fxOn; this.ui.toast(`Particelle ${this.fxOn ? 'ON' : 'OFF'}`); }
      if (e.code === 'F6' && this.screen === 'playing') { this.npcOn = !this.npcOn; this.applyNpcVisibility(); this.ui.toast(`NPC ${this.npcOn ? 'ON' : 'OFF'}`); }
      if (e.code === 'F7' && this.screen === 'playing') { this.toggleLamps(); }
      if (e.code === 'F8' && this.screen === 'playing') { this.toggleMinimap(); }
    });
    this.applyProfile(this.save.data.settings.quality);
    this.bench = new BenchRunner({
      spawnExtra: (n) => this.spawnBenchGuards(n),
      clearExtra: () => this.clearBenchGuards(),
      setBot: (m) => { this.botMode = m; this.botT = 0; this.botAtkT = 0; },
      reloadZone: () => this.reloadZone(),
      forceCombat: (on) => { if (on) this.alertAll(); },
      info: () => ({
        calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles,
        heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ? (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576 : -1,
        aiMs: this.aiMs, enemies: this.enemies.filter((e) => !e.dead).length,
      }),
    });
    this.bench.onDone = (r, z) => this.showBenchResults(r, z);
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

  /** central noise bus: generators mask player noise within 9m (distraction/cover play) */
  private pushNoise(n: NoiseEvent): void {
    const gens = (this.world as unknown as { generators?: THREE.Vector3[] }).generators;
    if (gens) {
      for (const g of gens) {
        const d = Math.hypot(g.x - n.x, g.z - n.z);
        if (d < 9) { n.radius *= 0.5; n.loudness *= 0.5; break; }
      }
    }
    this.noises.push(n);
  }

  /** light level at a position: lamps on = 1 falling off, darkness = 0.35 (stealth matters) */
  playerLight(x: number, z: number): number {
    let l = 0.35;
    for (const lamp of this.world.lamps) {
      if (!lamp.visible) continue;
      const d = Math.hypot(lamp.position.x - x, lamp.position.z - z);
      if (d < 24) l = Math.max(l, 1 - (d / 24) * 0.65);
    }
    return Math.min(1, l);
  }
  applyProfile(q: 'low' | 'med' | 'high'): void {
    const p = PROFILES[q] ?? PROFILES['med'];
    this.profile = p;
    this.particleMul = p.particleMul;
    this.aiInterval = 1 / p.aiHz;
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelRatio));
    }
    if (this.scene) {
      this.scene.fog = new THREE.Fog(0x0a0e14, p.fogNear, p.fogFar);
      this.world?.lamps.forEach((l, i) => { l.visible = i < p.lampCount; });
    }
    this.applyNpcVisibility();
    const mm = this.ui?.els['minimap'];
    if (mm) mm.style.display = p.minimap ? 'block' : 'none';
    this.minimapAllowed = p.minimap;
  }
  private minimapAllowed = true;
  private lampsDimmed = false;

  toggleLamps(): void {
    this.lampsDimmed = !this.lampsDimmed;
    this.world.lamps.forEach((l, i) => { l.visible = !this.lampsDimmed && i < this.profile.lampCount; });
    this.ui.toast(`Lampioni ${this.lampsDimmed ? 'OFF' : 'ON'}`);
  }
  toggleMinimap(): void {
    const mm = this.ui.els['minimap'];
    const v = mm.style.display !== 'none';
    mm.style.display = v ? 'none' : 'block';
    this.minimapAllowed = !v;
  }
  applyNpcVisibility(): void {
    for (const c of this.civilians) c.group.visible = this.npcOn && this.profile.civilians;
  }

  // ---------- benchmark hooks ----------
  private benchExtras: Enemy[] = [];
  spawnBenchGuards(n: number): void {
    const kinds = ['guard', 'guard', 'elite', 'guard', 'captain'] as const;
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      const e = new Enemy(kinds[i % kinds.length] as EnemyKind, [
        new THREE.Vector3(Math.cos(a) * 18, 0, Math.sin(a) * 18),
        new THREE.Vector3(Math.cos(a + 2) * 14, 0, Math.sin(a + 2) * 14),
      ]);
      e.pos.y = this.world.groundHeight(e.pos.x, e.pos.z);
      this.attachMarker(e);
      this.enemies.push(e); this.benchExtras.push(e); this.scene.add(e.rig.group);
    }
  }
  clearBenchGuards(): void {
    for (const e of this.benchExtras) {
      this.scene.remove(e.rig.group);
      const i = this.enemies.indexOf(e);
      if (i >= 0) this.enemies.splice(i, 1);
    }
    this.benchExtras = [];
  }
  reloadZone(): number {
    const t0 = performance.now();
    this.scene.remove(this.world.group);
    this.world = new World(this.scene);
    this.world.build();
    this.applyProfile(this.save.data.settings.quality);
    return performance.now() - t0;
  }
  runBench(): void {
    this.ui.toast('Benchmark avviato (A–H)… non toccare i controlli');
    this.bench?.start();
  }
  private benchDiv: HTMLElement | null = null;
  showBenchResults(r: BenchResult[], zoneMs: number[]): void {
    try { localStorage.setItem('shadowline-bench', JSON.stringify({ t: Date.now(), r, zoneMs })); } catch { /* ignore */ }
    if (!this.benchDiv) {
      this.benchDiv = document.createElement('div');
      this.benchDiv.setAttribute('style', 'position:fixed;inset:8% 6%;background:rgba(5,8,12,.94);border:1px solid #3a4a63;border-radius:12px;padding:16px;z-index:60;color:#e8edf5;font:12px/1.5 monospace;overflow:auto;pointer-events:auto');
      document.body.appendChild(this.benchDiv);
    }
    const rows = r.map((x) =>
      `${x.scenario}\n  fps avg ${x.avgFps.toFixed(0)} · min ${x.minFps.toFixed(0)} · p95 ${x.p95ms.toFixed(1)}ms · spike>50ms ${x.spikes} · draw ${x.calls} · tris ${(x.tris / 1000).toFixed(1)}k · heap ${x.heapMB >= 0 ? x.heapMB.toFixed(0) + 'MB' : 'n/a'} · AI ${x.aiMs.toFixed(2)}ms · nemici ${x.enemies}`).join('\n');
    this.benchDiv.style.display = 'block';
    this.benchDiv.innerHTML = `<b>BENCHMARK — ambiente simulato (NON hardware A55)</b><br><pre>${rows}\nH: ricarico zona: ${zoneMs.map((z) => z.toFixed(0) + 'ms').join(', ')}</pre><br><button id="bench-close" style="pointer-events:auto;background:#1c2940;color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:8px 16px">Chiudi (F4 per rieseguire)</button>`;
    this.benchDiv.querySelector('#bench-close')?.addEventListener('click', () => { if (this.benchDiv) this.benchDiv.style.display = 'none'; });
    console.table(r);
  }

  private refreshMenuSave(): void {
    const slots = this.save.listSlots();
    const el = this.ui.root.querySelector('#menu-save');
    const cur = slots[this.save.slotIndex];
    if (el) el.textContent = cur && cur.missionsDone.length
      ? `Slot ${this.save.slotIndex + 1}: ${cur.missionsDone.length}/5 missioni · Liv ${this.xp.level}`
      : `Slot ${this.save.slotIndex + 1}: vuoto — inizia una nuova partita`;
    const row = this.ui.root.querySelector('#menu-slots');
    if (row) {
      row.innerHTML = slots.map((s, i) =>
        `<button data-act="set-slot-${i}" style="pointer-events:auto;background:${i === this.save.slotIndex ? '#e63946' : '#1c2940'};color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 12px">Slot ${i + 1}${s && s.missionsDone.length ? ` (${s.missionsDone.length}/5)` : ''}</button>`).join('');
    }
  }

  // ---------- mission lifecycle ----------
  startMission(i: number): void {
    this.missionIndex = clamp(i, 0, MISSIONS.length - 1);
    const def = MISSIONS[this.missionIndex];
    this.mission = startMission(def);
    this.detachMarkers();
    this.enemies.forEach((e) => this.scene.remove(e.rig.group));
    this.enemies = [];
    this.noises = [];
    this.spawnEnemiesForMission(def.id);
    this.spawnCivilians();
    // reset pickups (missions are replayable; caches restock)
    for (const it of this.world.interactables) {
      it.taken = false;
      if (it.mesh) it.mesh.visible = true;
    }
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
    this.audio.ensure(); this.audio.startMusic(); this.audio.startAmbience();
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
    const mk = (kind: EnemyKind, routeIdx: number, tagTarget = false): void => {
      const e = new Enemy(kind, routes[routeIdx % routes.length]);
      // face along patrol route (away from spawn approaches where possible)
      const r = routes[routeIdx % routes.length];
      if (r.length > 1) e.yaw = Math.atan2(r[1].x - r[0].x, r[1].z - r[0].z) + Math.PI;
      if (tagTarget) (e as unknown as Record<string, unknown>)['isTarget'] = true;
      this.attachMarker(e);
      this.enemies.push(e); this.scene.add(e.rig.group);
    };
    // data-driven spawns (phase-3 missions) with legacy fallback
    const def = MISSIONS.find((m) => m.id === missionId);
    const table = (def as unknown as { spawns?: Array<{ kind: EnemyKind; route: number }> } | undefined)?.spawns;
    if (table && table.length) {
      table.forEach((s, i) => mk(s.kind, s.route, i === 0));
    } else {
      mk('guard', 0); mk('guard', 1); mk('guard', 2);
    }
    if (missionId === 'm2-lama') {
      const lt = new Enemy('elite', [new THREE.Vector3(-4, 0, 16), new THREE.Vector3(4, 0, 20), new THREE.Vector3(-4, 0, 24)]);
      this.attachMarker(lt);
      (lt as unknown as Record<string, unknown>)['isTarget'] = true;
      this.enemies.push(lt); this.scene.add(lt.rig.group);
    } else if (!table?.length) {
      mk('guard', 4);
    }
    if (missionId === 'm3-verticale' || missionId === 'm4-sigillo') { mk('elite', 3); mk('guard', 4); }
    if (missionId === 'm5-fuga') { mk('elite', 0); mk('elite', 1); mk('captain', 4); }
    if (missionId === 'm8-corvo') this.setupBoss();
    // reset lamps to profile (missions must not inherit sabotage), then blackout flag
    this.world.lamps.forEach((l, i) => { l.visible = i < this.profile.lampCount; });
    // apply blackout world-flag (m6 consequence): plaza lamps stay off
    if (this.save.data.worldFlags['blackout-plaza']) this.applyBlackout();
    // place rooftop guard at its roof height
    for (const e of this.enemies) e.pos.y = this.world.groundHeight(e.pos.x, e.pos.z);
  }

  /** m8 boss encounter: Il Corvo — captain with 2 phases (enrage at 50% + summons). */
  private bossEnraged = false;
  private setupBoss(): void {
    this.bossEnraged = false;
    const boss = new Enemy('captain', this.world.patrolRoutes[4] ?? [new THREE.Vector3(0, 0, 20)]);
    (boss as unknown as Record<string, unknown>)['isBoss'] = true;
    (boss as unknown as Record<string, unknown>)['isTarget'] = true;
    this.attachMarker(boss);
    this.enemies.push(boss); this.scene.add(boss.rig.group);
    this.ui.toast('IL CORVO ti aspetta nella piazza. Stealth o acciaio — scegli.', 4200);
    this.audio.sting('combat');
  }

  private tickBoss(dt: number): void {
    void dt;
    const boss = this.enemies.find((e) => (e as unknown as { isBoss?: boolean }).isBoss && !e.dead);
    if (!boss || this.bossEnraged) return;
    if (boss.hp < boss.maxHp * 0.5) {
      this.bossEnraged = true;
      // phase 2: no more attack cooldown (relentless) + mass callout
      boss.atkCD = -999;
      for (const e of this.enemies) {
        if (e === boss || e.dead) continue;
        e.investigate.copy(this.player.pos);
        e.suspicion = 100;
        e.state = 'COMBAT'; e.lastKnown.copy(this.player.pos); e.lastKnownT = this.time;
      }
      this.audio.bark('alert'); this.audio.sting('combat');
      this.ui.toast('IL CORVO si infuria! Fase 2 — arrivano i rinforzi!');
      this.ui.killfeed('BOSS: fase 2');
      this.cam.addShake(0.5);
      let summoned = 0;
      for (let i = 0; i < 2 && summoned < 2; i++) {
        const e = new Enemy('guard', [boss.pos.clone(), new THREE.Vector3(boss.pos.x + 6, 0, boss.pos.z + 6)]);
        e.state = 'COMBAT'; e.lastKnown.copy(this.player.pos); e.lastKnownT = this.time;
        this.attachMarker(e);
        this.enemies.push(e); this.scene.add(e.rig.group);
        summoned++;
      }
    }
  }

  private applyBlackout(): void {
    // plaza lamps (near 0,22) stay dark — m6 consequence
    this.world.lamps.forEach((l) => {
      if (Math.hypot(l.position.x - 0, l.position.z - 22) < 24) l.visible = false;
    });
  }

  private spawnCivilians(): void {
    for (const c of this.civilians) this.scene.remove(c.group);
    this.civilians = [];
    if (this.mission?.def.id === 'm5-fuga') return; // streets empty during alarm
    const spots = civilianSpots();
    const archs = ['vendor', 'walker', 'sweeper', 'courier', 'walker', 'sweeper'] as const;
    const n = this.profile.civilians ? (this.mission?.def.id === 'm8-corvo' ? 2 : 6) : 0;
    for (let i = 0; i < n; i++) {
      const c = new Civilian(spots, i, archs[i % archs.length]);
      c.pos.y = this.world.groundHeight(c.pos.x, c.pos.z);
      // corpse scream -> loud noise that guards investigate (systemic stealth)
      c.onScream = (x, z) => {
        this.pushNoise({ x, y: 0, z, radius: 24, loudness: 1.5, kind: 'scream', t: this.time });
        this.ui.killfeed('Un civile urla!');
        this.audio.sting('combat');
      };
      this.civilians.push(c); this.scene.add(c.group);
    }
    this.applyNpcVisibility();
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

  /** touch-accessible debug toggle (pause menu button + F3). */
  toggleDebug(): void {
    this.debug = !this.debug;
    const box = this.ui.root.querySelector<HTMLElement>('#debug');
    if (box) box.style.display = this.debug ? 'block' : 'none';
    if (this.debug) {
      if (this.screen === 'paused') this.resume();
      this.ui.toast('Debug ON — ▶ BENCH avvia il benchmark');
    }
  }

  private onDeath(): void {
    if (this.screen !== 'playing') return;
    this.save.saveDie();
    this.screen = 'over';
    this.ui.showHud(false);
    this.ui.show('over', true);
    const el = this.ui.root.querySelector('#over-reason');
    if (el) el.textContent = this.mission?.failReason || 'Kestrel è caduto. Riprova dal checkpoint.';
  }

  private completeMission(): void {
    const rt = this.mission;
    rt.done = true;
    const ghostBonus = rt.ghost ? ((rt.def as unknown as { ghostBonusXp?: number }).ghostBonusXp ?? 0) : 0;
    const { levels } = addXp(this.xp, rt.def.rewardXp + ghostBonus);
    if (rt.def.rewardTools?.smoke) this.smoke += rt.def.rewardTools.smoke;
    if (rt.def.rewardTools?.knives) this.knives += rt.def.rewardTools.knives;
    const d = this.save.data;
    if (!d.missionsDone.includes(rt.def.id)) d.missionsDone.push(rt.def.id);
    d.missionIndex = Math.min(this.missionIndex + 1, MISSIONS.length - 1);
    d.xp = this.xp.xp + (this.xp.level - 1) * 140;
    d.upgrades = { ...this.xp.upgrades };
    d.inventory.smoke = this.smoke; d.inventory.knives = this.knives;
    d.inventory.lure = Math.min(3, (d.inventory.lure ?? 1) + 1); // restock lure
    d.bestGhost[rt.def.id] = (d.bestGhost[rt.def.id] ?? true) && rt.ghost;
    // world-state consequences (phase-3 mini-campaign persistence)
    const flag = (rt.def as unknown as { setFlag?: string }).setFlag;
    if (flag) d.worldFlags[flag] = true;
    if (rt.def.id === 'm5-fuga' && !d.unlockedSpecial) {
      d.unlockedSpecial = true;
      this.ui.toast('FALCE LUNARE appresa! (R / FALCE)', 3500);
    }
    if (rt.ghost) this.save.bumpStat('ghosts');
    this.save.saveMissionComplete(rt.def.id, rt.ghost, rt.def.rewardXp + ghostBonus);
    this.screen = 'complete';
    this.ui.showHud(false);
    this.ui.show('complete', true);
    const el = this.ui.root.querySelector('#complete-body');
    if (el) el.innerHTML = `+${rt.def.rewardXp + ghostBonus} XP · Livello ${this.xp.level}${levels ? ` (⬆ +${levels} punti!)` : ''}<br>${rt.ghost ? '👻 FANTASMA — mai individuato!' : ''}<br>Tempo: ${rt.time.toFixed(0)}s`;
    this.audio.stopMusic();
  }

  // ---------- UI actions ----------
  private onUiAction(a: string): void {
    this.audio.ensure(); this.audio.ui();
    switch (a) {
      case 'btn-start': this.save.wipe(); this.applySaveToState(); this.startMission(0); break;
      case 'btn-continue': this.save.loadSlot(this.save.slotIndex); this.applySaveToState(); this.startMission(this.save.data.missionIndex); break;
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
      case 'btn-debug': this.toggleDebug(); break;
      case 'btn-bench': if (this.screen === 'playing') this.runBench(); else this.ui.toast('Avvia una missione prima del bench'); break;
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
        if (a.startsWith('set-slot-')) {
          const i = parseInt(a.slice(9), 10) || 0;
          this.save.loadSlot(i); this.applySaveToState(); this.refreshMenuSave();
          this.audio.ensure();
          break;
        }
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
        <div>Qualità (profilo A55): ${(['low', 'med', 'high'] as const).map((q) => `<button data-act="set-q-${q}" style="pointer-events:auto;margin-right:6px;background:${s.quality === q ? '#e63946' : '#1c2940'};color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">${q === 'med' ? 'MED·A55' : q.toUpperCase()}</button>`).join('')}</div>
        <div><button data-act="set-invert" style="pointer-events:auto;background:#1c2940;color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">Inverti Y: ${s.invertY ? 'ON' : 'OFF'}</button>
        <button data-act="set-lefty" style="pointer-events:auto;background:#1c2940;color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">Mancini: ${s.lefty ? 'ON' : 'OFF'}</button></div>
        <div><button data-act="set-minimap" style="pointer-events:auto;background:#1c2940;color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">Minimappa: ${s.minimap ? 'ON' : 'OFF'}</button>
        <button data-act="set-vib" style="pointer-events:auto;background:#1c2940;color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">Vibrazione: ${this.vibOn ? 'ON' : 'OFF'}</button></div>
        <div>Layout pulsanti: ${(['default', 'compact', 'large'] as const).map((l) => `<button data-act="set-layout-${l}" style="pointer-events:auto;margin-right:6px;background:${s.layout === l ? '#e63946' : '#1c2940'};color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">${l}</button>`).join('')}</div>
        <div>Zoom minimappa: ${([1, 2, 3] as const).map((z) => `<button data-act="set-zoom-${z}" style="pointer-events:auto;margin-right:6px;background:${s.minimapZoom === z ? '#e63946' : '#1c2940'};color:#fff;border:1px solid #3a4a63;border-radius:8px;padding:6px 10px">×${z}</button>`).join('')}</div>
        <label>Dimensione UI: <input id="set-uis" type="range" min="85" max="130" value="${s.uiScale * 100}" style="pointer-events:auto"></label>
        <label>Sensibilità camera: <input id="set-sens" type="range" min="30" max="200" value="${this.input.sens * 100}" style="pointer-events:auto"></label>
        <div><button data-act="set-wipe" style="pointer-events:auto;background:#3a0f16;color:#ffb0b0;border:1px solid #e63946;border-radius:8px;padding:6px 10px">Cancella salvataggio (slot ${this.save.slotIndex + 1})</button></div>
      </div>`;
    const vol = el.querySelector('#set-vol') as HTMLInputElement | null;
    vol?.addEventListener('input', () => { this.save.data.settings.volume = vol.valueAsNumber / 100; this.audio.setVolume(this.save.data.settings.volume); this.save.save(); });
    const sens = el.querySelector('#set-sens') as HTMLInputElement | null;
    sens?.addEventListener('input', () => { this.input.sens = sens.valueAsNumber / 100; this.save.data.settings.cameraSens = this.input.sens; this.save.save(); });
    const uis = el.querySelector('#set-uis') as HTMLInputElement | null;
    uis?.addEventListener('input', () => { this.save.data.settings.uiScale = uis.valueAsNumber / 100; this.ui.setUiScale(this.save.data.settings.uiScale); this.save.save(); });
  }
  vibOn = false;
  private vibrate(ms: number): void {
    if (!this.vibOn) return;
    try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
  }
  private onSetting(a: string): void {
    if (a === 'set-invert') { this.save.data.settings.invertY = !this.save.data.settings.invertY; this.input.invertY = this.save.data.settings.invertY; this.save.save(); this.renderSettings(); }
    if (a === 'set-lefty') { this.save.data.settings.lefty = !this.save.data.settings.lefty; this.ui.setLefty(this.save.data.settings.lefty); this.save.save(); this.renderSettings(); }
    if (a === 'set-minimap') { this.save.data.settings.minimap = !this.save.data.settings.minimap; this.minimapAllowed = this.save.data.settings.minimap && this.profile.minimap; const mm = this.ui.els['minimap']; if (mm) mm.style.display = this.minimapAllowed ? 'block' : 'none'; this.save.save(); this.renderSettings(); }
    if (a === 'set-vib') { this.vibOn = !this.vibOn; this.vibrate(30); this.renderSettings(); }
    if (a.startsWith('set-layout-')) {
      const l = a.slice(11) as 'default' | 'compact' | 'large';
      this.save.data.settings.layout = l; this.ui.setLayoutPreset(l); this.save.save(); this.renderSettings();
    }
    if (a.startsWith('set-zoom-')) {
      const z = parseInt(a.slice(9), 10) as 1 | 2 | 3;
      this.save.data.settings.minimapZoom = z; this.ui.setMinimapZoom(z); this.save.save(); this.renderSettings();
    }
    if (a.startsWith('set-q-')) {
      const q = a.slice(6) as 'low' | 'med' | 'high';
      this.save.data.settings.quality = q; this.save.save(); this.renderSettings();
      this.ui.toast('Qualità applicata al riavvio missione');
    }
    if (a === 'set-wipe') { this.save.wipe(); this.applySaveToState(); this.renderSettings(); this.refreshMenuSave(); }
  }

  // ---------- stealth readability: markers, hidden state, threat direction ----------
  private markQ: THREE.Texture | null = null;
  private markE: THREE.Texture | null = null;
  private hiddenT = 0;
  hidden = false;

  private makeMarker(symbol: string, color: string): THREE.Texture {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d')!;
    g.font = 'bold 44px system-ui,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.85)';
    g.strokeText(symbol, 32, 34); g.fillStyle = color; g.fillText(symbol, 32, 34);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  private attachMarker(e: Enemy): void {
    if (!this.markQ) { this.markQ = this.makeMarker('?', '#ffcf5e'); this.markE = this.makeMarker('!', '#ff5e5e'); }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markQ, depthTest: false, transparent: true }));
    s.scale.setScalar(0.9); s.visible = false;
    e.marker = s;
    this.scene.add(s);
  }

  private detachMarkers(): void {
    for (const e of this.enemies) {
      if (e.marker) { this.scene.remove(e.marker); (e.marker.material as THREE.Material).dispose(); e.marker = null; }
    }
  }

  private updateMarkers(): void {
    for (const e of this.enemies) {
      const m = e.marker;
      if (!m) continue;
      if (e.dead) { m.visible = false; continue; }
      let tex: THREE.Texture | null = null;
      if (e.state === 'COMBAT' || e.state === 'ALERT') tex = this.markE;
      else if (e.windup > 0) tex = this.markE; // telegraphed strike — readable on touch
      else if (e.state === 'SUSPICIOUS' || e.state === 'INVESTIGATING' || e.state === 'SEARCHING') tex = this.markQ;
      else if (e.suspicion > 35) tex = this.markQ;
      if (!tex) { m.visible = false; continue; }
      m.visible = true;
      const mat = m.material as THREE.SpriteMaterial;
      if (mat.map !== tex) { mat.map = tex; mat.needsUpdate = true; }
      // pulse on telegraph
      const s = e.windup > 0 ? 1.1 + Math.sin(this.time * 18) * 0.2 : 0.85;
      m.scale.setScalar(s);
      m.position.set(e.pos.x, e.pos.y + 2.4, e.pos.z);
    }
  }

  /** hidden = crouched + still + unseen by every living enemy (2Hz). Enables fast alarm decay. */
  private updateHidden(dt: number): void {
    this.hiddenT += dt;
    if (this.hiddenT < 0.5) return;
    this.hiddenT = 0;
    const p = this.player;
    let h = p.crouch && p.moving < 0.6 && !p.dead;
    if (h) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d < 6) { h = false; break; } // too close: breathing heard
        if (d < 20 && !this.world.losBlocked(e.pos.x, e.pos.y + 1.6, e.pos.z, p.pos.x, p.pos.y + 0.9, p.pos.z)) { h = false; break; }
      }
    }
    this.hidden = h;
    this.ui.setHidden(h && this.screen === 'playing');
  }

  /** offscreen threat direction indicator (10Hz, caller-throttled) */
  private updateThreat(): void {
    let threat: Enemy | null = null; let best = 50;
    for (const e of this.enemies) {
      if (e.dead || !e.inCombat) continue;
      const s = e.suspicion + (100 - Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z));
      if (s > best) { best = s; threat = e; }
    }
    if (!threat) { this.ui.setThreat(0); return; }
    _proj.set(threat.pos.x, threat.pos.y + 1.5, threat.pos.z).project(this.cam.camera);
    this.ui.setThreat(_proj.z > 1 ? 2 : _proj.x > 0.85 ? 1 : _proj.x < -0.85 ? -1 : 0);
  }
  private burstPool: Array<{ pts: THREE.Points; vel: Float32Array; life: number; max: number }> = [];
  private burstIdx = 0;
  private dmgDivs: HTMLElement[] = [];
  private dmgIdx = 0;
  private dmgAnim = new Map<HTMLElement, number>();

  private buildBurstPool(): void {
    const MAX = 18;
    for (let k = 0; k < 10; k++) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(MAX * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0 }));
      pts.visible = false; pts.frustumCulled = false;
      this.scene.add(pts);
      this.burstPool.push({ pts, vel: new Float32Array(MAX * 3), life: 0, max: MAX });
    }
    for (let i = 0; i < 8; i++) {
      const d = document.createElement('div');
      d.setAttribute('style', 'position:fixed;color:#ffd98a;font-weight:700;font-size:15px;pointer-events:none;z-index:20;text-shadow:0 1px 3px #000;display:none');
      document.body.appendChild(d);
      this.dmgDivs.push(d);
    }
  }

  private burst(at: THREE.Vector3, color: number, n: number): void {
    if (!this.fxOn) return;
    n = Math.max(4, Math.round(n * this.particleMul));
    const b = this.burstPool[this.burstIdx++ % this.burstPool.length];
    const pos = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < b.max; i++) {
      const on = i < n;
      arr[i * 3] = at.x; arr[i * 3 + 1] = at.y + 1.2; arr[i * 3 + 2] = at.z;
      const a = Math.random() * Math.PI * 2; const s = on ? 2 + Math.random() * 4 : 0;
      b.vel[i * 3] = Math.cos(a) * s; b.vel[i * 3 + 1] = on ? 2 + Math.random() * 3 : -999; b.vel[i * 3 + 2] = Math.sin(a) * s;
    }
    pos.needsUpdate = true;
    (b.pts.material as THREE.PointsMaterial).color.setHex(color);
    (b.pts.material as THREE.PointsMaterial).opacity = 1;
    b.pts.visible = true;
    b.life = 0.5;
  }

  private damageNum(at: THREE.Vector3, txt: string): void {
    if (!this.fxOn) return;
    const d = this.dmgDivs[this.dmgIdx++ % this.dmgDivs.length];
    _proj.copy(at).project(this.cam.camera);
    d.style.display = 'block';
    d.textContent = txt;
    d.style.left = `${((_proj.x + 1) / 2) * window.innerWidth}px`;
    d.style.top = `${((1 - _proj.y) / 2) * window.innerHeight}px`;
    d.style.transform = 'translateY(0px)'; d.style.opacity = '1';
    this.dmgAnim.set(d, 0);
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
    // lean over the edge: start the LOS ray slightly toward the target so the
    // platform you stand on doesn't count as a wall (drop-kills stay possible)
    const ox = best.pos.x - this.player.pos.x; const oz = best.pos.z - this.player.pos.z;
    const om = Math.hypot(ox, oz) || 1;
    const ex = this.player.pos.x + (ox / om) * 0.6; const ez = this.player.pos.z + (oz / om) * 0.6;
    // anything below eye level can be leaned over — only real walls block the kill
    const blocked = this.world.losBlocked(
      ex, this.player.pos.y + 1.5, ez,
      best.pos.x, best.pos.y + 1.2, best.pos.z, this.player.pos.y + 1.4);
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
    this.save.bumpStat('kills');
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
    if (it.id === 'documento' || it.id === 'doc' || it.id === 'doc-villa') this.save.data.inventory.doc = true;
    // exploration caches: real gameplay value, capped
    if (it.id === 'cache-smoke' || it.id === 'cache-garden') { this.smoke = Math.min(6, this.smoke + 2); this.ui.toast('Fumogeni +2'); }
    if (it.id === 'cache-knife' || it.id === 'cache-attic') { this.knives = Math.min(8, this.knives + 2); this.ui.toast('Coltelli +2'); }
    if (it.id === 'intel' || it.id === 'cache-canal') {
      const { levels } = addXp(this.xp, 60);
      this.ui.toast(levels > 0 ? `Intel +60 XP — punto abilità guadagnato!` : 'Intel +60 XP');
    }
    // breaker boxes: kill nearby lamps (darkness = stealth) + loud distraction
    if (w.kind === 'breaker') {
      let cut = 0;
      for (const l of this.world.lamps) {
        if (l.visible && Math.hypot(l.position.x - w.pos.x, l.position.z - w.pos.z) < 22) { l.visible = false; cut++; }
      }
      this.pushNoise({ x: w.pos.x, y: 1, z: w.pos.z, radius: 24, loudness: 1.3, kind: 'breaker', t: this.time });
      this.audio.sting('suspicious');
      this.ui.toast(`Quadro elettrico sabotato — ${cut} lampioni spenti`);
    }
    // unlockable shortcuts: add the runtime traversal ledge from world data
    if (w.kind === 'shortcut') {
      const gates = (this.world as unknown as { shortcutGates?: Array<{ id: string; from: THREE.Vector3; to: THREE.Vector3; topY: number }> }).shortcutGates ?? [];
      const gate = gates.find((g) => g.id === it.id);
      if (gate) {
        const min = new THREE.Vector3(Math.min(gate.from.x, gate.to.x) - 0.7, 0, Math.min(gate.from.z, gate.to.z) - 0.7);
        const max = new THREE.Vector3(Math.max(gate.from.x, gate.to.x) + 0.7, gate.topY, Math.max(gate.from.z, gate.to.z) + 0.7);
        this.world.ledges.push({ min, max, topY: gate.topY, kind: gate.topY > 5 ? 'climb' : 'vault' });
        this.ui.toast('Scorciatoia sbloccata!');
        this.audio.pickup();
      }
    }
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

  private throwLure(): void {
    if (this.save.data.inventory.lure <= 0) { this.ui.toast('Nessuna esca'); return; }
    const p = this.player;
    // throw toward facing: 8m ahead, clamped to ground
    const tx = p.pos.x + -Math.sin(p.yaw) * 8;
    const tz = p.pos.z + -Math.cos(p.yaw) * 8;
    const gy = this.world.groundHeight(tx, tz);
    this.save.data.inventory.lure--;
    this.audio.swoosh();
    this.burst(new THREE.Vector3(tx, gy + 0.5, tz), 0x9aa7bd, 8);
    // guards investigate the clatter; civilians glance
    this.pushNoise({ x: tx, y: gy, z: tz, radius: 20, loudness: 1.1, kind: 'lure', t: this.time });
    this.ui.toast('Esca lanciata — li hai distratti');
    this.save.save();
  }

  private trySpecial(): void {
    const p = this.player as unknown as { specialUnlocked?: boolean };
    if (!this.save.data.unlockedSpecial && !p.specialUnlocked) { this.ui.toast('Falce Lunare: completa la missione 5'); return; }
    p.specialUnlocked = true;
    const res = this.combat.trySpecial(this.player, this.enemies, this.cam);
    if (res.hits > 0) {
      this.hitstop = Math.max(this.hitstop, 0.08);
      this.pushNoise({ x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, radius: 22, loudness: 1.3, kind: 'fight', t: this.time });
      if (res.kills > 0) { this.ui.killfeed('FALCE LUNARE!'); this.mission.progress += res.kills; this.checkAssassinateObjective(); }
    } else {
      this.ui.toast(this.combat.isSpecialReady(this.player) ? 'Nessun bersaglio a portata' : `Falce in ricarica (${this.combat.getSpecialCooldown().toFixed(0)}s)`);
    }
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
    // hit-stop: tiny timescale dip on impacts (game feel, no control loss)
    if (this.hitstop > 0) { this.hitstop -= dt; dt *= 0.12; }
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
    this.save.addPlayTime(dt);
    const inp = this.input;
    inp.poll();
    if (this.bench?.active) { /* bot drives input below */ }
    if (inp.pressed.pause) { this.pause(); inp.lateClear(); return; }
    this.driveBot(dt, inp);

    // camera mode
    const anyCombat = this.enemies.some((e) => !e.dead && e.inCombat);
    this.cam.mode = anyCombat ? 'combat' : this.player.crouch ? 'stealth' : 'explore';
    this.audio.setMood(anyCombat ? 'combat' : this.mission.spotted ? 'search' : this.player.sprinting ? 'escape' : 'stealth');

    // player
    this.player.update(dt, inp, this.world, this.cam.yaw);
    this.cam.update(dt, inp.state, this.player.pos, this.world, this.player.crouch, this.player.sprinting);

    // fixed-Hz brain ticks per enemy (profile-driven) + AI cost measurement
    const now = this.time;
    const prefs = { pos: this.player.pos, crouch: this.player.crouch, sprinting: this.player.sprinting, dead: this.player.dead, elevated: this.player.elevated, moving: this.player.moving, yaw: this.player.yaw, attackT: this.player.attackT, hidden: this.hidden, light: this.playerLight(this.player.pos.x, this.player.pos.z) };
    const aiT0 = performance.now();
    for (const e of this.enemies) {
      e.acc += dt;
      if (e.acc < this.aiInterval) continue;
      e.acc = Math.min(e.acc - this.aiInterval, this.aiInterval * 2); // no spiral of death
      e.tick(this.aiInterval, now, prefs, this.world, this.audio,
        (en) => this.onSpotted(en),
        () => { this.ui.toast('…ti hanno perso di vista. Nasconditi!'); this.audio.sting('lost'); });
      // corpse discovery (guards investigate; civilians scream)
      for (const c of this.enemies) {
        if (c.dead) {
          e.seeCorpse(c.pos.x, c.pos.z);
          for (const civ of this.civilians) civ.seeCorpse(c.pos.x, c.pos.z);
        }
      }
    }
    const aiCost = performance.now() - aiT0;
    this.aiMs += (aiCost - this.aiMs) * 0.05;
    // civilians: per-frame cheap move, 2Hz staggered brain
    this.civT += dt;
    const civBrain = this.civT > 0.5;
    if (civBrain) this.civT = 0;
    for (const c of this.civilians) {
      if (civBrain) c.slowTick(0.5, this.world);
      c.update(dt, this.world);
    }
    // noises -> hearing (immediate, cheap: dist check)
    for (const n of this.noises) {
      for (const e of this.enemies) e.hear(n);
      for (const c of this.civilians) c.hearNoise(n);
    }
    this.noises.length = 0;

    // combat
    this.combat.tick(dt);
    const res = this.combat.updatePlayerAttack(this.player, this.enemies, this.cam);
    if (res.hits > 0) {
      this.hitstop = Math.max(this.hitstop, res.kills > 0 ? 0.09 : 0.045);
      this.noises.push({ x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, radius: 20, loudness: 1.2, kind: 'fight', t: now });
      for (const c of this.civilians) c.scare(this.player.pos.x, this.player.pos.z, true);
      if (res.kills > 0) { this.ui.killfeed(res.kills > 1 ? `⚔ ${res.kills} nemici abbattuti!` : '⚔ Nemico abbattuto'); this.mission.progress += res.kills; this.save.bumpStat('kills', res.kills); this.checkAssassinateObjective(); }
    }
    this.combat.updateEnemyAttacks(this.player, this.enemies, () => {
      this.ui.damageFlash(0.7); this.cam.addShake(0.3); this.vibrate(40);
    });

    // assassination prompt + trigger
    this.assassPrompt = this.nearestAssassinTarget();
    if (inp.pressed.assassinate) this.tryAssassinate();
    if (inp.pressed.interact) this.tryInteract();
    if (inp.pressed.smoke) this.throwSmoke();
    if (inp.pressed.knife) this.throwKnife();
    if (inp.pressed.lure) this.throwLure();
    if (inp.pressed.special) this.trySpecial();

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
    this.tickBoss(dt);
    this.resolveRangerKnives();
    this.updateMarkers();
    this.updateHidden(dt);

    // HUD (throttled: objectives cached, bars 10Hz, minimap 4Hz — no per-frame DOM churn)
    this.hudT += dt; this.mapT += dt;
    const okey = `${this.mission.def.id}:${this.mission.objIndex}`;
    if (okey !== this.objCache) {
      this.objCache = okey;
      this.ui.setObjectives(this.mission.def.name, this.mission.def.objectives.map((x) => x.text), this.mission.objIndex);
    }
    if (this.hudT >= 0.1) {
      this.hudT = 0;
      this.ui.setBars(this.player.hp, this.player.hpMax, this.player.stamina, this.player.staminaMax,
        `Liv ${this.xp.level} · +${this.mission.def.rewardXp} XP alla fine`, this.smoke, this.knives);
      this.ui.setContext(this.assassPrompt !== null, this.nearestInteract() !== null, this.smoke, this.knives);
      this.updateThreat();
      // stealth tier HUD: highest enemy suspicion tier
      let tier = 0; let tlabel = '';
      for (const e of this.enemies) {
        if (e.dead) continue;
        const t = (e as unknown as { suspicionTier?: number }).suspicionTier ?? (e.suspicion > 69 ? 2 : e.suspicion > 34 ? 1 : 0);
        if (t > tier) { tier = t; tlabel = t === 2 ? 'ALLARME' : 'sospetto'; }
      }
      this.ui.setStealthTier(tier as 0 | 1 | 2, tlabel);
      // mission tracker with survive timer
      const oo = currentObjective(this.mission);
      const timer = oo?.kind === 'survive' ? `⏱ ${Math.max(0, (oo.count ?? 45) - this.mission.time).toFixed(0)}s` : undefined;
      this.ui.setTracker(this.mission.def.name, this.mission.def.objectives.map((x) => x.text), this.mission.objIndex, timer);
    }
    this.ui.updateVignette(dt, this.player.hp, this.player.hpMax);
    if (this.mapT >= 0.25 && this.minimapAllowed) { this.mapT = 0; this.drawMinimap(); }

    this.bench?.update(dt);
    const bs = this.bench?.status();
    if (bs) this.ui.toastStatus(bs);
    // adaptive quality (robust hysteresis; never mid-fight disruptive, pixelRatio only)
    this.adaptive.update(dt, this.fps, {
      setPixelRatio: (r) => this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, r)),
      setProfile: (q) => { if (q !== this.save.data.settings.quality) { this.save.data.settings.quality = q; this.applyProfile(q); } },
      getProfile: () => this.save.data.settings.quality,
    });

    inp.lateClear();
  }

  /** coordinated alert: spotter shouts, nearby guards join the hunt */
  private onSpotted(spotter: Enemy): void {
    this.mission.spotted = true; this.mission.ghost = false;
    this.ui.killfeed(`Occhio! Individuato dalla guardia #${spotter.id}!`);
    this.audio.bark('alert'); this.audio.sting('combat');
    const shoutR = spotter.kind === 'captain' ? 34 : 22;
    for (const e of this.enemies) {
      if (e === spotter || e.dead || e.inCombat) continue;
      const d = Math.hypot(e.pos.x - spotter.pos.x, e.pos.z - spotter.pos.z);
      if (d < shoutR) {
        e.investigate.copy(this.player.pos);
        e.suspicion = Math.max(e.suspicion, spotter.kind === 'captain' ? 100 : 75);
        if (spotter.kind === 'captain') {
          e.state = 'COMBAT'; e.lastKnown.copy(this.player.pos); e.lastKnownT = this.time;
        } else if (e.state === 'PATROL' || e.state === 'IDLE' || e.state === 'RETURNING' || e.state === 'SUSPICIOUS') {
          e.state = 'INVESTIGATING';
        }
      }
    }
  }

  /** ranger thrown knives: telegraphed projectiles the player can dodge (central resolution) */
  private resolveRangerKnives(): void {
    for (const e of this.enemies) {
      const r = e as unknown as { threwKnife?: boolean };
      if (e.dead || !r.threwKnife) continue;
      r.threwKnife = false; // consumed (contract with enemy.ts)
      const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
      if (d > 15) continue;
      const blocked = this.world.losBlocked(e.pos.x, e.pos.y + 1.5, e.pos.z,
        this.player.pos.x, this.player.pos.y + 1.2, this.player.pos.z);
      if (blocked) continue;
      this.audio.swoosh();
      this.burst(this.player.pos, 0xffd98a, 6);
      if (this.player.dodgeT > 0 || this.player.iframes > 0) { this.ui.toast('Coltello schivato!'); continue; }
      const fromYaw = Math.atan2(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z) + Math.PI;
      if (this.player.takeDamage(12, fromYaw)) { /* applied */ }
      this.ui.damageFlash(0.5); this.cam.addShake(0.25); this.vibrate(30);
    }
  }
  private driveBot(dt: number, inp: InputManager): void {
    if (this.botMode === 'off') return;
    // bench god-mode: measure rendering/AI cost, not bot survival
    if (this.player.hp < 60) this.player.hp = this.player.hpMax;
    this.botT += dt;
    const t = this.botT;
    if (this.botMode === 'circle') {
      inp.state.moveX = Math.cos(t * 0.7); inp.state.moveY = 1;
      inp.state.sprint = true;
    } else if (this.botMode === 'traverse') {
      inp.state.moveX = Math.sin(t * 0.4) * 0.4; inp.state.moveY = 1;
      inp.state.sprint = true;
      if (t - this.botAtkT > 2.2) { this.botAtkT = t; inp.tap('jump'); }
    } else if (this.botMode === 'combat') {
      // face nearest living enemy, strafe + attack
      let best: Enemy | null = null; let bd = 99;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const dx = best.pos.x - this.player.pos.x; const dz = best.pos.z - this.player.pos.z;
        this.player.yaw = Math.atan2(dx, dz) - Math.PI;
        inp.state.moveX = Math.cos(t * 2); inp.state.moveY = bd > 2 ? 1 : 0.2;
        if (t - this.botAtkT > 1.1) { this.botAtkT = t; inp.tap(Math.random() < 0.7 ? 'attack' : 'heavy'); }
        if (Math.random() < dt * 0.5) inp.tap('dodge');
      }
    }
  }

  private tickMission(dt: number, anyCombat: boolean): void {
    const rt = this.mission;
    if (!rt || rt.done || rt.failed) return;
    rt.time += dt;
    // autosave checkpoint every 15s (single write, no per-frame churn)
    if (rt.time - this.lastCheckpointSave > 15) {
      this.lastCheckpointSave = rt.time;
      this.save.data.checkpoint = { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, missionId: rt.def.id };
      this.save.save();
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
    const zoom = this.ui.minimapZoom || 1;
    const S = 110; const R = (46 / (S / 2)) / zoom; // zoomable radius
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
    for (const b of this.burstPool) {
      if (!b.pts.visible) continue;
      b.life -= dt;
      const pos = b.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let j = 0; j < arr.length; j += 3) {
        if (b.vel[j + 1] < -900) continue; // inactive particle
        arr[j] += b.vel[j] * dt; arr[j + 1] += b.vel[j + 1] * dt; arr[j + 2] += b.vel[j + 2] * dt;
        b.vel[j + 1] -= 9 * dt;
      }
      pos.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = Math.max(0, b.life * 2);
      if (b.life <= 0) b.pts.visible = false;
    }
    // pooled damage numbers (no timers, no DOM creation)
    if (this.dmgAnim.size > 0) {
      const done: HTMLElement[] = [];
      this.dmgAnim.forEach((y, d) => {
        const ny = y + dt * 46;
        d.style.transform = `translateY(${-ny}px)`;
        d.style.opacity = `${Math.max(0, 1 - ny / 46)}`;
        if (ny >= 46) { d.style.display = 'none'; done.push(d); }
        else this.dmgAnim.set(d, ny);
      });
      for (const d of done) this.dmgAnim.delete(d);
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
    const alive = this.enemies.filter((e) => !e.dead).length;
    this.debugEl!.textContent =
      `FPS ${this.fps.toFixed(0)} · ${this.frameMs.toFixed(1)}ms\n` +
      `draw ${r.render.calls} · tris ${(r.render.triangles / 1000).toFixed(1)}k · prog ${(r.programs ?? []).length}\n` +
      `heap ${(performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? (((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576).toFixed(0) + 'MB') : 'n/a'} · batt ${this.battTxt} · temp n/a\n` +
      `ent ${alive}E+${this.civilians.length}C · AI ${this.aiMs.toFixed(2)}ms · adapt lv${this.adaptive.level} ${this.adaptive.enabled ? 'on' : 'off'} · Q ${this.save.data.settings.quality}\n` +
      `ply ${this.player.pos.x.toFixed(1)},${this.player.pos.y.toFixed(1)},${this.player.pos.z.toFixed(1)} ${this.player.state}\n` +
      `AI(${alive}) ${aiSummary}\n` +
      `mis ${this.mission?.def.id} obj${this.mission?.objIndex} ghost:${this.mission?.ghost}`;
  }
}
