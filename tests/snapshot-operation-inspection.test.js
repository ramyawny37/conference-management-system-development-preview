'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');
var source=fs.readFileSync(path.resolve(
  __dirname,'../js/supabase/snapshot-sync.js'),'utf8');
var USER='11111111-1111-4111-8111-111111111111';
var DEVICE='22222222-2222-4222-8222-222222222222';
var OP='33333333-3333-4333-8333-333333333333';
var CONFERENCE='44444444-4444-4444-8444-444444444444';

function row(status,extra){
  return Object.assign({operation_id:OP,conference_id:CONFERENCE,user_id:USER,
    device_id:DEVICE,status:status,base_revision:7,resulting_revision:null,
    processed_at:null},extra||{});
}
function load(settings){
  settings=settings||{};
  var responses=(settings.responses||[]).slice();
  var client={from:function(){return {
    select:function(){return this;},eq:function(){return this;},
    maybeSingle:function(){return Promise.resolve(responses.shift()||{
      data:null,error:null});}
  };}};
  var sandbox={window:null,Promise:Promise,Date:Date,JSON:JSON,Object:Object,
    String:String,Number:Number,Array:Array,Uint8Array:Uint8Array,
    structuredClone:global.structuredClone,
    SupabaseClientLayer:{getClient:function(){return client;}},
    SupabaseAuth:{getSession:function(){return settings.session===undefined
      ?{user:{id:USER},expires_at:Math.floor(Date.now()/1000)+600}
      :settings.session;}},
    SupabaseDeviceIdentity:{getOrCreate:function(){return {id:DEVICE};}}};
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox);
  return sandbox.SupabaseSnapshotSync;
}
function inspect(api,input){
  return api.inspectSnapshotOperation(Object.assign({operationId:OP,
    conferenceId:CONFERENCE,deviceId:DEVICE,baseRevision:7},input||{}));
}

(async function(){
  var applied=await inspect(load({responses:[{data:row('applied',{
    resulting_revision:8}),error:null}]}));
  assert.strictEqual(applied.status,'applied');

  var noSession=await inspect(load({session:null}));
  assert.strictEqual(noSession.error.code,'AUTH_REQUIRED');
  var expired=await inspect(load({session:{user:{id:USER},expires_at:1}}));
  assert.strictEqual(expired.error.code,'TOKEN_EXPIRED');

  for(var denied of [
    {status:401,code:'401'},
    {status:403,code:'403'},
    {code:'42501'}
  ]){
    var denial=await inspect(load({responses:[{data:null,error:denied}]}));
    assert.strictEqual(denial.error.code,'ACCESS_DENIED');
  }

  assert.strictEqual((await inspect(load({responses:[{data:null,error:null}]})))
    .status,'not_found');
  for(var status of ['pending','processing','failed','rejected']){
    assert.strictEqual((await inspect(load({responses:[{
      data:row(status),error:null}]}))).status,status);
  }

  var conflict=await inspect(load({responses:[
    {data:row('conflict'),error:null},
    {data:{id:'conflict-1',expected_revision:7,actual_revision:8,
      status:'open'},error:null}
  ]}));
  assert.strictEqual(conflict.status,'conflict');
  assert.strictEqual(conflict.data.actualRevision,8);
  var conflictMissing=await inspect(load({responses:[
    {data:row('conflict'),error:null},{data:null,error:null}
  ]}));
  assert.strictEqual(conflictMissing.ok,false);
  assert.strictEqual(conflictMissing.error.code,'INVALID_CONFLICT_RESULT');

  for(var invalid of [
    row('applied',{resulting_revision:null}),
    row('applied',{resulting_revision:7}),
    row('unknown'),
    row('applied',{resulting_revision:8,device_id:null}),
    row('applied',{resulting_revision:8,user_id:
      '55555555-5555-4555-8555-555555555555'}),
    row('applied',{resulting_revision:8,base_revision:6}),
    row('applied',{resulting_revision:8,conference_id:
      '66666666-6666-4666-8666-666666666666'})
  ]){
    var bad=await inspect(load({responses:[{data:invalid,error:null}]}));
    assert.strictEqual(bad.ok,false);
  }
  console.log('snapshot operation inspection tests passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
