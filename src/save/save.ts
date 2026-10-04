// Local save system (localStorage, JSON, corruption-safe + autosave).
export interface SaveData {
  v: number;
  missionIndex: number;
  missionsDone: string[];
  xp: number;
  upgrades: Record<string, number>;
  inventory: { smoke: number; knives: number; relic: boolean; doc: boolean };
  settings: { volume: number; quality: 'low' | 'med' | 'high'; invertY: boolean; cameraSens: number };
  checkpoint: { x: number; y: number; z: number; missionId: string } | null;
  bestGhost: Record<string, boolean>;
}

const KEY = 'shadowline-kestrel-save-v1';

export function defaultSave(): SaveData {
  return {
    v: 1, missionIndex: 0, missionsDone: [], xp: 0, upgrades: {},
    inventory: { smoke: 2, knives: 3, relic: false, doc: false },
    settings: { volume: 0.8, quality: 'med', invertY: false, cameraSens: 1 },
    checkpoint: null, bestGhost: {},
  };
}

export class SaveSystem {
  data: SaveData = defaultSave();
  private timer = 0;

  load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) { this.data = defaultSave(); return this.data; }
      const p = JSON.parse(raw) as Partial<SaveData>;
      const d = defaultSave();
      this.data = {
        ...d, ...p,
        inventory: { ...d.inventory, ...(p.inventory ?? {}) },
        settings: { ...d.settings, ...(p.settings ?? {}) },
        upgrades: p.upgrades ?? {}, missionsDone: p.missionsDone ?? [],
        bestGhost: p.bestGhost ?? {},
      };
      if (this.data.v !== 1) throw new Error('version');
    } catch {
      try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      this.data = defaultSave();
    }
    return this.data;
  }

  save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* quota — ignore */ }
  }

  wipe(): void { this.data = defaultSave(); this.save(); }

  /** autosave every 20s + on mission events (caller-driven update). */
  update(dt: number): void {
    this.timer += dt;
    if (this.timer > 20) { this.timer = 0; this.save(); }
  }
}
