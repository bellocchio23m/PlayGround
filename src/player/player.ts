// Full third-person character controller: accel/decel, sprint/crouch/jump,
// vault/climb detection via geometry probes, dodge i-frames, procedural noise.
import * as THREE from 'three';
import { CFG, MoveState, NoiseEvent } from '../core/config';
import { clamp, dampAngle } from '../core/utils';
import { World } from '../world/world';
import { InputManager } from '../input/input';
import { AudioEngine } from '../audio/audio';
import { buildRig, PoseAnimator, Rig } from './rig';

export interface PlayerEvents {
  noise: (n: NoiseEvent) => void;
  landed: (hard: boolean) => void;
  died: () => void;
}

export class Player {
  rig: Rig;
  animator = new PoseAnimator();
  pos = new THREE.Vector3(0, 0, 26);
  vel = new THREE.Vector3();
  yaw = Math.PI; // facing -z
  vy = 0;
  grounded = true;
  state: MoveState = 'idle';
  crouch = false;
  sprinting = false;
  stamina = CFG.player.staminaMax;
  hp = CFG.player.hpMax;
  staminaMax = CFG.player.staminaMax;
  hpMax = CFG.player.hpMax;
  speedMul = 1; stealthMul = 1; dmgMul = 1; regenMul = 1;
  vy0 = 0;
  // combat timers
  attackT = 0; attackKind: 'light' | 'heavy' = 'light'; combo = 0; comboWindow = 0;
  parryT = 0; parryCD = 0; dodgeT = 0; dodgeCD = 0;
  hitT = 0; dead = false;
  // traversal
  vaultT = 0; vaultFrom = new THREE.Vector3(); vaultTo = new THREE.Vector3();
  climbT = 0; climbFrom = new THREE.Vector3(); climbTo = new THREE.Vector3();
  coyote = 0; jumpBuf = 0;
  stepT = 0; noiseT = 0;
  airTime = 0;
  moving = 0;
  elevated = false; // was above target recently (for drop assassinations)
  lastGroundedY = 0;
  iframes = 0;
  riposteT = 0; // counter window after successful parry: +50% dmg, faster startup
  landDip = 0; // landing squash timer (feel)

  constructor(public events: PlayerEvents, private audio: AudioEngine) {
    this.rig = buildRig('kestrel');
  }

  get obj(): THREE.Object3D { return this.rig.group; }
  get alive(): boolean { return !this.dead; }

  reset(x: number, y: number, z: number): void {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.vy = 0;
    this.hp = this.hpMax; this.stamina = this.staminaMax;
    this.dead = false; this.hitT = 0; this.attackT = 0; this.dodgeT = 0;
    this.yaw = Math.PI; this.state = 'idle';
  }

  takeDamage(dmg: number, fromYaw: number): boolean {
    if (this.dead || this.iframes > 0 || this.dodgeT > 0) return false;
    // NOTE: parry is resolved by CombatSystem with facing check — never blanket-block here,
    // otherwise parrying the wrong way would grant free invincibility.
    this.hp -= dmg;
    this.hitT = 0.45;
    this.yaw = fromYaw;
    this.audio.hit();
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.state = 'death'; this.events.died(); }
    return true;
  }

  heal(v: number): void { this.hp = Math.min(this.hpMax, this.hp + v); }

  update(dt: number, input: InputManager, world: World, camYaw: number): void {
    if (this.dead) {
      this.animator.animate(this.rig, 'death', 0, dt, { crouch: false, attacking: 0, parry: 0, dodge: 0, dead: true, stagger: 0 });
      this.syncMesh(dt);
      return;
    }
    const P = CFG.player;
    // crouch toggle
    if (input.pressed.crouchToggle) this.crouch = !this.crouch;
    if (input.state.crouch) this.crouch = true;
    const wantMove = Math.hypot(input.state.moveX, input.state.moveY) > 0.05;

    // stamina
    const wantSprint = input.state.sprint && wantMove && !this.crouch && input.state.moveY > 0.1;
    this.sprinting = wantSprint && this.stamina > 1;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - P.sprintStaminaDrain * dt);
    else this.stamina = Math.min(this.staminaMax, this.stamina + P.staminaRegen * this.regenMul * dt);
    // hp regen out of danger handled by game (calls heal)

    // dodge (cancellable dalla recovery dell'attacco: phase > 0.55)
    this.dodgeCD -= dt; this.iframes -= dt;
    const atkDurNow = this.attackKind === 'heavy' ? 0.62 : 0.42;
    const atkPhaseNow = this.attackT > 0 ? 1 - this.attackT / atkDurNow : 1;
    if (input.pressed.dodge && this.dodgeCD <= 0 && this.stamina > 10 && this.dodgeT <= 0 &&
      (this.attackT <= 0 || atkPhaseNow > 0.55)) {
      if (this.attackT > 0) { this.attackT = 0; this.comboWindow = 0.4; } // cancel in dodge
      this.dodgeT = 0.42; this.dodgeCD = 0.8; this.iframes = CFG.combat ? 0.4 : 0.4;
      this.stamina -= 18; this.crouch = false;
      this.audio.vault();
    }
    // parry
    this.parryCD -= dt;
    if (input.pressed.parry && this.parryCD <= 0 && this.attackT <= 0) {
      this.parryT = 0.45; this.parryCD = 0.9;
    }
    this.parryT = Math.max(0, this.parryT - dt);
    this.riposteT = Math.max(0, this.riposteT - dt);

    // attack input (buffered)
    if ((input.pressed.attack || input.pressed.heavy) && this.attackT <= 0 && this.dodgeT <= 0 && this.vaultT <= 0 && this.climbT <= 0) {
      this.attackKind = input.pressed.heavy ? 'heavy' : 'light';
      this.attackT = this.attackKind === 'heavy' ? 0.62 : 0.42;
      if (this.comboWindow > 0) this.combo = Math.min(2, this.combo + 1); else this.combo = 0;
      this.comboWindow = 0;
      this.audio.swoosh();
    }

    // traversal states override locomotion
    if (this.vaultT > 0 || this.climbT > 0) { this.updateTraversal(dt); this.syncMesh(dt); return; }
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const dx = Math.sin(this.yaw); const dz = Math.cos(this.yaw);
      this.pos.x += dx * 8.5 * dt; this.pos.z += dz * 8.5 * dt;
      world.collideCircle(this.pos, 0.4, 1.2);
      this.state = 'dodge';
      this.animator.animate(this.rig, 'dodge', 6, dt, { crouch: false, attacking: 0, parry: 0, dodge: 1 - this.dodgeT / 0.42, dead: false, stagger: 0 });
      this.syncMesh(dt);
      return;
    }

    // movement direction in camera space
    let mx = 0; let mz = 0;
    if (wantMove) {
      const ix = input.state.moveX; const iy = input.state.moveY;
      const s = Math.sin(camYaw); const c = Math.cos(camYaw);
      mx = ix * c - iy * s; mz = -ix * s - iy * c;
      // note: camYaw convention — forward = away from camera
      const m = Math.hypot(mx, mz) || 1;
      mx /= m; mz /= m;
      const targetYaw = Math.atan2(mx, mz);
      this.yaw = dampAngle(this.yaw, targetYaw + Math.PI, 12, dt);
    }
    let maxSp = this.crouch ? P.crouchSpeed : wantSprint && this.sprinting ? P.sprintSpeed : P.runSpeed;
    if (!wantSprint && wantMove && Math.hypot(input.state.moveX, input.state.moveY) < 0.5) maxSp = P.walkSpeed;
    maxSp *= this.speedMul;
    const accel = wantMove ? P.accel : P.decel;
    this.vel.x += (mx * maxSp - this.vel.x) * Math.min(1, accel * dt / Math.max(1, maxSp));
    this.vel.z += (mz * maxSp - this.vel.z) * Math.min(1, accel * dt / Math.max(1, maxSp));
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.moving = planar;

    // jump / gravity
    if (input.pressed.jump) this.jumpBuf = 0.15; else this.jumpBuf -= dt;
    this.coyote -= dt;
    if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
      const jumpMul = 1; // traversal upgrade adds via speedMul already; keep base
      this.vy = P.jumpVel * jumpMul;
      this.grounded = false; this.coyote = 0; this.jumpBuf = 0;
      this.crouch = false;
      this.audio.jump();
      this.events.noise({ x: this.pos.x, y: this.pos.y, z: this.pos.z, radius: 10, loudness: 0.7, kind: 'jump', t: performance.now() / 1000 });
    }
    this.vy += P.gravity * dt;
    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    world.collideCircle(this.pos, 0.4, 1.4);
    // ground: support standing on rooftops
    const gy = world.groundHeight(this.pos.x, this.pos.z);
    this.pos.y += this.vy * dt;
    if (this.pos.y <= gy + 0.02 && this.vy <= 0) {
      if (!this.grounded) {
        const fall = this.lastGroundedY - this.pos.y;
        const hard = fall > 4.5;
        this.audio.land(hard);
        this.events.landed(hard);
        if (fall > 1.2) {
          this.events.noise({ x: this.pos.x, y: this.pos.y, z: this.pos.z, radius: hard ? 22 : 12, loudness: hard ? 1.4 : 0.8, kind: 'land', t: performance.now() / 1000 });
        }
        if (fall > 12) this.takeDamage((fall - 12) * 8, this.yaw);
        this.state = 'landing';
        this.landDip = hard ? 1 : 0.45; // squash + brief weight
      }
      this.pos.y = gy; this.vy = 0; this.grounded = true; this.coyote = 0.12; this.airTime = 0;
      this.lastGroundedY = gy;
      this.elevated = false;
    } else {
      if (this.grounded) { this.grounded = false; this.lastGroundedY = this.pos.y; }
      this.airTime += dt;
      if (this.pos.y - gy > 2.5) this.elevated = true;
    }
    // fell through? clamp
    if (this.pos.y < -5) { this.pos.y = 0; this.vy = 0; this.grounded = true; }

    // footsteps + movement noise
    this.stepT -= dt * (1 + planar * 0.25);
    if (this.grounded && planar > 0.8 && this.stepT <= 0) {
      this.stepT = planar > 7 ? 0.28 : planar > 4 ? 0.36 : 0.5;
      const run = planar > 4;
      this.audio.footstep(run);
      this.noiseT -= 1;
      if (!this.crouch && (run || this.noiseT <= 0)) {
        this.noiseT = run ? 1 : 4;
        const loud = this.crouch ? P.crouchNoise : planar > 7 ? P.sprintNoise : planar > 4 ? P.runNoise : P.walkNoise;
        this.events.noise({
          x: this.pos.x, y: this.pos.y, z: this.pos.z,
          radius: loud * 14 * this.stealthMul, loudness: loud * this.stealthMul, kind: 'step', t: performance.now() / 1000,
        });
      }
    }

    // vault / climb triggers (jump pressed near ledge handled via probes)
    if (input.pressed.jump || (wantMove && this.grounded)) this.tryTraversal(world);

    // state label (+ attack lunge: forward step during first 55% of swing)
    this.hitT -= dt; this.landDip = Math.max(0, this.landDip - dt * 3);
    if (this.attackT > 0) {
      this.attackT -= dt;
      if (this.attackT <= 0) this.comboWindow = 0.6;
      this.state = 'attack';
      const dur = this.attackKind === 'heavy' ? 0.62 : 0.42;
      const ph = 1 - Math.max(0, this.attackT) / dur;
      if (ph < 0.55) {
        const lunge = (this.attackKind === 'heavy' ? 3.4 : 2.6) * (this.riposteT > 0 ? 1.3 : 1);
        this.pos.x += -Math.sin(this.yaw) * lunge * dt;
        this.pos.z += -Math.cos(this.yaw) * lunge * dt;
        world.collideCircle(this.pos, 0.4, 1.4);
      }
    } else if (this.parryT > 0.1) this.state = 'parry';
    else if (this.hitT > 0) this.state = 'hit';
    else if (!this.grounded) this.state = this.vy > 0 ? 'jump' : 'fall';
    else if (this.crouch) this.state = 'crouch';
    else if (planar > 7.2) this.state = 'sprint';
    else if (planar > 3.6) this.state = 'run';
    else if (planar > 0.3) this.state = 'walk';
    else this.state = 'idle';
    this.comboWindow -= dt;

    const atkPhase = this.attackT > 0 ? 1 - this.attackT / (this.attackKind === 'heavy' ? 0.62 : 0.42) : 0;
    this.animator.animate(this.rig, this.state, planar, dt, {
      crouch: this.crouch, attacking: atkPhase, parry: this.parryT > 0.1 ? 1 : 0,
      dodge: 0, dead: false, stagger: Math.max(0, this.hitT - 0.15),
    });
    this.syncMesh(dt);
  }

  /** probe ledges in facing direction; start vault or climb */
  tryTraversal(world: World): void {
    if (this.vaultT > 0 || this.climbT > 0 || !this.grounded) return;
    const dx = -Math.sin(this.yaw); const dz = -Math.cos(this.yaw);
    const px = this.pos.x + dx * 1.1; const pz = this.pos.z + dz * 1.1;
    for (const l of world.ledges) {
      if (px >= l.min.x - 0.6 && px <= l.max.x + 0.6 && pz >= l.min.z - 0.6 && pz <= l.max.z + 0.6) {
        const topY = l.topY;
        const dh = topY - this.pos.y;
        if (dh > 0.3 && dh < 1.6 && l.kind === 'vault') {
          // vault over low obstacle
          this.vaultT = 0.45;
          this.vaultFrom.copy(this.pos);
          this.vaultTo.set(this.pos.x + dx * 2.2, topY, this.pos.z + dz * 2.2);
          this.state = 'vault';
          this.audio.vault();
          return;
        }
        if (dh >= 1.2 && dh < 7.5) {
          this.climbT = clamp(0.5 + dh * 0.12, 0.6, 1.4);
          (this as { climbDur?: number }).climbDur = this.climbT;
          this.climbFrom.copy(this.pos);
          this.climbTo.set(this.pos.x + dx * 1.4, topY, this.pos.z + dz * 1.4);
          this.state = 'climb';
          this.audio.vault();
          return;
        }
      }
    }
    // generic step-up: small collider directly ahead
    const gyAhead = world.groundHeight(px, pz);
    const dh = gyAhead - this.pos.y;
    if (dh > 0.3 && dh < 1.6) {
      this.vaultT = 0.4;
      this.vaultFrom.copy(this.pos);
      this.vaultTo.set(px + dx * 0.8, gyAhead, pz + dz * 0.8);
      this.state = 'vault';
      this.audio.vault();
    } else if (dh >= 1.6 && dh < 7.5) {
      this.climbT = clamp(0.5 + dh * 0.12, 0.6, 1.4);
      (this as { climbDur?: number }).climbDur = this.climbT;
      this.climbFrom.copy(this.pos);
      this.climbTo.set(px, gyAhead, pz);
      this.state = 'climb';
      this.audio.vault();
    }
  }

  private updateTraversal(dt: number): void {
    if (this.vaultT > 0) {
      this.vaultT -= dt;
      const t = clamp(1 - this.vaultT / 0.45, 0, 1);
      this.pos.lerpVectors(this.vaultFrom, this.vaultTo, t);
      this.pos.y += Math.sin(t * Math.PI) * 0.7;
      if (this.vaultT <= 0) { this.pos.copy(this.vaultTo); this.vy = 0; this.grounded = true; }
      this.animator.animate(this.rig, 'vault', 2, dt, { crouch: false, attacking: 0, parry: 0, dodge: t, dead: false, stagger: 0 });
      return;
    }
    if (this.climbT > 0) {
      const dur = (this as { climbDur?: number }).climbDur ?? 1;
      this.climbT -= dt;
      const t = clamp(1 - this.climbT / dur, 0, 1);
      this.pos.lerpVectors(this.climbFrom, this.climbTo, t * t * (3 - 2 * t));
      if (this.climbT <= 0) { this.pos.copy(this.climbTo); this.vy = 0; this.grounded = true; }
      this.animator.animate(this.rig, 'climb', 1, dt, { crouch: false, attacking: 0, parry: 0, dodge: t, dead: false, stagger: 0 });
    }
  }

  private syncMesh(_dt: number): void {
    this.rig.group.position.copy(this.pos);
    this.rig.group.rotation.y = this.yaw;
    // landing squash (subtle, recovers fast)
    const s = 1 - 0.1 * Math.max(0, this.landDip);
    this.rig.group.scale.set(1 + (1 - s) * 0.6, s, 1 + (1 - s) * 0.6);
  }
}
