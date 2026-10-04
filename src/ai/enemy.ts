// Efficient enemy AI: state machine, staggered 10Hz ticks, spatial checks.
// Behaviors: patrol, observe, hear noise, investigate, see corpses, chase,
// melee combat with telegraphs, lose player, return to patrol.
import * as THREE from 'three';
import { AIState, CFG, NoiseEvent } from '../core/config';
import { angleDiff, clamp, dampAngle } from '../core/utils';
import type { MoveState } from '../core/config';
import { World } from '../world/world';
import { inFov, isBehind, suspicionRate, visibility } from '../stealth/perception';
import { buildRig, PoseAnimator, Rig } from '../player/rig';
import { AudioEngine } from '../audio/audio';

const _strafe = new THREE.Vector3();

export type EnemyKind = 'guard' | 'elite' | 'captain';

export interface PlayerRef {
  pos: THREE.Vector3; crouch: boolean; sprinting: boolean; dead: boolean;
  elevated: boolean; moving: number; yaw: number; attackT: number; hidden: boolean;
}

const KIND_STATS: Record<EnemyKind, { hp: number; dmg: number; speed: number; view: number; atkCd: number }> = {
  guard: { hp: 60, dmg: CFG.combat.enemyDmg, speed: 4.2, view: 1, atkCd: 1.6 },
  elite: { hp: 110, dmg: CFG.combat.enemyHeavyDmg - 4, speed: 4.8, view: 1.15, atkCd: 1.25 },
  captain: { hp: 200, dmg: CFG.combat.enemyHeavyDmg, speed: 5.2, view: 1.3, atkCd: 1.0 },
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
  patrol: THREE.Vector3[];
  wpIndex = 0;
  waitT = 0;
  investigate = new THREE.Vector3();
  lastKnown = new THREE.Vector3();
  lastKnownT = -99;
  lostT = 0;
  atkCD = 0; windup = 0; swingT = 0; stagger = 0; hitT = 0;
  struck = false; // set the exact tick a swing lands (consumed by CombatSystem)
  acc = 0; // brain accumulator for fixed-Hz ticks
  strafeDir = 1; searchT = 0; ringT = 0;
  dead = false; deathT = 0; seen = false; // seen = corpse discovered
  alertedOthers = false;
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
    this.rig = buildRig(kind);
    this.tickOffset = Math.random();
  }

  get dmg(): number { return KIND_STATS[this.kind].dmg; }
  get speed(): number { return KIND_STATS[this.kind].speed; }
  get viewMul(): number { return KIND_STATS[this.kind].view; }

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
      this.state = AIState.Investigating;
      this.suspicion = 80;
    }
  }

  takeDamage(dmg: number, fromYaw: number, heavy: boolean, audio: AudioEngine): boolean {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hitT = 0.3; this.stagger = heavy ? 0.55 : 0.3;
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

  /** staggered brain tick (10Hz). Rendering/pose runs every frame in updateVisual. */
  tick(dt: number, now: number, player: PlayerRef, world: World, audio: AudioEngine, onSpotted: (e: Enemy) => void, onLost: (e: Enemy) => void): void {
    if (this.dead) return;
    this.atkCD -= dt; this.hitT -= dt; this.stagger -= dt;
    const dx = player.pos.x - this.pos.x; const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const dy = Math.abs(player.pos.y - this.pos.y);
    const blocked = dy > 3.2 ? false : world.losBlocked(this.pos.x, 1.6, this.pos.z, player.pos.x, (player.crouch ? 0.9 : 1.5) + player.pos.y - this.pos.y + this.pos.y, player.pos.z);
    // NOTE: losBlocked uses absolute coords; enemy eye at pos.y+1.6
    const eyeBlocked = dy > 3.5 ? false : world.losBlocked(
      this.pos.x, this.pos.y + 1.6, this.pos.z,
      player.pos.x, player.pos.y + (player.crouch ? 0.9 : 1.5), player.pos.z);
    const fov = inFov(this.pos.x, this.pos.z, this.yaw, player.pos.x, player.pos.z, CFG.stealth.fovDeg);
    const vis = player.dead ? 0 : visibility({ dist, inFov: fov, blocked: eyeBlocked, crouch: player.crouch, sprinting: player.sprinting, elevatedAttacker: false });
    void blocked;

    if (!player.dead && vis > 0.02) {
      // alertness gain differs by archetype: guards slow, elites keen, captains relentless
      const alertMul = this.kind === 'captain' ? 1.3 : this.kind === 'elite' ? 1.15 : 0.85;
      const rate = suspicionRate(vis, dist) * this.viewMul * alertMul;
      const was = this.suspicion;
      this.suspicion = clamp(this.suspicion + rate * dt, 0, 100);
      if (was < 35 && this.suspicion >= 35 && (this.state === AIState.Patrol || this.state === AIState.Idle)) {
        this.state = AIState.Suspicious; audio.suspicious();
      }
      if (this.suspicion >= CFG.stealth.alertThreshold && !this.inCombat) {
        this.state = AIState.Alert;
        this.lastKnown.copy(player.pos); this.lastKnownT = now;
        onSpotted(this);
        audio.alert();
      }
      if (this.inCombat) { this.lastKnown.copy(player.pos); this.lastKnownT = now; this.lostT = 0; }
    } else {
      const decay = CFG.stealth.decayRate * (player.hidden ? 3 : 1) * dt;
      this.suspicion = Math.max(0, this.suspicion - decay);
      if (this.state === AIState.Suspicious && this.suspicion <= 0) this.state = AIState.Patrol;
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
        if (this.moveToward(this.investigate, this.speed * 0.7, dt, world)) {
          this.waitT += dt;
          this.yaw += dt * 1.5; // look around
          if (this.waitT > 2.5) { this.waitT = 0; this.state = AIState.Returning; this.suspicion = Math.max(0, this.suspicion - 40); }
        }
        if (this.suspicion >= CFG.stealth.alertThreshold) { this.state = AIState.Alert; onSpotted(this); }
        break;
      }
      case AIState.Alert:
        // brief freeze then chase
        this.combatT += dt;
        this.face(player.pos, 8, dt);
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
        if (dist > 2.0) {
          // elites/captains strafe to flank instead of charging straight
          if ((this.kind === 'elite' || this.kind === 'captain') && dist < 8 && dist > 2.4) {
            if (Math.random() < dt * 0.4) this.strafeDir *= -1;
            const px = player.pos.x - this.pos.x; const pz = player.pos.z - this.pos.z;
            const m = Math.hypot(px, pz) || 1;
            _strafe.set(player.pos.x + (-pz / m) * 4 * this.strafeDir + (px / m) * 1.5, 0, player.pos.z + (px / m) * 4 * this.strafeDir + (pz / m) * 1.5);
            this.moveToward(_strafe, this.speed * 0.85, dt, world);
          } else {
            this.moveToward(player.pos, this.speed, dt, world);
          }
        } else {
          this.face(player.pos, 10, dt);
          // attack with telegraph
          if (this.windup > 0) {
            this.windup -= dt;
            if (this.windup <= 0) { this.swingT = 0.3; this.parryable = true; this.struck = true; }
          } else if (this.swingT > 0) {
            this.swingT -= dt;
            if (this.swingT <= 0) this.parryable = false;
          } else if (this.atkCD <= 0) {
            this.windup = this.kind === 'captain' ? 0.45 : 0.6; // telegraph
            audio.swoosh();
          }
        }
        break;
      }
      case AIState.Searching: {
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
          this.searchT = 0; this.ringT = 0; this.waitT = 0;
          this.state = AIState.Returning; this.suspicion = Math.max(0, this.suspicion - 50);
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
