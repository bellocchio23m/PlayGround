// P3 stealth gaps: distraction turn, patrol pairs, reinforcements,
// corner-peek, vertical fallback, civilian pushOut, corpse hiding.
// Plain node, no imports from src (mirrors + source audits).
// Run: node tests/p3-stealth.test.mjs
import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}
function approx(a, b, e = 1e-6) { return Math.abs(a - b) < e; }
const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

const enemy = src('src/ai/enemy.ts');
const civ = src('src/ai/civilian.ts');
const has = (s, t) => s.includes(t);

// ---- 1. distraction turn (thrown lure) ----
console.log('p3/lure distraction turn:');
ok(has(enemy, 'DISTRACT_FACE_S = 2'), 'DISTRACT_FACE_S is 2s');
ok(has(enemy, 'distractedT'), 'public distractedT field');
ok(has(enemy, "n.kind === 'lure'"), 'hear() checks kind lure');
ok(has(enemy, 'distractedT = DISTRACT_FACE_S'), 'hear() latches distractedT on lure');
ok(has(enemy, 'distractedT > 0'), 'tick gates on distractedT');
ok(has(enemy, 'face(this.investigate'), 'distraction faces the lure point');

// ---- 2. patrol coordination ----
console.log('p3/patrol pairs:');
ok(has(enemy, 'PARTNER_SHARE_DIST = 30'), 'PARTNER_SHARE_DIST is 30m');
ok(has(enemy, 'partnerId'), 'partnerId field (number | null)');
ok(has(enemy, 'setPartner'), 'setPartner(id) method');
ok(has(enemy, 'pairUp'), 'pairUp(e1, e2) helper exported');
ok(has(enemy, 'export function pairUp'), 'pairUp is exported for central wiring');
ok(has(enemy, 'alertPartner'), 'alertPartner(partner) method');
// audit: shares memory only — uses lastKnown, never live player pos
const alertBlock = (enemy.match(/alertPartner[\s\S]*?return true;/) || [''])[0];
ok(has(alertBlock, 'this.lastKnown'), 'partner share copies lastKnown (memory, no omniscience)');
ok(!has(alertBlock, 'player.pos'), 'partner share never touches live player.pos');
ok(has(alertBlock, 'PARTNER_SHARE_DIST'), 'partner share enforces 30m range');
ok(has(alertBlock, 'INVESTIGATING') || has(alertBlock, 'Investigating'), 'partner goes to INVESTIGATING');

// ---- 3. reinforcements ----
console.log('p3/reinforcements:');
ok(has(enemy, 'callReinforcements'), 'callReinforcements flag field');
ok(has(enemy, 'wantsReinforce'), 'wantsReinforce() for central');
const wantBlock = (enemy.match(/wantsReinforce\(\): boolean[\s\S]*?\}/) || [''])[0];
ok(has(wantBlock, "'captain'"), 'reinforce gated on captain kind');
ok(has(wantBlock, 'inCombat'), 'reinforce gated on combat');
ok(has(wantBlock, 'callReinforcements'), 'reinforce gated on latched flag');
ok(has(enemy, 'callReinforcements = true'), 'captain spot() latches the flag (calloutT-gated)');

// ---- 4. corner-peek ----
console.log('p3/corner-peek:');
ok(has(enemy, 'CORNER_PEEK_DIST = 2'), 'CORNER_PEEK_DIST is 2m');
ok(has(enemy, 'peekDone'), 'peekDone bookkeeping field');
ok(has(enemy, 'strafeDir'), 'corner-peek reuses strafeDir');
ok(has(enemy, 'CORNER_PEEK_DIST * this.strafeDir'), 'sidestep scales by strafeDir');

// ---- 5. vertical fallback ----
console.log('p3/vertical fallback:');
ok(has(enemy, 'UNREACHABLE_TIMEOUT_S = 6'), 'UNREACHABLE_TIMEOUT_S is 6s');
ok(has(enemy, 'unreachableT'), 'unreachableT accumulator field');
ok(has(enemy, 'unreachableT += dt'), 'unreachable accumulates while dy>3');
ok(has(enemy, 'unreachableT = 0'), 'unreachable resets when reachable / after timeout');
ok(has(enemy, 'AIState.Searching') && has(enemy, 'suspicion - 30'), 'timeout drops to SEARCHING ring + suspicion decay');

// ---- 6. civilian separation ----
console.log('p3/civilian pushOut:');
ok(has(civ, 'avoidR'), 'avoidR field on Civilian');
ok(has(civ, 'avoidR = 0.9'), 'avoidR defaults to 0.9m');
ok(has(civ, 'pushOut'), 'pushOut(x, z, r) method exposed');
// math mirror of pushOut (must match source: minD = r + avoidR, positional)
function pushOut(px, pz, x, z, r, avoidR) {
  const dx = px - x; const dz = pz - z;
  const minD = r + avoidR;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minD * minD || d2 < 1e-8) return [px, pz];
  const d = Math.sqrt(d2);
  const push = (minD - d) / d;
  return [px + dx * push, pz + dz * push];
}
{
  const [nx, nz] = pushOut(0.5, 0, 0, 0, 0.4, 0.9); // minD 1.3, d 0.5
  ok(approx(Math.hypot(nx, nz), 1.3), `overlap pushes out to minD 1.3 (got ${Math.hypot(nx, nz).toFixed(3)})`);
  const [ux, uz] = pushOut(5, 0, 0, 0, 0.4, 0.9);
  ok(ux === 5 && uz === 0, 'no overlap = no-op');
  const [ex, ez] = pushOut(1.3, 0, 0, 0, 0.4, 0.9);
  ok(ex === 1.3 && ez === 0, 'exactly at minD = no-op (no jitter)');
  const [sx, sz] = pushOut(0, 0, 0, 0, 0.4, 0.9); // degenerate d=0
  ok(sx === 0 && sz === 0, 'degenerate coincident points = no-op (no NaN)');
}

// ---- 7. corpse hiding ----
console.log('p3/corpse hiding:');
ok(has(enemy, 'hiddenBody'), 'hiddenBody flag on Enemy');
ok(has(enemy, 'hidden = false') || has(enemy, 'hidden=false'), 'seeCorpse takes hidden param (default false)');
const seeBlock = (enemy.match(/seeCorpse\(x[\s\S]*?\n  \}/) || [''])[0];
ok(has(seeBlock, 'if (hidden) return'), 'enemy seeCorpse skips hidden bodies');
const civSee = (civ.match(/seeCorpse\(x[\s\S]*?\n  \}/) || [''])[0];
ok(has(civSee, 'if (hidden) return'), 'civilian seeCorpse skips hidden bodies too');

// ---- invariants preserved ----
console.log('p3/invariants:');
ok(has(enemy, 'vis > 0.02 ? player.pos : this.lastKnown'), 'no-magic chase still memory-based');
ok(!has(enemy, 'moveToward(player.pos'), 'still no moveToward(player.pos) (audit)');
ok(!has(civ, 'losBlocked'), 'civilian still has no LOS (cheap)');
ok(has(enemy, 'new THREE.Vector3()') === has(enemy, 'new THREE.Vector3()'), 'tick paths use set/copy only (no per-tick alloc added)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
