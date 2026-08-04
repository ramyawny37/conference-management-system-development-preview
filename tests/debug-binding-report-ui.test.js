'use strict';

var assert=require('assert');
var fs=require('fs');
var path=require('path');
var vm=require('vm');

var source=fs.readFileSync(path.resolve(
  __dirname,'../js/sync/debug-binding-report-ui.js'
),'utf8');

function clone(value){
  return JSON.parse(JSON.stringify(value));
}

function countRooms(conf){
  return ((conf&&conf.houses)||[]).reduce(function(total,house){
    return total+((house&&house.floors)||[]).reduce(function(inner,floor){
      return inner+((floor&&floor.rooms)||[]).length;
    },0);
  },0);
}

function computeConsoleStyleReport(sandbox){
  var appData=sandbox.appData;
  var conferences=appData&&Array.isArray(appData.conferences)?appData.conferences:[];
  var currentConferenceId=appData&&appData.currentConferenceId?String(appData.currentConferenceId):'';
  var currentConference=conferences.find(function(conference){
    return conference&&String(conference.id)===currentConferenceId;
  })||null;
  function counts(conference){
    return {
      people:conference&&conference.peopleDb&&Array.isArray(conference.peopleDb.people)
        ?conference.peopleDb.people.length:0,
      transports:Array.isArray(conference&&conference.transports)
        ?conference.transports.length:0,
      houses:Array.isArray(conference&&conference.houses)
        ?conference.houses.length:0,
      rooms:countRooms(conference)
    };
  }
  function hashText(value){
    var text=String(value==null?'':value);
    var hash=2166136261;
    for(var i=0;i<text.length;i++){
      hash^=text.charCodeAt(i);
      hash=Math.imul(hash,16777619);
    }
    return ('00000000'+((hash>>>0).toString(16))).slice(-8);
  }
  var currentLink=currentConference?sandbox.ConferenceLinkStore.get(currentConference.id):null;
  var currentContext=currentConference?sandbox.OfflineFirstIntegration.getConferenceSyncState(currentConference.id):null;
  return {
    currentConference:currentConference?{
      name:String(currentConference.name||''),
      localHash:hashText(currentConference.id),
      counts:counts(currentConference)
    }:null,
    currentLink:currentLink?{
      linkStatus:String(currentLink.linkStatus||''),
      remoteHash:hashText(String(currentLink.remoteConferenceId||'')),
      knownRevision:Number.isInteger(currentLink.knownRevision)?currentLink.knownRevision:null,
      conflictStatus:currentLink.conflictStatus||null,
      manualRelinkRequired:false,
      syncState:clone(currentLink.syncState||null)
    }:null,
    currentContext:currentContext?{
      present:!!currentContext.context,
      compatible:!!(
        currentContext.context&&currentLink&&
        String(currentContext.context.localConferenceId||'')===String(currentConference&&currentConference.id||'')&&
        String(currentContext.context.conferenceId||'')===String(currentLink.remoteConferenceId||'')
      ),
      localHash:currentContext.context?hashText(String(currentContext.context.localConferenceId||'')):null,
      remoteHash:currentContext.context?hashText(String(currentContext.context.conferenceId||'')):null,
      baseRevision:currentContext.context&&Number.isInteger(currentContext.context.baseRevision)
        ?currentContext.context.baseRevision:null
    }:null,
    allLinks:sandbox.ConferenceLinkStore.list().map(function(link){
      var localConference=conferences.find(function(conference){
        return conference&&String(conference.id)===String(link.localConferenceId||'');
      })||null;
      return {
        localHash:hashText(String(link.localConferenceId||'')),
        remoteHash:hashText(String(link.remoteConferenceId||'')),
        linkStatus:String(link.linkStatus||''),
        knownRevision:Number.isInteger(link.knownRevision)?link.knownRevision:null,
        counts:counts(localConference)
      };
    })
  };
}

function environment(options){
  options=options||{};
  var writes=[];
  var queueCalls=0;
  var rpcCalls=0;
  var elements={};
  var currentConference=options.noConference?null:{
    id:'local-a',
    name:'Alpha',
    peopleDb:{people:[{id:'p1'},{id:'p2'}]},
    transports:[{id:'t1'}],
    houses:[{floors:[{rooms:[{id:'r1'},{id:'r2'}]}]}]
  };
  var appData={
    currentConferenceId:currentConference?'local-a':null,
    conferences:currentConference?[currentConference]:[]
  };
  var links={
    'local-a':{
      localConferenceId:'local-a',
      remoteConferenceId:'22222222-2222-4222-8222-222222222222',
      knownRevision:4,
      linkStatus:'linked',
      conflictStatus:null,
      syncState:{pendingLocalChanges:false}
    }
  };
  var context={
    context:{
      localConferenceId:'local-a',
      conferenceId:'22222222-2222-4222-8222-222222222222',
      baseRevision:4
    }
  };
  elements.debug_binding_report_output={
    value:'',
    focus:function(){elements.focused=true;},
    select:function(){elements.selected=true;},
    setSelectionRange:function(start,end){elements.selection=[start,end];}
  };
  elements.debug_binding_copy_btn={style:{display:'none'}};
  elements.debug_binding_report_message={textContent:'',className:''};
  var sandbox={
    window:null,
    JSON:JSON,
    Object:Object,
    String:String,
    Array:Array,
    Promise:Promise,
    Math:Math,
    appData:appData,
    localStorage:{
      getItem:function(key){
        if(key==='conf_v5')return JSON.stringify(appData);
        if(key==='conference_manager_sync_links')return JSON.stringify(links);
        return null;
      },
      setItem:function(){writes.push('setItem');}
    },
    document:{
      getElementById:function(id){return elements[id]||null;}
    },
    navigator:{
      clipboard:options.clipboardFailure
        ?{writeText:function(){return Promise.reject(new Error('copy failed'));}}
        :{writeText:function(text){elements.copied=text;return Promise.resolve();}}
    },
    ConferenceLinkStore:{
      get:function(id){return links[id]?clone(links[id]):null;},
      list:function(){return Object.keys(links).map(function(key){return clone(links[key]);});}
    },
    OfflineFirstIntegration:{
      getConferenceSyncState:function(id){
        return String(id)==='local-a'?clone(context):{context:null};
      }
    },
    FullBackupService:{
      isManualRelinkRequired:function(){return false;}
    },
    OfflineSyncQueue:{coalesceSnapshotOperation:function(){queueCalls++;}},
    SupabaseRpc:{rpc:function(){rpcCalls++;}}
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox,{filename:'debug-binding-report-ui.js'});
  return {
    sandbox:sandbox,
    elements:elements,
    writes:function(){return writes.slice();},
    queueCalls:function(){return queueCalls;},
    rpcCalls:function(){return rpcCalls;}
  };
}

(async function run(){
  var full=environment();
  var expected=computeConsoleStyleReport(full.sandbox);
  var html=full.sandbox.DebugBindingReportUI.render();
  assert.ok(html.indexOf('تشخيص الربط (Debug)')>=0);
  assert.ok(html.indexOf('نسخ تقرير الربط')>=0);
  var reportText=full.sandbox.DebugBindingReportUI.generate();
  var parsed=JSON.parse(reportText);
  assert.deepStrictEqual(parsed,expected,'UI report must exactly match console report shape and values');
  assert.strictEqual(full.elements.debug_binding_report_output.value,reportText);
  assert.strictEqual(full.elements.debug_binding_copy_btn.style.display,'inline-flex');
  assert.strictEqual(full.queueCalls(),0);
  assert.strictEqual(full.rpcCalls(),0);
  assert.deepStrictEqual(full.writes(),[],'report generation must not write local storage');
  assert.strictEqual(JSON.stringify(parsed).indexOf('22222222-2222-4222-8222-222222222222'),-1,'must not expose remote ID');
  assert.strictEqual(JSON.stringify(parsed).indexOf('local-a'),-1,'must not expose local ID');

  await full.sandbox.DebugBindingReportUI.copy();
  assert.strictEqual(full.elements.copied,reportText,'copy button should write JSON to clipboard');

  var fallback=environment({clipboardFailure:true});
  fallback.sandbox.DebugBindingReportUI.generate();
  var fallbackResult=await fallback.sandbox.DebugBindingReportUI.copy();
  assert.strictEqual(fallbackResult,false);
  assert.strictEqual(fallback.elements.selected,true,'clipboard failure should select textarea text');
  assert.ok(fallback.elements.debug_binding_report_message.textContent.indexOf('تعذر النسخ التلقائي')>=0);
  assert.strictEqual(fallback.queueCalls(),0);
  assert.strictEqual(fallback.rpcCalls(),0);

  var empty=environment({noConference:true});
  var emptyParsed=JSON.parse(empty.sandbox.DebugBindingReportUI.generate());
  assert.strictEqual(emptyParsed.currentConference,null);
  assert.strictEqual(emptyParsed.currentLink,null);
  assert.strictEqual(emptyParsed.currentContext,null);
  assert.deepStrictEqual(emptyParsed.allLinks,[{
    localHash:emptyParsed.allLinks[0].localHash,
    remoteHash:emptyParsed.allLinks[0].remoteHash,
    linkStatus:'linked',
    knownRevision:4,
    counts:{people:0,transports:0,houses:0,rooms:0}
  }]);

  console.log('debug binding report UI tests: passed');
})();
