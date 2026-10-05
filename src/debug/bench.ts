// Reproducible in-game benchmark: scenarios A-M + zone reload + HUD/pause overhead.
// Measures avg/min fps, p95 frame time, spikes, draw calls, tris, heap, AI cost.
// Results are ENVIRONMENT-RELATIVE (SwiftShader CPU vs real GPU) — never
// present them as Galaxy A55 hardware measurements.
//
// BOT-MODE CONTRACT (central: src/core/game.ts driveBot / setBot wiring):
// - BenchBotMode (this file) is the full scenario vocabulary, INCLUDING
//   'idle' | 'duel' | 'smoke' which the legacy central bot does not know.
// - If the central implements the OPTIONAL hooks.setBotRaw, the runner passes
//   the full BenchBotMode string through untouched. The central MUST then map
//   unknown strings to safe defaults (recommended: 'idle' -> no input,
//   'duel' -> same branch as 'combat', 'smoke' -> same branch as 'combat').
//   A switch with no matching case (bot stands still) already satisfies this.
// - If hooks.setBotRaw is absent (current central), the runner maps internally
//   via baseBot(): idle -> 'off', duel/smoke -> 'combat', rest pass through,
//   and calls the legacy hooks.setBot. Old implementers keep compiling.
// - hooks.setHud / hooks.setPaused are OPTIONAL; when absent the J scenario
//   still records its normal frame window and notes the hooks as unavailable
//   (no fake overhead numbers are ever recorded).
// - Boot/offline CANNOT be measured in-page: see BENCH_MANUAL_CHECKLIST.
//   Do not invent numbers for them.

/** Full scenario bot vocabulary. Legacy central knows only off/circle/combat/traverse. */
export type BenchBotMode =
  | 'off' | 'circle' | 'combat' | 'traverse'
  | 'idle' | 'duel' | 'smoke';

export interface BenchHooks {
  spawnExtra(n: number): void;
  clearExtra(): void;
  setBot(mode: 'off' | 'circle' | 'combat' | 'traverse'): void;
  reloadZone(): number;
  forceCombat(on: boolean): void;
  info(): {
    calls: number; tris: number; heapMB: number; aiMs: number; enemies: number;
    profile?: string; npcs?: number; aiStates?: string;
  };
  /** OPTIONAL full-fidelity bot passthrough (see contract above). */
  setBotRaw?(mode: BenchBotMode | (string & {})): void;
  /** OPTIONAL HUD visibility hook for the J overhead scenario. */
  setHud?(v: boolean): void;
  /** OPTIONAL pause hook for the J overhead scenario. */
  setPaused?(v: boolean): void;
}

export interface BenchResult {
  scenario: string; enemies: number;
  avgFps: number; minFps: number; p95ms: number; spikes: number;
  calls: number; tris: number; heapMB: number; aiMs: number;
  /** ADDITIVE metadata: central fills via info(); ''/0 when central omits them. */
  profile: string; npcs: number; aiStates: string;
}

export interface BenchScenario {
  id: string; enemies: number; bot: BenchBotMode; combat: boolean; desc: string;
  /** Dense scenario also pops smoke FX (central-side note; bench has no smoke hook). */
  smokeNote?: boolean;
  /** Scenario exercises the optional setHud/setPaused hooks during warmup. */
  hudPause?: boolean;
  /** Crowd scenario: extras via spawnExtra are guards only; civili reuse existing. */
  crowdNote?: boolean;
  /** Measure-window seconds for this scenario (default 5; soak uses 20). */
  durS?: number;
}

export const SCENARIOS: BenchScenario[] = [
  { id: 'A: idle (bot off)', enemies: 0, bot: 'idle', combat: false, desc: 'idle render baseline' },
  { id: 'B: explore (circle)', enemies: 0, bot: 'circle', combat: false, desc: 'locomotion, no combat' },
  { id: 'C: sprint traverse', enemies: 0, bot: 'traverse', combat: false, desc: 'sprint/vault streaming' },
  { id: 'D: duel 1v1', enemies: 0, bot: 'duel', combat: true, desc: 'single combat + fx' },
  { id: 'E: melee 1v5', enemies: 4, bot: 'duel', combat: true, desc: 'melee + fx' },
  { id: 'F: melee 1v10', enemies: 9, bot: 'duel', combat: true, desc: 'crowded combat' },
  { id: 'G: melee 1v15', enemies: 14, bot: 'duel', combat: true, desc: 'stress combat' },
  { id: 'H: dense + smoke', enemies: 9, bot: 'smoke', combat: true, desc: 'civilians + patrols + smoke fx', smokeNote: true },
  { id: 'I: search-AI patrol', enemies: 9, bot: 'circle', combat: false, desc: 'patrol/search AI, no forced combat' },
  { id: 'J: hud + pause overhead', enemies: 0, bot: 'idle', combat: false, desc: 'hud toggle + pause/resume via optional hooks', hudPause: true },
  { id: 'K: smoke + knives VFX', enemies: 9, bot: 'smoke', combat: true, desc: 'smoke + knives VFX (reuses smoke bot)', smokeNote: true },
  { id: 'L: crowd-6 civilians', enemies: 6, bot: 'circle', combat: false, desc: 'crowd: extras are guards only via hooks; civili cannot spawn via hooks — reuses existing + notes closest', crowdNote: true },
  { id: 'M: long soak 20s', enemies: 9, bot: 'duel', combat: true, desc: 'long soak stability (20s measure)', durS: 20 },
];

/** Manual checklist — boot/offline cannot be measured in-page. No fake numbers. */
export const BENCH_MANUAL_CHECKLIST =
  'MANUAL (do not fake numbers): [ ] cold boot to menu <= 3s on target device; ' +
  '[ ] airplane-mode reload playable offline (sw.js cached); [ ] F4 in-page runs attached for A-M + zone.';

/** Map extended bot modes onto the legacy central union. duel/smoke fight like combat. */
export function baseBot(b: BenchBotMode | string): 'off' | 'circle' | 'combat' | 'traverse' {
  if (b === 'idle' || b === 'off') return 'off';
  if (b === 'duel' || b === 'smoke' || b === 'combat') return 'combat';
  if (b === 'traverse') return 'traverse';
  return 'circle';
}

export interface BenchStats { avgFps: number; minFps: number; p95ms: number; spikes: number; }

/** Pure frame-time stats over a millisecond sample array. No allocations by caller. */
export function benchStats(ms: ArrayLike<number>): BenchStats {
  const n = ms.length;
  const sorted = Float32Array.from(ms as ArrayLike<number>).sort();
  let sum = 0;
  let spikes = 0;
  for (let i = 0; i < n; i++) {
    const v = ms[i] ?? 0;
    sum += v;
    if (v > 50) spikes++;
  }
  const avg = sum / Math.max(1, n);
  // min fps over 1s sliding window
  let minFps = 1000;
  let wsum = 0;
  let wcount = 0;
  for (let i = 0; i < n; i++) {
    wsum += ms[i] ?? 0;
    wcount++;
    if (wsum >= 1000 || i === n - 1) {
      minFps = Math.min(minFps, (wcount / wsum) * 1000);
      wsum = 0;
      wcount = 0;
    }
  }
  return {
    avgFps: 1000 / Math.max(avg, 0.01),
    minFps,
    p95ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    spikes,
  };
}

/** Draw-call audit hints (sane mobile thresholds). Pure + tested. */
export function auditHints(info: { calls: number; tris: number }): string[] {
  const out: string[] = [];
  if (info.calls <= 0) {
    out.push('no draw data — run the F4 bench in-page');
    return out;
  }
  if (info.calls > 200) out.push('CRITICAL: calls>200 — merge static props / atlas materials');
  else if (info.calls > 120) out.push('calls>120 — consider merging static props');
  if (info.tris > 300000) out.push('CRITICAL: tris>300k — reduce far geometry / tighten fog cull');
  else if (info.tris > 150000) out.push('tris>150k — reduce far geometry');
  if (out.length === 0) out.push('draw budget OK for A55-class hardware');
  return out;
}

/**
 * Static-prop merging audit (pure + tested). Extends auditHints with the
 * scene-graph children count (group children / prop nodes).
 * children>150 → merge windows/signs into InstancedMesh.
 */
export function staticMergeHints(calls: number, tris: number, children: number): string[] {
  const out: string[] = [];
  if (calls <= 0 && tris <= 0 && children <= 0) {
    out.push('no scene data — run the F4 bench in-page');
    return out;
  }
  if (calls > 200) out.push('CRITICAL: calls>200 — merge static props / atlas materials');
  else if (calls > 120) out.push('calls>120 — consider merging static props');
  if (tris > 300000) out.push('CRITICAL: tris>300k — reduce far geometry / tighten fog cull');
  else if (tris > 150000) out.push('tris>150k — reduce far geometry');
  if (children > 150) out.push('children>150 — merge windows/signs into InstancedMesh');
  else if (children > 80) out.push('children>80 — consider merging static props');
  if (out.length === 0) out.push('static batching OK for A55-class hardware');
  return out;
}

export class BenchRunner {
  active = false;
  private idx = -1;
  private phase: 'warmup' | 'measure' | 'zone' | 'done' = 'warmup';
  private t = 0;
  private frames = new Float32Array(3600);
  private n = 0;
  private zoneTimes: number[] = [];
  private hudMs = -1;
  private pauseMs = -1;
  private hudDone = false;
  private notes: string[] = [];
  results: BenchResult[] = [];
  onDone: (r: BenchResult[], zoneMs: number[]) => void = () => undefined;

  constructor(private hooks: BenchHooks) {}

  /** Human-readable notes (HUD/pause overhead, smoke/manual reminders). Central displays these. */
  extraNotes(): readonly string[] {
    return this.notes;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.idx = -1;
    this.results = [];
    this.zoneTimes = [];
    this.notes = [];
    this.hudMs = -1;
    this.pauseMs = -1;
    this.next();
  }

  private driveBot(bot: BenchBotMode): void {
    const raw = this.hooks.setBotRaw;
    if (raw) {
      raw.call(this.hooks, bot);
      return;
    }
    this.hooks.setBot(baseBot(bot));
  }

  private next(): void {
    this.idx++;
    if (this.idx >= SCENARIOS.length) {
      this.zoneTest();
      return;
    }
    const s = SCENARIOS[this.idx];
    this.hooks.clearExtra();
    this.hooks.spawnExtra(s.enemies);
    this.hooks.forceCombat(s.combat);
    this.driveBot(s.bot);
    if (s.smokeNote) this.notes.push(`${s.id}: smoke FX is central-side; no smoke hook exists in BenchHooks.`);
    if (s.crowdNote) this.notes.push(`${s.id}: extras via spawnExtra are guards only; civili cannot spawn via BenchHooks — reuses existing crowd, notes closest.`);
    this.hudDone = false;
    this.phase = 'warmup';
    this.t = 0;
    this.n = 0;
  }

  private zoneTest(): void {
    this.phase = 'zone';
    this.t = 0;
    this.driveBot('off');
    this.hooks.forceCombat(false);
    this.hooks.clearExtra();
  }

  /** Time the optional HUD/pause hooks once during warmup (never faked, -1 = absent). */
  private probeHudPause(): void {
    if (this.hudDone) return;
    this.hudDone = true;
    const h = this.hooks;
    if (h.setHud) {
      const t0 = performance.now();
      h.setHud(false);
      h.setHud(true);
      this.hudMs = performance.now() - t0;
    }
    if (h.setPaused) {
      const t0 = performance.now();
      h.setPaused(true);
      h.setPaused(false);
      this.pauseMs = performance.now() - t0;
    }
    const s = SCENARIOS[this.idx];
    if (s && s.hudPause) {
      const hud = this.hudMs >= 0 ? `${this.hudMs.toFixed(2)}ms` : 'n/a (no setHud hook)';
      const pau = this.pauseMs >= 0 ? `${this.pauseMs.toFixed(2)}ms` : 'n/a (no setPaused hook)';
      this.notes.push(`${s.id}: hud toggle ${hud}, pause/resume ${pau}.`);
    }
  }

  update(dt: number): BenchResult[] | null {
    if (!this.active) return null;
    const h = this.hooks;
    if (this.phase === 'zone') {
      this.t += dt;
      // 3 zone reloads spaced over frames
      if (this.zoneTimes.length < 3 && this.t > this.zoneTimes.length * 0.5 + 0.1) {
        this.zoneTimes.push(h.reloadZone());
      }
      if (this.zoneTimes.length >= 3) {
        this.active = false;
        this.phase = 'done';
        this.notes.push(BENCH_MANUAL_CHECKLIST);
        this.onDone(this.results, this.zoneTimes);
      }
      return null;
    }
    this.t += dt;
    if (this.phase === 'warmup') {
      const s = SCENARIOS[this.idx];
      if (s && s.hudPause) this.probeHudPause();
      if (this.t >= 1.0) {
        this.phase = 'measure';
        this.t = 0;
        this.n = 0;
      }
      return null;
    }
    // measure window: per-scenario durS (default 5s; soak uses 20s)
    if (this.n < this.frames.length) this.frames[this.n++] = dt * 1000;
    const dur = SCENARIOS[this.idx]?.durS ?? 5;
    if (this.t >= dur) {
      const s = SCENARIOS[this.idx];
      const info = h.info();
      const res = this.compute(s.id, info.enemies);
      res.calls = info.calls;
      res.tris = info.tris;
      res.heapMB = info.heapMB;
      res.aiMs = info.aiMs;
      res.profile = info.profile ?? '';
      res.npcs = info.npcs ?? 0;
      res.aiStates = info.aiStates ?? '';
      this.results.push(res);
      this.next();
    }
    return null;
  }

  private compute(scenario: string, enemies: number): BenchResult {
    const st = benchStats(this.frames.subarray(0, this.n));
    return {
      scenario,
      enemies,
      avgFps: st.avgFps,
      minFps: st.minFps,
      p95ms: st.p95ms,
      spikes: st.spikes,
      calls: 0,
      tris: 0,
      heapMB: 0,
      aiMs: 0,
      profile: '',
      npcs: 0,
      aiStates: '',
    };
  }

  status(): string {
    if (!this.active) return '';
    if (this.phase === 'zone') return `BENCH Z: zone reload ${this.zoneTimes.length}/3`;
    const s = SCENARIOS[this.idx];
    return `BENCH ${s.id} [${this.phase}] ${this.t.toFixed(1)}s`;
  }
}
