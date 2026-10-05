// Adaptive quality governor: pure hysteresis logic, zero game coupling.
//
// The central owner (src/core/game.ts) wires this by passing hooks that call
// applyProfile()/setPixelRatio(); this file never imports game, world, or three.
// No allocations in update(): only number compares and stores.
//
// Policy (documented constants below):
// - fps < LOW_FPS (25) sustained for LOW_HOLD_S (4s)  -> step DOWN one level.
// - fps > HIGH_FPS (50) sustained for HIGH_HOLD_S (10s) -> step UP one level.
// - Mid-band fps [25, 50] resets both hold timers.
// - COOLDOWN_S (4s): at most one level change per 4s (lastChange gate).
// - Boundaries are exclusive: exactly 25 or 50 fps resets both timers.
// - Floor/ceiling: level stays in [0, 2]; no hooks fire when clamped.
export type QualityName = 'low' | 'med' | 'high';

/** Hooks the central game implements. Matches Game.applyProfile + setPixelRatio. */
export interface AdaptiveHooks {
  setPixelRatio(r: number): void;
  setProfile(q: QualityName): void;
  getProfile(): QualityName | string;
}

export const ADAPT_LEVELS: QualityName[] = ['low', 'med', 'high'];
export const ADAPT_RATIOS = [0.75, 1.0, 1.5];
export const ADAPT_LOW_FPS = 25;
export const ADAPT_HIGH_FPS = 50;
export const ADAPT_LOW_HOLD_S = 4;
export const ADAPT_HIGH_HOLD_S = 10;
export const ADAPT_COOLDOWN_S = 4;

export class AdaptiveQuality {
  /** 0 = low, 1 = med, 2 = high. */
  level = 1;
  /** Seconds since the last applied level change (starts large = change allowed). */
  lastChange = 999;
  /** Master toggle. When false, update() advances the clock but never steps. */
  enabled = true;
  private lowT = 0;
  private highT = 0;
  private synced = false;

  /** Re-arm to a known profile (e.g. after the user picks one in settings). */
  reset(profile: QualityName = 'med'): void {
    const i = ADAPT_LEVELS.indexOf(profile);
    this.level = i >= 0 ? i : 1;
    this.lowT = 0;
    this.highT = 0;
    this.lastChange = 999;
    this.synced = true;
  }

  update(dt: number, fps: number, hooks: AdaptiveHooks): void {
    if (dt <= 0) return;
    this.lastChange += dt;
    if (!this.enabled) return;
    if (!this.synced) this.sync(hooks);
    if (fps < ADAPT_LOW_FPS) {
      this.lowT += dt;
      this.highT = 0;
    } else if (fps > ADAPT_HIGH_FPS) {
      this.highT += dt;
      this.lowT = 0;
    } else {
      this.lowT = 0;
      this.highT = 0;
    }
    if (this.lastChange < ADAPT_COOLDOWN_S) return;
    if (this.lowT >= ADAPT_LOW_HOLD_S && this.level > 0) {
      this.apply(this.level - 1, hooks);
    } else if (this.highT >= ADAPT_HIGH_HOLD_S && this.level < ADAPT_LEVELS.length - 1) {
      this.apply(this.level + 1, hooks);
    }
  }

  /** Adopt the central profile once, so manual settings are respected, not fought. */
  private sync(hooks: AdaptiveHooks): void {
    const cur = hooks.getProfile();
    const i = ADAPT_LEVELS.indexOf(cur as QualityName);
    if (i >= 0) this.level = i;
    this.synced = true;
  }

  private apply(n: number, hooks: AdaptiveHooks): void {
    this.level = n;
    this.lowT = 0;
    this.highT = 0;
    this.lastChange = 0;
    hooks.setProfile(ADAPT_LEVELS[n]);
    hooks.setPixelRatio(ADAPT_RATIOS[n]);
  }
}

// ---------------------------------------------------------------------------
// ADDITIVE visual/QA exports (no behavior change above; pure + documented).
// Central owns src/core/config.ts PROFILES; this file never imports it.
// ---------------------------------------------------------------------------

/** Documentation table: shadow-map size + AA flag per tier. Central PROFILES stays authoritative. */
export const PROFILE_DELTA = {
  low: { shadow: 0, aa: 0 },
  med: { shadow: 512, aa: 0 },
  high: { shadow: 1024, aa: 1 },
} as const;

/** Minimal structural profile shape (no three/config imports; central passes PROFILES). */
export interface DistinctProfile {
  pixelRatio?: number;
  lampCount?: number;
  aiHz?: number;
}

/**
 * Pure check: low/med/high must be visually distinct.
 * True iff all three exist and no two share the same
 * (pixelRatio, lampCount, aiHz) triple. Central PROFILES passes:
 * low (0.75,2,8), med (1.0,4,10), high (1.5,4,12) are pairwise distinct.
 */
export function assertProfilesDistinct(
  profiles: Record<string, DistinctProfile>,
): boolean {
  const low = profiles['low'];
  const med = profiles['med'];
  const high = profiles['high'];
  if (!low || !med || !high) return false;
  const key = (p: DistinctProfile): string =>
    `${p.pixelRatio ?? -1}|${p.lampCount ?? -1}|${p.aiHz ?? -1}`;
  const a = key(low);
  const b = key(med);
  const c = key(high);
  return a !== b && b !== c && a !== c;
}

/** Final-report visual QA checklist (scenes x systems x tiers x offline). */
export const QA_VISUAL_CHECKLIST: string[] = [
  'menu: title, settings, quality selector LOW/MED/HIGH apply without reload',
  'strada: street level props, lamps, signs render with correct LOD per tier',
  'tetti: rooftops parallax/cull clean on LOW/MED/HIGH, no pop-in at fog edge',
  'traversal: vault/climb/mantle animation + camera framing on strada and tetti',
  'stealth: crouch visibility, detection meter, hiding spots readable on all tiers',
  'combat: katana combos, hitstop, enemy reactions framed at 360x740 and desktop',
  'parry: timing window flash + sound cue visible on LOW/MED/HIGH',
  'assassination: prompt, camera, finisher FX from stealth on strada and tetti',
  'civili: crowd behavior during alarm, no placeholder T-poses',
  'allarme: alarm state lighting/UI banner + guard reinforcement call-in',
  'boss: arena intro, HP bar, phase transitions without frame hitches >50ms',
  'pause: pause menu overlays game, resumes to identical state',
  'death: death screen, retry restores HP/stamina and zone state',
  'victory: victory screen, stats, return-to-menu flow',
  'mobile: 360x740 touch controls, no UI overlap, HUD readable on LOW/MED/HIGH',
  'offline: airplane-mode reload playable from cache (sw.js), no network errors',
];

/** Defect-free acceptance bar for the final visual report. */
export const QA_NO_DEFECTS: string[] = [
  'no clipping through walls, roofs, or stairs during traversal',
  'no UI overlap on 360x740 or desktop HUD/menus',
  'no z-fighting on strada/tetti decals and signs',
  'no missing textures or magenta fallback materials',
  'no T-pose or frozen NPC/civili during alarm or combat',
  'no frame spikes >50ms sustained on MED tier walkthrough',
  'no audio cutout on parry/assassination/boss transitions',
];
