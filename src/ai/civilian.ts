// Ambient civilians: ultra-cheap wander/idle/flee/cower. No perception,
// no LOS, 2Hz reactions only. Increases city life at negligible cost.
//
// Archetypes (single class, arch switch — 3rd ctor param, default 'walker'):
// - vendor: static, tends its stall, cowers in place instead of running.
// - walker: existing idle/wander between spots.
// - sweeper: tiny patrol loop — slow short-range wander around home (radius 4m).
// - courier: fast waypoint runner cycling across the whole spots list.
import * as THREE from 'three';
import { dampAngle } from '../core/utils';
import { World } from '../world/world';
import { CFG, NoiseEvent } from '../core/config';
import { buildRig, PoseAnimator, Rig } from '../player/rig';

export type CivState = 'IDLE' | 'WANDER' | 'FLEE' | 'COWER';
export type CivArch = 'vendor' | 'walker' | 'sweeper' | 'courier';

/** Where fleeing civilians run: fixed safe points, not random directions. */
export const SAFE_ZONES: Array<{ x: number; z: number }> = [
  { x: 0, z: 40 },   // south gate
  { x: -30, z: 28 }, // west market corner
  { x: 30, z: 28 },  // east market corner
  { x: 0, z: -40 },  // north passage
];

/** seconds between scream callouts from the same civilian (anti-spam). */
export const SCREAM_CD_S = 8;

const CIV_COLORS = [0x4a3f35, 0x37424f, 0x4f3737, 0x3a4a3a, 0x4a4a38];

export class Civilian {
  rig: Rig;
  animator = new PoseAnimator();
  pos = new THREE.Vector3();
  yaw = 0;
  state: CivState = 'IDLE';
  readonly arch: CivArch;
  home = new THREE.Vector3();
  wpIndex = 0;
  waitT = Math.random() * 3;
  target = new THREE.Vector3();
  moveAmt = 0;
  cowerT = 0;
  hideT = 0;
  dead = false;
  screamCD = 0;
  /** personal-space radius (meters). Central resolves overlap via pushOut(). */
  avoidR = 0.9;
  /**
   * Corpse-scream hook. Central wires it to a loud noise event (which alerts
   * guards via the normal hearing path). Undefined = scream silently (flee only).
   */
  onScream?: (x: number, z: number) => void;

  constructor(private spots: THREE.Vector3[], colorIdx: number, arch: CivArch = 'walker') {
    this.arch = arch;
    this.rig = buildRig('guard');
    // repaint shared? NO — materials are shared. Tint via per-mesh scale variety instead.
    void colorIdx;
    const s = 0.92 + Math.random() * 0.16;
    this.rig.group.scale.setScalar(s);
    // remove sword (civilians unarmed): hide blade+grip group
    this.rig.sword.visible = false;
    const home = spots[Math.floor(Math.random() * spots.length)];
    this.pos.copy(home);
    this.home.copy(home);
    this.target.copy(home);
  }

  get group(): THREE.Object3D { return this.rig.group; }

  /** wander speed per archetype (couriers hurry, sweepers dawdle). */
  get walkSpeed(): number {
    if (this.arch === 'courier') return 3.4;
    if (this.arch === 'sweeper') return 1.0;
    return 1.4;
  }

  scare(x: number, z: number, big: boolean): void {
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > (big ? 26 : 14)) return;
    if (this.state === 'COWER') return;
    if (this.arch === 'vendor') {
      // vendors freeze behind their stall instead of running.
      this.state = 'COWER';
      this.cowerT = 0;
      return;
    }
    this.state = big ? 'COWER' : 'FLEE';
    this.cowerT = 0;
    if (!big) {
      // flee to the nearest safe zone (fixed list) instead of a random direction.
      let bi = 0; let bd = Infinity;
      for (let i = 0; i < SAFE_ZONES.length; i++) {
        const s = SAFE_ZONES[i];
        const dd = (s.x - this.pos.x) * (s.x - this.pos.x) + (s.z - this.pos.z) * (s.z - this.pos.z);
        if (dd < bd) { bd = dd; bi = i; }
      }
      const sz = SAFE_ZONES[bi];
      this.target.set(sz.x, 0, sz.z);
    }
  }

  /**
   * Separation resolver (central-owned spatial query): push this civilian out
   * of overlap with a circle at (x,z,r) — typically the player + nearest
   * enemies, called per frame (few civilians = cheap). Positional only, no
   * allocations, no world queries. minD = r + avoidR.
   */
  pushOut(x: number, z: number, r: number): void {
    const dx = this.pos.x - x; const dz = this.pos.z - z;
    const minD = r + this.avoidR;
    const d2 = dx * dx + dz * dz;
    if (d2 >= minD * minD || d2 < 1e-8) return;
    const d = Math.sqrt(d2);
    const push = (minD - d) / d;
    this.pos.x += dx * push;
    this.pos.z += dz * push;
  }

  /** corpse discovery (distance-only, no LOS): scream once, then run. */
  seeCorpse(x: number, z: number, hidden = false): void {
    if (this.dead) return;
    if (hidden) return; // stashed corpse (corpse.hiddenBody): no scream, no flee
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > CFG.stealth.corpseNoticeDist) return;
    if (this.screamCD > 0) return;
    this.screamCD = SCREAM_CD_S;
    if (this.onScream) this.onScream(x, z); // central turns this into a loud noise event
    this.scare(x, z, false); // flee afterwards (vendors cower)
  }

  hearNoise(n: NoiseEvent): void {
    if (n.loudness >= 1.2) this.scare(n.x, n.z, n.kind === 'fight');
  }

  /** 2Hz brain (called with dt≈0.5 accumulated). No LOS, no allocations. */
  slowTick(dt: number, world: World): void {
    void world;
    this.cowerT += dt;
    this.screamCD -= dt;
    if (this.state === 'COWER') {
      if (this.cowerT > 6) { this.state = 'IDLE'; this.waitT = 1; }
      return;
    }
    if (this.state === 'FLEE') {
      if (this.reached(1.2) || this.cowerT > 5) { this.state = 'COWER'; this.cowerT = 0; }
      return;
    }
    this.waitT -= dt;
    if (this.waitT <= 0) {
      if (this.arch === 'vendor') { this.waitT = 4; return; } // static: tends the stall
      if (this.arch === 'sweeper') {
        // tiny patrol loop: slow wander within 4m of home.
        this.target.set(this.home.x + (Math.random() * 8 - 4), 0, this.home.z + (Math.random() * 8 - 4));
        this.state = 'WANDER';
        this.waitT = 2 + Math.random() * 3;
      } else if (this.arch === 'courier') {
        // fast waypoint runner: cycle the spots list in order, short pauses.
        this.wpIndex = (this.wpIndex + 1) % this.spots.length;
        this.target.copy(this.spots[this.wpIndex]);
        this.state = 'WANDER';
        this.waitT = 1 + Math.random() * 2;
      } else {
        const s = this.spots[Math.floor(Math.random() * this.spots.length)];
        this.target.copy(s);
        this.state = 'WANDER';
        this.waitT = 4 + Math.random() * 6;
      }
    }
  }

  private reached(r: number): boolean {
    return Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < r;
  }

  /** per-frame: cheap move + pose */
  update(dt: number, world: World): void {
    if (this.state === 'WANDER' || this.state === 'FLEE') {
      const dx = this.target.x - this.pos.x; const dz = this.target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.4) {
        const sp = this.state === 'FLEE' ? 4.5 : this.walkSpeed;
        this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz) + Math.PI, 5, dt);
        const step = Math.min(d, sp * dt);
        this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
        world.collideCircle(this.pos, 0.35, 1.4);
        this.pos.y = world.groundHeight(this.pos.x, this.pos.z);
        this.moveAmt = Math.min(1, this.moveAmt + dt * 3);
      } else if (this.state === 'WANDER') {
        this.state = 'IDLE'; this.waitT = 2 + Math.random() * 4;
      }
    } else {
      this.moveAmt *= 1 - Math.min(1, dt * 3);
    }
    const cower = this.state === 'COWER';
    this.animator.animate(this.rig, this.moveAmt > 0.2 ? 'run' : 'idle', this.moveAmt * 1.5, dt, {
      crouch: cower, attacking: 0, parry: 0, dodge: 0, dead: false, stagger: 0,
    });
    this.rig.group.position.copy(this.pos);
    this.rig.group.rotation.y = this.yaw;
    this.hideT = 0;
  }
}

export function civilianSpots(): THREE.Vector3[] {
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  return [V(-3, 0, 24), V(3, 0, 26), V(-6, 0, 18), V(6, 0, 14), V(0, 0, 20), V(-2, 0, -14), V(4, 0, -6), V(-8, 0, -2)];
}
void CIV_COLORS;
