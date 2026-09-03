const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('js/application-routing.js','utf8');

function runtime(basePath,pathname,hash){
  const origin='https://example.test';
  const window={location:{origin,pathname:pathname||basePath,hash:hash||''},document:{
    currentScript:{src:origin+basePath+'js/application-routing.js'}
  }};
  vm.runInNewContext(source,{window,URL,Error,Object,String});
  return window.ApplicationRouting;
}

test('logical routes resolve beneath development-like, production-like, and root bases',()=>{
  assert.strictEqual(runtime('/preview/').resolveLogicalRoute('/conference'),'/preview/#/conference');
  assert.strictEqual(runtime('/app/').resolveLogicalRoute('/conference'),'/app/#/conference');
  assert.strictEqual(runtime('/').resolveLogicalRoute('/conference'),'/#/conference');
});

test('logical pathnames are recovered without repository-name knowledge',()=>{
  assert.strictEqual(runtime('/preview/','/preview/','#/conference').getLogicalPathname(),'/conference');
  assert.strictEqual(runtime('/app/','/app/','#/conference/').getLogicalPathname(),'/conference/');
  assert.strictEqual(runtime('/','/','#/conference').getLogicalPathname(),'/conference');
  assert.strictEqual(runtime('/preview/','/outside').getLogicalPathname(),'/');
});

test('all current same-origin module routes remain beneath a repository scope',()=>{
  const routing=runtime('/preview/');
  for(const route of ['/conference','/warehouse','/reservations','/custody']){
    assert.match(routing.resolveLogicalRoute(route),/^\/preview\//);
  }
});
