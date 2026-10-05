// Full regression runner: every suite isolated (suites call process.exit).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const SUITES = [
  './logic.test.mjs',
  './player.test.mjs',
  './combat.test.mjs',
  './ai.test.mjs',
  './world.test.mjs',
  './ux.test.mjs',
  './perf.test.mjs',
  './p3-movement.test.mjs',
  './p3-combat.test.mjs',
  './p3-stealth.test.mjs',
  './p3-world.test.mjs',
  './p3-uxperf.test.mjs',
];

let pass = 0; let fail = 0; let skip = 0;
const failed = [];
for (const rel of SUITES) {
  const url = new URL(rel, import.meta.url);
  if (!existsSync(url)) {
    skip++;
    console.log(`SKIP ${rel} (not present yet)`);
    continue;
  }
  console.log(`--- ${rel} ---`);
  const r = spawnSync(process.execPath, [url.pathname], { stdio: 'inherit' });
  if (r.error) {
    fail++;
    failed.push(rel);
    console.error(`FAIL ${rel}: could not spawn (${r.error.message})`);
  } else if (r.status !== 0) {
    fail++;
    failed.push(rel);
    console.error(`FAIL ${rel}: exit ${r.status}`);
  } else {
    pass++;
    console.log(`ok ${rel}`);
  }
}

console.log(`\naggregation: ${pass} suites passed, ${fail} failed, ${skip} skipped`);
if (failed.length) console.error(`failed suites: ${failed.join(', ')}`);
process.exit(fail ? 1 : 0);
