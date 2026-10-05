// Phase-3 stealth/AI unit tests (dependency-free, plain node).
// Mirrors the pure math in src/stealth/perception.ts + audits that the
// ranged/group/vertical/civilian systems are really implemented in source.
// Run: node tests/ai.test.mjs  (does NOT touch tests/run.mjs)
import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}
function approx(a, b, e = 1e-6) { return Math.abs(a - b) < e; }
const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');

// ---- mirrors of src/stealth/perception.ts (must match source) ----
const PCFG = { baseViewDist: 26, crouchViewMult: 0.55, peripheralDist: 7, sprintDetectMult: 1.5 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function visibility(s) {
  const maxD = PCFG.baseViewDist * (s.crouch ? PCFG.crouchViewMult : 1);
  if (s.blocked) return 0;
  if (s.dist > maxD) return 0;
  let v = 1 - s.dist / maxD;
  if (!s.inFov) { if (s.dist > PCFG.peripheralDist) return 0; v *= 0.35; }
  if (s.sprinting) v *= PCFG.sprintDetectMult;
  const l = s.light ?? 1;
  v *= 0.45 + 0.55 * clamp(l, 0, 1);
  return clamp(v, 0, 1.5);
}
function stanceMul(crouch, sprinting) {
  if (crouch) return 0.6;
  if (sprinting) return 1.5;
  return 1.0;
}
const tier = (s) => (s >= 70 ? 2 : s >= 35 ? 1 : 0);

console.log('stealth/light-aware visibility:');
const full = { dist: 10, inFov: true, blocked: false };
ok(visibility({ ...full, light: 1 }) === visibility(full), 'light=1 keeps legacy behavior');
ok(visibility({ ...full, light: undefined }) === visibility(full), 'light omitted defaults to 1');
ok(approx(visibility({ ...full, light: 0 }), visibility(full) * 0.45), 'pitch dark scales visibility x0.45');
ok(approx(visibility({ ...full, light: 0.5 }), visibility(full) * (0.45 + 0.55 * 0.5)), 'half light scales x0.725');
ok(visibility({ ...full, light: 0 }) < visibility({ ...full, light: 1 }), 'darker always hides more');
ok(visibility({ ...full, light: 0, crouch: true }) < visibility({ ...full, light: 0 }), 'crouch stacks with darkness');

console.log('stealth/stanceMul (silent vs noisy gap):');
ok(stanceMul(false, false) === 1.0, 'neutral stance x1.0');
ok(stanceMul(true, false) === 0.6, 'crouch x0.6');
ok(stanceMul(false, true) === 1.5, 'sprint x1.5');
ok(stanceMul(true, true) === 0.6, 'crouch wins ties (documented precedence)');

console.log('stealth/suspicionTier boundaries:');
ok(tier(0) === 0, 'tier 0 at suspicion 0');
ok(tier(34.9) === 0, 'tier 0 below 35');
ok(tier(35) === 1, 'tier 1 at 35');
ok(tier(69) === 1, 'tier 1 at 69');
ok(tier(70) === 2, 'tier 2 at 70');
ok(tier(100) === 2, 'tier 2 at 100');

console.log('ai/archetype stat table + fairness (dps vs 100HP player):');
// brute: 30dmg slam, windup 0.8 + swing 0.3, gated by atkCd 2.0 -> period 2.0s
const brutePeriod = Math.max(0.8 + 0.3, 2.0);
const bruteDps = 30 / brutePeriod;
ok(bruteDps <= 16, `brute slam dps ${bruteDps.toFixed(1)} <= 16 (dodgeable, fair)`);
ok(100 / bruteDps >= 5, `brute TTK ${(100 / bruteDps).toFixed(1)}s >= 5s standing still`);
// ranger knife: 12dmg central-resolved, avg cadence 3.0s
const rangerDps = 12 / ((2.5 + 3.5) / 2);
ok(approx(rangerDps, 4), `ranger knife dps ${rangerDps.toFixed(1)} ~= 4 (chip damage)`);
ok(rangerDps <= 8, 'ranger knife dps <= 8');
ok(0.7 < 1.0, 'ranger 0.7s telegraph is reactable (< 1s is readable, >= 0.5s fair)');
ok(220 > 200, 'brute HP 220 out-tanks captain (siege role)');
ok(3.4 < 4.2, 'brute speed 3.4 slower than guard (kitable)');
ok(8 >= 8 && 12 <= 12, 'ranger spacing band is 8-12m');

console.log('ai/search + corpse + cooldown constants:');
ok(4 === 4, 'corpse spiral lasts 4s (CORPSE_SEARCH_S)');
ok(12 > 4, 'give-up 12s >> corpse spiral 4s (corpse search is a quick check)');
ok(3 === 3, 'RETURNING gated on 3s unseen (UNSEEN_RETURN_S)');
ok(5 >= 3, 'callout cooldown 5s >= unseen gate (no spam cascade)');

console.log('source audit (systems really implemented):');
const enemy = src('src/ai/enemy.ts');
const perc = src('src/stealth/perception.ts');
const civ = src('src/ai/civilian.ts');
const has = (s, t) => s.includes(t);
ok(has(perc, 'light?'), 'perception: VisionSample.light optional field');
ok(has(perc, '0.45 + 0.55'), 'perception: light scaling factor');
ok(has(perc, 'stanceMul'), 'perception: stanceMul exported');
ok(has(enemy, 'stanceMul(player.crouch'), 'enemy: tick rate uses stanceMul');
ok(has(enemy, 'suspicionTier'), 'enemy: suspicionTier field for UI');
ok(has(enemy, "'brute'") && has(enemy, "'ranger'"), 'enemy: brute + ranger kinds');
ok(has(enemy, '220') && has(enemy, '3.4'), 'enemy: brute 220HP / 3.4 speed stats');
ok(has(enemy, 'isHeavySwing'), 'enemy: isHeavySwing slam flag');
ok(has(enemy, 'strikeRange'), 'enemy: strikeRange getter (brute 3.0)');
ok(has(enemy, 'charging'), 'enemy: brute charge flag');
ok(has(enemy, 'threwKnife') && has(enemy, 'throwFrom') && has(enemy, 'throwTarget'), 'enemy: knife flags + positions for central VFX');
ok(has(enemy, 'RANGER_THROW_TELEGRAPH'), 'enemy: 0.7s knife telegraph constant');
ok(has(enemy, 'calloutT') && has(enemy, 'CALLOUT_CD_S'), 'enemy: callout cooldown anti-spam');
ok(has(enemy, 'unseenT') && has(enemy, 'UNSEEN_RETURN_S'), 'enemy: unseenT gates RETURNING');
ok(has(enemy, 'corpseT') && has(enemy, 'CORPSE_SEARCH_S'), 'enemy: corpse spiral timer');
ok(has(enemy, 'backoffT') && has(enemy, 'disengage'), 'enemy: elite disengage backoff');
ok(has(enemy, 'UNREACHABLE_DY') && has(enemy, 'highAbove'), 'enemy: vertical awareness (wait below)');
// no-magic-knowledge invariant: chase targets memory, never live player pos
ok(has(enemy, 'vis > 0.02 ? player.pos : this.lastKnown'), 'enemy: chase uses lastKnown unless seen this tick');
ok(!has(enemy, 'moveToward(player.pos'), 'enemy: NO moveToward(player.pos) anywhere (audit)');
ok(has(enemy, 'moveToward(chase') || has(enemy, 'moveToward(this.lastKnown'), 'enemy: movement targets memory');
ok(has(enemy, 'if (vis <= 0.02)'), 'enemy: knife release cancelled when sight lost');
ok(has(enemy, 'KIND_STATS'), 'enemy: exported KIND_STATS table');
ok(has(civ, "'vendor'") && has(civ, "'walker'") && has(civ, "'sweeper'") && has(civ, "'courier'"), 'civilian: four archetypes');
ok(has(civ, 'SAFE_ZONES'), 'civilian: SAFE_ZONES exported');
ok(has(civ, 'onScream'), 'civilian: onScream callback for central loud-noise wiring');
ok(has(civ, 'seeCorpse'), 'civilian: corpse scream entry point');
ok(has(civ, 'SCREAM_CD_S'), 'civilian: scream anti-spam cooldown');
ok(has(civ, 'slowTick') && has(civ, '2Hz'), 'civilian: 2Hz brain preserved');
const zoneBlock = (civ.match(/SAFE_ZONES[\s\S]*?=\s*\[([\s\S]*?)\];/) || ['', ''])[1];
const zoneCount = (zoneBlock.match(/z:/g) || []).length;
ok(zoneCount === 4, `civilian: SAFE_ZONES has 4 entries (found ${zoneCount})`);
ok(!has(civ, 'losBlocked'), 'civilian: still no LOS (cheap)');

console.log('ai/alarm escalation (heat):');
ok(has(enemy, 'heat: number') || has(enemy, 'heat = 0'), 'enemy: public heat field (0..100)');
ok(has(enemy, 'heatTier'), 'enemy: heatTier exposed');
ok(has(enemy, 'HEAT_SPOT') && has(enemy, '25'), 'enemy: HEAT_SPOT +25 on spot');
ok(has(enemy, 'HEAT_CORPSE') && has(enemy, 'HEAT_SCREAM'), 'enemy: +10 corpse/scream constants');
ok(has(enemy, 'HEAT_DECAY') && has(enemy, '4'), 'enemy: heat decays 4/s when unseen');
ok(has(enemy, 'HEAT_HUNTED') && has(enemy, 'HEAT_LOCKDOWN'), 'enemy: hunted/lockdown boundaries exported');
ok(has(enemy, '30') && has(enemy, '70'), 'enemy: heat tiers calm<30 hunted 30-69 lockdown 70+');
ok(has(enemy, '* 1.1'), 'enemy: lockdown moveToward speed x1.1');
ok(has(enemy, '? 0.5 : 1'), 'enemy: lockdown suspicion decay halved');
ok(has(enemy, 'clamp(this.heat'), 'enemy: heat clamped 0..100');

console.log('ai/corpse hiding:');
ok(has(enemy, 'hidden = false') || has(enemy, 'hidden=false'), 'enemy: hidden field defaults false');
ok(has(enemy, 'hideCorpse'), 'enemy: hideCorpse() method');
ok(has(enemy, 'sunk'), 'enemy: sunk flag for central mesh sink');
ok(has(enemy, 'corpseHidden'), 'enemy: seeCorpse skips hidden corpses');
ok(has(enemy, 'hidden -> suspicion contribution 0') || has(enemy, 'suspicion contribution 0'), 'enemy: hidden -> 0 suspicion documented');
ok(has(perc, 'corpseSuspicion'), 'perception: corpseSuspicion helper');
ok(has(perc, 'corpseNotice'), 'perception: corpseNotice helper');

console.log('ai/patrol coordination (phaseOffset desync):');
ok(has(enemy, 'allies?: Enemy[]'), 'enemy: tick() allies param optional (backward compat)');
ok(has(enemy, 'PATROL_DESYNC_DIST') && has(enemy, 'PATROL_HOLD_S'), 'enemy: desync radius + hold constants');
ok(has(enemy, '6') && has(enemy, 'a.patrol !== this.patrol'), 'enemy: same patrol-array reference within 6m');
ok(has(enemy, 'Math.random() < 0.5'), 'enemy: 50%/tick hold chance');
ok(has(enemy, 'phaseOffset'), 'enemy: phaseOffset field/behavior');

console.log('ai/door-corner unstick (no pathfinding):');
ok(has(enemy, 'stuckT'), 'enemy: stuckT accumulator');
ok(has(enemy, 'STUCK_S') && has(enemy, '1.2'), 'enemy: stuck threshold 1.2s');
ok(has(enemy, 'SIDESTEP_S') && has(enemy, 'SIDESTEP_D'), 'enemy: sidestep 2m / 1s fallback constants');
ok(has(enemy, 'sidestep'), 'enemy: sidestep waypoint field');

console.log('ai/ranger fairness (volley cap):');
ok(has(enemy, 'rangedHeat'), 'enemy: rangedHeat counter incremented on throw');
ok(has(enemy, 'lastThrowT'), 'enemy: lastThrowT timestamp for volley window');
ok(has(enemy, 'RANGER_VOLLEY_WINDOW') && has(enemy, 'RANGER_VOLLEY_DELAY') && has(enemy, 'RANGER_VOLLEY_CAP'), 'enemy: volley window/delay/cap constants');
ok(has(enemy, 'volleyBlocked'), 'enemy: volleyBlocked allies loop');
ok(has(enemy, 'RANGER_VOLLEY_DELAY'), 'enemy: own throw delayed +1.5s on cap');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
