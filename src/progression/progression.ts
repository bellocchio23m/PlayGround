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

/** (phase-3b, additive) New upgrade definitions. CENTRAL CONTRACT (game.ts openProgression):
 *  central must merge NEW_UPGRADES into the shop list next to UPGRADES from core/config
 *  (same { id, name, desc, max: 3 } shape; buy via buyUpgrade(p, id, 3)) and apply
 *  upgradeEffects() onto the player each mission start / purchase:
 *  - 'slide' (Scivolata): slideMul scales slide control (higher = tighter/longer slide)
 *    and divides slide noise (central: slideNoise = base / slideMul).
 *  - 'lure' (Tascapane): maxLure caps save.data.inventory.lure (base 1, +1 per level).
 *  - 'falce' (Luna Piena): specialMul scales Falce Lunare special damage (+25% per level). */
export interface UpgradeDef { id: string; name: string; desc: string; max: number }
export const NEW_UPGRADES: UpgradeDef[] = [
  { id: 'slide', name: 'Scivolata', desc: '+controllo in scivolata, -rumore in scivolata per livello', max: 3 },
  { id: 'lure', name: 'Tascapane', desc: '+1 esca (lure) max per livello', max: 3 },
  { id: 'falce', name: 'Luna Piena', desc: '+25% danno speciale Falce Lunare per livello', max: 3 },
];

/** apply all upgrade effects onto the player + inventory caps */
export function upgradeEffects(p: Progression): {
  speedMul: number; stealthMul: number; staminaMax: number; dmgMul: number;
  regenMul: number; maxSmoke: number; maxKnives: number; climbMul: number;
  slideMul: number; maxLure: number; specialMul: number;
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
    slideMul: 1 + 0.2 * u('slide'),
    maxLure: 1 + u('lure'),
    specialMul: 1 + 0.25 * u('falce'),
  };
}
