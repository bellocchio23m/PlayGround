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
  /** PHASE-3 (level-design): unlockable shortcut gates.
   *  CENTRAL CONTRACT (game.ts): each interactable with kind 'shortcut' (ids below) resolves as:
   *  on interact -> `taken=true`, hide/rotate its prop mesh (visible change), then add a runtime
   *  walkable link: `ledges.push({min:from-ish, max:to-ish, topY, kind:'vault'})` + a thin collider
   *  slab from `from` to `to` at `topY` so `groundHeight()` stays consistent. Coordinates below are
   *  the EXACT endpoints central must use (top surface heights included in `from.y`/`to.y`).
   *  - 'gate-west': raised plank at W2 east edge; drops a bridge W2 roof -> villa roof parapet.
   *  - 'gate-east': chained ladder on E3 west face; drops a climb-down E3 roof -> east alley. */
  shortcutGates: Array<{ id: string; from: THREE.Vector3; to: THREE.Vector3; topY: number }> = [];
  /** PHASE-3: points of interest for central UI ("nearest POI hint"). Read-only data. */
  pois: Array<{ id: string; label: string; pos: THREE.Vector3; hint: string }> = [];
  /** PHASE-3: noisy generator props. CENTRAL CONTRACT: central masks/attenuates player-generated
   *  NoiseEvents whose source is within ~9m of any entry (sneaking near a generator is safer). */
  generators: THREE.Vector3[] = [];
  private ray = new THREE.Raycaster();
  /** PRODUCTION material library: flat-shaded, zero textures, 1 shader family.
   *  TEMPORARY placeholders (to replace with skinned/textured assets later):
   *  character rigs, window light planes, neon sign planes. */
  matLib!: Record<string, THREE.MeshStandardMaterial>;

  constructor(private scene: THREE.Scene) {}

  build(): void {
    this.materials();
    this.ground();
    this.lighting();
    this.buildings();
    this.alleyProps();
    this.streetProps();
    this.signs();
    this.courtyard();
    this.rooftopDetails();
    this.dropPlatform();
    this.caches();
    this.warehouse();
    this.plaza();
    this.patrols();
    // ---- phase-3 micro-zones / landmarks / shortcuts (additive, own section) ----
    this.northwestHeights();
    this.canalZone();
    this.marketStalls();
    this.caldaieProps();
    this.distantLandmarks();
    this.shortcutProps();
    this.hiddenAreas();
    this.breakersAndGenerators();
    this.extraPatrols();
    this.poisInit();
    this.scene.add(this.group);
  }

  /** distinguishable surfaces: asphalt, concrete, metal, wood, glass, brick */
  private materials(): void {
    const m = (color: number, rough = 0.9, metal = 0.05, emissive = 0): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive });
    this.matLib = {
      asphalt: m(0x14171d, 1),
      concrete: m(0x3a414c, 0.95),
      metal: m(0x4b5563, 0.45, 0.7),
      rustMetal: m(0x5a4030, 0.7, 0.4),
      wood: m(0x6b4f2e, 0.85),
      crateWood: m(0x5b4632, 0.9),
      brickA: m(0x3a2f2b, 0.95),
      brickB: m(0x33302e, 0.95),
      wallC: m(0x2e3138, 0.95),
      tarp: m(0x274035, 0.8),
      stone: m(0x39424e, 0.9),
      glass: new THREE.MeshStandardMaterial({ color: 0x8fb4ff, roughness: 0.15, metalness: 0.8, emissive: 0x1a2733 }),
    };
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
    const crate = this.matLib.crateWood; const dump = this.matLib.tarp;
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
    const cover = this.matLib.concrete;
    this.box(-4, 0.6, -2, 3, 1.2, 0.4, cover);
    this.box(4, 0.6, 14, 3, 1.2, 0.4, cover);
    this.box(0, 0.6, -18, 4, 1.2, 0.4, cover);
    // scaffolding for climb route on east tall building
    const scaf = this.matLib.wood;
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
    const stone = this.matLib.stone;
    this.box(0, 0.4, 22, 4, 0.8, 4, stone);
    const pole = this.mat(0x39414f);
    this.box(-6, 3, 22, 0.2, 6, 0.2, pole, false);
    this.box(6, 3, 22, 0.2, 6, 0.2, pole, false);
  }

  /** street furniture: barriers, bollards, manholes, hydrant — orientation + cover */
  private streetProps(): void {
    const M = this.matLib;
    // traffic barriers (low cover along roads)
    for (const [x, z, rot] of [[-5, 2, 0], [5, -6, 0], [-5, -14, 0], [5, 24, 0]] as Array<[number, number, number]>) {
      void rot;
      this.box(x, 0.5, z, 2.4, 1.0, 0.35, M.concrete);
      this.box(x, 1.05, z, 2.4, 0.12, 0.4, M.rustMetal, false);
    }
    // bollards (wayfinding dots, no collision cost issue: small, few)
    for (const x of [-7, -5, 5, 7]) {
      this.box(x, 0.45, 30, 0.3, 0.9, 0.3, M.metal);
      this.box(x, 0.45, -16, 0.3, 0.9, 0.3, M.metal);
    }
    // manholes (flat, atmosphere only)
    const mh = M.rustMetal;
    for (const [x, z] of [[-2, 4], [3, -12], [-3, 18]] as Array<[number, number]>) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 12), mh);
      disc.position.set(x, 0.04, z);
      this.group.add(disc);
    }
    // hydrant (landmark near plaza)
    this.box(-7.5, 0.5, 24, 0.5, 1.0, 0.5, M.rustMetal);
  }

  /** neon signs: emissive planes (TEMPORARY placeholder for texture-atlas signs).
   *  Each is a gameplay landmark: colors orient the player at night. */
  private signs(): void {
    const sign = (x: number, y: number, z: number, w: number, h: number, color: number, ry: number): void => {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color }));
      s.position.set(x, y, z); s.rotation.y = ry;
      this.group.add(s);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.12), this.matLib.metal);
      back.position.set(x, y, z); back.rotation.y = ry;
      back.translateZ(-0.08);
      this.group.add(back);
    };
    sign(-13.9, 3.4, -14, 3.2, 0.9, 0xff2e88, Math.PI / 2);   // west pink "bar" — alley route marker
    sign(13.1, 4.2, 0, 3.6, 1.0, 0x27e0ff, -Math.PI / 2);      // east cyan — climb route marker
    sign(0, 5.4, -24.9, 4.2, 1.0, 0xffb45e, 0);               // north amber — villa/warehouse heading
    sign(-8, 2.6, 27.9, 2.6, 0.8, 0x7dff9e, Math.PI);          // south green — extraction heading
  }

  /** courtyard life: tables, benches, clotheslines (cover + atmosphere) */
  private courtyard(): void {
    const M = this.matLib;
    // café tables + benches near fountain
    for (const [x, z] of [[-4, 24], [4, 20]] as Array<[number, number]>) {
      this.box(x, 0.45, z, 1.1, 0.1, 1.1, M.wood);
      this.box(x, 0.2, z, 0.14, 0.4, 0.14, M.metal);
      this.box(x - 1.1, 0.25, z, 1.2, 0.12, 0.4, M.wood);
      this.box(x + 1.1, 0.25, z + 0.4, 1.2, 0.12, 0.4, M.wood);
    }
    // clotheslines between poles (visual rhythm, no collision)
    const line = new THREE.MeshBasicMaterial({ color: 0x8fa3c1 });
    for (const [x1, z1, x2, z2] of [[-8, 18, -2, 18], [2, 26, 8, 26]] as Array<[number, number, number, number]>) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const rope = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.03), line);
      rope.position.set((x1 + x2) / 2, 3.2, (z1 + z2) / 2);
      rope.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      this.group.add(rope);
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        const shirt = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.6),
          new THREE.MeshBasicMaterial({ color: [0xc96a6a, 0x6a8fc9, 0x9fc96a][i - 1], side: THREE.DoubleSide }));
        shirt.position.set(x1 + (x2 - x1) * t, 2.85, z1 + (z2 - z1) * t);
        shirt.rotation.y = rope.rotation.y;
        this.group.add(shirt);
      }
    }
  }

  /** rooftop readability: antennas, tank, vents — parkour landmarks */
  private rooftopDetails(): void {
    const M = this.matLib;
    // antenna on east tall roof (highest point = orientation landmark)
    this.box(20, 14.6, 18, 0.25, 3.2, 0.25, M.metal);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
    tip.position.set(20, 16.3, 18); this.group.add(tip);
    // water tank on north villa roof
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 10), M.wood);
    tank.position.set(-4, 8.9, -30); this.group.add(tank);
    this.colliders.push(new THREE.Box3(new THREE.Vector3(-5.3, 7.8, -31.3), new THREE.Vector3(-2.7, 10, -28.7)));
    // vents on west roofs (stepping + silhouette)
    this.box(-20, 7.2, 2, 1.0, 1.4, 1.0, M.metal);
    this.box(-20, 4.9, -14, 1.0, 1.4, 1.0, M.metal);
  }

  /** m2 second approach: crate stair -> drop-kill platform over the plaza patrol */
  private dropPlatform(): void {
    const M = this.matLib;
    this.box(7.5, 0.5, 20, 1.4, 1.0, 1.4, M.crateWood);
    this.box(7.5, 1.5, 19.2, 1.2, 1.0, 1.2, M.crateWood);
    this.box(7.5, 2.2, 19.6, 1.8, 0.4, 1.8, M.wood);
    this.ledges.push({
      min: new THREE.Vector3(6.6, 0, 18.7), max: new THREE.Vector3(8.4, 2.4, 20.5),
      topY: 2.4, kind: 'vault',
    });
  }

  /** exploration rewards: smoke / knife caches + intel (+XP). Real gameplay value. */
  private caches(): void {
    const mk = (id: string, label: string, x: number, y: number, z: number, color: number): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3, emissive: color, emissiveIntensity: 0.35 }));
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      this.interactables.push({ id, pos: new THREE.Vector3(x, y, z), radius: 3, label, kind: 'cache', taken: false, mesh });
    };
    mk('cache-smoke', 'Fumogeni +2', -20, 7.3, 2, 0x9aa7bd);   // west roof W2
    mk('cache-knife', 'Coltelli +2', 12.5, 0.6, -12, 0xc9a227); // east alley
    mk('intel', 'Informazioni (+60 XP)', 0, 1.2, 22, 0x7dff9e); // fountain
  }

  // ================= PHASE-3 LEVEL DESIGN (additive) =================
  // ALTERNATE PATHS ledger (5+ approaches, ground + roof + alley each):
  //  P1 plaza (m2/m8): (a) ground tra tavoli/stalli/bancarelle, (b) drop dalla piattaforma casse est (dropPlatform),
  //     (c) tetti E2->E3 + scala gate-east, (d) vicolo caldaie -> breaker-alley -> uscita sud canale.
  //  P2 east roof doc (m3): (a) ponteggi sud-est (scaffold ledge), (b) casse vicolo est, (c) E2->E3 plank,
  //     (d) NUOVO: canale -> pipe climb -> muro ovest canale -> salto tetto E2.
  //  P3 warehouse/Sigillo (m4): (a) porta frontale nord, (b) tetto villa -> drop, (c) vicolo ovest -> cortile,
  //     (d) NUOVO: soppalco interno (attic) come osservatorio prima del colpo.
  //  P4 extraction south (m4/m5/m6/m7): (a) strada centrale, (b) tetti ovest W3 -> drop, (c) vicolo est,
  //     (d) NUOVO: canale uscita sud (33,24) -> tags across plaza.
  //  P5 north villa doc (m6): (a) terra via cortile, (b) tetti ovest -> NUOVO gate-west bridge, (c) Tetti Alti
  //     NW -> viewpoint drop verso villa, (d) canale -> tetti est -> villa da est.
  //  P6 NW heights garden/attic caches: (a) catena W1->plankW->NW1->NW2->NW3, (b) drop da NW3, (c) alley ovest.
  //
  // MICRO-ZONES: (a) Plaza del Mercato (cortile sud + stalli), (b) Vicolo delle Caldaie (canale est
  //  x~33 z[-8,24], pareti alte = corridoio stealth, pipe per uscire), (c) Tetti Alti Nord-Ovest
  //  (3 tetti 6/9/12m + planks + viewpoint). Landmark a distanza: antenna est (esistente), ciminiera
  //  rossa (30,-32), torre idrica BLU sui Tetti Alti.

  /** shared cache spawner (phase-3). CENTRAL CONTRACT (game.ts tryInteract): mirror the existing
   *  cache handling for these NEW ids (all kind 'cache', taken=false initially):
   *  - 'cache-attic'  -> knives+2 (cap 8), toast 'Coltelli +2 (soppalco)'
   *  - 'cache-garden' -> smoke+2 (cap 6), toast 'Fumogeni +2 (giardino pensile)'
   *  - 'cache-canal'  -> +60 XP via addXp (same as 'intel'), toast 'Intel +60 XP' */
  private addCache(id: string, label: string, x: number, y: number, z: number, color: number): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.5),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3, emissive: color, emissiveIntensity: 0.35 }));
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.interactables.push({ id, pos: new THREE.Vector3(x, y, z), radius: 3, label, kind: 'cache', taken: false, mesh });
  }

  /** breaker-box prop (phase-3). CENTRAL CONTRACT: on interact (kind 'breaker') -> taken=true, dim the
   *  prop emissive strip (mesh visible change), and switch OFF lamps within 20m. 'blackout-plaza'
   *  (m6 setFlag) = plaza lamps off from mission start. Breakers do NOT cut moon/hemi light. */
  private addBreaker(id: string, label: string, x: number, y: number, z: number): void {
    const boxM = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.3), this.matLib.metal);
    boxM.position.set(x, y, z);
    this.group.add(boxM);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x7dff9e }));
    strip.position.set(x, y + 0.25, z + 0.16);
    this.group.add(strip);
    this.colliders.push(new THREE.Box3(
      new THREE.Vector3(x - 0.3, y - 0.45, z - 0.15), new THREE.Vector3(x + 0.3, y + 0.45, z + 0.15)));
    this.interactables.push({ id, pos: new THREE.Vector3(x, y, z), radius: 3, label, kind: 'breaker', taken: false, mesh: strip });
  }

  /** NORTH-WEST heights micro-zone: 3 stepped rooftops 6/9/12m linked by planks, fed from west row. */
  private northwestHeights(): void {
    // climb chain: W1 roof (top 4.5) -> plankW -> NW1 (6.3) -> plankA -> NW2 (9.3) -> plankB -> NW3 (12.3)
    this.buildingBlock(-34, -14, 8, 6, 8, 0x35302e);    // NW1, top 6.3
    this.buildingBlock(-34, -24, 8, 9, 8, 0x2f333c);    // NW2, top 9.3 (garden + blue tower)
    this.buildingBlock(-34, -34, 8, 12, 8, 0x38322c);   // NW3, top 12.3 (viewpoint)
    const plank = this.matLib.wood;
    this.box(-28, 5.0, -14, 5, 0.25, 1.4, plank);       // plankW: W1(x>=-26) -> NW1(x<=-30)
    this.box(-34, 7.5, -19, 1.4, 0.25, 4.5, plank);     // plankA over the z -20..-18 gap, top ~7.6
    this.box(-34, 10.5, -29, 1.4, 0.25, 4.5, plank);    // plankB over the z -30..-28 gap, top ~10.6
    this.ledges.push({
      min: new THREE.Vector3(-30.5, 0, -14.7), max: new THREE.Vector3(-25.5, 5.2, -13.3),
      topY: 5.2, kind: 'vault',
    });
    this.ledges.push({
      min: new THREE.Vector3(-34.7, 0, -21.2), max: new THREE.Vector3(-33.3, 7.7, -16.8),
      topY: 7.7, kind: 'vault',
    });
    this.ledges.push({
      min: new THREE.Vector3(-34.7, 0, -31.2), max: new THREE.Vector3(-33.3, 10.7, -26.8),
      topY: 10.7, kind: 'climb',
    });
    // cover crates on NW roofs (crouch stealth up high)
    const crate = this.matLib.crateWood;
    this.box(-36, 6.9, -12, 1.2, 1.2, 1.2, crate);
    this.box(-32, 9.9, -26, 1.2, 1.2, 1.2, crate);
  }

  /** EASTERN canal/alley micro-zone (Vicolo delle Caldaie): walled stealth corridor + pipe climbs. */
  private canalZone(): void {
    const wall = this.mat(0x2b2f36);
    this.box(29, 2.5, 8, 1, 5, 32, wall);               // west wall x[28.5,29.5] z[-8,24], top 5.0
    this.box(37, 2.5, 8, 1, 5, 32, wall);               // east wall x[36.5,37.5], top 5.0
    const floorM = this.mat(0x10141a);
    this.box(33, 0.03, 8, 7, 0.06, 32, floorM, false);  // dark service-lane floor (visual only)
    // pipes to climb out (visual cylinders, no collision) + climb ledges on inner faces
    const pipeM = this.matLib.rustMetal;
    for (const x of [29.7, 36.3]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 30, 8), pipeM);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(x, 2.6, 8);
      this.group.add(pipe);
    }
    this.ledges.push({
      min: new THREE.Vector3(28.5, 0, 0), max: new THREE.Vector3(29.5, 5.0, 16),
      topY: 5.0, kind: 'climb',
    });
    this.ledges.push({
      min: new THREE.Vector3(36.5, 0, 0), max: new THREE.Vector3(37.5, 5.0, 16),
      topY: 5.0, kind: 'climb',
    });
    // steam vents: VISUAL ONLY (no gameplay effect, no collision, no light)
    const steamM = new THREE.MeshBasicMaterial({ color: 0xaab4c4, transparent: true, opacity: 0.45 });
    for (const [x, z] of [[31, -2], [35, 10], [32, 20]] as Array<[number, number]>) {
      const puff = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 8), steamM);
      puff.position.set(x, 0.6, z);
      this.group.add(puff);
    }
    this.addCache('cache-canal', 'Intel del canale (+60 XP)', 33, 0.6, 21.5, 0x7dff9e);
  }

  /** Plaza del Mercato: market stalls with striped awnings + crate maze (stealth cover). */
  private marketStalls(): void {
    const M = this.matLib;
    const stalls: Array<[number, number, number]> = [[-4, 0, 19], [0, 0, 27.5], [5.5, 0, 23]];
    // striped awnings via 2 shared InstancedMesh (red / cream) = 2 draw calls for all stripes
    const stripeGeo = new THREE.BoxGeometry(0.55, 0.06, 2.4);
    const redM = new THREE.MeshStandardMaterial({ color: 0x8c2f39, roughness: 0.85 });
    const creamM = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.85 });
    const red = new THREE.InstancedMesh(stripeGeo, redM, 6);
    const cream = new THREE.InstancedMesh(stripeGeo, creamM, 6);
    const m4 = new THREE.Matrix4();
    let ri = 0; let ci = 0;
    for (const [sx, , sz] of stalls) {
      this.box(sx, 0.5, sz, 2.2, 1.0, 1.2, M.crateWood);           // counter (cover)
      this.box(sx - 1.0, 1.3, sz - 0.5, 0.12, 2.6, 0.12, M.wood, false); // poles (no collide)
      this.box(sx + 1.0, 1.3, sz + 0.5, 0.12, 2.6, 0.12, M.wood, false);
      for (let s = 0; s < 4; s++) {
        m4.makeTranslation(sx - 0.825 + s * 0.55, 2.6, sz);
        if (s % 2 === 0) red.setMatrixAt(ri++, m4); else cream.setMatrixAt(ci++, m4);
      }
    }
    red.count = ri; cream.count = ci;
    red.instanceMatrix.needsUpdate = true; cream.instanceMatrix.needsUpdate = true;
    this.group.add(red); this.group.add(cream);
    // crate maze: slalom cover around the fountain (keeps LOS broken vs plaza patrols)
    const maze: Array<[number, number, number, number]> = [
      [-8, 0.6, 20, 1.2], [-6.5, 0.5, 22, 1], [-5, 0.6, 20, 1.2], [-3.5, 0.5, 22.5, 1],
      [7, 0.5, 21, 1], [8.5, 0.5, 23, 1], [7, 0.6, 25, 1.2], [2, 0.5, 28.5, 1],
    ];
    for (const [x, y, z, s] of maze) this.box(x, y, z, s, s, s, M.crateWood);
  }

  /** Vicolo delle Caldaie dressing: wall pipes + breaker/steam already in canalZone; generator added below. */
  private caldaieProps(): void {
    // vertical boiler pipes on the canal west wall outer face (visual rhythm, no collision)
    const pipeM = this.matLib.metal;
    for (const z of [-4, 4, 12, 20]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 5, 8), pipeM);
      p.position.set(28.2, 2.5, z);
      this.group.add(p);
    }
    // crates at canal mouths (step + cover, do not seal the entrances)
    const crate = this.matLib.crateWood;
    this.box(31, 0.5, -6.5, 1, 1, 1, crate);
    this.box(35, 0.5, 22.5, 1, 1, 1, crate);
  }

  /** long-range landmarks: red chimney (east-north) + blue water tower + 2nd antenna (NW heights). */
  private distantLandmarks(): void {
    // red chimney: readable from anywhere south/west
    this.box(30, 6, -32, 2.5, 12, 2.5, this.mat(0x5a2e26));
    this.box(30, 12.4, -32, 3.2, 0.8, 3.2, this.mat(0x8c2f39), false); // red cap (visual)
    // blue water tower on NW2 roof (top 9.3): legs + tank, landmark + cover
    const blue = this.mat(0x2e6fd8, 0.6, 0);
    this.box(-34, 9.9, -24, 2.6, 1.2, 2.6, this.matLib.wood);          // tower base (cover)
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 2.2, 12), blue);
    tank.position.set(-34, 11.6, -24);
    this.group.add(tank);
    this.colliders.push(new THREE.Box3(
      new THREE.Vector3(-35.5, 10.5, -25.5), new THREE.Vector3(-32.5, 12.7, -22.5)));
    // second antenna on NW3 (tallest point north-west, pairs with east antenna)
    this.box(-34, 13.8, -34, 0.25, 3.0, 0.25, this.matLib.metal);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3b3b }));
    tip.position.set(-34, 15.4, -34);
    this.group.add(tip);
    // viewpoint railing on NW3 south edge (visual only)
    const rail = this.matLib.metal;
    this.box(-34, 12.9, -30.2, 4, 0.12, 0.12, rail, false);
  }

  /** unlockable shortcut props. See `shortcutGates` field contract for central runtime behavior. */
  private shortcutProps(): void {
    const wood = this.matLib.wood;
    // gate-west: RAISED plank at W2 east edge (visually up = locked); drops W2 roof -> villa parapet.
    const raised = this.box(-13.5, 8.2, -2, 0.25, 3.2, 1.4, wood);
    this.box(-13.5, 6.9, -2.8, 0.2, 1.2, 0.2, wood);
    this.box(-13.5, 6.9, -1.2, 0.2, 1.2, 0.2, wood);
    this.interactables.push({
      id: 'gate-west', pos: new THREE.Vector3(-13.5, 7, -2), radius: 3.2,
      label: 'Abbatti la passerella (scorciatoia ovest)', kind: 'shortcut', taken: false, mesh: raised,
    });
    this.shortcutGates.push({
      id: 'gate-west',
      from: new THREE.Vector3(-14, 6.8, -2),   // W2 roof east edge (top surface)
      to: new THREE.Vector3(-11, 7.8, -25),    // villa roof NW parapet (top surface)
      topY: 7.3,                               // central builds the runtime slab at this height
    });
    // future-walkway pylons (visual only until the gate opens; no collision)
    const pyl = this.matLib.metal;
    for (const [px, pz] of [[-13.25, -7.75], [-12.5, -13.5], [-11.75, -19.25]] as Array<[number, number]>) {
      this.box(px, 3.5, pz, 0.3, 7, 0.3, pyl, false);
    }
    // gate-east: CHAINED ladder on E3 west face (visually chained = locked); drops E3 roof -> alley.
    const railM = this.matLib.metal;
    this.box(12.85, 6.5, 17.4, 0.18, 13, 0.18, railM);
    this.box(12.85, 6.5, 18.6, 0.18, 13, 0.18, railM);
    for (let i = 0; i < 5; i++) this.box(12.85, 1.5 + i * 2.6, 18, 0.14, 0.14, 1.3, railM);
    const chain = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.4, metalness: 0.7 }));
    chain.position.set(12.85, 2.0, 18);
    this.group.add(chain);
    this.interactables.push({
      id: 'gate-east', pos: new THREE.Vector3(12.6, 1.5, 18), radius: 3.2,
      label: 'Sgancia la scala (scorciatoia est)', kind: 'shortcut', taken: false, mesh: chain,
    });
    this.shortcutGates.push({
      id: 'gate-east',
      from: new THREE.Vector3(13, 13.3, 18),   // E3 roof west lip (top surface)
      to: new THREE.Vector3(12.4, 0, 14),      // alley floor by the scaffolding
      topY: 13.3,                              // central builds the runtime climb ledge to this height
    });
    // m6 objective prop: villa ledger on the north villa roof (top 7.8).
    // CENTRAL CONTRACT: kind 'doc', id 'doc-villa'. tryInteract: taken=true + mesh hidden,
    // save.inventory.doc=true, and matches collect objective target 'doc-villa' (like 'doc').
    const ledger = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.45),
      new THREE.MeshStandardMaterial({ color: 0xf1fa8c, roughness: 0.5, emissive: 0x554f00, emissiveIntensity: 0.6 }));
    ledger.position.set(4, 8.0, -30);
    this.group.add(ledger);
    this.interactables.push({
      id: 'doc-villa', pos: new THREE.Vector3(4, 8.0, -30), radius: 3,
      label: 'Prendi il libro mastro', kind: 'doc', taken: false, mesh: ledger,
    });
  }

  /** two hidden useful areas: warehouse attic loft + NW rooftop garden. */
  private hiddenAreas(): void {
    const crate = this.matLib.crateWood;
    // warehouse attic: crate stair inside the warehouse -> loft slab (observatory + cache)
    this.box(0, 0.5, -36.8, 1, 1, 1, crate);
    this.box(1.2, 1.4, -38.2, 0.9, 0.9, 0.9, crate);
    this.box(2.6, 2.3, -39.2, 0.8, 0.8, 0.8, crate);
    this.box(5, 3.2, -40.5, 5, 0.3, 3, this.matLib.wood);   // loft slab, top 3.35
    this.ledges.push({
      min: new THREE.Vector3(2.5, 0, -42), max: new THREE.Vector3(7.5, 3.35, -39),
      topY: 3.35, kind: 'vault',
    });
    this.addCache('cache-attic', 'Coltelli +2 (soppalco)', 5, 3.85, -40.5, 0xc9a227);
    // rooftop garden on NW2 (top 9.3): planters + green blobs (visual) + cache
    const soil = this.mat(0x2a2118);
    this.box(-35.5, 9.55, -22, 1.6, 0.5, 0.8, soil);
    this.box(-32.5, 9.55, -26, 1.6, 0.5, 0.8, soil);
    const leaf = new THREE.MeshBasicMaterial({ color: 0x4d8c4a });
    for (const [x, z] of [[-35.5, -22], [-32.5, -26]] as Array<[number, number]>) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), leaf);
      bush.position.set(x, 10.1, z);
      this.group.add(bush);
    }
    this.addCache('cache-garden', 'Fumogeni +2 (giardino pensile)', -33, 9.9, -25, 0x9aa7bd);
  }

  /** breaker boxes + noisy generators. See addBreaker / generators contracts. */
  private breakersAndGenerators(): void {
    this.addBreaker('breaker-plaza', 'Sabota il quadro (piazza)', -8.5, 1.2, 20);
    this.addBreaker('breaker-alley', 'Sabota il quadro (canale)', 29.8, 1.2, 8);
    // noisy generator props (visual only meshes; noise-masking resolved by central via `generators`)
    const genM = this.matLib.rustMetal;
    const lampM = new THREE.MeshBasicMaterial({ color: 0xffb45e });
    for (const [gx, gz] of [[35, 22.5], [-9, 25.5]] as Array<[number, number]>) {
      this.box(gx, 0.5, gz, 1.4, 1.0, 0.9, genM);
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.0, 8), this.matLib.metal);
      drum.position.set(gx + 0.4, 1.3, gz);
      this.group.add(drum);
      const pilot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), lampM);
      pilot.position.set(gx - 0.4, 0.8, gz + 0.46);
      this.group.add(pilot);
      this.generators.push(new THREE.Vector3(gx, 0.5, gz));
    }
  }

  /** extra patrol routes (indices 5-7; routes 0-4 above stay byte-identical for old missions). */
  private extraPatrols(): void {
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    // ROUTE 5: NW ground loop (heights overlook watch)
    this.patrolRoutes.push([V(-30, 0, -10), V(-28, 0, -22), V(-30, 0, -34)]);
    // ROUTE 6: canal loop (Vicolo delle Caldaie)
    this.patrolRoutes.push([V(33, 0, -4), V(33, 0, 10), V(33, 0, 20)]);
    // ROUTE 7: market/plaza loop (m7 chase + m8 boss arena)
    this.patrolRoutes.push([V(-6, 0, 18), V(6, 0, 18), V(6, 0, 26), V(-6, 0, 26)]);
  }

  /** 10+ POIs for central UI hints (viewpoints, shortcuts, caches, breakers, generators, extraction). */
  private poisInit(): void {
    const P = (id: string, label: string, x: number, y: number, z: number, hint: string): void => {
      this.pois.push({ id, label, pos: new THREE.Vector3(x, y, z), hint });
    };
    P('poi-view-nw', 'Belvedere Tetti Alti', -34, 12.3, -34, 'Il punto piu alto a nord-ovest: osserva villa e piazza.');
    P('poi-antenna-e', 'Antenna Est', 20, 16.3, 18, 'Landmark orientale: il tetto E3 e sotto.');
    P('poi-chimney', 'Ciminiera Rossa', 30, 12, -32, 'Landmark nord-est: segna il canale e il magazzino.');
    P('poi-tower', 'Torre Idrica Blu', -34, 11.6, -24, 'Landmark nord-ovest sopra il giardino pensile.');
    P('poi-mercato', 'Plaza del Mercato', 0, 1, 22, 'Copertura tra stalli e casse; generatore e quadro vicini.');
    P('poi-canale', 'Vicolo delle Caldaie', 33, 0.5, 8, 'Corridoio stealth: tubi per salire sui muri, cache a sud.');
    P('poi-gate-west', 'Passerella Ovest', -13.5, 7, -2, 'Scorciatoia sbloccabile: tetto W2 -> villa.');
    P('poi-gate-east', 'Scala Est', 12.6, 6, 18, 'Scorciatoia sbloccabile: tetto E3 -> vicolo.');
    P('poi-cache-attic', 'Soppalco Magazzino', 5, 3.8, -40.5, 'Cache nascosta sopra il magazzino: scala di casse interna.');
    P('poi-cache-garden', 'Giardino Pensile', -33, 9.9, -25, 'Cache sui Tetti Alti: sali da W1 con le passerelle.');
    P('poi-breaker-plaza', 'Quadro Piazza', -8.5, 1.2, 20, 'Sabotalo per spegnere i lampioni della piazza.');
    P('poi-breaker-alley', 'Quadro Canale', 29.8, 1.2, 8, 'Sabotalo per buio nel vicolo est.');
    P('poi-gen-plaza', 'Generatore Piazza', -9, 0.5, 25.5, 'Frastuono: copre i tuoi rumori se resti vicino.');
    P('poi-gen-alley', 'Generatore Canale', 35, 0.5, 22.5, 'Frastuono: copre i tuoi rumori se resti vicino.');
    P('poi-extract-sud', 'Estrazione Sud', 0, 0, 34, 'Punto di estrazione: semina i nemici prima di sparire.');
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

  /** line of sight blocked? uses raycaster against collider boxes (cheap: manual slab test).
   *  maxTopY: boxes entirely below this height are ignored (leaning over cover). */
  losBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number, maxTopY = Infinity): boolean {
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (c.max.y < maxTopY) continue;
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
