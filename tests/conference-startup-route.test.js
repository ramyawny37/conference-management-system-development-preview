const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('script.js','utf8');
const navigation=source.slice(
  source.indexOf('function showHomePage'),
  source.indexOf('function renderTab')
);
const startup=source.slice(
  source.indexOf('function openStartupScreen'),
  source.indexOf('function conferenceStatusText')
);

function runtime(pathname){
  const classes=new Set();
  const elements={
    startupScreen:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},
    conferenceWorkspace:{focus(){}},
    platformLauncherTitle:{focus(){}},
    homeTabButton:{classList:{add(){}}},
  };
  const location={pathname};
  const window={location,history:{replaceState(_state,_title,next){location.pathname=next;}},StartupAccessGate:{isAllowed:()=>true}};
  const sandbox={window,document:{body:{classList:{remove(){}}},querySelectorAll:()=>[]},appData:{currentConferenceId:'conference-1'},currentApplicationView:'',
    ge:id=>elements[id]||null,closeOrganizationManagementScreen(){},showStartupConferenceList(){},setApplicationMode(){},
    getValidApplicationTabIds:()=>[],saveApplicationView(){},save:()=>true};
  vm.runInNewContext(`${navigation}\n${startup}`,sandbox);
  return {sandbox,location,classes};
}

test('authorized startup keeps direct Conference pathname authoritative',()=>{
  const state=runtime('/conference');
  assert.strictEqual(state.sandbox.openStartupScreen({persistView:false}),true);
  assert.strictEqual(state.location.pathname,'/conference');
  assert.strictEqual(state.classes.has('platform-conference-active'),true);
});

test('Conference query strings resolve by pathname and explicit modules returns root',()=>{
  const state=runtime('/conference');
  state.sandbox.openStartupScreen({persistView:false});
  state.sandbox.showPlatformModules();
  assert.strictEqual(state.location.pathname,'/');
  assert.strictEqual(state.classes.has('platform-conference-active'),false);
});

test('root startup remains on the Platform launcher',()=>{
  const state=runtime('/');
  state.sandbox.openStartupScreen({persistView:false});
  assert.strictEqual(state.location.pathname,'/');
  assert.strictEqual(state.classes.has('platform-conference-active'),false);
});
