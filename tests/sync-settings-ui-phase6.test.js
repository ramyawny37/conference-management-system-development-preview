'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/sync-settings-ui.js'
),'utf8');

function load(){
  var listener=null;
  var renders=0;
  var current={id:'local-a'};
  var links={
    'local-a':{
      localConferenceId:'local-a',
      remoteConferenceId:'remote-a',
      linkStatus:'linked',
      conflictStatus:'none',
      pendingLocalApplication:false,
      knownRevision:1,
      actualRevision:1
    },
    'local-b':{
      localConferenceId:'local-b',
      remoteConferenceId:'remote-b',
      linkStatus:'linked',
      conflictStatus:'none',
      pendingLocalApplication:false,
      knownRevision:1,
      actualRevision:1
    }
  };
  var sandbox={
    window:null,
    Promise:Promise,
    JSON:JSON,
    Object:Object,
    String:String,
    Array:Array,
    Date:Date,
    getCurrentConference:function(){return current;},
    ConferenceLinkStore:{get:function(id){return links[id]||null;}},
    AutomaticSyncOrchestrator:{subscribe:function(callback){
      listener=callback;
      return function(){};
    }},
    renderSettings:function(){renders++;},
    SupabaseRuntimeConfig:{getPublicState:function(){
      return {configured:true};
    }},
    SupabaseAuth:{getState:function(){
      return {authenticated:true,user:null};
    }},
    SupabaseDeviceIdentity:{getOrCreate:function(){
      return {id:'device'};
    }},
    AutomaticSyncPreferences:{get:function(){
      return {
        cloudSyncEnabled:true,
        automaticLinkingEnabled:true,
        automaticSyncEnabled:true
      };
    }},
    location:{origin:'https://example.test'}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'sync-settings-ui.js'});
  sandbox.SyncSettingsUI.renderSection();
  return {
    listener:function(value){listener(value);},
    renders:function(){return renders;},
    links:links,
    switchTo:function(id){current={id:id};}
  };
}

function run(){
  var environment=load();
  var states=[
    'linked',
    'needs_resolution',
    'finalizing_conflict',
    'pending_local_application',
    'error'
  ];
  states.forEach(function(state,index){
    var link=environment.links['local-a'];
    link.linkStatus=state==='linked'?'linked':'needs_resolution';
    link.conflictStatus=state==='needs_resolution'?'active':'none';
    link.pendingLocalApplication=state==='pending_local_application';
    if(state==='pending_local_application'){
      link.linkStatus='server_selected_pending_local_apply';
    }
    environment.listener({
      conferenceState:state,
      linkedConferenceId:'local-a'
    });
    assert.strictEqual(environment.renders(),index+1);
    environment.listener({
      conferenceState:state,
      linkedConferenceId:'local-a'
    });
    assert.strictEqual(environment.renders(),index+1);
  });

  environment.links['local-a'].linkStatus='linked';
  environment.links['local-a'].conflictStatus='none';
  environment.links['local-a'].pendingLocalApplication=false;
  environment.listener({
    conferenceState:'linked',
    linkedConferenceId:'local-a'
  });
  var beforeRevision=environment.renders();
  environment.links['local-a'].knownRevision=2;
  environment.links['local-a'].actualRevision=2;
  environment.listener({
    conferenceState:'linked',
    linkedConferenceId:'local-a'
  });
  assert.strictEqual(environment.renders(),beforeRevision+1);

  environment.switchTo('local-b');
  var beforeStale=environment.renders();
  environment.listener({
    conferenceState:'needs_resolution',
    linkedConferenceId:'local-a'
  });
  assert.strictEqual(environment.renders(),beforeStale);
  environment.listener({
    conferenceState:'linked',
    linkedConferenceId:'local-b'
  });
  assert.strictEqual(environment.renders(),beforeStale+1);

  console.log('sync settings UI phase 6 tests: passed');
}

run();
