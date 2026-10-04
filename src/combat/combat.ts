// Timing-based katana combat: light/heavy, combo, parry window, dodge,
// stagger, finishers. Distance + direction + timing + enemy state matter.
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

export class CombatSystem {
  private hitDone = false;

  constructor(private audio: AudioEngine, private fx: CombatFx) {}

  /** player attack hit resolution — called each frame while attacking */
  updatePlayerAttack(player: Player, enemies: Enemy[], cam: { addShake(v: number): void }): { kills: number; hits: number } {
    let kills = 0; let hits = 0;
    if (player.attackT <= 0) { this.hitDone = false; return { kills, hits }; }
    const dur = player.attackKind === 'heavy' ? 0.62 : 0.42;
    const phase = 1 - player.attackT / dur;
    // active window mid-swing
    if (phase < 0.35 || phase > 0.75 || this.hitDone) return { kills, hits };
    this.hitDone = true;
    const heavy = player.attackKind === 'heavy';
    const base = heavy ? CFG.combat.heavyDmg : CFG.combat.lightDmg;
    const dmg = Math.round(base * player.dmgMul * (player.combo === 2 ? 1.35 : 1));
    const range = CFG.combat.attackRange + (heavy ? 0.4 : 0);
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.pos.x - player.pos.x; const dz = e.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range || Math.abs(e.pos.y - player.pos.y) > 2.5) continue;
      const ang = Math.atan2(dx, dz);
      if (angleDiff(ang, player.yaw + Math.PI) > 1.0) continue; // must face target
      const finisher = e.hp <= e.maxHp * 0.25;
      const dealt = finisher ? Math.max(dmg, e.hp) : dmg;
      const killed = e.takeDamage(dealt, player.yaw, heavy, this.audio);
      this.fx.slash(e.pos);
      this.fx.damageNum(e.pos, dealt, finisher ? 'FINISHER' : heavy ? 'PESANTE' : 'colpo');
      cam.addShake(heavy ? 0.5 : 0.25);
      hits++;
      if (killed) kills++;
    }
    return { kills, hits };
  }

  /** enemy swing resolution: player can parry (timing) or dodge (i-frames).
   *  Consumes the per-tick `struck` flag — never misses the damage window. */
  updateEnemyAttacks(player: Player, enemies: Enemy[], onPlayerHit: () => void): void {
    for (const e of enemies) {
      if (e.dead || !e.struck) continue;
      e.struck = false;
      const dx = player.pos.x - e.pos.x; const dz = player.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.6 || Math.abs(player.pos.y - e.pos.y) > 2.2) continue;
      // parry? player parry active + facing enemy
      if (player.parryT > 0.1) {
        const ang = Math.atan2(-dx, -dz);
        if (angleDiff(ang, player.yaw + Math.PI) < 1.2) {
          // successful parry: stagger enemy, no damage
          e.stagger = 1.1; e.windup = 0; e.swingT = 0;
          this.audio.parry();
          this.fx.spark(player.pos);
          continue;
        }
      }
      if (player.dodgeT > 0 || player.iframes > 0) continue; // dodged
      const fromYaw = Math.atan2(dx, dz) + Math.PI;
      if (player.takeDamage(e.dmg, fromYaw)) { /* damage applied */ }
      onPlayerHit();
    }
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
