'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const discoverySource=fs.readFileSync('js/supabase/canonical-conference-discovery.js','utf8');
const startupSource=fs.readFileSync('js/sync/startup-conference-discovery.js','utf8');
function load(source,sandbox){sandbox.window=sandbox;vm.runInNewContext(source,sandbox);return sandbox;}
function authority(response){return load(discoverySource,{PlatformDeviceSession:{invokeModuleProtected:async()=>response}}).CanonicalConferenceDiscovery;}
test('missing canonical conferences array fails closed, not an empty successful list',async()=>{
  for(const response of [null,{}, {conferences:null},{conferences:{}}]){
    const outcome=await authority(response).listAccessibleConferences();
    assert.equal(outcome.ok,false);
    assert.equal(outcome.status,'invalid_response');
    assert.equal(outcome.error.code,'CANONICAL_CONFERENCE_DISCOVERY_INVALID_RESPONSE');
  }
});
test('genuine empty canonical list remains successful',async()=>{
  const outcome=await authority({conferences:[]}).listAccessibleConferences();
  assert.equal(outcome.ok,true);
  assert.equal(outcome.data.conferences.length,0);
});
test('startup retains prior authorized rows when refreshed response is malformed',async()=>{
  let response={ok:true,data:{conferences:[{id:'conference-1',name:'Canonical'}]}};
  const sandbox=load(startupSource,{CanonicalConferenceDiscovery:{listAccessibleConferences:async()=>response},structuredClone:v=>JSON.parse(JSON.stringify(v))});
  const discovery=sandbox.StartupConferenceDiscovery;
  assert.equal((await discovery.refresh()).ok,true);
  response={ok:true,data:{}};
  const invalid=await discovery.refresh();
  assert.equal(invalid.ok,false);
  assert.equal(invalid.status,'invalid_response');
  assert.equal(discovery.getRecords().length,1);
  assert.equal(discovery.getRecords()[0].id,'conference-1');
});
