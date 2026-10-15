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

test('apology and removal cascade through the canonical accommodation cleanup function',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260929160000_canonical_conference_participation_accommodation_propagation.sql'),'utf8');
 assert.match(sql,/create function platform_private\.cleanup_conference_accommodation_for_participation/);
 assert.match(sql,/delete from public\.conference_accommodation_occupancies where id=v_occupancy\.id/);
 assert.match(sql,/if v_current\.status='active' and p_status='apologized' then\s*perform platform_private\.cleanup_conference_accommodation_for_participation/);
 assert.match(sql,/'participation_deleted',p_operation_id/);
 assert.match(sql,/conference\.accommodation\.participation_cleanup/);
});
test('Reservations update is a revision-guarded central person write with module permission',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261012200000_reservations_shared_people_permission_scope_fix.sql'),'utf8');
 assert.match(sql,/require_effective_module_permission\(p_device_id,'reservations','reservations\.people\.manage',null,null\)/);
 assert.match(sql,/update platform\.people set full_name=/);
 assert.match(sql,/where id=v_person_id and revision=\(p_args->>'p_person_update_revision'\)::bigint/);
 assert.match(sql,/PERSON_REVISION_CONFLICT/);
});

test('central person date of birth selection normalizes ISO timestamp for HTML date field',()=>{
 assert.match(ui,/ge\('person_date_of_birth'\)\.value=String\(person\.dateOfBirth\|\|''\)\.slice\(0,10\)/);
});

test('conference UI displays derived age while retaining birth date entry for canonical persistence',()=>{
 assert.match(ui,/function canonicalPersonAgeFromBirthDate/);
 assert.match(ui,/ge\('person_age'\)\.value=canonicalPersonAgeFromBirthDate\(person\.dateOfBirth\)/);
 assert.match(ui,/ge\('person_date_of_birth_field'\)\.style\.display=linked\?'':'none'/);
 assert.match(ui,/ge\('person_age'\)\.disabled=linked/);
 assert.match(html,/السن للعرض فقط في البنك المركزي/);
});

test('canonical birth date is editable on create, saved once, and age recalculated from it',()=>{
 assert.match(html,/تاريخ الميلاد \(يُحفظ لحساب السن تلقائيًا\)/);
 assert.match(html,/oninput="refreshCanonicalPersonAge\(\)"/);
 assert.match(ui,/function refreshCanonicalPersonAge\(\)/);
 assert.match(ui,/ge\('person_age'\)\.value=canonicalPersonAgeFromBirthDate\(ge\('person_date_of_birth'\)\.value\)/);
 assert.match(ui,/dateOfBirth:ge\('person_date_of_birth'\)\.value\|\|null/);
});

test('conference central person editing uses guarded device dispatch and revision',()=>{
 assert.match(integration,/invokeProtected\('conference','update_conference_canonical_person'/);
 assert.match(integration,/p_expected_revision:expectedRevision/);
 assert.match(ui,/تحديث بيانات الشخص في الدليل المركزي؟/);
 assert.match(ui,/PERSON_REVISION_CONFLICT/);
});

test('editing a selected canonical person does not reset identity or reopen a stale dialog',()=>{
 assert.match(ui,/if\(ge\('personDialogId'\)\.value\)return;/);
 assert.match(ui,/editGeneration!==canonicalPersonSearchGeneration/);
});

test('canonical person edit prevents duplicate writes and requires a valid revision and full name',()=>{
 assert.match(ui,/if\(canonicalPersonSavePending\)return false/);
 assert.match(ui,/canonicalPersonSavePending=true/);
 assert.match(ui,/\.finally\(function\(\)\{canonicalPersonSavePending=false;\}\)/);
 assert.match(ui,/snapshot\.revision<1/);
});

test('canonical edit fetches exact person id rather than an ambiguous name search',()=>{
 assert.match(integration,/invokeProtected\('conference','get_conference_canonical_person'/);
 assert.match(ui,/getConferenceCanonicalPerson\(current\.id,selected\.personId\)/);
});

test('canonical person modal cannot be replaced or closed while update is pending',()=>{
 assert.match(ui,/function closePersonDialog\(\)\{\s*if\(canonicalPersonSavePending\)return false/);
 assert.match(ui,/function openPersonDialog\(personId\)\{\s*if\(canonicalPersonSavePending\)return false/);
 assert.match(ui,/canonicalPersonSavePending=false;closePersonDialog\(\);renderSettings\(\)/);
});

test('conference and reservations share one revision-guarded platform person writer',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261014230000_shared_canonical_person_update.sql'),'utf8');
 const scope=fs.readFileSync(path.join(root,'supabase/migrations/20261014231000_shared_person_conference_scope_guard.sql'),'utf8');
 assert.match(sql,/create function platform_private\.update_canonical_person/);
 assert.match(sql,/where id=p_person_id and revision=p_expected_revision/);
 assert.match(sql,/PERSON_REVISION_CONFLICT/);
 assert.match(sql,/platform\.audit_events/);
 assert.match(sql,/create or replace function public\.update_conference_canonical_person/);
 assert.match(sql,/return platform_private\.update_canonical_person\(p_actor_device_id/);
 assert.match(sql,/pg_get_functiondef\('reservations_private\.mutate_scoped/);
 assert.match(sql,/perform platform_private\.update_canonical_person\(p_device_id,v_actor,v_person_id/);
 assert.match(sql,/PERSON_UPDATE_ARGUMENT_UNKNOWN/);
 assert.match(scope,/require_conference_participation_context/);
 assert.match(scope,/CONFERENCE_PERSON_NOT_PARTICIPATING/);
 assert.match(scope,/SHARED_PERSON_SCOPE_ANCHOR_NOT_UNIQUE/);
});

test('conference change cursor advances only after canonical projections refresh',()=>{
 const source=integration.slice(integration.indexOf('function pollConferenceChanges('),integration.indexOf('function startConferenceChangeWatch('));
 assert.match(source,/if\(!changed\.length\)\{watch\.eventId=newest\|\|previous;return null;\}/);
 assert.match(source,/return Promise\.all\(refresh\)\.then\(function\(\)\{if\(conferenceChangeWatch===watch&&epoch===sessionEpoch\)\{watch\.eventId=newest\|\|previous;notifyConferenceSourceChange\(watch,changed\);\}\}\)/);
 assert.doesNotMatch(source,/watch\.eventId=newest\|\|previous;conferenceActivities/);
 assert.match(source,/\.catch\(function\(\)\{\}\)\.then\(function\(\)\{if\(conferenceChangeWatch!==watch\)return;watch\.inFlight=false;scheduleConferenceChangeWatch\(watch\);\}\)/);
});
