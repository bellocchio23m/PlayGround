// Local save system: 3 slots + rolling backup + versioning (v2).
// Corrupt primary -> automatic fallback to backup -> fresh default (never blocks).
export interface SaveData {
  v: number;
  slot: number;
  updatedAt: number;
  missionIndex: number;
  missionsDone: string[];
  xp: number;
  upgrades: Record<string, number>;
  inventory: { smoke: number; knives: number; relic: boolean; doc: boolean; lure: number };
  settings: { volume: number; quality: 'low' | 'med' | 'high'; invertY: boolean; cameraSens: number; lefty: boolean; uiScale: number; minimap: boolean; layout: 'default' | 'compact' | 'large'; minimapZoom: 1 | 2 | 3 };
  checkpoint: { x: number; y: number; z: number; missionId: string } | null;
  bestGhost: Record<string, boolean>;
  worldFlags: Record<string, boolean>;
  stats: { kills: number; ghosts: number; deaths: number; playTime: number };
  unlockedSpecial: boolean;
}

const SLOT_KEY = (i: number): string => `shadowline-slot-${i}`;
const BAK_KEY = (i: number): string => `shadowline-slot-${i}-bak`;
const LEGACY_KEY = 'shadowline-kestrel-save-v1';
export const SLOT_COUNT = 3;

export function defaultSave(slot = 0): SaveData {
  return {
    v: 2, slot, updatedAt: Date.now(),
    missionIndex: 0, missionsDone: [], xp: 0, upgrades: {},
    inventory: { smoke: 2, knives: 3, relic: false, doc: false, lure: 1 },
    settings: { volume: 0.8, quality: 'med', invertY: false, cameraSens: 1, lefty: false, uiScale: 1, minimap: true, layout: 'default' as const, minimapZoom: 1 as const },
    checkpoint: null, bestGhost: {},
    worldFlags: {},
    stats: { kills: 0, ghosts: 0, deaths: 0, playTime: 0 },
    unlockedSpecial: false,
  };
}

function parse(raw: string | null): SaveData | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<SaveData>;
    if (typeof p !== 'object' || p === null) return null;
    const d = defaultSave(typeof p.slot === 'number' ? p.slot : 0);
    const merged: SaveData = {
      ...d, ...p,
      inventory: { ...d.inventory, ...((p.inventory ?? {}) as object) } as SaveData['inventory'],
      settings: { ...d.settings, ...((p.settings ?? {}) as object) } as SaveData['settings'],
      upgrades: (p.upgrades ?? {}) as Record<string, number>,
      missionsDone: Array.isArray(p.missionsDone) ? p.missionsDone : [],
      bestGhost: (p.bestGhost ?? {}) as Record<string, boolean>,
      worldFlags: { ...(p.worldFlags ?? {}) } as Record<string, boolean>,
      stats: { ...d.stats, ...((p.stats ?? {}) as object) } as SaveData['stats'],
      unlockedSpecial: (p.unlockedSpecial ?? false) as boolean,
    };
    if (merged.v !== 2) return migrate(merged);
    return merged;
  } catch {
    return null;
  }
}

/** v1 (single-key) and partial payloads migrate forward automatically. */
function migrate(p: SaveData): SaveData {
  const d = defaultSave(p.slot ?? 0);
  return {
    ...d,
    missionIndex: p.missionIndex ?? 0,
    missionsDone: p.missionsDone ?? [],
    xp: p.xp ?? 0,
    upgrades: p.upgrades ?? {},
    inventory: { ...d.inventory, ...(p.inventory ?? {}) },
    settings: { ...d.settings, ...(p.settings ?? {}) },
    checkpoint: p.checkpoint ?? null,
    bestGhost: p.bestGhost ?? {},
    worldFlags: { ...(p.worldFlags ?? {}) },
    stats: { ...d.stats, ...((p.stats ?? {}) as object) },
    unlockedSpecial: p.unlockedSpecial ?? false,
  };
}

export class SaveSystem {
  data: SaveData = defaultSave(0);
  slotIndex = 0;
  private timer = 0;

  /** read-only slot overview for the menu (no throw). */
  listSlots(): Array<SaveData | null> {
    const out: Array<SaveData | null> = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      out.push(parse(this.read(SLOT_KEY(i))));
    }
    // one-time legacy migration into slot 0
    if (out.every((s) => s === null)) {
      const legacy = parse(this.read(LEGACY_KEY));
      if (legacy) (out as Array<SaveData | null>)[0] = { ...legacy, slot: 0, v: 2 };
    }
    return out;
  }

  private read(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  }
  private write(k: string, v: string): boolean {
    try { localStorage.setItem(k, v); return true; } catch { return false; }
  }

  load(): SaveData {
    return this.loadSlot(this.slotIndex);
  }

  loadSlot(i: number): SaveData {
    this.slotIndex = Math.max(0, Math.min(SLOT_COUNT - 1, i));
    const primary = parse(this.read(SLOT_KEY(this.slotIndex)));
    if (primary) { this.data = primary; return this.data; }
    const bak = parse(this.read(BAK_KEY(this.slotIndex)));
    if (bak) {
      this.data = bak;
      this.write(SLOT_KEY(this.slotIndex), JSON.stringify(bak)); // restore
      return this.data;
    }
    if (this.slotIndex === 0) {
      const legacy = parse(this.read(LEGACY_KEY));
      if (legacy) { this.data = { ...legacy, slot: 0, v: 2 }; this.save(); return this.data; }
    }
    this.data = defaultSave(this.slotIndex);
    return this.data;
  }

  save(): void {
    this.data.updatedAt = Date.now();
    this.data.slot = this.slotIndex;
    this.data.v = 2;
    const payload = JSON.stringify(this.data);
    const prev = this.read(SLOT_KEY(this.slotIndex));
    if (prev) this.write(BAK_KEY(this.slotIndex), prev); // rotate backup
    this.write(SLOT_KEY(this.slotIndex), payload);
  }

  wipe(): void { this.data = defaultSave(this.slotIndex); this.save(); }

  /** Death/retry persistence: increments deaths and saves (central calls on death). */
  saveDie(): void {
    this.data.stats.deaths += 1;
    this.save();
  }

  /** Post-mission stats: record a completed mission (ghost bonus + xp already applied by caller). */
  saveMissionComplete(missionId: string, ghost: boolean, xp: number): void {
    if (!this.data.missionsDone.includes(missionId)) this.data.missionsDone.push(missionId);
    this.data.xp += xp;
    if (ghost) this.data.stats.ghosts += 1;
    this.data.bestGhost[missionId] = (this.data.bestGhost[missionId] ?? true) && ghost;
    this.save();
  }

  /** Small safe stat helpers (central calls on kills/ghosts/deaths). */
  bumpStat(k: 'kills' | 'ghosts' | 'deaths', n = 1): void {
    this.data.stats[k] += n;
  }

  /** Accumulate play time (seconds); caller saves periodically via update()/save(). */
  addPlayTime(dt: number): void {
    if (Number.isFinite(dt) && dt > 0) this.data.stats.playTime += dt;
  }

  /** autosave every 20s (caller also saves on mission events). */
  update(dt: number): void {
    this.timer += dt;
    if (this.timer > 20) { this.timer = 0; this.save(); }
  }
}
