// UX/UI+Audio+Save/PWA tests (plain node, dependency-free except dev typescript for transpile).
// Covers: input lure/special lifecycle (real InputManager runtime via transpile),
// layout presets, stealth tier, tracker, minimap zoom, flashButton, autoLayout,
// save defaults/migrate/corrupt-fallback/death-persistence (real SaveSystem runtime),
// SW SKIP_WAITING + doc-only fallback + precache, audio method/no-leak audits.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let pass = 0; let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}

const inputSrc = readFileSync(new URL('../src/input/input.ts', import.meta.url), 'utf8');
const uiSrc = readFileSync(new URL('../src/ui/ui.ts', import.meta.url), 'utf8');
const audioSrc = readFileSync(new URL('../src/audio/audio.ts', import.meta.url), 'utf8');
const saveSrc = readFileSync(new URL('../src/save/save.ts', import.meta.url), 'utf8');
const swSrc = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

// ---- transpile real TS modules (input/save have no imports; safe in node) ----
function loadTs(relPath, src) {
  const ts = require('typescript');
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  mkdirSync(join(tmpdir(), 'ux-test'), { recursive: true });
  const f = join(tmpdir(), 'ux-test', relPath.replaceAll('/', '_') + '.cjs');
  writeFileSync(f, out);
  return require(f);
}

// localStorage stub for SaveSystem (Map-backed, no throw)
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

console.log('input actions (runtime):');
const inputMod = loadTs('input', inputSrc);
const mgr = new inputMod.InputManager();
ok('lure' in mgr.state && 'special' in mgr.state, 'InputState includes lure + special');
ok(mgr.state.lure === false && mgr.state.special === false, 'lure/special default false');
mgr.tap('lure');
ok(mgr.pressed.lure === true && mgr.state.lure === true, 'tap(lure) sets pressed + state edge flags');
mgr.tap('special');
ok(mgr.pressed.special === true && mgr.state.special === true, 'tap(special) sets pressed + state edge flags');
mgr.tap('jump');
mgr.lateClear();
ok(mgr.pressed.lure === false && mgr.state.lure === false, 'lateClear clears lure edge flags');
ok(mgr.pressed.special === false && mgr.state.special === false, 'lateClear clears special edge flags');
ok(mgr.pressed.jump === false && mgr.state.jump === false, 'lateClear still clears legacy edge flags');

console.log('input wiring (source audit):');
ok(/case 'KeyT'[\s\S]*?tap\('lure'\)/.test(inputSrc), 'KeyT keyboard binding for lure');
ok(/case 'KeyR'[\s\S]*?tap\('special'\)/.test(inputSrc), 'KeyR keyboard binding for special');
ok(/InputAction/.test(inputSrc) && /'lure'/.test(inputSrc) && /'special'/.test(inputSrc), 'tap() action union includes lure/special');
ok(/edge\(\d+,\s*'lure'\)/.test(inputSrc) && /edge\(\d+,\s*'special'\)/.test(inputSrc), 'gamepad edges for lure/special (dpad)');
ok(/s\.lure\s*=\s*s\.special\s*=\s*false|s\.pause\s*=\s*s\.lure/.test(inputSrc), 'lateClear clears new state flags');

console.log('ui layout + hud (source audit):');
ok(/setLayoutPreset\(p:\s*LayoutPreset\)/.test(uiSrc), 'setLayoutPreset(p) exists');
ok(/LayoutPreset\s*=\s*'default'\s*\|\s*'compact'\s*\|\s*'large'/.test(uiSrc), 'layout presets default/compact/large');
ok(/gridTemplateColumns/.test(uiSrc) && /sys-row/.test(uiSrc), 'preset adjusts act-grid size/position + sys-row');
ok(uiSrc.includes('t-lure') && uiSrc.includes('t-special'), 'act-grid HTML adds t-lure + t-special buttons');
ok(/ESCA/.test(uiSrc) && /FALCE/.test(uiSrc), 'touch buttons labeled ESCA / FALCE');
ok(/tap\('t-lure'/.test(uiSrc) && /tap\('t-special'/.test(uiSrc), 'touch bindings for lure/special in bind()');
ok(/flashButton\(id:\s*string\)/.test(uiSrc), 'flashButton(id) exists');
ok(/this\.flashButton\(id\)/.test(uiSrc), 'tap bindings auto-flash pressed button');
ok(/setStealthTier\(tier:\s*0\s*\|\s*1\s*\|\s*2/.test(uiSrc), 'setStealthTier(tier 0|1|2, label) exists');
ok(/stealthTierCache/.test(uiSrc) && /stealthLabelCache/.test(uiSrc), 'stealth tier throttled (updates only on change)');
ok(/setTracker\(title:\s*string,\s*lines:\s*string\[\],\s*cur:\s*number,\s*timer\?:\s*string\)/.test(uiSrc), 'setTracker(title, lines, cur, timer?) exists');
ok(/setObjectives\(title:\s*string,\s*objs:\s*string\[\],\s*cur:\s*number\)/.test(uiSrc), 'setObjectives kept working');
ok(/setMinimapZoom\(z:\s*1\s*\|\s*2\s*\|\s*3\)/.test(uiSrc) && /minimapZoom:\s*1\s*\|\s*2\s*\|\s*3\s*=\s*1/.test(uiSrc), 'setMinimapZoom + minimapZoom field (zoom store only)');
ok(/autoLayout\(\):\s*LayoutPreset/.test(uiSrc) && /innerHeight\s*<\s*500/.test(uiSrc), 'autoLayout() compacts short screens (height<500)');

console.log('audio (source audit):');
ok(/bark\(kind:\s*'alert'\s*\|\s*'suspicious'\s*\|\s*'attack'\s*\|\s*'down'\)/.test(audioSrc), 'bark(kind) with 4 kinds');
ok(/sting\(state:\s*'suspicious'\s*\|\s*'investigating'\s*\|\s*'combat'\s*\|\s*'lost'\)/.test(audioSrc), 'sting(state) with 4 states');
ok(/footstep\(run:\s*boolean,\s*surface:\s*'stone'\s*\|\s*'metal'\s*\|\s*'wood'\s*=\s*'stone'\)/.test(audioSrc), 'footstep(run, surface?) surface variation, stone default');
ok(/this\.audio\.footstep\(run\)/.test(readFileSync(new URL('../src/player/player.ts', import.meta.url), 'utf8')), 'old footstep(run) call-site still compiles');
ok(/startAmbience\(\):\s*void/.test(audioSrc) && /stopAmbience\(\):\s*void/.test(audioSrc), 'startAmbience/stopAmbience exist');
ok(/ambienceTimer\s*!==\s*null/.test(audioSrc), 'ambience start idempotent (single guarded interval)');
ok(/stopAmbience[\s\S]*?disconnect\(\)/.test(audioSrc), 'stopAmbience disconnects nodes (no AudioNode leak)');
ok(/suspend\(\):\s*void/.test(audioSrc) && /resume\(\):\s*void/.test(audioSrc), 'suspend()/resume() for visibilitychange');
ok(/alert\(\):\s*void/.test(audioSrc) && /suspicious\(\):\s*void/.test(audioSrc), 'legacy alert()/suspicious() preserved');

console.log('save (runtime):');
const saveMod = loadTs('save', saveSrc);
const s0 = new saveMod.SaveSystem();
ok(s0.data.inventory.lure === 1, 'default inventory.lure = 1');
ok(s0.data.settings.layout === 'default' && s0.data.settings.minimapZoom === 1, 'default settings.layout + minimapZoom');
ok(s0.data.worldFlags && typeof s0.data.worldFlags === 'object', 'default worldFlags present');
ok(s0.data.stats.kills === 0 && s0.data.stats.ghosts === 0 && s0.data.stats.deaths === 0 && s0.data.stats.playTime === 0, 'default stats zeroed');
ok(s0.data.unlockedSpecial === false, 'default unlockedSpecial false');
// migrate: old v1-style payload without new fields -> filled with defaults
store.clear();
store.set('shadowline-slot-0', JSON.stringify({ v: 1, slot: 0, missionIndex: 1, xp: 50, inventory: { smoke: 1, knives: 1, relic: false, doc: false }, settings: { volume: 0.5 } }));
const sm = new saveMod.SaveSystem();
const migrated = sm.loadSlot(0);
ok(migrated.inventory.lure === 1 && migrated.settings.layout === 'default', 'migrate fills lure + layout defaults');
ok(migrated.stats.deaths === 0 && migrated.worldFlags && migrated.unlockedSpecial === false, 'migrate fills stats/worldFlags/unlockedSpecial');
// corrupted primary + valid backup -> backup fallback
store.clear();
store.set('shadowline-slot-1', '%%%corrupt%%%');
store.set('shadowline-slot-1-bak', JSON.stringify({ ...saveMod.defaultSave ? {} : {}, v: 2, slot: 1, missionIndex: 2 }));
const sb = new saveMod.SaveSystem();
const fromBak = sb.loadSlot(1);
ok(fromBak.missionIndex === 2, 'corrupted primary falls back to backup slot');
ok(fromBak.inventory.lure === 1 && fromBak.settings.minimapZoom === 1, 'backup fallback still carries new defaults');
// corrupted primary, no backup -> fresh default (never blocks)
store.clear();
store.set('shadowline-slot-2', '{oops');
const sc = new saveMod.SaveSystem();
const fresh = sc.loadSlot(2);
ok(fresh.missionIndex === 0 && fresh.stats.deaths === 0, 'corrupted slot with no backup falls back to default');
// death persistence
store.clear();
const sd = new saveMod.SaveSystem();
sd.loadSlot(0);
sd.saveDie();
ok(sd.data.stats.deaths === 1, 'saveDie() increments deaths');
const sd2 = new saveMod.SaveSystem();
ok(sd2.loadSlot(0).stats.deaths === 1, 'deaths persist across reload');
sd2.bumpStat('kills', 2);
ok(sd2.data.stats.kills === 2, "bumpStat('kills', 2) accumulates");
sd2.bumpStat('ghosts');
ok(sd2.data.stats.ghosts === 1, "bumpStat('ghosts') defaults n=1");
sd2.addPlayTime(12.5);
ok(Math.abs(sd2.data.stats.playTime - 12.5) < 1e-9, 'addPlayTime(dt) accumulates');
ok(typeof sd2.saveMissionComplete === 'function', 'saveMissionComplete helper exists');

console.log('service worker (source audit):');
ok(/'shadowline-v5'/.test(swSrc), 'CACHE v5 after offline strategy change (navigate-first + SWR)');
ok(/SKIP_WAITING/.test(swSrc) && /addEventListener\('message'/.test(swSrc), 'message handler supports SKIP_WAITING');
ok(/controllerchange/.test(swSrc), 'controllerchange reload protocol documented');
ok(/(src\|href)/.test(swSrc), 'precache scrape covers src/href (js/css/fonts)');
ok(/\.png|EXTRA_BEST_EFFORT/.test(swSrc), 'png icons cached (best-effort, never fails install)');
ok(/isDoc/.test(swSrc) && /status:\s*503/.test(swSrc), 'navigation fallback is doc-only (scripts get 503, never HTML MIME breakage)');

console.log('parry flash ui (source audit):');
ok(/flashParry\(quality:\s*'perfect'\s*\|\s*'good'\)/.test(uiSrc), "flashParry(quality:'perfect'|'good') exists");
ok(/parry-flash/.test(uiSrc), 'parry flash uses its own #parry-flash div (vignette pattern)');
ok(/255,\s*215,\s*100/.test(uiSrc), 'perfect flash is gold');
ok(/tickFx\(dt:\s*number\)/.test(uiSrc), 'tickFx(dt) exists for central per-frame fade');
ok(/parryQualityCache/.test(uiSrc), 'parry flash change-guarded (quality cache)');
ok(/parryT/.test(uiSrc) && /opacity/.test(uiSrc), 'tickFx fades parry flash via opacity');

console.log('takedown banner (source audit):');
ok(/banner\(txt:\s*string,\s*sub/.test(uiSrc), 'banner(txt, sub) exists');
ok(/takedown-banner/.test(uiSrc), 'banner pools a single #takedown-banner div');
ok(/1\.2/.test(uiSrc), 'banner shows ~1.2s');
ok(/Georgia/.test(uiSrc), 'banner uses serif font');
ok(/bannerTxtCache/.test(uiSrc) && /bannerSubCache/.test(uiSrc), 'banner change-guarded + queue-max-1 replace (cached txt/sub)');

console.log('debug extra (source audit):');
ok(/setDebugExtra\(lines:\s*string\[\]\)/.test(uiSrc), 'setDebugExtra(lines: string[]) exists');
ok(/debug-extra/.test(uiSrc), 'debug extra renders into lazily-created #debug-extra div');
ok(/debugExtraCache/.test(uiSrc), 'debug extra change-guarded (no per-frame DOM churn)');

console.log('audio surface + whoosh (source audit):');
ok(/setSurface\(s:\s*'stone'\s*\|\s*'metal'\s*\|\s*'wood'\)/.test(audioSrc), "setSurface(s) exists ('stone'|'metal'|'wood')");
ok(/footstepAuto\(run:\s*boolean\)/.test(audioSrc), 'footstepAuto(run) exists using stored surface');
ok(/this\.footstep\(run,\s*this\.surface\)/.test(audioSrc), 'footstepAuto delegates to footstep(run, stored surface)');
ok(/whoosh\(speed:\s*number\)/.test(audioSrc), 'whoosh(speed) exists for sprint/parkour wind');
ok(/whooshNodes/.test(audioSrc) && /if\s*\(!this\.whooshNodes\)/.test(audioSrc), 'whoosh uses single persistent node (singleton, no leak)');
ok(/filter.*bandpass|bandpass.*filter/.test(audioSrc) && /0\.03|Math\.min\(0\.35/.test(audioSrc), 'whoosh is filtered noise with gain by speed');

console.log('mute persistence (runtime + audit):');
ok(/muted:\s*boolean/.test(saveSrc) && /muted:\s*false/.test(saveSrc), 'SaveData settings.muted with default false');
ok(/applyMute\(\):\s*void/.test(audioSrc), 'AudioEngine.applyMute() exists');
ok(/resume\(\)[\s\S]{0,400}applyMute/.test(audioSrc), 'resume() respects mute (re-applies mute)');
const saveMod2 = loadTs('save2', saveSrc);
ok(new saveMod2.SaveSystem().data.settings.muted === false, 'default save muted === false');
store.clear();
store.set('shadowline-slot-0', JSON.stringify({ v: 2, slot: 0, settings: { volume: 0.8 } }));
ok(new saveMod2.SaveSystem().loadSlot(0).settings.muted === false, 'migrate fills muted=false for old saves');

console.log('input consumeAction (runtime):');
ok(typeof mgr.consumeAction === 'function', 'consumeAction(a) helper exists');
mgr.tap('attack');
ok(mgr.consumeAction('attack') === true, 'consumeAction returns true when pressed');
ok(mgr.consumeAction('attack') === false, 'consumeAction second call returns false (edge cleared)');
ok(mgr.pressed.attack === false && mgr.state.attack === false, 'consumeAction clears pressed + state edge');
mgr.tap('parry'); mgr.tap('jump');
mgr.consumeAction('parry');
ok(mgr.pressed.jump === true && mgr.state.jump === true, 'consumeAction only clears the named action');
mgr.lateClear();
ok(mgr.pressed.jump === false, 'lateClear still intact after consumeAction');

console.log(`\nux: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
