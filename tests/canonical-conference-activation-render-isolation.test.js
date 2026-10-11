'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('script.js','utf8');
const start=source.indexOf('function activatePersistedConferenceById(');
const end=source.indexOf('function downloadFullApplicationBackup(',start);
const activation=source.slice(start,end);
test('conference activation distinguishes essential state steps from nonfatal render steps',()=>{
  assert.ok(start>=0&&end>start);
  assert.match(activation,/runMemberActivationRenderStep\('render_accommodation'/);
  assert.match(activation,/runMemberActivationRenderStep\('render_transports'/);
  assert.match(activation,/runMemberActivationRenderStep\('render_settings'/);
  assert.match(activation,/runMemberActivationRenderStep\('render_current_tab'/);
  assert.match(activation,/runMemberActivationStep\(steps\[stepIndex\]\[0\]/);
});
test('render failures are recorded and never classified as activation failure',()=>{
  const helper=source.slice(source.indexOf('function runMemberActivationRenderStep('),start);
  assert.match(helper,/runMemberActivationStep\(stage,callback\)/);
  assert.match(helper,/console\.error/);
  assert.match(helper,/return true/);
  assert.doesNotMatch(helper,/appData\.currentConferenceId\s*=/);
});
