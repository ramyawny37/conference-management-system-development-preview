'use strict';
var assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
var root=path.resolve(__dirname,'..');
var source=fs.readFileSync(path.join(root,'js/sync/conference-permission-contract.js'),'utf8');
var sandbox={window:null,Object:Object,Array:Array,String:String,JSON:JSON};
sandbox.window=sandbox;
vm.runInNewContext(source,sandbox,{filename:'conference-permission-contract.js'});
var contract=sandbox.ConferencePermissionContract;
var entries=Array.from(contract.mutationCatalog).concat(Array.from(contract.conferenceMutationCatalog));
var byHandler=Object.create(null);
entries.forEach(function(entry){
  assert.strictEqual(byHandler[entry.handler],undefined,'duplicate '+entry.handler);
  byHandler[entry.handler]=entry;
});
function entry(handler){assert.ok(byHandler[handler],handler);return byHandler[handler];}
function section(handler,sectionName,actions,entity,discriminator){
  var item=entry(handler);
  assert.strictEqual(item.status,'classified',handler+' status');
  assert.strictEqual(item.section,sectionName,handler+' section');
  assert.deepStrictEqual(Array.from(item.action),actions,handler+' action');
  assert.strictEqual(item.entity,entity,handler+' entity');
  assert.strictEqual(item.discriminator||null,discriminator||null,handler+' discriminator');
  assert.strictEqual(item.shadowGate,'pending',handler+' gate phase');
}
function conference(handler,status,action,entity,operation){
  var item=entry(handler);
  assert.strictEqual(item.status,status,handler+' status');
  assert.strictEqual(item.action,action,handler+' action');
  assert.strictEqual(item.entity,entity,handler+' entity');
  assert.strictEqual(item.operation,operation,handler+' operation');
  assert.strictEqual(item.shadowGate,'pending',handler+' gate phase');
}

assert.strictEqual(entries.length,117);
assert.strictEqual(Object.keys(byHandler).length,117);
assert.strictEqual(contract.enforcementEnabled,false);
assert.deepStrictEqual(Array.from(contract.sections),[
  'accommodation','transport','accounts','restaurant','air_conditioning',
  'reports','cards','search','settings','people','templates'
]);
assert.deepStrictEqual(Array.from(contract.actions),[
  'display','read','create','update','delete','export','print','import','sync'
]);
assert.deepStrictEqual(Array.from(contract.roles),[
  'owner','manager','viewer','accommodation_viewer','transport_viewer'
]);
assert.strictEqual(contract.actions.indexOf('share'),-1);
assert.strictEqual(contract.conferenceActions.indexOf('conference.create'),-1);
assert.strictEqual(source.indexOf("'*'"),-1);
assert.strictEqual(entries.filter(function(item){return item.handler==='saveSettings';}).length,1);

section('partialTransferConfirmSelection','accommodation',['update'],'room_occupancy');
assert.strictEqual(entry('partialTransferGuest').status,'flow_entry');
assert.strictEqual(entry('partialTransferGuest').action.length,0);
assert.strictEqual(entry('partialTransferGuest').shadowGate,'phase2b_legacy');
section('updateAccommodationV3Setting','accommodation',['update'],'accommodation_pricing');
section('updateAccommodationV3RoomTypePrice','accommodation',['update'],'accommodation_pricing');

section('resetAccommodationHouseSettings','accounts',['update'],'accommodation_account_settings');
section('resetAccommodationHouseAndRoomsSettings','accounts',['delete'],'accommodation_account_settings');
section('clearAccommodationRoomSettings','accounts',['delete'],'accommodation_account_settings');
section('resetAirConditioningHouseSettings','air_conditioning',['update'],'air_conditioning_account_settings');
assert.strictEqual(entry('resetAirConditioningHouseAndRoomsSettings').status,'unresolved');
assert.strictEqual(entry('clearAirConditioningRoomSettings').status,'unresolved');

var templateFloor=entry('saveTemplateFloor');
assert.strictEqual(templateFloor.status,'compound');
assert.strictEqual(templateFloor.section,'templates');
assert.deepStrictEqual(Array.from(templateFloor.action),['create','update']);
assert.strictEqual(templateFloor.entity,'house_template_floor');
assert.strictEqual(templateFloor.discriminator,'templateFloorDialog.floorId');
assert.strictEqual(templateFloor.operation,'save_and_conditionally_sync_conference_floor');
section('saveTemplateRoom','templates',['create','update'],'house_template_room','templateRoomDialog.roomId');
section('ht_deleteFloorFromTemplate','templates',['delete'],'house_template_floor');
section('ht_deleteRoomFromTemplate','templates',['delete'],'house_template_room');
[
  ['addHouse','create','conference_template_house'],
  ['updateHouse','update','conference_template_house'],
  ['removeHouse','delete','conference_template_house'],
  ['addFloor','create','conference_template_floor'],
  ['updateFloor','update','conference_template_floor'],
  ['removeFloor','delete','conference_template_floor'],
  ['addRoom','create','conference_template_room'],
  ['updateRoom','update','conference_template_room'],
  ['removeRoom','delete','conference_template_room']
].forEach(function(value){section(value[0],'templates',[value[1]],value[2]);});
assert.strictEqual(entry('saveTemplate').entity,'conference_template');
assert.strictEqual(entry('saveHouseTemplate').entity,'house_template');

conference('loadFromFile','flow_entry',null,'conference_file','select_and_parse');
conference('importSingleConferenceData','external_prerequisite',null,'conference','import_or_replace');
conference('applyTemplate','external_prerequisite',null,'conference','create_from_conference_template');
conference('backupAppData','classified','conference.backup_full','application_backup','create_local');
var downloadedBackup=entry('downloadFullApplicationBackup');
assert.strictEqual(downloadedBackup.action,'conference.backup_full');
assert.strictEqual(downloadedBackup.entity,'application_backup');
assert.strictEqual(downloadedBackup.operation,'download_full');
assert.match(downloadedBackup.notes,/Application-wide/);
conference('moveArchiveToTrash','unresolved',null,'conference_archive','move_to_trash');
conference('moveBackupToTrash','unresolved',null,'application_backup','move_to_trash');
conference('repairBackupStorageBloat','unresolved',null,'application_backup','maintenance_rewrite');
assert.strictEqual(entry('restoreTrashItem').entity,'dynamic_trash_item');
assert.strictEqual(entry('restoreTrashItem').discriminator,'type');
assert.strictEqual(entry('purgeTrashItem').entity,'dynamic_trash_item');
assert.strictEqual(entry('purgeTrashItem').discriminator,'type');

var unresolved=[
  'shareSelectedCardsFiles','shareCenterViaSystem','openShareCenterWhatsApp',
  'shareSelectedQueueCard','openSelectedCardsWhatsApp','saveSettings',
  'saveConferenceBranding','clearActivityLog','restoreTrashItem','purgeTrashItem',
  'moveArchiveToTrash','moveBackupToTrash','repairBackupStorageBloat',
  'resetAirConditioningHouseAndRoomsSettings','clearAirConditioningRoomSettings'
].sort();
assert.deepStrictEqual(entries.filter(function(item){return item.status==='unresolved';})
  .map(function(item){return item.handler;}).sort(),unresolved);
assert.strictEqual(entry('createNewConference').status,'flow_entry');
assert.strictEqual(entry('editCurrentConference').status,'flow_entry');
assert.strictEqual(entry('editCurrentConference').shadowGate,'phase2b_legacy');
assert.strictEqual(entry('shareCard').status,'flow_entry');
assert.strictEqual(entry('shareSelectedCards').status,'flow_entry');
var creation=entry('createConferenceFromSelection');
assert.strictEqual(creation.status,'multi_mode');
assert.strictEqual(creation.discriminator,'conferenceDialogMode');
assert.strictEqual(creation.modes.create.status,'external_prerequisite');
assert.strictEqual(creation.modes.create.action,null);
assert.strictEqual(creation.modes.edit.status,'classified');
assert.strictEqual(creation.modes.edit.action,'conference.edit_metadata');
var activity=entry('addActivityLog');
assert.strictEqual(activity.status,'internal_side_effect');
assert.strictEqual(activity.discriminator,'initiating_operation');
assert.strictEqual(activity.shadowGate,'not_applicable');

var activeFiles=['script.js','core.js','js/conference/accounts.js','houseTemplates.js',
  'js/conference-template-houses-editor.js'];
var activeSource=activeFiles.map(function(file){return fs.readFileSync(path.join(root,file),'utf8');}).join('\n');
entries.forEach(function(item){
  assert.ok(activeSource.indexOf('function '+item.handler+'(')>=0,item.handler+' active function');
});
var gates=Array.from(activeSource.matchAll(/ConferencePermissionShadowGate\('([^']+)'/g))
  .map(function(match){return match[1];});
assert.strictEqual(gates.length,73);
assert.strictEqual(new Set(gates).size,73);
entries.filter(function(item){return item.shadowGate==='pending';}).forEach(function(item){
  assert.strictEqual(gates.indexOf(item.handler),-1,item.handler+' must not receive a Phase 2E gate');
});
var script=fs.readFileSync(path.join(root,'script.js'),'utf8');
assert.match(script,/function editCurrentConference\(\)[\s\S]*?openNewConferenceModal\('edit'\)/);
assert.match(script,/function createConferenceFromSelection\(\)[\s\S]*?conferenceDialogMode === 'edit'[\s\S]*?current\.conf/);
assert.match(script,/function saveTemplateFloor\(\)[\s\S]*?templateFloorDialog\.floorId[\s\S]*?refreshConferenceHouseAfterTemplateMutation/);
assert.match(script,/function saveTemplateRoom\(\)[\s\S]*?templateRoomDialog\.roomId/);
assert.match(script,/function shareCard\(k\)\{openShareCenter\(k\)\}/);
assert.match(script,/function shareSelectedCards\(\)[\s\S]*?addActivityLog\('cards_share_started'/);
assert.match(script,/function addActivityLog\([\s\S]*?conference\.activityLog\.unshift\(entry\)[\s\S]*?save\(\)/);

console.log('conference permission catalog phase 2E tests: passed');
