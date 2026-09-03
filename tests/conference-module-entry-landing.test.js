const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('script.js','utf8');
const tabState=source.slice(
  source.indexOf('var LAST_APPLICATION_TAB_KEY'),
  source.indexOf('function resetAdministrativeViewScroll')
);
const workspace=source.slice(
  source.indexOf('function openConferenceWorkspace'),
  source.indexOf('function renderTab')
);
const settingsRendering=source.slice(
  source.indexOf('function renderSettings()'),
  source.indexOf('function renderHouseTemplatesSettings()')
);

function runtime(storedTab){
  const calls=[];
  const storage={last:String(storedTab),removed:0};
  let ready=true;
  const elements={
    startupScreen:{classList:{add() {}}},
    conferenceWorkspace:{focus() {}}
  };
  const sandbox={window:null,browserStorageNamespace:{key:value=>value},
    localStorage:{getItem(key){return key==='conference_manager_last_tab'
      ?storage.last:null;},setItem(key,value){if(key==='conference_manager_last_tab')
      storage.last=String(value);},removeItem(){storage.removed+=1;}},
    document:{querySelectorAll(){return Array.from({length:7},()=>({style:{}}));}},
    ge:id=>elements[id]||{style:{}},isFinite,parseInt,
    getApplicationTabIdByName:name=>name==='settings'?6:null,
    getStoredSettingsInternalView:()=>'',resetAdministrativeViewScroll(){},
    refreshOrganizationMembersSection(){},settingsTab:'general'};
  sandbox.window=sandbox;
  sandbox.switchTab=function(tabId){
    calls.push(tabId);
    if(!ready)return false;
    sandbox.saveLastTab(tabId);
    return true;
  };
  vm.runInNewContext(tabState+'\n'+workspace,sandbox);
  return {sandbox,calls,storage,setReady:value=>{ready=value;}};
}

for(const previousTab of [6,5,2,3,4,1]){
  test(`explicit Conference entry replaces persisted tab ${previousTab} with tab 0`,()=>{
    const state=runtime(previousTab);
    assert.strictEqual(state.sandbox.openConferenceWorkspace(
      {explicitModuleEntry:true}),true);
    assert.strictEqual(state.sandbox.restoreLastApplicationTab(),true);
    assert.deepStrictEqual(state.calls,[0]);
    assert.strictEqual(state.storage.last,'0');
    assert.strictEqual(state.storage.removed,0);
  });
}

test('ordinary authorized restoration preserves the current persisted tab',()=>{
  const state=runtime(6);
  state.sandbox.restoreLastApplicationTab();
  assert.deepStrictEqual(state.calls,[6]);
  assert.strictEqual(state.storage.last,'6');
});

test('explicit entry survives readiness delay and is consumed exactly once',()=>{
  const state=runtime(6);
  state.sandbox.openConferenceWorkspace({explicitModuleEntry:true});
  state.setReady(false);
  assert.strictEqual(state.sandbox.restoreLastApplicationTab(),false);
  assert.deepStrictEqual(state.calls,[0]);
  assert.strictEqual(state.storage.last,'6');
  state.setReady(true);
  assert.strictEqual(state.sandbox.restoreLastApplicationTab(),true);
  state.storage.last='6';
  state.sandbox.restoreLastApplicationTab();
  assert.deepStrictEqual(state.calls,[0,0,6]);
});

test('Settings rendering diagnostics do not trigger tab navigation',()=>{
  assert.doesNotMatch(settingsRendering,
    /\b(?:switchTab|restoreLastApplicationTab)\s*\(/);
});

test('only unambiguous invalid legacy tab values are normalized',()=>{
  const legacy=runtime(7);
  assert.strictEqual(legacy.sandbox.getStoredLastTab(),3);
  const currentSettings=runtime(6);
  assert.strictEqual(currentSettings.sandbox.getStoredLastTab(),6);
});
