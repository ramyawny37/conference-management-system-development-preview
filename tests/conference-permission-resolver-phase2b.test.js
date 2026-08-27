'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var root=path.resolve(__dirname,'..');
var contractSource=fs.readFileSync(path.join(root,'js/sync/conference-permission-contract.js'),'utf8');
var resolverSource=fs.readFileSync(path.join(root,'js/sync/conference-permission-resolver.js'),'utf8');

function load(overrides){
  var sandbox=Object.assign({window:null,Object:Object,Array:Array,String:String,JSON:JSON},overrides||{});
  sandbox.window=sandbox;
  if(!sandbox.ConferencePermissionContract)vm.runInNewContext(contractSource,sandbox);
  vm.runInNewContext(resolverSource,sandbox);
  return sandbox;
}
function context(role){return {authorizationDecision:{ok:true,role:role}};}

var sandbox=load(),resolver=sandbox.ConferencePermissionResolver;
assert.strictEqual(resolver.enforcementEnabled,false);
assert.strictEqual(resolver.can('accommodation','update',context('owner')),true);
assert.strictEqual(resolver.can('transport','read',context('transport_viewer')),true);
assert.strictEqual(resolver.can('accommodation','read',context('transport_viewer')),false);
assert.strictEqual(resolver.can('unknown','read',context('owner')),false);
assert.strictEqual(resolver.can('accommodation','unknown',context('owner')),false);
assert.strictEqual(resolver.can('accommodation','read',context('unknown')),false);
assert.strictEqual(resolver.can('accommodation','read',context(null)),false);
assert.strictEqual(resolver.can('accommodation','read',{}),false);
assert.strictEqual(resolver.can('accommodation','read',{role:'owner'}),false);
assert.strictEqual(resolver.can('accommodation','read',{authorizationDecision:{ok:false,role:'owner'}}),false);
assert.strictEqual(resolver.can('accommodation','read',{currentConferenceId:'local',role:'owner'}),false);
assert.strictEqual(resolver.can('accommodation','read',{localConference:{id:'local'},lock:{owned:true},visible:true}),false);
assert.strictEqual(resolver.require('accounts','delete',context('viewer')),false);
assert.strictEqual(resolver.canConference('conference.delete',context('owner')),true);
assert.strictEqual(resolver.canConference('conference.delete',context('manager')),false);
assert.strictEqual(resolver.requireConference('conference.unknown',context('owner')),false);

var multi=resolver.resolveHandler('saveHouse','update',context('manager'));
assert.strictEqual(multi.action,'update');
assert.strictEqual(multi.allowed,true);
assert.strictEqual(multi.shouldProceed,true);
assert.strictEqual(resolver.resolveHandler('saveHouse',null,context('manager')).status,'mode_required');
assert.strictEqual(resolver.resolveHandler('shareCard',null,context('owner')).status,'unresolved');
assert.strictEqual(resolver.resolveHandler('createNewConference',null,context('owner')).status,'flow_entry');
assert.strictEqual(resolver.resolveHandler('missingHandler',null,context('owner')).status,'unknown_handler');

var deniedRuntime=load({ConferenceActivationAuthorization:{getCurrentState:function(){return {ok:true,role:'viewer'};}}});
assert.strictEqual(deniedRuntime.ConferencePermissionShadowGate('deleteHouse',null),true);
var diagnostic=deniedRuntime.ConferencePermissionResolver.getDiagnostics().slice(-1)[0];
assert.strictEqual(diagnostic.allowed,false);
assert.strictEqual(diagnostic.enforcementEnabled,false);

var throwingAuthorization={getCurrentState:function(){throw new Error('authorization source failure');}};
var throwingShadowRuntime=load({ConferenceActivationAuthorization:throwingAuthorization});
var handlerContinued=false;
if(throwingShadowRuntime.ConferencePermissionShadowGate('deleteHouse',null))handlerContinued=true;
assert.strictEqual(handlerContinued,true);
var throwingShadowDecision=throwingShadowRuntime.ConferencePermissionResolver.getDiagnostics().slice(-1)[0];
assert.strictEqual(throwingShadowDecision.allowed,false);
assert.strictEqual(throwingShadowDecision.enforcementEnabled,false);
assert.strictEqual(throwingShadowDecision.shouldProceed,true);

var enforcedContract=Object.assign({},sandbox.ConferencePermissionContract,{enforcementEnabled:true});
var throwingEnforcedRuntime=load({
  ConferencePermissionContract:enforcedContract,
  ConferenceActivationAuthorization:throwingAuthorization
});
assert.strictEqual(throwingEnforcedRuntime.ConferencePermissionShadowGate('deleteHouse',null),false);
var throwingEnforcedDecision=throwingEnforcedRuntime.ConferencePermissionResolver.getDiagnostics().slice(-1)[0];
assert.strictEqual(throwingEnforcedDecision.allowed,false);
assert.strictEqual(throwingEnforcedDecision.enforcementEnabled,true);
assert.strictEqual(throwingEnforcedDecision.shouldProceed,false);

var activeSources=['script.js','core.js','js/conference/accounts.js'].map(function(file){
  return fs.readFileSync(path.join(root,file),'utf8');
}).join('\n');
var contract=sandbox.ConferencePermissionContract;
var classified=Array.from(contract.mutationCatalog).concat(Array.from(contract.conferenceMutationCatalog)).filter(function(item){return item.status==='classified';});
classified.forEach(function(item){
  assert.ok(activeSources.indexOf("ConferencePermissionShadowGate('"+item.handler+"'")>=0,item.handler+' shadow gate');
});
['shareCard','shareSelectedCards','shareSelectedCardsFiles','saveSettings','saveConferenceBranding','clearActivityLog','restoreTrashItem','purgeTrashItem','createNewConference','createConferenceFromSelection'].forEach(function(handler){
  assert.strictEqual(activeSources.indexOf("ConferencePermissionShadowGate('"+handler+"'"),-1,handler+' must remain ungated');
});
assert.doesNotMatch(resolverSource,/currentConferenceId|localConference|lock\.owned|frontend|visibility/);
assert.doesNotMatch(resolverSource,/\.rpc\s*\(|Supabase|ConferenceEditLockManager|OfflineSyncQueue/);
console.log('conference permission resolver phase 2B tests: passed');
