const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');

const html=fs.readFileSync('index.html','utf8');
const integration=fs.readFileSync('js/platform-integration.js','utf8');
const gateway=fs.readFileSync('server/platform-gateway.cjs','utf8');

test('shell registers all module cards through the platform contract',()=>{
  for(const id of ['conference','warehouse','reservations','custody'])
    assert.match(html,new RegExp(`data-platform-module="${id}"`));
  assert.match(integration,/\/api\/platform\/context/);
  assert.match(integration,/module\.available===true/);
});

test('gateway is development locked and secret-bearing device credentials stay HttpOnly',()=>{
  assert.match(gateway,/gppwltrifgfxrkzvvxoe/);
  assert.doesNotMatch(gateway,/mpezfbvcdfxpgflehuot/);
  assert.match(gateway,/platform-device-secret/);
  assert.match(gateway,/HttpOnly/);
  assert.match(gateway,/require_module_permission/);
});
