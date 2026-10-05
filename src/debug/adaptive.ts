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

/** Pixel ratio for an adaptive level (0=low 0.75, 1=med 1.0, 2=high 1.5).
 *  Central calls this on level transitions instead of hardcoding ratios.
 *  Out-of-range levels clamp to [0, 2]. Pure, no allocations. */
export function pixelRatioFor(level: number): number {
  const i = Math.min(ADAPT_RATIOS.length - 1, Math.max(0, Math.floor(level)));
  return ADAPT_RATIOS[i] ?? 1.0;
}

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
