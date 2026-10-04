// Reproducible in-game benchmark: scenarios A-H with fixed bot driver.
// Measures avg/min fps, p95 frame time, spikes, draw calls, tris, heap, AI cost.
// Results are ENVIRONMENT-RELATIVE (SwiftShader CPU vs real GPU) — never
// present them as Galaxy A55 hardware measurements.
export interface BenchHooks {
  spawnExtra(n: number): void;
  clearExtra(): void;
  setBot(mode: 'off' | 'circle' | 'combat' | 'traverse'): void;
  reloadZone(): number;
  forceCombat(on: boolean): void;
  info(): { calls: number; tris: number; heapMB: number; aiMs: number; enemies: number };
}

export interface BenchResult {
  scenario: string; enemies: number;
  avgFps: number; minFps: number; p95ms: number; spikes: number;
  calls: number; tris: number; heapMB: number; aiMs: number;
}

const SCENARIOS: Array<{ id: string; enemies: number; bot: 'circle' | 'combat' | 'traverse'; combat: boolean; desc: string }> = [
  { id: 'A: 1 player + 1 enemy', enemies: 0, bot: 'circle', combat: false, desc: 'baseline' },
  { id: 'B: 1 player + 5 enemy', enemies: 4, bot: 'circle', combat: false, desc: 'patrol load' },
  { id: 'C: 1 player + 10 enemy', enemies: 9, bot: 'circle', combat: false, desc: 'crowded' },
  { id: 'D: 1 player + 15 enemy', enemies: 14, bot: 'circle', combat: false, desc: 'stress' },
  { id: 'E: combat x5', enemies: 4, bot: 'combat', combat: true, desc: 'melee + fx' },
  { id: 'F: fast traversal', enemies: 0, bot: 'traverse', combat: false, desc: 'sprint/vault' },
  { id: 'G: dense urban', enemies: 9, bot: 'combat', combat: false, desc: 'civilians + patrols' },
];

export class BenchRunner {
  active = false;
  private idx = -1;
  private phase: 'warmup' | 'measure' | 'zone' | 'done' = 'warmup';
  private t = 0;
  private frames = new Float32Array(900);
  private n = 0;
  private zoneTimes: number[] = [];
  results: BenchResult[] = [];
  onDone: (r: BenchResult[], zoneMs: number[]) => void = () => undefined;

  constructor(private hooks: BenchHooks) {}

  start(): void {
    if (this.active) return;
    this.active = true; this.idx = -1; this.results = []; this.zoneTimes = [];
    this.next();
  }

  private next(): void {
    this.idx++;
    if (this.idx >= SCENARIOS.length) { this.zoneTest(); return; }
    const s = SCENARIOS[this.idx];
    this.hooks.clearExtra();
    this.hooks.spawnExtra(s.enemies);
    this.hooks.forceCombat(s.combat);
    this.hooks.setBot(s.bot);
    this.phase = 'warmup'; this.t = 0; this.n = 0;
  }

  private zoneTest(): void {
    this.phase = 'zone'; this.t = 0;
    this.hooks.setBot('off'); this.hooks.forceCombat(false); this.hooks.clearExtra();
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
        this.active = false; this.phase = 'done';
        this.onDone(this.results, this.zoneTimes);
      }
      return null;
    }
    this.t += dt;
    if (this.phase === 'warmup') {
      if (this.t >= 1.0) { this.phase = 'measure'; this.t = 0; this.n = 0; }
      return null;
    }
    // measure 5s
    if (this.n < this.frames.length) this.frames[this.n++] = dt * 1000;
    if (this.t >= 5.0) {
      const s = SCENARIOS[this.idx];
      const info = h.info();
      const res = this.compute(s.id, info.enemies);
      res.calls = info.calls; res.tris = info.tris; res.heapMB = info.heapMB; res.aiMs = info.aiMs;
      this.results.push(res);
      this.next();
    }
    return null;
  }

  private compute(scenario: string, enemies: number): BenchResult {
    const a = this.frames.subarray(0, this.n);
    const sorted = Float32Array.from(a).sort();
    let sum = 0; let spikes = 0;
    for (let i = 0; i < a.length; i++) { sum += a[i]; if (a[i] > 50) spikes++; }
    const avg = sum / Math.max(1, a.length);
    // min fps over 1s sliding window
    let minFps = 1000;
    let wsum = 0; let wcount = 0;
    for (let i = 0; i < a.length; i++) {
      wsum += a[i]; wcount++;
      if (wsum >= 1000 || i === a.length - 1) { minFps = Math.min(minFps, (wcount / wsum) * 1000); wsum = 0; wcount = 0; }
    }
    return {
      scenario, enemies,
      avgFps: 1000 / Math.max(avg, 0.01), minFps,
      p95ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      spikes, calls: 0, tris: 0, heapMB: 0, aiMs: 0,
    };
  }

  status(): string {
    if (!this.active) return '';
    if (this.phase === 'zone') return `BENCH H: zone reload ${this.zoneTimes.length}/3`;
    const s = SCENARIOS[this.idx];
    return `BENCH ${s.id} [${this.phase}] ${this.t.toFixed(1)}s`;
  }
}
