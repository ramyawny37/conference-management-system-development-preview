const assert=require('node:assert');
const fs=require('node:fs');
const test=require('node:test');
const vm=require('node:vm');

const source=fs.readFileSync('script.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const worker=fs.readFileSync('service-worker.js','utf8');
const navigation=source.slice(
  source.indexOf('function showHomePage'),
  source.indexOf('function renderTab')
);
const startup=source.slice(
  source.indexOf('function openStartupScreen'),
  source.indexOf('function conferenceStatusText')
);

function runtime(pathname,basePath='/'){
  const classes=new Set();
  const elements={
    startupScreen:{classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)}},
    conferenceWorkspace:{focus(){}},
    platformLauncherTitle:{focus(){}},
    homeTabButton:{classList:{add(){}}},
  };
  const location={pathname};
  const routing={getLogicalPathname(){
    if(location.pathname===basePath||location.pathname===basePath.replace(/\/$/,''))return '/';
    return location.pathname.indexOf(basePath)===0?'/'+location.pathname.slice(basePath.length).replace(/^\/+|\/+$/g,''):null;
  },resolveLogicalRoute(route){return basePath+(route==='/'?'':route.slice(1));}};
  const window={location,ApplicationRouting:routing,history:{replaceState(_state,_title,next){location.pathname=next;}},StartupAccessGate:{isAllowed:()=>true}};
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

test('repository-scoped Conference restores workspace and return home restores application base',()=>{
  const state=runtime('/preview/conference','/preview/');
  state.sandbox.openStartupScreen({persistView:false});
  assert.strictEqual(state.classes.has('platform-conference-active'),true);
  state.sandbox.showPlatformModules();
  assert.strictEqual(state.location.pathname,'/preview/');
  assert.strictEqual(state.classes.has('platform-conference-active'),false);
});

test('Conference route correction invalidates the Development runtime cache',()=>{
  assert.match(html,/script\.js\?rev=conference-module-entry-landing-v1/);
  assert.match(worker,/development-3-4-0-startup-transport-cleanup-v1/);
  assert.match(worker,/script\.js\?rev=conference-module-entry-landing-v1/);
});
