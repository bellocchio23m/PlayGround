// Urban district "Porto Scuro": dense hand-designed block with rooftops, alleys,
// courtyard, enterable warehouse, parkour routes. Built with instanced/merged
// low-poly geometry for mobile (few draw calls).
import * as THREE from 'three';

export interface Ledge { min: THREE.Vector3; max: THREE.Vector3; topY: number; kind: 'vault' | 'climb' }
export interface Interactable {
  id: string; pos: THREE.Vector3; radius: number; label: string; kind: string;
  taken: boolean; mesh?: THREE.Object3D;
}

export class World {
  group = new THREE.Group();
  colliders: THREE.Box3[] = [];
  ledges: Ledge[] = [];
  interactables: Interactable[] = [];
  patrolRoutes: THREE.Vector3[][] = [];
  spawnPoints: { player: THREE.Vector3; enemies: THREE.Vector3[][] } = { player: new THREE.Vector3(0, 0, 26), enemies: [] };
  lamps: THREE.PointLight[] = [];
  bounds = new THREE.Box3(new THREE.Vector3(-46, 0, -46), new THREE.Vector3(46, 30, 46));
  private ray = new THREE.Raycaster();

  constructor(private scene: THREE.Scene) {}

  build(): void {
    this.ground();
    this.lighting();
    this.buildings();
    this.alleyProps();
    this.warehouse();
    this.plaza();
    this.patrols();
    this.scene.add(this.group);
  }

  private mat(color: number, rough = 0.9, emissive = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05, emissive });
  }

  private box(x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, collide = true): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.matrixAutoUpdate = false; m.updateMatrix();
    this.group.add(m);
    if (collide) this.colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)));
    return m;
  }

  private ground(): void {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(140, 140),
      new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 1 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = false;
    this.group.add(g);
    // roads (dark strips slightly above ground, no collision)
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 1 });
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(14, 130), roadMat);
    r1.rotation.x = -Math.PI / 2; r1.position.set(0, 0.02, 0); this.group.add(r1);
    const r2 = new THREE.Mesh(new THREE.PlaneGeometry(130, 12), roadMat.clone());
    r2.rotation.x = -Math.PI / 2; r2.position.set(0, 0.02, 8); this.group.add(r2);
    // sidewalk curbs
    const curb = this.mat(0x2b3340);
    this.box(-8, 0.15, 0, 2, 0.3, 130, curb, false);
    this.box(8, 0.15, 0, 2, 0.3, 130, curb, false);
    // crosswalk stripes
    const stripe = this.mat(0x8a93a3);
    for (let i = -3; i <= 3; i++) this.box(i * 1.6, 0.03, 8, 0.8, 0.02, 3, stripe, false);
  }

  private lighting(): void {
    const hemi = new THREE.HemisphereLight(0x8fb4ff, 0x2a2320, 1.15);
    this.scene.add(hemi);
    const amb = new THREE.AmbientLight(0x33415e, 0.55);
    this.scene.add(amb);
    const moon = new THREE.DirectionalLight(0xbfd4ff, 1.5);
    moon.position.set(-30, 48, 18);
    this.scene.add(moon);
    // warm street lamps (only 4 real point lights for mobile)
    const lampPos: Array<[number, number, number]> = [[-9, 0, -20], [9, 0, -6], [-9, 0, 20], [9, 0, 30]];
    const poleMat = this.mat(0x39414f);
    for (const [x, , z] of lampPos) {
      this.box(x, 2.5, z, 0.25, 5, 0.25, poleMat);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc37a }));
      bulb.position.set(x, 5.1, z); this.group.add(bulb);
      const pl = new THREE.PointLight(0xffb45e, 30, 26, 1.6);
      pl.position.set(x, 5, z);
      this.scene.add(pl); this.lamps.push(pl);
    }
    // fog + night sky
    this.scene.fog = new THREE.Fog(0x0a0e14, 55, 130);
    this.scene.background = new THREE.Color(0x0a0e14);
  }

  private buildingBlock(cx: number, cz: number, w: number, h: number, d: number, bodyColor: number): void {
    const body = this.mat(bodyColor);
    this.box(cx, h / 2, cz, w, h, d, body);
    // roof lip (parkour edge) + ledge record
    const lip = this.mat(0x11161d);
    this.box(cx, h + 0.15, cz, w + 0.6, 0.3, d + 0.6, lip);
    this.ledges.push({
      min: new THREE.Vector3(cx - w / 2, 0, cz - d / 2),
      max: new THREE.Vector3(cx + w / 2, h, cz + d / 2),
      topY: h + 0.3, kind: h > 5 ? 'climb' : 'vault',
    });
    // window strips (emissive planes, no collision, merged into few meshes)
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    const winMatOff = new THREE.MeshBasicMaterial({ color: 0x1d2733 });
    const rows = Math.floor(h / 3); const cols = Math.floor(w / 2.4);
    const geo = new THREE.PlaneGeometry(1.1, 1.3);
    const on = new THREE.InstancedMesh(geo, winMat, Math.max(1, rows * cols));
    const off = new THREE.InstancedMesh(geo, winMatOff, Math.max(1, rows * cols));
    const m4 = new THREE.Matrix4();
    let a = 0; let b = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = ((r * 7 + c * 3 + Math.floor(cx)) % 3) === 0;
        m4.makeTranslation(cx - w / 2 + 1.4 + c * 2.4, 2.2 + r * 3, cz + d / 2 + 0.06);
        if (lit) on.setMatrixAt(a++, m4); else off.setMatrixAt(b++, m4);
      }
    }
    on.count = a; off.count = b;
    on.instanceMatrix.needsUpdate = true; off.instanceMatrix.needsUpdate = true;
    this.group.add(on); this.group.add(off);
    // AC units / crates on roof for parkour stepping
    if (w > 8) {
      const ac = this.mat(0x4b5563);
      this.box(cx - w / 4, h + 0.9, cz, 1.6, 1.2, 1.2, ac);
      this.box(cx + w / 4, h + 0.7, cz + 2, 1.2, 0.8, 1.2, ac);
    }
  }

  private buildings(): void {
    // West row (low — vault/climb tutorial heights)
    this.buildingBlock(-20, -14, 12, 4.2, 12, 0x3a2f2b);
    this.buildingBlock(-20, 2, 12, 6.5, 10, 0x33302e);
    this.buildingBlock(-20, 18, 12, 5.2, 12, 0x2e3138);
    // East row (taller — vertical infiltration)
    this.buildingBlock(20, -16, 14, 11, 12, 0x2f3540);
    this.buildingBlock(20, 0, 14, 8.5, 12, 0x38322c);
    this.buildingBlock(20, 18, 14, 13, 12, 0x2c313a);
    // North block (target villa)
    this.buildingBlock(0, -30, 22, 7.5, 10, 0x3d3330);
    // South block behind spawn
    this.buildingBlock(-14, 34, 10, 5.5, 8, 0x323a44);
    this.buildingBlock(12, 34, 12, 4.5, 8, 0x3a332c);
    // planks between rooftops (parkour bridges)
    const plank = this.mat(0x6b4f2e);
    this.box(-13.5, 4.4, -6, 3.4, 0.25, 1.4, plank);       // W1->W2 gap
    this.box(13, 8.7, 9, 1.6, 0.25, 4.2, plank);           // E2->E3 gap
  }

  private alleyProps(): void {
    const crate = this.mat(0x5b4632); const dump = this.mat(0x274035);
    const crates: Array<[number, number, number, number]> = [
      [-11, 0.5, -8, 1], [-11, 1.4, -8.2, 0.7], [-10, 0.4, -6.5, 0.8],
      [11, 0.5, 22, 1], [12.2, 0.4, 21, 0.8], [11.5, 1.3, 21.5, 0.7],
      [-6, 0.5, -24, 1], [6, 0.5, -24, 1],
      [11, 0.5, -26, 1], [11, 1.4, -26, 0.7],
    ];
    for (const [x, y, z, s] of crates) this.box(x, y, z, s, s, s, crate);
    this.box(-12, 0.7, 12, 2.2, 1.4, 1.2, dump);
    this.box(12, 0.7, -12, 2.2, 1.4, 1.2, dump);
    // cover walls (crouch stealth)
    const cover = this.mat(0x232b36);
    this.box(-4, 0.6, -2, 3, 1.2, 0.4, cover);
    this.box(4, 0.6, 14, 3, 1.2, 0.4, cover);
    this.box(0, 0.6, -18, 4, 1.2, 0.4, cover);
    // scaffolding for climb route on east tall building
    const scaf = this.mat(0x7a6a4a);
    this.box(12.4, 2, 14, 1.2, 4, 1.2, scaf);
    this.box(12.4, 5, 14, 1.2, 2.4, 1.2, scaf);
    this.ledges.push({
      min: new THREE.Vector3(11.8, 0, 13.4), max: new THREE.Vector3(13, 6.2, 14.6),
      topY: 6.2, kind: 'climb',
    });
  }

  private warehouse(): void {
    // enterable interior south-east: 4 walls with door gap + roof
    const wall = this.mat(0x3b3f47);
    const cx = -2; const cz = -38; // just outside north? keep inside bounds: use (0,-38)? bounds -46 ok
    void cx; void cz;
    const wx = 2; const wz = -38; const W = 12; const H = 4; const D = 8;
    // back + side walls
    this.box(wx, H / 2, wz - D / 2, W, H, 0.4, wall);
    this.box(wx - W / 2, H / 2, wz, 0.4, H, D, wall);
    this.box(wx + W / 2, H / 2, wz, 0.4, H, D, wall);
    // front wall with 3m door gap (two segments)
    this.box(wx - 4, H / 2, wz + D / 2, 4, H, 0.4, wall);
    this.box(wx + 4, H / 2, wz + D / 2, 4, H, 0.4, wall);
    this.box(wx, H + 0.15, wz, W + 0.6, 0.3, D + 0.6, this.mat(0x11161d));
    // loot crate inside
    const loot = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.4, metalness: 0.6, emissive: 0x553f00 }));
    loot.position.set(wx, 0.5, wz - 1);
    this.group.add(loot);
    this.interactables.push({ id: 'relic', pos: new THREE.Vector3(wx, 1, wz - 1), radius: 2.6, label: 'Recupera il Sigillo', kind: 'relic', taken: false, mesh: loot });
    this.ledges.push({
      min: new THREE.Vector3(wx - W / 2, 0, wz - D / 2), max: new THREE.Vector3(wx + W / 2, H, wz + D / 2),
      topY: H + 0.3, kind: 'climb',
    });
  }

  private plaza(): void {
    // fountain cover in south plaza + banners
    const stone = this.mat(0x39424e);
    this.box(0, 0.4, 22, 4, 0.8, 4, stone);
    const pole = this.mat(0x39414f);
    this.box(-6, 3, 22, 0.2, 6, 0.2, pole, false);
    this.box(6, 3, 22, 0.2, 6, 0.2, pole, false);
  }

  private patrols(): void {
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    this.patrolRoutes = [
      [V(-4, 0, -10), V(4, 0, -10), V(4, 0, -2), V(-4, 0, -2)],
      [V(5, 0, 16), V(11, 0, 16), V(11, 0, 6)],
      [V(-5, 0, 14), V(-11, 0, 8), V(-11, 0, 20)],
      [V(13, 8.8, -4), V(13, 8.8, 4)],       // rooftop guard (east E2 roof h=8.5+lip)
      [V(2, 0, -22), V(2, 0, -30)],           // villa approach
    ];
    this.spawnPoints.enemies = this.patrolRoutes;
  }

  // ---- collision helpers (allocation-free where it matters) ----
  groundHeight(x: number, z: number, out: { y: number; top: number } | null = null): number {
    // rooftops: find highest collider top containing (x,z) with vertical room
    let best = 0;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (x >= c.min.x && x <= c.max.x && z >= c.min.z && z <= c.max.z) {
        if (c.max.y > best && c.max.y < 30) best = c.max.y;
      }
    }
    if (out) { out.y = best; out.top = best; }
    return best;
  }

  /** horizontal collision resolve: push circle (x,z,r) out of boxes; returns true if hit wall */
  collideCircle(p: THREE.Vector3, r: number, height: number): boolean {
    let hit = false;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (p.y + height < c.min.y + 0.25 || p.y > c.max.y - 0.35) continue; // step over low / under high
      const cx = Math.max(c.min.x, Math.min(p.x, c.max.x));
      const cz = Math.max(c.min.z, Math.min(p.z, c.max.z));
      const dx = p.x - cx; const dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2); const push = (r - d) / d;
          p.x += dx * push; p.z += dz * push;
        } else {
          // inside: push along smallest penetration axis
          const px1 = p.x - c.min.x + r; const px2 = c.max.x - p.x + r;
          const pz1 = p.z - c.min.z + r; const pz2 = c.max.z - p.z + r;
          const m = Math.min(px1, px2, pz1, pz2);
          if (m === px1) p.x = c.min.x - r;
          else if (m === px2) p.x = c.max.x + r;
          else if (m === pz1) p.z = c.min.z - r;
          else p.z = c.max.z + r;
        }
      }
    }
    p.x = Math.max(this.bounds.min.x, Math.min(this.bounds.max.x, p.x));
    p.z = Math.max(this.bounds.min.z, Math.min(this.bounds.max.z, p.z));
    return hit;
  }

  /** line of sight blocked? uses raycaster against collider boxes (cheap: manual slab test) */
  losBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (this.segHitsBox(ax, ay, az, bx, by, bz, c)) return true;
    }
    return false;
  }

  private segHitsBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, c: THREE.Box3): boolean {
    // skip boxes entirely below both eye heights (ground slabs)
    if (c.max.y < Math.min(ay, by) - 0.1) return false;
    let tmin = 0; let tmax = 1;
    const dx = bx - ax; const dy = by - ay; const dz = bz - az;
    const mins = [c.min.x, c.min.y, c.min.z]; const maxs = [c.max.x, c.max.y, c.max.z];
    const os = [ax, ay, az]; const ds = [dx, dy, dz];
    for (let i = 0; i < 3; i++) {
      const d = ds[i];
      if (Math.abs(d) < 1e-9) { if (os[i] < mins[i] || os[i] > maxs[i]) return false; }
      else {
        let t1 = (mins[i] - os[i]) / d; let t2 = (maxs[i] - os[i]) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return false;
      }
    }
    // ignore hits very close to endpoints (standing on/inside a roof lip)
    return tmin > 0.02 && tmin < 0.98;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): THREE.Intersection<THREE.Object3D>[] {
    this.ray.set(origin, dir); this.ray.far = far;
    return this.ray.intersectObjects(this.group.children, false);
  }
}
