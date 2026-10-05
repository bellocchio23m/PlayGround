// SHADOWLINE: Kestrel — shared types & tuning config
export const AIState = {
  Idle: 'IDLE', Patrol: 'PATROL', Suspicious: 'SUSPICIOUS',
  Investigating: 'INVESTIGATING', Alert: 'ALERT', Searching: 'SEARCHING',
  Combat: 'COMBAT', Returning: 'RETURNING', Dead: 'DEAD',
} as const;
export type AIState = (typeof AIState)[keyof typeof AIState];

export const MoveState = {
  Idle: 'idle', Walk: 'walk', Run: 'run', Sprint: 'sprint', Crouch: 'crouch',
  Jump: 'jump', Fall: 'fall', Landing: 'landing', Vault: 'vault', Climb: 'climb',
  Dodge: 'dodge', Attack: 'attack', Parry: 'parry', Hit: 'hit', Death: 'death',
  Hang: 'hang', Mantle: 'mantle', Slide: 'slide',
} as const;
export type MoveState = (typeof MoveState)[keyof typeof MoveState];

export interface NoiseEvent { x: number; y: number; z: number; radius: number; loudness: number; kind: string; t: number }

export const CFG = {
  player: {
    walkSpeed: 3.2, runSpeed: 6.0, sprintSpeed: 9.2, crouchSpeed: 1.8,
    accel: 26, decel: 30, jumpVel: 7.2, gravity: -22,
    sprintStaminaDrain: 14, dodgeCost: 18, staminaMax: 100, staminaRegen: 22,
    hpMax: 100, crouchNoise: 0.15, walkNoise: 0.45, runNoise: 1.0, sprintNoise: 1.6,
  },
  stealth: {
    baseViewDist: 26, crouchViewMult: 0.55, sprintDetectMult: 1.5,
    fovDeg: 75, peripheralDist: 7, suspicionRate: 55, decayRate: 22,
    alertThreshold: 100, losePlayerTime: 6, corpseNoticeDist: 12,
  },
  combat: {
    lightDmg: 26, heavyDmg: 48, throwDmg: 34, finisherDmg: 120,
    parryWindow: 0.35, dodgeIFrames: 0.4, enemyDmg: 14, enemyHeavyDmg: 24,
    attackRange: 2.6, assassinRange: 2.4,
  },
  perf: { pixelRatioCap: 1.5, aiTickHz: 10, corpseLifetime: 30 },
};

export interface UpgradeDef { id: string; name: string; desc: string; max: number; }
export const UPGRADES: UpgradeDef[] = [  { id: 'speed', name: 'Muscoli felini', desc: '+8% velocità movimento per livello' },
  { id: 'stealth', name: 'Passo d\u2019ombra', desc: '-12% rumore e rilevamento per livello' },
  { id: 'stamina', name: 'Fiato lungo', desc: '+20 stamina max per livello' },
  { id: 'combat', name: 'Lama pesante', desc: '+15% danno katana per livello' },
  { id: 'traversal', name: 'Scatto verticale', desc: 'vault/climb più rapidi, +salto' },
  { id: 'recovery', name: 'Secondo fiato', desc: '+regen stamina e HP fuori combattimento' },
  { id: 'tools', name: 'Borsa attrezzi', desc: '+1 fumogeno e coltello max per livello' },
].map((u) => ({ ...u, max: 3 }));

// ---- A55 performance profiles (MEDIUM = Galaxy A55 5G default) ----
export interface PerfProfile {
  id: 'low' | 'med' | 'high';
  pixelRatio: number; antialias: boolean;
  lampCount: number; fogNear: number; fogFar: number;
  particleMul: number; aiHz: number; minimap: boolean;
  extraGuards: number; civilians: boolean;
}
export const PROFILES: Record<string, PerfProfile> = {
  low: { id: 'low', pixelRatio: 0.75, antialias: false, lampCount: 2, fogNear: 40, fogFar: 95, particleMul: 0.4, aiHz: 8, minimap: false, extraGuards: 0, civilians: false },
  med: { id: 'med', pixelRatio: 1.0, antialias: false, lampCount: 4, fogNear: 55, fogFar: 130, particleMul: 0.8, aiHz: 10, minimap: true, extraGuards: 0, civilians: true },
  high: { id: 'high', pixelRatio: 1.5, antialias: true, lampCount: 4, fogNear: 60, fogFar: 150, particleMul: 1.0, aiHz: 12, minimap: true, extraGuards: 2, civilians: true },
};
