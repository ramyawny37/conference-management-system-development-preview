(function(global){
  'use strict';

  var busy=Object.create(null);
  var diagnostics=[];
  var MAX_DIAGNOSTICS=50;

  function object(value){
    return !!value&&typeof value==='object'&&!Array.isArray(value);
  }
  function copy(value){
    if(typeof global.structuredClone==='function'){
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }
  function safeText(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(char){
      return {'&':'&amp;','<':'&lt;','>':'&gt;',
        '"':'&quot;',"'":'&#39;'}[char];
    });
  }
  function diagnostic(code,stage,id){
    diagnostics.unshift({
      code:String(code||'OPERATIONAL_UI_ERROR'),
      stage:String(stage||'unknown'),
      timestamp:new Date().toISOString(),
      localConferenceId:String(id||'')
    });
    diagnostics=diagnostics.slice(0,MAX_DIAGNOSTICS);
  }
  function errorPresentation(code){
    code=String(code||'').toLowerCase();
    if(/auth|login|session/.test(code)){
      return 'يحتاج الإجراء إلى تسجيل الدخول.';
    }
    if(/pending/.test(code))return 'الحساب بانتظار الموافقة.';
    if(/blocked/.test(code))return 'الحساب محظور.';
    if(/creation_not_allowed|not_authorized|permission/.test(code)){
      return 'لا توجد صلاحية لإنشاء مؤتمر سحابي.';
    }
    if(/membership|write_denied|access_denied/.test(code)){
      return 'لا توجد صلاحية لتعديل هذا المؤتمر.';
    }
    if(/offline/.test(code))return 'لا يوجد اتصال بالإنترنت.';
    if(/unknown|ambiguous|reconciliation/.test(code)){
      return 'تعذر تحديد نتيجة العملية وتحتاج إلى مراجعة.';
    }
    if(/conflict/.test(code))return 'يوجد تعارض محتمل.';
    if(/manual|integrity/.test(code))return 'تحتاج العملية إلى مراجعة يدوية.';
    if(/supabase|configuration/.test(code)){
      return 'إعداد خدمة السحابة غير مكتمل.';
    }
    if(/repository|local|data|storage/.test(code)){
      return 'تعذر قراءة البيانات المحلية بأمان.';
    }
    return 'تعذر الوصول إلى الخدمة. حاول مرة أخرى لاحقًا.';
  }
  function publishStage(stage){
    return {
      authorization:'التحقق من الصلاحيات.',
      local_prepare:'تجهيز النسخة المحلية.',
      attempt_persisted:'تجهيز محاولة النشر.',
      conference_creation:'إنشاء المؤتمر السحابي.',
      membership_verification:'التحقق من الملكية.',
      initial_snapshot:'رفع النسخة الأولى.',
      pending_link:'حفظ رابط المؤتمر.',
      local_finalization:'إنهاء الإعداد المحلي.',
      reconciliation:'التحقق من محاولة نشر سابقة.',
      initial_snapshot_recovery:'استكمال رفع النسخة الأولى.',
      reconciliation_failed:'تعذر استكمال التحقق.'
    }[stage]||'جارٍ تجهيز حالة المؤتمر.';
  }
  function queuePresentation(queue){
    var status=queue&&queue.queueStatus||queue&&queue.status||'idle';
    var map={
      idle:'تمت مزامنة التغييرات المتاحة.',
      empty:'لا توجد تغييرات بانتظار الرفع.',
      pending:'تغييرات بانتظار الرفع.',
      processing:'جارٍ رفع التغييرات.',
      backoff:'المزامنة مؤجلة مؤقتًا.',
      waiting_for_connection:'المزامنة مؤجلة بسبب Offline.',
      waiting_for_auth:'لا توجد صلاحية كتابة حالية.',
      blocked:'المزامنة متوقفة بسبب تعارض.',
      blocked_by_conflict:'المزامنة متوقفة بسبب تعارض.',
      error:'تحتاج المزامنة إلى إعادة تحقق.',
      stopped:'المزامنة متوقفة.'
    };
    return {code:status,label:map[status]||'حالة المزامنة تحتاج مراجعة.'};
  }
  function realtimePresentation(realtime,online){
    if(online===false)return {code:'offline',label:'Offline.'};
    var status=realtime&&realtime.status||'inactive';
    var map={
      inactive:'الاتصال اللحظي متوقف.',
      waiting_for_prerequisites:'الاتصال يحتاج إعادة تحقق.',
      connecting:'جارٍ الاتصال بالتحديثات.',
      subscribed:'متصل بالتحديثات.',
      suspended:'الاتصال اللحظي متوقف مؤقتًا.',
      reconnecting:'جارٍ إعادة الاتصال.',
      error:'الاتصال يحتاج إعادة تحقق.',
      closed:'الاتصال اللحظي متوقف.'
    };
    if(realtime&&realtime.potentialConflict){
      return {code:'potential_conflict',label:'يوجد تعارض محتمل.'};
    }
    if(realtime&&realtime.remoteChangeDetected){
      return {code:'remote_change_detected',
        label:'تم اكتشاف تحديث بعيد يحتاج مراجعة.'};
    }
    return {code:status,label:map[status]||
      'الاتصال اللحظي يحتاج مراجعة.'};
  }
  function recoveryPresentation(metadata){
    var state=metadata&&metadata.reconciliationState;
    var map={
      reconciliation_required:'يحتاج استكمال النشر.',
      reconciling:'جارٍ التحقق من محاولة نشر سابقة.',
      retryable_same_operation:'يمكن استكمال نفس محاولة النشر.',
      manual_review_required:'تحتاج العملية إلى مراجعة يدوية.',
      reconciliation_failed:'تعذر تحديد نتيجة محاولة النشر.'
    };
    return state?{code:state,label:map[state]||
      'تحتاج محاولة النشر إلى مراجعة.'}:null;
  }
  function present(input){
    input=object(input)?input:{};
    var record=input.lifecycle||null;
    var access=input.systemAccess||{};
    var queue=queuePresentation(input.queue);
    var realtime=realtimePresentation(input.realtime,input.online);
    var cloud=record&&record.cloudLifecycle||'unclassified';
    var metadata=record&&record.publishMetadata||null;
    var recovery=recoveryPresentation(metadata);
    var primary='جاهز للعمل محليًا.';
    var severity='info';
    var actions=[];
    var linked=cloud==='cloud_linked'&&input.link&&
      Number.isInteger(input.link.knownRevision)&&
      input.link.knownRevision>0;
    if(cloud==='unpublished'){
      primary='محفوظ على هذا الجهاز فقط.';
      actions.push('publish');
      actions.push('keep_local');
    }else if(cloud==='local_only'){
      primary='محفوظ محليًا فقط.';
      actions.push('publish');
    }else if(cloud==='waiting_for_authorization'){
      primary='بانتظار السماح بالنشر.';
      actions.push('reauthorize');
      actions.push('cancel_publish');
    }else if(cloud==='ready_to_publish'){
      primary='جاهز للنشر.';
      actions.push('publish');
    }else if(cloud==='publishing'){
      primary=publishStage(metadata&&metadata.lastPublishStage);
      severity='progress';
    }else if(cloud==='publish_failed'){
      primary=recovery?recovery.label:'فشل النشر.';
      severity='warning';
      actions.push('recover');
    }else if(linked){
      primary='مرتبط بالسحابة.';
      if(input.link.syncState&&
        input.link.syncState.pendingLocalChanges){
        primary='توجد تغييرات محلية بانتظار المزامنة.';
      }
    }else if(cloud==='cloud_linked'){
      primary='يحتاج رابط المؤتمر إلى مراجعة.';
      severity='warning';
    }else{
      primary='تحتاج حالة المؤتمر إلى مراجعة يدوية.';
      severity='warning';
    }
    if(realtime.code==='potential_conflict'){
      primary='يوجد تعارض محتمل. لم تُحذف البيانات المحلية.';
      severity='danger';
      actions=['review'];
    }else if(realtime.code==='remote_change_detected'){
      primary='تم اكتشاف تغيير بعيد دون تطبيقه على بياناتك.';
      severity='warning';
      actions.push('review');
    }
    var freshAllowed=access.source==='server'&&access.fresh===true&&
      access.authenticated===true&&access.accountStatus==='approved'&&
      (access.canCreateConferences===true||
       access.isSystemOwner===true);
    var accountCode=access.status==='loading'
      ?'loading':access.isSystemOwner===true
        ?'system_owner':access.accountStatus||'signed_out';
    var accountLabels={
      loading:'جارٍ تحميل صلاحيات الحساب.',
      approved:'الحساب معتمد.',
      pending:'الحساب بانتظار الموافقة.',
      blocked:'الحساب محظور عن خدمات السحابة.',
      system_owner:'الحساب مالك للنظام.',
      signed_out:'لم يتم تسجيل الدخول.'
    };
    if(actions.indexOf('publish')>=0&&!freshAllowed){
      actions=actions.filter(function(action){return action!=='publish';});
      if(access.accountStatus==='pending'){
        actions.push('reauthorize');
      }
    }
    return {
      primaryStatus:primary,
      secondaryStatus:queue.label+' '+realtime.label,
      severity:severity,
      availableActions:actions,
      isBusy:busy[String(input.localConferenceId||'')]===true||
        cloud==='publishing'||metadata&&
        metadata.reconciliationState==='reconciling',
      isCloudLinked:linked,
      hasPendingLocalChanges:!!(input.link&&input.link.syncState&&
        input.link.syncState.pendingLocalChanges),
      requiresManualReview:severity==='danger'||
        metadata&&metadata.reconciliationState===
          'manual_review_required',
      diagnosticCode:recovery&&recovery.code||cloud,
      accountStatus:accountCode,
      accountLabel:accountLabels[accountCode]||
        'تحتاج حالة الحساب إلى إعادة تحقق.',
      cloudCreationLabel:freshAllowed
        ?'يمكن لهذا الحساب طلب نشر مؤتمر إلى السحابة.'
        :'لا توجد صلاحية مؤكدة حاليًا لنشر مؤتمر إلى السحابة.',
      canCreateCloudConference:freshAllowed,
      queue:queue,
      realtime:realtime,
      discovery:input.discovery||{
        status:'not_available_yet',
        label:'عرض مؤتمرات الحساب على جهاز جديد غير متاح بعد.'
      }
    };
  }
  function dependencies(options){
    options=object(options)?options:{};
    return {
      repository:options.repository||global.ConferenceRepository,
      manager:options.publishManager||global.ConferencePublishManager,
      recovery:options.recovery||global.ConferencePublishRecovery,
      access:options.systemAccess||global.SystemAccessService,
      auth:options.auth||global.SupabaseAuth,
      device:options.device||global.SupabaseDeviceIdentity,
      links:options.links||global.ConferenceLinkStore,
      queueRunner:options.queueRunner||global.AutomaticQueueRunner,
      realtime:options.realtimeManager||global.ConferenceRealtimeManager,
      getData:options.getAppData||function(){return global.appData;},
      applyData:options.applyAppData||function(value){
        global.appData=value;
      },
      persist:options.persistAppData||function(value){
        if(!global.StorageRepository||
          typeof global.StorageRepository.saveAppSnapshot!=='function'){
          return Promise.reject(new Error('PERSISTENCE_UNAVAILABLE'));
        }
        return global.StorageRepository.saveAppSnapshot(value,{
          skipSyncQueue:true
        });
      },
      confirm:options.confirm||global.confirm,
      onChange:options.onChange||function(){}
    };
  }
  function userId(auth){
    var session=auth&&typeof auth.getSession==='function'
      ?auth.getSession():null;
    return String(session&&session.user&&session.user.id||'');
  }
  function persist(d,value){
    return Promise.resolve(d.persist(copy(value))).then(function(){
      d.applyData(copy(value));
      d.onChange();
      return value;
    });
  }
  function accessCheck(access){
    return {
      userId:access.userId,
      checkedAt:access.checkedAt||new Date().toISOString(),
      source:'server',
      fresh:true,
      authenticated:true,
      accountStatus:access.accountStatus,
      canCreateConferences:access.canCreateConferences===true,
      isSystemOwner:access.isSystemOwner===true
    };
  }
  function confirmationMessage(){
    return [
      'هذا المؤتمر محفوظ محليًا حاليًا.',
      'سيؤدي النشر إلى إنشاء نسخة سحابية مرتبطة بالحساب.',
      'ستطبق عضويات وصلاحيات السحابة بعد النشر.',
      'تحتاج العملية إلى اتصال مستقر، وقد يتطلب إغلاق الصفحة استكمالًا لاحقًا.',
      'لن تُحذف النسخة المحلية. هل تريد المتابعة؟'
    ].join('\n');
  }
  function publish(localConferenceId,options){
    localConferenceId=String(localConferenceId||'');
    if(busy[localConferenceId]){
      return Promise.resolve({ok:false,status:'already_running'});
    }
    busy[localConferenceId]=true;
    var d=dependencies(options);
    var current=d.getData();
    var found=d.repository&&
      typeof d.repository.getLifecycle==='function'
      ?d.repository.getLifecycle(current,localConferenceId):null;
    if(!found||!found.ok){
      busy[localConferenceId]=false;
      return Promise.resolve({ok:false,status:'repository_unavailable'});
    }
    var authenticatedUser=userId(d.auth);
    return Promise.resolve(d.access&&
      typeof d.access.refresh==='function'
        ?d.access.refresh():null).then(function(access){
      if(!access||access.source!=='server'||access.fresh!==true||
        access.authenticated!==true||
        access.userId!==authenticatedUser||
        access.accountStatus!=='approved'||
        !(access.canCreateConferences||access.isSystemOwner)){
        return {halt:{ok:false,status:
          access&&access.accountStatus==='pending'
            ?'account_pending':access&&
              access.accountStatus==='blocked'
              ?'account_blocked':'conference_creation_not_allowed'}};
      }
      if(typeof d.confirm!=='function'||
        d.confirm(confirmationMessage())!==true){
        return {halt:{ok:false,status:'confirmation_cancelled'}};
      }
      var source=d.getData();
      var record=d.repository.getLifecycle(
        source,localConferenceId
      );
      if(!record.ok)return {halt:record};
      var next=source;
      var lifecycle=record.data.cloudLifecycle;
      if(['unpublished','local_only'].indexOf(lifecycle)>=0){
        var identity=d.device&&
          typeof d.device.getOrCreate==='function'
          ?d.device.getOrCreate():null;
        var requested=d.manager.transitionAppData(
          next,localConferenceId,'request_publish',{
            requestedAt:new Date().toISOString(),
            requestedByUserId:authenticatedUser,
            requestedByDeviceId:identity&&identity.id||null,
            accessCheck:accessCheck(access)
          }
        );
        if(!requested.ok)return {halt:requested};
        next=requested.data;
        lifecycle='waiting_for_authorization';
      }
      if(lifecycle==='waiting_for_authorization'){
        var authorized=d.manager.transitionAppData(
          next,localConferenceId,'authorize',{
            accessCheck:accessCheck(access)
          }
        );
        if(!authorized.ok)return {halt:authorized};
        next=authorized.data;
        lifecycle='ready_to_publish';
      }
      if(lifecycle!=='ready_to_publish'){
        return {halt:{ok:false,status:'publish_state_not_ready'}};
      }
      return persist(d,next).then(function(saved){
        return {prepared:saved,access:access};
      });
    }).then(function(prepared){
      if(prepared.halt)return prepared.halt;
      var confirmedAt=new Date().toISOString();
      return d.manager.publishConference(
        prepared.prepared,localConferenceId,{
          confirmed:true,
          confirmedAt:confirmedAt,
          userId:authenticatedUser,
          confirmedByUserId:authenticatedUser,
          localConferenceId:localConferenceId
        },options&&options.publishOptions);
    }).then(function(result){
      if(!result||!result.ok){
        diagnostic(result&&result.status,'publish',localConferenceId);
      }
      if(result&&result.data&&result.data.appData){
        d.applyData(copy(result.data.appData));
      }
      d.onChange();
      return result;
    }).catch(function(){
      diagnostic('publish_ui_failed','publish',localConferenceId);
      return {ok:false,status:'publish_ui_failed'};
    }).finally(function(){
      delete busy[localConferenceId];
    });
  }
  function recover(localConferenceId,options){
    localConferenceId=String(localConferenceId||'');
    if(busy[localConferenceId]){
      return Promise.resolve({ok:false,status:'already_running'});
    }
    busy[localConferenceId]=true;
    var d=dependencies(options);
    return Promise.resolve(d.manager.reconcileConference(
      d.getData(),localConferenceId,
      options&&options.recoveryOptions
    )).then(function(result){
      if(result&&result.data&&result.data.appData){
        d.applyData(copy(result.data.appData));
      }
      if(!result||!result.ok){
        diagnostic(result&&result.status,'recovery',localConferenceId);
      }
      d.onChange();
      return result;
    }).catch(function(){
      diagnostic('recovery_ui_failed','recovery',localConferenceId);
      return {ok:false,status:'recovery_ui_failed'};
    }).finally(function(){delete busy[localConferenceId];});
  }
  function transitionLocal(localConferenceId,action,input,options){
    localConferenceId=String(localConferenceId||'');
    if(busy[localConferenceId]){
      return Promise.resolve({ok:false,status:'already_running'});
    }
    var d=dependencies(options);
    var transitioned=d.manager&&
      typeof d.manager.transitionAppData==='function'
      ?d.manager.transitionAppData(
        d.getData(),localConferenceId,action,input||{}
      ):null;
    if(!transitioned||!transitioned.ok){
      diagnostic(transitioned&&transitioned.status,
        action,localConferenceId);
      return Promise.resolve(transitioned||{
        ok:false,status:'publish_manager_unavailable'
      });
    }
    busy[localConferenceId]=true;
    return persist(d,transitioned.data).then(function(){
      return {ok:true,status:action};
    }).catch(function(){
      diagnostic('local_transition_persistence_failed',
        action,localConferenceId);
      return {ok:false,status:'local_transition_persistence_failed'};
    }).finally(function(){delete busy[localConferenceId];});
  }
  function keepLocal(localConferenceId,options){
    return transitionLocal(
      localConferenceId,'keep_local',{},options
    );
  }
  function cancelPublish(localConferenceId,options){
    return transitionLocal(localConferenceId,'cancel_publish',{
      returnTo:'unpublished'
    },options);
  }
  function reauthorize(localConferenceId,options){
    localConferenceId=String(localConferenceId||'');
    if(busy[localConferenceId]){
      return Promise.resolve({ok:false,status:'already_running'});
    }
    var d=dependencies(options);
    var authenticatedUser=userId(d.auth);
    return Promise.resolve(d.access&&d.access.refresh
      ?d.access.refresh():null).then(function(access){
      if(!access||access.source!=='server'||access.fresh!==true||
        access.authenticated!==true||access.userId!==authenticatedUser){
        return {ok:false,status:'fresh_server_access_required'};
      }
      return transitionLocal(localConferenceId,'authorize',{
        accessCheck:accessCheck(access)
      },options);
    }).catch(function(){
      return {ok:false,status:'fresh_server_access_required'};
    });
  }
  function logoutCleanup(options){
    var d=dependencies(options);
    diagnostics=[];
    busy=Object.create(null);
    var tasks=[];
    if(global.AutomaticSyncOrchestrator&&
      typeof global.AutomaticSyncOrchestrator.stop==='function'){
      var stopped=global.AutomaticSyncOrchestrator.stop();
      if(stopped&&stopped.promise)tasks.push(stopped.promise);
    }
    if(d.queueRunner&&typeof d.queueRunner.stop==='function'){
      d.queueRunner.stop();
    }
    if(d.realtime&&typeof d.realtime.stopAll==='function'){
      tasks.push(d.realtime.stopAll(
        options&&options.realtimeOptions
      ));
    }
    return Promise.all(tasks).then(function(){
      return {ok:true,status:'cloud_runtime_cleared'};
    });
  }
  function currentInput(localConference,options){
    options=object(options)?options:{};
    var id=localConference&&String(localConference.id||'');
    var d=dependencies(options);
    var data=d.getData();
    var found=d.repository&&d.repository.getLifecycle
      ?d.repository.getLifecycle(data,id):null;
    var link=d.links&&typeof d.links.get==='function'
      ?d.links.get(id,options.linkOptions):null;
    return {
      localConferenceId:id,
      lifecycle:found&&found.ok?found.data:null,
      systemAccess:d.access&&d.access.getState
        ?d.access.getState():{},
      link:link,
      queue:d.queueRunner&&d.queueRunner.getState
        ?d.queueRunner.getState():{},
      realtime:d.realtime&&d.realtime.getState
        ?d.realtime.getState(id):{},
      online:!global.navigator||global.navigator.onLine!==false,
      discovery:{
        status:'not_available_yet',
        label:'عرض مؤتمرات الحساب على جهاز جديد غير متاح بعد.'
      }
    };
  }
  function renderSection(input){
    input=object(input)?input:{};
    var local=input.localConference;
    if(!local)return '';
    var view=present(currentInput(local,input.options));
    var id=safeText(local.id);
    var actions='';
    if(view.availableActions.indexOf('publish')>=0){
      actions+='<button type="button" class="btn btn-blue" '+
        'aria-label="نشر المؤتمر إلى السحابة" '+
        (view.isBusy?'disabled ':'')+
        'onclick="ConferenceOperationalUI.publish(\''+id+'\')">'+
        'نشر المؤتمر إلى السحابة</button>';
    }
    if(view.availableActions.indexOf('recover')>=0){
      actions+='<button type="button" class="btn btn-orange" '+
        'aria-label="استكمال محاولة النشر" '+
        (view.isBusy?'disabled ':'')+
        'onclick="ConferenceOperationalUI.recover(\''+id+'\')">'+
        'استكمال محاولة النشر</button>';
    }
    if(view.availableActions.indexOf('keep_local')>=0){
      actions+='<button type="button" class="btn" '+
        'aria-label="الاحتفاظ بالمؤتمر محليًا فقط" '+
        (view.isBusy?'disabled ':'')+
        'onclick="ConferenceOperationalUI.keepLocal(\''+id+'\')">'+
        'الاحتفاظ محليًا فقط</button>';
    }
    if(view.availableActions.indexOf('cancel_publish')>=0){
      actions+='<button type="button" class="btn" '+
        'aria-label="إلغاء طلب نشر المؤتمر" '+
        (view.isBusy?'disabled ':'')+
        'onclick="ConferenceOperationalUI.cancelPublish(\''+id+'\')">'+
        'إلغاء طلب النشر</button>';
    }
    if(view.availableActions.indexOf('reauthorize')>=0){
      actions+='<button type="button" class="btn" '+
        'aria-label="إعادة التحقق من صلاحية النشر" '+
        (view.isBusy?'disabled ':'')+
        'onclick="ConferenceOperationalUI.reauthorize(\''+id+'\')">'+
        'إعادة التحقق من الصلاحية</button>';
    }
    if(view.availableActions.indexOf('review')>=0){
      actions+='<span role="alert">تحتاج الحالة إلى مراجعة قبل المزامنة.</span>';
    }
    return '<section class="settings-section" dir="rtl" '+
      'aria-labelledby="conferenceOperationalTitle">'+
      '<h3 id="conferenceOperationalTitle">حالة المؤتمر والتشغيل</h3>'+
      '<div role="status" aria-live="polite">'+
      '<strong>'+safeText(view.primaryStatus)+'</strong><br>'+
      '<span>'+safeText(view.secondaryStatus)+'</span></div>'+
      '<p>'+safeText(view.accountLabel)+' '+
      safeText(view.cloudCreationLabel)+'</p>'+
      '<p>'+safeText(view.discovery.label)+'</p>'+
      '<div class="settings-actions">'+actions+'</div></section>';
  }
  function getDiagnostics(){
    return copy(diagnostics);
  }

  global.ConferenceOperationalStatusPresenter=Object.freeze({
    present:present,
    errorPresentation:errorPresentation,
    publishStage:publishStage,
    queuePresentation:queuePresentation,
    realtimePresentation:realtimePresentation,
    recoveryPresentation:recoveryPresentation
  });
  global.ConferenceCloudActionsController=Object.freeze({
    publish:publish,
    recover:recover,
    keepLocal:keepLocal,
    cancelPublish:cancelPublish,
    reauthorize:reauthorize,
    logoutCleanup:logoutCleanup,
    getDiagnostics:getDiagnostics
  });
  global.ConferenceOperationalUI=Object.freeze({
    renderSection:renderSection,
    publish:publish,
    recover:recover,
    keepLocal:keepLocal,
    cancelPublish:cancelPublish,
    reauthorize:reauthorize,
    logoutCleanup:logoutCleanup,
    getDiagnostics:getDiagnostics
  });
})(window);
