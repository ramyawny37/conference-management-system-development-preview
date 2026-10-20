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
const developmentValidator=fs.readFileSync(
  path.join(root,'tools/validation/check-development-preview.cjs'),'utf8'
);

test('Production public config is isolated from stale Development caches',()=>{
  const revisions=worker.match(
    /const CACHE_REVISION = IS_DEVELOPMENT\s*\? '([^']+)'\s*:\s*'([^']+)'/
  );
  assert(revisions,'missing environment-specific cache revisions');
  assert.strictEqual(
    revisions[1],'development-platform-design-conference-v1'
  );
  assert.notStrictEqual(revisions[1],'conference-owner-preflight-correction-v1');
  assert.strictEqual(revisions[2],'production-3-6-0-release-v6');
  assert.match(developmentValidator,/device-authorization-administration-service\.js\?rev=canonical-owner-session-list-v1/);

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

test('updates wait for acceptance while activation retains client claiming',()=>{
  assert.doesNotMatch(worker,/\.then\(\(\) => self\.skipWaiting\(\)\)/);
  assert.match(worker,/event\.waitUntil\(self\.skipWaiting\(\)\)/);
  assert.match(worker,/\.then\(\(\) => self\.clients\.claim\(\)\)/);
});
