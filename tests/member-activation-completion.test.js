const assert=require('assert');
const fs=require('fs');
const path=require('path');
const vm=require('vm');

const source=fs.readFileSync(path.join(__dirname,'../script.js'),'utf8');
const start=source.indexOf('var memberActivationDiagnosticState=');
const end=source.indexOf('function downloadFullApplicationBackup');
assert.ok(start>=0&&end>start);
const activationSource=source.slice(start,end);

function environment(options={}){
  const calls=[];
  const authorizationCalls=[];
  let route=options.route||'/warehouse/approvals';
  const elements=options.missingDom?{}:{
    applicationBody:{style:{display:options.startup?'none':''}},
    tab0:{},tab1:{},tab6:{}
  };
  const conference={id:'local',status:'active',houses:[{
    floors:[{rooms:[{id:'room-1'}]}]
  }]};
  const sandbox={window:null,Date,Array,String,
    appData:{conferences:[conference],currentConferenceId:null},
    currentTab:options.currentTab===undefined?0:options.currentTab,
    deepClone:value=>JSON.parse(JSON.stringify(value)),
    ge:id=>elements[id]||null,
    setCurrentConference(){calls.push('set_current_conference');},
    syncCurrentConferenceRefs(){calls.push('sync_current_references');},
    setApplicationMode(){calls.push('set_application_mode');},
    refreshPeopleDatalist(){calls.push('refresh_people_datalist');},
    renderAccommodation(){
      calls.push('render_accommodation');
      if(options.throwStage==='render_accommodation')throw new Error('render');
    },
    renderTransports(){calls.push('render_transports');},
    renderSettings(){calls.push('render_settings');},
    restoreLastApplicationTab(){calls.push('render_current_tab');},
    switchTab(_tabId,switchOptions){
      calls.push('render_current_tab');
      if(!switchOptions||switchOptions.preserveRoute!==true){
        route='/conference/app/accommodation';
      }
      return true;
    },
    ConferenceActivationAuthorization:{
      activate(id){
        authorizationCalls.push(id);
        assert.strictEqual(id,'local');
        return options.activationAllowed!==false;
      }
    },
    AutomaticSyncOrchestrator:{schedule(){calls.push('schedule');}}
  };
  sandbox.getPlatformShellPathname=()=>route;
  sandbox.getCanonicalConferenceRoute=()=>{
    if(route==='/conference')return {kind:'home',tabId:null};
    const match=/^\/conference\/app\/(accommodation)$/.exec(route);
    return match?{kind:'application',tabId:0}:null;
  };
  sandbox.getCurrentConference=()=>sandbox.appData.conferences.find(item=>
    item.id===sandbox.appData.currentConferenceId)||null;
  sandbox.window=sandbox;
  vm.runInNewContext(activationSource,sandbox);
  return {sandbox,calls,authorizationCalls,conference,route:()=>route};
}

const denied=environment({activationAllowed:false});
assert.strictEqual(denied.sandbox.activatePersistedConferenceById(
  'local',{alreadyPersisted:true}),false);
assert.deepStrictEqual(denied.authorizationCalls,['local']);
assert.strictEqual(denied.sandbox.appData.currentConferenceId,null);
assert.deepStrictEqual(denied.calls,[]);

const success=environment({
  currentTab:0,route:'/conference/app/accommodation'
});
const successResult=success.sandbox.activatePersistedConferenceById(
  'local',{alreadyPersisted:true});
assert.strictEqual(successResult,true);
assert.deepStrictEqual(success.authorizationCalls,['local']);
assert.strictEqual(successResult&&typeof successResult.then,'undefined');
assert.strictEqual(success.sandbox.appData.currentConferenceId,'local');
assert.strictEqual(success.sandbox.getCurrentConference().houses[0]
  .floors[0].rooms.length,1);
assert.deepStrictEqual(success.calls,[
  'set_current_conference','sync_current_references','set_application_mode',
  'refresh_people_datalist','render_accommodation','render_transports',
  'render_settings','render_current_tab'
]);
assert.strictEqual(success.calls.includes('schedule'),false);
assert.strictEqual(success.route(),'/conference/app/accommodation');
assert.strictEqual(success.sandbox.getMemberActivationDiagnostics()
  .currentStage,'activation_return');
assert.strictEqual(success.sandbox.getMemberActivationDiagnostics()
  .settingsResolved,true);

const background=environment({route:'/warehouse/approvals'});
assert.strictEqual(background.sandbox.activatePersistedConferenceById(
  'local',{alreadyPersisted:true}),true);
assert.deepStrictEqual(background.calls,[
  'set_current_conference','sync_current_references'
]);
assert.strictEqual(background.route(),'/warehouse/approvals');
assert.strictEqual(background.sandbox.getMemberActivationDiagnostics()
  .settingsResolved,false);

const missingDom=environment({
  missingDom:true,currentTab:6,route:'/conference/app/accommodation'
});
assert.strictEqual(missingDom.sandbox.activatePersistedConferenceById(
  'local',{alreadyPersisted:true}),true);
assert.strictEqual(missingDom.calls.includes('render_accommodation'),false);
assert.strictEqual(missingDom.calls.includes('render_settings'),false);
assert.strictEqual(missingDom.sandbox.getMemberActivationDiagnostics()
  .settingsResolved,false);

const conflictVisible=environment({
  currentTab:6,route:'/conference/app/accommodation'
});
assert.strictEqual(conflictVisible.sandbox.activatePersistedConferenceById(
  'local',{alreadyPersisted:true}),true);
assert.strictEqual(conflictVisible.calls.includes('render_settings'),true);

const renderFailure=environment({
  throwStage:'render_accommodation',route:'/conference/app/accommodation'
});
assert.strictEqual(renderFailure.sandbox.activatePersistedConferenceById(
  'local',{alreadyPersisted:true}),false);
const failureState=renderFailure.sandbox.getMemberActivationDiagnostics();
assert.strictEqual(failureState.exceptionStage,'render_accommodation');
assert.ok(failureState.trace.some(entry=>
  entry.stage==='render_accommodation'&&entry.status==='exception'));
assert.strictEqual(renderFailure.calls.includes('schedule'),false);

console.log('member activation completion tests passed');
