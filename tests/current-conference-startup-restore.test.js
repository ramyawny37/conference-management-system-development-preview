'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(__dirname,'../state.js'),'utf8');
const startupSource=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
function sandbox(settings={}){
  const target={
    window:null,console,Promise,JSON,Object,Array,String,Date,
    localStorage:{getItem:()=>null,setItem:()=>{}},
    FullBackupService:{
      isFullRestoreCloudReviewPending:()=>settings.restore===true,
      isManualRelinkRequired:()=>settings.manual===true
    },
    ConferenceLinkStore:{get:()=>settings.link||null}
  };
  target.window=target;
  vm.runInNewContext(source,target,{filename:'state.js'});
  return target;
}
function data(conferences,currentConferenceId=null){return {conferences,currentConferenceId};}

const active={id:'local-1',status:'active'};
let env=sandbox();
let value=data([active]);
assert.strictEqual(env.restoreSafeSingleCurrentConferenceSelection(value),false,
  'a local conference record must not establish runtime authorization');
assert.strictEqual(value.currentConferenceId,null,
  'startup selection must remain inactive until authorization reconciliation');
assert.match(source,/window\.applicationPersistedConferenceCandidate=[\s\S]*String\(selection\.data\.currentConferenceId\|\|''\)\.trim\(\)\|\|null;[\s\S]*appData\.currentConferenceId=null;[\s\S]*restoreSafeSingleCurrentConferenceSelection\(appData\)/,
  'startup must preserve the persisted candidate as non-authoritative selection while clearing active state');
assert.match(startupSource,/canonicalRecord=discovered\.find\([\s\S]*String\(item\.id\|\|''\)===candidate[\s\S]*opener\.open\(candidate,\{enterApplication:false\}\)/,
  'only the canonical discovered-open service may restore the active conference');

(async function verifyPersistedCandidateBoundary(){
  const startupEnv=sandbox();
  startupEnv.StorageRepository={getAppData:()=>Promise.resolve({data:data([active],'local-1'),savedAt:'2026-10-06T00:00:00Z'})};
  startupEnv.AppIndexedDB={validateAppDataRecord:()=>({valid:true})};
  startupEnv.normalizeAppData=()=>{};
  startupEnv.updateLogoText=()=>{};
  startupEnv.getCurrentConference=()=>null;
  startupEnv.setCurrentConference=()=>{};
  await startupEnv.initializeApplicationStorage();
  assert.strictEqual(startupEnv.applicationPersistedConferenceCandidate,'local-1',
    'storage initialization preserves the persisted conference candidate');
  assert.strictEqual(startupEnv.appData.currentConferenceId,null,
    'storage initialization never activates the persisted candidate before authorization');
})().catch(error=>{throw error;});

env=sandbox();
value=data([active,{id:'local-2',status:'active'}]);
assert.strictEqual(env.restoreSafeSingleCurrentConferenceSelection(value),false);
assert.strictEqual(value.currentConferenceId,null);

env=sandbox({restore:true});
value=data([active]);
assert.strictEqual(env.restoreSafeSingleCurrentConferenceSelection(value),false);

env=sandbox({manual:true});
value=data([active]);
assert.strictEqual(env.restoreSafeSingleCurrentConferenceSelection(value),false);

env=sandbox({link:{linkStatus:'needs_resolution'}});
value=data([active]);
assert.strictEqual(env.restoreSafeSingleCurrentConferenceSelection(value),false);

env=sandbox({link:{linkStatus:'linked',pendingLocalApplication:true}});
value=data([active]);
assert.strictEqual(env.restoreSafeSingleCurrentConferenceSelection(value),false);

console.log('current conference startup restore tests: passed');
