'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const script=fs.readFileSync('script.js','utf8');
const state=fs.readFileSync('state.js','utf8');
const core=fs.readFileSync('core.js','utf8');
const houses=fs.readFileSync('houseTemplates.js','utf8');
const editor=fs.readFileSync('js/conference-template-houses-editor.js','utf8');

function body(source,name,next){
  const start=source.indexOf('function '+name+'(');
  assert.notEqual(start,-1,name+' exists');
  const end=next?source.indexOf('function '+next+'(',start+1):source.length;
  return source.slice(start,end<0?source.length:end);
}

test('template writes send drafts and wait for canonical hydration',()=>{
  assert.match(state,/options\.payload[\s\S]*library\.mutate\(type,id,action,payload\)/);
  assert.match(body(script,'saveTemplate','restoreStoredCanonicalConference'),/action:'upsert',payload:conferenceTemplate/);
  assert.doesNotMatch(body(script,'saveTemplate','restoreStoredCanonicalConference'),/appData\.templates\.push/);
  assert.match(editor,/var template=clone\(source\)/);
  assert.match(editor,/action:'upsert',payload:template/);
  assert.doesNotMatch(editor,/template\.data\.houses=before/);
  assert.doesNotMatch(houses,/appData\s*=\s*previousAppData/);
  for(const name of ['saveTemplateFloor','saveTemplateRoom','saveHouseTemplate','duplicateHouseTemplate']){
    assert.match(body(script,name),/action:'upsert',payload:/,name);
  }
  assert.doesNotMatch(body(script,'saveHouseTemplate','deleteHouseTemplate'),/appData\.houseTemplates(?:\.push|\s*=)/);
  assert.doesNotMatch(body(script,'deleteHouseTemplate','duplicateHouseTemplate'),/appData\.houseTemplates\s*=/);
  assert.doesNotMatch(body(script,'duplicateHouseTemplate','openHouseTemplateEditor'),/appData\.houseTemplates\.push/);
});

test('legacy conference backup and archive paths fail closed',()=>{
  const archived=body(core,'archiveCurrentConference','createEmptyTrashStructure');
  const backedUp=body(core,'backupAppData');
  assert.doesNotMatch(archived,/appData\.archives\s*=|archives\.push/);
  assert.doesNotMatch(backedUp,/appData\.backups\.push/);
  assert.match(archived,/return false/);
  assert.match(backedUp,/return false/);
  const restore=body(script,'restoreStoredCanonicalConference','restoreBackup');
  assert.match(restore,/document\.type!=='conference-canonical-bundle'/);
  assert.match(restore,/service\.parse\(JSON\.stringify\(document\)\)/);
  assert.match(restore,/service\.validate\(bundle,\{mode:'new'\}\)/);
  assert.doesNotMatch(body(script,'restoreBackup','restoreArchive'),/appData\s*=/);
  assert.doesNotMatch(body(script,'restoreArchive','getCanonicalConferenceCoreLink'),/appData\.conferences\.push/);
});

test('settings separates canonical bundle from independent full backup',()=>{
  const settings=script.slice(script.indexOf('function renderSettings('),script.indexOf('function renderTrashSection('));
  assert.match(settings,/exportJsonFile\(\)/);
  assert.match(settings,/settingsConferenceBundleInput/);
  assert.match(settings,/downloadFullApplicationBackup\(\)/);
  assert.match(settings,/inspectFullApplicationBackup\(event\)/);
  assert.doesNotMatch(settings,/backupAppData\(\)|archiveCurrentConference\(\)|restoreBackup\(|restoreArchive\(|saveToFile\(\)/);
  assert.doesNotMatch(settings,/عدد النسخ الاحتياطية|عدد العناصر المؤرشفة/);
  assert.doesNotMatch(script,/accept="\.html,\.json"/);
});
