// Efficient enemy AI: state machine, staggered 10Hz ticks, spatial checks.
// Behaviors: patrol, observe, hear noise, investigate, see corpses, chase,
// melee combat with telegraphs, lose player, return to patrol.
//
// Archetypes (EnemyKind): 'guard' | 'elite' | 'captain' (legacy) + 'brute' | 'ranger'.
// - brute: slow tank, heavy slam, charges in a straight line, only heavy hits stagger it.
// - ranger: keeps 8-12m, throws telegraphed knives (flags only; central resolves).
// - elite: strafes, and disengages (backs off + throws) when badly hurt.
//
// NO-MAGIC-KNOWLEDGE INVARIANT: COMBAT movement targets `lastKnown`, which is
// refreshed ONLY on ticks with vis > 0.02 (or on taking damage via lastKnownT).
// The only uses of live player.pos in combat are: range checks for strikes,
// knife-release snapshots (a visible projectile), and facing while vis > 0.02.
// An unseen enemy chases a memory, never the player.
import * as THREE from 'three';
import { AIState, CFG, NoiseEvent } from '../core/config';
import { angleDiff, clamp, dampAngle } from '../core/utils';
import type { MoveState } from '../core/config';
import { World } from '../world/world';
import { inFov, isBehind, stanceMul, suspicionRate, visibility } from '../stealth/perception';
import { buildRig, PoseAnimator, Rig } from '../player/rig';
import { AudioEngine } from '../audio/audio';

const _strafe = new THREE.Vector3();
const _tmp = new THREE.Vector3(); // ranger spacing / shared scratch (no per-tick allocs)

// ---- tuning shared with central wiring + tests (single source of truth) ----
/** min seconds between group callouts from the same spotter (anti-spam). */
export const CALLOUT_CD_S = 5;
/** seconds completely unseen before an enemy gives up back to RETURNING. */
export const UNSEEN_RETURN_S = 3;
/** seconds of spiral search around a discovered corpse. */
export const CORPSE_SEARCH_S = 4;
/** ranger knife telegraph before release. */
export const RANGER_THROW_TELEGRAPH = 0.7;
/** ranger knife cadence window. */
export const RANGER_THROW_CD_MIN = 2.5;
export const RANGER_THROW_CD_MAX = 3.5;
/** damage central should apply for a ranger/elite knife hit. */
export const RANGER_THROW_DMG = 12;
/** elite disengage knife uses a longer cooldown. */
export const ELITE_THROW_CD_MIN = 5;
export const ELITE_THROW_CD_MAX = 7;
/** ranger preferred spacing band (meters, 2D). */
export const RANGER_BAND_MIN = 8;
export const RANGER_BAND_MAX = 12;
/** brute charge window (meters, 2D): straight-line sprint. */
export const BRUTE_CHARGE_MIN = 6;
export const BRUTE_CHARGE_MAX = 12;
/** vertical gap above which ground enemies wait below instead of pushing walls. */
export const UNREACHABLE_DY = 3;

export type EnemyKind = 'guard' | 'elite' | 'captain' | 'brute' | 'ranger';

export interface PlayerRef {
  pos: THREE.Vector3; crouch: boolean; sprinting: boolean; dead: boolean;
  elevated: boolean; moving: number; yaw: number; attackT: number; hidden: boolean;
  /** ambient light on the player 0..1 (central passes world light). Default 1 = legacy. */
  light?: number;
}

export const KIND_STATS: Record<EnemyKind, { hp: number; dmg: number; speed: number; view: number; atkCd: number }> = {
  guard: { hp: 60, dmg: CFG.combat.enemyDmg, speed: 4.2, view: 1, atkCd: 1.6 },
  elite: { hp: 110, dmg: CFG.combat.enemyHeavyDmg - 4, speed: 4.8, view: 1.15, atkCd: 1.25 },
  captain: { hp: 200, dmg: CFG.combat.enemyHeavyDmg, speed: 5.2, view: 1.3, atkCd: 1.0 },
  brute: { hp: 220, dmg: 30, speed: 3.4, view: 0.9, atkCd: 2.0 },
  ranger: { hp: 70, dmg: 10, speed: 4.6, view: 1.2, atkCd: 1.8 },
};

/** melee windup (telegraph) per kind. Brute slam is slow and dodgeable. */
const WINDUP: Record<EnemyKind, number> = {
  guard: 0.6, elite: 0.6, captain: 0.45, brute: 0.8, ranger: 0.5,
};

let nextId = 1;

export class Enemy {
  id = nextId++;
  rig: Rig;
  animator = new PoseAnimator();
  pos = new THREE.Vector3();
  yaw = 0;
  kind: EnemyKind;
  hp: number; maxHp: number;
  state: AIState = AIState.Patrol;
  suspicion = 0;
  /** UI readability tier: 0 calm (<35), 1 curious (35-69), 2 alarmed (70+). Updated every tick. */
  suspicionTier: 0 | 1 | 2 = 0;
  patrol: THREE.Vector3[];
  wpIndex = 0;
  waitT = 0;
  investigate = new THREE.Vector3();
  lastKnown = new THREE.Vector3();
  lastKnownT = -99;
  lostT = 0;
  atkCD = 0; windup = 0; swingT = 0; stagger = 0; hitT = 0;
  struck = false; // set the exact tick a swing lands (consumed by CombatSystem)
  /** brute slam in flight: central should use strikeRange + shake + (optionally) no-parry. */
  isHeavySwing = false;
  acc = 0; // brain accumulator for fixed-Hz ticks
  strafeDir = 1; searchT = 0; ringT = 0;
  dead = false; deathT = 0; seen = false; // seen = corpse discovered
  alertedOthers = false;
  /** group-callout throttle: only re-broadcast via onSpotted when <= 0. */
  calloutT = 0;
  /** seconds since last tick with vis > 0.02. Gates RETURNING (no psychic re-alerts). */
  unseenT = 99;
  /** remaining corpse-spiral time (0 = inactive). Uses searchT/ringT + lastKnown=corpse. */
  corpseT = 0;
  // --- ranged attacks (flags only: central spawns/resolves the projectile) ---
  /** set true the tick a knife leaves the hand. CENTRAL MUST reset to false after resolving. */
  threwKnife = false;
  throwFrom = new THREE.Vector3();
  throwTarget = new THREE.Vector3();
  knifeCD = 2 + Math.random() * 2;
  throwTele = 0; // active knife telegraph countdown (0 = none)
  /** elite disengage bookkeeping. */
  disengageT = 0;
  backoffT = 0; // remaining fallback movement time after a disengage trigger
  fallback = new THREE.Vector3();
  /** brute charge flag (straight-line sprint this tick) for central VFX/audio. */
  charging = false;
  tickOffset: number;
  moveAmt = 0;
  combatT = 0;
  parryable = false;
  marker: THREE.Sprite | null = null;

  constructor(kind: EnemyKind, patrol: THREE.Vector3[]) {
    this.kind = kind;
    this.patrol = patrol.length ? patrol : [new THREE.Vector3()];
    this.pos.copy(this.patrol[0]);
    const st = KIND_STATS[kind];
    this.hp = st.hp; this.maxHp = st.hp;
    // rig.ts only builds guard-family rigs: map new kinds onto the closest look.
    const rigKind = kind === 'brute' ? 'captain' : kind === 'ranger' ? 'elite' : kind;
    this.rig = buildRig(rigKind);
    if (kind === 'brute') this.rig.group.scale.setScalar(1.18);
    if (kind === 'ranger') this.rig.group.scale.setScalar(0.95);
    this.tickOffset = Math.random();
  }

  get dmg(): number { return KIND_STATS[this.kind].dmg; }
  get speed(): number { return KIND_STATS[this.kind].speed; }
  get viewMul(): number { return KIND_STATS[this.kind].view; }
  /** melee strike reach central should honor (brute slam is bigger). */
  get strikeRange(): number { return this.kind === 'brute' ? 3.0 : 2.0; }

  get inCombat(): boolean { return this.state === AIState.Combat || this.state === AIState.Alert; }

  hear(n: NoiseEvent): void {
    if (this.dead || this.inCombat) return;
    const d = Math.hypot(n.x - this.pos.x, n.z - this.pos.z);
    if (d > n.radius) return;
    this.investigate.set(n.x, 0, n.z);
    if (this.state === AIState.Patrol || this.state === AIState.Idle || this.state === AIState.Returning) {
      this.state = AIState.Suspicious;
      this.suspicion = Math.max(this.suspicion, 35);
    } else if (this.state === AIState.Suspicious || this.state === AIState.Investigating || this.state === AIState.Searching) {
      this.state = AIState.Investigating;
    }
  }

  seeCorpse(x: number, z: number): void {
    if (this.dead || this.inCombat) return;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d < CFG.stealth.corpseNoticeDist && !this.seen) {
      this.seen = true;
      this.investigate.set(x, 0, z);
      this.lastKnown.set(x, 0, z);
      this.searchT = 0; this.ringT = 0;
      this.corpseT = CORPSE_SEARCH_S; // 4s spiral around the body, then give up
      this.state = AIState.Investigating;
      this.suspicion = 80;
    }
  }

  takeDamage(dmg: number, fromYaw: number, heavy: boolean, audio: AudioEngine): boolean {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hitT = 0.3;
    // brute poise: light hits never stagger it; only heavy (incl. dash-stagger,
    // which central forwards as heavy=true) interrupts the slam.
    this.stagger = heavy ? 0.55 : this.kind === 'brute' ? 0 : 0.3;
    audio.hit();
    if (this.hp <= 0) {
      this.hp = 0; this.dead = true; this.state = AIState.Dead; this.deathT = 0;
      return true;
    }
    // getting hit alerts instantly
    this.state = AIState.Combat;
    this.lastKnownT = performance.now() / 1000;
    this.yaw = fromYaw;
    return false;
  }

  assassinate(audio: AudioEngine): boolean {
    if (this.dead) return false;
    this.hp = 0; this.dead = true; this.state = AIState.Dead; this.deathT = 0;
    audio.assassinate();
    return true;
  }

  /**
   * Group callout WITHOUT omniscience: the spotter shares ONLY its lastKnown
   * (central onSpotted re-broadcasts that position to nearby guards — never
   * live tracking). calloutT throttles repeats so a flickering glimpse (or a
   * long stare) calls the squad once per CALLOUT_CD_S instead of every tick.
   */
  private spot(now: number, onSpotted: (e: Enemy) => void): void {
    void now;
    this.state = AIState.Alert;
    if (this.calloutT <= 0) {
      this.calloutT = CALLOUT_CD_S;
      onSpotted(this);
    }
  }

  /** shared melee: telegraph -> strike flag. Range uses LIVE dist (fair). */
  private melee(dt: number, audio: AudioEngine): void {
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        this.swingT = 0.3; this.parryable = this.kind !== 'brute'; this.struck = true;
        this.isHeavySwing = this.kind === 'brute';
      }
    } else if (this.swingT > 0) {
      this.swingT -= dt;
      if (this.swingT <= 0) { this.parryable = false; this.isHeavySwing = false; }
    } else if (this.atkCD <= 0) {
      this.windup = WINDUP[this.kind]; // telegraph
      this.atkCD = KIND_STATS[this.kind].atkCd;
      audio.swoosh();
    }
  }

  /**
   * Knife release countdown shared by ranger + disengaging elites.
   * Only sets flags/positions + cooldowns — NEVER damages the player.
   * Central spawns the projectile VFX from throwFrom->throwTarget and applies
   * RANGER_THROW_DMG on hit, then resets threwKnife=false.
   */
  private tickThrow(dt: number, player: PlayerRef, vis: number, audio: AudioEngine, cdMin: number, cdMax: number): void {
    if (this.throwTele <= 0) return;
    this.throwTele -= dt;
    this.face(this.lastKnown, 8, dt); // aim at the remembered position (no magic tracking)
    if (this.throwTele <= 0) {
      if (vis <= 0.02) { this.throwTele = 0; this.knifeCD = 0.5; return; } // lost sight: hold the knife
      this.threwKnife = true;
      this.throwFrom.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
      this.throwTarget.set(this.lastKnown.x, this.lastKnown.y + 1.2, this.lastKnown.z);
      void player;
      this.knifeCD = cdMin + Math.random() * (cdMax - cdMin);
      audio.swoosh();
    }
  }

  /** staggered brain tick (10Hz). Rendering/pose runs every frame in updateVisual. */
  tick(dt: number, now: number, player: PlayerRef, world: World, audio: AudioEngine, onSpotted: (e: Enemy) => void, onLost: (e: Enemy) => void): void {
    if (this.dead) return;
    this.atkCD -= dt; this.hitT -= dt; this.stagger -= dt;
    this.calloutT -= dt;
    const dx = player.pos.x - this.pos.x; const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const dy = Math.abs(player.pos.y - this.pos.y);
    const blocked = dy > 3.2 ? false : world.losBlocked(this.pos.x, 1.6, this.pos.z, player.pos.x, (player.crouch ? 0.9 : 1.5) + player.pos.y - this.pos.y + this.pos.y, player.pos.z);
    // NOTE: losBlocked uses absolute coords; enemy eye at pos.y+1.6
    const eyeBlocked = dy > 3.5 ? false : world.losBlocked(
      this.pos.x, this.pos.y + 1.6, this.pos.z,
      player.pos.x, player.pos.y + (player.crouch ? 0.9 : 1.5), player.pos.z);
    const fov = inFov(this.pos.x, this.pos.z, this.yaw, player.pos.x, player.pos.z, CFG.stealth.fovDeg);
    const vis = player.dead ? 0 : visibility({
      dist, inFov: fov, blocked: eyeBlocked, crouch: player.crouch,
      sprinting: player.sprinting, elevatedAttacker: false, light: player.light ?? 1,
    });
    void blocked;

    if (!player.dead && vis > 0.02) {
      this.unseenT = 0;
      // alertness gain differs by archetype: guards slow, elites keen, captains relentless
      const alertMul = this.kind === 'captain' ? 1.3 : this.kind === 'elite' ? 1.15 : this.kind === 'ranger' ? 1.1 : this.kind === 'brute' ? 0.8 : 0.85;
      // silent-vs-noisy movement gap: crouch stills suspicion, sprinting feeds it.
      const rate = suspicionRate(vis, dist) * this.viewMul * alertMul * stanceMul(player.crouch, player.sprinting);
      const was = this.suspicion;
      this.suspicion = clamp(this.suspicion + rate * dt, 0, 100);
      if (was < 35 && this.suspicion >= 35 && (this.state === AIState.Patrol || this.state === AIState.Idle)) {
        this.state = AIState.Suspicious; audio.suspicious();
      }
      if (this.suspicion >= CFG.stealth.alertThreshold && !this.inCombat) {
        this.lastKnown.copy(player.pos); this.lastKnownT = now;
        this.spot(now, onSpotted);
        audio.alert();
      }
      if (this.inCombat) { this.lastKnown.copy(player.pos); this.lastKnownT = now; this.lostT = 0; }
    } else {
      this.unseenT += dt;
      const decay = CFG.stealth.decayRate * (player.hidden ? 3 : 1) * dt;
      this.suspicion = Math.max(0, this.suspicion - decay);
      if (this.state === AIState.Suspicious && this.suspicion <= 0) this.state = AIState.Patrol;
    }
    // UI readability tier (0 calm <35, 1 curious 35-69, 2 alarmed 70+).
    this.suspicionTier = this.suspicion >= 70 ? 2 : this.suspicion >= 35 ? 1 : 0;

    // Vertical awareness: prey >3m above and close in 2D = unreachable ledge/roof.
    // Don't vibrate against the wall: drop to SEARCHING and wait below their xz.
    // Rangers keep throwing from below; guards rely on the shared callout.
    const highAbove = dy > UNREACHABLE_DY && dist < 6;
    if (highAbove && (this.state === AIState.Combat || this.state === AIState.Alert)) {
      this.state = AIState.Searching;
      this.investigate.set(player.pos.x, 0, player.pos.z);
      this.lastKnown.copy(player.pos); this.lastKnownT = now;
      this.searchT = 0; this.ringT = 0;
    }

    switch (this.state) {
      case AIState.Idle:
        this.waitT -= dt;
        if (this.waitT <= 0) { this.state = AIState.Patrol; }
        break;
      case AIState.Patrol: {
        const wp = this.patrol[this.wpIndex % this.patrol.length];
        if (this.moveToward(wp, this.speed * 0.45, dt, world)) {
          this.wpIndex = (this.wpIndex + 1) % this.patrol.length;
          this.state = AIState.Idle; this.waitT = 1 + Math.random() * 2;
        }
        break;
      }
      case AIState.Suspicious:
        // stare at stimulus, small step
        if (this.suspicion <= 0) this.state = AIState.Patrol;
        else if (this.suspicion > 70) { this.state = AIState.Investigating; }
        break;
      case AIState.Investigating: {
        if (this.corpseT > 0) {
          // CORPSE SEARCH: spiral around the body (lastKnown) for CORPSE_SEARCH_S,
          // suspicion pinned high, then disengage. Reuses the searchT/ringT pattern.
          this.corpseT -= dt;
          this.suspicion = Math.max(this.suspicion, 70);
          this.searchT += dt; this.ringT += dt;
          const arrived = this.moveToward(this.investigate, this.speed * 0.7, dt, world);
          if (arrived || this.ringT > 1.2) {
            this.ringT = 0;
            const a = this.searchT * 2.2 + this.id * 1.7;
            const r = 1.5 + this.searchT * 0.8;
            this.investigate.set(this.lastKnown.x + Math.cos(a) * r, 0, this.lastKnown.z + Math.sin(a) * r);
          }
          if (this.corpseT <= 0) {
            this.corpseT = 0; this.searchT = 0; this.ringT = 0;
            this.state = AIState.Returning; this.suspicion = Math.max(0, this.suspicion - 40);
          }
          if (this.suspicion >= CFG.stealth.alertThreshold) { this.spot(now, onSpotted); }
          break;
        }
        if (this.moveToward(this.investigate, this.speed * 0.7, dt, world)) {
          this.waitT += dt;
          this.yaw += dt * 1.5; // look around
          if (this.waitT > 2.5) {
            // only give up after 3s truly unseen — no psychic re-alerts.
            if (this.unseenT > UNSEEN_RETURN_S) {
              this.waitT = 0; this.state = AIState.Returning; this.suspicion = Math.max(0, this.suspicion - 40);
            } else this.waitT = 2.5; // hold the look-around
          }
        }
        if (this.suspicion >= CFG.stealth.alertThreshold) { this.spot(now, onSpotted); }
        break;
      }
      case AIState.Alert:
        // brief freeze then chase
        this.combatT += dt;
        this.face(this.lastKnown, 8, dt);
        if (this.combatT > 0.7) { this.combatT = 0; this.state = AIState.Combat; }
        break;
      case AIState.Combat: {
        if (player.dead) { this.state = AIState.Returning; break; }
        this.lostT = now - this.lastKnownT;
        if (this.lostT > CFG.stealth.losePlayerTime && dist > 20) {
          this.state = AIState.Searching; this.investigate.copy(this.lastKnown); this.searchT = 0;
          onLost(this);
          break;
        }
        this.combatT += dt;
        // chase memory, not the player: lastKnown unless seen THIS tick.
        const chase: THREE.Vector3 = vis > 0.02 ? player.pos : this.lastKnown;
        const cdx = chase.x - this.pos.x; const cdz = chase.z - this.pos.z;
        const cdist = Math.hypot(cdx, cdz);
        this.charging = false;
        // reached the memory but nobody there: sweep the area instead of idling.
        if (cdist < 0.6 && dist > this.strikeRange + 1 && this.backoffT <= 0) {
          this.state = AIState.Searching;
          this.investigate.copy(this.lastKnown); this.searchT = 0; this.ringT = 0;
          break;
        }
        // finishing a disengage backoff always wins over kind movement.
        if (this.backoffT > 0) {
          this.backoffT -= dt;
          this.moveToward(this.fallback, this.speed, dt, world);
          this.tickThrow(dt, player, vis, audio, ELITE_THROW_CD_MIN, ELITE_THROW_CD_MAX);
          break;
        }
        if (this.kind === 'ranger') {
          if (dist <= this.strikeRange) {
            this.face(chase, 10, dt);
            this.melee(dt, audio);
          } else if (cdist < RANGER_BAND_MIN) {
            // too close: back away from the remembered position.
            const m = cdist || 1;
            _tmp.set(this.pos.x + (this.pos.x - chase.x) / m * 4, 0, this.pos.z + (this.pos.z - chase.z) / m * 4);
            this.moveToward(_tmp, this.speed * 0.9, dt, world);
          } else if (cdist > RANGER_BAND_MAX) {
            this.moveToward(chase, this.speed, dt, world);
          } else {
            // hold the band: face + drift sideways.
            this.face(chase, 8, dt);
            if (Math.random() < dt * 0.5) this.strafeDir *= -1;
            const m = cdist || 1;
            _tmp.set(
              chase.x + (-cdz / m) * 3 * this.strafeDir, 0,
              chase.z + (cdx / m) * 3 * this.strafeDir);
            this.moveToward(_tmp, this.speed * 0.4, dt, world);
          }
          // knife cadence (2.5-3.5s) with 0.7s telegraph; only at seen targets.
          this.tickThrow(dt, player, vis, audio, RANGER_THROW_CD_MIN, RANGER_THROW_CD_MAX);
          if (this.throwTele <= 0) {
            this.knifeCD -= dt;
            if (this.knifeCD <= 0 && vis > 0.02 && dist > 3 && dist < 20) {
              this.throwTele = RANGER_THROW_TELEGRAPH;
            }
          }
        } else if (this.kind === 'brute') {
          if (dist <= this.strikeRange) {
            this.face(chase, 10, dt);
            this.melee(dt, audio); // 0.8s windup heavy slam, isHeavySwing on release
          } else if (cdist >= BRUTE_CHARGE_MIN && cdist <= BRUTE_CHARGE_MAX) {
            // charge: straight-line sprint at the remembered position.
            this.charging = true;
            this.moveToward(chase, this.speed * 1.7, dt, world);
          } else {
            this.moveToward(chase, this.speed, dt, world);
          }
        } else {
          // guard / elite / captain
          if (this.kind === 'elite' && this.hp < this.maxHp * 0.25) {
            // DISENGAGE: 30% chance per 2s to back off 4m and throw like a ranger (longer cd).
            this.disengageT -= dt;
            if (this.disengageT <= 0) {
              this.disengageT = 2;
              if (Math.random() < 0.3 && cdist > 1) {
                const m = cdist || 1;
                this.fallback.set(this.pos.x + (this.pos.x - chase.x) / m * 4, 0, this.pos.z + (this.pos.z - chase.z) / m * 4);
                this.backoffT = 1.1;
                this.throwTele = RANGER_THROW_TELEGRAPH;
                break;
              }
            }
          }
          if (cdist > 2.0) {
            // elites/captains strafe to flank instead of charging straight
            if ((this.kind === 'elite' || this.kind === 'captain') && cdist < 8 && cdist > 2.4) {
              if (Math.random() < dt * 0.4) this.strafeDir *= -1;
              const m = cdist || 1;
              _strafe.set(
                chase.x + (-cdz / m) * 4 * this.strafeDir + (cdx / m) * 1.5, 0,
                chase.z + (cdx / m) * 4 * this.strafeDir + (cdz / m) * 1.5);
              this.moveToward(_strafe, this.speed * 0.85, dt, world);
            } else {
              this.moveToward(chase, this.speed, dt, world);
            }
          } else {
            this.face(chase, 10, dt);
            if (dist <= this.strikeRange) this.melee(dt, audio); // strike needs LIVE dist
          }
        }
        break;
      }
      case AIState.Searching: {
        if (highAbove) {
          // prey unreachable overhead: hold below their xz and keep watching.
          this.moveToward(this.investigate, this.speed * 0.7, dt, world);
          this.face(this.lastKnown, 6, dt);
          this.searchT = 0; this.ringT = 0;
          if (this.kind === 'ranger') {
            this.tickThrow(dt, player, vis, audio, RANGER_THROW_CD_MIN, RANGER_THROW_CD_MAX);
            if (this.throwTele <= 0) {
              this.knifeCD -= dt;
              if (this.knifeCD <= 0 && vis > 0.02 && dist < 20) this.throwTele = RANGER_THROW_TELEGRAPH;
            }
          }
          break;
        }
        if (!player.dead && vis > 0.3) { this.state = AIState.Combat; this.lastKnownT = now; this.searchT = 0; break; }
        // progressive spiral search around last known position, then give up gradually
        this.searchT += dt; this.ringT += dt;
        const arrived = this.moveToward(this.investigate, this.speed * 0.7, dt, world);
        if (arrived || this.ringT > 2.4) {
          this.ringT = 0;
          const a = this.searchT * 1.5 + this.id * 1.7;
          const r = 2 + this.searchT * 1.1;
          this.investigate.set(this.lastKnown.x + Math.cos(a) * r, 0, this.lastKnown.z + Math.sin(a) * r);
        }
        this.yaw += dt * (arrived ? 2 : 0.4);
        if (this.searchT > 12) {
          // only stand down after 3s truly unseen — a fresh glimpse extends the hunt.
          if (this.unseenT > UNSEEN_RETURN_S) {
            this.searchT = 0; this.ringT = 0; this.waitT = 0;
            this.state = AIState.Returning; this.suspicion = Math.max(0, this.suspicion - 50);
          } else this.searchT = 10;
        }
        break;
      }
      case AIState.Returning: {
        const home = this.patrol[0];
        if (this.moveToward(home, this.speed * 0.6, dt, world)) this.state = AIState.Patrol;
        break;
      }
    }
  }

  private moveToward(t: THREE.Vector3, speed: number, dt: number, world: World): boolean {
    const dx = t.x - this.pos.x; const dz = t.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) { this.moveAmt *= 0.8; return true; }
    const tyaw = Math.atan2(dx, dz);
    this.yaw = dampAngle(this.yaw, tyaw + Math.PI, 6, dt);
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
    world.collideCircle(this.pos, 0.4, 1.4);
    this.pos.y = world.groundHeight(this.pos.x, this.pos.z);
    this.moveAmt = Math.min(1, this.moveAmt + dt * 4);
    return false;
  }

  private face(t: THREE.Vector3, lambda: number, dt: number): void {
    const tyaw = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
    this.yaw = dampAngle(this.yaw, tyaw + Math.PI, lambda, dt);
  }

  /** per-frame visual sync (cheap) */
  syncVisual(dt: number): void {
    if (this.dead) {
      this.deathT += dt;
      this.animator.animate(this.rig, 'death', 0, dt, { crouch: false, attacking: 0, parry: 0, dodge: 0, dead: true, stagger: 0 });
    } else {
      const atk = this.swingT > 0 ? 1 - this.swingT / 0.25 : this.windup > 0 ? 0.15 : 0;
      const st: MoveState = this.moveAmt > 0.2 ? 'run' : this.state === AIState.Idle ? 'idle' : 'walk';
      this.animator.animate(this.rig, st, this.moveAmt * 4, dt, {
        crouch: false, attacking: atk, parry: 0, dodge: 0, dead: false, stagger: Math.max(0, this.stagger),
      });
      this.moveAmt *= 1 - Math.min(1, dt * 0.5);
    }
    this.rig.group.position.copy(this.pos);
    this.rig.group.rotation.y = this.yaw;
  }

  isBehindOf(px: number, pz: number): boolean {
    void isBehind;
    const dx = px - this.pos.x; const dz = pz - this.pos.z;
    const ang = Math.atan2(dx, dz);
    return Math.abs(((ang - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI) < Math.PI / 2.2;
  }
}
void angleDiff;
