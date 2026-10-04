// Inventory + progression: small, every upgrade has a real gameplay effect.
export interface Inventory { smoke: number; knives: number; relic: boolean; doc: boolean }
export interface Progression { xp: number; level: number; upgrades: Record<string, number> }

export function xpForLevel(level: number): number { return 100 + (level - 1) * 80; }

export function addXp(p: Progression, amount: number): { levels: number } {
  p.xp += amount;
  let levels = 0;
  while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; levels++; }
  return { levels };
}

/** skill points = level-1 spent implicitly: available = level-1 - totalSpent */
export function availablePoints(p: Progression): number {
  const spent = Object.values(p.upgrades).reduce((a, b) => a + b, 0);
  return Math.max(0, p.level - 1 - spent);
}

export function upgradeLevel(p: Progression, id: string): number { return p.upgrades[id] ?? 0; }

export function buyUpgrade(p: Progression, id: string, max: number): boolean {
  if ((p.upgrades[id] ?? 0) >= max) return false;
  if (availablePoints(p) <= 0) return false;
  p.upgrades[id] = (p.upgrades[id] ?? 0) + 1;
  return true;
}

/** apply all upgrade effects onto the player + inventory caps */
export function upgradeEffects(p: Progression): {
  speedMul: number; stealthMul: number; staminaMax: number; dmgMul: number;
  regenMul: number; maxSmoke: number; maxKnives: number; climbMul: number;
} {
  const u = (id: string): number => p.upgrades[id] ?? 0;
  return {
    speedMul: 1 + 0.08 * u('speed'),
    stealthMul: Math.pow(0.88, u('stealth')),
    staminaMax: 100 + 20 * u('stamina'),
    dmgMul: 1 + 0.15 * u('combat'),
    regenMul: 1 + 0.35 * u('recovery'),
    maxSmoke: 2 + u('tools'),
    maxKnives: 3 + u('tools'),
    climbMul: 1 + 0.12 * u('traversal'),
  };
}
