// P3 UX+Perf tests (plain node): UI button/boss/noise APIs, input releaseAll,
// audio signature SFX, adaptive pixelRatioFor, bench checklist, SW version.
// Covers ONLY the uxperf-owned surface; existing APIs are audited intact.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

let pass = 0; let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}

const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const uiSrc = src('src/ui/ui.ts');
const inputSrc = src('src/input/input.ts');
const audioSrc = src('src/audio/audio.ts');
const adaptiveSrc = src('src/debug/adaptive.ts');
const benchSrc = src('src/debug/bench.ts');
const swSrc = src('public/sw.js');

const require = createRequire(import.meta.url);
const ts = require('typescript');
const out = join(tmpdir(), 'shadowline-p3-uxperf');
mkdirSync(out, { recursive: true });
async function loadEsm(name, rel) {
  const js = ts.transpileModule(src(rel), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  writeFileSync(join(out, `${name}.mjs`), js);
  return import(pathToFileURL(join(out, `${name}.mjs`)).href + `?t=${Date.now()}-${name}`);
}
const inputMod = await loadEsm('p3input', 'src/input/input.ts');
const adaptiveMod = await loadEsm('p3adaptive', 'src/debug/adaptive.ts');
const benchMod = await loadEsm('p3bench', 'src/debug/bench.ts');
const audioMod = await loadEsm('p3audio', 'src/audio/audio.ts');

console.log('ui new methods (source audit):');
ok(/setButtonScale\(s:\s*number\)/.test(uiSrc), 'setButtonScale(s: number) exists');
ok(/buttonScale/.test(uiSrc) && /0\.5/.test(uiSrc) && /Math\.min\(2/.test(uiSrc), 'setButtonScale clamps to [0.5, 2], transient (no save)');
ok(/if \(v === this\.buttonScale\) return/.test(uiSrc), 'setButtonScale change-guarded (no-op when unchanged)');
ok(/flashPrompt\(\):\s*void/.test(uiSrc), 'flashPrompt() exists');
ok(/promptPulseTimer/.test(uiSrc) && /clearTimeout\(this\.promptPulseTimer/.test(uiSrc), 'flashPrompt re-arms timer (pulse, no stacking)');
ok(/setBossBar\(name:\s*string\s*\|\s*null,\s*frac:\s*number\)/.test(uiSrc), 'setBossBar(name: string|null, frac: number) exists');
ok(/bossCache/.test(uiSrc) && /Math\.round\(f \* 200\)/.test(uiSrc), 'setBossBar throttled (cached name + rounded frac)');
ok(/setNoiseRing\(level:\s*0\s*\|\s*1\s*\|\s*2\)/.test(uiSrc), 'setNoiseRing(level: 0|1|2) exists');
ok(/noiseCache/.test(uiSrc) && /RUMORE/.test(uiSrc), 'setNoiseRing change-guarded RUMORE badge');
ok(/setLayoutPreset\(p:\s*LayoutPreset\)/.test(uiSrc) && /this\.buttonScale/.test(uiSrc), 'setLayoutPreset respects buttonScale (existing API kept)');
ok(/setTracker\(title:\s*string,\s*lines:\s*string\[\],\s*cur:\s*number,\s*timer\?:\s*string\)/.test(uiSrc), 'setTracker kept working');

console.log('input releaseAll (runtime):');
{
  const m = new inputMod.InputManager();
  m.state.sprint = true;
  m.tap('jump');
  m.releaseAll();
  ok(m.state.sprint === false && m.state.moveX === 0 && m.state.camDX === 0, 'releaseAll clears sprint holds + move/cam deltas');
  const m2 = new inputMod.InputManager();
  m2.setHold('sprint', true);
  m2.setHold('crouch', true);
  m2.releaseAll();
  ok(m2.state.sprint === false && m2.state.crouch === false, 'releaseAll clears sprint/crouch holds');
  m2.releaseAll();
  ok(m2.state.sprint === false && m2.state.crouch === false, 'releaseAll re-entrant (double call safe)');
  ok(/releaseAll\(\):\s*void/.test(inputSrc) && /joyId = -1/.test(inputSrc) && /camId = -1/.test(inputSrc), 'releaseAll resets both touch zones (joyId + camId)');
  ok(/Re-entrant/.test(inputSrc) && /MULTITOUCH/.test(inputSrc), 'tap/setHold re-entrancy + multitouch zones documented');
}

console.log('audio new sfx (audit + prototype):');
{
  const proto = audioMod.AudioEngine.prototype;
  ok(typeof proto.sprintWhoosh === 'function', 'sprintWhoosh() exists');
  ok(typeof proto.roll === 'function', 'roll() exists');
  ok(typeof proto.smokeHiss === 'function', 'smokeHiss() exists');
  ok(typeof proto.lureClack === 'function', 'lureClack() exists');
  ok(typeof proto.pain === 'function', 'pain(kind) exists');
  ok(/pain\(kind:\s*'guard'\s*\|\s*'elite'\s*\|\s*'brute'\s*\|\s*'ranger'\)/.test(audioSrc), 'pain pitch variants guard/elite/brute/ranger');
  ok(/'roof'/.test(audioSrc) && /footstep\(run:\s*boolean,\s*surface:.*=\s*'stone'\)/.test(audioSrc), "footstep surface extended with 'roof', stone default kept");
  const intervals = (audioSrc.match(/setInterval/g) || []).length;
  ok(intervals === 3, `audio keeps guarded intervals only (music start + re-arm + ambience, got ${intervals})`);
  const bodies = ['sprintWhoosh', 'roll', 'smokeHiss', 'lureClack', 'pain'].map((m) => {
    const i = audioSrc.indexOf(m + '(');
    return audioSrc.slice(i, i + 600);
  }).join('\n');
  ok(!/setInterval|setTimeout/.test(bodies), 'new SFX are one-shot (no timers)');
  ok(/bark\(kind:/.test(audioSrc) && /sting\(state:/.test(audioSrc) && /alert\(\):\s*void/.test(audioSrc), 'bark/sting/legacy alert kept working');
}

console.log('adaptive pixelRatioFor (runtime):');
{
  ok(typeof adaptiveMod.pixelRatioFor === 'function', 'pixelRatioFor(level) exported');
  ok(adaptiveMod.pixelRatioFor(0) === 0.75, 'pixelRatioFor(0) = 0.75');
  ok(adaptiveMod.pixelRatioFor(1) === 1.0, 'pixelRatioFor(1) = 1.0');
  ok(adaptiveMod.pixelRatioFor(2) === 1.5, 'pixelRatioFor(2) = 1.5');
  ok(adaptiveMod.pixelRatioFor(99) === 1.5 && adaptiveMod.pixelRatioFor(-5) === 0.75, 'pixelRatioFor clamps out-of-range levels');
}

console.log('bench checklist (runtime + audit):');
{
  ok(typeof benchMod.BENCH_MANUAL_CHECKLIST === 'string' && benchMod.BENCH_MANUAL_CHECKLIST.length > 0, 'BENCH_MANUAL_CHECKLIST non-empty');
  const c = benchMod.BENCH_MANUAL_CHECKLIST;
  ok(/save/i.test(c), 'checklist covers save round-trip');
  ok(/pause\/resume/i.test(c), 'checklist covers pause/resume');
  ok(/reload/i.test(c), 'checklist covers reload stability');
  ok(/do not fake/i.test(c) && /offline/i.test(c), 'checklist keeps no-fake-numbers + offline wording');
  ok(typeof benchMod.BenchRunner.prototype.extraNotes === 'function', 'bench.extraNotes() kept working');
}

console.log('sw version (audit):');
{
  ok(/const VERSION = 'v3'/.test(swSrc), "VERSION = 'v3' const present");
  ok(/'shadowline-v3'/.test(swSrc), 'CACHE stays v3 (no churn)');
  ok(/cannot export to the page/i.test(swSrc) && /controllerchange/i.test(swSrc), 'doc-only fallback intact (page uses controllerchange)');
  ok(/isDoc \? caches\.match/.test(swSrc), 'navigation fallback still doc-only');
  ok(/\.png|EXTRA_BEST_EFFORT/.test(swSrc), 'png icons best-effort precache kept');
}

console.log(`\np3-uxperf: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
