// Ambient civilians: ultra-cheap wander/idle/flee/cower. No perception,
// no LOS, 2Hz reactions only. Increases city life at negligible cost.
import * as THREE from 'three';
import { dampAngle } from '../core/utils';
import { World } from '../world/world';
import { NoiseEvent } from '../core/config';
import { buildRig, PoseAnimator, Rig } from '../player/rig';

export type CivState = 'IDLE' | 'WANDER' | 'FLEE' | 'COWER';

const CIV_COLORS = [0x4a3f35, 0x37424f, 0x4f3737, 0x3a4a3a, 0x4a4a38];

export class Civilian {
  rig: Rig;
  animator = new PoseAnimator();
  pos = new THREE.Vector3();
  yaw = 0;
  state: CivState = 'IDLE';
  waitT = Math.random() * 3;
  target = new THREE.Vector3();
  moveAmt = 0;
  cowerT = 0;
  hideT = 0;
  dead = false;

  constructor(private spots: THREE.Vector3[], colorIdx: number) {
    this.rig = buildRig('guard');
    // repaint shared? NO — materials are shared. Tint via per-mesh scale variety instead.
    void colorIdx;
    const s = 0.92 + Math.random() * 0.16;
    this.rig.group.scale.setScalar(s);
    // remove sword (civilians unarmed): hide blade+grip group
    this.rig.sword.visible = false;
    const home = spots[Math.floor(Math.random() * spots.length)];
    this.pos.copy(home);
    this.target.copy(home);
  }

  get group(): THREE.Object3D { return this.rig.group; }

  scare(x: number, z: number, big: boolean): void {
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > (big ? 26 : 14)) return;
    if (this.state === 'COWER') return;
    this.state = big ? 'COWER' : 'FLEE';
    this.cowerT = 0;
    // flee away from stimulus
    const dx = this.pos.x - x; const dz = this.pos.z - z;
    const m = Math.hypot(dx, dz) || 1;
    this.target.set(this.pos.x + (dx / m) * 14, 0, this.pos.z + (dz / m) * 14);
    this.target.x = Math.max(-44, Math.min(44, this.target.x));
    this.target.z = Math.max(-44, Math.min(44, this.target.z));
  }

  hearNoise(n: NoiseEvent): void {
    if (n.loudness >= 1.2) this.scare(n.x, n.z, n.kind === 'fight');
  }

  /** 2Hz brain (called with dt≈0.5 accumulated) */
  slowTick(dt: number, world: World): void {
    this.cowerT += dt;
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
      const s = this.spots[Math.floor(Math.random() * this.spots.length)];
      this.target.copy(s);
      this.state = 'WANDER';
      this.waitT = 4 + Math.random() * 6;
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
        const sp = this.state === 'FLEE' ? 4.5 : 1.4;
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
