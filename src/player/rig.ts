// Procedural low-poly humanoid (no skeletal assets): articulated boxes animated
// in code. One shared geometry/material set, per-character group.
import * as THREE from 'three';
import { MoveState } from '../core/config';

const skin = new THREE.MeshStandardMaterial({ color: 0xd8b596, roughness: 0.8 });
const clothDark = new THREE.MeshStandardMaterial({ color: 0x161b24, roughness: 0.9 });
const clothRed = new THREE.MeshStandardMaterial({ color: 0x7a1f2b, roughness: 0.85 });
const guardMat = new THREE.MeshStandardMaterial({ color: 0x2c3a4a, roughness: 0.85 });
const guardTrim = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6, metalness: 0.4 });
const bladeMat = new THREE.MeshStandardMaterial({ color: 0xb9c4d4, roughness: 0.25, metalness: 0.9, emissive: 0x223344 });

function part(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  ms.position.set(x, y, z);
  return ms;
}

export interface Rig {
  group: THREE.Group;
  hips: THREE.Group; torso: THREE.Mesh; head: THREE.Group;
  armL: THREE.Group; armR: THREE.Group; legL: THREE.Group; legR: THREE.Group;
  sword: THREE.Group; blade: THREE.Mesh;
  cloak: THREE.Mesh;
}

export function buildRig(kind: 'kestrel' | 'guard' | 'elite' | 'captain'): Rig {
  const cloth = kind === 'kestrel' ? clothDark : guardMat;
  const trim = kind === 'kestrel' ? clothRed : guardTrim;
  const group = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.95; group.add(hips);
  const pelvis = part(0.42, 0.22, 0.26, cloth, 0, 0, 0); hips.add(pelvis);
  const torso = part(0.46, 0.55, 0.28, cloth, 0, 0.4, 0); hips.add(torso);
  const sash = part(0.48, 0.12, 0.3, trim, 0, 0.18, 0); hips.add(sash);
  const head = new THREE.Group(); head.position.set(0, 0.78, 0); hips.add(head);
  const skull = part(0.26, 0.28, 0.26, skin, 0, 0.1, 0); head.add(skull);
  const hood = part(0.32, 0.2, 0.32, kind === 'kestrel' ? clothDark : guardMat, 0, 0.22, -0.02); head.add(hood);
  if (kind !== 'kestrel') {
    const helm = part(0.3, 0.1, 0.3, guardTrim, 0, 0.3, 0); head.add(helm);
  }
  const mkArm = (side: number): THREE.Group => {
    const g = new THREE.Group(); g.position.set(side * 0.3, 0.62, 0); hips.add(g);
    const up = part(0.13, 0.32, 0.13, cloth, 0, -0.16, 0); g.add(up);
    const lo = part(0.11, 0.3, 0.11, skin, 0, -0.46, 0); g.add(lo);
    return g;
  };
  const armL = mkArm(-1); const armR = mkArm(1);
  const mkLeg = (side: number): THREE.Group => {
    const g = new THREE.Group(); g.position.set(side * 0.13, -0.08, 0); hips.add(g);
    const th = part(0.16, 0.42, 0.16, cloth, 0, -0.21, 0); g.add(th);
    const sh = part(0.13, 0.42, 0.13, cloth, 0, -0.62, 0); g.add(sh);
    return g;
  };
  const legL = mkLeg(-1); const legR = mkLeg(1);
  // katana in right hand
  const sword = new THREE.Group(); sword.position.set(0, -0.6, 0.05); armR.add(sword);
  const grip = part(0.05, 0.22, 0.05, trim, 0, 0, 0); sword.add(grip);
  const guard = part(0.12, 0.03, 0.12, guardTrim, 0, 0.12, 0); sword.add(guard);
  const blade = part(0.035, 0.85, 0.07, bladeMat, 0, 0.56, 0); sword.add(blade);
  sword.rotation.x = 0.1; // hangs along the arm; raised only while attacking/parrying
  // cloak strip (kestrel)
  const cloak = part(0.4, 0.7, 0.05, clothRed, 0, 0.1, -0.2); hips.add(cloak);
  cloak.visible = kind === 'kestrel';
  if (kind === 'elite' || kind === 'captain') group.scale.setScalar(kind === 'captain' ? 1.12 : 1.05);
  return { group, hips, torso, head, armL, armR, legL, legR, sword, blade, cloak };
}

/** Procedural locomotion/pose animator — writes rotations only, no allocations. */
export class PoseAnimator {
  time = 0;
  crouchBlend = 0;

  animate(rig: Rig, state: MoveState, speed: number, dt: number, opts: { crouch: boolean; attacking: number; parry: number; dodge: number; dead: boolean; stagger: number } = { crouch: false, attacking: 0, parry: 0, dodge: 0, dead: false, stagger: 0 }): void {
    this.time += dt * (1 + speed * 0.35);
    const t = this.time;
    const target = opts.crouch ? 1 : 0;
    this.crouchBlend += (target - this.crouchBlend) * Math.min(1, dt * 8);
    const cb = this.crouchBlend;
    const swing = Math.min(1, speed / 6);
    const f = t * (4 + speed * 1.1);
    const A = rig.armL, B = rig.armR, L = rig.legL, R = rig.legR;
    // defaults
    A.rotation.set(0, 0, 0.12); B.rotation.set(0, 0, -0.12);
    L.rotation.set(0, 0, 0); R.rotation.set(0, 0, 0);
    rig.hips.position.y = 0.95 - cb * 0.32;
    rig.hips.rotation.x = cb * 0.25;
    rig.cloak.rotation.x = 0.15 + swing * 0.5 + Math.sin(t * 3) * 0.06;

    if (opts.dead) {
      rig.hips.rotation.x = -Math.PI / 2 + 0.15;
      rig.hips.position.y = 0.3;
      A.rotation.set(0.4, 0, 1.2); B.rotation.set(-0.3, 0, -1.1);
      return;
    }
    if (opts.stagger > 0) {
      const s = Math.sin(opts.stagger * 20) * 0.3;
      rig.hips.rotation.x = -0.35 + s * 0.3;
      A.rotation.x = -1.2; B.rotation.x = -1.0;
      return;
    }
    if (state === 'idle' || speed < 0.2) {
      const b = Math.sin(t * 2) * 0.03;
      A.rotation.x = b; B.rotation.x = -b;
      rig.torso.rotation.y = Math.sin(t * 0.7) * 0.04;
    } else {
      const s1 = Math.sin(f) * (0.55 * swing + 0.1);
      const s2 = Math.sin(f + Math.PI) * (0.55 * swing + 0.1);
      L.rotation.x = s1 - cb * 0.5; R.rotation.x = s2 - cb * 0.5;
      A.rotation.x = s2 * 0.8; B.rotation.x = opts.attacking > 0 ? B.rotation.x : s1 * 0.8;
      rig.hips.position.y += Math.abs(Math.sin(f)) * 0.05 * swing;
    }
    if (state === 'jump' || state === 'fall') {
      L.rotation.x = -0.5; R.rotation.x = 0.35; A.rotation.set(-0.6, 0, 0.5); B.rotation.set(-0.4, 0, -0.5);
    }
    if (state === 'vault' || state === 'climb') {
      const k = Math.sin(Math.min(1, opts.dodge) * Math.PI);
      A.rotation.x = -2.2 * k; B.rotation.x = -2.2 * k;
      L.rotation.x = -0.9 * k; R.rotation.x = -0.5 * k;
    }
    if (opts.attacking > 0) {
      // 3-phase slash: windup -> slash -> recover
      const a = opts.attacking; // 0..1
      const slash = Math.sin(a * Math.PI);
      rig.hips.rotation.y = -1.2 * slash;
      B.rotation.x = -2.4 * slash;
      B.rotation.z = -0.9 * slash;
      rig.sword.rotation.x = Math.PI / 2 - 0.2 - 1.1 * slash;
    } else if (opts.parry <= 0) {
      rig.sword.rotation.x = 0.1; // rest position along the arm
    }
    if (opts.parry > 0) {
      B.rotation.x = -1.6; B.rotation.z = 1.1;
      rig.sword.rotation.x = 0.2; A.rotation.x = -0.8;
    }
    if (opts.dodge > 0) {
      const d = Math.sin(Math.min(1, opts.dodge) * Math.PI);
      rig.hips.rotation.z = 1.4 * d;
      rig.hips.position.y -= 0.35 * d;
    }
  }
}
