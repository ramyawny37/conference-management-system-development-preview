'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var root=path.resolve(__dirname,'..');
var core=fs.readFileSync(path.join(root,'core.js'),'utf8');
var houses=fs.readFileSync(path.join(root,'houses.js'),'utf8');
var script=fs.readFileSync(path.join(root,'script.js'),'utf8');

function extract(source,name,nextName){
  var start=source.indexOf('function '+name+'(');
  var end=source.indexOf('\nfunction '+nextName+'(',start);
  assert.ok(start>=0&&end>start,name+' source missing');
  return source.slice(start,end);
}
var conference={id:'c1',houses:[{id:'h1',floors:[{id:'f1',rooms:[
  {id:'r1',closed:false,guests:[{id:'p1'}],children:[]},
  {id:'r2',closed:false,guests:[],children:[]}
]}]}],accommodationDisplayedRoomIds:[]};
var conferenceEditAuthorized=false;
var sandbox={window:null,appData:{currentConferenceId:'c1',conferences:[conference]},
  currentConferenceRuntimeActivationDecision:null,
  ConferenceEditLockManager:{canMutateAccommodation:function(){return true;}}};
sandbox.window=sandbox;
vm.runInNewContext([
  extract(core,'getCurrentConference','getConferenceHouseRooms'),
  extract(core,'getConferenceHouseRooms','getSelectedAccommodationRoomIds'),
  extract(core,'getSelectedAccommodationRoomIds','getSelectedAccommodationRooms'),
  extract(core,'getSelectedAccommodationRooms','getOpenSelectedAccommodationRooms'),
  extract(core,'getAllRooms','getRoomBaseCapacity'),
  extract(houses,'ensureAccommodationDisplayState','getAccommodationRoomsPreflight'),
  extract(houses,'commitAccommodationDisplayChange','saveHouseData')
].join('\n'),sandbox);

assert.strictEqual(sandbox.getAllRooms().length,0,
  'legacy empty state reproduces the hidden-room failure before initialization');
var displayed=sandbox.ensureAccommodationDisplayState(conference);
assert.deepStrictEqual(Object.keys(displayed).sort(),['r1','r2']);
assert.strictEqual(sandbox.getAllRooms().length,2);
assert.strictEqual(conference.accommodationDisplayStateInitialized,true);
sandbox.commitAccommodationDisplayChange(conference,[],[]);
assert.strictEqual(sandbox.getAllRooms().length,0,
  'an explicitly empty user selection must remain empty');
sandbox.ensureAccommodationDisplayState(conference);
assert.strictEqual(sandbox.getAllRooms().length,0,
  'initialized state must not be repopulated after activation or render');

var ownerSelection={id:'c2',houses:[{id:'h2',floors:[{id:'f2',rooms:[
  {id:'active-room',closed:false},{id:'deleted-room',closed:false}
]}]}],accommodationDisplayedRoomIds:['active-room']};
sandbox.appData={currentConferenceId:'c2',conferences:[ownerSelection]};
sandbox.ensureAccommodationDisplayState(ownerSelection);
assert.deepStrictEqual(Array.from(ownerSelection.accommodationDisplayedRoomIds),
  ['active-room'],'a room removed by the owner must not be reintroduced');
assert.strictEqual(sandbox.getAllRooms().length,1);
assert.strictEqual(sandbox.getAllRooms()[0].id,'active-room');

vm.runInNewContext(
  extract(script,'getAccommodationPersonDisplayName',
    'canEditCurrentConferenceAccommodation')+'\n'+
  extract(script,'canEditCurrentConferenceAccommodation','beginAccommodationEditing'),
  sandbox
);
sandbox.getPersonById=function(id){
  return id==='p1'?{id:'p1',fullName:'Member Name'}:null;
};
assert.strictEqual(sandbox.getAccommodationPersonDisplayName({personId:'p1'}),
  'Member Name');
assert.strictEqual(sandbox.getAccommodationPersonDisplayName({id:'p1'}),
  'Member Name');
assert.strictEqual(sandbox.getAccommodationPersonDisplayName({personId:'missing'}),
  '','an invalid personId must not break name rendering');
sandbox.currentConferenceRuntimeActivationDecision={ok:true,active:true,conferenceId:'c2',capabilities:{edit:false},role:null};
assert.strictEqual(sandbox.canEditCurrentConferenceAccommodation(),false);
sandbox.currentConferenceRuntimeActivationDecision={ok:true,active:true,conferenceId:'c2',capabilities:{edit:true},role:null};
assert.strictEqual(sandbox.canEditCurrentConferenceAccommodation(),true);

var renderStart=script.indexOf('function renderAccommodation()');
var renderEnd=script.indexOf('\nfunction deactivateAccommodationRoom(',renderStart);
var renderBody=script.slice(renderStart,renderEnd);
assert.ok(renderBody.includes('renderCanonicalAccommodation(canonicalAccommodationState())'),
  'active rendering must delegate to canonical accommodation state');
assert.ok(!renderBody.includes('ensureAccommodationDisplayState(current)')&&!renderBody.includes('getAllRooms()'),
  'active rendering must not rebuild or read the legacy local room selection');
var canonicalStart=script.indexOf('function renderCanonicalAccommodation(');
var canonicalBody=script.slice(canonicalStart,renderStart);
assert.ok(canonicalBody.includes("var canManage=currentConferenceSectionCapability('accommodationManage')"),
  'canonical room actions must use the protected accommodation capability');
assert.ok(canonicalBody.includes("+(canManage?'<div class=\"row\""),
  'read-only canonical rendering must omit administrative room actions');
console.log('accommodation display state tests: passed');
