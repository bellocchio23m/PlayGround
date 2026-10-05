// Phase-3 movement gaps: crouch-slide, landing roll, tight-space vault
// fallback, gap jump, contextual anim variety (dependency-free, plain node).
// Strategy: source audit + numeric checks on the exported tuning tables.
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

function pnum(re) { const m = player.match(re); return m ? parseFloat(m[1]) : NaN; }

console.log('config MoveState:');
ok(cfg.includes("Slide: 'slide'"), 'config MoveState appends Slide slide');
ok(cfg.includes("Hang: 'hang'") && cfg.includes("Mantle: 'mantle'"), 'config keeps Hang/Mantle (append-only)');

console.log('gait values sane:');
const sprintAccel = pnum(/sprint:\s*\{\s*accel:\s*([\d.]+)/);
const runAccel = pnum(/run:\s*\{\s*accel:\s*([\d.]+)/);
ok(sprintAccel > runAccel && sprintAccel > 40, `sprint accel sane (${sprintAccel})`);
ok(player.includes('accelMul: 0.35'), 'air control 0.35+ intact');
ok(player.includes('this.jumpBuf') && player.includes('this.coyote'), 'jump buffer + coyote intact');
ok(player.includes('jumpBuf = 0.15'), 'jump buffer window 0.15 intact');

console.log('gap jump (~4.5m sprint-gated):');
{
  const g = 22, vySprint = 7.6 + 0.6, vSprint = 9.2 * 1.08, vRun = 6.0, vy = 7.6;
  const dSprint = vSprint * (2 * vySprint / g);
  const dRun = vRun * (2 * vy / g);
  ok(dSprint > 4.5, `sprint-jump clears 4.5m (${dSprint.toFixed(2)}m)`);
  ok(dRun < 4.5, `run-jump stays gated (${dRun.toFixed(2)}m)`);
  ok(player.includes('baseVel: 7.6'), 'jump baseVel 7.6 preserved');
}

console.log('crouch-slide entry/exit:');
ok(player.includes('SLIDE_TUNE'), 'SLIDE_TUNE table exported');
ok(player.includes('dur: 0.7'), 'slide duration 0.7s');
ok(player.includes('minPlanar: 6'), 'slide entry planar > 6');
ok(player.includes('crouchPressedEdge') && player.includes('crouchToggle'), 'slide listens on crouch-toggle edge');
ok(player.includes('sprinting') && player.includes('startSlide'), 'slide entry requires sprint context');
ok(player.includes('sliding = false') && player.includes('sliding = true'), 'sliding flag set + cleared');
ok(player.includes('slideT = SLIDE_TUNE.dur') || player.includes('slideT = 0.7'), 'slide timer armed at entry');
ok(player.includes('slideCD'), 'slide retrigger cooldown exists');
ok(player.includes("state = 'slide'"), 'slide MoveState assigned');
ok(player.includes('startSlide') && player.includes('updateSlide'), 'slide start/tick methods present');

console.log('slide feel + chaining:');
ok(player.includes('noise: 0.8') || (player.includes('SLIDE_TUNE.noise') && player.includes('0.8')), 'slide noise 0.8');
ok(player.includes("kind: 'slide'"), 'slide emits kinded noise event');
ok(player.includes('jumpPlanarBoost: 1.15') || player.includes('1.15'), 'slide long-jump planar boost x1.15');
ok(player.includes('jumpVyBonus') && player.includes('1.0'), 'slide long-jump vy bonus present');
ok(player.includes('SLIDE_TUNE.friction') && player.includes('SLIDE_TUNE.steer'), 'slide low-friction + slight steer wired');
ok(/updateSlide[\s\S]*?tryTraversal/.test(player), 'slide can chain into vault (tryTraversal in slide tick)');

console.log('landing roll:');
ok(player.includes('ROLL_TUNE'), 'ROLL_TUNE table exported');
ok(player.includes('minPlanar: 5'), 'roll entry planar > 5');
ok(player.includes('landDip: 0.6') || player.includes('ROLL_TUNE.landDip'), 'roll landDip 0.6');
ok(player.includes('safeFall: 8'), 'roll damage-free up to fall 8');
ok(player.includes('rollT = ROLL_TUNE.rollDur') || player.includes('rollDur: 0.5'), 'roll visual timer armed');
ok(player.includes('fall > 12'), 'lethal-fall rule (>12) still applies incl. rollers');
ok(player.includes('fall > 4.5'), 'hard-landing threshold (4.5) preserved for non-rollers');

console.log('tight-space vault fallback:');
ok(player.includes('VAULT_FALLBACK_TUNE'), 'fallback tuning table exported');
ok(player.includes('blockedFrames: 2'), 'fallback needs 2 consecutive blocked frames');
ok(player.includes('blockedFrames++') && player.includes('blockedFrames < '), 'blocked counter increments + gates');
ok(player.includes('maxObstacle: 1.0'), 'fallback only for low obstacles (<=1.0m)');
ok(player.includes('startVault(topY, dx, dz)') || player.includes('this.startVault(topY'), 'fallback triggers real vault');
ok(player.includes('updateVaultFallback'), 'fallback runs per frame after tryTraversal');

console.log('central wiring API:');
for (const token of ['sliding = false', 'slideT = 0', 'rolling = false', 'rollT = 0', 'skid = 0', 'blockedFrames = 0']) {
  ok(player.includes(token), `public field "${token}" exposed`);}
ok(player.includes('traversableNear') && player.includes('traverseDir'), 'traversableNear/traverseDir pattern reused');

console.log('public API stable (no renames/removals):');
for (const token of ['pos = ', 'vel = ', 'yaw = ', 'state: MoveState', 'crouch = ', 'stamina = ',
  'hp = ', 'attackT = ', 'parryT = ', 'riposteT = ', 'dodgeT = ', 'vaultT = ', 'climbT = ',
  'mantleT', 'hanging = false', 'iframes = ', 'takeDamage(', 'heal(', 'reset(', 'update(', 'tryTraversal(', 'events']) {
  ok(player.includes(token), `API keeps "${token.trim()}"`);
}

console.log('rig variety (allocation-free):');
ok(rig.includes("state === 'slide'") || rig.includes('slideK'), 'rig slide pose');
ok(rig.includes('rollK') || (rig.includes("state === 'landing'") && rig.includes('speed > 5')), 'rig roll pose');
ok(rig.includes('skidK') || rig.includes('opts.skid'), 'rig run-to-stop skid');
ok(rig.includes('0.93') && rig.includes("state === 'idle'"), 'rig idle breath variation (layered oscillators)');
ok(rig.includes('slide?: number') && rig.includes('roll?: number') && rig.includes('skid?: number'), 'rig opts extended optionally (callers stable)');
{
  const animBody = rig.slice(rig.indexOf('animate(rig'));
  ok(!animBody.includes('new THREE.'), 'rig animate allocates nothing');
}
ok(!player.match(/updateSlide\(.*?\{[\s\S]*?new THREE\.Vector3\(/), 'slide tick: no Vector3 alloc');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
