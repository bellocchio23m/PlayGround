// Timing-based katana combat: light/heavy, combo, parry window, dodge,
// stagger, finishers. Distance + direction + timing + enemy state matter.
//
// Phase-3 tuning (objectives 11-20) — all inside this file, additive only:
//  - STAGGER LEVELS (obj 15): light 0.35 < heavy 0.90 < dash 1.10 < special 1.20
//    < perfect-parry 1.60. Normal parry staggers 1.10. Values overwrite the
//    baseline set by Enemy.takeDamage (heavy?0.55:0.30) so visuals/AI read one
//    consistent number. All values < 3s: readable, never stunlock.
//  - DASH ATTACK (obj 11): dodge-cancel into attack within 0.5s = lunging
//    heavy. Detected via player.dodgeCD (counts down from 0.8 in player.ts):
//    dodgeCD > 0.30  <=>  dodge started < 0.5s ago. Player.update only allows
//    attacks once dodgeT <= 0, so a swing with dodgeCD > 0.30 is exactly the
//    "dodge-cancel into attack" window. Dash uses heavy base damage + range
//    attackRange + 1.0 and its own active window 0.30-0.80.
//  - PERFECT PARRY (obj 12): enemy strike landing while player.parryT > 0.30
//    (parryT counts down from 0.45, so > 0.30 = within first 0.15s) opens a
//    perfect riposte: 2.0x damage for 2.0s (player.riposteT = 2.0, mirrored in
//    CombatSystem.perfectT), enemy stagger 1.6s, label 'PERFETTA'.
//    Normal parry (0.10 < parryT <= 0.30): 1.5x for 1.4s, stagger 1.1.
//  - FALCE LUNARE special (obj 13): see trySpecial.
//  - DIRECTIONAL REACTIONS (obj 14): every landed hit nudges enemy.pos by
//    0.4m along the hit direction (walls are thick; 0.4m never tunnels) and
//    records CombatSystem.lastHitDir = {x,z} (unit xz) for visuals.
//  - PARRY READABILITY (obj 16): CombatSystem.parryFlashT counts down from
//    0.40 (normal) / 0.80 (perfect); central code flashes UI while > 0.
//  - GHOST-HITBOX PREVENTION (obj 17): strict range + height (|dy| <= 2.5) +
//    facing (angleDiff <= 1.0) checks PLUS per-kind active-frame gating:
//    light 0.35-0.75, heavy 0.30-0.70, dash 0.30-0.80, special immediate.
//    debugLastResolution records the last evaluated {range, phase,
//    facingDiff, dealt} for QA (mutated in place, never reallocated).
//  - PERF (obj 20 / rules): no per-frame allocations in hit resolution.
//    Hot paths use only primitives; lastHitDir allocates ONLY on a landed
//    hit (event, not per-frame); debugLastResolution is a reused object.
//
// Phase-3 gaps (additive, 100% backward compat — signatures unchanged):
//  1. Second light variant: comboDir 1|-1 flips per landed swing for anim/FX.
//  2. Charged-heavy approx: heavy + crouch-stationary = low sweep 'SPAZZATA'
//     (arc 1.4, range +0.8 total, same dmg, stagger 1.0).
//  3. Parry readability: parryWindow() {total 0.45, perfect 0.15, active}.
//  4. Damage fairness: single enemy hit capped at 40% of player max HP.
//  5. Stagger fairness: stagger > 0.8 => +25% damage (incl. special).
//  6. Ghost-hitbox hardening: resolveCount/rejectRange/rejectArc/rejectPhase/
//     rejectHeight counters, no allocations.
import * as THREE from 'three';
import { CFG } from '../core/config';
import { angleDiff } from '../core/utils';
import { Player } from '../player/player';
import { Enemy } from '../ai/enemy';
import { AudioEngine } from '../audio/audio';

export interface CombatFx {
  slash(at: THREE.Vector3): void;
  spark(at: THREE.Vector3): void;
  damageNum(at: THREE.Vector3, dmg: number, kind: string): void;
}

/** Shared tuning mirrored by tests/combat.test.mjs (keep in sync). */
export const COMBAT_TUNING = {
  lightWindow: [0.35, 0.75] as const,
  heavyWindow: [0.3, 0.7] as const,
  dashWindow: [0.3, 0.8] as const,
  dashRangeBonus: 1.0,
  heavyRangeBonus: 0.4,
  arcRad: 1.0,
  heightTol: 2.5,
  riposteMul: 1.5,
  riposteDur: 1.4,
  perfectMul: 2.0,
  perfectDur: 2.0,
  /** parryT counts down from 0.45; > this = perfect (first 0.15s). */
  perfectParryT: 0.3,
  parryMinT: 0.1,
  /** Full parryT duration (counts down from this on parry press). */
  parryTotal: 0.45,
  /** Length of the perfect slice at the start of parryT (0.45-0.30). */
  parryPerfectLen: 0.15,
  staggerLight: 0.35,
  staggerHeavy: 0.9,
  staggerDash: 1.1,
  staggerSpecial: 1.2,
  staggerParry: 1.1,
  staggerPerfect: 1.6,
  /** Low-sweep (crouch-stationary heavy) stagger. */
  staggerSweep: 1.0,
  /** Staggered enemies (stagger > this) take bonus damage. */
  staggerBonusThreshold: 0.8,
  staggerBonusMul: 1.25,
  parryFlash: 0.4,
  parryFlashPerfect: 0.8,
  knockback: 0.4,
  specialRange: 3.4,
  specialDmgMul: 1.6,
  specialCost: 35,
  specialCooldown: 6,
  /** Low-sweep arc tolerance (wider than base 1.0 rad). */
  sweepArc: 1.4,
  /** Low-sweep extra range over the heavy bonus (heavy +0.4, sweep +0.4 more = +0.8 total). */
  sweepRangeExtra: 0.4,
  /** Single enemy hit never exceeds this fraction of player max HP. */
  enemyHitCapFrac: 0.4,
} as const;

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

export class CombatSystem {
  private hitDone = false;

  /** Last landed-hit direction (unit xz, attacker -> victim). Set on hits only. */
  lastHitDir: { x: number; z: number } | null = null;
  /** UI flash timer after a successful parry (0.4 normal / 0.8 perfect). Counts down. */
  parryFlashT = 0;
  /** Remaining perfect-riposte window (mirrors player.riposteT while perfect). */
  perfectT = 0;
  /** Remaining Falce Lunare cooldown in seconds. Counts down. */
  specialCD = 0;
  /** QA record of the last hit evaluation (mutated in place, never replaced). */
  debugLastResolution: { range: number; phase: number; facingDiff: number; dealt: boolean } = {
    range: 0, phase: 0, facingDiff: 0, dealt: false,
  };
  // ---- P3 gaps (additive, backward-compat) ----
  // 1) Second light variant: alternate slash direction per combo step.
  //    comboDir flips 1 -> -1 -> 1 on every landed player swing (see
  //    updatePlayerAttack). Typical chain combo 0/1/2 therefore renders
  //    R/L/R. Central anim/FX reads this; damage is UNCHANGED.
  /** Slash direction for anim/FX variety: 1 = right, -1 = left. Flipped per landed swing. */
  comboDir: 1 | -1 = 1;
  // 6) Ghost-hitbox hardening: allocation-free debug counters for central QA.
  //    resolveCount = enemy evaluations; reject* = why each eval missed.
  /** Total enemy hit evaluations (updatePlayerAttack + trySpecial). */
  resolveCount = 0;
  /** Evaluations rejected: target beyond range. */
  rejectRange = 0;
  /** Evaluations rejected: outside facing arc. */
  rejectArc = 0;
  /** Swings rejected: outside active frames (startup/recovery or already resolved). */
  rejectPhase = 0;
  /** Evaluations rejected: vertical gap too large. */
  rejectHeight = 0;

  private perfectActive = false;
  private specialLastMs = -1e12;
  private lastWallMs = 0;

  constructor(private audio: AudioEngine, private fx: CombatFx) {}

  /** Deterministic timer decay; central wiring may call each frame (additive API). */
  tick(dt: number): void {
    if (dt <= 0) return;
    if (this.parryFlashT > 0) this.parryFlashT = Math.max(0, this.parryFlashT - dt);
    if (this.specialCD > 0) this.specialCD = Math.max(0, this.specialCD - dt);
    // perfectT mirrors player.riposteT via syncPerfect (decays in player.update);
    // decay the local copy when no perfect is active so UI never sticks.
    if (!this.perfectActive && this.perfectT > 0) this.perfectT = Math.max(0, this.perfectT - dt);
    this.lastWallMs = nowMs();
  }

  /** Wall-clock decay so timers count down even if tick() is never called. */
  private decayWall(): void {
    const now = nowMs();
    if (this.lastWallMs === 0) { this.lastWallMs = now; return; }
    let dt = (now - this.lastWallMs) / 1000;
    this.lastWallMs = now;
    if (dt <= 0) return;
    if (dt > 0.25) dt = 0.25; // tab-switch clamp: no huge jumps
    if (this.parryFlashT > 0) this.parryFlashT = Math.max(0, this.parryFlashT - dt);
    if (this.specialCD > 0) this.specialCD = Math.max(0, this.specialCD - dt);
    if (!this.perfectActive && this.perfectT > 0) this.perfectT = Math.max(0, this.perfectT - dt);
  }

  // 3) Parry readability (no QTE, no behavior change — read-only helper).
  //    Exact timings: parryT counts down from 0.45 on parry press.
  //    Active while parryT > 0.10 (0.35s window). Perfect while parryT > 0.30
  //    (first 0.15s). Success flashes parryFlashT 0.40 (normal) / 0.80
  //    (perfect) and opens riposte 1.4s (x1.5) / 2.0s (x2.0).
  /** Readable parry-window summary for HUD/FX (no behavior change). */
  parryWindow(): { total: number; perfect: number; active: boolean } {
    return {
      total: COMBAT_TUNING.parryTotal,
      perfect: COMBAT_TUNING.parryPerfectLen,
      active: this.parryFlashT > 0,
    };
  }

  // 2) Charged-heavy approximation (input has no hold): heavy pressed while
  //    crouch-stationary (crouch && planar speed < 0.5) = 'low sweep'.
  //    Fair + readable: same damage as heavy, wider arc 1.4 rad, +0.4 range
  //    over heavy (+0.8 total), stagger 1.0, label 'SPAZZATA'.
  /** True when the current heavy swing qualifies as a low sweep. */
  isSweep(player: Player): boolean {
    return player.attackKind === 'heavy' && player.crouch === true && player.moving < 0.5;
  }

  /** Remaining special cooldown (live value combining field + wall clock). */
  getSpecialCooldown(): number {
    const elapsed = (nowMs() - this.specialLastMs) / 1000;
    const wallLeft = COMBAT_TUNING.specialCooldown - elapsed;
    const left = wallLeft > this.specialCD ? wallLeft : this.specialCD;
    return left > 0 ? left : 0;
  }

  /** True while the special is unlocked, charged and affordable (for HUD gating). */
  isSpecialReady(player: Player): boolean {
    const unlocked = (player as unknown as { specialUnlocked?: boolean }).specialUnlocked === true;
    if (!unlocked) return false;
    if (player.stamina < COMBAT_TUNING.specialCost) return false;
    return this.getSpecialCooldown() <= 0;
  }

  /**
   * Dash-attack detection (obj 11): dodge-cancel into attack within 0.5s.
   * player.dodgeCD counts down from 0.8 (see player.ts dodge entry), so
   * dodgeCD > 0.30  <=>  dodge started less than 0.5s ago. Attacks are only
   * allowed once dodgeT <= 0, hence attackT > 0 + dodgeCD > 0.30 isolates the
   * cancel window without touching player.ts.
   */
  isDashAttack(player: Player): boolean {
    return player.attackT > 0 && player.dodgeCD > 0.3;
  }

  private syncPerfect(player: Player): void {
    if (player.riposteT <= 0) {
      this.perfectActive = false;
      this.perfectT = 0;
    } else if (this.perfectActive) {
      this.perfectT = player.riposteT;
    }
  }

  /** player attack hit resolution — called each frame while attacking */
  updatePlayerAttack(player: Player, enemies: Enemy[], cam: { addShake(v: number): void }): { kills: number; hits: number } {
    let kills = 0; let hits = 0;
    this.decayWall();
    this.syncPerfect(player);
    if (player.attackT <= 0) { this.hitDone = false; return { kills, hits }; }
    const heavy = player.attackKind === 'heavy';
    const dash = this.isDashAttack(player);
    // Low sweep: heavy while crouch-stationary (no hold input exists).
    // Dash wins over sweep (dodge-cancel is never stationary).
    const sweep = heavy && !dash && this.isSweep(player);
    const dur = heavy ? 0.62 : 0.42;
    const phase = 1 - player.attackT / dur;
    // per-kind active-frame gating (ghost-hitbox prevention, obj 17):
    // light 0.35-0.75, heavy 0.30-0.70 (sweep shares heavy), dash 0.30-0.80.
    const wLo = dash ? 0.3 : heavy ? 0.3 : 0.35;
    const wHi = dash ? 0.8 : heavy ? 0.7 : 0.75;
    if (phase < wLo || phase > wHi || this.hitDone) {
      this.debugLastResolution.phase = phase;
      if (!this.hitDone) this.debugLastResolution.dealt = false;
      if (phase < wLo || phase > wHi) this.rejectPhase++;
      return { kills, hits };
    }
    this.hitDone = true;
    // riposte (after parry): +50%; perfect riposte: x2 (consumed on resolution)
    const riposte = player.riposteT > 0;
    const perfect = this.perfectActive && player.riposteT > 0;
    if (riposte) player.riposteT = 0;
    if (perfect) { this.perfectActive = false; this.perfectT = 0; }
    // dash = lunging heavy: heavy base damage regardless of pressed kind.
    // sweep = same damage as heavy (fair); only arc/range/stagger/label differ.
    const base = dash ? CFG.combat.heavyDmg : heavy ? CFG.combat.heavyDmg : CFG.combat.lightDmg;
    const comboMul = player.combo === 2 ? 1.35 : 1;
    const ripMul = perfect ? 2.0 : riposte ? 1.5 : 1;
    const rawDmg = Math.round(base * player.dmgMul * comboMul * ripMul);
    const range = CFG.combat.attackRange + (dash ? 1.0 : sweep ? 0.4 + COMBAT_TUNING.sweepRangeExtra : heavy ? 0.4 : 0);
    const arcTol = sweep ? COMBAT_TUNING.sweepArc : COMBAT_TUNING.arcRad;
    for (const e of enemies) {
      if (e.dead) continue;
      this.resolveCount++;
      const dx = e.pos.x - player.pos.x; const dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      const dy = e.pos.y - player.pos.y;
      const ady = dy < 0 ? -dy : dy;
      const ang = Math.atan2(dx, dz);
      const fdiff = angleDiff(ang, player.yaw + Math.PI);
      // QA record (reused object, no allocation)
      this.debugLastResolution.range = d;
      this.debugLastResolution.phase = phase;
      this.debugLastResolution.facingDiff = fdiff;
      this.debugLastResolution.dealt = false;
      if (d > range) { this.rejectRange++; continue; }
      if (ady > 2.5) { this.rejectHeight++; continue; }
      if (fdiff > arcTol) { this.rejectArc++; continue; } // must face target (sweep wider)
      // 5) Stagger decay fairness: staggered enemies (stagger > 0.8) take
      //    +25% damage. Rewards hitting telegraphed/recovering enemies and
      //    helps boss phase 1 without changing base TTK elsewhere.
      const staggeredBonus = e.stagger > COMBAT_TUNING.staggerBonusThreshold;
      const dmg = staggeredBonus ? Math.round(rawDmg * COMBAT_TUNING.staggerBonusMul) : rawDmg;
      const finisher = e.hp <= e.maxHp * 0.25;
      const dealt = finisher ? Math.max(dmg, e.hp) : dmg;
      const killed = e.takeDamage(dealt, player.yaw, heavy || dash, this.audio);
      const ek = e.kind;
      this.audio.pain(ek === 'guard' || ek === 'elite' || ek === 'brute' || ek === 'ranger' ? ek : 'guard');
      // stagger levels (obj 15): overwrite baseline with tuned values
      // sweep staggers 1.0 (between heavy 0.9 and dash 1.1).
      e.stagger = dash ? 1.1 : sweep ? COMBAT_TUNING.staggerSweep : heavy ? 0.9 : 0.35;
      // directional reaction (obj 14): tiny safe nudge + unit dir for visuals
      if (d > 1e-4) {
        const nx = dx / d; const nz = dz / d;
        e.pos.x += nx * 0.4; e.pos.z += nz * 0.4;
        this.lastHitDir = { x: nx, z: nz };
      }
      this.debugLastResolution.dealt = true;
      this.fx.slash(e.pos);
      const label = finisher ? 'FINISHER' : perfect ? 'PERFETTA' : riposte ? 'RIPOSTE' : sweep ? 'SPAZZATA' : dash ? 'SCATTO' : heavy ? 'PESANTE' : 'colpo';
      this.fx.damageNum(e.pos, dealt, label);
      cam.addShake(dash || heavy ? 0.35 : 0.18);
      hits++;
      if (killed) kills++;
    }
    // 1) Second light variant: flip slash direction once per landed swing.
    //    Central anim/FX mirrors via comboDir (1 = right, -1 = left).
    if (hits > 0) this.comboDir = this.comboDir === 1 ? -1 : 1;
    return { kills, hits };
  }

  /** enemy swing resolution: player can parry (timing) or dodge (i-frames).
   *  Consumes the per-tick `struck` flag — never misses the damage window.
   *
   *  4) Enemy-type damage fairness (fractions of 100 max HP):
   *     guard 14 (14%) | elite 20 (20%) | captain 24 (24%) | brute slam 30
   *     (30%) | ranger melee 10 (10%) | ranger/elite knife 12 (12%).
   *     All are below the 40% single-hit cap, so the clamp below is a
   *     safety net for mods/bosses, not a nerf: it never triggers today
   *     but guarantees no cheap one-shot even if tuning drifts. */
  updateEnemyAttacks(player: Player, enemies: Enemy[], onPlayerHit: () => void): void {
    this.decayWall();
    this.syncPerfect(player);
    for (const e of enemies) {
      if (e.dead || !e.struck) continue;
      e.struck = false;
      const ex = e as unknown as { strikeRange?: number; isHeavySwing?: boolean };
      const reach = ex.strikeRange ?? 2.6; // brutes slam wider
      const dx = player.pos.x - e.pos.x; const dz = player.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach || Math.abs(player.pos.y - e.pos.y) > 2.2) continue;
      // heavy swings (brute slam) are UNPARRYABLE — dodge or distance only
      const unparryable = !!ex.isHeavySwing;
      // parry? player parry active + facing enemy
      if (!unparryable && player.parryT > 0.1) {
        const ang = Math.atan2(dx, dz); // direction player -> enemy
        if (angleDiff(ang, player.yaw + Math.PI) < 1.2) {
          // perfect = strike lands within first 0.15s (parryT > 0.30)
          const perfect = player.parryT > 0.3;
          if (perfect) {
            // perfect riposte: 2x window 2s + longer stagger + longer flash
            e.stagger = 1.6; e.windup = 0; e.swingT = 0;
            player.riposteT = 2.0;
            this.perfectActive = true;
            this.perfectT = 2.0;
            this.parryFlashT = 0.8;
          } else {
            // successful parry: stagger enemy, no damage, open riposte window
            e.stagger = 1.1; e.windup = 0; e.swingT = 0;
            player.riposteT = 1.4;
            this.perfectActive = false;
            this.perfectT = 0;
            this.parryFlashT = 0.4;
          }
          this.audio.parry();
          this.fx.spark(player.pos);
          continue;
        }
      }
      if (player.dodgeT > 0 || player.iframes > 0) continue; // dodged
      const fromYaw = Math.atan2(dx, dz) + Math.PI;
      // Fairness cap: a single enemy hit never exceeds 40% of player max HP.
      const cap = player.hpMax * COMBAT_TUNING.enemyHitCapFrac;
      const capped = e.dmg > cap ? cap : e.dmg;
      if (player.takeDamage(capped, fromYaw)) { /* damage applied */ }
      onPlayerHit();
    }
  }

  /**
   * "Falce Lunare" spinning AoE special (obj 13).
   * Gated on (player as {specialUnlocked}).specialUnlocked — central wiring
   * sets the flag and calls this method (e.g. on special-button input).
   * Spinning 360° sweep: range 3.4, damage = heavy * 1.6, costs 35 stamina,
   * 6s internal cooldown. Immediate radius check (no active frames).
   */
  trySpecial(player: Player, enemies: Enemy[], cam: { addShake(v: number): void }): { kills: number; hits: number } {
    this.decayWall();
    this.syncPerfect(player);
    const none = { kills: 0, hits: 0 };
    const unlocked = (player as unknown as { specialUnlocked?: boolean }).specialUnlocked === true;
    if (!unlocked) return none;
    if (this.getSpecialCooldown() > 0) return none;
    if (player.stamina < COMBAT_TUNING.specialCost) return none;
    player.stamina = Math.max(0, player.stamina - COMBAT_TUNING.specialCost);
    this.specialLastMs = nowMs();
    this.specialCD = COMBAT_TUNING.specialCooldown;
    this.lastWallMs = this.specialLastMs;
    const rawSpecial = Math.round(CFG.combat.heavyDmg * COMBAT_TUNING.specialDmgMul * player.dmgMul);
    let kills = 0; let hits = 0;
    for (const e of enemies) {
      if (e.dead) continue;
      this.resolveCount++;
      const dx = e.pos.x - player.pos.x; const dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      const dy = e.pos.y - player.pos.y;
      const ady = dy < 0 ? -dy : dy;
      this.debugLastResolution.range = d;
      this.debugLastResolution.phase = 1;
      this.debugLastResolution.facingDiff = 0; // 360° sweep: no facing check
      this.debugLastResolution.dealt = false;
      if (d > COMBAT_TUNING.specialRange) { this.rejectRange++; continue; }
      if (ady > 2.5) { this.rejectHeight++; continue; }
      const dmg = e.stagger > COMBAT_TUNING.staggerBonusThreshold
        ? Math.round(rawSpecial * COMBAT_TUNING.staggerBonusMul)
        : rawSpecial;
      const finisher = e.hp <= e.maxHp * 0.25;
      const dealt = finisher ? Math.max(dmg, e.hp) : dmg;
      const killed = e.takeDamage(dealt, player.yaw, true, this.audio);
      e.stagger = COMBAT_TUNING.staggerSpecial;
      if (d > 1e-4) {
        const nx = dx / d; const nz = dz / d;
        e.pos.x += nx * 0.4; e.pos.z += nz * 0.4;
        this.lastHitDir = { x: nx, z: nz };
      }
      this.debugLastResolution.dealt = true;
      this.fx.slash(e.pos);
      this.fx.damageNum(e.pos, dealt, 'FALCE LUNARE');
      cam.addShake(0.4);
      hits++;
      if (killed) kills++;
    }
    return { kills, hits };
  }

  /** throwing knife: fast projectile resolved instantly with LOS check */
  throwKnife(from: THREE.Vector3, yaw: number, enemies: Enemy[], los: (a: THREE.Vector3, b: THREE.Vector3) => boolean): Enemy | null {
    const dx = -Math.sin(yaw); const dz = -Math.cos(yaw);
    let best: Enemy | null = null; let bestD = 18;
    for (const e of enemies) {
      if (e.dead) continue;
      const rx = e.pos.x - from.x; const rz = e.pos.z - from.z;
      const along = rx * dx + rz * dz;
      if (along < 1 || along > 18) continue;
      const perp = Math.abs(rx * dz - rz * dx);
      if (perp > 1.2) continue;
      const target = new THREE.Vector3(e.pos.x, e.pos.y + 1.2, e.pos.z);
      if (los(new THREE.Vector3(from.x, from.y + 1.5, from.z), target)) continue; // blocked
      if (along < bestD) { bestD = along; best = e; }
    }
    return best;
  }
}
