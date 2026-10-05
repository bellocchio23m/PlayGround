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

/** Procedural locomotion/pose animator — writes rotations only, no allocations.
 *  Phase-3 contextual variety (all scalar blends, zero alloc):
 *  - slide pose: `state==='slide'` or opts.slide 0..1 (deep crouch, lean back, legs fwd)
 *  - roll pose: opts.roll 0..1 (shoulder-tuck overlay, works over any state)
 *  - run-to-stop skid: opts.skid 0..1 (lean back, split stance, cloak flings fwd)
 *  - idle breath: two incommensurate oscillators so idle never visibly loops. */
export class PoseAnimator {
  time = 0;
  crouchBlend = 0;

  animate(rig: Rig, state: MoveState, speed: number, dt: number, opts: { crouch: boolean; attacking: number; parry: number; dodge: number; dead: boolean; stagger: number; slide?: number; roll?: number; skid?: number } = { crouch: false, attacking: 0, parry: 0, dodge: 0, dead: false, stagger: 0 }): void {
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
      // idle breath: layered oscillators (2.0Hz + 0.93Hz + slow sway) so the
      // loop period never visibly repeats; chest lift + shoulder drift.
      const b = Math.sin(t * 2) * 0.03 + Math.sin(t * 0.93 + 1.7) * 0.02;
      const b2 = Math.sin(t * 0.6 + 0.5) * 0.025;
      A.rotation.x = b; B.rotation.x = -b;
      A.rotation.z = 0.12 + b2; B.rotation.z = -0.12 - b2;
      rig.torso.rotation.y = Math.sin(t * 0.7) * 0.04;
      rig.torso.rotation.x = b2;
      rig.hips.position.y += Math.sin(t * 2 + 0.3) * 0.015 + Math.sin(t * 0.93) * 0.01;
    } else {
      const s1 = Math.sin(f) * (0.55 * swing + 0.1);
      const s2 = Math.sin(f + Math.PI) * (0.55 * swing + 0.1);
      L.rotation.x = s1 - cb * 0.5; R.rotation.x = s2 - cb * 0.5;
      A.rotation.x = s2 * 0.8; B.rotation.x = opts.attacking > 0 ? B.rotation.x : s1 * 0.8;
      rig.hips.position.y += Math.abs(Math.sin(f)) * 0.05 * swing;
    }
    if (state === 'sprint') {
      // sprint lean: torso pitched forward, big arm pump, cloak streaming
      const lean = 0.28 * swing + 0.08;
      rig.hips.rotation.x = lean - cb * 0.1;
      rig.torso.rotation.x = 0.12 * swing;
      rig.cloak.rotation.x = 0.9 + Math.sin(t * 9) * 0.08;
      rig.head.rotation.x = -lean * 0.7;
    }
    if (state === 'jump' || state === 'fall') {
      L.rotation.x = -0.5; R.rotation.x = 0.35; A.rotation.set(-0.6, 0, 0.5); B.rotation.set(-0.4, 0, -0.5);
    }
    if (state === 'vault' || state === 'climb') {
      const k = Math.sin(Math.min(1, opts.dodge) * Math.PI);
      // vault variation: staggered tuck + forward pitch by phase
      const ph = Math.min(1, opts.dodge);
      const lead = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
      A.rotation.x = -2.2 * k; B.rotation.x = -2.2 * k;
      A.rotation.z = 0.12 + lead * 0.35; B.rotation.z = -0.12 - lead * 0.2;
      L.rotation.x = -0.9 * k - lead * 0.4; R.rotation.x = -0.5 * k + lead * 0.3;
      rig.hips.rotation.x = 0.35 * k;
    }
    if (state === 'mantle') {
      // hang-pull: arms haul from overhead to chest, legs kick then tuck
      const ph = Math.min(1, opts.dodge);
      const pull = Math.sin(ph * Math.PI);
      const haul = 1 - ph; // 1 → 0: arms start overhead
      A.rotation.set(-2.6 * haul - 0.5 * pull, 0, 0.35);
      B.rotation.set(-2.6 * haul - 0.5 * pull, 0, -0.35);
      L.rotation.x = -0.7 * pull - 0.4 * haul; R.rotation.x = 0.5 * pull - 0.3 * haul;
      rig.hips.rotation.x = 0.3 * pull;
      rig.hips.position.y -= 0.12 * haul;
    }
    if (state === 'hang') {
      // edge-hang: arms overhead gripping, body hanging straight, slight sway + leg dangle
      const sway = Math.sin(t * 1.8) * 0.05;
      A.rotation.set(-2.9, 0, 0.25 + sway); B.rotation.set(-2.9, 0, -0.25 - sway);
      L.rotation.x = 0.25 + Math.sin(t * 1.8 + 0.6) * 0.08;
      R.rotation.x = 0.35 + Math.sin(t * 1.8 + 1.4) * 0.08;
      L.rotation.z = 0.08; R.rotation.z = -0.08;
      rig.hips.rotation.x = -0.12;
      rig.hips.position.y -= 0.18;
      rig.torso.rotation.x = -0.1;
      rig.cloak.rotation.x = -0.1 + sway;
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
    // crouch-slide pose: deep seat, torso leaned back, legs shot forward,
    // arms trailing low/out, cloak pressed down by the wind.
    const slideK = opts.slide !== undefined && opts.slide > 0 ? Math.min(1, opts.slide) : (state === 'slide' ? 1 : 0);
    if (slideK > 0) {
      rig.hips.position.y -= 0.42 * slideK;
      rig.hips.rotation.x = -0.35 * slideK;
      rig.torso.rotation.x = -0.25 * slideK;
      L.rotation.x = -1.1 * slideK; R.rotation.x = -0.85 * slideK;
      L.rotation.z = 0.15 * slideK; R.rotation.z = -0.15 * slideK;
      A.rotation.set(0.6 * slideK, 0, 0.6); B.rotation.set(0.6 * slideK, 0, -0.6);
      rig.head.rotation.x = 0.2 * slideK;
      rig.cloak.rotation.x = -0.5 * slideK + 0.15;
    }
    // landing-roll pose: shoulder tuck overlay (blends out with opts.roll 1→0);
    // auto-tucks on fast landings (state landing + speed > 5) as a fallback.
    const rollK = opts.roll !== undefined && opts.roll > 0 ? Math.min(1, opts.roll) : (state === 'landing' && speed > 5 ? 0.7 : 0);
    if (rollK > 0) {
      rig.hips.position.y -= 0.3 * rollK;
      rig.hips.rotation.x = 0.9 * rollK;
      rig.torso.rotation.x = 0.4 * rollK;
      A.rotation.set(-1.8 * rollK, 0, 0.5); B.rotation.set(-1.8 * rollK, 0, -0.5);
      L.rotation.x = -1.2 * rollK; R.rotation.x = -1.1 * rollK;
      rig.head.rotation.x = 0.5 * rollK;
    }
    // run-to-stop skid: lean back against momentum, split stance (front leg
    // braced, rear leg trailing), arms out for balance, cloak flings forward.
    const skidK = opts.skid !== undefined ? Math.min(1, Math.max(0, opts.skid)) : 0;
    if (skidK > 0.01 && slideK <= 0) {
      rig.hips.rotation.x = -0.3 * skidK;
      rig.torso.rotation.x = -0.2 * skidK;
      L.rotation.x = -0.7 * skidK; R.rotation.x = 0.5 * skidK;
      A.rotation.x = 0.5 * skidK; B.rotation.x = 0.4 * skidK;
      A.rotation.z = 0.5 * skidK; B.rotation.z = -0.5 * skidK;
      rig.cloak.rotation.x = -0.3 - skidK * 0.4;
    }
  }
}
