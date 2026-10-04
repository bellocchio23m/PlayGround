// allocation-free math helpers + object pools
import * as THREE from 'three';

export const _v1 = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _v3 = new THREE.Vector3();
export const _ray = new THREE.Raycaster();
export const _dir = new THREE.Vector3();

export function clamp(v: number, a: number, b: number): number { return v < a ? a : v > b ? b : v; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
export function dampAngle(cur: number, target: number, lambda: number, dt: number): number {
  let d = ((target - cur + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return cur + d * (1 - Math.exp(-lambda * dt));
}
export function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
}

export class Pool<T> {
  private free: T[] = [];
  constructor(private factory: () => T, private reset: (o: T) => void, prewarm = 0) {
    for (let i = 0; i < prewarm; i++) this.free.push(factory());
  }
  acquire(): T { return this.free.pop() ?? this.factory(); }
  release(o: T): void { this.reset(o); if (this.free.length < 256) this.free.push(o); }
}

/** Simple event bus without allocations on emit path (arrays reused by callers). */
export class Bus {
  private map = new Map<string, Set<(p?: unknown) => void>>();
  on(ev: string, fn: (p?: unknown) => void): void {
    let s = this.map.get(ev); if (!s) { s = new Set(); this.map.set(ev, s); }
    s.add(fn);
  }
  emit(ev: string, p?: unknown): void { this.map.get(ev)?.forEach((f) => f(p)); }
}
