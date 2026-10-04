// Modern third-person camera: touch orbit, zoom (pinch/wheel), collision via
// world raycast, smoothing, combat/stealth behavior variants.
import * as THREE from 'three';
import { clamp, lerp } from '../core/utils';
import { World } from '../world/world';

export class ThirdPersonCamera {
  camera: THREE.PerspectiveCamera;
  yaw = Math.PI; pitch = 0.32; dist = 5.2;
  targetDist = 5.2;
  private cur = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private look = new THREE.Vector3();
  shake = 0;
  mode: 'explore' | 'combat' | 'stealth' = 'explore';

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.1, 220);
    this.cur.set(0, 2, 32);
  }

  addShake(v: number): void { this.shake = Math.min(1, this.shake + v); }

  update(dt: number, input: { camDX: number; camDY: number }, focus: THREE.Vector3, world: World, crouch: boolean, sprint: boolean): void {
    this.yaw -= input.camDX * 0.0042;
    this.pitch = clamp(this.pitch + input.camDY * 0.0032, -0.15, 1.1);
    if (sprint) this.targetDist = lerp(this.targetDist, 6.0, dt * 2);
    else if (crouch || this.mode === 'stealth') this.targetDist = lerp(this.targetDist, 4.2, dt * 3);
    else if (this.mode === 'combat') this.targetDist = lerp(this.targetDist, 5.8, dt * 3);
    else this.targetDist = lerp(this.targetDist, 5.2, dt * 3);
    this.dist = lerp(this.dist, this.targetDist, Math.min(1, dt * 8));

    const eyeH = crouch ? 1.2 : 1.7;
    this.desired.set(focus.x, focus.y + eyeH, focus.z);
    // camera offset
    const cx = this.desired.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist;
    const cz = this.desired.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist;
    const cy = this.desired.y + Math.sin(this.pitch) * this.dist;
    // collision: shrink dist until LOS clear
    let d = this.dist;
    for (let i = 0; i < 4; i++) {
      const t = d / this.dist;
      const px = this.desired.x + (cx - this.desired.x) * t;
      const py = this.desired.y + (cy - this.desired.y) * t;
      const pz = this.desired.z + (cz - this.desired.z) * t;
      if (!world.losBlocked(this.desired.x, this.desired.y, this.desired.z, px, py, pz)) break;
      d *= 0.7;
      if (d < 1.2) { d = 1.2; break; }
    }
    const t = d / this.dist;
    this.look.set(
      this.desired.x + (cx - this.desired.x) * t,
      this.desired.y + (cy - this.desired.y) * t,
      this.desired.z + (cz - this.desired.z) * t,
    );
    const k = 1 - Math.exp(-14 * dt);
    this.cur.lerp(this.look, k);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.35;
    this.camera.position.set(
      this.cur.x + (Math.random() - 0.5) * sh,
      this.cur.y + (Math.random() - 0.5) * sh,
      this.cur.z + (Math.random() - 0.5) * sh,
    );
    this.camera.lookAt(this.desired.x, this.desired.y + 0.2, this.desired.z);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
