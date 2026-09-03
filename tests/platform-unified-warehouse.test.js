"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),test=require("node:test"),vm=require("node:vm");
const conferenceSource=fs.readFileSync("js/supabase/conference-device-operation-contract.js","utf8");
const warehouseSource=fs.readFileSync("js/supabase/warehouse-device-operation-contract.js","utf8");
const platformSource=fs.readFileSync("js/supabase/platform-device-operation-contract.js","utf8");
const migration=fs.readFileSync("supabase/migrations/20260903180000_unified_platform_warehouse_device_operation.sql","utf8");
const edge=fs.readFileSync("supabase/functions/platform-device-operation/index.ts","utf8");
const session=fs.readFileSync("js/supabase/device-session.js","utf8");
const transport=fs.readFileSync("js/supabase/warehouse-transport.js","utf8");
const workspace=fs.readFileSync("js/warehouse/workspace.js","utf8");
const sandbox={window:{}};
vm.runInNewContext(conferenceSource,sandbox);vm.runInNewContext(warehouseSource,sandbox);vm.runInNewContext(platformSource,sandbox);
const conference=sandbox.window.ConferenceDeviceOperationContract,warehouse=sandbox.window.WarehouseDeviceOperationContract,platform=sandbox.window.PlatformDeviceOperationContract;

test("unified catalogs retain the approved 57/30/29/1 boundary",()=>{
  assert.equal(conference.EDGE_ONLY_PROTECTED.length,57);
  assert.equal(warehouse.PROTECTED.length,30);
  assert.equal(warehouse.DISPATCHABLE.length,29);
  assert.equal(warehouse.DEFERRED.length,1);
  assert.equal(warehouse.DEFERRED[0].signature,"warehouse.stage_import(uuid,uuid,jsonb)");
  assert.equal(platform.DISPATCHABLE.length,86);
});

test("generic Edge and SQL dispatchers expose exactly the dispatchable catalogs",()=>{
  const edgeConference=new Set(edge.match(/const conference=new Set\(\[([\s\S]*?)\]\);/)[1].match(/'([a-z0-9_]+)'/g).map(x=>x.slice(1,-1)));
  const edgeWarehouse=new Set(edge.match(/const warehouse=new Set\(\[([\s\S]*?)\]\);/)[1].match(/'([a-z0-9_]+)'/g).map(x=>x.slice(1,-1)));
  assert.equal(JSON.stringify([...edgeConference].sort()),JSON.stringify(conference.EDGE_ONLY_PROTECTED.map(x=>x.operation).sort()));
  assert.equal(JSON.stringify([...edgeWarehouse].sort()),JSON.stringify(warehouse.DISPATCHABLE.map(x=>x.operation).sort()));
  assert.doesNotMatch(edge,/stage_import/);
  assert.match(migration,/execute_device_operation\(uuid,uuid,bytea,text,text,jsonb\)/);
  assert.match(migration,/WAREHOUSE_OPERATION_NOT_ALLOWED/);
  assert.doesNotMatch(migration,/when 'stage_import'/);
});

test("all 30 Warehouse RPCs lose browser EXECUTE and only 29 gain service dispatch",()=>{
  for(const entry of warehouse.PROTECTED){
    assert.ok(migration.includes("'"+entry.signature+"'"),"missing protected signature: "+entry.signature);
  }
  function loopEntries(action){const end=migration.indexOf("loop execute format('"+action);const start=migration.lastIndexOf('foreach signature in array array[',end);return migration.slice(start,end);}
  const revokes=loopEntries('revoke execute');
  const grants=loopEntries('grant execute');
  assert.equal((revokes.match(/'warehouse\./g)||[]).length,30);
  assert.equal((grants.match(/'warehouse\./g)||[]).length,29);
  assert.match(revokes,/warehouse\.stage_import\(uuid,uuid,jsonb\)/);
  assert.doesNotMatch(grants,/warehouse\.stage_import\(uuid,uuid,jsonb\)/);
});

test("Warehouse browser calls use only the generic device-session transport",()=>{
  assert.match(session,/functions\.invoke\('platform-device-operation'/);
  assert.match(transport,/invokeModuleProtected\('warehouse',operation,args\)/);
  assert.match(transport,/ACTOR_DEVICE_OVERRIDE_DENIED/);
  assert.match(workspace,/WarehouseTransport\.invoke/);
  assert.doesNotMatch(transport,/\.rpc\(|gateway|vercel/i);
});

test("active static runtime has zero Gateway or Vercel dependency",()=>{
  for(const file of ["api/gateway.js","server/platform-gateway.cjs","vercel.json","platform/modules.json","js/platform-device-ownership-handoff.js","platform-device-ownership-handoff.html"])
    assert.equal(fs.existsSync(file),false,file);
  for(const file of ["index.html","service-worker.js","package.json","js/platform-integration.js","js/application-routing.js"])
    assert.doesNotMatch(fs.readFileSync(file,"utf8"),/platform-gateway|api\/gateway|ownership-handoff|integrated-platform-development-git-develop-ramyawny37-3662\.vercel\.app/i,file);
});
