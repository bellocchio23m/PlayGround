// Phase-3b level-design audit (plain node, no deps): source audits for crawl
// passages P7/P8, hide spots, extra caches/POIs, m9-eco, approachA/B, new upgrades.
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
const progression = src('src/progression/progression.ts');
const count = (s, re) => (s.match(re) || []).length;

console.log('missions: 9 total, ids unique');
ok(count(missions, /id: 'm\d/g) === 9, 'exactly 9 missions (m1-m8 + m9)');
for (const id of ['m1-ombra', 'm2-lama', 'm3-verticale', 'm4-sigillo', 'm5-fuga', 'm6-silenzio', 'm7-caccia', 'm8-corvo', 'm9-eco']) {
  ok(missions.includes(id), `mission present: ${id}`);
}
const midMatches = [...missions.matchAll(/id: '(m\d[^']*)'/g)].map((m) => m[1]);
ok(midMatches.length === 9 && new Set(midMatches).size === 9, `mission ids unique (${midMatches.length} parsed)`);

console.log('missions: m1-m8 objectives intact (ids unchanged)');
for (const oid of ['reach-alley', 'reach-court', 'kill-lt', 'escape-m2', 'climb-roof', 'take-doc',
  'enter-warehouse', 'take-relic', 'exfil', 'survive', 'escape-final', 'reach-villa',
  'take-ledger', 'exfil-quiet', 'kill-runner', 'hold-on', 'escape-hunt', 'kill-corvo', 'escape-corvo']) {
  ok(missions.includes(`id: '${oid}'`), `objective intact: ${oid}`);
}

console.log('missions: m9-eco structure');
ok(missions.includes("target: 'intel-eco-1'"), 'm9 collect target intel-eco-1');
ok(missions.includes("target: 'intel-eco-2'"), 'm9 collect target intel-eco-2');
ok(missions.includes("id: 'eco-exfil'"), 'm9 escape objective eco-exfil');
ok(/id: 'm9-eco'[\s\S]*?kind: 'collect'/.test(missions), 'm9 has collect objectives');
ok(/id: 'm9-eco'[\s\S]*?kind: 'escape'/.test(missions), 'm9 has escape objective');
ok(/id: 'm9-eco'[\s\S]*?failOnDeath: true/.test(missions), 'm9 failOnDeath');
ok(/id: 'm9-eco'[\s\S]*?narrative:/.test(missions), 'm9 narrative closure');

console.log('missions: starts in bounds + not inside colliders (approx)');
const starts = [...missions.matchAll(/start:\s*V\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)]
  .map((m) => ({ x: +m[1], y: +m[2], z: +m[3] }));
ok(starts.length === 9, `9 mission starts parsed (found ${starts.length})`);
const masses = [];
for (const m of world.matchAll(/buildingBlock\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/g)) {
  const cx = +m[1]; const cz = +m[2]; const w = +m[3]; const d = +m[5];
  masses.push([cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2]);
}
masses.push([28.5, 29.5, -8, 24], [36.5, 37.5, -8, 24], [28.75, 31.25, -33.25, -30.75]);
// phase-3b cheek walls / hide props (thin AABBs)
masses.push([-13.7, -8.3, 6.7, 7.1], [-13.7, -8.3, 8.9, 9.3]);
masses.push([31.7, 32.1, 23.8, 29.2], [33.9, 34.3, 23.8, 29.2]);
masses.push([-10.5, -8.5, 16.4, 17.6], [-8.7, -7.3, -21.45, -20.55]);
starts.forEach((s, i) => {
  ok(s.x >= -46 && s.x <= 46 && s.z >= -46 && s.z <= 46, `m${i + 1} start inside bounds (${s.x},${s.z})`);
  const inside = masses.some(([x0, x1, z0, z1]) => s.x > x0 - 0.3 && s.x < x1 + 0.3 && s.z > z0 - 0.3 && s.z < z1 + 0.3);
  ok(!inside, `m${i + 1} start not inside a collider (approx)`);
});

console.log('missions: spawns valid kinds/routes');
const spawns = [...missions.matchAll(/\{\s*kind:\s*'(\w+)'\s*,\s*route:\s*(\d+)\s*\}/g)];
ok(spawns.length >= 10, `spawn entries present (>=10, found ${spawns.length})`);
const validKinds = new Set(['guard', 'elite', 'captain', 'brute', 'ranger']);
const routeCount = 5 + count(world, /patrolRoutes\.push/g);
ok(routeCount === 8, `8 patrol routes total (found ${routeCount})`);
ok(spawns.every(([, k, r]) => validKinds.has(k) && +r < routeCount), 'all spawns valid kind+route');
ok(/id: 'm9-eco'[\s\S]*?route: 7/.test(missions), 'm9 uses a valid route');

console.log('missions: approachA/B');
ok(framework.includes('approachA?') && framework.includes('approachB?'), 'framework has optional approachA/approachB');
for (const id of ['m6-silenzio', 'm7-caccia', 'm8-corvo']) {
  const seg = missions.split(`id: '${id}'`)[1].split(/id: 'm\d/)[0];
  ok(seg.includes('approachA') && seg.includes('approachB'), `${id} fills approachA/approachB`);
}
for (const id of ['m1-ombra', 'm2-lama', 'm3-verticale', 'm4-sigillo', 'm5-fuga']) {
  const seg = missions.split(`id: '${id}'`)[1].split(/id: 'm\d/)[0];
  ok(/VIA A/.test(seg) && /VIA B/.test(seg), `${id} briefing states 2 approaches (VIA A/B)`);
}

console.log('world: crawl passages P7/P8');
ok(world.includes('crawlGaps'), 'world exports crawlGaps');
ok(count(world, /crawlGaps\.push/g) === 2, 'crawlGaps has exactly 2 entries');
ok(world.includes("'crawl-west'") && world.includes("'crawl-canal'"), 'crawl-west + crawl-canal ids present');
ok(world.includes('P7') && world.includes('P8'), 'P7/P8 documented in ledger');

console.log('world: hide spots');
ok(count(world, /kind: 'hide'/g) === 3, "exactly 3 interactables with kind 'hide'");
for (const id of ['hide-1', 'hide-2', 'hide-3']) {
  ok(world.includes(`'${id}'`), `hide spot present: ${id}`);
}

console.log('world: caches + eco intel');
const cacheCalls = count(world, /\bmk\('/g) + count(world, /\baddCache\('/g);
ok(cacheCalls >= 10, `caches>=10 total (found ${cacheCalls})`);
for (const id of ['cache-smoke', 'cache-knife', 'intel', 'cache-attic', 'cache-garden', 'cache-canal',
  'cache-nw', 'cache-villa', 'cache-deep', 'cache-stall', 'intel-eco-1', 'intel-eco-2']) {
  ok(world.includes(`'${id}'`), `cache id present: ${id}`);
}

console.log('world: pois + shortcuts intact');
ok(count(world, /P\('poi-/g) >= 20, `pois>=20 (found ${count(world, /P\('poi-/g)})`);
ok(count(world, /shortcutGates\.push/g) === 2, 'shortcutGates still exactly 2 entries');
ok(world.includes("'gate-west'") && world.includes("'gate-east'"), 'gate-west + gate-east intact');
ok(count(world, /kind: 'shortcut'/g) === 2, "still 2 interactables with kind 'shortcut'");
ok(count(world, /addBreaker\('breaker-/g) === 2, '2 breaker boxes intact');
ok(world.includes('doc-villa'), 'doc-villa intact');

console.log('progression: 3 new upgrades + effects');
for (const id of ['slide', 'lure', 'falce']) {
  ok(progression.includes(`'${id}'`), `new upgrade def present: ${id}`);
}
ok(progression.includes('NEW_UPGRADES'), 'NEW_UPGRADES list exported');
ok(progression.includes('Scivolata') && progression.includes('Tascapane') && progression.includes('Luna Piena'), 'new upgrade names present');
ok(progression.includes('max: 3'), 'new upgrades max 3');
for (const f of ['slideMul', 'maxLure', 'specialMul']) {
  ok(progression.includes(f), `upgradeEffects returns ${f}`);
}
for (const f of ['speedMul', 'stealthMul', 'staminaMax', 'dmgMul', 'regenMul', 'maxSmoke', 'maxKnives', 'climbMul']) {
  ok(progression.includes(f), `legacy effect field kept: ${f}`);
}
ok(progression.includes('1 + 0.08') && progression.includes('0.88') && progression.includes('100 + 20'),
  'legacy effect formulas unchanged');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
