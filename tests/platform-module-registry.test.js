const assert=require('node:assert');
const test=require('node:test');
const {loadModuleRegistry,publicModule}=require('../server/module-registry.cjs');

test('module registry provides stable extensible routing metadata',()=>{
  const modules=loadModuleRegistry();
  assert.deepStrictEqual(modules.map(item=>item.id),[
    'conference','warehouse','reservations','custody'
  ]);
  for(const module of modules){
    assert.match(module.routePrefix,/^\/[a-z][a-z0-9-]*$/);
    assert.ok(module.permission);
    assert.strictEqual(module.permission,'module.access');
    assert.match(module.targetEnvironment,/^PLATFORM_[A-Z0-9_]+_TARGET$/);
  }
});

test('public registry metadata does not expose target or permission internals',()=>{
  const value=publicModule(loadModuleRegistry()[0],true);
  assert.strictEqual(value.available,true);
  assert.strictEqual('targetEnvironment' in value,false);
  assert.strictEqual('permission' in value,false);
});
