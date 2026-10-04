// Perf/bench unit tests (plain node, no extra dependencies).
// - Source audits pin the documented constants/contracts in
//   src/debug/adaptive.ts and src/debug/bench.ts.
// - Runtime tests exercise the REAL TS code: each .ts file is transpiled
//   with the repo's own typescript (transpileModule, no type-check needed
//   here — `npx tsc --noEmit` covers types) into a tmp .mjs and imported.
//   If typescript is unavailable the runtime sections report SKIP (audit
//   assertions still run); missing runtime is never faked.
// - In-page frame numbers (F4 runs) remain the only source of real fps data.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

let pass = 0; let fail = 0; let skip = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}
function todo(name) { skip++; console.log(`  SKIP - ${name}`); }
function approx(a, b, e = 1e-6) { return Math.abs(a - b) < e; }

const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const adaptiveSrc = src('src/debug/adaptive.ts');
const benchSrc = src('src/debug/bench.ts');

// ---- load REAL TS via the repo's own compiler (no new deps) ----
let adaptive = null; let bench = null;
try {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const out = join(tmpdir(), 'shadowline-perf');
  mkdirSync(out, { recursive: true });
  for (const f of ['adaptive', 'bench']) {
    const text = src(`src/debug/${f}.ts`);
    const js = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2019 },
    }).outputText;
    writeFileSync(join(out, `${f}.mjs`), js);
  }
  const tag = `t=${Date.now()}`;
  adaptive = await import(pathToFileURL(join(out, 'adaptive.mjs')).href + `?${tag}`);
  bench = await import(pathToFileURL(join(out, 'bench.mjs')).href + `?${tag}`);
  console.log('runtime: transpiled src/debug/adaptive.ts + bench.ts (real code)');
} catch (e) {
  console.log(`runtime: typescript unavailable (${e && e.message ? e.message : e}) — runtime sections SKIP`);
}

// stub central hooks; records every profile/ratio change with a timestamp
function stubHooks(profile = 'med') {
  const calls = [];
  let t = 0;
  return {
    hooks: {
      setPixelRatio: (r) => calls.push({ t, kind: 'ratio', v: r }),
      setProfile: (q) => calls.push({ t, kind: 'profile', v: q }),
      getProfile: () => profile,
    },
    calls,
    tick: (dt) => { t += dt; },
  };
}
function drive(a, s, fps, secs, dt = 1 / 60) {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) { s.tick(dt); a.update(dt, fps, s.hooks); }
}

// ================= source audits =================
console.log('audit/adaptive.ts contract:');
ok(adaptiveSrc.includes('class AdaptiveQuality'), 'AdaptiveQuality class exists');
ok(adaptiveSrc.includes('update(dt: number, fps: number, hooks: AdaptiveHooks)'), 'update(dt, fps, hooks) signature');
ok(adaptiveSrc.includes('setPixelRatio(r: number)') && adaptiveSrc.includes('setProfile(q: QualityName)') && adaptiveSrc.includes('getProfile()'), 'hooks setPixelRatio/setProfile/getProfile');
ok(adaptiveSrc.includes('level = 1') && adaptiveSrc.includes('lastChange') && adaptiveSrc.includes('enabled = true'), 'exposes level, lastChange, enabled');
ok(adaptiveSrc.includes('ADAPT_LOW_FPS = 25') && adaptiveSrc.includes('ADAPT_HIGH_FPS = 50'), 'thresholds 25 / 50 fps');
ok(adaptiveSrc.includes('ADAPT_LOW_HOLD_S = 4') && adaptiveSrc.includes('ADAPT_HIGH_HOLD_S = 10'), 'holds 4s down / 10s up');
ok(adaptiveSrc.includes('ADAPT_COOLDOWN_S = 4'), 'cooldown 4s (max one change per 4s)');
ok(adaptiveSrc.includes('0.75') && adaptiveSrc.includes('1.0') && adaptiveSrc.includes('1.5'), 'pixel ratios 0.75/1.0/1.5');
ok(!adaptiveSrc.includes("from '../") && !adaptiveSrc.includes('from "./'), 'zero game coupling (no relative imports)');

console.log('audit/bench.ts contract:');
ok(benchSrc.includes('spawnExtra(n: number)') && benchSrc.includes("setBot(mode: 'off' | 'circle' | 'combat' | 'traverse')")
  && benchSrc.includes('reloadZone(): number') && benchSrc.includes('forceCombat(on: boolean)'), 'legacy BenchHooks required fields unchanged');
ok(benchSrc.includes('setBotRaw?') && benchSrc.includes('setHud?(v: boolean)') && benchSrc.includes('setPaused?(v: boolean)'), 'optional setBotRaw/setHud/setPaused (old implementers compile)');
ok(benchSrc.includes("'idle'") && benchSrc.includes("'duel'") && benchSrc.includes("'smoke'"), 'BenchBotMode includes idle/duel/smoke');
ok(benchSrc.includes('A: idle (bot off)') && benchSrc.includes('B: explore (circle)') && benchSrc.includes('C: sprint traverse'), 'scenarios idle/explore/sprint');
ok(benchSrc.includes('D: duel 1v1') && benchSrc.includes('E: melee 1v5') && benchSrc.includes('F: melee 1v10') && benchSrc.includes('G: melee 1v15'), 'scenarios duel 1v1/1v5/1v10/1v15');
ok(benchSrc.includes('enemies: 4') && benchSrc.includes('enemies: 9') && benchSrc.includes('enemies: 14'), 'extras 4/9/14 for 1v5/1v10/1v15');
ok(benchSrc.includes('H: dense + smoke') && benchSrc.includes('smokeNote'), 'dense+smoke scenario with note flag');
ok(benchSrc.includes('I: search-AI patrol') && benchSrc.includes('J: hud + pause overhead') && benchSrc.includes('hudPause'), 'search-AI + hud/pause scenarios');
ok(benchSrc.includes('profile: string; npcs: number; aiStates: string'), 'BenchResult additive fields profile/npcs/aiStates');
ok(benchSrc.includes('profile?: string') && benchSrc.includes('npcs?: number') && benchSrc.includes("aiStates?: string"), 'info() carries optional profile/npcs/aiStates');
ok(benchSrc.includes("profile: ''") && benchSrc.includes('npcs: 0') && benchSrc.includes("aiStates: ''"), "compute() defaults ''/0 when central omits metadata");
ok(benchSrc.includes('BENCH_MANUAL_CHECKLIST') && benchSrc.includes('offline') && benchSrc.includes('do not fake'), 'boot/offline manual checklist, no fake numbers');
ok(benchSrc.includes('export function auditHints') && benchSrc.includes('calls>120') && benchSrc.includes('tris>150k'), 'auditHints exported with mobile thresholds');
ok(benchSrc.includes('benchStats(this.frames.subarray(0, this.n))'), 'compute() delegates to pure benchStats');
{
  const m = benchSrc.match(/update\(dt: number\)[\s\S]*?\n  \}/);
  ok(!!m && !m[0].includes('new '), 'BenchRunner.update hot path allocates nothing');
}

// ================= runtime: AdaptiveQuality (real code) =================
console.log('runtime/AdaptiveQuality:');
if (!adaptive) {
  for (let i = 0; i < 18; i++) todo('adaptive runtime needs typescript');
} else {
  const { AdaptiveQuality } = adaptive;
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    a.update(1 / 60, 60, s.hooks);
    ok(a.level === 1, 'starts at med (synced from central)');
  }
  {
    const s = stubHooks('low');
    const a = new AdaptiveQuality();
    a.update(1 / 60, 60, s.hooks);
    ok(a.level === 0, 'syncs level 0 from central low profile');
  }
  {
    const s = stubHooks('high');
    const a = new AdaptiveQuality();
    a.update(1 / 60, 60, s.hooks);
    ok(a.level === 2, 'syncs level 2 from central high profile');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 20, 3.9);
    ok(a.level === 1 && s.calls.length === 0, 'no step-down before 4s (3.9s at 20fps)');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 20, 4.2);
    const prof = s.calls.filter((c) => c.kind === 'profile').map((c) => c.v);
    const ratio = s.calls.filter((c) => c.kind === 'ratio').map((c) => c.v);
    ok(a.level === 0 && prof.includes('low') && ratio.includes(0.75), 'steps med->low after 4s <25fps (profile low, ratio 0.75)');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 20, 4.2);
    ok(a.lastChange < 1, `lastChange restarts at 0 after step (${a.lastChange.toFixed(2)}s)`);
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 20, 12);
    ok(a.level === 0 && s.calls.filter((c) => c.kind === 'profile').length === 1, 'floor: exactly one change on 12s low (med->low, no underflow)');
  }
  {
    const s = stubHooks('low');
    const a = new AdaptiveQuality();
    drive(a, s, 20, 12);
    ok(a.level === 0 && s.calls.length === 0, 'floor: no hooks fire when already low');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 60, 9.9);
    ok(a.level === 1 && s.calls.length === 0, 'no step-up before 10s (9.9s at 60fps)');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 60, 10.2);
    const prof = s.calls.filter((c) => c.kind === 'profile').map((c) => c.v);
    const ratio = s.calls.filter((c) => c.kind === 'ratio').map((c) => c.v);
    ok(a.level === 2 && prof.includes('high') && ratio.includes(1.5), 'steps med->high after 10s >50fps (profile high, ratio 1.5)');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 60, 30);
    ok(a.level === 2 && s.calls.filter((c) => c.kind === 'profile').length === 1, 'ceiling: exactly one change on 30s high (no overflow)');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 20, 3.9);
    drive(a, s, 35, 0.5);
    drive(a, s, 20, 3.9);
    ok(a.level === 1 && s.calls.length === 0, 'mid-band fps resets hold timers (3.9+0.5+3.9 low never steps)');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 25, 6);
    ok(a.level === 1 && s.calls.length === 0, 'boundary: exactly 25fps never triggers (exclusive)');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    drive(a, s, 50, 12);
    ok(a.level === 1 && s.calls.length === 0, 'boundary: exactly 50fps never triggers (exclusive)');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    a.enabled = false;
    drive(a, s, 20, 10);
    ok(a.level === 1 && s.calls.length === 0, 'enabled=false blocks stepping');
    a.enabled = true;
    drive(a, s, 20, 4.2);
    ok(a.level === 0, 're-enable resumes stepping');
  }
  {
    const s = stubHooks('med');
    const a = new AdaptiveQuality();
    a.update(0, 10, s.hooks);
    a.update(-1, 10, s.hooks);
    ok(a.level === 1 && s.calls.length === 0, 'dt<=0 ignored safely');
  }
  {
    const a = new AdaptiveQuality();
    a.reset('low');
    const s = stubHooks('high'); // central changed underneath; reset wins until next sync
    a.update(1 / 60, 35, s.hooks);
    ok(a.level === 0, "reset('low') re-arms to level 0");
  }
  {
    // cooldown property: alternating 5s-low / 11s-high blocks; gaps between
    // applied changes must never be < 4s.
    const a = new AdaptiveQuality();
    const profTimes = [];
    let profT = 0;
    const hh = {
      setPixelRatio: () => undefined,
      setProfile: () => { profTimes.push(profT); },
      getProfile: () => 'med',
    };
    const dt = 1 / 60;
    for (let cyc = 0; cyc < 4; cyc++) {
      for (let i = 0; i < Math.round(5 / dt); i++) { profT += dt; a.update(dt, 20, hh); }
      for (let i = 0; i < Math.round(11 / dt); i++) { profT += dt; a.update(dt, 60, hh); }
    }
    let gapsOk = true;
    for (let i = 1; i < profTimes.length; i++) {
      if (profTimes[i] - profTimes[i - 1] < 3.99) gapsOk = false;
    }
    ok(profTimes.length >= 2 && gapsOk, `cooldown: ${profTimes.length} changes, every gap >= 4s`);
  }
}

// ================= runtime: benchStats + auditHints + baseBot (real code) =================
console.log('runtime/benchStats:');
if (!bench) {
  for (let i = 0; i < 7; i++) todo('benchStats runtime needs typescript');
} else {
  const st = bench.benchStats(new Array(300).fill(1000 / 60));
  ok(approx(st.avgFps, 60, 0.5) && st.spikes === 0, `constant 60fps: avg ${st.avgFps.toFixed(1)}, spikes 0`);
  ok(approx(st.p95ms, 1000 / 60, 0.01), `p95 of constant signal = frame time (${st.p95ms.toFixed(3)}ms)`);
  const mixed = [...new Array(100).fill(16.6), 60, 80];
  const st2 = bench.benchStats(mixed);
  ok(st2.spikes === 2, 'spike = frame >50ms (2 spikes)');
  const tail = [...new Array(95).fill(10), ...new Array(5).fill(100)];
  const st3 = bench.benchStats(tail);
  ok(st3.p95ms === 100, `p95 lands on slow tail (${st3.p95ms}ms)`);
  const two = [...new Array(120).fill(1000 / 60), ...new Array(30).fill(1000 / 30)];
  const st4 = bench.benchStats(two);
  ok(st4.minFps < 35 && st4.minFps > 25, `1s sliding minFps tracks slow second (~30, got ${st4.minFps.toFixed(1)})`);
  const st5 = bench.benchStats([]);
  ok(st5.spikes === 0 && Number.isFinite(st5.avgFps) && Number.isFinite(st5.minFps), 'empty sample: finite, no crash');
  ok(approx(bench.benchStats(new Array(60).fill(20)).avgFps, 50, 0.5), '20ms frames average to 50fps');
}

console.log('runtime/auditHints:');
if (!bench) {
  for (let i = 0; i < 8; i++) todo('auditHints runtime needs typescript');
} else {
  const has = (arr, sub) => arr.some((s) => s.includes(sub));
  ok(bench.auditHints({ calls: 60, tris: 80000 }).join('|').includes('OK'), 'healthy budget reports OK');
  const h121 = bench.auditHints({ calls: 121, tris: 80000 });
  ok(has(h121, 'merging static props') && !has(h121, 'CRITICAL'), 'calls>120 suggests merging (non-critical)');
  ok(has(bench.auditHints({ calls: 250, tris: 80000 }), 'CRITICAL'), 'calls>200 escalates to CRITICAL');
  ok(has(bench.auditHints({ calls: 60, tris: 160000 }), 'reduce far geometry'), 'tris>150k suggests reducing far geometry');
  ok(has(bench.auditHints({ calls: 60, tris: 400000 }), 'CRITICAL'), 'tris>300k escalates to CRITICAL');
  ok(has(bench.auditHints({ calls: 0, tris: 0 }), 'no draw data'), 'zero calls reports missing data, never fake OK');
  ok(bench.auditHints({ calls: 120, tris: 150000 }).join('|').includes('OK'), 'boundaries exclusive: 120 calls / 150k tris still OK');
  ok(has(bench.auditHints({ calls: 200, tris: 80000 }), 'merging static props') && !has(bench.auditHints({ calls: 200, tris: 80000 }), 'CRITICAL'), 'exactly 200 calls stays non-critical');
}

console.log('runtime/baseBot mapping:');
if (!bench) {
  for (let i = 0; i < 4; i++) todo('baseBot runtime needs typescript');
} else {
  ok(bench.baseBot('idle') === 'off', "idle maps to legacy 'off'");
  ok(bench.baseBot('duel') === 'combat' && bench.baseBot('smoke') === 'combat', "duel/smoke map to legacy 'combat'");
  ok(bench.baseBot('circle') === 'circle' && bench.baseBot('traverse') === 'traverse' && bench.baseBot('combat') === 'combat', 'legacy modes pass through');
  ok(bench.baseBot('glitch-mode') === 'circle', 'unknown strings fall back to a safe default');
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
process.exit(fail ? 1 : 0);
