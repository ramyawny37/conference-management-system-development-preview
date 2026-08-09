'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260815_6_11_0_launch_membership_integrity.sql'),'utf8');
const ui=fs.readFileSync(path.join(root,'js/sync/user-management-ui.js'),'utf8');
const members=fs.readFileSync(path.join(root,'js/sync/conference-members-service.js'),'utf8');
const device=fs.readFileSync(path.join(root,'js/sync/current-device-authorization-ui.js'),'utf8');
const gate=fs.readFileSync(path.join(root,'js/sync/startup-access-gate.js'),'utf8');
const org=fs.readFileSync(path.join(root,'js/supabase/organization-administration-service.js'),'utf8');
[
  'CONFERENCE_ORGANIZATION_REQUIRED','CONFERENCE_MEMBER_ORGANIZATION_REQUIRED',
  'SECTION_VIEWER_ASSIGNMENT_DISABLED','CONFERENCE_OWNER_ORGANIZATION_MEMBERSHIP_REQUIRED','CONFERENCE_MEMBERS_ORGANIZATION_MEMBERSHIP_REQUIRED',
  'device_guarded_create_organization_conference_idempotent',
  'device_guarded_assign_legacy_conference_organization',
  'legacy_conference_organization_assignments'
].forEach(value=>assert(sql.includes(value),'missing '+value));
assert.match(sql,/new\.role in \('accommodation_viewer','transport_viewer'\)/);
assert.match(sql,/m\.organization_id=organization_id and m\.user_id=new\.user_id/);
assert.doesNotMatch(ui,/\['manager','viewer','accommodation_viewer','transport_viewer'\]\.map/);
assert.match(members,/var allowedRoles=\['manager','viewer'\]/);
assert.match(device,/state\.status!=='pending'/);
assert.match(gate,/device\.status==='pending'\?'بانتظار الاعتماد':'تعذر إنشاء طلب الاعتماد'/);
['stage','rpc','errorCode','sqlstate','actorDevicePresent','actorDeviceApproved','targetAccountApproved','organizationIdPresent'].forEach(field=>assert(org.includes(field),'missing diagnostic '+field));
console.log('launch membership integrity contract: PASS');
