'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var root=path.resolve(__dirname,'..');
var contractSource=fs.readFileSync(path.join(root,'js/sync/conference-permission-contract.js'),'utf8');
var activationPath=path.join(root,'js/sync/conference-activation-authorization.js');
var activationBefore=fs.readFileSync(activationPath,'utf8');
var sandbox={window:null,Object:Object,Array:Array,String:String,JSON:JSON};
sandbox.window=sandbox;
vm.runInNewContext(contractSource,sandbox,{filename:'conference-permission-contract.js'});
var contract=sandbox.ConferencePermissionContract;

assert.deepStrictEqual(Array.from(contract.sections),[
  'accommodation','transport','accounts','restaurant','air_conditioning',
  'reports','cards','search','settings','people','templates'
]);
assert.deepStrictEqual(Array.from(contract.actions),[
  'display','read','create','update','delete','export','print','import','sync'
]);
assert.deepStrictEqual(Object.keys(contract.roleBundles).sort(),[
  'accommodation_viewer','manager','owner','transport_viewer','viewer'
]);
assert.deepStrictEqual(Array.from(contract.roles).sort(),Object.keys(contract.roleBundles).sort());
assert.strictEqual(contract.hasSectionPermission('unknown','accommodation','read'),false);
assert.strictEqual(contract.hasSectionPermission('owner','unknown','read'),false);
assert.strictEqual(contract.hasSectionPermission('owner','accommodation','unknown'),false);
assert.strictEqual(contract.hasSectionPermission(null,'accommodation','read'),false);
assert.strictEqual(contract.hasSectionPermission('transport_viewer','accommodation','read'),false);
assert.strictEqual(contract.hasConferencePermission('viewer','conference.delete'),false);
assert.strictEqual(contract.hasConferencePermission('owner','unknown'),false);
assert.strictEqual(contract.enforcementEnabled,false);
assert.strictEqual(contract.hasSectionPermission('owner','search','delete'),false);
assert.strictEqual(contract.hasSectionPermission('manager','reports','sync'),false);
assert.strictEqual(contract.hasSectionPermission('owner','cards','import'),false);
assert.strictEqual(contract.hasSectionPermission('manager','air_conditioning','create'),false);
assert.strictEqual(contract.hasSectionPermission('manager','transport','sync'),false);
assert.deepStrictEqual(Array.from(contract.roleBundles.viewer.sections.accounts),['display','read']);
assert.deepStrictEqual(Object.keys(contract.roleBundles.accommodation_viewer.sections),['accommodation']);
assert.deepStrictEqual(Object.keys(contract.roleBundles.transport_viewer.sections),['transport']);
Object.keys(contract.roleBundles).forEach(function(role){
  Object.keys(contract.roleBundles[role].sections).forEach(function(section){
    assert.strictEqual(contract.roleBundles[role].sections[section].indexOf('*'),-1);
  });
});

assert.strictEqual(contract.actions.indexOf('lock_ownership'),-1);
assert.strictEqual(contract.lockSemantics,'concurrency_precondition_only');
assert.ok(contract.semanticBoundaries.indexOf('lock_ownership')>=0);
assert.ok(contract.nonAuthorizationSignals.indexOf('currentConferenceId')>=0);
assert.ok(contract.nonAuthorizationSignals.indexOf('null_role')>=0);
assert.ok(contract.nonAuthorizationSignals.indexOf('local_presence')>=0);
assert.ok(contract.nonAuthorizationSignals.indexOf('frontend_visibility')>=0);

assert.ok(contract.conferenceActions.every(function(action){return action.indexOf('conference.')===0;}));
assert.ok(contract.actions.every(function(action){return action.indexOf('conference.')!==0;}));
assert.notStrictEqual(contract.actions.indexOf('read'),-1);
assert.notStrictEqual(contract.actions.indexOf('export'),-1);
assert.notStrictEqual(contract.actions.indexOf('print'),-1);
assert.strictEqual(contract.actions.indexOf('share'),-1);
assert.deepStrictEqual(Array.from(contract.futureActionCandidates),['share']);
assert.ok(contract.mutationCatalog.some(function(item){return item.status==='unresolved';}));
assert.ok(contract.mutationCatalog.every(function(item){
  return item.status==='unresolved'||
    contract.sections.indexOf(item.section)>=0&&item.action.length>0&&
      item.action.every(function(action){return contract.actions.indexOf(action)>=0;});
}));
var completeCatalog=contract.mutationCatalog.concat(contract.conferenceMutationCatalog);
var handlerNames=completeCatalog.map(function(item){return item.handler;});
assert.strictEqual(completeCatalog.length,83);
assert.strictEqual(new Set(handlerNames).size,83);
assert.strictEqual(handlerNames.filter(function(name){return name==='saveSettings';}).length,1);
['saveHouse','saveTransport','saveFinancialV3Adjustment',
  'saveRestaurantV3PriceOverride','saveRestaurantV3CountOverride',
  'saveRestaurantV3PersonOverride','savePersonDialog','saveHouseTemplate'
].forEach(function(handler){
  var entry=contract.mutationCatalog.filter(function(item){return item.handler===handler;})[0];
  assert.deepStrictEqual(Array.from(entry.action),['create','update'],handler);
});
contract.conferenceMutationCatalog.forEach(function(item){
  if(item.action!==null)assert.ok(contract.conferenceActions.indexOf(item.action)>=0,item.handler);
});
var createFlow=contract.conferenceMutationCatalog.filter(function(item){return item.handler==='createNewConference';})[0];
assert.strictEqual(createFlow.action,null);
assert.strictEqual(createFlow.status,'flow_entry');
var unresolvedHandlers=Array.from(completeCatalog.filter(function(item){return item.status==='unresolved';}).map(function(item){return item.handler;})).sort();
assert.deepStrictEqual(unresolvedHandlers,[
  'clearActivityLog','purgeTrashItem','restoreTrashItem','saveConferenceBranding',
  'saveSettings','shareCard','shareSelectedCards','shareSelectedCardsFiles'
].sort());
assert.ok(contract.conferenceMutationCatalog.some(function(item){
  return item.handler==='deleteCurrentConference'&&item.action==='conference.delete';
}));

var activeSource=['script.js','core.js','js/conference/accounts.js'].map(function(file){
  return fs.readFileSync(path.join(root,file),'utf8');
}).join('\n');
handlerNames.forEach(function(handler){
  assert.ok(activeSource.indexOf('function '+handler+'(')>=0,handler+' must exist in active source');
});

var index=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert.match(index,/conference-permission-contract\.js\?rev=permission-contract-phase2a-v1/);
assert.ok(index.indexOf('conference-permission-contract.js')<index.indexOf('conference-activation-authorization.js'));
assert.strictEqual(fs.readFileSync(activationPath,'utf8'),activationBefore);
assert.doesNotMatch(contractSource,/ConferenceActivationAuthorization|ConferenceEditLockManager|OfflineSyncQueue|\.rpc\s*\(/);
console.log('conference permission contract phase 2A tests: passed');
