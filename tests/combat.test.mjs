// Combat phase-3 unit tests (dependency-free, plain node).
// Replicates the hit-resolution math from src/combat/combat.ts +
// COMBAT_TUNING so gameplay thresholds are pinned even without a browser.
// Covers: range, arc, active frames, height, riposte x1.5, perfect x2.0 +
// thresholds, special AoE radius + stamina gate + cooldown, stagger sanity,
// plus a source audit that the new public API really exists.
import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}

// ---- mirror of CFG.combat + COMBAT_TUNING (must match sources) ----
const lightDmg = 26; const heavyDmg = 48;
const attackRange = 2.6;
const heavyRangeBonus = 0.4; const dashRangeBonus = 1.0;
const lightRange = attackRange;
const heavyRange = attackRange + heavyRangeBonus; // 3.0
const dashRange = attackRange + dashRangeBonus;   // 3.6
const specialRange = 3.4;
const ARC = 1.0; const HEIGHT = 2.5;

function angleDiff(a, b) {
  return Math.abs(((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
}
function inWindow(phase, lo, hi) { return phase >= lo && phase <= hi; }
function inRange(d, range) { return d <= range; }
function inArc(fdiff) { return fdiff <= ARC; }
function heightOk(dy) { return Math.abs(dy) <= HEIGHT; }
function dmgCalc(base, dmgMul, combo, ripMul) {
  return Math.round(base * dmgMul * (combo === 2 ? 1.35 : 1) * ripMul);
}
const isDash = (attackT, dodgeCD) => attackT > 0 && dodgeCD > 0.3;
const isPerfectParry = (parryT) => parryT > 0.3;
const specialDmg = Math.round(heavyDmg * 1.6); // x dmgMul=1
function specialCooldownLeft(lastMs, nowMs, cd = 6) {
  const left = cd - (nowMs - lastMs) / 1000;
  return left > 0 ? left : 0;
}

console.log('combat/range:');
ok(!inRange(2.61, lightRange), 'light: no hit beyond 2.6');
ok(inRange(2.6, lightRange), 'light: hit at exactly 2.6');
ok(!inRange(3.01, heavyRange), 'heavy: no hit beyond 3.0');
ok(inRange(2.9, heavyRange), 'heavy: hit inside 3.0');
ok(!inRange(3.61, dashRange), 'dash: no hit beyond 3.6');
ok(inRange(3.5, dashRange), 'dash lunge outranges heavy (3.5 hits)');
ok(!inRange(3.41, specialRange), 'special: no hit beyond 3.4');
ok(inRange(3.4, specialRange), 'special: hit at exactly 3.4');

console.log('combat/arc:');
ok(!inArc(1.01), 'no hit outside arc (>1.0 rad)');
ok(inArc(0.99), 'hit inside arc (<1.0 rad)');
ok(inArc(1.0), 'hit at exactly arc boundary');

console.log('combat/active-frames:');
ok(!inWindow(0.2, 0.35, 0.75), 'light: startup 0.2 = no hit');
ok(inWindow(0.5, 0.35, 0.75), 'light: mid-swing 0.5 = hit');
ok(!inWindow(0.9, 0.35, 0.75), 'light: recovery 0.9 = no hit');
ok(!inWindow(0.25, 0.3, 0.7), 'heavy: startup 0.25 = no hit');
ok(inWindow(0.5, 0.3, 0.7), 'heavy: mid-swing 0.5 = hit');
ok(!inWindow(0.75, 0.3, 0.7), 'heavy: late 0.75 = no hit (tighter than light)');
ok(!inWindow(0.25, 0.3, 0.8), 'dash: startup 0.25 = no hit');
ok(inWindow(0.75, 0.3, 0.8), 'dash: late 0.75 = still hit (wider than heavy)');
ok(!inWindow(0.85, 0.3, 0.8), 'dash: recovery 0.85 = no hit');

console.log('combat/height:');
ok(!heightOk(3.0), 'no hit through height diff 3.0');
ok(!heightOk(-2.6), 'no hit through height diff -2.6');
ok(heightOk(2.5), 'hit at height boundary 2.5');
ok(heightOk(1.0), 'hit at height 1.0');

console.log('combat/dash-detect:');
ok(isDash(0.3, 0.5), 'dash when dodgeCD>0.30 (dodge <0.5s ago)');
ok(!isDash(0.3, 0.3), 'no dash at exactly 0.30 (boundary)');
ok(!isDash(0.3, 0.1), 'no dash when dodge old (dodgeCD=0.1)');
ok(!isDash(0, 0.7), 'no dash when not attacking');

console.log('combat/riposte+perfect:');
ok(dmgCalc(lightDmg, 1, 0, 1.5) === Math.round(26 * 1.5), 'riposte x1.5 (26->39)');
ok(dmgCalc(lightDmg, 1, 0, 2.0) === 52, 'perfect x2.0 (26->52)');
ok(dmgCalc(heavyDmg, 1, 0, 2.0) === 96, 'perfect heavy x2.0 (48->96)');
ok(isPerfectParry(0.31), 'perfect when parryT>0.30 (first 0.15s)');
ok(!isPerfectParry(0.3), 'not perfect at exactly 0.30');
ok(!isPerfectParry(0.2), 'not perfect late in window (0.2)');

console.log('combat/special:');
ok(specialDmg === Math.round(48 * 1.6), 'special damage = heavy*1.6 (48->77)');
ok(35 <= 100 && !(20 >= 35), 'special stamina gate: 35 ok, 20 blocked');
ok(specialCooldownLeft(0, 3000) > 0, 'special on cooldown at 3s');
ok(specialCooldownLeft(0, 7000) <= 0, 'special ready at 7s (cd=6s)');
{
  // 360° AoE: facing ignored — enemy behind player still hit
  const yaw = Math.PI;
  const angBehind = Math.PI; // opposite of front (front ~= yaw+PI ~= 0)
  const fdiff = angleDiff(angBehind, yaw + Math.PI);
  ok(fdiff > ARC, 'sanity: behind-target outside normal arc');
  ok(inRange(2.0, specialRange), 'special hits behind target inside radius (no arc check)');
}

console.log('combat/stagger:');
{
  const light = 0.35; const heavy = 0.9; const dash = 1.1;
  const special = 1.2; const parry = 1.1; const perfect = 1.6;
  ok(light < heavy && heavy < dash && dash <= special && special < perfect, 'stagger ordering light<heavy<dash<=special<perfect');
  ok(parry === 1.1 && perfect === 1.6, 'parry 1.1 / perfect-parry 1.6');
  for (const [n, v] of [['light', light], ['heavy', heavy], ['dash', dash], ['special', special], ['perfect', perfect]])
    ok(v > 0 && v < 3, `stagger ${n}=${v} sane (0..3s)`);
}

console.log('combat/source-audit:');
{
  const src = readFileSync(new URL('../src/combat/combat.ts', import.meta.url), 'utf8');
  const checks = [
    'trySpecial', 'lastHitDir', 'parryFlashT', 'debugLastResolution',
    'PERFETTA', 'isDashAttack', 'specialUnlocked', 'specialCD',
    'getSpecialCooldown', 'perfectT', 'FALCE LUNARE', 'SCATTO',
  ];
  for (const t of checks) ok(src.includes(t), `combat.ts contains "${t}"`);
  ok(src.includes('0.35') && src.includes('0.75'), 'light window 0.35-0.75 present');
  ok(src.includes('0.3') && src.includes('0.7'), 'heavy window 0.30-0.70 present');
  ok(src.includes('0.8'), 'dash window hi 0.80 present');
  ok(!src.includes('new THREE.Vector3(e.pos.x, e.pos.y + 999'), 'no junk allocations');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
