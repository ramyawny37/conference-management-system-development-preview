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
function data(conferences){return {conferences,currentConferenceId:null};}

const active={id:'local-1',status:'active'};
let env=sandbox();
let value=data([active]);
assert.strictEqual(env.restoreSafeSingleCurrentConferenceSelection(value),false,
  'a local conference record must not establish runtime authorization');
assert.strictEqual(value.currentConferenceId,null,
  'startup selection must remain inactive until authorization reconciliation');
assert.match(source,/capturePersistedCandidate\(persistedCandidate,selection\.source\)[\s\S]*appData\.currentConferenceId=null;[\s\S]*restoreSafeSingleCurrentConferenceSelection\(appData\)/,
  'startup must preserve the persisted candidate while clearing active selection');
assert.match(startupSource,/authorization\.reconcileStartup\([\s\S]*appData\.currentConferenceId=decision&&decision\.ok\?decision\.localConferenceId:null/,
  'only centralized authorization reconciliation may restore the active conference');

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
