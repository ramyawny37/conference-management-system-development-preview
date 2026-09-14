'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');

const worker=fs.readFileSync('service-worker.js','utf8');

test('Development worker auto-activates while Production keeps manual activation semantics',()=>{
  assert.match(worker,/\.then\(\(\) => \{\s*if \(IS_DEVELOPMENT\) return self\.skipWaiting\(\);\s*return undefined;\s*\}\)/);
  assert.match(worker,/if \(event\.data\.action === 'skipWaiting'\)/);
});

test('Development non-navigation assets are network-first with cache fallback',()=>{
  assert.match(worker,/function developmentNetworkFirst\(request\)/);
  assert.match(worker,/fetch\(new Request\(request,\{cache:'no-store'\}\)\)/);
  assert.match(worker,/cache\.put\(request,responseToCache\)/);
  assert.match(worker,/catch\(\(\) => caches\.open\(CACHE_NAME\)\.then\(cache => cache\.match\(request\)\)\)/);
  assert.match(worker,/if \(IS_DEVELOPMENT\) \{\s*event\.respondWith\(developmentNetworkFirst\(request\)\);\s*return;\s*\}/);
});

test('Production retains the existing cache-first fallback path',()=>{
  assert.match(worker,/caches\.open\(CACHE_NAME\)\.then\(cache => \{\s*return cache\.match\(request\)\.then\(response => \{\s*return response \|\| fetch\(request\);/);
});
