'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var source=fs.readFileSync(path.resolve(__dirname,'../state.js'),'utf8');
var currentReads=0,repositoryCalls=[],canonicalCalls=[];
var values={};
var sandbox={
  window:null,Promise:Promise,JSON:JSON,Object:Object,Array:Array,
  String:String,Number:Number,Date:Date,Math:Math,Error:Error,
  parseInt:parseInt,console:{warn:function(){},error:function(){}},
  localStorage:{
    getItem:function(key){return values[key]||null;},
    setItem:function(key,value){values[key]=value;}
  },
  getCurrentConference:function(){currentReads++;return {
    id:'conference-1',name:'Current',conf:{name:'Current',days:1}
  };},
  syncConferencePeriod:function(){},
  ge:function(){return null;},
  StorageRepository:{saveAppData:function(snapshot,options){
    repositoryCalls.push({snapshot:JSON.parse(JSON.stringify(snapshot)),
      options:options===undefined?null:JSON.parse(JSON.stringify(options))});
    return Promise.resolve({ok:true});
  }}
};
sandbox.window=sandbox;
sandbox.CanonicalTemplateLibrary={mutate:function(type,id,action,payload){
  canonicalCalls.push({type:type,id:id,action:action,payload:payload});
  return Promise.resolve([]);
}};
vm.runInNewContext(source,sandbox,{filename:'state.js'});
sandbox.appData={
  version:'2.0.0',currentConferenceId:'conference-1',
  conferences:[{id:'conference-1',name:'Current',houses:[{id:'real'}]}],
  templates:[{id:'template-1',data:{houses:[{id:'template-house'}]}}],
  houseTemplates:[{id:'library'}]
};
var before=JSON.stringify(sandbox.appData.conferences);
assert.strictEqual(sandbox.save({
  skipCurrentConferenceUpdate:true,
  skipConferenceTracking:true,
  skipSyncQueue:true
}),true);
assert.strictEqual(currentReads,0);
assert.strictEqual(JSON.stringify(sandbox.appData.conferences),before);
assert.strictEqual(repositoryCalls.length,1);
assert.strictEqual(repositoryCalls[0].options,null);
assert.strictEqual(repositoryCalls[0].snapshot.currentConferenceId,'conference-1');
assert.deepStrictEqual(repositoryCalls[0].snapshot.templates,[]);
assert.deepStrictEqual(repositoryCalls[0].snapshot.houseTemplates,[]);

sandbox.saveTemplateOnly({conferenceTemplateId:'template-1'}).then(function(){
  assert.strictEqual(canonicalCalls.length,1);
  assert.strictEqual(canonicalCalls[0].type,'conference');
  assert.strictEqual(canonicalCalls[0].action,'upsert');
}).catch(function(error){console.error(error);process.exitCode=1;});

assert.strictEqual(sandbox.save(),false);
assert.strictEqual(currentReads,2,
  'default save must resolve the active canonical conference');
assert.strictEqual(repositoryCalls.length,1,
  'canonical conference data must not enter local persistence');
assert.strictEqual(
  sandbox.applicationStorageState.lastStorageError.message,
  'CANONICAL_CONFERENCE_MUTATION_CONTRACT_REQUIRED'
);

console.log('conference template save isolation tests: passed');
