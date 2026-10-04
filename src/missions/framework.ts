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
