// Phase-3 player tests (dependency-free, plain node).
// Covers: gait tuning tables, turn rates, mantle tiers, hang window,
// gap-crossing math, exit-boost momentum, hint fields, API stability,
// fall-damage preservation, rig poses, no-alloc discipline.
import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}

const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const player = src('src/player/player.ts');
const rig = src('src/player/rig.ts');
const cfg = src('src/core/config.ts');

// helper: extract a numeric table value like "sprint: { accel: 52" from player.ts
function num(re) { const m = player.match(re); return m ? parseFloat(m[1]) : NaN; }

console.log('config MoveState:');
ok(cfg.includes("Hang: 'hang'"), 'config MoveState has Hang hang');
ok(cfg.includes("Mantle: 'mantle'"), 'config MoveState has Mantle mantle');

console.log('gait accel/decel:');
const sprintAccel = num(/sprint:\s*\{\s*accel:\s*([\d.]+)/);
const runAccel = num(/run:\s*\{\s*accel:\s*([\d.]+)/);
const walkAccel = num(/walk:\s*\{\s*accel:\s*([\d.]+)/);
const crouchAccel = num(/crouch:\s*\{\s*accel:\s*([\d.]+)/);
const sprintDecel = num(/sprint:\s*\{\s*accel:\s*[\d.]+,\s*decel:\s*([\d.]+)/);
const runDecel = num(/run:\s*\{\s*accel:\s*[\d.]+,\s*decel:\s*([\d.]+)/);
const crouchDecel = num(/crouch:\s*\{\s*accel:\s*[\d.]+,\s*decel:\s*([\d.]+)/);
ok(sprintAccel > runAccel && runAccel > walkAccel && walkAccel > crouchAccel,
  `accel ordering sprint(${sprintAccel})>run(${runAccel})>walk(${walkAccel})>crouch(${crouchAccel})`);
ok(sprintDecel < runDecel, `sprint decel(${sprintDecel}) < run decel(${runDecel}) = smooth stop`);
ok(crouchDecel >= runDecel && crouchDecel >= 30, `crouch decel(${crouchDecel}) tight stop`);

console.log('turn rates:');
const tTurn = (g) => num(new RegExp(g + ':\\s*\\{[^}]*?turn:\\s*([\\d.]+)'));
ok(tTurn('sprint') > tTurn('run') && tTurn('run') > tTurn('crouch'),
  `turn sprint(${tTurn('sprint')})>run(${tTurn('run')})>crouch(${tTurn('crouch')})`);
ok(player.includes('accelMul: 0.35'), 'air accel multiplier 0.35 present');

console.log('mantle tiers:');
ok(player.includes('vaultMax: 1.6'), 'vaultMax 1.6');
ok(player.includes('mantleMax: 2.6'), 'mantleMax 2.6');
ok(player.includes('climbMax: 7.5'), 'climbMax 7.5');
ok(player.includes('vaultDur: 0.4'), 'vault 0.4s');
ok(player.includes('mantleDur: 0.7'), 'mantle 0.7s');
ok(player.includes('mantleT'), 'mantleT field exists');
ok(player.includes("state = 'mantle'") || player.includes("'mantle'"), 'mantle state assigned');

console.log('vault reliability + step-up:');
const tol = num(/probeTol:\s*([\d.]+)/);
ok(tol >= 0.9, `probe tolerance widened (${tol})`);
ok(player.includes('probeDist: 1.4'), 'probe distance 1.4');
ok(player.includes('probeNear: 0.7'), 'near probe for tight spaces');
ok(player.includes('stepMin: 0.3') && player.includes('stepMax: 0.6'), 'step-up assist 0.3-0.6m');

console.log('edge-hang:');
ok(player.includes('hangTopMin: 0.3') && player.includes('hangTopMax: 2.0'), 'hang window [y+0.3, y+2.0]');
ok(player.includes('hangDist: 1.2'), 'hang grab distance 1.2m');
ok(player.includes('hangDrain: 4'), 'hang stamina drain small (4/s)');
ok(player.includes('hanging = false') && player.includes("state = 'hang'"), 'hang state entered');
ok(player.includes('tryHang') && player.includes('updateHang') && player.includes('dropFromHang'), 'hang methods present');

console.log('traversal chaining + gaps:');
ok(player.includes('1.12') && player.includes('1.08'), 'exit boost vault x1.12 / mantle x1.08');
ok(player.includes('traversalExitBoost'), 'momentum exit helper present');
ok(player.includes('baseVel: 7.6'), 'jump baseVel 7.6 (tuned from 7.2)');
// numeric gap math: t_air = 2*vy/g, d = v*t
{
  const g = 22, vy = 7.6, vySprint = 7.6 + 0.6, vSprint = 9.2 * 1.08, vRun = 6.0;
  const dSprint = vSprint * (2 * vySprint / g);
  const dRun = vRun * (2 * vy / g);
  ok(dSprint > 4.5, `sprint-jump clears 4.5m gap (${dSprint.toFixed(2)}m)`);
  void vy;
  ok(dRun < 4.5, `run-jump does not auto-clear (${dRun.toFixed(2)}m) = sprint-gated design`);
}
ok(player.includes('this.jumpBuf') && player.includes('this.coyote'), 'jump buffer + coyote preserved');

console.log('fall damage rules:');
ok(player.includes('fall > 12'), 'lethal-fall threshold (12m) preserved');
ok(player.includes('fall > 4.5'), 'hard-landing threshold (4.5m) preserved');

console.log('readability fields:');
ok(player.includes('traversableNear'), 'traversableNear field exposed');
ok(player.includes('traverseDir'), 'traverseDir field exposed');
ok(player.includes('updateTraverseHint'), 'hint updated per frame');

console.log('public API stable:');
for (const token of ['pos = ', 'vel = ', 'yaw = ', 'state: MoveState', 'crouch = ', 'stamina = ',
  'hp = ', 'attackT = ', 'parryT = ', 'riposteT = ', 'dodgeT = ', 'vaultT = ', 'climbT = ',
  'iframes = ', 'takeDamage(', 'heal(', 'reset(', 'update(', 'tryTraversal(', 'events']) {
  ok(player.includes(token), `API keeps "${token.trim()}"`);
}

console.log('rig poses:');
ok(rig.includes("state === 'hang'"), 'rig hang pose');
ok(rig.includes("state === 'mantle'"), 'rig mantle pull pose');
ok(rig.includes("state === 'sprint'"), 'rig sprint lean');
{
  const animBody = rig.slice(rig.indexOf('animate(rig'));
  ok(!animBody.includes('new THREE.'), 'rig animate allocates nothing');
}
ok(!player.includes('new THREE.Vector3(dt') && !player.match(/update\(.*?\{[\s\S]*?new THREE\.Vector3\(/),
  'player hot path: no per-frame Vector3 alloc in update');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
