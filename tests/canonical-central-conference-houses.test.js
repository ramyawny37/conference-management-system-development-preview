"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),test=require("node:test"),vm=require("node:vm");
const sql=fs.readFileSync("supabase/migrations/20261020143000_canonical_central_conference_houses.sql","utf8");
const edge=fs.readFileSync("supabase/functions/platform-device-operation/index.ts","utf8");
const ui=fs.readFileSync("script.js","utf8");
test("one permanent hierarchy and conference assignment own separate state",()=>{
 assert.match(sql,/alter table public\.conference_accommodation_houses drop column conference_id/);
 assert.match(sql,/create table public\.conference_house_assignments/);
 assert.match(sql,/unique\(conference_id,house_id\)/);
 assert.match(sql,/HOUSE_ASSIGNMENT_HAS_OCCUPANCIES/);
 assert.match(sql,/HOUSE_CONFERENCE_PERIOD_OVERLAP/);
 assert.doesNotMatch(sql,/create table public\.conference_houses/);
});
test("directory and assignment are protected, audited, revisioned and idempotent",()=>{
 for(const operation of ["list_conference_houses","mutate_conference_house_directory","assign_conference_house"])assert.ok(edge.includes("'"+operation+"'"),operation);
 for(const permission of ["conference.houses.view","conference.houses.manage","conference.accommodation.manage"])assert.ok(sql.includes(permission),permission);
 assert.match(sql,/operation_id=p_operation_id/);
 assert.match(sql,/HOUSE_REVISION_CONFLICT/);
 assert.match(sql,/insert into platform\.audit_events/);
 assert.match(sql,/APPROVED_DEVICE_SESSION_REQUIRED/);
});
test("runtime selects central houses and no longer exposes conference structure creation",()=>{
 assert.match(ui,/اختيار بيت من بيوت المؤتمرات/);
 assert.match(ui,/CanonicalConferenceHouses\.assign/);
 assert.doesNotMatch(edge,/['"]create_accommodation_house['"]/);
 assert.doesNotMatch(edge,/['"]create_accommodation_room['"]/);
});
test("central client confirms server writes and refreshes without local fallback",async()=>{
 const source=fs.readFileSync("js/platform-integration.js","utf8");
 assert.match(source,/invokeProtected\('conference','mutate_conference_house_directory'/);
 assert.match(source,/invokeProtected\('conference','assign_conference_house'/);
 assert.match(source,/registerOperationalSyncTask\('conference_houses',15000/);
 assert.doesNotMatch(source,/conferenceHouseDirectory\s*=\s*global\.appData/);
});
