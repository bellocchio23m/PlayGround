// Phase-3 world/mission audits (plain node, no deps): source audits + data checks.
// Covers objectives 57-68/79-90/97-103: 8 missions, shortcuts, POIs, generators,
// breakers, caches, ledge/collider growth, spawn-in-collider approximation.
import { readFileSync } from 'node:fs';

let pass = 0; let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}

const src = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const world = src('src/world/world.ts');
const missions = src('src/missions/missions.ts');
const framework = src('src/missions/framework.ts');
const count = (s, re) => (s.match(re) || []).length;

console.log('world: shortcut gates');
ok(world.includes('shortcutGates'), 'world exports shortcutGates');
ok(count(world, /shortcutGates\.push/g) === 2, 'shortcutGates has exactly 2 entries');
ok(world.includes("'gate-west'") && world.includes("'gate-east'"), 'gate-west + gate-east ids present');
ok(count(world, /kind: 'shortcut'/g) === 2, "2 interactables with kind 'shortcut'");
ok(world.includes('from: new THREE.Vector3(-14, 6.8, -2)') || world.includes('(-14, 6.8, -2)'), 'gate-west from-coords exported');
ok(world.includes('(13, 13.3, 18)'), 'gate-east from-coords exported');

console.log('world: pois / generators / breakers');
ok(world.includes('pois:' ) || world.includes('pois =') || world.includes('pois:'), 'world exports pois');
ok(count(world, /P\('poi-/g) >= 10, `pois>=10 (found ${count(world, /P\('poi-/g)})`);
ok(world.includes('generators'), 'world exports generators');
ok(count(world, /generators\.push/g) === 1, 'generators pushed in one loop');
ok(world.includes('[35, 22.5], [-9, 25.5]') || world.includes('[35, 22.5]'), '2 generator spots (canal + plaza)');
ok(count(world, /addBreaker\('breaker-/g) === 2, '2 breaker boxes via addBreaker');
ok(world.includes("'breaker-plaza'") && world.includes("'breaker-alley'"), 'breaker ids present');
ok(count(world, /kind: 'breaker'/g) === 1, "breaker interactables use kind 'breaker' (single helper)");

console.log('world: caches / hidden areas / zones');
const cacheCalls = count(world, /\bmk\('/g) + count(world, /\baddCache\('cache-/g);
ok(cacheCalls >= 5, `caches>=5 total (found ${cacheCalls})`);
for (const id of ['cache-smoke', 'cache-knife', 'intel', 'cache-attic', 'cache-garden', 'cache-canal']) {
  ok(world.includes(`'${id}'`), `cache id present: ${id}`);
}
ok(world.includes('doc-villa'), 'doc-villa interactable present (m6 objective prop)');
ok(world.includes('northwestHeights') && world.includes('canalZone'), 'NW heights + canal micro-zones built');
ok(world.includes('marketStalls') && world.includes('Plaza del Mercato'), 'Plaza del Mercato market built');
ok(world.includes('Ciminiera') || world.includes('ciminiera') || world.includes('chimney'), 'red chimney landmark');
ok(world.includes('Torre Idrica Blu') || world.includes('0x2e6fd8'), 'blue water tower landmark');

console.log('world: ledges / colliders growth');
ok(count(world, /buildingBlock\(/g) >= 12, `buildingBlock calls grew (>=12, found ${count(world, /buildingBlock\(/g)})`);
ok(count(world, /ledges\.push/g) >= 9, `ledges.push sites grew (>=9, found ${count(world, /ledges\.push/g)})`);
const boxCount = count(world, /this\.box\(/g);
// baseline (pre-phase-3) was 42 textual box calls; growth required, cap guards runaway draw calls
ok(boxCount >= 65 && boxCount <= 400, `collider/box count sane (65-400, found ${boxCount})`);
ok(world.includes('patrolRoutes') && count(world, /patrolRoutes\.push/g) === 3, '3 extra patrol routes (indices 5-7)');
ok(world.includes('groundHeight') && world.includes('losBlocked'), 'collision/LOS helpers intact');
ok(world.includes("id: 'relic'") && world.includes('cache-smoke'), 'existing interactables intact');
ok(world.includes('-46'), 'bounds ±46 kept');

console.log('missions: 9 total, structure');
ok(count(missions, /id: 'm\d/g) === 9, 'exactly 9 missions');
for (const id of ['m1-ombra', 'm2-lama', 'm3-verticale', 'm4-sigillo', 'm5-fuga', 'm6-silenzio', 'm7-caccia', 'm8-corvo', 'm9-eco']) {
  ok(missions.includes(id), `mission present: ${id}`);
}
ok(count(missions, /objectives: \[/g) === 9, 'each mission has an objectives array');
const segs = missions.split(/id: 'm\d-/).slice(1);
ok(segs.length === 9, '9 mission segments parsed');
const validObjKinds = new Set(['reach', 'assassinate', 'collect', 'survive', 'escape', 'ghost']);
segs.forEach((s, i) => {
  const objOnly = s.split(/spawns:/)[0]; // exclude spawn kinds from objective-kind check
  const kinds = [...objOnly.matchAll(/kind: '(\w+)'/g)].map((m) => m[1]);
  ok(kinds.length >= 1 && kinds.every((k) => validObjKinds.has(k)), `m${i + 1} objectives non-empty + valid kinds`);
  ok(/start: V\(/.test(s), `m${i + 1} has start`);
});

console.log('missions: starts in bounds + not inside colliders (approx)');
const starts = [...missions.matchAll(/start:\s*V\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)]
  .map((m) => ({ x: +m[1], y: +m[2], z: +m[3] }));
ok(starts.length === 9, `9 mission starts parsed (found ${starts.length})`);
// AABB masses mirrored from world.ts buildingBlock(...) calls: (cx,cz,w,d)
const masses = [];
for (const m of world.matchAll(/buildingBlock\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g)) {
  const cx = +m[1]; const cz = +m[2]; const w = +m[3]; const d = +m[5];
  masses.push([cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2]);
}
// thin/extra masses hardcoded from world.ts box() values (canal walls, chimney)
masses.push([28.5, 29.5, -8, 24], [36.5, 37.5, -8, 24], [28.75, 31.25, -33.25, -30.75]);
starts.forEach((s, i) => {
  ok(s.x >= -46 && s.x <= 46 && s.z >= -46 && s.z <= 46, `m${i + 1} start inside bounds (${s.x},${s.z})`);
  const inside = masses.some(([x0, x1, z0, z1]) => s.x > x0 - 0.3 && s.x < x1 + 0.3 && s.z > z0 - 0.3 && s.z < z1 + 0.3);
  ok(!inside, `m${i + 1} start not inside a collider (approx)`);
});

console.log('missions: spawns / flags / narrative');
const spawns = [...missions.matchAll(/\{\s*kind:\s*'(\w+)'\s*,\s*route:\s*(\d+)\s*\}/g)];
ok(spawns.length >= 8, `spawns entries present (>=8, found ${spawns.length})`);
const validKinds = new Set(['guard', 'elite', 'captain', 'brute', 'ranger']);
const routeCount = 5 + count(world, /patrolRoutes\.push/g);
spawns.forEach(([full, k, r], i) => {
  void full;
  ok(validKinds.has(k) && +r < routeCount, `spawn #${i} valid kind+route (${k}, route ${r})`);
});
ok(missions.includes("setFlag: 'blackout-plaza'"), "m6 setFlag 'blackout-plaza'");
ok(missions.includes("setFlag: 'corvo-dead'"), "m8 setFlag 'corvo-dead'");
ok(count(missions, /narrative:/g) >= 4, 'narrative on m6/m7/m8/m9');
ok(missions.includes('ghostBonusXp'), 'm6 ghost bonus field used');
ok(missions.includes("target: 'target'"), 'assassinate missions reference target tag');
ok(missions.includes('ranger') && missions.includes("'m7-caccia'"), 'm7 runner = ranger kind');
ok(missions.includes('captain') && missions.includes("'m8-corvo'"), 'm8 boss = captain kind');
ok(missions.includes('doc-villa'), 'm6 collect target doc-villa');
ok(count(missions, /failOnDeath: true/g) === 9, 'failOnDeath on all 9 missions');

console.log('framework: additive optional fields');
for (const tok of ['spawns?', 'setFlag?', 'narrative?', 'ghostBonusXp?']) {
  ok(framework.includes(tok), `framework has optional field ${tok}`);
}
ok(framework.includes('advanceObjective') && framework.includes('startMission'), 'framework behavior intact');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
