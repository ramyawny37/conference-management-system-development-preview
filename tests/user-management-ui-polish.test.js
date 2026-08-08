'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'js/sync/user-management-ui.js'),'utf8');
const css=fs.readFileSync(path.join(root,'style.css'),'utf8');

[
  'user-management-summary-stats','user-management-card-list',
  'user-management-item-card','user-management-device-meta',
  'user-management-current-device','user-management-skeleton'
].forEach(name=>assert.ok(ui.includes(name)||css.includes('.'+name),name));
['لا توجد مؤسسة.','لا توجد مؤتمرات.','لا توجد أجهزة.']
  .forEach(text=>assert.ok(ui.includes(text),text));
assert.match(ui,/onchange="UserManagementUI\.selectOrganizationRole/);
assert.match(ui,/onclick="UserManagementUI\.manageOrganization[^\n]+حفظ الدور/);
assert.match(ui,/onchange="UserManagementUI\.selectConferenceRole/);
assert.match(ui,/onclick="UserManagementUI\.manageConference[^\n]+>حفظ</);
assert.doesNotMatch(ui,/onchange="UserManagementUI\.manageOrganization/);
assert.doesNotMatch(ui,/onchange="UserManagementUI\.manageConference/);
assert.match(css,/@media\(max-width:760px\)/);
assert.match(css,/overflow-wrap:anywhere/);
assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css,/user-management-sections\{grid-template-columns:1fr\}/);
console.log('user management UI polish contract tests: passed');
