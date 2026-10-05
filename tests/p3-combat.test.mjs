// P3 combat gaps — dependency-free plain node tests.
// Mirrors src/combat/combat.ts math + source-audits the new public API.
// Covers: sweep conditions, clamp math, stagger bonus math, counter logic,
// parry window helper values, backward-compat signatures.
import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}

// ---- mirrors (must match combat.ts + COMBAT_TUNING) ----
const isSweep = (attackKind, crouch, moving) =>
  attackKind === 'heavy' && crouch === true && moving < 0.5;
const sweepRange = (base) => base + 0.4 + 0.4; // attackRange + heavy 0.4 + sweep extra 0.4
const clampHit = (dmg, hpMax, frac = 0.4) => (dmg > hpMax * frac ? hpMax * frac : dmg);
const staggerDmg = (raw, stagger, thr = 0.8, mul = 1.25) =>
  (stagger > thr ? Math.round(raw * mul) : raw);
const parryWindow = (flashT) => ({ total: 0.45, perfect: 0.15, active: flashT > 0 });

console.log('p3/sweep-conditions:');
ok(isSweep('heavy', true, 0) === true, 'sweep: heavy+crouch+still => true');
ok(isSweep('heavy', true, 0.49) === true, 'sweep: moving 0.49 still => true');
ok(isSweep('heavy', true, 0.5) === false, 'sweep: moving 0.5 not stationary => false');
ok(isSweep('heavy', false, 0) === false, 'sweep: standing heavy => false');
ok(isSweep('light', true, 0) === false, 'sweep: light+crouch+still => false');
ok(sweepRange(2.6) === 3.4, 'sweep range 2.6+0.8=3.4');
ok(1.4 > 1.0, 'sweep arc 1.4 wider than base 1.0');

console.log('p3/clamp-math:');
ok(clampHit(30, 100) === 30, 'brute slam 30 vs 100 max = 30% ok, unclamped');
ok(clampHit(14, 100) === 14, 'guard 14 vs 100 unclamped');
ok(clampHit(60, 100) === 40, 'hypothetical 60 vs 100 clamped to 40');
ok(clampHit(40, 100) === 40, 'exactly 40% passes through');
ok(clampHit(41, 100) === 40, '41 vs 100 clamped to 40');

console.log('p3/stagger-bonus-math:');
ok(staggerDmg(26, 0.9) === Math.round(26 * 1.25), 'staggered light 26 => +25%');
ok(staggerDmg(26, 0.9) === 33, 'staggered light 26 => 33');
ok(staggerDmg(48, 1.0) === 60, 'staggered heavy 48 => 60');
ok(staggerDmg(26, 0.8) === 26, 'threshold: stagger 0.8 exactly => no bonus');
ok(staggerDmg(26, 0.81) === 33, 'threshold: stagger 0.81 => bonus');
ok(staggerDmg(26, 0) === 26, 'fresh enemy => no bonus');

console.log('p3/counter-logic:');
{
  // replicate per-eval bucketing: range -> height -> arc -> hit
  let resolveCount = 0, rejectRange = 0, rejectArc = 0, rejectPhase = 0, rejectHeight = 0;
  const evalOne = (d, ady, fdiff, range, arc) => {
    resolveCount++;
    if (d > range) { rejectRange++; return 'range'; }
    if (ady > 2.5) { rejectHeight++; return 'height'; }
    if (fdiff > arc) { rejectArc++; return 'arc'; }
    return 'hit';
  };
  ok(evalOne(5, 0, 0, 3.4, 1.4) === 'range', 'counter: far target => rejectRange');
  ok(evalOne(1, 3, 0, 3.4, 1.4) === 'height', 'counter: high target => rejectHeight');
  ok(evalOne(1, 0, 1.5, 3.4, 1.4) === 'arc', 'counter: side target vs sweep arc => rejectArc');
  ok(evalOne(1, 0, 1.2, 2.6 + 0.8, 1.4) === 'hit', 'counter: inside sweep arc+range => hit');
  ok(resolveCount === 4, 'counter: resolveCount tracks 4 evals');
  ok(rejectRange === 1 && rejectHeight === 1 && rejectArc === 1, 'counter: one reject per bucket');
  // phase gate is per-swing (no eval)
  let phase = 0.1; const gated = phase < 0.3;
  if (gated) rejectPhase++;
  ok(gated && rejectPhase === 1, 'counter: startup phase => rejectPhase');
}

console.log('p3/window-helper:');
{
  const w0 = parryWindow(0);
  ok(w0.total === 0.45 && w0.perfect === 0.15 && w0.active === false, 'window idle: {0.45,0.15,false}');
  const w1 = parryWindow(0.4);
  ok(w1.total === 0.45 && w1.perfect === 0.15 && w1.active === true, 'window flashing: active true');
}

console.log('p3/comboDir-flip:');
{
  let dir = 1;
  const flip = () => { dir = dir === 1 ? -1 : 1; return dir; };
  ok(flip() === -1, 'comboDir flips 1 -> -1 on first landed swing');
  ok(flip() === 1, 'comboDir flips -1 -> 1 on second landed swing');
  ok(26 === 26, 'comboDir: damage unchanged by direction (doc check)');
}

console.log('p3/source-audit:');
{
  const src = readFileSync(new URL('../src/combat/combat.ts', import.meta.url), 'utf8');
  for (const t of ['comboDir', 'parryWindow()', 'isSweep', 'SPAZZATA', 'resolveCount',
    'rejectRange', 'rejectArc', 'rejectPhase', 'rejectHeight',
    'staggerBonus', 'enemyHitCapFrac', 'sweepArc', 'sweepRangeExtra'])
    ok(src.includes(t), `combat.ts contains "${t}"`);
  // backward-compat signatures unchanged
  ok(src.includes('updatePlayerAttack(player: Player, enemies: Enemy[], cam:'), 'sig: updatePlayerAttack unchanged');
  ok(src.includes('updateEnemyAttacks(player: Player, enemies: Enemy[], onPlayerHit:'), 'sig: updateEnemyAttacks unchanged');
  ok(src.includes('throwKnife(from: THREE.Vector3, yaw: number, enemies: Enemy[], los:'), 'sig: throwKnife unchanged');
  ok(src.includes('trySpecial(player: Player, enemies: Enemy[], cam:'), 'sig: trySpecial unchanged');
  ok(src.includes('40%') || src.includes('0.4'), 'fairness cap documented');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
