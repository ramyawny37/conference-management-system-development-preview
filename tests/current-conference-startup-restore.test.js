'use strict';

const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(__dirname,'../state.js'),'utf8');
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
assert.strictEqual(env.restoreSafeSingleCurrentConferenceSelection(value),true);
assert.strictEqual(value.currentConferenceId,'local-1');

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
