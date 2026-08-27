'use strict';
var assert=require('assert'),fs=require('fs'),vm=require('vm');
var source=fs.readFileSync('js/sync/conference-activation-authorization.js','utf8');
var user='6cc4a078-b59c-4a1f-a334-438acc69346f'; // ramyawny37@yahoo.com
var other='22222222-2222-4222-8222-222222222222';
var authUser=user;
var links={cloud:{localConferenceId:'cloud',remoteConferenceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}};
var sandbox={window:null,JSON:JSON,Promise:Promise,SupabaseAuth:{getState:function(){return {user:authUser?{id:authUser}:null};}}};
sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
var gate=sandbox.ConferenceActivationAuthorization;
var data={currentConferenceId:'cloud',conferences:[{id:'cloud',name:'ميمي ورامي'},{id:'legacy',name:'Legacy'},{id:'local',name:'Local'}],conferenceLifecycle:{records:{local:{localConferenceId:'local',localLifecycle:'active',cloudLifecycle:'local_only',localContentVersion:0,publishMetadata:{requestedByUserId:user}}}}};
var linkStore={get:function(id){return links[id]||null;}};

(async function(){
  gate.capturePersistedCandidate('cloud','indexeddb');
  var incidentSnapshot=JSON.parse(JSON.stringify(data));
  var empty=await gate.reconcileStartup({appData:data,persistedCandidate:'cloud',discovered:[],links:linkStore,validateCloud:function(){throw new Error('must not run');}});
  assert.strictEqual(empty.classification,'unauthorized_linked');
  assert.strictEqual(gate.canDisplay('cloud'),false);
  assert.strictEqual(gate.canReadProtected('cloud'),false);
  assert.strictEqual(gate.canEdit('cloud'),false);
  assert.strictEqual(gate.canSync('cloud'),false);
  assert.strictEqual(gate.getCurrentState().localConferenceId,'');
  assert.strictEqual(data.conferences.length,3);
  assert.strictEqual(data.conferences[0].name,'ميمي ورامي');
  assert.deepStrictEqual(data,incidentSnapshot);
  var deniedPersistence=gate.preparePersistedAppData({currentConferenceId:null,conferences:data.conferences});
  assert.strictEqual(deniedPersistence.currentConferenceId,'cloud');
  assert.strictEqual(deniedPersistence.conferences[0].name,'ميمي ورامي');

  gate.capturePersistedCandidate('legacy','localStorage');
  var legacy=await gate.reconcileStartup({appData:data,persistedCandidate:'legacy',discovered:[],links:linkStore});
  assert.strictEqual(legacy.classification,'unverified_legacy_unscoped');
  assert.strictEqual(gate.canEdit('legacy'),false);

  gate.capturePersistedCandidate('local','indexeddb');
  var local=await gate.reconcileStartup({appData:data,persistedCandidate:'local',discovered:[],links:linkStore});
  assert.strictEqual(local.classification,'authorized_local_only');
  assert.strictEqual(gate.canDisplay('local'),true);
  assert.strictEqual(gate.canEdit('local'),true);
  assert.strictEqual(gate.canSync('local'),false);

  authUser=other;
  assert.strictEqual(gate.canDisplay('local'),false);
  var wrong=gate.authorizeLocalOnly(data,'local');
  assert.strictEqual(wrong.classification,'unverified_legacy_unscoped');

  authUser=user;gate.resetForAccount(user);gate.capturePersistedCandidate('cloud','indexeddb');
  var viewer=await gate.reconcileStartup({appData:data,persistedCandidate:'cloud',discovered:[{remoteConferenceId:links.cloud.remoteConferenceId}],links:linkStore,validateCloud:function(){return Promise.resolve({ok:true,status:'authorized',data:{role:'viewer'}});}});
  assert.strictEqual(viewer.classification,'authorized_cloud_linked');
  assert.strictEqual(gate.canDisplay('cloud'),true);
  assert.strictEqual(gate.canReadProtected('cloud'),true);
  assert.strictEqual(gate.canEdit('cloud'),false);
  assert.strictEqual(gate.canSync('cloud'),false);

  var revoked=gate.deactivate('cloud','unauthorized_linked','membership_revoked',links.cloud.remoteConferenceId);
  assert.strictEqual(revoked.classification,'unauthorized_linked');
  assert.strictEqual(gate.canDisplay('cloud'),false);
  assert.strictEqual(gate.canReadProtected('cloud'),false);
  assert.strictEqual(gate.canEdit('cloud'),false);
  assert.strictEqual(gate.canSync('cloud'),false);
  assert.strictEqual(data.conferences.length,3);

  var owner=gate.authorizeCloud({localConferenceId:'cloud',remoteConferenceId:links.cloud.remoteConferenceId,authenticatedUserId:user,role:'owner'});
  assert.strictEqual(owner.capabilities.edit,true);
  assert.strictEqual(owner.capabilities.sync,true);
  console.log('conference activation authorization phase 1 tests: passed');
})().catch(function(error){console.error(error);process.exitCode=1;});
