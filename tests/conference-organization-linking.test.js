'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

function source(file){
  return fs.readFileSync(path.join(__dirname,'..',file),'utf8');
}

const organizationId='11111111-1111-4111-8111-111111111111';
const localId='local-conference';
const remoteId='22222222-2222-4222-8222-222222222222';

function linkingEnvironment(){
  const calls={create:[],upload:[]};
  const links={};
  const sandbox={
    window:null,Promise,JSON,Object,String,Array,RegExp,
    structuredClone,
    crypto:{randomUUID(){
      return calls.create.length
        ?'44444444-4444-4444-8444-444444444444'
        :'33333333-3333-4333-8333-333333333333';
    }},
    SupabaseRuntimeConfig:{getPublicState(){return {configured:true};}},
    SupabaseAuth:{getState(){return {authenticated:true};}},
    SupabaseDeviceIdentity:{getOrCreate(){return {id:'55555555-5555-4555-8555-555555555555'};}},
    ConferenceLinkStore:{
      get(id){return links[id]||null;},
      save(value){links[value.localConferenceId]=structuredClone(value);return {ok:true,data:structuredClone(value)};}
    },
    ConferenceLinkingAttemptStore:{
      get(){return null;},
      save(value){return {ok:true,data:value};},
      remove(){return {ok:true};}
    },
    SupabaseSnapshotSync:{
      createConferenceIdempotent(input){
        calls.create.push(structuredClone(input));
        return Promise.resolve({ok:true,status:'created',data:{conferenceId:remoteId}});
      },
      uploadInitialSnapshot(input){
        calls.upload.push(structuredClone(input));
        return Promise.resolve({ok:true,status:'applied',data:{revision:1,operationId:input.operationId}});
      }
    },
    OfflineFirstIntegration:{configureConferenceSync(){return {ok:true};}}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source('js/sync/conference-linking-service.js'),sandbox);
  return {sandbox,calls};
}

async function run(){
  const valid=linkingEnvironment();
  const linked=await valid.sandbox.ConferenceLinkingService.ensureConferenceLinked({
    localConferenceId:localId,
    name:'Production Smoke Test',
    organizationId,
    snapshot:{id:localId,name:'Production Smoke Test',organizationId}
  });
  assert.strictEqual(linked.status,'linked');
  assert.strictEqual(valid.calls.create.length,1);
  assert.strictEqual(valid.calls.create[0].organizationId,organizationId);

  const missing=linkingEnvironment();
  const rejected=await missing.sandbox.ConferenceLinkingService.ensureConferenceLinked({
    localConferenceId:localId,
    name:'Production Smoke Test',
    snapshot:{id:localId,name:'Production Smoke Test'}
  });
  assert.strictEqual(rejected.status,'create_failed');
  assert.strictEqual(rejected.error.code,'ORGANIZATION_REQUIRED');
  assert.strictEqual(missing.calls.create.length,0);

  const script=source('script.js');
  const start=script.indexOf('var conferenceOrganizationOptions=');
  const end=script.indexOf('function createConferenceFromSelection()',start);
  const fields={
    conferenceOrganizationField:{style:{}},
    cfg_organization:{innerHTML:'',disabled:false,value:''},
    conferenceOrganizationMessage:{textContent:''}
  };
  const selector={
    window:null,Promise,Array,String,RegExp,
    conferenceDialogMode:'create',
    ge(id){return fields[id]||null;},
    esc(value){return String(value);},
    OrganizationManagementUI:{getState(){return {selectedId:''};}},
    OrganizationManagementService:{list(){return Promise.resolve({ok:true,data:{organizations:[
      {organizationId,displayName:'One',status:'active'},
      {organizationId:'66666666-6666-4666-8666-666666666666',displayName:'Two',status:'active'}
    ]}});}}
  };
  selector.window=selector;
  vm.runInNewContext(script.slice(start,end),selector);
  await selector.loadConferenceOrganizationOptions();
  assert.strictEqual(selector.conferenceOrganizationOptions.length,2);
  assert.doesNotMatch(fields.cfg_organization.innerHTML,/ selected/);
  assert.strictEqual(fields.conferenceOrganizationMessage.textContent,
    'يجب اختيار مؤسسة قبل إنشاء المؤتمر.');

  selector.OrganizationManagementService={list(){return Promise.resolve({
    ok:true,data:{organizations:[{
      organizationId,displayName:'Only',status:'active'
    }]}
  });}};
  await selector.loadConferenceOrganizationOptions();
  assert.match(fields.cfg_organization.innerHTML,
    new RegExp('value="'+organizationId+'" selected'));

  assert.match(source('js/sync/conference-sync-ui.js'),
    /يجب اختيار مؤسسة قبل إنشاء النسخة السحابية/);
  console.log('conference organization linking tests: passed');
}

run().catch(error=>{console.error(error);process.exitCode=1;});
