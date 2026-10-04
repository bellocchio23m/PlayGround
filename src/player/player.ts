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

// ---- Phase-3 locomotion tuning (local tables; CFG untouched) ----
// Per-gait accel/decel: snappy sprint start (high accel), smooth sprint stop
// (low decel = glide), tight crouch stop (high decel).
export const GAIT_TUNE = {
  walk: { accel: 30, decel: 34, turn: 10 },
  run: { accel: 36, decel: 30, turn: 13 },
  sprint: { accel: 52, decel: 16, turn: 17 },
  crouch: { accel: 20, decel: 38, turn: 6.5 },
  air: { accelMul: 0.35, turn: 5 },
} as const;
// Jump tuning: base 7.6 (CFG 7.2 + 0.4 lift) + sprint bonuses.
// Gap math: t_air = 2*vy/g = 2*7.6/22 ≈ 0.69s; sprint 9.2m/s → ≈6.3m.
// With sprint boost (9.94m/s, vy 8.2 → t≈0.745s) → ≈7.4m. Both clear 4.5m;
// run (6.0 → 4.1m) does not — only sprint-jump clears the gap by design.
export const JUMP_TUNE = { baseVel: 7.6, sprintPlanarBoost: 1.08, sprintVyBonus: 0.6 } as const;
// Traversal tiers + probe tuning.
export const TRAVERSAL_TUNE = {
  vaultMax: 1.6, mantleMax: 2.6, climbMax: 7.5,
  vaultDur: 0.4, mantleDur: 0.7,
  stepMin: 0.3, stepMax: 0.6,
  probeDist: 1.4, probeNear: 0.7, probeTol: 1.0,
  hangTopMin: 0.3, hangTopMax: 2.0, hangDist: 1.2, hangDrain: 4,
} as const;

export type TraversableKind = 'vault' | 'mantle' | 'climb' | 'hang';

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
  vaultDur = TRAVERSAL_TUNE.vaultDur; vaultEntrySpeed = 0;
  mantleT = 0; mantleFrom = new THREE.Vector3(); mantleTo = new THREE.Vector3();
  mantleDur = TRAVERSAL_TUNE.mantleDur; mantleEntrySpeed = 0;
  climbT = 0; climbFrom = new THREE.Vector3(); climbTo = new THREE.Vector3();
  climbDur = 1; climbEntrySpeed = 0;
  // edge-hang
  hanging = false; hangTopY = 0; hangEdgeX = 0; hangEdgeZ = 0;
  // traversal readability (read by game.ts/UI, never wired here)
  traversableNear: TraversableKind | null = null;
  traverseDir = new THREE.Vector3(0, 0, -1);
  private _travProbe = new THREE.Vector3();
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
    this.vaultT = 0; this.mantleT = 0; this.climbT = 0;
    this.hanging = false; this.traversableNear = null;
    this.traverseDir.set(0, 0, -1);
    this.grounded = true; this.coyote = 0; this.jumpBuf = 0;
    this.crouch = false; this.vy0 = 0; this.landDip = 0;
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
    if (input.pressed.dodge && this.dodgeCD <= 0 && this.stamina > 10 && this.dodgeT <= 0 && !this.hanging &&
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

    // attack input (buffered; dodge-cancel into dash attack in late dodge)
    if ((input.pressed.attack || input.pressed.heavy) && this.attackT <= 0 && (this.dodgeT <= 0 || this.dodgeT < 0.2) && this.vaultT <= 0 && this.climbT <= 0 && this.mantleT <= 0 && !this.hanging) {
      if (this.dodgeT > 0) this.dodgeT = 0; // cancel dodge -> dash attack
      this.attackKind = input.pressed.heavy ? 'heavy' : 'light';
      this.attackKind = input.pressed.heavy ? 'heavy' : 'light';
      this.attackT = this.attackKind === 'heavy' ? 0.62 : 0.42;
      if (this.comboWindow > 0) this.combo = Math.min(2, this.combo + 1); else this.combo = 0;
      this.comboWindow = 0;
      this.audio.swoosh();
    }

    // traversal states override locomotion
    if (this.vaultT > 0 || this.climbT > 0 || this.mantleT > 0) { this.updateTraversal(dt); this.updateTraverseHint(world); this.syncMesh(dt); return; }
    // edge-hang overrides gravity/locomotion
    if (this.hanging) { this.updateHang(dt, input, world); this.updateTraverseHint(world); this.syncMesh(dt); return; }
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
    // gait intent (drives accel/decel + turn rate tables)
    const stickMag = Math.hypot(input.state.moveX, input.state.moveY);
    let gait: 'walk' | 'run' | 'sprint' | 'crouch' = 'run';
    if (this.crouch) gait = 'crouch';
    else if (this.sprinting) gait = 'sprint';
    else if (stickMag < 0.5 && wantMove) gait = 'walk';
    if (wantMove) {
      const ix = input.state.moveX; const iy = input.state.moveY;
      const s = Math.sin(camYaw); const c = Math.cos(camYaw);
      mx = ix * c - iy * s; mz = -ix * s - iy * c;
      // note: camYaw convention — forward = away from camera
      const m = Math.hypot(mx, mz) || 1;
      mx /= m; mz /= m;
      const targetYaw = Math.atan2(mx, mz);
      // faster turn at speed (sprint 17), tighter/slower at crouch (6.5), weak air control
      const turnRate = this.grounded ? GAIT_TUNE[gait].turn : GAIT_TUNE.air.turn;
      this.yaw = dampAngle(this.yaw, targetYaw + Math.PI, turnRate, dt);
    }
    let maxSp = this.crouch ? P.crouchSpeed : wantSprint && this.sprinting ? P.sprintSpeed : P.runSpeed;
    if (!wantSprint && wantMove && stickMag < 0.5) maxSp = P.walkSpeed;
    maxSp *= this.speedMul;
    // differentiated accel/decel: sprint snappy start, smooth (gliding) stop;
    // stopping uses speed-based decel so sprint release glides, crouch stops tight.
    const planarNow = Math.hypot(this.vel.x, this.vel.z);
    let accel: number;
    if (!this.grounded) {
      accel = GAIT_TUNE[gait].accel * GAIT_TUNE.air.accelMul;
    } else if (wantMove) {
      accel = GAIT_TUNE[gait].accel;
    } else if (planarNow > 7.2) accel = GAIT_TUNE.sprint.decel;
    else if (planarNow > 3.6) accel = GAIT_TUNE.run.decel;
    else if (planarNow > 0.3) accel = GAIT_TUNE.walk.decel;
    else accel = GAIT_TUNE.crouch.decel;
    this.vel.x += (mx * maxSp - this.vel.x) * Math.min(1, accel * dt / Math.max(1, maxSp));
    this.vel.z += (mz * maxSp - this.vel.z) * Math.min(1, accel * dt / Math.max(1, maxSp));
    const planar = Math.hypot(this.vel.x, this.vel.z);
    this.moving = planar;

    // jump / gravity (buffered + coyote preserved; tuned vel + sprint boost for ~4.5m gaps)
    if (input.pressed.jump) this.jumpBuf = 0.15; else this.jumpBuf -= dt;
    this.coyote -= dt;
    if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0)) {
      const jumpMul = 1; // traversal upgrade adds via speedMul already; keep base
      this.vy = JUMP_TUNE.baseVel * jumpMul + (this.sprinting ? JUMP_TUNE.sprintVyBonus : 0);
      if (this.sprinting) { this.vel.x *= JUMP_TUNE.sprintPlanarBoost; this.vel.z *= JUMP_TUNE.sprintPlanarBoost; }
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

    // step-up assist: smooth 0.3–0.6m lip while walking into it (no vault anim)
    if (this.grounded && wantMove) {
      const sx = -Math.sin(this.yaw); const sz = -Math.cos(this.yaw);
      const gyAhead = world.groundHeight(this.pos.x + sx * 0.9, this.pos.z + sz * 0.9);
      const sdh = gyAhead - this.pos.y;
      if (sdh > TRAVERSAL_TUNE.stepMin && sdh <= TRAVERSAL_TUNE.stepMax && this.mantleT <= 0 && this.vaultT <= 0 && this.climbT <= 0) {
        this.pos.y = gyAhead;
        this.vy = 0;
        this.lastGroundedY = gyAhead;
      }
    }

    // edge-hang grab: airborne + drifting toward a wall top in [y+0.3, y+2.0]
    if (!this.grounded && !this.hanging && this.vaultT <= 0 && this.mantleT <= 0 && this.climbT <= 0) {
      this.tryHang(world, wantMove);
    }

    // vault / mantle / climb triggers (jump pressed near ledge, or walk into it;
    // airborne vault/mantle allowed for sprint-jump chains)
    if (input.pressed.jump || (wantMove && this.grounded) || (!this.grounded && wantMove)) this.tryTraversal(world);

    // per-frame traversal hint for UI
    this.updateTraverseHint(world);

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
    else if (this.hanging) this.state = 'hang';
    else if (this.mantleT > 0) this.state = 'mantle';
    else if (this.vaultT > 0) this.state = 'vault';
    else if (this.climbT > 0) this.state = 'climb';
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

  /** probe ledges in facing direction; start vault / mantle / climb.
   *  Vault (<=1.6m, 0.4s) / mantle (1.6–2.6m, 0.7s hang-pull) / climb (2.6–7.5m).
   *  Widened probe (1.4m far + 0.7m near, ±1.0m tolerance) for tight spaces.
   *  Airborne vault/mantle allowed (dh >= -0.8) for sprint-jump chains. */
  tryTraversal(world: World): void {
    if (this.vaultT > 0 || this.climbT > 0 || this.mantleT > 0 || this.hanging) return;
    const airborne = !this.grounded;
    const dx = -Math.sin(this.yaw); const dz = -Math.cos(this.yaw);
    const T = TRAVERSAL_TUNE;
    // two probes: near (tight spaces) + far — reuse temp, no alloc
    for (let pi = 0; pi < 2; pi++) {
      const dist = pi === 0 ? T.probeDist : T.probeNear;
      const px = this.pos.x + dx * dist; const pz = this.pos.z + dz * dist;
      for (const l of world.ledges) {
        if (px >= l.min.x - T.probeTol && px <= l.max.x + T.probeTol && pz >= l.min.z - T.probeTol && pz <= l.max.z + T.probeTol) {
          const topY = l.topY;
          const dh = topY - this.pos.y;
          const lo = airborne ? 0.15 : T.stepMin;
          if (dh > lo && dh <= T.vaultMax) {
            this.startVault(topY, dx, dz);
            return;
          }
          if (dh > T.vaultMax && dh <= T.mantleMax) {
            // airborne mantle = jump-grab; grounded mantle = hang-pull
            this.startMantle(topY, dx, dz);
            return;
          }
          if (!airborne && dh > T.mantleMax && dh < T.climbMax) {
            this.startClimb(topY, dx, dz, dh);
            return;
          }
        }
      }
      // generic collider step: groundHeight directly ahead
      const gyAhead = world.groundHeight(px, pz);
      const dh = gyAhead - this.pos.y;
      if (dh > T.stepMax && dh <= T.vaultMax) {
        this.startVault(gyAhead, dx, dz);
        return;
      }
      if (dh > T.vaultMax && dh <= T.mantleMax) {
        this.startMantle(gyAhead, dx, dz);
        return;
      }
      if (!airborne && dh > T.mantleMax && dh < T.climbMax && gyAhead > 0.01) {
        this.startClimb(gyAhead, dx, dz, dh);
        return;
      }
    }
  }

  private startVault(topY: number, dx: number, dz: number): void {
    this.vaultDur = TRAVERSAL_TUNE.vaultDur;
    this.vaultT = this.vaultDur;
    this.vaultEntrySpeed = Math.hypot(this.vel.x, this.vel.z);
    this.vaultFrom.copy(this.pos);
    this.vaultTo.set(this.pos.x + dx * 2.4, topY, this.pos.z + dz * 2.4);
    this.state = 'vault';
    this.audio.vault();
  }

  private startMantle(topY: number, dx: number, dz: number): void {
    this.mantleDur = TRAVERSAL_TUNE.mantleDur;
    this.mantleT = this.mantleDur;
    this.mantleEntrySpeed = Math.hypot(this.vel.x, this.vel.z);
    this.mantleFrom.copy(this.pos);
    this.mantleTo.set(this.pos.x + dx * 1.5, topY, this.pos.z + dz * 1.5);
    this.state = 'mantle';
    this.audio.vault();
  }

  private startClimb(topY: number, dx: number, dz: number, dh: number): void {
    this.climbDur = clamp(0.5 + dh * 0.12, 0.6, 1.4);
    this.climbT = this.climbDur;
    this.climbEntrySpeed = Math.hypot(this.vel.x, this.vel.z);
    this.climbFrom.copy(this.pos);
    this.climbTo.set(this.pos.x + dx * 1.4, topY, this.pos.z + dz * 1.4);
    this.state = 'climb';
    this.audio.vault();
  }

  /** momentum-preserving exit: vault ×1.12, mantle ×1.08, climb ×1.0, capped.
   *  Lands grounded with boosted planar velocity so sprint→jump→vault→run
   *  chains keep flowing; coyote left open for an instant follow-up jump. */
  private traversalExitBoost(entrySpeed: number, mult: number): void {
    const P = CFG.player;
    const base = Math.max(entrySpeed, P.runSpeed * 0.75);
    const cap = P.sprintSpeed * 1.25;
    const sp = Math.min(base * mult, cap);
    const dx = -Math.sin(this.yaw); const dz = -Math.cos(this.yaw);
    this.vel.x = dx * sp; this.vel.z = dz * sp;
    this.vy = 0;
    this.grounded = true;
    this.coyote = 0.12;
    this.jumpBuf = 0;
  }

  /** edge-hang grab: airborne, drifting toward a top edge in [y+0.3, y+2.0]
   *  within 1.2m horizontal. Zero gravity cling; jump = mantle up, crouch+back = drop. */
  private tryHang(world: World, wantMove: boolean): void {
    const T = TRAVERSAL_TUNE;
    const planar = Math.hypot(this.vel.x, this.vel.z);
    if (!wantMove && planar < 1.0) return;
    const dx = -Math.sin(this.yaw); const dz = -Math.cos(this.yaw);
    const px = this.pos.x + dx * T.hangDist; const pz = this.pos.z + dz * T.hangDist;
    // 1) explicit ledges first (rooftop lips)
    for (const l of world.ledges) {
      if (px >= l.min.x - 0.6 && px <= l.max.x + 0.6 && pz >= l.min.z - 0.6 && pz <= l.max.z + 0.6) {
        const dh = l.topY - this.pos.y;
        if (dh >= T.hangTopMin && dh <= T.hangTopMax) {
          this.enterHang(l.topY, px, pz, dx, dz);
          return;
        }
      }
    }
    // 2) generic collider tops via groundHeight
    const gyAhead = world.groundHeight(px, pz);
    const dh = gyAhead - this.pos.y;
    if (dh >= T.hangTopMin && dh <= T.hangTopMax && gyAhead > 0.01) {
      this.enterHang(gyAhead, px, pz, dx, dz);
    }
  }

  private enterHang(topY: number, px: number, pz: number, dx: number, dz: number): void {
    this.hanging = true;
    this.hangTopY = topY;
    this.hangEdgeX = px; this.hangEdgeZ = pz;
    // cling just off the edge, feet dangling ~1.35m below the lip
    this.pos.x = px - dx * 0.45;
    this.pos.z = pz - dz * 0.45;
    this.pos.y = topY - 1.35;
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.state = 'hang';
    this.audio.vault();
  }

  private updateHang(dt: number, input: InputManager, _world: World): void {
    // small stamina drain while clinging; exhaustion forces a drop
    this.stamina = Math.max(0, this.stamina - TRAVERSAL_TUNE.hangDrain * dt);
    this.state = 'hang';
    this.vy = 0;
    this.vel.set(0, 0, 0);
    // keep facing the wall
    this.traversableNear = 'hang';
    const dx = -Math.sin(this.yaw); const dz = -Math.cos(this.yaw);
    this.traverseDir.set(dx, 0, dz);
    if (this.stamina <= 0) { this.dropFromHang(); return; }
    // jump / Salto = mantle up onto the ledge
    if (input.pressed.jump) {
      this.hanging = false;
      const topY = this.hangTopY;
      this.mantleDur = TRAVERSAL_TUNE.mantleDur;
      this.mantleT = this.mantleDur;
      this.mantleEntrySpeed = CFG.player.runSpeed;
      this.mantleFrom.copy(this.pos);
      this.mantleTo.set(this.hangEdgeX + dx * 0.8, topY, this.hangEdgeZ + dz * 0.8);
      this.state = 'mantle';
      this.audio.jump();
      return;
    }
    // crouch(+back) = drop
    if (input.pressed.crouchToggle || (input.state.crouch && input.state.moveY < -0.1)) {
      this.dropFromHang();
      return;
    }
    this.animator.animate(this.rig, 'hang', 0, dt, { crouch: false, attacking: 0, parry: 0, dodge: 0, dead: false, stagger: 0 });
  }

  private dropFromHang(): void {
    this.hanging = false;
    this.grounded = false;
    this.vy = -1;
    this.coyote = 0; this.jumpBuf = 0;
    this.lastGroundedY = this.pos.y;
    this.state = 'fall';
  }

  /** per-frame UI hint: nearest traversable tier + direction (allocation-free). */
  updateTraverseHint(world: World): void {
    if (this.vaultT > 0) {
      this.traversableNear = 'vault';
      this._travProbe.copy(this.vaultTo).sub(this.vaultFrom); this._travProbe.y = 0;
      if (this._travProbe.lengthSq() > 1e-6) { this._travProbe.normalize(); this.traverseDir.copy(this._travProbe); }
      return;
    }
    if (this.mantleT > 0) {
      this.traversableNear = 'mantle';
      this._travProbe.copy(this.mantleTo).sub(this.mantleFrom); this._travProbe.y = 0;
      if (this._travProbe.lengthSq() > 1e-6) { this._travProbe.normalize(); this.traverseDir.copy(this._travProbe); }
      return;
    }
    if (this.climbT > 0) {
      this.traversableNear = 'climb';
      this._travProbe.copy(this.climbTo).sub(this.climbFrom); this._travProbe.y = 0;
      if (this._travProbe.lengthSq() > 1e-6) { this._travProbe.normalize(); this.traverseDir.copy(this._travProbe); }
      return;
    }
    if (this.hanging) {
      this.traversableNear = 'hang';
      this.traverseDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      return;
    }
    const T = TRAVERSAL_TUNE;
    const dx = -Math.sin(this.yaw); const dz = -Math.cos(this.yaw);
    const px = this.pos.x + dx * T.probeDist; const pz = this.pos.z + dz * T.probeDist;
    let best: TraversableKind | null = null;
    let bestDh = Infinity;
    const consider = (dh: number): void => {
      if (this.grounded) {
        if (dh > T.stepMin && dh <= T.vaultMax && best === null) { best = 'vault'; bestDh = dh; }
        else if (dh > T.vaultMax && dh <= T.mantleMax && (best === null || best === 'climb')) { best = 'mantle'; bestDh = dh; }
        else if (dh > T.mantleMax && dh < T.climbMax && best === null) { best = 'climb'; bestDh = dh; }
      } else {
        if (dh >= T.hangTopMin && dh <= T.hangTopMax && best === null) { best = 'hang'; bestDh = dh; }
        else if (dh > 0.15 && dh <= T.vaultMax && best !== 'hang') { best = 'vault'; bestDh = dh; }
        else if (dh > T.vaultMax && dh <= T.mantleMax && best === null) { best = 'mantle'; bestDh = dh; }
      }
      void bestDh;
    };
    for (const l of world.ledges) {
      if (px >= l.min.x - T.probeTol && px <= l.max.x + T.probeTol && pz >= l.min.z - T.probeTol && pz <= l.max.z + T.probeTol) {
        consider(l.topY - this.pos.y);
        if (best !== null) break;
      }
    }
    if (best === null) {
      const gyAhead = world.groundHeight(px, pz);
      if (gyAhead > 0.01) consider(gyAhead - this.pos.y);
    }
    this.traversableNear = best;
    this.traverseDir.set(dx, 0, dz);
  }

  private updateTraversal(dt: number): void {
    if (this.vaultT > 0) {
      this.vaultT -= dt;
      const t = clamp(1 - this.vaultT / this.vaultDur, 0, 1);
      this.pos.lerpVectors(this.vaultFrom, this.vaultTo, t);
      this.pos.y += Math.sin(t * Math.PI) * 0.7;
      if (this.vaultT <= 0) {
        this.pos.copy(this.vaultTo);
        this.traversalExitBoost(this.vaultEntrySpeed, 1.12);
      }
      this.animator.animate(this.rig, 'vault', 2, dt, { crouch: false, attacking: 0, parry: 0, dodge: t, dead: false, stagger: 0 });
      return;
    }
    if (this.mantleT > 0) {
      this.mantleT -= dt;
      const t = clamp(1 - this.mantleT / this.mantleDur, 0, 1);
      const e = t * t * (3 - 2 * t);
      this.pos.lerpVectors(this.mantleFrom, this.mantleTo, e);
      // hang-pull arc: dip then pull over the lip
      this.pos.y += Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.25;
      if (this.mantleT <= 0) {
        this.pos.copy(this.mantleTo);
        this.traversalExitBoost(this.mantleEntrySpeed, 1.08);
      }
      this.animator.animate(this.rig, 'mantle', 1.5, dt, { crouch: false, attacking: 0, parry: 0, dodge: t, dead: false, stagger: 0 });
      return;
    }
    if (this.climbT > 0) {
      const dur = this.climbDur;
      this.climbT -= dt;
      const t = clamp(1 - this.climbT / dur, 0, 1);
      this.pos.lerpVectors(this.climbFrom, this.climbTo, t * t * (3 - 2 * t));
      if (this.climbT <= 0) {
        this.pos.copy(this.climbTo);
        this.traversalExitBoost(this.climbEntrySpeed, 1.0);
      }
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
