'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');

const activationSource=fs.readFileSync(
  'js/sync/conference-activation-authorization.js','utf8'
);
const scriptSource=fs.readFileSync('script.js','utf8');

function runtime(){
  const sandbox={window:null,Object,String,Promise};
  sandbox.window=sandbox;
  vm.runInNewContext(
    activationSource,sandbox,{filename:'conference-activation-authorization.js'}
  );
  return sandbox.ConferenceActivationAuthorization;
}

function commonOpenPath(appData,links){
  const entrySource=scriptSource.slice(
    scriptSource.indexOf('function prepareCanonicalConferenceApplicationEntry'),
    scriptSource.indexOf('function traceMemberActivation')
  );
  const openSource=entrySource+'\n'+scriptSource.slice(
    scriptSource.indexOf('function setCurrentConferenceById'),
    scriptSource.indexOf('function completeCurrentConference')
  );
  let current=null;
  let selectedConferenceId='';
  const sandbox={
    window:null,appData,Object,String,
    currentConferenceRuntimeActivationDecision:null,
    ConferenceActivationAuthorization:runtime(),
    ConferenceLinkStore:links,
    PlatformIntegration:{
      getModuleServices(){
        return {
          setSelectedConferenceId(value){
            selectedConferenceId=String(value||'');
            return selectedConferenceId;
          }
        };
      }
    },
    setCurrentConference(value){current=value;},
    saveCurrentConferenceSelection(){return true;},
    syncCurrentConferenceRefs(){},
    getCurrentConference(){return current;},
    getPlatformShellPathname(){return '/conference';},
    getCanonicalConferenceRoute(){return {kind:'home'};},
    openStartupScreen(){},
    console
  };
  sandbox.window=sandbox;
  vm.runInNewContext(openSource,sandbox,{filename:'set-current-conference.js'});
  return {
    authorization:sandbox.ConferenceActivationAuthorization,
    open:(id,options)=>sandbox.setCurrentConferenceById(id,options),
    current:()=>current,
    selectedConferenceId:()=>selectedConferenceId
  };
}

test('activation rejects access without a canonical decision',()=>{
  const authorization=runtime();
  const decision=authorization.authorizeCloud({conferenceId:'local-new'});
  assert.equal(decision.ok,false);
  assert.equal(decision.active,false);
  assert.equal(decision.reason,'canonical_access_required');
  assert.equal(decision.conferenceId,'local-new');
  assert.equal(decision.role,null);
  assert.equal(decision.capabilities,null);
});

test('linked conference requires explicit canonical access and carries capabilities',()=>{
  const authorization=runtime();
  const denied=authorization.authorizeCloud({
    conferenceId:'cloud',canonicalAccess:false,capabilities:{edit:true}
  });
  assert.equal(denied.ok,false);
  assert.equal(denied.active,false);

  const allowed=authorization.authorizeCloud({
    conferenceId:'cloud',
    canonicalAccess:true,
    capabilities:{edit:true,sync:true,transportManage:false}
  });
  assert.equal(allowed.ok,true);
  assert.equal(allowed.active,true);
  assert.equal(allowed.role,null);
  assert.equal(allowed.capabilities.edit,true);
  assert.equal(allowed.capabilities.sync,true);
});

test('activation module exposes no retired stateful compatibility API',()=>{
  const authorization=runtime();
  [
    'authorizeLocal','authorizeLocalOnly','canDisplay','canEdit','canSync','activate','deactivate',
    'getCurrentState','capturePersistedCandidate','getPersistedCandidate',
    'preparePersistedAppData'
  ].forEach(name=>assert.equal(
    Object.prototype.hasOwnProperty.call(authorization,name),false,name
  ));
});

test('common open path denies an unlinked conference without canonical decision',()=>{
  const app={currentConferenceId:null,conferences:[{id:'local-new',name:'Local'}]};
  const opener=commonOpenPath(app,{get(){return null;}});
  assert.equal(opener.open('local-new'),false);
  assert.equal(opener.current(),null);
  assert.equal(opener.selectedConferenceId(),'');
});

test('common open path fails closed for linked conference without canonical decision',()=>{
  const linked={
    localConferenceId:'cloud',
    remoteConferenceId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    linkStatus:'cloud_linked'
  };
  const app={currentConferenceId:null,conferences:[{id:'cloud',name:'Cloud'}]};
  const opener=commonOpenPath(app,{get(id){return id==='cloud'?linked:null;}});
  assert.equal(opener.open('cloud'),false);
  assert.equal(app.currentConferenceId,null);
  assert.equal(opener.selectedConferenceId(),'');
});

test('common open path accepts canonical activation decision without local link',()=>{
  const app={currentConferenceId:null,conferences:[{id:'cloud',name:'Cloud'}]};
  const opener=commonOpenPath(app,{get(){throw new Error('link store must not be read');}});
  const decision=opener.authorization.authorizeCloud({
    conferenceId:'cloud',
    canonicalAccess:true,
    capabilities:{edit:false,sync:true,transportManage:false}
  });
  assert.equal(opener.open('cloud',{activationDecision:decision}),true);
  assert.equal(opener.current().id,'cloud');
  assert.equal(opener.selectedConferenceId(),'cloud');
});

test('startup card delegates canonical ID directly without link lookup',()=>{
  const start=scriptSource.indexOf('function openConferenceFromStartup(id){');
  const end=scriptSource.indexOf('\nvar conferenceBrandingDraft=',start);
  assert.ok(start>=0&&end>start);
  const source=scriptSource.slice(start,end);
  let opened=null;
  const sandbox={window:{},openDiscoveredConferenceFromStartup:id=>{opened=id;return true;}};
  vm.runInNewContext(source+'\nthis.openStartup=openConferenceFromStartup;',sandbox);
  assert.equal(sandbox.openStartup('canonical-id'),true);
  assert.equal(opened,'canonical-id');
});
