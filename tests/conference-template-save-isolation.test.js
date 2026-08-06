'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var source=fs.readFileSync(path.resolve(__dirname,'../state.js'),'utf8');
var currentReads=0,trackingCalls=0,repositoryCalls=[];
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
  StorageRepository:{saveAppSnapshot:function(snapshot,options){
    repositoryCalls.push({snapshot:JSON.parse(JSON.stringify(snapshot)),
      options:options===undefined?null:JSON.parse(JSON.stringify(options))});
    return Promise.resolve({ok:true});
  }},
  ConferenceRepository:{recordLocalChange:function(){
    trackingCalls++;return {ok:false};
  }}
};
sandbox.window=sandbox;
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
assert.strictEqual(trackingCalls,0);
assert.strictEqual(JSON.stringify(sandbox.appData.conferences),before);
assert.strictEqual(repositoryCalls.length,1);
assert.deepStrictEqual(repositoryCalls[0].options,{skipSyncQueue:true});
assert.strictEqual(repositoryCalls[0].snapshot.currentConferenceId,'conference-1');
assert.strictEqual(repositoryCalls[0].snapshot.templates[0].data.houses[0].id,
  'template-house');

assert.strictEqual(sandbox.save(),true);
assert.strictEqual(currentReads,2,
  'default save must retain its update and tracking reads');
assert.strictEqual(trackingCalls,1,
  'default save must retain conference tracking');
assert.strictEqual(repositoryCalls.length,2);
assert.strictEqual(repositoryCalls[1].options,null);

console.log('conference template save isolation tests: passed');
