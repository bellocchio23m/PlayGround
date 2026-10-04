// True stealth perception: distance + FOV + occlusion + stance + noise.
// Pure functions (unit-testable) + runtime helper used by AI.
import { CFG } from '../core/config';
import { angleDiff, clamp } from '../core/utils';

export interface VisionSample {
  dist: number; inFov: boolean; blocked: boolean; crouch: boolean;
  sprinting: boolean; elevatedAttacker: boolean;
}

/** 0..1 visibility factor. */
export function visibility(s: VisionSample): number {
  const maxD = CFG.stealth.baseViewDist * (s.crouch ? CFG.stealth.crouchViewMult : 1);
  if (s.blocked) return 0;
  if (s.dist > maxD) return 0;
  let v = 1 - s.dist / maxD;
  if (!s.inFov) {
    // peripheral hearing-ish: only very close
    if (s.dist > CFG.stealth.peripheralDist) return 0;
    v *= 0.35;
  }
  if (s.sprinting) v *= CFG.stealth.sprintDetectMult;
  return clamp(v, 0, 1.5);
}

export function inFov(ex: number, ez: number, eyaw: number, px: number, pz: number, fovDeg: number): boolean {
  const dx = px - ex; const dz = pz - ez;
  if (dx * dx + dz * dz < 0.01) return true;
  const ang = Math.atan2(dx, dz);
  // enemy yaw convention matches player (forward = -sin,-cos)
  return angleDiff(ang, eyaw + Math.PI) < ((fovDeg * Math.PI) / 180) / 2;
}

/** suspicion gained per second given visibility (night: far glimpses accumulate slowly) */
export function suspicionRate(v: number, dist: number): number {
  const closeness = clamp(1.6 - dist / 18, 0.35, 1.6);
  return CFG.stealth.suspicionRate * v * closeness;
}

export function canAssassinate(o: {
  dist: number; blocked: boolean; enemyYaw: number; playerYaw: number;
  enemyAlert: boolean; fromAbove: boolean; moving: boolean;
}): { ok: boolean; reason: string } {
  if (o.blocked) return { ok: false, reason: 'Muro tra te e il bersaglio' };
  if (o.dist > CFG.combat.assassinRange + (o.fromAbove ? 1.6 : 0)) return { ok: false, reason: 'Troppo lontano' };
  if (o.enemyAlert) return { ok: false, reason: 'Il nemico ti ha già visto' };
  if (o.moving && o.dist > 1.6) return { ok: false, reason: 'Bersaglio in movimento' };
  return { ok: true, reason: 'ok' };
}

/** is player behind enemy (for backstab)? */
export function isBehind(ex: number, ez: number, eyaw: number, px: number, pz: number): boolean {
  const dx = px - ex; const dz = pz - ez;
  const behindYaw = eyaw; // enemy forward is -yaw; behind is +yaw dir
  const ang = Math.atan2(dx, dz);
  return angleDiff(ang, behindYaw) < Math.PI / 2.2;
}
