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

function runtime(storedTab,routeTab){
  const calls=[];
  const storage={last:String(storedTab),removed:0};
  let ready=true;
  const elements={
    startupScreen:{classList:{add() {},remove() {}}},
    conferenceWorkspace:{focus() {}}
  };
  const sandbox={window:null,browserStorageNamespace:{key:value=>value},
    localStorage:{getItem(key){return key==='conference_manager_last_tab'
      ?storage.last:null;},setItem(key,value){if(key==='conference_manager_last_tab')
      storage.last=String(value);},removeItem(){storage.removed+=1;}},
    document:{querySelectorAll(){return Array.from({length:7},()=>({style:{}}));}},
    ge:id=>elements[id]||{style:{}},isFinite,parseInt,
    getPlatformShellPathname:()=>'/conference',
    getCanonicalConferenceRoute:()=>routeTab===undefined?null:
      ({kind:'application',tabId:routeTab}),
    getApplicationTabIdByName:name=>name==='settings'?6:null,
    getStoredSettingsInternalView:()=>'',resetAdministrativeViewScroll(){},
    refreshOrganizationMembersSection(){},settingsTab:'general'};
  sandbox.window=sandbox;
  sandbox.switchTab=function(tabId,options){
    calls.push([tabId,!!(options&&options.preserveRoute)]);
    if(!ready)return false;
    sandbox.saveLastTab(tabId);
    return true;
  };
  vm.runInNewContext(tabState+'\n'+workspace,sandbox);
  return {sandbox,calls,storage,setReady:value=>{ready=value;}};
}

for(const requestedTab of [0,1,2,3,4,5,6]){
  test(`canonical Conference application route restores exact tab ${requestedTab}`,()=>{
    const state=runtime((requestedTab+1)%7,requestedTab);
    assert.strictEqual(state.sandbox.restoreLastApplicationTab(),true);
    assert.deepStrictEqual(state.calls,[[requestedTab,true]]);
    assert.strictEqual(state.storage.last,String(requestedTab));
  });
}

test('ordinary authorized restoration preserves the current persisted tab',()=>{
  const state=runtime(6);
  state.sandbox.restoreLastApplicationTab();
  assert.deepStrictEqual(state.calls,[[6,false]]);
  assert.strictEqual(state.storage.last,'6');
});

test('Conference workspace shell no longer owns Home versus Application state',()=>{
  assert.doesNotMatch(workspace,
    /conferenceApplicationEntryActive|conferenceModuleHomeRouteActive/);
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
