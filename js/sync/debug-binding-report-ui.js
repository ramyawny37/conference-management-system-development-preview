(function(global){
  'use strict';

  var RUNTIME_BUILD_REVISION='debug-binding-report-ui-v2';
  var lastReportText='';
  var lastCopyFallbackActive=false;

  function escapeHtml(value){
    return String(value==null?'':value)
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  function hashText(value){
    var text=String(value==null?'':value);
    var hash=2166136261;
    for(var index=0;index<text.length;index++){
      hash^=text.charCodeAt(index);
      hash=Math.imul(hash,16777619);
    }
    return ('00000000'+((hash>>>0).toString(16))).slice(-8);
  }

  function safeClone(value){
    try{return JSON.parse(JSON.stringify(value));}
    catch(error){return null;}
  }

  function appDataSnapshot(){
    var raw=null;
    var parsed=null;
    try{raw=global.localStorage&&global.localStorage.getItem('conf_v5');}
    catch(error){raw=null;}
    try{parsed=raw?JSON.parse(raw):null;}
    catch(error){parsed=null;}
    if(global.appData&&typeof global.appData==='object')return global.appData;
    if(parsed&&parsed.appData&&typeof parsed.appData==='object')return parsed.appData;
    if(parsed&&typeof parsed==='object')return parsed;
    return null;
  }

  function countRooms(conference){
    return ((conference&&conference.houses)||[]).reduce(function(total,house){
      return total+((house&&house.floors)||[]).reduce(function(inner,floor){
        return inner+((floor&&floor.rooms)||[]).length;
      },0);
    },0);
  }

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

  function buildReport(){
    var appData=appDataSnapshot();
    var conferences=appData&&Array.isArray(appData.conferences)
      ?appData.conferences:[];
    var currentConferenceId=appData&&appData.currentConferenceId
      ?String(appData.currentConferenceId):'';
    var currentConference=conferences.find(function(conference){
      return conference&&String(conference.id)===currentConferenceId;
    })||null;
    var linksApi=global.ConferenceLinkStore;
    var allLinks=linksApi&&typeof linksApi.list==='function'
      ?linksApi.list():[];
    var currentLink=currentConference&&linksApi&&typeof linksApi.get==='function'
      ?linksApi.get(currentConference.id):null;
    var syncApi=global.OfflineFirstIntegration;
    var currentContext=currentConference&&syncApi&&
      typeof syncApi.getConferenceSyncState==='function'
      ?syncApi.getConferenceSyncState(currentConference.id):null;
    var backupApi=global.FullBackupService;
    var manualRelinkRequired=currentConference&&backupApi&&
      typeof backupApi.isManualRelinkRequired==='function'
      ?backupApi.isManualRelinkRequired(currentConference.id)
      :false;

    return {
      currentConference:currentConference?{
        name:String(currentConference.name||
          (currentConference.conf&&currentConference.conf.name)||''),
        localHash:hashText(currentConference.id),
        counts:counts(currentConference)
      }:null,
      currentLink:currentLink?{
        linkStatus:String(currentLink.linkStatus||''),
        remoteHash:hashText(String(currentLink.remoteConferenceId||'')),
        knownRevision:Number.isInteger(currentLink.knownRevision)
          ?currentLink.knownRevision:null,
        conflictStatus:currentLink.conflictStatus||null,
        manualRelinkRequired:manualRelinkRequired===true,
        syncState:safeClone(currentLink.syncState||null)
      }:null,
      currentContext:currentContext?{
        present:!!currentContext.context,
        compatible:!!(
          currentContext.context&&currentLink&&
          String(currentContext.context.localConferenceId||'')===
            String(currentConference&&currentConference.id||'')&&
          String(currentContext.context.conferenceId||'')===
            String(currentLink.remoteConferenceId||'')
        ),
        localHash:currentContext.context
          ?hashText(String(currentContext.context.localConferenceId||''))
          :null,
        remoteHash:currentContext.context
          ?hashText(String(currentContext.context.conferenceId||''))
          :null,
        baseRevision:currentContext.context&&
          Number.isInteger(currentContext.context.baseRevision)
          ?currentContext.context.baseRevision:null
      }:null,
      allLinks:allLinks.map(function(link){
        var localId=String(link&&link.localConferenceId||'');
        var localConference=conferences.find(function(conference){
          return conference&&String(conference.id)===localId;
        })||null;
        return {
          localHash:hashText(localId),
          remoteHash:hashText(String(link&&link.remoteConferenceId||'')),
          linkStatus:String(link&&link.linkStatus||''),
          knownRevision:Number.isInteger(link&&link.knownRevision)
            ?link.knownRevision:null,
          counts:counts(localConference)
        };
      })
    };
  }

  function element(id){
    return global.document&&typeof global.document.getElementById==='function'
      ?global.document.getElementById(id):null;
  }

  function render(){
    var html='<div class="sync-settings-panel" ' +
      'data-runtime-build="'+RUNTIME_BUILD_REVISION+'">';
    html+='<h3>تشخيص الربط (Debug)</h3>';
    html+='<div class="sync-settings-message">ينشئ تقرير ربط محلي للنسخ بدون أي تغيير في الحالة.</div>';
    html+='<div class="sync-settings-actions">';
    html+='<button type="button" class="btn btn-blue btn-sm" onclick="DebugBindingReportUI.generate()">نسخ تقرير الربط</button>';
    html+='<button type="button" id="debug_binding_copy_btn" class="btn btn-gray btn-sm" style="display:'+(lastReportText?'inline-flex':'none')+'" onclick="DebugBindingReportUI.copy()">نسخ التقرير</button>';
    html+='</div>';
    html+='<textarea id="debug_binding_report_output" dir="ltr" readonly style="width:100%;min-height:220px;margin-top:10px;font-size:12px;line-height:1.5;display:block">'+
      escapeHtml(lastReportText)+
      '</textarea>';
    html+='<div id="debug_binding_report_message" class="sync-settings-message">'+
      escapeHtml(lastCopyFallbackActive
        ?'تعذر النسخ التلقائي. تم تحديد النص لتقوم بنسخه يدويًا.'
        :(lastReportText?'تم إنشاء التقرير.':'')
      )+
      '</div>';
    html+='</div>';
    return html;
  }

  function selectFallback(){
    var output=element('debug_binding_report_output');
    if(!output)return;
    try{
      output.focus();
      output.select();
      if(typeof output.setSelectionRange==='function'){
        output.setSelectionRange(0,output.value.length);
      }
    }catch(error){}
  }

  function setMessage(text){
    var target=element('debug_binding_report_message');
    if(target)target.textContent=text||'';
  }

  function refreshUi(){
    var output=element('debug_binding_report_output');
    if(output)output.value=lastReportText;
    var copyButton=element('debug_binding_copy_btn');
    if(copyButton)copyButton.style.display=lastReportText?'inline-flex':'none';
    setMessage(lastCopyFallbackActive
      ?'تعذر النسخ التلقائي. تم تحديد النص لتقوم بنسخه يدويًا.'
      :(lastReportText?'تم إنشاء التقرير.':'')
    );
  }

  function generate(){
    lastCopyFallbackActive=false;
    lastReportText=JSON.stringify(buildReport(),null,2);
    refreshUi();
    return lastReportText;
  }

  function copy(){
    if(!lastReportText)generate();
    lastCopyFallbackActive=false;
    if(global.navigator&&global.navigator.clipboard&&
      typeof global.navigator.clipboard.writeText==='function'){
      return Promise.resolve(global.navigator.clipboard.writeText(lastReportText))
        .then(function(){
          setMessage('تم نسخ التقرير إلى الحافظة.');
          return true;
        })
        .catch(function(){
          lastCopyFallbackActive=true;
          refreshUi();
          selectFallback();
          return false;
        });
    }
    lastCopyFallbackActive=true;
    refreshUi();
    selectFallback();
    return Promise.resolve(false);
  }

  global.DebugBindingReportUI=Object.freeze({
    render:render,
    generate:generate,
    copy:copy,
    buildReport:buildReport,
    getState:function(){
      return {
        runtimeBuildRevision:RUNTIME_BUILD_REVISION,
        lastReportText:lastReportText,
        lastCopyFallbackActive:lastCopyFallbackActive
      };
    }
  });
})(window);
