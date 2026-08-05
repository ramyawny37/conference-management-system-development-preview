(function(global){
  'use strict';
  var connectionStatus='disconnected';
  var lockResult=null;
  var lastMessage='';
  var reviewSummary=null;
  var busy=false;
  var lockRefreshedAt=null;
  var SOURCE_REVISION='realtime-startup-e2e-v1';

  function copy(value){
    if(typeof global.structuredClone==='function')return global.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }
  function deps(options){
    options=options||{};
    return {
      links:options.links||global.ConferenceLinkStore,
      markers:options.markers||global.RemoteUpdateStore,
      integration:options.integration||global.OfflineFirstIntegration,
      realtime:options.realtime||global.RealtimeSync,
      realtimeManager:options.realtimeManager||
        global.ConferenceRealtimeManager,
      locks:options.locks||global.ConferenceLocks,
      remote:options.remote||global.SupabaseSnapshotSync,
      compare:options.compare||global.ConflictResolution,
      config:options.config||global.SupabaseRuntimeConfig,
      auth:options.auth||global.SupabaseAuth,
      device:options.device||global.SupabaseDeviceIdentity
    };
  }
  function readiness(localId,options){
    var d=deps(options), link=d.links&&d.links.get(localId);
    var config=d.config&&d.config.getPublicState&&
      d.config.getPublicState().configured;
    var auth=d.auth&&d.auth.getState&&d.auth.getState().authenticated;
    var device=null;
    try{device=d.device&&d.device.getOrCreate&&d.device.getOrCreate();}
    catch(error){}
    var reasons=[];
    if(!config)reasons.push('إعداد Supabase غير موجود.');
    if(!auth)reasons.push('يجب تسجيل الدخول.');
    if(!device||!device.id)reasons.push('هوية الجهاز غير متاحة.');
    if(!link||['linked','cloud_linked'].indexOf(link.linkStatus)<0||
      !link.remoteConferenceId){
      reasons.push('المؤتمر غير مرتبط بحالة جاهزة.');
    }
    return {
      ready:!reasons.length,reasons:reasons,link:link,device:device
    };
  }
  function onEvent(event,localId,options){
    var d=deps(options), ready=readiness(localId,options);
    if(!ready.link||event.conferenceId!==ready.link.remoteConferenceId){
      return {ok:false,status:'ignored_other_conference'};
    }
    var trustedSource=event.deviceId&&ready.device&&ready.device.id;
    var self=trustedSource&&event.deviceId===ready.device.id;
    return d.markers.add({
      remoteConferenceId:event.conferenceId,
      revision:Number.isInteger(event.revision)?event.revision:null,
      sourceDeviceId:event.deviceId||null,
      receivedAt:new Date().toISOString(),
      status:self?'self_update':'unreviewed'
    });
  }
  function connect(localId,options){
    if(busy)return Promise.resolve({ok:false,status:'busy'});
    var d=deps(options), ready=readiness(localId,options);
    if(!ready.ready)return Promise.resolve({
      ok:false,status:'prerequisites_missing',data:{reasons:ready.reasons}
    });
    busy=true;connectionStatus='connecting';
    return d.integration.connectRealtime(ready.link.remoteConferenceId,{
      realtime:d.realtime,
      eventHandler:function(event){onEvent(event,localId,options);}
    }).then(function(result){
      connectionStatus=result&&result.ok?'connected':'error';
      return result;
    }).catch(function(){
      connectionStatus='error';return {ok:false,status:'error'};
    }).then(function(result){busy=false;return result;});
  }
  function automaticRealtimeState(localId,options){
    var manager=deps(options).realtimeManager;
    return manager&&typeof manager.getState==='function'
      ?manager.getState(localId)||null:null;
  }
  function automaticRealtimeActive(localId,ready,managerState,options){
    var link=ready&&ready.link;
    if(link&&link.linkStatus==='cloud_linked')return true;
    var data=options&&options.appData||global.appData;
    var record=data&&data.conferenceLifecycle&&
      data.conferenceLifecycle.records&&
      data.conferenceLifecycle.records[localId];
    if(record&&record.cloudLifecycle==='cloud_linked')return true;
    return !!(link&&managerState&&managerState.cloudConferenceId&&
      String(managerState.cloudConferenceId)===
        String(link.remoteConferenceId||'')&&
      ['connecting','subscribed','suspended','reconnecting','error']
        .indexOf(managerState.status)>=0);
  }
  function automaticRealtimePresentation(value){
    value=value||{};
    var status=value.status||'disconnected';
    if(status==='inactive'||status==='closed')status='disconnected';
    if(status==='waiting_for_prerequisites')status='suspended';
    if(status==='reconnecting')status='connecting';
    var labels={
      connecting:'جارٍ الاتصال',subscribed:'متصل',suspended:'معلّق',
      error:'خطأ',disconnected:'غير متصل'
    };
    return {status:status,label:labels[status]||labels.disconnected};
  }
  function automaticReconnect(localId,options){
    if(busy)return Promise.resolve({ok:false,status:'busy'});
    var d=deps(options),ready=readiness(localId,options);
    if(!ready.ready||!d.realtimeManager||
      typeof d.realtimeManager.prepareAndSubscribe!=='function'){
      return Promise.resolve({ok:false,status:'prerequisites_missing'});
    }
    busy=true;
    return Promise.resolve(d.realtimeManager.prepareAndSubscribe(
      global.appData,localId,options&&options.realtimeManagerOptions
    )).catch(function(error){
      return {ok:false,status:'error',error:{
        code:String(error&&error.code||'REALTIME_RECONNECT_FAILED')
      }};
    }).then(function(result){busy=false;return result;});
  }
  function automaticTrace(options){
    var manager=deps(options).realtimeManager;
    return manager&&typeof manager.getDiagnostics==='function'
      ?manager.getDiagnostics():[];
  }
  function disconnect(options){
    var d=deps(options);
    return d.integration.disconnectRealtime({realtime:d.realtime})
      .then(function(result){
        connectionStatus=result&&result.ok
          ?'stopped_manually':'error';
        return result;
      }).catch(function(){
        connectionStatus='error';return {ok:false,status:'error'};
      });
  }
  function latestMarker(localId,options){
    var d=deps(options), ready=readiness(localId,options);
    return ready.link?(d.markers.list(ready.link.remoteConferenceId)[0]||null):null;
  }
  function reviewRemote(input,options){
    input=input||{};
    var d=deps(options), ready=readiness(input.localConferenceId,options);
    if(!ready.ready)return Promise.resolve({ok:false,status:'prerequisites_missing'});
    var marker=latestMarker(input.localConferenceId,options);
    if(!marker)return Promise.resolve({ok:false,status:'marker_not_found'});
    var local=copy(input.localSnapshot);
    return d.remote.downloadSnapshot(ready.link.remoteConferenceId)
      .then(function(download){
        if(!download||!download.ok||!download.data){
          return {ok:false,status:'download_failed'};
        }
        var compared=d.compare.compareSnapshots(
          local,copy(download.data.snapshot)
        );
        if(!compared||!compared.ok)return {ok:false,status:'compare_failed'};
        var summary=compared.data.summary;
        var count=Number(summary.added||0)+Number(summary.removed||0)+
          Number(summary.changed||0);
        var markerStatus=count===0?'reviewed_equal':
          count<5?'reviewed_changed':'needs_resolution';
        d.markers.update(
          marker.remoteConferenceId,marker.receivedAt,markerStatus
        );
        if(markerStatus==='needs_resolution'){
          d.links.save(Object.assign({},ready.link,{
            linkStatus:'needs_resolution',
            conflictStatus:'pending',
            actualRevision:Number.isInteger(download.data.revision)
              ?download.data.revision:null,
            lastConflictAt:new Date().toISOString()
          }),{diagnosticWriter:{
            writerName:'RealtimeLocksUI.reviewRemote',
            incomingRevision:Number.isInteger(download.data.revision)
              ?download.data.revision:null,
            reason:'remote_review_threshold',
            trigger:'reviewRemote'
          }});
        }
        reviewSummary={status:markerStatus,summary:copy(summary)};
        return {ok:true,status:markerStatus,data:copy(reviewSummary)};
      }).catch(function(){return {ok:false,status:'network_error'};});
  }
  function updateMarker(localId,status,options){
    var marker=latestMarker(localId,options);
    if(!marker)return {ok:false,status:'marker_not_found'};
    return deps(options).markers.update(
      marker.remoteConferenceId,marker.receivedAt,status
    );
  }
  function refreshLock(localId,options){
    var d=deps(options), ready=readiness(localId,options);
    if(!ready.ready)return Promise.resolve({ok:false,status:'prerequisites_missing'});
    return d.integration.refreshLockState(ready.link.remoteConferenceId,{
      locks:d.locks
    }).then(function(result){
      lockResult=result&&result.data&&result.data.lockResult||null;
      lockRefreshedAt=new Date().toISOString();
      return result;
    });
  }
  function lockAction(localId,action,options){
    var d=deps(options), ready=readiness(localId,options);
    if(!ready.ready)return Promise.resolve({ok:false,status:'prerequisites_missing'});
    if((action==='renew'||action==='release')&&
      !ownedByCurrentDevice(localId,options)){
      return Promise.resolve({ok:false,status:'not_current_device_owner'});
    }
    var method=action==='acquire'?'acquireLock':
      action==='renew'?'renewLock':'releaseLock';
    if(!d.locks||typeof d.locks[method]!=='function'){
      return Promise.resolve({ok:false,status:'lock_unavailable'});
    }
    return d.locks[method](ready.link.remoteConferenceId).then(function(result){
      lockResult=result;
      lockRefreshedAt=new Date().toISOString();
      if(d.integration.applyLockResult){
        d.integration.applyLockResult(ready.link.remoteConferenceId,result);
      }
      return result;
    }).catch(function(){return {ok:false,status:'error'};});
  }
  function ownedByCurrentDevice(localId,options){
    var ready=readiness(localId,options);
    var data=lockResult&&lockResult.data;
    if(!ready.device||!data||!data.owned||
      data.deviceId!==ready.device.id)return false;
    var expires=Date.parse(data.expiresAt||'');
    return !Number.isNaN(expires)&&expires>Date.now();
  }
  function hasOwnedLock(){
    return !!(lockResult&&lockResult.data&&lockResult.data.owned&&
      (!lockResult.data.expiresAt||
      Date.parse(lockResult.data.expiresAt)>Date.now()));
  }
  function esc(value){
    return String(value==null?'':value).replace(/&/g,'&amp;')
      .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function short(value){
    value=String(value||'');
    return value?value.slice(0,8)+'…':'—';
  }
  function remaining(expiresAt){
    var value=Date.parse(expiresAt||'');
    if(Number.isNaN(value))return 'غير معروف';
    var seconds=Math.max(0,Math.round((value-Date.now())/1000));
    return seconds<=0?'منتهي':Math.ceil(seconds/60)+' دقيقة تقريبًا';
  }
  function renderSection(input){
    input=input||{};
    var local=input.localConference;
    if(!local)return '';
    var ready=readiness(local.id);
    var marker=latestMarker(local.id);
    var data=lockResult&&lockResult.data;
    var owned=ownedByCurrentDevice(local.id);
    var managerState=automaticRealtimeState(local.id);
    var manager=deps(input).realtimeManager;
    var managerStates=manager&&typeof manager.getState==='function'
      ?manager.getState():{};
    var lifecycleRecord=global.appData&&
      global.appData.conferenceLifecycle&&
      global.appData.conferenceLifecycle.records&&
      global.appData.conferenceLifecycle.records[local.id]||null;
    var cloudLinked=automaticRealtimeActive(
      local.id,ready,managerState,input
    );
    var managerView=automaticRealtimePresentation(managerState);
    var displayedStatus=cloudLinked?managerView.label:connectionStatus;
    var html='<section class="settings-section realtime-locks-section">'+
      '<div class="settings-section-title">التحديثات البعيدة وقفل التعاون</div>';
    html+='<pre class="sync-settings-message" dir="ltr">'+esc([
      'conferenceId='+String(local.id||''),
      'linkStatus='+String(ready.link&&ready.link.linkStatus||''),
      'cloudLifecycle='+String(
        lifecycleRecord&&lifecycleRecord.cloudLifecycle||''
      ),
      'automaticRealtimeState='+JSON.stringify(managerState),
      'ConferenceRealtimeManager.state='+JSON.stringify(managerStates),
      'RealtimeLocksUI source='+SOURCE_REVISION
    ].join('\n'))+'</pre>';
    if(!ready.ready)html+='<div class="sync-settings-error">'+
      esc(ready.reasons.join(' '))+'</div>';
    html+='<div class="sync-link-summary"><span>Realtime: '+
      esc(displayedStatus)+'</span>'+
      (cloudLinked?'<span>Path: Automatic Realtime</span>':'')+
      '<span>Lock: '+
      esc(data?(data.locked?(owned?'مملوك لهذا الجهاز':'مملوك لجهاز آخر'):'غير مقفول'):'غير مقروء')+
      '</span>';
    if(data){
      html+='<span>User: '+short(data.userId)+'</span><span>Device: '+
        short(data.deviceId)+'</span><span>Expires: '+esc(data.expiresAt||'—')+
        '</span><span>المتبقي: '+esc(remaining(data.expiresAt))+
        '</span><span>آخر تحديث: '+esc(lockRefreshedAt||'—')+'</span>';
    }
    if(cloudLinked&&managerState){
      html+='<span>Status: '+esc(managerView.status)+'</span>'+
        '<span>Last subscribed: '+esc(managerState.lastConnectedAt||'—')+
        '</span><span>Last event: '+esc(managerState.lastEventAt||'—')+
        '</span><span>Last revision: '+esc(
          managerState.lastRevision==null?'—':managerState.lastRevision
        )+'</span>';
      if(managerState.lastError){
        html+='<span class="sync-settings-error">Last error: '+esc(
          managerState.lastError.code||managerState.lastError.message||
          managerState.lastError
        )+'</span>';
      }
    }
    html+='</div><div class="sync-settings-actions">'+
      '<button class="btn btn-blue btn-sm" '+(!ready.ready?'disabled':'')+
      ' onclick="RealtimeLocksUI.connectCurrent()">'+
      (cloudLinked?'إعادة الاتصال اللحظي':'بدء متابعة التحديثات')+'</button>'+
      (cloudLinked?'':'<button class="btn btn-gray btn-sm" onclick="RealtimeLocksUI.disconnectCurrent()">إيقاف متابعة التحديثات</button>')+
      '<button class="btn btn-gray btn-sm" '+(!ready.ready?'disabled':'')+
      ' onclick="RealtimeLocksUI.refreshCurrentLock()">تحديث حالة القفل</button>'+
      '<button class="btn btn-orange btn-sm" '+(!ready.ready?'disabled':'')+
      ' onclick="RealtimeLocksUI.acquireCurrentLock()">حجز المؤتمر للتعديل</button>'+
      '<button class="btn btn-purple btn-sm" '+(!owned?'disabled':'')+
      ' onclick="RealtimeLocksUI.renewCurrentLock()">تجديد القفل</button>'+
      '<button class="btn btn-red btn-sm" '+(!owned?'disabled':'')+
      ' onclick="RealtimeLocksUI.releaseCurrentLock()">تحرير القفل</button></div>';
    if(cloudLinked){
      var trace=automaticTrace();
      html+='<div class="sync-settings-message"><strong>realtimeTrace</strong><pre dir="ltr">'+
        esc(trace.map(function(item){
          var suffix=item&&item.data?' '+JSON.stringify(item.data):'';
          return String(item&&item.stage||'')+suffix;
        }).join('\n'))+'</pre></div>';
    }
    if(marker){
      var self=marker.status==='self_update';
      html+='<div class="remote-update-marker '+(self?'':'remote-update-warning')+
        '"><strong>'+(self?'تحديث من هذا الجهاز':'وصل تحديث بعيد')+
        '</strong><span>Remote: '+short(marker.remoteConferenceId)+
        '</span><span>Revision: '+esc(marker.revision===null?'غير معروفة':marker.revision)+
        '</span><span>Device: '+short(marker.sourceDeviceId)+
        '</span><span>Received: '+esc(marker.receivedAt)+'</span>'+
        '<div class="sync-settings-actions"><button class="btn btn-blue btn-sm" '+
        'onclick="RealtimeLocksUI.reviewCurrentUpdate()">مراجعة التحديث</button>'+
        '<button class="btn btn-gray btn-sm" onclick="RealtimeLocksUI.markCurrentReviewed()">تحديد كمراجع</button>'+
        '<button class="btn btn-gray btn-sm" onclick="RealtimeLocksUI.dismissCurrent()">تجاهل الإشعار</button></div></div>';
    }
    if(reviewSummary)html+='<div class="sync-settings-message">حالة المراجعة: '+
      esc(reviewSummary.status)+'</div>';
    return html+'<div class="sync-settings-message">'+esc(lastMessage)+
      '</div></section>';
  }
  function current(){
    var conference=global.getCurrentConference&&global.getCurrentConference();
    return {localConferenceId:conference&&conference.id,
      localSnapshot:conference?copy(conference):null};
  }
  function show(text){lastMessage=text;if(global.renderSettings)global.renderSettings();}
  function connectCurrent(){var i=current(),ready=readiness(i.localConferenceId),managerState=automaticRealtimeState(i.localConferenceId);var operation=automaticRealtimeActive(i.localConferenceId,ready,managerState)?automaticReconnect(i.localConferenceId):connect(i.localConferenceId);operation.then(function(r){show(r.ok?'تم الاتصال.':'تعذر الاتصال.');});}
  function disconnectCurrent(){disconnect().then(function(r){show(r.ok?'تم الإيقاف يدويًا.':'تعذر الإيقاف.');});}
  function reviewCurrentUpdate(){reviewRemote(current()).then(function(r){show(r.ok?'تمت مراجعة التحديث دون تطبيقه.':'تعذرت المراجعة.');});}
  function markCurrentReviewed(){show(updateMarker(current().localConferenceId,'reviewed_changed').ok?'تم تعليم الإشعار كمراجع.':'تعذر التحديث.');}
  function dismissCurrent(){show(updateMarker(current().localConferenceId,'dismissed').ok?'تم تجاهل الإشعار دون اعتباره متزامنًا.':'تعذر التحديث.');}
  function refreshCurrentLock(){refreshLock(current().localConferenceId).then(function(r){show(r.ok?'تم تحديث حالة القفل.':'تعذر قراءة القفل.');});}
  function acquireCurrentLock(){lockAction(current().localConferenceId,'acquire').then(function(r){show(r.ok?'تم تحديث نتيجة الحجز.':'تعذر الحجز.');});}
  function renewCurrentLock(){lockAction(current().localConferenceId,'renew').then(function(r){show(r.ok?'تم تحديث نتيجة التجديد.':'تعذر التجديد.');});}
  function releaseCurrentLock(){lockAction(current().localConferenceId,'release').then(function(r){show(r.ok?'تم تحديث نتيجة التحرير.':'تعذر التحرير.');});}
  global.RealtimeLocksUI=Object.freeze({
    readiness:readiness,onEvent:onEvent,connect:connect,disconnect:disconnect,
    automaticRealtimeState:automaticRealtimeState,
    automaticRealtimeActive:automaticRealtimeActive,
    automaticRealtimePresentation:automaticRealtimePresentation,
    automaticReconnect:automaticReconnect,automaticTrace:automaticTrace,
    reviewRemote:reviewRemote,updateMarker:updateMarker,
    refreshLock:refreshLock,lockAction:lockAction,
    ownedByCurrentDevice:ownedByCurrentDevice,hasOwnedLock:hasOwnedLock,
    renderSection:renderSection,connectCurrent:connectCurrent,
    disconnectCurrent:disconnectCurrent,
    reviewCurrentUpdate:reviewCurrentUpdate,
    markCurrentReviewed:markCurrentReviewed,dismissCurrent:dismissCurrent,
    refreshCurrentLock:refreshCurrentLock,
    acquireCurrentLock:acquireCurrentLock,renewCurrentLock:renewCurrentLock,
    releaseCurrentLock:releaseCurrentLock
  });
})(window);
