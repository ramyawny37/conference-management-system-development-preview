'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const script=fs.readFileSync('script.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('style.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261015143000_conference_section_manage_capabilities.sql','utf8');
function body(name,next){const start=script.indexOf('function '+name+'('),end=script.indexOf('\nfunction '+next+'(',start);assert.ok(start>=0&&end>start);return script.slice(start,end);}
test('discovery resolves view and manage independently and preserves protected ACL',()=>{
  assert.match(sql,/conference\.people\.view','people'/);
  assert.match(sql,/conference\.people\.manage','peopleManage'/);
  assert.match(sql,/conference\.accommodation\.view','accommodation'/);
  assert.match(sql,/conference\.accommodation\.manage','accommodationManage'/);
  assert.match(sql,/require_current_approved_device/);
  assert.match(sql,/require_effective_module_permission/);
  assert.match(sql,/revoke all on function public\.list_accessible_conferences\(uuid\)/);
  assert.doesNotMatch(sql,/conference\.members\.manage/);
});
test('people renderer distinguishes denied, failed and genuinely empty while manage gates every action',()=>{
  const source=body('renderPeopleDatabaseSection','canonicalParticipantMetaText');
  assert.match(source,/currentConferenceSectionCapability\('people'\)/);
  assert.match(source,/currentConferenceSectionCapability\('peopleManage'\)/);
  assert.match(source,/ليس لديك صلاحية مشاهدة الأشخاص/);
  assert.match(source,/تعذر تحميل بيانات الأشخاص/);
  assert.match(source,/لا توجد بيانات أشخاص بعد/);
  assert.match(body('openPersonDialog','closePersonDialog'),/peopleManage/);
  assert.match(body('deleteCanonicalConferenceParticipation','deleteLocalOnlyPersonFromDatabase'),/peopleManage/);
  assert.match(body('setCanonicalParticipantStatus','openQuickAddPersonForGuest'),/peopleManage/);
});
test('accommodation renderer has denied, loading, empty, error and retry states and hides mutation controls for viewers',()=>{
  const render=body('renderCanonicalAccommodation','renderAccommodation');
  const entry=body('renderAccommodation','deactivateAccommodationRoom');
  assert.match(entry,/ليس لديك صلاحية مشاهدة التسكين/);
  assert.match(render,/loadState\.status==='loading'/);
  assert.match(render,/تعذر تحميل بيانات التسكين/);
  assert.match(render,/retryCanonicalConferenceAccommodation/);
  assert.match(render,/if\(!houses\.length\)/);
  assert.match(render,/if\(canManage\)/);
  assert.match(body('chooseCanonicalConferenceHouse','closeCanonicalConferenceHouseSelector'),/accommodationManage/);
});
test('person dialog has an isolated visible stacking context and accessible close control',()=>{
  assert.match(html,/id="personModal"[\s\S]*role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(html,/class="person-modal-close"[\s\S]*aria-label="إغلاق"/);
  assert.match(css,/#personModal\{z-index:10030;isolation:isolate/);
  assert.match(css,/#personModal \.modal\{position:relative;z-index:1/);
  assert.match(body('openPersonDialog','closePersonDialog'),/person_full_name'\)\.focus/);
});
