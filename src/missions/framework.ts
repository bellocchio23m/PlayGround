// Data-driven mission framework: Mission -> Objective -> Trigger/Condition/Event/Reward/FailState.
// New missions = data + tiny hooks, no engine changes.
import * as THREE from 'three';

export interface ObjectiveDef {
  id: string; text: string;
  kind: 'reach' | 'assassinate' | 'collect' | 'survive' | 'escape' | 'ghost';
  target?: THREE.Vector3 | string; radius?: number; count?: number;
}
export interface MissionDef {
  id: string; name: string; briefing: string;
  objectives: ObjectiveDef[];
  failOnDeath?: boolean; failOnAlarm?: boolean;
  rewardXp: number; rewardTools?: { smoke?: number; knives?: number };
  start: THREE.Vector3;
  /** (phase-3, additive) Suggested enemy spawns for central game.ts.
   *  CENTRAL CONTRACT: on startMission, for each entry spawn `new Enemy(kind, world.patrolRoutes[route])`.
   *  `route` must be < world.patrolRoutes.length. For `assassinate` objectives, central must tag
   *  the FIRST spawn entry whose kind matches the mission's target role as the objective target
   *  (set `(enemy as any).tag='target'` + `(enemy as any).isTarget=true`), mirroring m2-lama. */
  spawns?: Array<{ kind: 'guard' | 'elite' | 'captain' | 'brute' | 'ranger'; route: number }>;
  /** (phase-3, additive) World-flag persisted by central into save.worldFlags on mission COMPLETE.
   *  Known values: 'blackout-plaza' (m6: central turns plaza lamps off), 'corvo-dead' (m8: boss dead). */
  setFlag?: string;
  /** (phase-3, additive) Previous-mission link text, shown by central in the briefing UI. */
  narrative?: string;
  /** (phase-3, additive) Bonus XP central awards on completion when runtime `ghost` is still true. */
  ghostBonusXp?: number;
  /** (phase-3b, additive) Two suggested approaches shown by central in the briefing UI
   *  (read-only text, no gameplay logic). Filled for m6/m7/m8/m9; older missions keep
   *  both approaches inside `briefing` prose. */
  approachA?: string;
  approachB?: string;
}

export interface MissionRuntime {
  def: MissionDef;
  objIndex: number;
  progress: number; // per-objective counter
  done: boolean; failed: boolean; failReason: string;
  ghost: boolean; // no full alerts so far
  spotted: boolean;
  time: number;
  checkpoint: THREE.Vector3;
}

export function startMission(def: MissionDef): MissionRuntime {
  return {
    def, objIndex: 0, progress: 0, done: false, failed: false, failReason: '',
    ghost: true, spotted: false, time: 0, checkpoint: def.start.clone(),
  };
}

export function currentObjective(rt: MissionRuntime): ObjectiveDef | null {
  return rt.done || rt.failed ? null : rt.def.objectives[rt.objIndex] ?? null;
}

export function advanceObjective(rt: MissionRuntime): boolean {
  rt.objIndex++; rt.progress = 0;
  rt.checkpoint = rt.def.start.clone();
  if (rt.objIndex >= rt.def.objectives.length) { rt.done = true; return true; }
  return false;
}

export function failMission(rt: MissionRuntime, reason: string): void {
  rt.failed = true; rt.failReason = reason;
}
