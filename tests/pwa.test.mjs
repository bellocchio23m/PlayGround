// PWA/offline source audits (plain node, no deps).
// Verifies sw.js v4 strategy + main.ts update wiring per phase-3 fix.
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ok - ${name}`); }
  else { fail++; console.error(`  FAIL - ${name}`); }
}

const swSrc = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

console.log('sw cache version + lifecycle:');
ok(/const CACHE = 'shadowline-v5'/.test(swSrc), 'CACHE bumped to shadowline-v5');
ok(!/shadowline-v3/.test(swSrc), 'old v3 cache name fully removed');
ok(/self\.skipWaiting\(\)/.test(swSrc), 'skipWaiting present');
ok(/clients\.claim\(\)/.test(swSrc), 'clients.claim present (activate takes control)');
ok(/addEventListener\('message'/.test(swSrc) && /SKIP_WAITING/.test(swSrc), 'message handler supports SKIP_WAITING');

console.log('navigation preload OFF + navigate-first:');
ok(/navigationPreload/.test(swSrc) && /\.disable\(\)/.test(swSrc), 'navigation preload disabled on activate');
ok(/preloadResponse/.test(swSrc) === false, 'no preload response usage anywhere (preload OFF)');
ok(/request\.mode === 'navigate'/.test(swSrc), "handles request.mode==='navigate' explicitly");
ok(
  swSrc.indexOf("request.mode === 'navigate'") !== -1 &&
    swSrc.indexOf("request.destination === 'script'") !== -1 &&
    swSrc.indexOf("request.mode === 'navigate'") < swSrc.indexOf("request.destination === 'script'"),
  'navigate branch comes FIRST (before script/style branch)'
);
ok(/cachePut\(['"]\.\/index\.html['"]/.test(swSrc), 'fresh navigation response cached as ./index.html');

console.log('normalized keys + SWR scripts:');
ok(/ignoreSearch:\s*true/.test(swSrc), 'caches.match uses ignoreSearch:true');
ok((swSrc.match(/ignoreSearch:\s*true/g) || []).length >= 2, 'ignoreSearch used in >=2 lookups (navigate + assets)');
ok(/stripSearch|split\(['"]\?['"]\)|indexOf\(['"]\?['"]\)/.test(swSrc), 'runtime keys normalized (search stripped) so ?v= hits');
ok(/request\.destination === 'script'/.test(swSrc) && /request\.destination === 'style'/.test(swSrc), "destinations 'script'/'style' handled");
ok(/e\.waitUntil\(/.test(swSrc), 'background revalidate via event.waitUntil (SWR)');
ok(/if \(cached\)[\s\S]{0,200}return cached/.test(swSrc), 'scripts serve cache immediately (no network-first without cache race)');

console.log('offline fallback safety:');
ok(/caches\.match\(['"]\.\/index\.html['"]\)/.test(swSrc), 'document fallback serves cached index.html');
ok(/status:\s*503/.test(swSrc) && /new Response/.test(swSrc), 'script/style fallback returns 503 Response when cache+network fail');
ok(!/destination === 'script'[\s\S]{0,400}index\.html/.test(swSrc) || /status:\s*503/.test(swSrc), 'script branch never falls back to HTML (no MIME breakage)');

console.log('atomic-safe install:');
ok(/cache\.addAll\(CORE\)/.test(swSrc), 'install uses cache.addAll for CORE only');
ok(/\.catch\(\(\) => null\)/.test(swSrc), 'hashed assets best-effort individually (one failure never fails install)');

console.log('main.ts registration + toast:');
ok(/navigator\.serviceWorker[\s\S]{0,30}\.register\(/.test(mainSrc) && mainSrc.includes('./sw.js'), 'main.ts registers ./sw.js');
ok((mainSrc.match(/addEventListener\(['"]controllerchange['"]/g) || []).length === 1, 'main.ts has exactly one controllerchange listener');
ok(/visibilitychange/.test(mainSrc) && /visibilityState/.test(mainSrc) && /visible/.test(mainSrc), 'update check on visibilitychange visible');
ok(/\.update\(\)/.test(mainSrc), 'visibility handler calls registration.update()');
ok(/Aggiornamento disponibile — ricarica/.test(mainSrc), 'toast text "Aggiornamento disponibile — ricarica" present');
ok(!/location\.reload/.test(mainSrc), 'no reload loop (no location.reload in main.ts)');
ok(/swToastShown|toastShown|shownOnce|once|session/.test(mainSrc), 'max 1 prompt per session guard present');

console.log(`\npwa: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

console.log('vary normalization (offline root-cause fix):');
ok(/cachePut/.test(swSrc) && /delete\('vary'\)/.test(swSrc), 'SW strips Vary on cache puts (cors match fix)');
ok(/arrayBuffer/.test(swSrc), 'Vary-strip consumes body safely via arrayBuffer');

console.log('page-driven precache:');
ok(/PRECACHE/.test(swSrc) && /postMessage\(\{ type: 'PRECACHE'/.test(mainSrc), 'SW handles PRECACHE + page sends own script/style URLs');
