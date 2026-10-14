'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'script.js'),'utf8');
const integration=fs.readFileSync(path.join(root,'js/platform-integration.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const searchSql=fs.readFileSync(path.join(root,'supabase/migrations/20261014182000_conference_people_search_canonical_device_route.sql'),'utf8');
test('canonical conference people search stays behind device-scoped permission and single router',()=>{
 assert.match(searchSql,/require_conference_participation_context/);
 assert.match(searchSql,/conference\.people\.view/);
 assert.match(searchSql,/route_canonical_conference_operation/);
 assert.match(searchSql,/revoke all on function public\.search_conference_people/);
 assert.match(integration,/invokeProtected\('conference','search_conference_people'/);
});
test('existing person is added as participation without creating another central person',()=>{
 assert.match(integration,/createConferenceParticipationForExistingPerson\(localId,personId\)/);
 assert.match(integration,/CANONICAL_CONFERENCE_PERSON_ALREADY_PARTICIPATING/);
 assert.match(integration,/mutateParticipation\(localId,'create_conference_participation'/);
 assert.match(ui,/createConferenceParticipationForExistingPerson\(linkedCurrent\.id,canonicalPersonSelectedId\)/);
 assert.match(ui,/createConferenceParticipationWithPerson\(linkedCurrent\.id/);
});
test('person suggestion selection invalidates pending search and cannot silently overwrite central data',()=>{
 assert.match(html,/oninput="searchCanonicalPersonSuggestions\(\)"/);
 assert.match(ui,/option\.onclick=function\(\)\{canonicalPersonSearchGeneration\+\+;/);
 assert.match(ui,/generation!==canonicalPersonSearchGeneration/);
 assert.match(ui,/canonicalPersonSelectedSnapshot/);
 assert.match(ui,/لا يتم تحديث الدليل المركزي تلقائيًا/);
});
test('conference participation status and removal do not delete platform people',()=>{
 assert.match(ui,/setConferenceParticipationStatus\(current\.id,participationId,status\)/);
 assert.match(ui,/deleteConferenceParticipation\(linkedCurrent\.id,participation\.participationId\)/);
 assert.match(integration,/mutateParticipation\(localId,'delete_conference_participation'/);
 assert.match(integration,/current\.items=current\.items\.filter/);
});

test('conference removal explicitly preserves central identity and explains accommodation effect',()=>{
 assert.match(ui,/هل تريد إزالة مشاركة/);
 assert.match(ui,/بياناته ستبقى في بنك الأشخاص المركزي/);
 assert.match(ui,/تم حذف المشاركة من المؤتمر مع الاحتفاظ بالشخص/);
 assert.match(ui,/تم تسجيل الاعتذار وإزالة التسكين إن وُجد/);
});
