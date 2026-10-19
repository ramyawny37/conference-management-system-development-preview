const fs=require('node:fs');const assert=require('node:assert/strict');const test=require('node:test');
const source=fs.readFileSync('js/supabase/device-enrollment.js','utf8');
const start=source.indexOf('function rerequestRevoked()');
const end=source.indexOf('function ensure(){',start);
test('revoked native device uses fresh canonical enrollment',()=>{
  assert.ok(start>=0&&end>start);
  const flow=source.slice(start,end);
  assert.match(flow,/status\.bindingLifecycle!=='revoked'/);
  assert.match(flow,/return enroll\(auth\)/);
  assert.doesNotMatch(flow,/return rerequest\(record,auth\)/);
});
