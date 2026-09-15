'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const test=require('node:test');

const root=path.join(__dirname,'..');
const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
const publicConfig=fs.readFileSync(
  path.join(root,'js/supabase/public-config.js'),'utf8'
);

test('Production public config is isolated from stale Development caches',()=>{
  const revisions=worker.match(
    /const CACHE_REVISION = IS_DEVELOPMENT\s*\? '([^']+)'\s*:\s*'([^']+)'/
  );
  assert(revisions,'missing environment-specific cache revisions');
  assert.strictEqual(
    revisions[1],'platform-dashboard-v2-v2'
  );
  assert.strictEqual(revisions[2],'production-3-5-0-config-isolation-v1');

  assert.match(publicConfig,/mpezfbvcdfxpgflehuot/);
  assert.match(publicConfig,/gppwltrifgfxrkzvvxoe/);

  const productionHandler=worker.slice(
    worker.indexOf('function productionPublicConfigNetworkOnly'),
    worker.indexOf("self.addEventListener('fetch'")
  );
  assert.match(productionHandler,/fetch\(new Request\(request,\{cache:'no-store'\}\)\)/);
  assert.doesNotMatch(productionHandler,/caches\.|cache\.match/);
  assert.match(productionHandler,/status:503/);

  const fetchHandler=worker.slice(worker.indexOf("self.addEventListener('fetch'"));
  const configGate=fetchHandler.indexOf(
    "requestUrl.pathname.endsWith('/js/supabase/public-config.js')"
  );
  const genericCacheFirst=fetchHandler.indexOf('caches.open(CACHE_NAME)',configGate);
  assert(configGate>=0,'missing Production public-config request gate');
  assert(genericCacheFirst>configGate,'public-config gate must precede cache-first');
  assert.match(
    fetchHandler.slice(configGate,genericCacheFirst),
    /respondWith\(productionPublicConfigNetworkOnly\(request\)\)[\s\S]*return;/
  );
});

test('this release activates promptly while retaining client claiming',()=>{
  assert.match(worker,/\.then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(worker,/\.then\(\(\) => self\.clients\.claim\(\)\)/);
});
